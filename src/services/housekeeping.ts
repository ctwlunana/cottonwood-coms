import { and, asc, desc, eq, inArray, isNull, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  hkTeams, hkTeamMembers, hkAssignments, hkAssignmentStaff, hkInspections, hkEvents, properties, users, locations,
  propertyAssignments, locationAssignments,
} from "@/db/schema";
import { type Actor, requirePermission, propertyScope, scopeFilter, scopeOf, can } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validate";
import { notify, usersWithPermission } from "@/lib/notify";
import { HK_STATUS_LABEL, PRIORITIES, type HkStatus } from "@/lib/labels";
import { saveFiles, filesFor, type UploadFile } from "./attachments";
import { villaRelation } from "./villa-relations";

const CLOSED: HkStatus[] = ["ready", "cancelled"];

// ------------------------------------------------------------------ teams
export async function listTeams(tx: Tx, actor: Actor) {
  requirePermission(actor, "housekeeping.view");
  return tx.select({
    t: hkTeams, location: locations.name,
    leader: sql<string | null>`(select full_name from users u where u.id = "hk_teams"."leader_id")`,
    members: sql<{ id: string; name: string }[]>`coalesce((select json_agg(json_build_object('id', u.id, 'name', u.full_name) order by u.full_name) from hk_team_members m join users u on u.id = m.user_id where m.team_id = "hk_teams"."id" and u.is_active), '[]')`,
  }).from(hkTeams).leftJoin(locations, eq(locations.id, hkTeams.locationId)).where(eq(hkTeams.isActive, true)).orderBy(asc(hkTeams.name));
}

async function assertHousekeepers(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const workers = await usersWithPermission(tx, "housekeeping.work");
  const bad = ids.filter((i) => !workers.includes(i));
  if (bad.length) throw new ValidationError("Semua petugas harus karyawan aktif dengan peran Housekeeper / Team Leader.");
}

export const teamInput = z.object({
  name: z.string().trim().min(2).max(80),
  locationId: z.string().uuid().optional().or(z.literal("")),
  leaderId: z.string().uuid().optional().or(z.literal("")),
  memberIds: z.array(z.string().uuid()).default([]),
});
export async function saveTeam(tx: Tx, actor: Actor, id: string | null, input: z.input<typeof teamInput>) {
  requirePermission(actor, "housekeeping.team_manage");
  const v = parseInput(teamInput, input);
  await assertHousekeepers(tx, [...v.memberIds, ...(v.leaderId ? [v.leaderId] : [])]);
  let teamId = id;
  if (teamId) {
    await tx.update(hkTeams).set({ name: v.name, locationId: v.locationId || null, leaderId: v.leaderId || null, updatedAt: new Date() }).where(eq(hkTeams.id, teamId));
  } else {
    teamId = (await tx.insert(hkTeams).values({ name: v.name, locationId: v.locationId || null, leaderId: v.leaderId || null }).returning())[0].id;
  }
  await tx.delete(hkTeamMembers).where(eq(hkTeamMembers.teamId, teamId));
  if (v.memberIds.length) await tx.insert(hkTeamMembers).values([...new Set(v.memberIds)].map((userId) => ({ teamId: teamId!, userId })));
  await audit(tx, actor, { action: id ? "housekeeping.team_updated" : "housekeeping.team_created", entityType: "hk_team", entityId: teamId, after: v });
  return teamId;
}

// ------------------------------------------------------------------ assignments
async function logEvent(tx: Tx, actor: Actor | null, id: string, from: HkStatus | null, to: HkStatus | null, note?: string | null) {
  await tx.insert(hkEvents).values({ assignmentId: id, userId: actor?.id ?? null, fromStatus: from, toStatus: to, note: note ?? null });
}

type HkRow = typeof hkAssignments.$inferSelect;
async function lock(tx: Tx, id: string): Promise<HkRow> {
  await tx.execute(sql`select 1 from hk_assignments where id = ${id} for update`);
  const [a] = await tx.select().from(hkAssignments).where(eq(hkAssignments.id, id));
  if (!a) throw new NotFoundError("Penugasan tidak ditemukan.");
  return a;
}
async function staffOf(tx: Tx, id: string) {
  return (await tx.select({ id: hkAssignmentStaff.userId }).from(hkAssignmentStaff).where(eq(hkAssignmentStaff.assignmentId, id))).map((r) => r.id);
}
async function setStatus(tx: Tx, actor: Actor, a: HkRow, to: HkStatus, patch: Partial<typeof hkAssignments.$inferInsert> = {}, note?: string | null) {
  await tx.update(hkAssignments).set({ ...patch, status: to, updatedAt: new Date() }).where(eq(hkAssignments.id, a.id));
  await logEvent(tx, actor, a.id, a.status, to, note);
  await audit(tx, actor, { action: "housekeeping.status", entityType: "hk_assignment", entityId: a.id, before: { status: a.status }, after: { status: to, note: note ?? undefined } });
}
function requireStatus(a: HkRow, allowed: HkStatus[], what: string) {
  if (!allowed.includes(a.status)) throw new ConflictError(`Tidak dapat ${what} saat status "${HK_STATUS_LABEL[a.status]}".`);
}

/** Who may inspect readiness (business rule Nov 2026): the villa's Keeper, an assigned inspector, or an HK Team Leader (of the location or of the assigned team). */
async function inspectorsFor(tx: Tx, a: HkRow): Promise<string[]> {
  const [p] = await tx.select({ locationId: properties.locationId }).from(properties).where(eq(properties.id, a.propertyId));
  const pa = await tx.select({ id: propertyAssignments.userId }).from(propertyAssignments)
    .where(and(eq(propertyAssignments.propertyId, a.propertyId), isNull(propertyAssignments.endedAt)));
  const la = await tx.select({ id: locationAssignments.userId }).from(locationAssignments)
    .where(and(eq(locationAssignments.locationId, p.locationId), eq(locationAssignments.kind, "hk_team_leader"), isNull(locationAssignments.endedAt)));
  const team = a.teamId ? (await tx.select({ id: hkTeams.leaderId }).from(hkTeams).where(eq(hkTeams.id, a.teamId)))[0]?.id : null;
  const staff = await staffOf(tx, a.id);
  return [...new Set([...pa.map((x) => x.id), ...la.map((x) => x.id), ...(team ? [team] : [])])].filter((id) => !staff.includes(id));
}

async function canInspect(tx: Tx, actor: Actor, a: HkRow): Promise<string | null> {
  const staff = await staffOf(tx, a.id);
  if (staff.includes(actor.id)) return "Petugas yang membersihkan tidak boleh menginspeksi pekerjaannya sendiri.";
  const rel = await villaRelation(tx, actor.id, a.propertyId);
  const teamLeader = a.teamId ? (await tx.select({ id: hkTeams.leaderId }).from(hkTeams).where(eq(hkTeams.id, a.teamId)))[0]?.id === actor.id : false;
  if (rel.isInspector) return null; // explicitly assigned inspector of this villa
  if (!can(actor, "housekeeping.inspect")) return "Anda tidak memiliki hak inspeksi kesiapan villa.";
  if (rel.isKeeper || rel.isHkLeader || teamLeader) return null;
  return "Hanya Villa Keeper villa ini, inspektur yang ditugaskan, atau Team Leader Housekeeping yang dapat menyatakan villa siap.";
}

export const assignmentInput = z.object({
  propertyId: z.string().uuid("Pilih villa"),
  checkoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal checkout wajib"),
  expectedDoneAt: z.coerce.date({ message: "Target selesai wajib" }),
  teamId: z.string().uuid().optional().or(z.literal("")),
  priority: z.enum(PRIORITIES).default("normal"),
  instructions: z.string().trim().max(2000).optional().or(z.literal("")),
  staffIds: z.array(z.string().uuid()).default([]),
});

export async function createAssignment(tx: Tx, actor: Actor, input: z.input<typeof assignmentInput>) {
  requirePermission(actor, "housekeeping.schedule");
  const v = parseInput(assignmentInput, input);
  const [prop] = await tx.select().from(properties).where(eq(properties.id, v.propertyId));
  if (!prop || prop.deletedAt) throw new NotFoundError("Villa tidak ditemukan.");
  const dup = await tx.select({ code: hkAssignments.code }).from(hkAssignments)
    .where(and(eq(hkAssignments.propertyId, v.propertyId), eq(hkAssignments.checkoutDate, v.checkoutDate), notInArray(hkAssignments.status, ["cancelled"])));
  if (dup.length) throw new ConflictError(`Sudah ada penugasan ${dup[0].code} untuk villa ini pada tanggal tersebut.`);
  await assertHousekeepers(tx, v.staffIds);
  const code = await nextCode(tx, "HK", { yearly: true });
  const [a] = await tx.insert(hkAssignments).values({
    code, propertyId: v.propertyId, checkoutDate: v.checkoutDate, expectedDoneAt: v.expectedDoneAt, teamId: v.teamId || null,
    priority: v.priority, instructions: v.instructions || null, status: v.staffIds.length ? "assigned" : "pending", createdBy: actor.id,
  }).returning();
  if (v.staffIds.length) await tx.insert(hkAssignmentStaff).values([...new Set(v.staffIds)].map((userId) => ({ assignmentId: a.id, userId, assignedBy: actor.id })));
  await logEvent(tx, actor, a.id, null, a.status, "Penugasan dibuat");
  await audit(tx, actor, { action: "housekeeping.assignment_created", entityType: "hk_assignment", entityId: a.id, after: { code, villa: prop.name, staff: v.staffIds.length } });
  const leader = a.teamId ? (await tx.select({ id: hkTeams.leaderId }).from(hkTeams).where(eq(hkTeams.id, a.teamId)))[0]?.id : null;
  await notify(tx, {
    type: "housekeeping.new_assignment", userIds: [...v.staffIds, ...(leader ? [leader] : [])].filter((x) => x !== actor.id), priority: v.priority,
    title: `Tugas pembersihan: ${prop.name}`, body: `Target selesai ${v.expectedDoneAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}`,
    link: `/housekeeping/${a.id}`, entityType: "hk_assignment", entityId: a.id,
  });
  return a;
}

export async function assignStaff(tx: Tx, actor: Actor, id: string, staffIds: string[]) {
  requirePermission(actor, "housekeeping.assign");
  const a = await lock(tx, id);
  await assertCanView(tx, actor, a);
  requireStatus(a, ["pending", "assigned", "inspection_failed", "reclean_required"], "mengubah petugas");
  if (!staffIds.length) throw new ValidationError("Pilih minimal satu petugas.");
  await assertHousekeepers(tx, staffIds);
  const before = await staffOf(tx, id);
  await tx.delete(hkAssignmentStaff).where(eq(hkAssignmentStaff.assignmentId, id));
  await tx.insert(hkAssignmentStaff).values([...new Set(staffIds)].map((userId) => ({ assignmentId: id, userId, assignedBy: actor.id })));
  if (a.status === "pending") await setStatus(tx, actor, a, "assigned", {}, "Petugas ditugaskan");
  else await logEvent(tx, actor, id, null, null, "Petugas diubah");
  await audit(tx, actor, { action: "housekeeping.staff_changed", entityType: "hk_assignment", entityId: id, before: { staff: before }, after: { staff: staffIds } });
  const added = staffIds.filter((s) => !before.includes(s));
  const [p] = await tx.select({ name: properties.name }).from(properties).where(eq(properties.id, a.propertyId));
  await notify(tx, { type: "housekeeping.new_assignment", userIds: added, priority: a.priority, title: `Tugas pembersihan: ${p.name}`, link: `/housekeeping/${id}`, entityType: "hk_assignment", entityId: id });
  const removed = before.filter((s) => !staffIds.includes(s));
  await notify(tx, { type: "housekeeping.assignment_changed", userIds: removed, title: `Anda tidak lagi ditugaskan di ${p.name}`, link: `/housekeeping/${id}`, entityType: "hk_assignment", entityId: id });
}

export async function updateAssignment(tx: Tx, actor: Actor, id: string, v: { expectedDoneAt?: Date; priority?: (typeof PRIORITIES)[number]; instructions?: string }) {
  requirePermission(actor, "housekeeping.schedule");
  const a = await lock(tx, id);
  requireStatus(a, ["pending", "assigned", "in_progress", "reclean_required", "inspection_failed"], "mengubah penugasan");
  const patch = { expectedDoneAt: v.expectedDoneAt ?? a.expectedDoneAt, priority: v.priority ?? a.priority, instructions: v.instructions ?? a.instructions, updatedAt: new Date() };
  await tx.update(hkAssignments).set(patch).where(eq(hkAssignments.id, id));
  await logEvent(tx, actor, id, null, null, "Detail penugasan diubah");
  await audit(tx, actor, { action: "housekeeping.assignment_updated", entityType: "hk_assignment", entityId: id, before: { expectedDoneAt: a.expectedDoneAt, priority: a.priority, instructions: a.instructions }, after: patch });
  await notify(tx, { type: "housekeeping.assignment_changed", userIds: (await staffOf(tx, id)).filter((x) => x !== actor.id), title: `Penugasan ${a.code} diubah`, body: "Periksa target waktu & instruksi terbaru.", link: `/housekeeping/${id}`, entityType: "hk_assignment", entityId: id });
}

async function requireStaff(tx: Tx, actor: Actor, a: HkRow) {
  requirePermission(actor, "housekeeping.work");
  if (!(await staffOf(tx, a.id)).includes(actor.id)) throw new ForbiddenError("Anda tidak ditugaskan pada pembersihan ini.");
}

export async function startCleaning(tx: Tx, actor: Actor, id: string) {
  const a = await lock(tx, id);
  await requireStaff(tx, actor, a);
  requireStatus(a, ["assigned", "reclean_required"], "memulai pembersihan");
  await setStatus(tx, actor, a, "in_progress", { startedAt: a.startedAt ?? new Date() }, a.status === "reclean_required" ? "Pembersihan ulang dimulai" : "Pembersihan dimulai");
}

/** Housekeeper finishes cleaning (photos required). This NEVER makes the villa ready — it requests an inspection. */
export async function completeCleaning(tx: Tx, actor: Actor, id: string, note: string, files: UploadFile[]) {
  const a = await lock(tx, id);
  await requireStaff(tx, actor, a);
  requireStatus(a, ["in_progress"], "menyelesaikan pembersihan");
  if (!files.length) throw new ValidationError("Unggah minimal 1 foto hasil pembersihan.");
  await saveFiles(tx, actor, "hk_assignment", id, files, "completion");
  await setStatus(tx, actor, a, "cleaning_completed", { cleaningCompletedAt: new Date() }, note || "Pembersihan selesai");
  await setStatus(tx, actor, { ...a, status: "cleaning_completed" }, "inspection_required", {}, "Menunggu inspeksi kesiapan");
  const [p] = await tx.select({ name: properties.name }).from(properties).where(eq(properties.id, a.propertyId));
  await notify(tx, { type: "housekeeping.cleaning_completed", userIds: await inspectorsFor(tx, a), priority: a.priority, title: `Inspeksi diperlukan: ${p.name}`, body: `Pembersihan selesai oleh ${actor.fullName}.`, link: `/housekeeping/${id}`, entityType: "hk_assignment", entityId: id });
}

/** Readiness inspection. Pass ⇒ villa READY (only path to ready; also enforced by a DB trigger). Fail needs notes + photo. */
export async function inspect(tx: Tx, actor: Actor, id: string, result: "pass" | "fail", notes: string, files: UploadFile[] = []) {
  const a = await lock(tx, id);
  requireStatus(a, ["inspection_required"], "menginspeksi");
  const why = await canInspect(tx, actor, a);
  if (why) throw new ForbiddenError(why);
  if (result === "fail" && (!notes.trim() || !files.length)) throw new ValidationError("Inspeksi gagal wajib disertai catatan dan minimal 1 foto.");
  const [ins] = await tx.insert(hkInspections).values({ assignmentId: id, inspectorId: actor.id, result, notes: notes.trim() || null }).returning();
  if (files.length) await saveFiles(tx, actor, "hk_inspection", ins.id, files, "inspection");
  const [p] = await tx.select({ name: properties.name }).from(properties).where(eq(properties.id, a.propertyId));
  const staff = await staffOf(tx, id);
  const coordinators = await usersWithPermission(tx, "housekeeping.schedule", [actor.id]);
  if (result === "pass") {
    await setStatus(tx, actor, a, "ready", { readyAt: new Date() }, notes || "Inspeksi lulus — villa siap untuk tamu");
    await notify(tx, { type: "housekeeping.villa_ready", userIds: [...staff, ...coordinators], priority: "low", title: `${p.name} SIAP untuk tamu`, body: `Diinspeksi oleh ${actor.fullName}.`, link: `/housekeeping/${id}`, entityType: "hk_assignment", entityId: id });
  } else {
    await setStatus(tx, actor, a, "inspection_failed", {}, `Inspeksi gagal: ${notes}`);
    const leader = a.teamId ? (await tx.select({ id: hkTeams.leaderId }).from(hkTeams).where(eq(hkTeams.id, a.teamId)))[0]?.id : null;
    await notify(tx, { type: "housekeeping.inspection_failed", userIds: [...staff, ...coordinators, ...(leader ? [leader] : [])].filter((x) => x !== actor.id), priority: "high", title: `Inspeksi GAGAL: ${p.name}`, body: notes, link: `/housekeeping/${id}`, entityType: "hk_assignment", entityId: id });
  }
}

export async function requestReclean(tx: Tx, actor: Actor, id: string, note: string, staffIds?: string[]) {
  requirePermission(actor, "housekeeping.assign");
  const a = await lock(tx, id);
  requireStatus(a, ["inspection_failed"], "meminta pembersihan ulang");
  if (staffIds?.length) await assignStaff(tx, actor, id, staffIds);
  await setStatus(tx, actor, a, "reclean_required", { recleanCount: a.recleanCount + 1 }, note || "Perlu dibersihkan ulang");
  const [p] = await tx.select({ name: properties.name }).from(properties).where(eq(properties.id, a.propertyId));
  await notify(tx, { type: "housekeeping.reclean_required", userIds: (await staffOf(tx, id)).filter((x) => x !== actor.id), priority: "high", title: `Bersihkan ulang: ${p.name}`, body: note, link: `/housekeeping/${id}`, entityType: "hk_assignment", entityId: id });
}

export async function cancelAssignment(tx: Tx, actor: Actor, id: string, reason: string) {
  requirePermission(actor, "housekeeping.schedule");
  if (reason.trim().length < 5) throw new ValidationError("Alasan pembatalan wajib diisi.");
  const a = await lock(tx, id);
  if (CLOSED.includes(a.status)) throw new ConflictError("Penugasan sudah selesai / dibatalkan.");
  await setStatus(tx, actor, a, "cancelled", { cancelledReason: reason }, `Dibatalkan: ${reason}`);
  await notify(tx, { type: "housekeeping.assignment_changed", userIds: (await staffOf(tx, id)).filter((x) => x !== actor.id), title: `Penugasan ${a.code} dibatalkan`, body: reason, link: `/housekeeping/${id}`, entityType: "hk_assignment", entityId: id });
}

// ------------------------------------------------------------------ queries
function visibility(actor: Actor, scope: "all" | string[]): SQL | undefined {
  const s = scopeOf(actor, "housekeeping.view");
  if (!s) throw new ForbiddenError();
  if (s === "own") return sql`exists (select 1 from hk_assignment_staff st where st.assignment_id = "hk_assignments"."id" and st.user_id = ${actor.id})`;
  return scopeFilter(hkAssignments.propertyId, scope);
}

async function assertCanView(tx: Tx, actor: Actor, a: HkRow) {
  const s = scopeOf(actor, "housekeeping.view");
  if (!s) throw new ForbiddenError();
  if ((await staffOf(tx, a.id)).includes(actor.id)) return;
  if (s === "own") throw new ForbiddenError();
  const scope = await propertyScope(tx, actor, "housekeeping.view");
  if (scope !== "all" && !scope.includes(a.propertyId)) throw new ForbiddenError("Penugasan ini bukan untuk villa Anda.");
}
export async function assertCanViewAssignment(tx: Tx, actor: Actor, id: string) {
  const [a] = await tx.select().from(hkAssignments).where(eq(hkAssignments.id, id));
  if (!a) throw new NotFoundError();
  await assertCanView(tx, actor, a);
}
export async function assertCanViewInspection(tx: Tx, actor: Actor, inspectionId: string) {
  const [i] = await tx.select({ a: hkInspections.assignmentId }).from(hkInspections).where(eq(hkInspections.id, inspectionId));
  if (!i) throw new NotFoundError();
  await assertCanViewAssignment(tx, actor, i.a);
}

export type HkFilters = { date?: string; status?: string; propertyId?: string; mine?: boolean; open?: boolean };

export async function listAssignments(tx: Tx, actor: Actor, f: HkFilters = {}) {
  const scope = await propertyScope(tx, actor, "housekeeping.view");
  const staffNames = sql<string[]>`coalesce((select array_agg(u.full_name order by u.full_name) from hk_assignment_staff st join users u on u.id = st.user_id where st.assignment_id = "hk_assignments"."id"), '{}')`;
  return tx.select({ a: hkAssignments, villa: properties.name, villaCode: properties.code, location: locations.name, staff: staffNames, team: hkTeams.name })
    .from(hkAssignments).innerJoin(properties, eq(properties.id, hkAssignments.propertyId)).innerJoin(locations, eq(locations.id, properties.locationId))
    .leftJoin(hkTeams, eq(hkTeams.id, hkAssignments.teamId))
    .where(and(visibility(actor, scope),
      f.date ? eq(hkAssignments.checkoutDate, f.date) : undefined,
      f.status ? eq(hkAssignments.status, f.status as HkStatus) : undefined,
      f.open ? notInArray(hkAssignments.status, CLOSED) : undefined,
      f.propertyId ? eq(hkAssignments.propertyId, f.propertyId) : undefined,
      f.mine ? sql`exists (select 1 from hk_assignment_staff st where st.assignment_id = "hk_assignments"."id" and st.user_id = ${actor.id})` : undefined))
    .orderBy(sql`case ${hkAssignments.priority} when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`, asc(hkAssignments.expectedDoneAt))
    .limit(200);
}

export async function getAssignment(tx: Tx, actor: Actor, id: string) {
  const [row] = await tx.select({ a: hkAssignments, villa: properties, location: locations.name, team: hkTeams.name, teamLeaderId: hkTeams.leaderId })
    .from(hkAssignments).innerJoin(properties, eq(properties.id, hkAssignments.propertyId)).innerJoin(locations, eq(locations.id, properties.locationId))
    .leftJoin(hkTeams, eq(hkTeams.id, hkAssignments.teamId)).where(eq(hkAssignments.id, id));
  if (!row) throw new NotFoundError("Penugasan tidak ditemukan.");
  await assertCanView(tx, actor, row.a);
  const [staff, events, inspections, photos] = await Promise.all([
    tx.select({ id: users.id, fullName: users.fullName }).from(hkAssignmentStaff).innerJoin(users, eq(users.id, hkAssignmentStaff.userId)).where(eq(hkAssignmentStaff.assignmentId, id)),
    tx.select({ e: hkEvents, by: users.fullName }).from(hkEvents).leftJoin(users, eq(users.id, hkEvents.userId)).where(eq(hkEvents.assignmentId, id)).orderBy(asc(hkEvents.at)),
    tx.select({ i: hkInspections, by: users.fullName }).from(hkInspections).innerJoin(users, eq(users.id, hkInspections.inspectorId)).where(eq(hkInspections.assignmentId, id)).orderBy(desc(hkInspections.at)),
    filesFor(tx, "hk_assignment", [id]),
  ]);
  const inspectionPhotos = await filesFor(tx, "hk_inspection", inspections.map((i) => i.i.id));
  const inspectBlocker = row.a.status === "inspection_required" ? await canInspect(tx, actor, row.a) : "n/a";
  return {
    ...row, staff, events, inspections, photos, inspectionPhotos,
    canInspect: inspectBlocker === null, isStaff: staff.some((s) => s.id === actor.id),
    overdue: !CLOSED.includes(row.a.status) && row.a.expectedDoneAt.getTime() < Date.now(),
  };
}

/** Daily board: counts by status and manpower for a date. */
export async function dailySummary(tx: Tx, actor: Actor, date: string) {
  const list = await listAssignments(tx, actor, { date });
  const byStatus: Partial<Record<HkStatus, number>> = {};
  list.forEach((r) => { byStatus[r.a.status] = (byStatus[r.a.status] ?? 0) + 1; });
  let manpower: { id: string; fullName: string; tasks: number }[] = [];
  if (scopeOf(actor, "housekeeping.view") !== "own") {
    const workers = await usersWithPermission(tx, "housekeeping.work");
    manpower = workers.length ? await tx.select({
      id: users.id, fullName: users.fullName,
      tasks: sql<number>`(select count(*)::int from hk_assignment_staff st join hk_assignments a on a.id = st.assignment_id where st.user_id = "users"."id" and a.checkout_date = ${date} and a.status <> 'cancelled')`,
    }).from(users).where(inArray(users.id, workers)).orderBy(asc(users.fullName)) : [];
  }
  return { list, byStatus, manpower };
}

/** Metrics for a date range: completion, re-clean rate, on-time readiness, per-housekeeper output. */
export async function housekeepingMetrics(tx: Tx, actor: Actor, from: string, to: string) {
  const scope = await propertyScope(tx, actor, "housekeeping.view");
  const where = and(visibility(actor, scope), sql`${hkAssignments.checkoutDate} between ${from} and ${to}`, sql`${hkAssignments.status} <> 'cancelled'`);
  const [m] = await tx.select({
    total: sql<number>`count(*)::int`,
    ready: sql<number>`count(*) filter (where ${hkAssignments.status} = 'ready')::int`,
    recleaned: sql<number>`count(*) filter (where ${hkAssignments.recleanCount} > 0)::int`,
    onTime: sql<number>`count(*) filter (where ${hkAssignments.readyAt} <= ${hkAssignments.expectedDoneAt})::int`,
    failedInspections: sql<number>`(select count(*)::int from hk_inspections i join hk_assignments a2 on a2.id = i.assignment_id where i.result = 'fail' and a2.checkout_date between ${from} and ${to})`,
  }).from(hkAssignments).where(where);
  const perStaff = await tx.select({
    fullName: users.fullName,
    done: sql<number>`count(*) filter (where ${hkAssignments.cleaningCompletedAt} is not null)::int`,
    recleaned: sql<number>`count(*) filter (where ${hkAssignments.recleanCount} > 0)::int`,
  }).from(hkAssignmentStaff).innerJoin(hkAssignments, eq(hkAssignments.id, hkAssignmentStaff.assignmentId)).innerJoin(users, eq(users.id, hkAssignmentStaff.userId))
    .where(where).groupBy(users.fullName).orderBy(desc(sql`count(*)`));
  return { ...m, perStaff };
}

/** Latest housekeeping state per villa (for villa pages / readiness). */
export async function latestForProperty(tx: Tx, propertyId: string) {
  return tx.select().from(hkAssignments).where(eq(hkAssignments.propertyId, propertyId)).orderBy(desc(hkAssignments.checkoutDate), desc(hkAssignments.createdAt)).limit(10);
}

export async function overdueAssignments(tx: Tx) {
  return tx.select({ a: hkAssignments, villa: properties.name }).from(hkAssignments).innerJoin(properties, eq(properties.id, hkAssignments.propertyId))
    .where(and(notInArray(hkAssignments.status, CLOSED), lt(hkAssignments.expectedDoneAt, new Date())));
}
export { inspectorsFor };
