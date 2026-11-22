import { parseInput } from "@/lib/validate";
import { and, eq, ilike, or, sql, asc, desc, isNull, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  properties, locations, propertyAssignments, locationAssignments, users, userRoles, roles, auditLogs, attachments,
} from "@/db/schema";
import { type Actor, requirePermission, propertyScope, scopeFilter, assertPropertyAccess } from "@/lib/authz";
import { audit, diff } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { nextCode } from "@/lib/codes";

export const PROPERTY_STATUSES = ["active", "temporarily_unavailable", "under_maintenance", "inactive"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];
export const PROPERTY_STATUS_LABEL: Record<PropertyStatus, string> = {
  active: "Aktif",
  temporarily_unavailable: "Tidak tersedia sementara",
  under_maintenance: "Dalam perbaikan",
  inactive: "Nonaktif",
};

// ------------------------------------------------------------------ locations
export const locationInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "Kode 2–12 huruf/angka"),
  name: z.string().trim().min(2).max(80),
  area: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => v || null),
  notes: z.string().trim().max(1000).optional().or(z.literal("")).transform((v) => v || null),
});

export async function listLocations(tx: Tx, actor: Actor) {
  const scope = await propertyScope(tx, actor, "property.view");
  const rows = await tx.select({
    id: locations.id, code: locations.code, name: locations.name, area: locations.area, isActive: locations.isActive, isDemo: locations.isDemo,
    villaCount: sql<number>`(select count(*)::int from properties p where p.location_id = "locations"."id" and p.deleted_at is null)`,
    pics: sql<string[]>`coalesce((select array_agg(u.full_name order by u.full_name) from location_assignments la join users u on u.id = la.user_id where la.location_id = "locations"."id" and la.kind = 'location_pic' and la.ended_at is null), '{}')`,
  }).from(locations).orderBy(asc(locations.name));
  if (scope === "all") return rows;
  const visible = await tx.selectDistinct({ id: properties.locationId }).from(properties).where(scopeFilter(properties.id, scope));
  const ids = new Set(visible.map((v) => v.id));
  return rows.filter((r) => ids.has(r.id));
}

export async function createLocation(tx: Tx, actor: Actor, input: z.input<typeof locationInput>, opts: { isDemo?: boolean } = {}) {
  requirePermission(actor, "property.manage");
  const v = parseInput(locationInput, input);
  const [dup] = await tx.select({ id: locations.id }).from(locations).where(eq(locations.code, v.code));
  if (dup) throw new ConflictError("Kode lokasi sudah digunakan.");
  const [l] = await tx.insert(locations).values({ ...v, isDemo: opts.isDemo ?? false }).returning();
  await audit(tx, actor, { action: "location.created", entityType: "location", entityId: l.id, after: l });
  return l;
}

export async function updateLocation(tx: Tx, actor: Actor, id: string, input: z.input<typeof locationInput> & { isActive?: boolean }) {
  requirePermission(actor, "property.manage");
  const v = { ...parseInput(locationInput, input), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) };
  const [cur] = await tx.select().from(locations).where(eq(locations.id, id));
  if (!cur) throw new NotFoundError("Lokasi tidak ditemukan.");
  const [dup] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.code, v.code), sql`${locations.id} <> ${id}`));
  if (dup) throw new ConflictError("Kode lokasi sudah digunakan.");
  const d = diff(cur as unknown as Record<string, unknown>, v);
  if (!d.changed) return;
  await tx.update(locations).set({ ...v, updatedAt: new Date() }).where(eq(locations.id, id));
  await audit(tx, actor, { action: "location.updated", entityType: "location", entityId: id, before: d.before, after: d.after });
}

/** Assign / end a Location PIC (or HK Team Leader) for a cluster. Grants no financial authority by itself. */
export async function assignLocationUser(tx: Tx, actor: Actor, locationId: string, userId: string, kind: "location_pic" | "hk_team_leader") {
  requirePermission(actor, "property.assign");
  const [[l], [u]] = await Promise.all([
    tx.select().from(locations).where(eq(locations.id, locationId)),
    tx.select().from(users).where(eq(users.id, userId)),
  ]);
  if (!l) throw new NotFoundError("Lokasi tidak ditemukan.");
  if (!u || !u.isActive) throw new ValidationError("Karyawan tidak ditemukan atau tidak aktif.");
  const [exists] = await tx.select().from(locationAssignments).where(and(
    eq(locationAssignments.locationId, locationId), eq(locationAssignments.userId, userId), eq(locationAssignments.kind, kind), isNull(locationAssignments.endedAt)));
  if (exists) throw new ConflictError("Karyawan sudah ditugaskan di lokasi ini.");
  const [a] = await tx.insert(locationAssignments).values({ locationId, userId, kind, assignedBy: actor.id }).returning();
  await audit(tx, actor, { action: "location.user_assigned", entityType: "location", entityId: locationId, after: { userId, user: u.fullName, kind } });
  return a;
}

export async function endLocationAssignment(tx: Tx, actor: Actor, assignmentId: string) {
  requirePermission(actor, "property.assign");
  const [a] = await tx.update(locationAssignments).set({ endedAt: new Date() })
    .where(and(eq(locationAssignments.id, assignmentId), isNull(locationAssignments.endedAt))).returning();
  if (!a) throw new NotFoundError("Penugasan tidak ditemukan.");
  await audit(tx, actor, { action: "location.user_unassigned", entityType: "location", entityId: a.locationId, before: { userId: a.userId, kind: a.kind } });
}

export async function getLocation(tx: Tx, actor: Actor, id: string) {
  requirePermission(actor, "property.view");
  const [l] = await tx.select().from(locations).where(eq(locations.id, id));
  if (!l) throw new NotFoundError("Lokasi tidak ditemukan.");
  const assigned = await tx.select({ id: locationAssignments.id, kind: locationAssignments.kind, userId: users.id, fullName: users.fullName, startedAt: locationAssignments.startedAt })
    .from(locationAssignments).innerJoin(users, eq(users.id, locationAssignments.userId))
    .where(and(eq(locationAssignments.locationId, id), isNull(locationAssignments.endedAt)));
  return { location: l, assigned };
}

// ------------------------------------------------------------------ properties
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || null);
export const propertyInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/, "Kode 2–16 huruf/angka").optional().or(z.literal("")),
  name: z.string().trim().min(2, "Nama villa wajib").max(120),
  locationId: z.string().uuid("Lokasi wajib dipilih"),
  address: optText(300),
  status: z.enum(PROPERTY_STATUSES).default("active"),
  bedrooms: z.coerce.number().int().min(0).max(50),
  bathrooms: z.coerce.number().int().min(0).max(50),
  maxGuests: z.coerce.number().int().min(0).max(200).optional().nullable(),
  notes: optText(4000),
});

export type PropertyFilters = { q?: string; locationId?: string; keeperId?: string; status?: string; page?: number; includeArchived?: boolean };
export const PROPERTY_PAGE = 50;

const keeperSql = sql<string | null>`(select u.full_name from property_assignments pa join users u on u.id = pa.user_id where pa.property_id = "properties"."id" and pa.kind = 'villa_keeper' and pa.ended_at is null limit 1)`;
const keeperIdSql = sql<string | null>`(select pa.user_id from property_assignments pa where pa.property_id = "properties"."id" and pa.kind = 'villa_keeper' and pa.ended_at is null limit 1)`;

export async function listProperties(tx: Tx, actor: Actor, f: PropertyFilters = {}) {
  const scope = await propertyScope(tx, actor, "property.view");
  const conds: (SQL | undefined)[] = [scopeFilter(properties.id, scope)];
  if (!f.includeArchived) conds.push(isNull(properties.deletedAt));
  if (f.q) conds.push(or(ilike(properties.name, `%${f.q.trim()}%`), ilike(properties.code, `%${f.q.trim()}%`)));
  if (f.locationId) conds.push(eq(properties.locationId, f.locationId));
  if (f.status && (PROPERTY_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(properties.status, f.status as PropertyStatus));
  if (f.keeperId === "none") conds.push(sql`${keeperIdSql} is null`);
  else if (f.keeperId) conds.push(sql`${keeperIdSql} = ${f.keeperId}`);
  const where = and(...conds);
  const page = Math.max(1, f.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    tx.select({
      id: properties.id, code: properties.code, name: properties.name, status: properties.status,
      bedrooms: properties.bedrooms, bathrooms: properties.bathrooms, isDemo: properties.isDemo, deletedAt: properties.deletedAt,
      locationId: locations.id, location: locations.name, keeper: keeperSql, keeperId: keeperIdSql,
    }).from(properties).innerJoin(locations, eq(locations.id, properties.locationId))
      .where(where).orderBy(asc(locations.name), asc(properties.name)).limit(PROPERTY_PAGE).offset((page - 1) * PROPERTY_PAGE),
    tx.select({ total: sql<number>`count(*)::int` }).from(properties).where(where),
  ]);
  return { rows, total, page, pageSize: PROPERTY_PAGE };
}

export async function getProperty(tx: Tx, actor: Actor, id: string) {
  await assertPropertyAccess(tx, actor, "property.view", id);
  const [p] = await tx.select({ p: properties, location: locations }).from(properties)
    .innerJoin(locations, eq(locations.id, properties.locationId)).where(eq(properties.id, id));
  if (!p) throw new NotFoundError("Villa tidak ditemukan.");
  const [assignments, pics, history, photos] = await Promise.all([
    tx.select({ id: propertyAssignments.id, kind: propertyAssignments.kind, userId: users.id, fullName: users.fullName, phone: users.phone, startedAt: propertyAssignments.startedAt, endedAt: propertyAssignments.endedAt })
      .from(propertyAssignments).innerJoin(users, eq(users.id, propertyAssignments.userId))
      .where(eq(propertyAssignments.propertyId, id)).orderBy(desc(propertyAssignments.startedAt)),
    tx.select({ userId: users.id, fullName: users.fullName }).from(locationAssignments).innerJoin(users, eq(users.id, locationAssignments.userId))
      .where(and(eq(locationAssignments.locationId, p.p.locationId), eq(locationAssignments.kind, "location_pic"), isNull(locationAssignments.endedAt))),
    tx.select({ id: auditLogs.id, action: auditLogs.action, at: auditLogs.at, before: auditLogs.before, after: auditLogs.after, user: users.fullName })
      .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId))
      .where(and(eq(auditLogs.entityType, "property"), eq(auditLogs.entityId, id))).orderBy(desc(auditLogs.at)).limit(50),
    tx.select().from(attachments).where(and(eq(attachments.entityType, "property"), eq(attachments.entityId, id), isNull(attachments.deletedAt))).orderBy(desc(attachments.createdAt)),
  ]);
  return { property: p.p, location: p.location, assignments, locationPics: pics, history, photos };
}

export async function createProperty(tx: Tx, actor: Actor, input: z.input<typeof propertyInput>, opts: { isDemo?: boolean } = {}) {
  requirePermission(actor, "property.manage");
  const v = parseInput(propertyInput, input);
  const [loc] = await tx.select().from(locations).where(eq(locations.id, v.locationId));
  if (!loc) throw new ValidationError("Lokasi tidak ditemukan.");
  const code = v.code || (await nextCode(tx, "VL"));
  const [dup] = await tx.select({ id: properties.id }).from(properties).where(eq(properties.code, code));
  if (dup) throw new ConflictError(`Kode villa ${code} sudah digunakan.`);
  const [p] = await tx.insert(properties).values({ ...v, code, isDemo: opts.isDemo ?? false }).returning();
  await audit(tx, actor, { action: "property.created", entityType: "property", entityId: p.id, after: p });
  return p;
}

export async function updateProperty(tx: Tx, actor: Actor, id: string, input: z.input<typeof propertyInput>) {
  requirePermission(actor, "property.manage");
  const v = parseInput(propertyInput, input);
  const [cur] = await tx.select().from(properties).where(eq(properties.id, id));
  if (!cur) throw new NotFoundError("Villa tidak ditemukan.");
  const next = { ...v, code: v.code || cur.code };
  const [dup] = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.code, next.code), sql`${properties.id} <> ${id}`));
  if (dup) throw new ConflictError("Kode villa sudah digunakan.");
  const d = diff(cur as unknown as Record<string, unknown>, next);
  if (!d.changed) return;
  await tx.update(properties).set({ ...next, updatedAt: new Date() }).where(eq(properties.id, id));
  await audit(tx, actor, {
    action: d.after.status !== undefined ? "property.status_changed" : "property.updated",
    entityType: "property", entityId: id, before: d.before, after: d.after,
  });
}

/** Soft archive (no hard delete). History and assignments are kept. */
export async function archiveProperty(tx: Tx, actor: Actor, id: string, archived: boolean) {
  requirePermission(actor, "property.manage");
  const [cur] = await tx.select().from(properties).where(eq(properties.id, id));
  if (!cur) throw new NotFoundError("Villa tidak ditemukan.");
  if (Boolean(cur.deletedAt) === archived) return;
  await tx.update(properties).set({ deletedAt: archived ? new Date() : null, status: archived ? "inactive" : cur.status, updatedAt: new Date() }).where(eq(properties.id, id));
  await audit(tx, actor, { action: archived ? "property.archived" : "property.restored", entityType: "property", entityId: id, before: { status: cur.status, deletedAt: cur.deletedAt }, after: { archived } });
}

/** Assign a Villa Keeper (replaces the current one) or add an inspector. */
export async function assignPropertyUser(tx: Tx, actor: Actor, propertyId: string, userId: string, kind: "villa_keeper" | "inspector") {
  requirePermission(actor, "property.assign");
  const [[p], [u]] = await Promise.all([
    tx.select().from(properties).where(eq(properties.id, propertyId)),
    tx.select().from(users).where(eq(users.id, userId)),
  ]);
  if (!p || p.deletedAt) throw new NotFoundError("Villa tidak ditemukan.");
  if (!u || !u.isActive) throw new ValidationError("Karyawan tidak ditemukan atau tidak aktif.");
  if (kind === "villa_keeper") {
    const hasRole = await tx.select({ s: roles.slug }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), inArray(roles.slug, ["villa_keeper", "supervisor_villa", "location_pic"])));
    if (!hasRole.length) throw new ValidationError("Karyawan harus memiliki peran Villa Keeper / PIC Lokasi / Supervisor Villa.");
  }
  // Lock existing active rows to avoid two concurrent keeper assignments.
  const active = await tx.execute<{ id: string; user_id: string }>(sql`
    select id, user_id from property_assignments
    where property_id = ${propertyId} and kind = ${kind} and ended_at is null for update`);
  if (active.rows.some((r) => r.user_id === userId)) throw new ConflictError("Karyawan sudah ditugaskan di villa ini.");
  let replaced: string | null = null;
  if (kind === "villa_keeper" && active.rows.length) {
    replaced = active.rows[0].user_id;
    await tx.update(propertyAssignments).set({ endedAt: new Date() }).where(inArray(propertyAssignments.id, active.rows.map((r) => r.id)));
  }
  const [a] = await tx.insert(propertyAssignments).values({ propertyId, userId, kind, assignedBy: actor.id }).returning();
  await audit(tx, actor, { action: "property.user_assigned", entityType: "property", entityId: propertyId, before: replaced ? { userId: replaced, kind } : null, after: { userId, user: u.fullName, kind } });
  return a;
}

export async function endPropertyAssignment(tx: Tx, actor: Actor, assignmentId: string) {
  requirePermission(actor, "property.assign");
  const [a] = await tx.update(propertyAssignments).set({ endedAt: new Date() })
    .where(and(eq(propertyAssignments.id, assignmentId), isNull(propertyAssignments.endedAt))).returning();
  if (!a) throw new NotFoundError("Penugasan tidak ditemukan.");
  await audit(tx, actor, { action: "property.user_unassigned", entityType: "property", entityId: a.propertyId, before: { userId: a.userId, kind: a.kind } });
}

export async function propertyStats(tx: Tx, actor: Actor) {
  const scope = await propertyScope(tx, actor, "property.view");
  const rows = await tx.select({ status: properties.status, c: sql<number>`count(*)::int` }).from(properties)
    .where(and(isNull(properties.deletedAt), scopeFilter(properties.id, scope))).groupBy(properties.status);
  const [noKeeper] = await tx.select({ c: sql<number>`count(*)::int` }).from(properties)
    .where(and(isNull(properties.deletedAt), scopeFilter(properties.id, scope), sql`${keeperIdSql} is null`));
  return { byStatus: Object.fromEntries(rows.map((r) => [r.status, r.c])) as Record<PropertyStatus, number>, withoutKeeper: noKeeper.c };
}
