import { and, eq, isNull, desc, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { notifications, notificationDeliveryLogs, notificationPreferences } from "@/db/schema";
import type { Actor } from "@/lib/authz";
import { NotFoundError } from "@/lib/errors";

export async function listMyNotifications(tx: Tx, actor: Actor, opts: { unreadOnly?: boolean; page?: number } = {}) {
  const where = and(eq(notifications.userId, actor.id), opts.unreadOnly ? isNull(notifications.readAt) : undefined);
  const page = Math.max(1, opts.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    tx.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(30).offset((page - 1) * 30),
    tx.select({ total: sql<number>`count(*)::int` }).from(notifications).where(where),
  ]);
  return { rows, total, page, pageSize: 30 };
}

/** Mark read (only the owner can). Returns the link to open. */
export async function markRead(tx: Tx, actor: Actor, id: string) {
  const [n] = await tx.update(notifications).set({ readAt: sql`coalesce(${notifications.readAt}, now())`, acknowledgedAt: sql`coalesce(${notifications.acknowledgedAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, actor.id))).returning();
  if (!n) throw new NotFoundError("Notifikasi tidak ditemukan.");
  return n.link;
}

export async function markAllRead(tx: Tx, actor: Actor) {
  await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
}

export async function myDeliveryLog(tx: Tx, actor: Actor, notificationId: string) {
  return tx.select().from(notificationDeliveryLogs).where(and(eq(notificationDeliveryLogs.notificationId, notificationId), eq(notificationDeliveryLogs.recipientId, actor.id)));
}

export async function getMyPreferences(tx: Tx, actor: Actor) {
  const [p] = await tx.select().from(notificationPreferences).where(and(eq(notificationPreferences.userId, actor.id), eq(notificationPreferences.type, "*")));
  return p ?? { userId: actor.id, type: "*", inApp: true, push: true };
}

export async function setMyPreferences(tx: Tx, actor: Actor, v: { push: boolean }) {
  // In-app is mandatory: COMS is the system of record.
  await tx.insert(notificationPreferences).values({ userId: actor.id, type: "*", inApp: true, push: v.push })
    .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.type], set: { push: v.push } });
}
