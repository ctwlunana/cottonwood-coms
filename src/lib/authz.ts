import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  users, userRoles, roles, rolePermissions, propertyAssignments, locationAssignments, properties,
} from "@/db/schema";
import { ForbiddenError, AuthError } from "./errors";
import { SCOPE_RANK, type PermissionCode, type Scope, FINANCIAL_PERMISSIONS } from "./permissions";

/** The authenticated principal every service call runs as. */
export type Actor = {
  id: string;
  username: string;
  fullName: string;
  departmentId: string | null;
  roleSlugs: string[];
  perms: Map<string, Scope>;
  ip?: string | null;
  userAgent?: string | null;
};

export type RequestCtx = { ip?: string | null; userAgent?: string | null };

/** Load an active user's effective permissions (union of roles, widest scope wins). */
export async function loadActor(tx: Tx, userId: string, ctx: RequestCtx = {}): Promise<Actor> {
  const [u] = await tx.select().from(users).where(eq(users.id, userId));
  if (!u || !u.isActive) throw new AuthError("Akun tidak aktif.");
  const rows = await tx
    .select({ slug: roles.slug, code: rolePermissions.permissionCode, scope: rolePermissions.scope })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  const perms = new Map<string, Scope>();
  const slugs = new Set<string>();
  for (const r of rows) {
    slugs.add(r.slug);
    if (!r.code || !r.scope) continue;
    const prev = perms.get(r.code);
    if (!prev || SCOPE_RANK[r.scope] > SCOPE_RANK[prev]) perms.set(r.code, r.scope);
  }
  return {
    id: u.id, username: u.username, fullName: u.fullName, departmentId: u.departmentId,
    roleSlugs: [...slugs], perms, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null,
  };
}

export function can(actor: Actor, code: PermissionCode): boolean {
  return actor.perms.has(code);
}
export function canAny(actor: Actor, codes: PermissionCode[]): boolean {
  return codes.some((c) => actor.perms.has(c));
}
export function scopeOf(actor: Actor, code: PermissionCode): Scope | null {
  return actor.perms.get(code) ?? null;
}
export function requirePermission(actor: Actor, code: PermissionCode, message?: string): Scope {
  const s = actor.perms.get(code);
  if (!s) throw new ForbiddenError(message);
  return s;
}
export function hasFinancialAuthority(actor: Actor): boolean {
  return FINANCIAL_PERMISSIONS.some((c) => actor.perms.has(c));
}

/** Segregation of duties: requester / executor may not approve the same record. */
export function assertNotSelf(actorId: string, otherUserId: string | null | undefined, what = "permintaan") {
  if (otherUserId && actorId === otherUserId) {
    throw new ForbiddenError(`Anda tidak dapat menyetujui ${what} Anda sendiri.`);
  }
}

/**
 * Villa IDs the user is assigned to: direct property assignments (keeper/inspector)
 * plus every villa in a location where the user is an active Location PIC / HK Team Leader.
 */
export async function assignedPropertyIds(tx: Tx, userId: string): Promise<string[]> {
  const direct = await tx
    .select({ id: propertyAssignments.propertyId })
    .from(propertyAssignments)
    .where(and(eq(propertyAssignments.userId, userId), isNull(propertyAssignments.endedAt)));
  const locs = await tx
    .select({ id: locationAssignments.locationId })
    .from(locationAssignments)
    .where(and(eq(locationAssignments.userId, userId), isNull(locationAssignments.endedAt)));
  const ids = new Set(direct.map((d) => d.id));
  if (locs.length) {
    const viaLoc = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(inArray(properties.locationId, locs.map((l) => l.id)));
    viaLoc.forEach((p) => ids.add(p.id));
  }
  return [...ids];
}

/**
 * Resolve which villas an actor may see for a villa-scoped permission.
 * Returns "all" or an explicit (possibly empty) list of property IDs.
 * For villa-bound records, `department` scope is treated as company-wide
 * (villas are not owned by a department); `own` and `assigned` → assigned villas.
 */
export async function propertyScope(tx: Tx, actor: Actor, code: PermissionCode): Promise<"all" | string[]> {
  const s = requirePermission(actor, code);
  if (s === "all" || s === "department") return "all";
  return assignedPropertyIds(tx, actor.id);
}

export async function assertPropertyAccess(tx: Tx, actor: Actor, code: PermissionCode, propertyId: string) {
  const scope = await propertyScope(tx, actor, code);
  if (scope !== "all" && !scope.includes(propertyId)) {
    throw new ForbiddenError("Villa ini tidak termasuk dalam penugasan Anda.");
  }
}

/** SQL helper: no-op for "all", else `col IN (...)` (or FALSE for an empty set). */
export function scopeFilter(col: Parameters<typeof inArray>[0], scope: "all" | string[]) {
  if (scope === "all") return undefined;
  if (scope.length === 0) return sql`false`;
  return inArray(col, scope);
}
