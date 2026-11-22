import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  maintenanceRequests, workOrders, workOrderUpdates, workOrderMaterials, properties, users, locations,
  checklistAnswers, checklistSubmissions, equipment, pmSchedules, hkAssignmentStaff, hkAssignments,
} from "@/db/schema";
import { type Actor, requirePermission, propertyScope, scopeFilter, scopeOf, can, assertNotSelf } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validate";
import { notify, usersWithPermission } from "@/lib/notify";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, WO_STATUS_LABEL, type Priority, type WoStatus, type MaintenanceCategory } from "@/lib/labels";
import { getSetting } from "./settings";
import { saveFiles, filesFor, type UploadFile } from "./attachments";
import { villaRelation, villaKeeperId, todayJakarta } from "./villa-relations";

const OPEN: WoStatus[] = ["new", "under_review", "assigned", "in_progress", "waiting_parts", "waiting_approval", "completed", "verified"];
const ACTIVE_WORK: WoStatus[] = ["new", "under_review", "assigned", "in_progress", "waiting_parts", "waiting_approval"];
const REPEAT_WINDOW_DAYS = 90;
const REPEAT_THRESHOLD = 2; // ≥2 earlier issues in the window ⇒ repeated problem

async function deadlineFor(tx: Tx, priority: Priority, from = new Date()) {
  const sla = await getSetting<Record<Priority, number>>(tx, "maintenance.sla_hours");
  return new Date(from.getTime() + (sla[priority] ?? 72) * 3600_000);
}

async function gmIds(tx: Tx, exclude: string[] = []) {
  return usersWithPermission(tx, "dashboard.gm", exclude);
}

/** Can the actor report a problem at this villa? Villa access, or currently cleaning it (housekeepers). */
async function assertCanReport(tx: Tx, actor: Actor, propertyId: string) {
  requirePermission(actor, "maintenance.report");
  if (actor.perms.has("property.view")) {
    const scope = await propertyScope(tx, actor, "property.view");
    if (scope === "all" || scope.includes(propertyId)) return;
  }
  const since = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
  const hk = await tx.select({ id: hkAssignments.id }).from(hkAssignmentStaff)
    .innerJoin(hkAssignments, eq(hkAssignments.id, hkAssignmentStaff.assignmentId))
    .where(and(eq(hkAssignmentStaff.userId, actor.id), eq(hkAssignments.propertyId, propertyId), gte(hkAssignments.checkoutDate, since))).limit(1);
  if (hk.length) return;
  throw new ForbiddenError("Villa ini tidak termasuk dalam penugasan Anda.");
}

// ================================================================== requests
export const requestInput = z.object({
  propertyId: z.string().uuid("Pilih villa"),
  category: z.enum(CATEGORIES, { message: "Pilih kategori" }),
  description: z.string().trim().min(5, "Jelaskan masalahnya (min. 5 karakter)").max(4000),
  priority: z.enum(PRIORITIES).default("normal"),
  discoveredAt: z.coerce.date().optional(),
  source: z.enum(["keeper", "checklist", "cs", "supervisor", "housekeeping", "other"]).optional(),
});

async function repeatHistory(tx: Tx, propertyId: string, category: MaintenanceCategory, excludeWo?: string) {
  const since = new Date(Date.now() - REPEAT_WINDOW_DAYS * 86400_000);
  return tx.select({ id: workOrders.id, code: workOrders.code, title: workOrders.title, status: workOrders.status, reportedAt: workOrders.reportedAt })
    .from(workOrders).where(and(eq(workOrders.propertyId, propertyId), eq(workOrders.category, category), gte(workOrders.reportedAt, since),
      ne(workOrders.status, "cancelled"), excludeWo ? ne(workOrders.id, excludeWo) : undefined))
    .orderBy(desc(workOrders.reportedAt));
}

export async function createRequest(tx: Tx, actor: Actor, input: z.input<typeof requestInput>, files: UploadFile[] = [], opts: { checklistAnswerId?: string } = {}) {
  const v = parseInput(requestInput, input);
  await assertCanReport(tx, actor, v.propertyId);
  const [prop] = await tx.select().from(properties).where(eq(properties.id, v.propertyId));
  if (!prop || prop.deletedAt) throw new NotFoundError("Villa tidak ditemukan.");
  if (v.discoveredAt && v.discoveredAt.getTime() > Date.now() + 5 * 60_000) throw new ValidationError("Waktu ditemukan tidak boleh di masa depan.");
  const history = await repeatHistory(tx, prop.id, v.category);
  const code = await nextCode(tx, "MR", { yearly: true });
  const source = v.source ?? (opts.checklistAnswerId ? "checklist" : actor.roleSlugs.some((r) => r.startsWith("cs_")) ? "cs" : actor.roleSlugs.includes("housekeeper") ? "housekeeping" : "keeper");
  const [mr] = await tx.insert(maintenanceRequests).values({
    code, propertyId: prop.id, category: v.category, description: v.description, priority: v.priority, source,
    reportedBy: actor.id, discoveredAt: v.discoveredAt ?? new Date(), checklistAnswerId: opts.checklistAnswerId ?? null, repeatCount: history.length,
  }).returning();
  if (files.length) await saveFiles(tx, actor, "maintenance_request", mr.id, files, "photo");
  await audit(tx, actor, { action: "maintenance.request_created", entityType: "property", entityId: prop.id, after: { code, category: v.category, priority: v.priority } });

  const reviewers = await usersWithPermission(tx, "maintenance.review", [actor.id]);
  await notify(tx, {
    type: "maintenance.new_request", userIds: reviewers, priority: v.priority,
    title: `${v.priority === "critical" ? "KRITIS — " : ""}Laporan maintenance: ${prop.name}`,
    body: `${CATEGORY_LABEL[v.category]} · ${v.description.slice(0, 140)} (oleh ${actor.fullName})`,
    link: `/maintenance/permintaan/${mr.id}`, entityType: "maintenance_request", entityId: mr.id,
  });
  if (v.priority === "critical") {
    await notify(tx, { type: "maintenance.critical", userIds: await gmIds(tx, [actor.id]), priority: "critical",
      title: `Masalah KRITIS di ${prop.name}`, body: `${CATEGORY_LABEL[v.category]} · ${v.description.slice(0, 140)}`,
      link: `/maintenance/permintaan/${mr.id}`, entityType: "maintenance_request", entityId: mr.id });
  }
  if (history.length >= REPEAT_THRESHOLD) {
    await notify(tx, { type: "maintenance.repeat_issue", userIds: [...reviewers, ...(await gmIds(tx, [actor.id]))], priority: "high",
      title: `Masalah berulang: ${prop.name} (${CATEGORY_LABEL[v.category]})`, body: `${history.length} kejadian dalam ${REPEAT_WINDOW_DAYS} hari terakhir.`,
      link: `/maintenance/permintaan/${mr.id}`, entityType: "maintenance_request", entityId: mr.id, dedupeKey: `repeat:${prop.id}:${v.category}`, dedupeWindowMinutes: 24 * 60 });
  }
  return mr;
}

/** Create a maintenance request from a failed checklist item (one request per item). */
export async function createRequestFromChecklist(tx: Tx, actor: Actor, answerId: string, priority: Priority, extra?: string) {
  const [a] = await tx.select({ a: checklistAnswers, s: checklistSubmissions }).from(checklistAnswers)
    .innerJoin(checklistSubmissions, eq(checklistSubmissions.id, checklistAnswers.submissionId)).where(eq(checklistAnswers.id, answerId));
  if (!a) throw new NotFoundError();
  if (a.a.answer !== "no") throw new ValidationError("Hanya item yang bermasalah yang dapat dilaporkan.");
  if (a.a.maintenanceRequestId) throw new ConflictError("Item ini sudah dilaporkan ke Engineering.");
  const { checklistTemplateItems } = await import("@/db/schema");
  const [item] = await tx.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.id, a.a.itemId));
  const category = (item?.category && (CATEGORIES as string[]).includes(item.category) ? item.category : "other") as MaintenanceCategory;
  const mr = await createRequest(tx, actor, {
    propertyId: a.s.propertyId, category, priority, source: "checklist",
    description: `[Checklist ${a.s.code}] ${a.a.label}: ${a.a.note ?? ""}${extra ? `\n${extra}` : ""}`,
  }, [], { checklistAnswerId: a.a.id });
  await tx.update(checklistAnswers).set({ maintenanceRequestId: mr.id }).where(eq(checklistAnswers.id, a.a.id));
  return mr;
}

function requestVisibility(actor: Actor, scope: "all" | string[]): SQL | undefined {
  const s = scopeOf(actor, "maintenance.view");
  if (!s) return eq(maintenanceRequests.reportedBy, actor.id);
  if (s === "own") return or(eq(maintenanceRequests.reportedBy, actor.id), sql`${maintenanceRequests.workOrderId} in (select id from work_orders where assigned_to = ${actor.id})`);
  return or(scopeFilter(maintenanceRequests.propertyId, scope) ?? sql`true`, eq(maintenanceRequests.reportedBy, actor.id));
}

export async function listRequests(tx: Tx, actor: Actor, f: { status?: string; mine?: boolean; propertyId?: string } = {}) {
  if (!can(actor, "maintenance.view") && !can(actor, "maintenance.report")) throw new ForbiddenError();
  const scope = can(actor, "maintenance.view") ? await propertyScope(tx, actor, "maintenance.view") : [];
  return tx.select({ r: maintenanceRequests, villa: properties.name, villaCode: properties.code, by: users.fullName })
    .from(maintenanceRequests).innerJoin(properties, eq(properties.id, maintenanceRequests.propertyId))
    .innerJoin(users, eq(users.id, maintenanceRequests.reportedBy))
    .where(and(requestVisibility(actor, scope),
      f.mine ? eq(maintenanceRequests.reportedBy, actor.id) : undefined,
      f.status ? eq(maintenanceRequests.status, f.status as "pending_review") : undefined,
      f.propertyId ? eq(maintenanceRequests.propertyId, f.propertyId) : undefined))
    .orderBy(sql`case ${maintenanceRequests.priority} when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`, desc(maintenanceRequests.createdAt))
    .limit(100);
}

export async function assertCanViewRequest(tx: Tx, actor: Actor, id: string) {
  const [r] = await tx.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id));
  if (!r) throw new NotFoundError("Laporan tidak ditemukan.");
  if (r.reportedBy === actor.id) return r;
  if (!can(actor, "maintenance.view")) throw new ForbiddenError();
  const scope = await propertyScope(tx, actor, "maintenance.view");
  if (scopeOf(actor, "maintenance.view") === "own") {
    if (r.workOrderId) {
      const [wo] = await tx.select({ a: workOrders.assignedTo }).from(workOrders).where(eq(workOrders.id, r.workOrderId));
      if (wo?.a === actor.id) return r;
    }
    throw new ForbiddenError();
  }
  if (scope !== "all" && !scope.includes(r.propertyId)) throw new ForbiddenError();
  return r;
}

export async function getRequest(tx: Tx, actor: Actor, id: string) {
  const r = await assertCanViewRequest(tx, actor, id);
  const [[villa], [by]] = await Promise.all([
    tx.select({ p: properties, location: locations.name }).from(properties).innerJoin(locations, eq(locations.id, properties.locationId)).where(eq(properties.id, r.propertyId)),
    tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, r.reportedBy)),
  ]);
  const photos = [...(await filesFor(tx, "maintenance_request", [r.id])), ...(r.checklistAnswerId ? await filesFor(tx, "checklist_answer", [r.checklistAnswerId]) : [])];
  const openWos = await tx.select({ id: workOrders.id, code: workOrders.code, title: workOrders.title, status: workOrders.status, category: workOrders.category })
    .from(workOrders).where(and(eq(workOrders.propertyId, r.propertyId), inArray(workOrders.status, OPEN))).orderBy(desc(workOrders.reportedAt));
  const history = await repeatHistory(tx, r.propertyId, r.category);
  return { request: r, villa: villa.p, location: villa.location, reporter: by?.fullName ?? "—", photos, openWorkOrders: openWos, history };
}

export const reviewInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("convert"),
    title: z.string().trim().min(3).max(200),
    priority: z.enum(PRIORITIES),
    assignTo: z.string().uuid().optional().or(z.literal("")),
    vendorName: z.string().trim().max(120).optional().or(z.literal("")),
    deadline: z.coerce.date().optional(),
    estimatedCost: z.coerce.number().int().min(0).optional(),
    keeperConfirmationRequired: z.boolean().default(false),
    note: z.string().trim().max(2000).optional().or(z.literal("")),
  }),
  z.object({ action: z.literal("merge"), workOrderId: z.string().uuid("Pilih work order"), note: z.string().trim().max(2000).optional().or(z.literal("")) }),
  z.object({ action: z.literal("reject"), note: z.string().trim().min(5, "Alasan penolakan wajib diisi").max(2000) }),
]);

/** Supervisor Engineer reviews a request: convert to a work order, merge into an open one, or reject. */
export async function reviewRequest(tx: Tx, actor: Actor, requestId: string, input: z.input<typeof reviewInput>) {
  requirePermission(actor, "maintenance.review");
  const v = parseInput(reviewInput, input);
  const locked = await tx.execute<{ status: string }>(sql`select status from maintenance_requests where id = ${requestId} for update`);
  if (!locked.rows.length) throw new NotFoundError("Laporan tidak ditemukan.");
  if (locked.rows[0].status !== "pending_review") throw new ConflictError("Laporan ini sudah ditinjau.");
  const [r] = await tx.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, requestId));
  const [prop] = await tx.select().from(properties).where(eq(properties.id, r.propertyId));
  const now = new Date();

  if (v.action === "reject") {
    await tx.update(maintenanceRequests).set({ status: "rejected", reviewedBy: actor.id, reviewedAt: now, reviewNote: v.note, updatedAt: now }).where(eq(maintenanceRequests.id, r.id));
    await audit(tx, actor, { action: "maintenance.request_rejected", entityType: "property", entityId: r.propertyId, after: { code: r.code, note: v.note } });
    await notify(tx, { type: "maintenance.request_rejected", userIds: [r.reportedBy].filter((x) => x !== actor.id), title: `Laporan ${r.code} tidak dilanjutkan`, body: v.note, link: `/maintenance/permintaan/${r.id}`, entityType: "maintenance_request", entityId: r.id });
    return { request: r, workOrder: null };
  }
  if (v.action === "merge") {
    const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, v.workOrderId));
    if (!wo || !OPEN.includes(wo.status) || wo.propertyId !== r.propertyId) throw new ValidationError("Work order tujuan harus masih terbuka dan di villa yang sama.");
    await tx.update(maintenanceRequests).set({ status: "merged", workOrderId: wo.id, reviewedBy: actor.id, reviewedAt: now, reviewNote: v.note || null, updatedAt: now }).where(eq(maintenanceRequests.id, r.id));
    await logUpdate(tx, actor, wo.id, "comment", null, null, `Laporan ${r.code} digabung ke work order ini: ${r.description.slice(0, 300)}`);
    await audit(tx, actor, { action: "maintenance.request_merged", entityType: "work_order", entityId: wo.id, after: { request: r.code } });
    await notify(tx, { type: "maintenance.request_merged", userIds: [r.reportedBy].filter((x) => x !== actor.id), title: `Laporan ${r.code} sudah ditangani di ${wo.code}`, link: `/maintenance/${wo.id}`, entityType: "work_order", entityId: wo.id });
    return { request: r, workOrder: wo };
  }
  const wo = await createWorkOrder(tx, actor, {
    propertyId: r.propertyId, requestId: r.id, category: r.category, title: v.title, description: r.description, priority: v.priority,
    reportedBy: r.reportedBy, reportedAt: r.discoveredAt, assignTo: v.assignTo || undefined, vendorName: v.vendorName || undefined,
    deadline: v.deadline, estimatedCost: v.estimatedCost, keeperConfirmationRequired: v.keeperConfirmationRequired, note: v.note || undefined,
    repeatIssue: r.repeatCount >= REPEAT_THRESHOLD,
  });
  await tx.update(maintenanceRequests).set({ status: "converted", workOrderId: wo.id, reviewedBy: actor.id, reviewedAt: now, reviewNote: v.note || null, updatedAt: now }).where(eq(maintenanceRequests.id, r.id));
  await notify(tx, { type: "maintenance.request_converted", userIds: [r.reportedBy].filter((x) => x !== actor.id), title: `Laporan ${r.code} → ${wo.code}`, body: `${prop.name}: ${v.title}`, link: `/maintenance/${wo.id}`, entityType: "work_order", entityId: wo.id });
  return { request: r, workOrder: wo };
}

// ================================================================== work orders
async function assertAssignable(tx: Tx, userId: string) {
  const engineers = await usersWithPermission(tx, "maintenance.work");
  if (!engineers.includes(userId)) throw new ValidationError("Penerima tugas harus karyawan aktif dengan hak mengerjakan work order (Engineer).");
}

async function logUpdate(tx: Tx, actor: Actor | null, woId: string, kind: string, from: WoStatus | null, to: WoStatus | null, note?: string | null) {
  await tx.insert(workOrderUpdates).values({ workOrderId: woId, userId: actor?.id ?? null, kind, fromStatus: from, toStatus: to, note: note ?? null });
}

type CreateWo = {
  propertyId: string; requestId?: string; pmScheduleId?: string; equipmentId?: string | null; category: MaintenanceCategory; title: string; description: string;
  priority: Priority; reportedBy: string; reportedAt?: Date; assignTo?: string; vendorName?: string; deadline?: Date; estimatedCost?: number;
  keeperConfirmationRequired?: boolean; note?: string; repeatIssue?: boolean;
};

async function createWorkOrder(tx: Tx, actor: Actor | null, w: CreateWo) {
  if (w.assignTo) await assertAssignable(tx, w.assignTo);
  const code = await nextCode(tx, "WO", { yearly: true });
  const assigned = Boolean(w.assignTo || w.vendorName);
  const now = new Date();
  const [wo] = await tx.insert(workOrders).values({
    code, propertyId: w.propertyId, requestId: w.requestId ?? null, pmScheduleId: w.pmScheduleId ?? null, equipmentId: w.equipmentId ?? null,
    category: w.category, title: w.title, description: w.description, priority: w.priority,
    status: assigned ? "assigned" : "new", reportedBy: w.reportedBy, reportedAt: w.reportedAt ?? now,
    supervisorId: actor?.id ?? null, assignedTo: w.assignTo ?? null, vendorName: w.vendorName ?? null, assignedAt: assigned ? now : null,
    deadline: w.deadline ?? (await deadlineFor(tx, w.priority, now)), estimatedCost: w.estimatedCost != null ? String(w.estimatedCost) : null,
    keeperConfirmationRequired: w.keeperConfirmationRequired ?? false, repeatIssue: w.repeatIssue ?? false,
  }).returning();
  await logUpdate(tx, actor, wo.id, "status", null, wo.status, w.note ?? (w.pmScheduleId ? "Dibuat otomatis dari jadwal preventif" : "Work order dibuat"));
  await audit(tx, actor, { action: "maintenance.wo_created", entityType: "work_order", entityId: wo.id, after: { code, status: wo.status, priority: wo.priority, assignedTo: wo.assignedTo, vendorName: wo.vendorName } });
  if (w.assignTo && w.assignTo !== actor?.id) {
    await notify(tx, { type: "maintenance.wo_assigned", userIds: [w.assignTo], priority: w.priority, title: `Work order baru untuk Anda: ${code}`, body: w.title, link: `/maintenance/${wo.id}`, entityType: "work_order", entityId: wo.id });
  }
  return wo;
}

type WoRow = typeof workOrders.$inferSelect;

async function lockWo(tx: Tx, id: string): Promise<WoRow> {
  await tx.execute(sql`select 1 from work_orders where id = ${id} for update`);
  const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, id));
  if (!wo) throw new NotFoundError("Work order tidak ditemukan.");
  return wo;
}

async function setStatus(tx: Tx, actor: Actor | null, wo: WoRow, to: WoStatus, patch: Partial<typeof workOrders.$inferInsert> = {}, note?: string | null) {
  await tx.update(workOrders).set({ ...patch, status: to, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
  await logUpdate(tx, actor, wo.id, "status", wo.status, to, note);
  await audit(tx, actor, { action: "maintenance.wo_status", entityType: "work_order", entityId: wo.id, before: { status: wo.status }, after: { status: to, note: note ?? undefined } });
}

function requireStatus(wo: WoRow, allowed: WoStatus[], action: string) {
  if (!allowed.includes(wo.status)) throw new ConflictError(`Tidak dapat ${action} saat status "${WO_STATUS_LABEL[wo.status]}".`);
}
function requireAssignee(actor: Actor, wo: WoRow) {
  requirePermission(actor, "maintenance.work");
  if (wo.assignedTo !== actor.id) throw new ForbiddenError("Hanya engineer yang ditugaskan yang dapat melakukan ini.");
}

export const assignInput = z.object({
  assignTo: z.string().uuid().optional().or(z.literal("")),
  vendorName: z.string().trim().max(120).optional().or(z.literal("")),
  deadline: z.coerce.date().optional(),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
}).refine((v) => v.assignTo || v.vendorName, { message: "Pilih engineer atau isi nama vendor eksternal" });

export async function assignWorkOrder(tx: Tx, actor: Actor, id: string, input: z.input<typeof assignInput>) {
  requirePermission(actor, "maintenance.assign");
  const v = parseInput(assignInput, input);
  const wo = await lockWo(tx, id);
  requireStatus(wo, ["new", "under_review", "assigned", "in_progress", "waiting_parts", "waiting_approval"], "menugaskan");
  if (v.assignTo) await assertAssignable(tx, v.assignTo);
  const prev = { assignedTo: wo.assignedTo, vendorName: wo.vendorName, deadline: wo.deadline };
  await tx.update(workOrders).set({
    assignedTo: v.assignTo || null, vendorName: v.vendorName || null, deadline: v.deadline ?? wo.deadline, supervisorId: wo.supervisorId ?? actor.id,
    assignedAt: new Date(), status: ["new", "under_review"].includes(wo.status) ? "assigned" : wo.status, updatedAt: new Date(),
  }).where(eq(workOrders.id, id));
  const [who] = v.assignTo ? await tx.select({ n: users.fullName }).from(users).where(eq(users.id, v.assignTo)) : [{ n: v.vendorName }];
  await logUpdate(tx, actor, id, "assignment", wo.status, ["new", "under_review"].includes(wo.status) ? "assigned" : wo.status, `Ditugaskan ke ${who?.n}${v.note ? ` — ${v.note}` : ""}`);
  await audit(tx, actor, { action: "maintenance.wo_assigned", entityType: "work_order", entityId: id, before: prev, after: { assignedTo: v.assignTo || null, vendorName: v.vendorName || null, deadline: v.deadline ?? wo.deadline } });
  if (v.assignTo && v.assignTo !== actor.id) {
    await notify(tx, { type: "maintenance.wo_assigned", userIds: [v.assignTo], priority: wo.priority, title: `Work order ditugaskan: ${wo.code}`, body: wo.title, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
  }
}

export async function changePriority(tx: Tx, actor: Actor, id: string, priority: Priority, note: string) {
  requirePermission(actor, "maintenance.review");
  if (!PRIORITIES.includes(priority)) throw new ValidationError("Prioritas tidak valid.");
  if (!note.trim()) throw new ValidationError("Alasan perubahan prioritas wajib diisi.");
  const wo = await lockWo(tx, id);
  requireStatus(wo, ACTIVE_WORK, "mengubah prioritas");
  if (wo.priority === priority) return;
  await tx.update(workOrders).set({ priority, deadline: await deadlineFor(tx, priority, new Date()), updatedAt: new Date() }).where(eq(workOrders.id, id));
  await logUpdate(tx, actor, id, "priority", null, null, `Prioritas ${PRIORITY_LABEL[wo.priority]} → ${PRIORITY_LABEL[priority]}: ${note}`);
  await audit(tx, actor, { action: "maintenance.wo_priority", entityType: "work_order", entityId: id, before: { priority: wo.priority }, after: { priority, note } });
  const escalated = PRIORITIES.indexOf(priority) < PRIORITIES.indexOf(wo.priority);
  if (escalated) {
    const ids = [wo.assignedTo, ...(priority === "critical" ? await gmIds(tx, [actor.id]) : [])].filter((x): x is string => !!x && x !== actor.id);
    await notify(tx, { type: "maintenance.wo_escalated", userIds: ids, priority, title: `Prioritas ${wo.code} dinaikkan ke ${PRIORITY_LABEL[priority]}`, body: `${wo.title} — ${note}`, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
  }
}

export async function startWork(tx: Tx, actor: Actor, id: string, files: UploadFile[] = [], note?: string) {
  const wo = await lockWo(tx, id);
  requireAssignee(actor, wo);
  requireStatus(wo, ["assigned", "waiting_parts", "waiting_approval"], "memulai pekerjaan");
  if (files.length) await saveFiles(tx, actor, "work_order", id, files, "before");
  await setStatus(tx, actor, wo, "in_progress", { startedAt: wo.startedAt ?? new Date() }, note || "Pekerjaan dimulai");
  const watchers = [wo.supervisorId, wo.reportedBy].filter((x): x is string => !!x && x !== actor.id);
  await notify(tx, { type: "maintenance.wo_started", userIds: watchers, priority: "low", title: `${wo.code} mulai dikerjakan`, body: `${actor.fullName}: ${wo.title}`, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
}

export async function setWaiting(tx: Tx, actor: Actor, id: string, to: "waiting_parts" | "waiting_approval", note: string) {
  const wo = await lockWo(tx, id);
  if (wo.assignedTo !== actor.id && !can(actor, "maintenance.assign")) throw new ForbiddenError();
  requireStatus(wo, ["in_progress", "waiting_parts", "waiting_approval"], "mengubah status");
  if (!note.trim()) throw new ValidationError("Jelaskan apa yang ditunggu.");
  await setStatus(tx, actor, wo, to, {}, note);
  if (wo.supervisorId && wo.supervisorId !== actor.id) {
    await notify(tx, { type: "maintenance.wo_waiting", userIds: [wo.supervisorId], title: `${wo.code}: ${WO_STATUS_LABEL[to]}`, body: note, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
  }
}

export async function addWoPhotos(tx: Tx, actor: Actor, id: string, kind: "before" | "after" | "finding", files: UploadFile[]) {
  const wo = await lockWo(tx, id);
  if (wo.assignedTo !== actor.id && !can(actor, "maintenance.assign")) throw new ForbiddenError("Hanya engineer yang ditugaskan atau supervisor yang dapat menambah foto.");
  requireStatus(wo, ["assigned", "in_progress", "waiting_parts", "waiting_approval", "completed"], "menambah foto");
  if (!files.length) throw new ValidationError("Pilih foto.");
  await saveFiles(tx, actor, "work_order", id, files, kind);
  await logUpdate(tx, actor, id, "comment", null, null, `${files.length} foto ${kind === "before" ? "sebelum" : kind === "after" ? "sesudah" : "temuan"} ditambahkan`);
}

export async function addComment(tx: Tx, actor: Actor, id: string, note: string) {
  await getWorkOrder(tx, actor, id); // view check
  if (!note.trim()) throw new ValidationError("Komentar kosong.");
  await logUpdate(tx, actor, id, "comment", null, null, note.trim().slice(0, 2000));
}

export const materialInput = z.object({
  description: z.string().trim().min(2).max(200),
  quantity: z.coerce.number().positive("Jumlah harus > 0"),
  unit: z.string().trim().min(1).max(20),
  unitCost: z.coerce.number().int().min(0).optional(),
});
export async function addMaterial(tx: Tx, actor: Actor, id: string, input: z.input<typeof materialInput>) {
  const v = parseInput(materialInput, input);
  const wo = await lockWo(tx, id);
  if (wo.assignedTo !== actor.id && !can(actor, "maintenance.assign")) throw new ForbiddenError();
  requireStatus(wo, ["in_progress", "waiting_parts", "waiting_approval", "completed"], "mencatat material");
  const [m] = await tx.insert(workOrderMaterials).values({ workOrderId: id, description: v.description, quantity: String(v.quantity), unit: v.unit, unitCost: v.unitCost != null ? String(v.unitCost) : null, recordedBy: actor.id }).returning();
  await logUpdate(tx, actor, id, "material", null, null, `Material: ${v.quantity} ${v.unit} ${v.description}`);
  await audit(tx, actor, { action: "maintenance.material_added", entityType: "work_order", entityId: id, after: m });
}

export const completeInput = z.object({
  findings: z.string().trim().min(5, "Isi temuan / penyebab masalah").max(4000),
  repairNotes: z.string().trim().min(5, "Isi catatan perbaikan").max(4000),
  actualCost: z.coerce.number().int().min(0).optional(),
});

/** Engineer marks the repair complete. Requires at least one BEFORE and one AFTER photo. */
export async function completeWork(tx: Tx, actor: Actor, id: string, input: z.input<typeof completeInput>, afterFiles: UploadFile[] = []) {
  const v = parseInput(completeInput, input);
  const wo = await lockWo(tx, id);
  requireAssignee(actor, wo);
  requireStatus(wo, ["in_progress"], "menyelesaikan");
  if (afterFiles.length) await saveFiles(tx, actor, "work_order", id, afterFiles, "after");
  const photos = await filesFor(tx, "work_order", [id]);
  if (!photos.some((p) => p.kind === "before")) throw new ValidationError("Unggah minimal 1 foto SEBELUM perbaikan.");
  if (!photos.some((p) => p.kind === "after")) throw new ValidationError("Unggah minimal 1 foto SESUDAH perbaikan.");
  await setStatus(tx, actor, wo, "completed", { findings: v.findings, repairNotes: v.repairNotes, actualCost: v.actualCost != null ? String(v.actualCost) : wo.actualCost, completedAt: new Date() }, "Perbaikan selesai, menunggu verifikasi");
  const verifiers = await usersWithPermission(tx, "maintenance.verify", [actor.id]);
  await notify(tx, { type: "maintenance.verification_required", userIds: verifiers, priority: wo.priority === "critical" ? "high" : "normal", title: `Verifikasi diperlukan: ${wo.code}`, body: `${wo.title} — selesai oleh ${actor.fullName}`, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
}

/** Supervisor verifies. The engineer who did the work can never verify it (also enforced by a DB CHECK). */
export async function verifyWork(tx: Tx, actor: Actor, id: string, approve: boolean, note: string) {
  requirePermission(actor, "maintenance.verify");
  const wo = await lockWo(tx, id);
  requireStatus(wo, ["completed"], "memverifikasi");
  assertNotSelf(actor.id, wo.assignedTo, "pekerjaan");
  if (!approve) {
    if (!note.trim()) throw new ValidationError("Jelaskan apa yang harus diperbaiki.");
    await setStatus(tx, actor, wo, "in_progress", { completedAt: null }, `Verifikasi ditolak: ${note}`);
    if (wo.assignedTo) await notify(tx, { type: "maintenance.verification_rejected", userIds: [wo.assignedTo], priority: wo.priority, title: `${wo.code} perlu dikerjakan ulang`, body: note, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
    return;
  }
  const now = new Date();
  if (wo.keeperConfirmationRequired) {
    await setStatus(tx, actor, wo, "verified", { verifiedAt: now, verifiedBy: actor.id }, note || "Terverifikasi, menunggu konfirmasi Villa Keeper");
    const keeper = await villaKeeperId(tx, wo.propertyId);
    if (keeper) await notify(tx, { type: "maintenance.keeper_confirmation", userIds: [keeper], title: `Mohon cek hasil perbaikan ${wo.code}`, body: wo.title, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
    return;
  }
  await setStatus(tx, actor, { ...wo }, "verified", { verifiedAt: now, verifiedBy: actor.id }, note || "Terverifikasi");
  await closeWo(tx, actor, { ...wo, status: "verified" });
}

async function closeWo(tx: Tx, actor: Actor, wo: WoRow) {
  await setStatus(tx, actor, wo, "closed", { closedAt: new Date() }, "Work order ditutup");
  if (wo.pmScheduleId) {
    const [pm] = await tx.select().from(pmSchedules).where(eq(pmSchedules.id, wo.pmScheduleId));
    if (pm) {
      const today = todayJakarta();
      const next = new Date(`${today}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + pm.intervalDays);
      await tx.update(pmSchedules).set({ lastDoneOn: today, nextDueOn: next.toISOString().slice(0, 10), updatedAt: new Date() }).where(eq(pmSchedules.id, pm.id));
    }
  }
  const ids = [wo.reportedBy, wo.assignedTo].filter((x): x is string => !!x && x !== actor.id);
  await notify(tx, { type: "maintenance.wo_closed", userIds: ids, priority: "low", title: `${wo.code} ditutup`, body: wo.title, link: `/maintenance/${wo.id}`, entityType: "work_order", entityId: wo.id });
}

/** Villa Keeper (or anyone responsible for the villa) confirms the villa is operational again. */
export async function keeperConfirm(tx: Tx, actor: Actor, id: string, ok: boolean, note: string) {
  requirePermission(actor, "maintenance.keeper_confirm");
  const wo = await lockWo(tx, id);
  requireStatus(wo, ["verified"], "mengonfirmasi");
  const rel = await villaRelation(tx, actor.id, wo.propertyId);
  const wide = scopeOf(actor, "property.view") === "all";
  if (!rel.isKeeper && !rel.isInspector && !rel.isLocationPic && !wide) throw new ForbiddenError("Hanya Villa Keeper / penanggung jawab villa ini yang dapat mengonfirmasi.");
  assertNotSelf(actor.id, wo.assignedTo, "pekerjaan");
  if (!ok) {
    if (!note.trim()) throw new ValidationError("Jelaskan kondisi yang masih bermasalah.");
    await setStatus(tx, actor, wo, "in_progress", { verifiedAt: null, verifiedBy: null, completedAt: null }, `Keeper: masih bermasalah — ${note}`);
    const ids = [wo.assignedTo, wo.supervisorId].filter((x): x is string => !!x);
    await notify(tx, { type: "maintenance.keeper_rejected", userIds: ids, priority: wo.priority === "low" ? "normal" : wo.priority, title: `${wo.code}: Keeper melaporkan masih bermasalah`, body: note, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
    return;
  }
  await tx.update(workOrders).set({ keeperConfirmedAt: new Date(), keeperConfirmedBy: actor.id }).where(eq(workOrders.id, id));
  await logUpdate(tx, actor, id, "comment", null, null, `Dikonfirmasi oleh Villa Keeper${note ? `: ${note}` : ""}`);
  await closeWo(tx, actor, wo);
}

export async function cancelWorkOrder(tx: Tx, actor: Actor, id: string, reason: string) {
  requirePermission(actor, "maintenance.review");
  if (reason.trim().length < 5) throw new ValidationError("Alasan pembatalan wajib diisi.");
  const wo = await lockWo(tx, id);
  requireStatus(wo, ACTIVE_WORK, "membatalkan");
  await setStatus(tx, actor, wo, "cancelled", { cancelledReason: reason }, `Dibatalkan: ${reason}`);
  const ids = [wo.assignedTo, wo.reportedBy].filter((x): x is string => !!x && x !== actor.id);
  await notify(tx, { type: "maintenance.wo_cancelled", userIds: ids, title: `${wo.code} dibatalkan`, body: reason, link: `/maintenance/${id}`, entityType: "work_order", entityId: id });
}

export async function setEstimatedCost(tx: Tx, actor: Actor, id: string, amount: number) {
  requirePermission(actor, "maintenance.review");
  if (!Number.isInteger(amount) || amount < 0) throw new ValidationError("Nominal tidak valid.");
  const wo = await lockWo(tx, id);
  await tx.update(workOrders).set({ estimatedCost: String(amount), updatedAt: new Date() }).where(eq(workOrders.id, id));
  await logUpdate(tx, actor, id, "cost", null, null, `Estimasi biaya: Rp${amount.toLocaleString("id-ID")}`);
  await audit(tx, actor, { action: "maintenance.wo_cost", entityType: "work_order", entityId: id, before: { estimatedCost: wo.estimatedCost }, after: { estimatedCost: amount } });
}

// ------------------------------------------------------------------ queries
function woVisibility(actor: Actor, scope: "all" | string[]): SQL | undefined {
  const s = scopeOf(actor, "maintenance.view");
  if (!s) throw new ForbiddenError();
  if (s === "own") return or(eq(workOrders.assignedTo, actor.id), eq(workOrders.reportedBy, actor.id));
  return scopeFilter(workOrders.propertyId, scope);
}

export type WoFilters = { status?: "open" | "closed" | "all" | WoStatus; priority?: string; propertyId?: string; assignee?: string; overdue?: boolean; q?: string; mine?: boolean; repeat?: boolean; page?: number };

export async function listWorkOrders(tx: Tx, actor: Actor, f: WoFilters = {}) {
  const scope = await propertyScope(tx, actor, "maintenance.view");
  const st = f.status ?? "open";
  const conds: (SQL | undefined)[] = [
    woVisibility(actor, scope),
    st === "open" ? inArray(workOrders.status, OPEN) : st === "closed" ? inArray(workOrders.status, ["closed", "cancelled"]) : st === "all" ? undefined : eq(workOrders.status, st),
    f.priority ? eq(workOrders.priority, f.priority as Priority) : undefined,
    f.propertyId ? eq(workOrders.propertyId, f.propertyId) : undefined,
    f.assignee === "none" ? and(isNull(workOrders.assignedTo), isNull(workOrders.vendorName)) : f.assignee ? eq(workOrders.assignedTo, f.assignee) : undefined,
    f.mine ? eq(workOrders.assignedTo, actor.id) : undefined,
    f.overdue ? and(lt(workOrders.deadline, new Date()), inArray(workOrders.status, ACTIVE_WORK)) : undefined,
    f.repeat ? eq(workOrders.repeatIssue, true) : undefined,
    f.q ? or(sql`${workOrders.title} ilike ${"%" + f.q + "%"}`, sql`${workOrders.code} ilike ${"%" + f.q + "%"}`) : undefined,
  ];
  const where = and(...conds);
  const page = Math.max(1, f.page ?? 1);
  const assignee = sql<string | null>`(select full_name from users u where u.id = ${workOrders.assignedTo})`;
  const [rows, [{ total }]] = await Promise.all([
    tx.select({ wo: workOrders, villa: properties.name, villaCode: properties.code, assignee })
      .from(workOrders).innerJoin(properties, eq(properties.id, workOrders.propertyId)).where(where)
      .orderBy(sql`case ${workOrders.priority} when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`, asc(workOrders.deadline))
      .limit(50).offset((page - 1) * 50),
    tx.select({ total: sql<number>`count(*)::int` }).from(workOrders).where(where),
  ]);
  return { rows, total, page, pageSize: 50 };
}

export async function assertCanViewWorkOrder(tx: Tx, actor: Actor, id: string) {
  const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, id));
  if (!wo) throw new NotFoundError("Work order tidak ditemukan.");
  if (wo.assignedTo === actor.id || wo.reportedBy === actor.id) return wo;
  const s = scopeOf(actor, "maintenance.view");
  if (!s || s === "own") throw new ForbiddenError();
  const scope = await propertyScope(tx, actor, "maintenance.view");
  if (scope !== "all" && !scope.includes(wo.propertyId)) throw new ForbiddenError("Work order ini bukan untuk villa Anda.");
  return wo;
}

export async function getWorkOrder(tx: Tx, actor: Actor, id: string) {
  const wo = await assertCanViewWorkOrder(tx, actor, id);
  const people = await tx.select({ id: users.id, fullName: users.fullName, phone: users.phone }).from(users)
    .where(inArray(users.id, [wo.assignedTo, wo.reportedBy, wo.supervisorId, wo.verifiedBy, wo.keeperConfirmedBy].filter((x): x is string => !!x)));
  const name = (uid: string | null) => people.find((p) => p.id === uid)?.fullName ?? null;
  const [[villa], updates, materials, photos, request, history, eq_] = await Promise.all([
    tx.select({ p: properties, location: locations.name }).from(properties).innerJoin(locations, eq(locations.id, properties.locationId)).where(eq(properties.id, wo.propertyId)),
    tx.select({ u: workOrderUpdates, by: users.fullName }).from(workOrderUpdates).leftJoin(users, eq(users.id, workOrderUpdates.userId)).where(eq(workOrderUpdates.workOrderId, id)).orderBy(asc(workOrderUpdates.at)),
    tx.select().from(workOrderMaterials).where(eq(workOrderMaterials.workOrderId, id)).orderBy(asc(workOrderMaterials.at)),
    filesFor(tx, "work_order", [id]),
    wo.requestId ? tx.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, wo.requestId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    repeatHistory(tx, wo.propertyId, wo.category, wo.id),
    wo.equipmentId ? tx.select().from(equipment).where(eq(equipment.id, wo.equipmentId)).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const requestPhotos = request ? [...(await filesFor(tx, "maintenance_request", [request.id])), ...(request.checklistAnswerId ? await filesFor(tx, "checklist_answer", [request.checklistAnswerId]) : [])] : [];
  const materialCost = materials.reduce((s, m) => s + Number(m.quantity) * Number(m.unitCost ?? 0), 0);
  return {
    wo, villa: villa.p, location: villa.location, updates, materials, materialCost, photos, requestPhotos, request, history, equipment: eq_,
    names: { assignee: name(wo.assignedTo), reporter: name(wo.reportedBy), supervisor: name(wo.supervisorId), verifier: name(wo.verifiedBy), keeper: name(wo.keeperConfirmedBy) },
    assigneePhone: people.find((p) => p.id === wo.assignedTo)?.phone ?? null,
    overdue: !!wo.deadline && wo.deadline.getTime() < Date.now() && ACTIVE_WORK.includes(wo.status),
  };
}

export async function engineersForPicker(tx: Tx, actor: Actor) {
  requirePermission(actor, "maintenance.assign");
  const ids = await usersWithPermission(tx, "maintenance.work");
  if (!ids.length) return [];
  return tx.select({
    id: users.id, fullName: users.fullName,
    open: sql<number>`(select count(*)::int from work_orders w where w.assigned_to = "users"."id" and w.status in ('assigned','in_progress','waiting_parts','waiting_approval'))`,
  }).from(users).where(inArray(users.id, ids)).orderBy(asc(users.fullName));
}

export async function maintenanceStats(tx: Tx, actor: Actor) {
  const scope = await propertyScope(tx, actor, "maintenance.view");
  const vis = woVisibility(actor, scope);
  const [r] = await tx.select({
    open: sql<number>`count(*) filter (where ${workOrders.status} in ('new','under_review','assigned','in_progress','waiting_parts','waiting_approval','completed','verified'))::int`,
    critical: sql<number>`count(*) filter (where ${workOrders.priority} = 'critical' and ${workOrders.status} not in ('closed','cancelled'))::int`,
    unassigned: sql<number>`count(*) filter (where ${workOrders.status} = 'new')::int`,
    overdue: sql<number>`count(*) filter (where ${workOrders.deadline} < now() and ${workOrders.status} in ('new','under_review','assigned','in_progress','waiting_parts','waiting_approval'))::int`,
    toVerify: sql<number>`count(*) filter (where ${workOrders.status} = 'completed')::int`,
    toConfirm: sql<number>`count(*) filter (where ${workOrders.status} = 'verified')::int`,
    repeat: sql<number>`count(*) filter (where ${workOrders.repeatIssue} and ${workOrders.status} not in ('closed','cancelled'))::int`,
  }).from(workOrders).where(vis);
  const pendingRequests = can(actor, "maintenance.review")
    ? (await tx.select({ c: sql<number>`count(*)::int` }).from(maintenanceRequests).where(and(eq(maintenanceRequests.status, "pending_review"), scopeFilter(maintenanceRequests.propertyId, scope))))[0].c : 0;
  return { ...r, pendingRequests };
}

// ================================================================== equipment & preventive
export const equipmentInput = z.object({
  propertyId: z.string().uuid("Pilih villa"),
  name: z.string().trim().min(2).max(120),
  category: z.enum(CATEGORIES),
  brand: z.string().trim().max(80).optional().or(z.literal("")),
  model: z.string().trim().max(80).optional().or(z.literal("")),
  serialNo: z.string().trim().max(80).optional().or(z.literal("")),
  installedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export async function createEquipment(tx: Tx, actor: Actor, input: z.input<typeof equipmentInput>) {
  requirePermission(actor, "maintenance.pm_manage");
  const v = parseInput(equipmentInput, input);
  const [e] = await tx.insert(equipment).values({ ...v, brand: v.brand || null, model: v.model || null, serialNo: v.serialNo || null, installedOn: v.installedOn || null, notes: v.notes || null }).returning();
  await audit(tx, actor, { action: "maintenance.equipment_created", entityType: "property", entityId: v.propertyId, after: e });
  return e;
}
export async function listEquipment(tx: Tx, actor: Actor, propertyId?: string) {
  const scope = await propertyScope(tx, actor, "maintenance.view");
  return tx.select({ e: equipment, villa: properties.name }).from(equipment).innerJoin(properties, eq(properties.id, equipment.propertyId))
    .where(and(eq(equipment.isActive, true), scopeFilter(equipment.propertyId, scope), propertyId ? eq(equipment.propertyId, propertyId) : undefined))
    .orderBy(asc(properties.name), asc(equipment.name));
}

export const pmInput = z.object({
  propertyId: z.string().uuid("Pilih villa"),
  equipmentId: z.string().uuid().optional().or(z.literal("")),
  title: z.string().trim().min(3).max(200),
  category: z.enum(CATEGORIES),
  intervalDays: z.coerce.number().int().min(1).max(3650),
  nextDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal jatuh tempo wajib"),
  defaultAssigneeId: z.string().uuid().optional().or(z.literal("")),
  instructions: z.string().trim().max(2000).optional().or(z.literal("")),
});
export async function createPmSchedule(tx: Tx, actor: Actor, input: z.input<typeof pmInput>) {
  requirePermission(actor, "maintenance.pm_manage");
  const v = parseInput(pmInput, input);
  if (v.defaultAssigneeId) await assertAssignable(tx, v.defaultAssigneeId);
  const [pm] = await tx.insert(pmSchedules).values({ ...v, equipmentId: v.equipmentId || null, defaultAssigneeId: v.defaultAssigneeId || null, instructions: v.instructions || null, createdBy: actor.id }).returning();
  await audit(tx, actor, { action: "maintenance.pm_created", entityType: "property", entityId: v.propertyId, after: pm });
  return pm;
}
export async function setPmActive(tx: Tx, actor: Actor, id: string, active: boolean) {
  requirePermission(actor, "maintenance.pm_manage");
  await tx.update(pmSchedules).set({ isActive: active, updatedAt: new Date() }).where(eq(pmSchedules.id, id));
  await audit(tx, actor, { action: "maintenance.pm_updated", entityType: "pm_schedule", entityId: id, after: { isActive: active } });
}
export async function listPmSchedules(tx: Tx, actor: Actor) {
  const scope = await propertyScope(tx, actor, "maintenance.view");
  return tx.select({
    pm: pmSchedules, villa: properties.name, equipment: equipment.name,
    openWo: sql<string | null>`(select w.id from work_orders w where w.pm_schedule_id = "pm_schedules"."id" and w.status not in ('closed','cancelled') limit 1)`,
  }).from(pmSchedules).innerJoin(properties, eq(properties.id, pmSchedules.propertyId)).leftJoin(equipment, eq(equipment.id, pmSchedules.equipmentId))
    .where(scopeFilter(pmSchedules.propertyId, scope)).orderBy(asc(pmSchedules.nextDueOn));
}

/** Scheduler: open a work order for every active schedule due within `leadDays` without an open WO. */
export async function generateDuePreventive(tx: Tx, leadDays = 3) {
  const horizon = new Date(`${todayJakarta()}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + leadDays);
  const due = await tx.select().from(pmSchedules).where(and(eq(pmSchedules.isActive, true), lt(pmSchedules.nextDueOn, horizon.toISOString().slice(0, 10)),
    sql`not exists (select 1 from work_orders w where w.pm_schedule_id = "pm_schedules"."id" and w.status not in ('closed','cancelled'))`));
  let created = 0;
  for (const pm of due) {
    const [p] = await tx.select({ deletedAt: properties.deletedAt }).from(properties).where(eq(properties.id, pm.propertyId));
    if (!p || p.deletedAt || !pm.createdBy) continue;
    await createWorkOrder(tx, null, {
      propertyId: pm.propertyId, pmScheduleId: pm.id, equipmentId: pm.equipmentId, category: pm.category, title: `[Preventif] ${pm.title}`,
      description: pm.instructions ?? pm.title, priority: "normal", reportedBy: pm.createdBy, assignTo: pm.defaultAssigneeId ?? undefined,
      deadline: new Date(`${pm.nextDueOn}T17:00:00+07:00`),
    });
    created++;
  }
  if (created) {
    const sup = await usersWithPermission(tx, "maintenance.assign");
    await notify(tx, { type: "maintenance.pm_generated", userIds: sup, priority: "low", title: `${created} work order preventif dibuat`, link: "/maintenance?status=open", dedupeKey: `pm:${todayJakarta()}`, dedupeWindowMinutes: 12 * 60 });
  }
  return created;
}


