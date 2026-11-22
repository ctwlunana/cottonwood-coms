import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { locations, properties, departments, roles, users } from "@/db/schema";
import { type Actor, requirePermission } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { parseCsv } from "@/lib/csv";
import { ValidationError } from "@/lib/errors";
import { createLocation, createProperty, updateProperty, assignPropertyUser, PROPERTY_STATUSES } from "./properties";
import { createEmployee } from "./employees";

export type ImportReport = { created: number; updated: number; errors: { row: number; message: string }[]; credentials?: { employeeCode: string; username: string; temporaryPassword: string }[] };

const MAX_ROWS = 1000;

/**
 * Villa import. Validates every row first; if any row is invalid nothing is written
 * (all-or-nothing, the caller wraps this in a transaction). Creates missing locations,
 * updates existing villas by `code`. `dryRun` validates only.
 */
export async function importVillas(tx: Tx, actor: Actor, csv: string, dryRun = false): Promise<ImportReport> {
  requirePermission(actor, "import.run");
  requirePermission(actor, "property.manage");
  const rows = parseCsv(csv);
  if (!rows.length) throw new ValidationError("File CSV kosong.");
  if (rows.length > MAX_ROWS) throw new ValidationError(`Maksimal ${MAX_ROWS} baris per impor.`);
  const errors: ImportReport["errors"] = [];
  const required = ["name", "location_code", "bedrooms", "bathrooms"];
  const keeperCodes = [...new Set(rows.map((r) => r.keeper_employee_code).filter(Boolean))];
  const keepers = keeperCodes.length ? await tx.select().from(users).where(inArray(users.employeeCode, keeperCodes)) : [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const n = i + 2; // header is row 1
    for (const k of required) if (!r[k]) errors.push({ row: n, message: `Kolom ${k} wajib diisi` });
    if (r.status && !(PROPERTY_STATUSES as readonly string[]).includes(r.status)) errors.push({ row: n, message: `Status tidak valid: ${r.status}` });
    for (const k of ["bedrooms", "bathrooms"]) if (r[k] && !/^\d+$/.test(r[k])) errors.push({ row: n, message: `${k} harus angka` });
    if (r.code) { if (seen.has(r.code.toUpperCase())) errors.push({ row: n, message: `Kode duplikat dalam file: ${r.code}` }); seen.add(r.code.toUpperCase()); }
    if (r.keeper_employee_code && !keepers.find((k) => k.employeeCode === r.keeper_employee_code)) errors.push({ row: n, message: `Keeper ${r.keeper_employee_code} tidak ditemukan` });
  });
  if (errors.length || dryRun) return { created: 0, updated: 0, errors };

  let created = 0, updated = 0;
  const locCache = new Map((await tx.select().from(locations)).map((l) => [l.code, l]));
  for (const [i, r] of rows.entries()) {
    try {
      const lc = r.location_code.toUpperCase();
      let loc = locCache.get(lc);
      if (!loc) { loc = await createLocation(tx, actor, { code: lc, name: r.location_name || lc, area: r.location_area || "" }); locCache.set(lc, loc); }
      const input = {
        code: r.code || "", name: r.name, locationId: loc.id, address: r.address || "",
        status: (r.status || "active") as (typeof PROPERTY_STATUSES)[number],
        bedrooms: Number(r.bedrooms), bathrooms: Number(r.bathrooms),
        maxGuests: r.max_guests ? Number(r.max_guests) : null, notes: r.notes || "",
      };
      const existing = r.code ? (await tx.select().from(properties).where(eq(properties.code, r.code.toUpperCase())))[0] : undefined;
      let id: string;
      if (existing) { await updateProperty(tx, actor, existing.id, input); id = existing.id; updated++; }
      else { id = (await createProperty(tx, actor, input)).id; created++; }
      if (r.keeper_employee_code) {
        const k = keepers.find((x) => x.employeeCode === r.keeper_employee_code)!;
        const cur = await tx.execute<{ user_id: string }>(
          sql`select user_id from property_assignments where property_id = ${id} and kind = 'villa_keeper' and ended_at is null`);
        if (cur.rows[0]?.user_id !== k.id) await assignPropertyUser(tx, actor, id, k.id, "villa_keeper");
      }
    } catch (e) {
      throw new ValidationError(`Baris ${i + 2}: ${(e as Error).message}`);
    }
  }
  await audit(tx, actor, { action: "import.villas", entityType: "import", after: { rows: rows.length, created, updated } });
  return { created, updated, errors };
}

/** Employee import. Creates accounts with one-time temporary passwords returned to the admin. */
export async function importEmployees(tx: Tx, actor: Actor, csv: string, dryRun = false): Promise<ImportReport> {
  requirePermission(actor, "import.run");
  requirePermission(actor, "employee.manage");
  const rows = parseCsv(csv);
  if (!rows.length) throw new ValidationError("File CSV kosong.");
  if (rows.length > MAX_ROWS) throw new ValidationError(`Maksimal ${MAX_ROWS} baris per impor.`);
  const [depts, allRoles, existing] = await Promise.all([
    tx.select().from(departments), tx.select().from(roles),
    tx.select({ username: users.username, code: users.employeeCode }).from(users),
  ]);
  const errors: ImportReport["errors"] = [];
  const seenU = new Set(existing.map((e) => e.username)), seenC = new Set(existing.map((e) => e.code));
  rows.forEach((r, i) => {
    const n = i + 2;
    for (const k of ["employee_code", "username", "full_name", "department_code"]) if (!r[k]) errors.push({ row: n, message: `Kolom ${k} wajib diisi` });
    if (r.department_code && !depts.find((d) => d.code === r.department_code.toUpperCase())) errors.push({ row: n, message: `Departemen ${r.department_code} tidak ditemukan` });
    for (const slug of (r.roles || "").split(/[;|]/).map((s) => s.trim()).filter(Boolean))
      if (!allRoles.find((x) => x.slug === slug)) errors.push({ row: n, message: `Peran ${slug} tidak ditemukan` });
    const u = (r.username || "").toLowerCase();
    if (u && seenU.has(u)) errors.push({ row: n, message: `Username ${u} sudah ada` });
    if (r.employee_code && seenC.has(r.employee_code)) errors.push({ row: n, message: `Kode ${r.employee_code} sudah ada` });
    seenU.add(u); seenC.add(r.employee_code);
  });
  if (errors.length || dryRun) return { created: 0, updated: 0, errors };
  const credentials: NonNullable<ImportReport["credentials"]> = [];
  for (const [i, r] of rows.entries()) {
    try {
      const dept = depts.find((d) => d.code === r.department_code.toUpperCase())!;
      const roleIds = (r.roles || "").split(/[;|]/).map((s) => s.trim()).filter(Boolean).map((s) => allRoles.find((x) => x.slug === s)!.id);
      const res = await createEmployee(tx, actor, {
        employeeCode: r.employee_code, username: r.username, fullName: r.full_name, email: r.email || "", phone: r.phone || "",
        jobTitle: r.job_title || "", departmentId: dept.id,
      }, roleIds);
      credentials.push({ employeeCode: res.user.employeeCode, username: res.user.username, temporaryPassword: res.temporaryPassword });
    } catch (e) {
      throw new ValidationError(`Baris ${i + 2}: ${(e as Error).message}`);
    }
  }
  await audit(tx, actor, { action: "import.employees", entityType: "import", after: { rows: rows.length, created: credentials.length } });
  return { created: credentials.length, updated: 0, errors, credentials };
}
