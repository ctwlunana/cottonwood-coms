import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { workOrders, properties, propertyAssignments, checklistSubmissions } from "@/db/schema";
import { notify, usersWithPermission } from "@/lib/notify";
import { getSetting } from "./settings";
import { generateDuePreventive } from "./maintenance";
import { overdueAssignments, inspectorsFor } from "./housekeeping";
import { todayJakarta } from "./villa-relations";
import { PRIORITY_LABEL } from "@/lib/labels";

const ACTIVE = ["new", "under_review", "assigned", "in_progress", "waiting_parts", "waiting_approval"] as const;

function jakartaHM(d = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/**
 * Reminder & escalation rules (run every 5 minutes; dedupe keys keep each reminder to once per day
 * or once per record, so users are not spammed):
 *  - Critical/High WO still unassigned after N minutes → supervisors (+GM for critical)
 *  - Overdue WO → assignee + supervisors (daily); overdue > X hours → GM (daily)
 *  - Overdue cleaning (target time passed, not ready) → coordinators + TL (daily)
 *  - Cleaning waiting for inspection > 60 min → inspectors (once)
 *  - Daily checklist not submitted by the configured time → villa keeper (daily)
 *  - Preventive maintenance due within 3 days → work order generated
 */
export async function runReminders(tx: Tx, now = new Date()) {
  const today = todayJakarta(now);
  const out = { unassigned: 0, woOverdue: 0, woGm: 0, hkOverdue: 0, hkInspect: 0, checklist: 0, pm: 0 };
  const supervisors = await usersWithPermission(tx, "maintenance.assign");
  const gms = await usersWithPermission(tx, "dashboard.gm");

  const unassignedMin = await getSetting<number>(tx, "escalation.unassigned_minutes");
  const stale = await tx.select({ wo: workOrders, villa: properties.name }).from(workOrders).innerJoin(properties, eq(properties.id, workOrders.propertyId))
    .where(and(eq(workOrders.status, "new"), inArray(workOrders.priority, ["critical", "high"]), lt(workOrders.createdAt, new Date(now.getTime() - unassignedMin * 60_000))));
  for (const { wo, villa } of stale) {
    out.unassigned += await notify(tx, { type: "maintenance.unassigned_escalation", userIds: [...supervisors, ...(wo.priority === "critical" ? gms : [])], priority: wo.priority,
      title: `ESKALASI: ${wo.code} (${PRIORITY_LABEL[wo.priority]}) belum ditugaskan`, body: `${villa}: ${wo.title}`, link: `/maintenance/${wo.id}`, entityType: "work_order", entityId: wo.id,
      dedupeKey: `wo-unassigned:${wo.id}`, dedupeWindowMinutes: 24 * 60 });
  }

  const gmHours = await getSetting<number>(tx, "escalation.overdue_gm_hours");
  const overdue = await tx.select({ wo: workOrders, villa: properties.name }).from(workOrders).innerJoin(properties, eq(properties.id, workOrders.propertyId))
    .where(and(inArray(workOrders.status, [...ACTIVE]), lt(workOrders.deadline, now)));
  for (const { wo, villa } of overdue) {
    out.woOverdue += await notify(tx, { type: "maintenance.wo_overdue", userIds: [wo.assignedTo, ...supervisors].filter((x): x is string => !!x), priority: wo.priority === "low" ? "normal" : wo.priority,
      title: `Terlambat: ${wo.code}`, body: `${villa}: ${wo.title}`, link: `/maintenance/${wo.id}`, entityType: "work_order", entityId: wo.id,
      dedupeKey: `wo-overdue:${wo.id}:${today}`, dedupeWindowMinutes: 24 * 60 });
    if (wo.deadline && now.getTime() - wo.deadline.getTime() > gmHours * 3600_000) {
      out.woGm += await notify(tx, { type: "maintenance.wo_overdue_gm", userIds: gms, priority: "high",
        title: `Eskalasi GM: ${wo.code} terlambat > ${gmHours} jam`, body: `${villa}: ${wo.title}`, link: `/maintenance/${wo.id}`, entityType: "work_order", entityId: wo.id,
        dedupeKey: `wo-overdue-gm:${wo.id}:${today}`, dedupeWindowMinutes: 24 * 60 });
    }
  }

  const coordinators = await usersWithPermission(tx, "housekeeping.schedule");
  for (const { a, villa } of await overdueAssignments(tx)) {
    out.hkOverdue += await notify(tx, { type: "housekeeping.overdue", userIds: coordinators, priority: a.priority === "low" ? "normal" : a.priority,
      title: `Belum siap sesuai target: ${villa}`, body: `${a.code} — status saat ini perlu ditindaklanjuti.`, link: `/housekeeping/${a.id}`, entityType: "hk_assignment", entityId: a.id,
      dedupeKey: `hk-overdue:${a.id}:${today}`, dedupeWindowMinutes: 24 * 60 });
    if (a.status === "inspection_required" && a.cleaningCompletedAt && now.getTime() - a.cleaningCompletedAt.getTime() > 60 * 60_000) {
      out.hkInspect += await notify(tx, { type: "housekeeping.inspection_reminder", userIds: await inspectorsFor(tx, a), priority: "high",
        title: `Mohon inspeksi: ${villa}`, link: `/housekeeping/${a.id}`, entityType: "hk_assignment", entityId: a.id, dedupeKey: `hk-inspect:${a.id}`, dedupeWindowMinutes: 24 * 60 });
    }
  }

  const reminderAt = await getSetting<string>(tx, "checklist.reminder_time");
  if (jakartaHM(now) >= reminderAt) {
    const missing = await tx.select({ userId: propertyAssignments.userId, villa: properties.name }).from(propertyAssignments)
      .innerJoin(properties, eq(properties.id, propertyAssignments.propertyId))
      .where(and(eq(propertyAssignments.kind, "villa_keeper"), isNull(propertyAssignments.endedAt), isNull(properties.deletedAt), eq(properties.status, "active"),
        sql`not exists (select 1 from ${checklistSubmissions} s where s.property_id = ${properties.id} and s.check_date = ${today})`));
    const byUser = new Map<string, string[]>();
    missing.forEach((m) => byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m.villa]));
    for (const [userId, villas] of byUser) {
      out.checklist += await notify(tx, { type: "checklist.reminder", userIds: [userId], title: `Checklist harian belum diisi (${villas.length} villa)`, body: villas.join(", "),
        link: "/checklist/baru", dedupeKey: `checklist-reminder:${today}`, dedupeWindowMinutes: 20 * 60 });
    }
  }

  out.pm = await generateDuePreventive(tx);
  return out;
}
