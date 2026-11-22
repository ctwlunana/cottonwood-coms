import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { departments } from "@/db/schema";
import { type Actor, requirePermission } from "@/lib/authz";
import { audit, diff } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/validate";

export const departmentInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "Kode 2–10 huruf/angka"),
  name: z.string().trim().min(2).max(80),
});

export async function createDepartment(tx: Tx, actor: Actor, input: z.input<typeof departmentInput>) {
  requirePermission(actor, "department.manage");
  const v = parseInput(departmentInput, input);
  const [dup] = await tx.select().from(departments).where(eq(departments.code, v.code));
  if (dup) throw new ConflictError("Kode departemen sudah digunakan.");
  const [d] = await tx.insert(departments).values(v).returning();
  await audit(tx, actor, { action: "department.created", entityType: "department", entityId: d.id, after: d });
  return d;
}

export async function updateDepartment(tx: Tx, actor: Actor, id: string, input: z.input<typeof departmentInput> & { isActive: boolean }) {
  requirePermission(actor, "department.manage");
  const v = { ...parseInput(departmentInput, input), isActive: input.isActive };
  const [cur] = await tx.select().from(departments).where(eq(departments.id, id));
  if (!cur) throw new NotFoundError();
  const [dup] = await tx.select().from(departments).where(sql`${departments.code} = ${v.code} and ${departments.id} <> ${id}`);
  if (dup) throw new ConflictError("Kode departemen sudah digunakan.");
  const d = diff(cur as unknown as Record<string, unknown>, v);
  if (!d.changed) return;
  await tx.update(departments).set({ ...v, updatedAt: new Date() }).where(eq(departments.id, id));
  await audit(tx, actor, { action: "department.updated", entityType: "department", entityId: id, before: d.before, after: d.after });
}
