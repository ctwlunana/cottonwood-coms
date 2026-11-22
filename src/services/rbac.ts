import { parseInput } from "@/lib/validate";
import { and, eq, inArray, sql, asc } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { roles, rolePermissions, permissions, userRoles, users } from "@/db/schema";
import { type Actor, requirePermission, can } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from "@/lib/errors";
import { FINANCIAL_PERMISSIONS, PERMISSIONS, SCOPES, type PermissionCode, type Scope, isScoped } from "@/lib/permissions";

const FIN = new Set<string>(FINANCIAL_PERMISSIONS);

export async function listRoles(tx: Tx, actor: Actor) {
  if (!can(actor, "rbac.manage") && !can(actor, "employee.view")) throw new ForbiddenError();
  return tx.select({
    id: roles.id, slug: roles.slug, name: roles.name, description: roles.description, isSystem: roles.isSystem,
    members: sql<number>`(select count(*)::int from user_roles ur join users u on u.id = ur.user_id where ur.role_id = "roles"."id" and u.is_active)`,
  }).from(roles).orderBy(asc(roles.name));
}

export async function getMatrix(tx: Tx, actor: Actor) {
  requirePermission(actor, "rbac.manage");
  const [rs, ps, rp] = await Promise.all([
    tx.select().from(roles).orderBy(asc(roles.name)),
    tx.select().from(permissions).orderBy(asc(permissions.stage), asc(permissions.module), asc(permissions.code)),
    tx.select().from(rolePermissions),
  ]);
  const grants = new Map<string, Scope>();
  rp.forEach((g) => grants.set(`${g.roleId}|${g.permissionCode}`, g.scope));
  return { roles: rs, permissions: ps, grants };
}

async function roleContainsFinancial(tx: Tx, roleIds: string[]) {
  if (!roleIds.length) return false;
  const r = await tx.select({ c: rolePermissions.permissionCode }).from(rolePermissions)
    .where(and(inArray(rolePermissions.roleId, roleIds), inArray(rolePermissions.permissionCode, FINANCIAL_PERMISSIONS)));
  return r.length > 0;
}

/**
 * Change one cell of the permission matrix (scope = null removes the grant).
 * Guards: financial/approval permissions and roles the actor holds can only be
 * modified by holders of `approval.rule_manage` (GM by default) — so a System
 * Administrator cannot grant themselves or anyone approval/finance authority.
 */
export async function setRolePermission(tx: Tx, actor: Actor, roleId: string, code: string, scope: Scope | null) {
  requirePermission(actor, "rbac.manage");
  if (!(code in PERMISSIONS)) throw new ValidationError("Kode hak akses tidak dikenal.");
  if (scope && !SCOPES.includes(scope)) throw new ValidationError("Cakupan tidak valid.");
  const [role] = await tx.select().from(roles).where(eq(roles.id, roleId));
  if (!role) throw new NotFoundError("Peran tidak ditemukan.");
  const isFin = FIN.has(code);
  const ownRole = actor.roleSlugs.includes(role.slug);
  if ((isFin || ownRole) && !can(actor, "approval.rule_manage")) {
    throw new ForbiddenError(isFin
      ? "Hak akses keuangan/approval hanya dapat diatur oleh pemegang otoritas aturan approval (GM)."
      : "Anda tidak dapat mengubah hak akses peran yang Anda miliki sendiri.");
  }
  const effScope: Scope | null = scope && !isScoped(code as PermissionCode) ? "all" : scope;
  const [prev] = await tx.select().from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionCode, code)));
  if (effScope === null) {
    if (!prev) return;
    await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionCode, code)));
  } else {
    if (prev?.scope === effScope) return;
    await tx.insert(rolePermissions).values({ roleId, permissionCode: code, scope: effScope })
      .onConflictDoUpdate({ target: [rolePermissions.roleId, rolePermissions.permissionCode], set: { scope: effScope } });
  }
  await audit(tx, actor, {
    action: "rbac.permission_changed", entityType: "role", entityId: roleId,
    before: { role: role.slug, permission: code, scope: prev?.scope ?? null },
    after: { role: role.slug, permission: code, scope: effScope },
  });
}

export const roleInput = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,40}$/, "Slug: huruf kecil, angka, garis bawah (3–40)"),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function createRole(tx: Tx, actor: Actor, input: z.input<typeof roleInput>) {
  requirePermission(actor, "rbac.manage");
  const v = parseInput(roleInput, input);
  const [exists] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.slug, v.slug));
  if (exists) throw new ConflictError("Slug peran sudah digunakan.");
  const [r] = await tx.insert(roles).values({ slug: v.slug, name: v.name, description: v.description || null }).returning();
  await audit(tx, actor, { action: "rbac.role_created", entityType: "role", entityId: r.id, after: r });
  return r;
}

/**
 * Replace a user's roles. Guards:
 *  - nobody edits their own roles (prevents self-escalation),
 *  - adding/removing a role carrying financial authority requires `approval.rule_manage`.
 */
export async function setUserRoles(tx: Tx, actor: Actor, userId: string, roleIds: string[]) {
  requirePermission(actor, "rbac.manage");
  if (userId === actor.id) throw new ForbiddenError("Anda tidak dapat mengubah peran Anda sendiri.");
  const [u] = await tx.select().from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError("Karyawan tidak ditemukan.");
  const unique = [...new Set(roleIds)];
  if (unique.length) {
    const found = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, unique));
    if (found.length !== unique.length) throw new ValidationError("Peran tidak valid.");
  }
  const current = (await tx.select({ id: userRoles.roleId, slug: roles.slug }).from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId)));
  const curIds = current.map((c) => c.id);
  const added = unique.filter((id) => !curIds.includes(id));
  const removed = curIds.filter((id) => !unique.includes(id));
  if (!added.length && !removed.length) return;
  if ((await roleContainsFinancial(tx, [...added, ...removed])) && !can(actor, "approval.rule_manage")) {
    throw new ForbiddenError("Peran dengan otoritas keuangan/approval hanya dapat diberikan atau dicabut oleh GM.");
  }
  if (removed.length) await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, removed)));
  if (added.length) await tx.insert(userRoles).values(added.map((roleId) => ({ userId, roleId, grantedBy: actor.id })));
  const after = await tx.select({ slug: roles.slug }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
  await audit(tx, actor, {
    action: "rbac.user_roles_changed", entityType: "user", entityId: userId,
    before: { roles: current.map((c) => c.slug) }, after: { roles: after.map((a) => a.slug) },
  });
}

/** Role ids that carry financial/approval permissions (UI marks them; service enforces). */
export async function financialRoleIds(tx: Tx): Promise<Set<string>> {
  const r = await tx.selectDistinct({ id: rolePermissions.roleId }).from(rolePermissions).where(inArray(rolePermissions.permissionCode, FINANCIAL_PERMISSIONS));
  return new Set(r.map((x) => x.id));
}
