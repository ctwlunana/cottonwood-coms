import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  notifications, notificationDeliveryLogs, notificationPreferences, users, userRoles, rolePermissions,
} from "@/db/schema";
import type { PermissionCode } from "@/lib/permissions";
import { ADAPTERS, type ChannelAdapter } from "./channels";
import { getSetting } from "@/services/settings";

export type Priority = "critical" | "high" | "normal" | "low";

export type NotifyInput = {
  type: string;                // e.g. "maintenance.new_request"
  userIds: string[];
  title: string;
  body?: string;
  link?: string;               // in-app path, e.g. "/properti/<id>"
  entityType?: string;
  entityId?: string;
  priority?: Priority;
  /** Suppress identical notifications to the same user within the window. */
  dedupeKey?: string;
  dedupeWindowMinutes?: number;
};

/** Active users who hold a permission (optionally excluding someone, e.g. the requester). */
export async function usersWithPermission(tx: Tx, code: PermissionCode, exclude: string[] = []): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(users.isActive, true), eq(rolePermissions.permissionCode, code)));
  return rows.map((r) => r.id).filter((id) => !exclude.includes(id));
}

/**
 * Create in-app notifications and queue external deliveries — inside the caller's
 * transaction, so a notification event is never lost when the business change commits.
 * Returns the number of notifications created (after dedupe).
 */
export async function notify(tx: Tx, n: NotifyInput): Promise<number> {
  const recipients = [...new Set(n.userIds)];
  if (!recipients.length) return 0;
  const priority = n.priority ?? "normal";
  let created = 0;

  for (const userId of recipients) {
    if (n.dedupeKey) {
      const since = new Date(Date.now() - (n.dedupeWindowMinutes ?? 60) * 60_000);
      const dup = await tx.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.userId, userId), eq(notifications.dedupeKey, n.dedupeKey), gt(notifications.createdAt, since),
      )).limit(1);
      if (dup.length) continue;
    }
    const prefs = await tx.select().from(notificationPreferences).where(and(
      eq(notificationPreferences.userId, userId), inArray(notificationPreferences.type, [n.type, "*"]),
    ));
    const pref = prefs.find((p) => p.type === n.type) ?? prefs.find((p) => p.type === "*")
      ?? { inApp: true, email: false, whatsapp: false };

    const [row] = await tx.insert(notifications).values({
      userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null,
      entityType: n.entityType ?? null, entityId: n.entityId ?? null, priority, dedupeKey: n.dedupeKey ?? null,
    }).returning({ id: notifications.id });
    created++;

    // In-app is always stored (it is the system of record); log it as sent.
    await tx.insert(notificationDeliveryLogs).values({
      notificationId: row.id, recipientId: userId, channel: "in_app", status: "sent", sentAt: new Date(),
    });
    // Critical incidents go to every external channel regardless of preference.
    const wantEmail = priority === "critical" || pref.email;
    const wantWa = priority === "critical" || pref.whatsapp;
    for (const [ch, want] of [["email", wantEmail], ["whatsapp", wantWa]] as const) {
      if (!want) continue;
      await tx.insert(notificationDeliveryLogs).values({
        notificationId: row.id, recipientId: userId, channel: ch, status: "pending",
      });
    }
  }
  return created;
}

function inQuietHours(now: Date, q: { start: string; end: string } | null): boolean {
  if (!q) return false;
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const { start, end } = q;
  return start <= end ? hm >= start && hm < end : hm >= start || hm < end;
}

const MAX_RETRIES = 3;

/**
 * Deliver pending external notifications (called after actions and by the scheduler).
 * Unconfigured channel / missing contact → "skipped" with reason. Failures are retried
 * up to MAX_RETRIES then marked "failed". Non-critical messages wait during quiet hours.
 */
export async function dispatchPending(tx: Tx, adapters: ChannelAdapter[] = ADAPTERS, now = new Date()) {
  const quiet = await getSetting<{ start: string; end: string } | null>(tx, "notification.quiet_hours");
  const pending = await tx
    .select({
      log: notificationDeliveryLogs,
      title: notifications.title, body: notifications.body, link: notifications.link, priority: notifications.priority,
      email: users.email, phone: users.phone,
    })
    .from(notificationDeliveryLogs)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveryLogs.notificationId))
    .innerJoin(users, eq(users.id, notificationDeliveryLogs.recipientId))
    .where(and(eq(notificationDeliveryLogs.status, "pending"), lte(notificationDeliveryLogs.retryCount, MAX_RETRIES)))
    .limit(200);

  const quietNow = inQuietHours(now, quiet);
  let sent = 0, skipped = 0, failed = 0;
  for (const p of pending) {
    if (quietNow && p.priority !== "critical") continue;
    const adapter = adapters.find((a) => a.name === p.log.channel);
    const set = (v: Partial<typeof notificationDeliveryLogs.$inferInsert>) =>
      tx.update(notificationDeliveryLogs).set(v).where(eq(notificationDeliveryLogs.id, p.log.id));
    if (!adapter || !adapter.configured()) { await set({ status: "skipped", error: `Kanal ${p.log.channel} belum dikonfigurasi` }); skipped++; continue; }
    const to = adapter.address({ email: p.email, phone: p.phone });
    if (!to) { await set({ status: "skipped", error: "Penerima tidak memiliki kontak untuk kanal ini" }); skipped++; continue; }
    const r = await adapter.send({ to, subject: p.title, text: p.body ?? p.title, link: p.link });
    if (r.ok) { await set({ status: "sent", sentAt: new Date(), error: null }); sent++; }
    else {
      const retry = p.log.retryCount + 1;
      await set({ retryCount: retry, error: r.error, status: !r.retryable || retry >= MAX_RETRIES ? "failed" : "pending" });
      failed++;
    }
  }
  return { sent, skipped, failed };
}

export async function unreadCount(tx: Tx, userId: string): Promise<number> {
  const [r] = await tx.select({ c: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return r.c;
}
