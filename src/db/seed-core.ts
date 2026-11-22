import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { permissions, departments, roles, rolePermissions, users, userRoles, auditLogs } from "@/db/schema";
import { PERMISSIONS, DEFAULT_ROLES, DEPARTMENTS, normalizeGrant } from "@/lib/permissions";
import { hashPassword } from "@/lib/crypto";
import { loadActor } from "@/lib/authz";
import { createEmployee } from "@/services/employees";
import { createLocation, createProperty, assignPropertyUser, assignLocationUser } from "@/services/properties";

/**
 * Idempotent base seed: permission catalog, departments, default roles.
 * The default matrix is applied only to roles created now (or with resetMatrix),
 * so runtime customizations of the matrix are never overwritten.
 */
export async function seedBase(tx: Tx, opts: { resetMatrix?: boolean } = {}) {
  for (const [code, def] of Object.entries(PERMISSIONS)) {
    const d = def as { module: string; description: string; scoped?: boolean; stage: number };
    await tx.insert(permissions).values({ code, module: d.module, description: d.description, scoped: Boolean(d.scoped), stage: d.stage })
      .onConflictDoUpdate({ target: permissions.code, set: { module: d.module, description: d.description, scoped: Boolean(d.scoped), stage: d.stage } });
  }
  const deptIds = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const [row] = await tx.insert(departments).values({ code: d.code, name: d.name })
      .onConflictDoUpdate({ target: departments.code, set: { name: d.name } }).returning();
    deptIds.set(d.code, row.id);
  }
  const createdRoles: string[] = [];
  for (const r of DEFAULT_ROLES) {
    const [existing] = await tx.select().from(roles).where(eq(roles.slug, r.slug));
    let roleId = existing?.id;
    if (!existing) {
      const [row] = await tx.insert(roles).values({ slug: r.slug, name: r.name, description: r.description, departmentId: deptIds.get(r.department), isSystem: true }).returning();
      roleId = row.id;
      createdRoles.push(r.slug);
    }
    if (!existing || opts.resetMatrix) {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId!));
      const grants = r.grants.map(normalizeGrant);
      await tx.insert(rolePermissions).values(grants.map((g) => ({ roleId: roleId!, permissionCode: g.code, scope: g.scope })));
    }
  }
  if (createdRoles.length || opts.resetMatrix) {
    await tx.insert(auditLogs).values({ action: opts.resetMatrix ? "seed.matrix_reset" : "seed.base", entityType: "system", after: { createdRoles } });
  }
  return { deptIds, createdRoles };
}

/** Bootstrap a first account directly (no actor exists yet). */
export async function bootstrapUser(tx: Tx, u: { username: string; fullName: string; employeeCode: string; roleSlug: string; deptCode: string; password: string; mustChange?: boolean; isDemo?: boolean }) {
  const [dept] = await tx.select().from(departments).where(eq(departments.code, u.deptCode));
  const [role] = await tx.select().from(roles).where(eq(roles.slug, u.roleSlug));
  if (!role) throw new Error(`Peran ${u.roleSlug} tidak ada. Jalankan db:seed dahulu.`);
  const [row] = await tx.insert(users).values({
    username: u.username.toLowerCase(), fullName: u.fullName, employeeCode: u.employeeCode, departmentId: dept?.id,
    passwordHash: await hashPassword(u.password), mustChangePassword: u.mustChange ?? true, isDemo: u.isDemo ?? false,
  }).returning();
  await tx.insert(userRoles).values({ userId: row.id, roleId: role.id });
  await tx.insert(auditLogs).values({ action: "seed.bootstrap_user", entityType: "user", entityId: row.id, after: { username: row.username, role: u.roleSlug } });
  return row;
}

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-cottonwood-2026";

/** Clearly-labelled demo data for development / testing only. Never real names or villas. */
export async function seedDemo(tx: Tx) {
  const [already] = await tx.select({ c: sql<number>`count(*)::int` }).from(users).where(eq(users.isDemo, true));
  if (already.c > 0) return { skipped: true };

  const gm = await bootstrapUser(tx, { username: "demo.gm", fullName: "[DEMO] General Manager", employeeCode: "DEMO-001", roleSlug: "gm", deptCode: "MGT", password: DEMO_PASSWORD, mustChange: false, isDemo: true });
  const actor = await loadActor(tx, gm.id);
  const allRoles = await tx.select().from(roles);
  const depts = await tx.select().from(departments);
  const roleId = (s: string) => allRoles.find((r) => r.slug === s)!.id;

  const people: [string, string, string, string][] = [
    ["demo.sysadmin", "[DEMO] System Admin", "sysadmin", "IT"],
    ["demo.spv.villa", "[DEMO] Supervisor Villa", "supervisor_villa", "PROP"],
    ["demo.pic.utara", "[DEMO] PIC Lokasi Utara", "location_pic", "PROP"],
    ["demo.keeper1", "[DEMO] Villa Keeper 1", "villa_keeper", "PROP"],
    ["demo.keeper2", "[DEMO] Villa Keeper 2", "villa_keeper", "PROP"],
    ["demo.spv.eng", "[DEMO] Supervisor Engineer", "supervisor_engineer", "ENG"],
    ["demo.eng1", "[DEMO] Engineer 1", "engineer", "ENG"],
    ["demo.eng2", "[DEMO] Engineer 2", "engineer", "ENG"],
    ["demo.hk.coord", "[DEMO] Koordinator HK", "hk_coordinator", "HK"],
    ["demo.hk.tl", "[DEMO] Team Leader HK", "hk_team_leader", "HK"],
    ["demo.hk1", "[DEMO] Housekeeper 1", "housekeeper", "HK"],
    ["demo.hk2", "[DEMO] Housekeeper 2", "housekeeper", "HK"],
    ["demo.spv.inv", "[DEMO] Supervisor Inventory", "supervisor_inventory", "INV"],
    ["demo.inv1", "[DEMO] Staff Inventory", "inventory_staff", "INV"],
    ["demo.purchasing", "[DEMO] Purchasing Officer", "purchasing_officer", "PUR"],
    ["demo.cs.lead", "[DEMO] CS Lead", "cs_lead", "CS"],
    ["demo.cs1", "[DEMO] CS Staff 1", "cs_staff", "CS"],
    ["demo.cs2", "[DEMO] CS Staff 2", "cs_staff", "CS"],
    ["demo.finance", "[DEMO] Finance", "finance", "FIN"],
    ["demo.accounting", "[DEMO] Accounting", "accounting", "ACC"],
  ];
  const ids = new Map<string, string>();
  let n = 2;
  for (const [username, fullName, role, dept] of people) {
    const res = await createEmployee(tx, actor, {
      employeeCode: `DEMO-${String(n++).padStart(3, "0")}`, username, fullName, departmentId: depts.find((d) => d.code === dept)!.id,
      jobTitle: allRoles.find((r) => r.slug === role)!.name,
    }, [roleId(role)], { isDemo: true, password: DEMO_PASSWORD });
    await tx.update(users).set({ mustChangePassword: false }).where(eq(users.id, res.user.id));
    ids.set(username, res.user.id);
  }

  const locs = [
    await createLocation(tx, actor, { code: "DM-UTR", name: "[DEMO] Klaster Utara", area: "Area demo A" }, { isDemo: true }),
    await createLocation(tx, actor, { code: "DM-SLT", name: "[DEMO] Klaster Selatan", area: "Area demo B" }, { isDemo: true }),
    await createLocation(tx, actor, { code: "DM-TMR", name: "[DEMO] Klaster Timur", area: "Area demo C" }, { isDemo: true }),
  ];
  const villas = [];
  for (let i = 1; i <= 9; i++) {
    const loc = locs[(i - 1) % 3];
    villas.push(await createProperty(tx, actor, {
      code: `DEMO-V${String(i).padStart(2, "0")}`, name: `[DEMO] Villa ${String.fromCharCode(64 + i)}`, locationId: loc.id,
      address: "Alamat demo — bukan data asli", status: i === 9 ? "under_maintenance" : "active",
      bedrooms: 1 + (i % 4), bathrooms: 1 + (i % 3),
    }, { isDemo: true }));
  }
  // Keeper 1: villas A, B, D (mixed clusters); Keeper 2: C, E; others unassigned to show "tanpa keeper".
  for (const [vi, k] of [[0, "demo.keeper1"], [1, "demo.keeper1"], [3, "demo.keeper1"], [2, "demo.keeper2"], [4, "demo.keeper2"]] as const) {
    await assignPropertyUser(tx, actor, villas[vi].id, ids.get(k)!, "villa_keeper");
  }
  await assignLocationUser(tx, actor, locs[0].id, ids.get("demo.pic.utara")!, "location_pic");
  await assignLocationUser(tx, actor, locs[0].id, ids.get("demo.hk.tl")!, "hk_team_leader");
  return { skipped: false, users: people.length + 1, villas: villas.length };
}
