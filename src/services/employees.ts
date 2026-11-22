import { parseInput } from "@/lib/validate";
import { and, eq, ilike, or, sql, asc, isNull, inArray, desc, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  users, departments, userRoles, roles, propertyAssignments, locationAssignments, properties, locations,
  passwordResetRequests,
} from "@/db/schema";
import { type Actor, requirePermission, scopeOf, can } from "@/lib/authz";
import { audit, diff } from "@/lib/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashPassword, tempPassword } from "@/lib/crypto";
import { revokeAllSessions } from "./auth";
import { setUserRoles } from "./rbac";

const optStr = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || null);

export const employeeInput = z.object({
  employeeCode: z.string().trim().min(1, "Kode karyawan wajib").max(30),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "Username 3–40 karakter: huruf kecil, angka, titik, - atau _"),
  fullName: z.string().trim().min(2, "Nama wajib diisi").max(120),
  email: z.string().trim().email("Email tidak valid").optional().or(z.literal("")).transform((v) => v || null),
  phone: optStr(30),
  jobTitle: optStr(80),
  departmentId: z.string().uuid("Departemen wajib dipilih"),
});

export type EmployeeFilters = { q?: string; departmentId?: string; roleId?: string; status?: "active" | "inactive" | "all"; page?: number };
export const PAGE_SIZE = 25;

function visibilityFilter(actor: Actor): SQL | undefined {
  const s = scopeOf(actor, "employee.view");
  if (!s) throw new ForbiddenError();
  if (s === "all") return undefined;
  if (s === "own") return eq(users.id, actor.id);
  // department / assigned → same department
  return actor.departmentId ? eq(users.departmentId, actor.departmentId) : eq(users.id, actor.id);
}

export async function listEmployees(tx: Tx, actor: Actor, f: EmployeeFilters = {}) {
  const conds: (SQL | undefined)[] = [visibilityFilter(actor)];
  if (f.q) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(users.fullName, q), ilike(users.username, q), ilike(users.employeeCode, q)));
  }
  if (f.departmentId) conds.push(eq(users.departmentId, f.departmentId));
  if (f.status !== "all") conds.push(eq(users.isActive, f.status !== "inactive"));
  if (f.roleId) conds.push(sql`exists (select 1 from user_roles ur where ur.user_id = "users"."id" and ur.role_id = ${f.roleId})`);
  const where = and(...conds);
  const page = Math.max(1, f.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    tx.select({
      id: users.id, employeeCode: users.employeeCode, username: users.username, fullName: users.fullName,
      jobTitle: users.jobTitle, isActive: users.isActive, isDemo: users.isDemo, lastLoginAt: users.lastLoginAt,
      department: departments.name,
      roles: sql<string[]>`coalesce((select array_agg(r.name order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = "users"."id"), '{}')`,
    }).from(users).leftJoin(departments, eq(departments.id, users.departmentId))
      .where(where).orderBy(asc(users.fullName)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    tx.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
  ]);
  return { rows, total, page, pageSize: PAGE_SIZE };
}

export async function getEmployee(tx: Tx, actor: Actor, id: string) {
  const vis = visibilityFilter(actor);
  const [u] = await tx.select().from(users).where(and(eq(users.id, id), vis));
  if (!u) throw new NotFoundError("Karyawan tidak ditemukan.");
  const { passwordHash: _ph, ...safe } = u;
  const [roleRows, propAssign, locAssign, resetReqs] = await Promise.all([
    tx.select({ id: roles.id, slug: roles.slug, name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, id)),
    tx.select({ id: propertyAssignments.id, kind: propertyAssignments.kind, propertyId: properties.id, code: properties.code, name: properties.name, startedAt: propertyAssignments.startedAt })
      .from(propertyAssignments).innerJoin(properties, eq(properties.id, propertyAssignments.propertyId))
      .where(and(eq(propertyAssignments.userId, id), isNull(propertyAssignments.endedAt))).orderBy(asc(properties.code)),
    tx.select({ id: locationAssignments.id, kind: locationAssignments.kind, locationId: locations.id, name: locations.name })
      .from(locationAssignments).innerJoin(locations, eq(locations.id, locationAssignments.locationId))
      .where(and(eq(locationAssignments.userId, id), isNull(locationAssignments.endedAt))),
    can(actor, "employee.reset_password")
      ? tx.select().from(passwordResetRequests).where(and(eq(passwordResetRequests.userId, id), isNull(passwordResetRequests.handledAt))).orderBy(desc(passwordResetRequests.createdAt))
      : Promise.resolve([]),
  ]);
  return { user: safe, roles: roleRows, propertyAssignments: propAssign, locationAssignments: locAssign, pendingResetRequests: resetReqs };
}

/** Create an employee with a one-time temporary password (must be changed at first login). */
export async function createEmployee(tx: Tx, actor: Actor, input: z.input<typeof employeeInput>, roleIds: string[] = [], opts: { isDemo?: boolean; password?: string } = {}) {
  requirePermission(actor, "employee.manage");
  const v = parseInput(employeeInput, input);
  const dup = await tx.select({ id: users.id, username: users.username, code: users.employeeCode }).from(users)
    .where(or(eq(users.username, v.username), eq(users.employeeCode, v.employeeCode)));
  if (dup.length) throw new ConflictError(dup[0].username === v.username ? "Username sudah digunakan." : "Kode karyawan sudah digunakan.");
  const pw = opts.password ?? tempPassword();
  const [u] = await tx.insert(users).values({ ...v, passwordHash: await hashPassword(pw), mustChangePassword: true, isDemo: opts.isDemo ?? false }).returning();
  const { passwordHash: _ph, ...safe } = u;
  await audit(tx, actor, { action: "employee.created", entityType: "user", entityId: u.id, after: safe });
  if (roleIds.length) await setUserRoles(tx, actor, u.id, roleIds);
  return { user: safe, temporaryPassword: pw };
}

export async function updateEmployee(tx: Tx, actor: Actor, id: string, input: z.input<typeof employeeInput>) {
  requirePermission(actor, "employee.manage");
  const v = parseInput(employeeInput, input);
  const [cur] = await tx.select().from(users).where(eq(users.id, id));
  if (!cur) throw new NotFoundError("Karyawan tidak ditemukan.");
  const dup = await tx.select({ id: users.id }).from(users)
    .where(and(or(eq(users.username, v.username), eq(users.employeeCode, v.employeeCode)), sql`${users.id} <> ${id}`));
  if (dup.length) throw new ConflictError("Username atau kode karyawan sudah digunakan.");
  const d = diff(cur as unknown as Record<string, unknown>, v);
  if (!d.changed) return;
  await tx.update(users).set({ ...v, updatedAt: new Date() }).where(eq(users.id, id));
  await audit(tx, actor, { action: "employee.updated", entityType: "user", entityId: id, before: d.before, after: d.after });
}

/**
 * Deactivate: revokes all sessions immediately and ends the user's active villa/location
 * assignments so the villa shows up as "no keeper" rather than silently owned by an inactive account.
 */
export async function setEmployeeActive(tx: Tx, actor: Actor, id: string, active: boolean) {
  requirePermission(actor, "employee.manage");
  if (id === actor.id) throw new ValidationError("Anda tidak dapat menonaktifkan akun Anda sendiri.");
  const [cur] = await tx.select().from(users).where(eq(users.id, id));
  if (!cur) throw new NotFoundError("Karyawan tidak ditemukan.");
  if (cur.isActive === active) return;
  await tx.update(users).set({ isActive: active, deactivatedAt: active ? null : new Date(), updatedAt: new Date() }).where(eq(users.id, id));
  let ended = { properties: 0, locations: 0 };
  if (!active) {
    await revokeAllSessions(tx, id, "deactivated");
    const p = await tx.update(propertyAssignments).set({ endedAt: new Date() })
      .where(and(eq(propertyAssignments.userId, id), isNull(propertyAssignments.endedAt))).returning({ id: propertyAssignments.id });
    const l = await tx.update(locationAssignments).set({ endedAt: new Date() })
      .where(and(eq(locationAssignments.userId, id), isNull(locationAssignments.endedAt))).returning({ id: locationAssignments.id });
    ended = { properties: p.length, locations: l.length };
  }
  await audit(tx, actor, {
    action: active ? "employee.activated" : "employee.deactivated", entityType: "user", entityId: id,
    before: { isActive: cur.isActive }, after: { isActive: active, endedAssignments: ended },
  });
  return ended;
}

export async function listDepartments(tx: Tx) {
  return tx.select().from(departments).orderBy(asc(departments.name));
}

export async function usersForPicker(tx: Tx, actor: Actor, roleSlugs?: string[]) {
  requirePermission(actor, "property.assign");
  const q = tx.selectDistinct({ id: users.id, fullName: users.fullName, employeeCode: users.employeeCode })
    .from(users).leftJoin(userRoles, eq(userRoles.userId, users.id)).leftJoin(roles, eq(roles.id, userRoles.roleId));
  return q.where(and(eq(users.isActive, true), roleSlugs?.length ? inArray(roles.slug, roleSlugs) : undefined)).orderBy(asc(users.fullName));
}
