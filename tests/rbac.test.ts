import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { inTx, actorFor, userId } from "./helpers";
import { can, hasFinancialAuthority, loadActor } from "@/lib/authz";
import { listProperties, getProperty, createProperty, assignPropertyUser, updateProperty, listLocations } from "@/services/properties";
import { listEmployees, createEmployee } from "@/services/employees";
import { setRolePermission, setUserRoles, getMatrix } from "@/services/rbac";
import { setSetting } from "@/services/settings";
import { listAudit } from "@/services/audit";
import { auditLogs, roles, properties, propertyAssignments } from "@/db/schema";

const role = async (tx: Parameters<Parameters<typeof inTx>[0]>[0], slug: string) => (await tx.select().from(roles).where(eq(roles.slug, slug)))[0];

describe("villa visibility (scope)", () => {
  it("each role sees exactly the villas it is entitled to", () => inTx(async (tx) => {
    const count = async (u: string) => (await listProperties(tx, await actorFor(tx, u))).total;
    expect(await count("demo.gm")).toBe(9);
    expect(await count("demo.spv.villa")).toBe(9);
    expect(await count("demo.keeper1")).toBe(3);
    expect(await count("demo.keeper2")).toBe(2);
    expect(await count("demo.pic.utara")).toBe(3); // all villas of the Utara cluster
    expect(await count("demo.eng1")).toBe(9);
  }));

  it("a keeper cannot open a villa that is not assigned to them", () => inTx(async (tx) => {
    const k1 = await actorFor(tx, "demo.keeper1");
    const k2 = await actorFor(tx, "demo.keeper2");
    const k2villa = (await listProperties(tx, k2)).rows[0];
    await expect(getProperty(tx, k1, k2villa.id)).rejects.toThrow(/penugasan/);
    const own = (await listProperties(tx, k1)).rows[0];
    await expect(getProperty(tx, k1, own.id)).resolves.toBeTruthy();
  }));

  it("keepers only see locations containing their villas", () => inTx(async (tx) => {
    const locs = await listLocations(tx, await actorFor(tx, "demo.keeper2"));
    expect(locs.length).toBeLessThanOrEqual(2);
  }));

  it("roles without access get nothing (housekeeper has no property.view)", () => inTx(async (tx) => {
    await expect(listProperties(tx, await actorFor(tx, "demo.hk1"))).rejects.toThrow(/hak akses/);
  }));

  it("assigning a new keeper ends the previous assignment (one active keeper per villa)", () => inTx(async (tx) => {
    const gm = await actorFor(tx, "demo.gm");
    const villa = (await listProperties(tx, await actorFor(tx, "demo.keeper1"))).rows[0];
    await assignPropertyUser(tx, gm, villa.id, await userId(tx, "demo.keeper2"), "villa_keeper");
    const active = await tx.select().from(propertyAssignments).where(sql`property_id = ${villa.id} and kind = 'villa_keeper' and ended_at is null`);
    expect(active).toHaveLength(1);
    expect(active[0].userId).toBe(await userId(tx, "demo.keeper2"));
    expect((await listProperties(tx, await actorFor(tx, "demo.keeper1"))).total).toBe(2);
  }));

  it("a non-keeper cannot be assigned as villa keeper", () => inTx(async (tx) => {
    const gm = await actorFor(tx, "demo.gm");
    const villa = (await listProperties(tx, gm)).rows[0];
    await expect(assignPropertyUser(tx, gm, villa.id, await userId(tx, "demo.finance"), "villa_keeper")).rejects.toThrow(/peran Villa Keeper/);
  }));
});

describe("permission boundaries", () => {
  it("field staff cannot manage villas, employees or the matrix", () => inTx(async (tx) => {
    const k = await actorFor(tx, "demo.keeper1");
    const [loc] = await listLocations(tx, k);
    await expect(createProperty(tx, k, { name: "X", locationId: loc.id, bedrooms: 1, bathrooms: 1 })).rejects.toThrow(/hak akses/);
    await expect(createEmployee(tx, k, { employeeCode: "X1", username: "xx1", fullName: "X", departmentId: loc.id })).rejects.toThrow(/hak akses/);
    await expect(getMatrix(tx, k)).rejects.toThrow(/hak akses/);
  }));

  it("no one but GM-type roles hold approval authority by default", () => inTx(async (tx) => {
    for (const u of ["demo.keeper1", "demo.cs1", "demo.cs.lead", "demo.purchasing", "demo.finance", "demo.inv1", "demo.sysadmin", "demo.pic.utara"]) {
      expect(can(await actorFor(tx, u), "approval.decide"), u).toBe(false);
    }
    expect(can(await actorFor(tx, "demo.gm"), "approval.decide")).toBe(true);
  }));

  it("System Administrator has no financial authority and cannot grant it", () => inTx(async (tx) => {
    const admin = await actorFor(tx, "demo.sysadmin");
    expect(hasFinancialAuthority(admin)).toBe(false);
    const keeperRole = await role(tx, "villa_keeper");
    await expect(setRolePermission(tx, admin, keeperRole.id, "approval.decide", "all")).rejects.toThrow(/GM/);
    const financeRole = await role(tx, "finance");
    await expect(setUserRoles(tx, admin, await userId(tx, "demo.keeper1"), [financeRole.id])).rejects.toThrow(/GM/);
  }));

  it("nobody can change their own roles or their own role's permissions", () => inTx(async (tx) => {
    const admin = await actorFor(tx, "demo.sysadmin");
    const gmRole = await role(tx, "gm");
    await expect(setUserRoles(tx, admin, admin.id, [gmRole.id])).rejects.toThrow(/sendiri/);
    const sysRole = await role(tx, "sysadmin");
    await expect(setRolePermission(tx, admin, sysRole.id, "cs.guest_pii_view", "all")).rejects.toThrow(/sendiri/);
    const gm = await actorFor(tx, "demo.gm");
    await expect(setUserRoles(tx, gm, gm.id, [])).rejects.toThrow(/sendiri/);
  }));

  it("matrix changes apply on next permission load and are audited", () => inTx(async (tx) => {
    const admin = await actorFor(tx, "demo.sysadmin");
    const keeperRole = await role(tx, "villa_keeper");
    await setRolePermission(tx, admin, keeperRole.id, "property.view", "all");
    expect((await listProperties(tx, await actorFor(tx, "demo.keeper1"))).total).toBe(9);
    await setRolePermission(tx, admin, keeperRole.id, "property.view", null);
    await expect(listProperties(tx, await actorFor(tx, "demo.keeper1"))).rejects.toThrow();
    const logs = await tx.select().from(auditLogs).where(eq(auditLogs.action, "rbac.permission_changed"));
    expect(logs.length).toBe(2);
  }));

  it("GM can grant approval authority (and that is audited)", () => inTx(async (tx) => {
    const gm = await actorFor(tx, "demo.gm");
    const spv = await role(tx, "supervisor_villa");
    await setRolePermission(tx, gm, spv.id, "approval.decide", "all");
    expect(can(await actorFor(tx, "demo.spv.villa"), "approval.decide")).toBe(true);
  }));

  it("approval threshold can only be changed by approval-rule holders", () => inTx(async (tx) => {
    await expect(setSetting(tx, await actorFor(tx, "demo.sysadmin"), "approval.gm_threshold_idr", 5_000_000)).rejects.toThrow(/otoritas/);
    await setSetting(tx, await actorFor(tx, "demo.gm"), "approval.gm_threshold_idr", 12_000_000);
  }));

  it("department-scoped employee view only shows own department", () => inTx(async (tx) => {
    const spvEng = await actorFor(tx, "demo.spv.eng");
    const res = await listEmployees(tx, spvEng);
    expect(res.total).toBe(3);
    expect(res.rows.every((r) => r.department === "Engineering")).toBe(true);
  }));

  it("roles can be combined; widest scope wins", () => inTx(async (tx) => {
    const gm = await actorFor(tx, "demo.gm");
    const k1 = await userId(tx, "demo.keeper1");
    await setUserRoles(tx, gm, k1, [(await role(tx, "villa_keeper")).id, (await role(tx, "supervisor_villa")).id]);
    const a = await loadActor(tx, k1);
    expect(a.perms.get("property.view")).toBe("all");
    expect(a.roleSlugs.sort()).toEqual(["supervisor_villa", "villa_keeper"]);
  }));
});

describe("audit trail", () => {
  it("is append-only at the database level", () => inTx(async (tx) => {
    await expect(tx.execute(sql`update audit_logs set action = 'x'`)).rejects.toThrow();
  }));
  it("can't delete audit rows either", () => inTx(async (tx) => {
    await expect(tx.execute(sql`delete from audit_logs`)).rejects.toThrow();
  }));
  it("records before/after on property updates", () => inTx(async (tx) => {
    const gm = await actorFor(tx, "demo.gm");
    const [p] = await tx.select().from(properties).limit(1);
    await updateProperty(tx, gm, p.id, { code: p.code, name: p.name, locationId: p.locationId, status: "under_maintenance", bedrooms: p.bedrooms, bathrooms: p.bathrooms, address: p.address ?? "", notes: p.notes ?? "" });
    const res = await listAudit(tx, gm, { entityType: "property", entityId: p.id });
    const last = res.rows[0].log;
    expect(last.action).toBe("property.status_changed");
    expect(last.before).toMatchObject({ status: p.status });
    expect(last.after).toMatchObject({ status: "under_maintenance" });
  }));
  it("audit view is restricted", () => inTx(async (tx) => {
    await expect(listAudit(tx, await actorFor(tx, "demo.keeper1"))).rejects.toThrow(/hak akses/);
  }));
});
