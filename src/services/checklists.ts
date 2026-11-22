import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  checklistTemplates, checklistTemplateItems, checklistSubmissions, checklistAnswers, properties, users, locations,
  locationAssignments,
} from "@/db/schema";
import { type Actor, requirePermission, propertyScope, scopeFilter, assertPropertyAccess, scopeOf } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/codes";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validate";
import { notify, usersWithPermission } from "@/lib/notify";
import { saveFiles, filesFor, type UploadFile } from "./attachments";
import { todayJakarta } from "./villa-relations";
import { CATEGORIES } from "@/lib/labels";

// ------------------------------------------------------------------ templates
export async function listTemplates(tx: Tx, actor: Actor, opts: { activeOnly?: boolean } = {}) {
  if (!actor.perms.has("checklist.submit") && !actor.perms.has("checklist.template_manage")) throw new ForbiddenError();
  return tx.select({
    id: checklistTemplates.id, name: checklistTemplates.name, description: checklistTemplates.description, isActive: checklistTemplates.isActive,
    items: sql<number>`(select count(*)::int from checklist_template_items i where i.template_id = "checklist_templates"."id" and i.is_active)`,
  }).from(checklistTemplates).where(opts.activeOnly ? eq(checklistTemplates.isActive, true) : undefined).orderBy(asc(checklistTemplates.name));
}

export async function getTemplate(tx: Tx, actor: Actor, id: string) {
  if (!actor.perms.has("checklist.submit") && !actor.perms.has("checklist.template_manage")) throw new ForbiddenError();
  const [t] = await tx.select().from(checklistTemplates).where(eq(checklistTemplates.id, id));
  if (!t) throw new NotFoundError("Template tidak ditemukan.");
  const items = await tx.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, id))
    .orderBy(asc(checklistTemplateItems.sortOrder), asc(checklistTemplateItems.label));
  return { template: t, items };
}

const templateInput = z.object({ name: z.string().trim().min(3).max(120), description: z.string().trim().max(500).optional().or(z.literal("")) });
export async function createTemplate(tx: Tx, actor: Actor, input: z.input<typeof templateInput>) {
  requirePermission(actor, "checklist.template_manage");
  const v = parseInput(templateInput, input);
  const [t] = await tx.insert(checklistTemplates).values({ name: v.name, description: v.description || null, createdBy: actor.id }).returning();
  await audit(tx, actor, { action: "checklist.template_created", entityType: "checklist_template", entityId: t.id, after: t });
  return t;
}
export async function setTemplateActive(tx: Tx, actor: Actor, id: string, active: boolean) {
  requirePermission(actor, "checklist.template_manage");
  await tx.update(checklistTemplates).set({ isActive: active, updatedAt: new Date() }).where(eq(checklistTemplates.id, id));
  await audit(tx, actor, { action: "checklist.template_updated", entityType: "checklist_template", entityId: id, after: { isActive: active } });
}

const itemInput = z.object({
  label: z.string().trim().min(2).max(200),
  section: z.string().trim().max(80).optional().or(z.literal("")),
  category: z.enum(CATEGORIES).optional().or(z.literal("")),
  photoRequiredOnFail: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export async function addTemplateItem(tx: Tx, actor: Actor, templateId: string, input: z.input<typeof itemInput>) {
  requirePermission(actor, "checklist.template_manage");
  const v = parseInput(itemInput, input);
  const [i] = await tx.insert(checklistTemplateItems).values({ templateId, label: v.label, section: v.section || null, category: v.category || null, photoRequiredOnFail: v.photoRequiredOnFail, sortOrder: v.sortOrder }).returning();
  await audit(tx, actor, { action: "checklist.item_added", entityType: "checklist_template", entityId: templateId, after: i });
  return i;
}
/** Items are deactivated, never deleted (answers keep a label snapshot anyway). */
export async function setTemplateItemActive(tx: Tx, actor: Actor, itemId: string, active: boolean) {
  requirePermission(actor, "checklist.template_manage");
  const [i] = await tx.update(checklistTemplateItems).set({ isActive: active }).where(eq(checklistTemplateItems.id, itemId)).returning();
  if (!i) throw new NotFoundError();
  await audit(tx, actor, { action: "checklist.item_updated", entityType: "checklist_template", entityId: i.templateId, after: { item: i.label, isActive: active } });
}

// ------------------------------------------------------------------ submissions
export type AnswerInput = { itemId: string; answer: "yes" | "no" | "na"; note?: string; files?: UploadFile[] };

/**
 * Submit a daily checklist for a villa the actor may access. Every active item must be
 * answered; a failed item needs a note (and a photo when the item requires it).
 */
export async function submitChecklist(tx: Tx, actor: Actor, input: { propertyId: string; templateId: string; notes?: string; answers: AnswerInput[] }) {
  requirePermission(actor, "checklist.submit");
  await assertPropertyAccess(tx, actor, "property.view", input.propertyId);
  const [prop] = await tx.select().from(properties).where(eq(properties.id, input.propertyId));
  if (!prop || prop.deletedAt) throw new NotFoundError("Villa tidak ditemukan.");
  const { template, items } = await getTemplate(tx, actor, input.templateId);
  if (!template.isActive) throw new ValidationError("Template checklist tidak aktif.");
  const active = items.filter((i) => i.isActive);
  const byId = new Map(input.answers.map((a) => [a.itemId, a]));
  const errors: string[] = [];
  for (const it of active) {
    const a = byId.get(it.id);
    if (!a || !["yes", "no", "na"].includes(a.answer)) { errors.push(`"${it.label}" belum dijawab`); continue; }
    if (a.answer === "no") {
      if (!a.note?.trim()) errors.push(`"${it.label}": isi catatan masalah`);
      if (it.photoRequiredOnFail && !(a.files?.length)) errors.push(`"${it.label}": foto wajib untuk item bermasalah`);
    }
  }
  if (errors.length) throw new ValidationError(errors.join("; "));

  const code = await nextCode(tx, "CK", { yearly: true });
  const failCount = active.filter((i) => byId.get(i.id)!.answer === "no").length;
  const [sub] = await tx.insert(checklistSubmissions).values({
    code, templateId: template.id, propertyId: prop.id, submittedBy: actor.id, checkDate: todayJakarta(), notes: input.notes?.trim() || null, failCount,
  }).returning();
  for (const it of active) {
    const a = byId.get(it.id)!;
    const [row] = await tx.insert(checklistAnswers).values({
      submissionId: sub.id, itemId: it.id, label: it.label, section: it.section, answer: a.answer, note: a.note?.trim() || null,
    }).returning();
    if (a.files?.length) await saveFiles(tx, actor, "checklist_answer", row.id, a.files, "photo");
  }
  await audit(tx, actor, { action: "checklist.submitted", entityType: "property", entityId: prop.id, after: { code, failCount } });
  if (failCount > 0) {
    const pics = await tx.select({ id: locationAssignments.userId }).from(locationAssignments)
      .where(and(eq(locationAssignments.locationId, prop.locationId), eq(locationAssignments.kind, "location_pic"), sql`${locationAssignments.endedAt} is null`));
    const supervisors = await usersWithPermission(tx, "checklist.template_manage", [actor.id]);
    await notify(tx, {
      type: "checklist.failed_items", userIds: [...supervisors, ...pics.map((p) => p.id)].filter((id) => id !== actor.id),
      title: `Checklist ${prop.name}: ${failCount} item bermasalah`, body: `Dilaporkan oleh ${actor.fullName}.`,
      link: `/checklist/${sub.id}`, entityType: "checklist_submission", entityId: sub.id, priority: "normal",
    });
  }
  return sub;
}

function submissionVisibility(actor: Actor, scope: "all" | string[]): SQL | undefined {
  const s = scopeOf(actor, "checklist.view");
  if (!s) throw new ForbiddenError();
  if (s === "own") return eq(checklistSubmissions.submittedBy, actor.id);
  return scopeFilter(checklistSubmissions.propertyId, scope);
}

export async function listSubmissions(tx: Tx, actor: Actor, f: { propertyId?: string; date?: string; failedOnly?: boolean; page?: number } = {}) {
  const scope = await propertyScope(tx, actor, "checklist.view");
  const where = and(
    submissionVisibility(actor, scope),
    f.propertyId ? eq(checklistSubmissions.propertyId, f.propertyId) : undefined,
    f.date ? eq(checklistSubmissions.checkDate, f.date) : undefined,
    f.failedOnly ? sql`${checklistSubmissions.failCount} > 0` : undefined,
  );
  const page = Math.max(1, f.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    tx.select({ s: checklistSubmissions, villa: properties.name, villaCode: properties.code, by: users.fullName })
      .from(checklistSubmissions).innerJoin(properties, eq(properties.id, checklistSubmissions.propertyId))
      .innerJoin(users, eq(users.id, checklistSubmissions.submittedBy))
      .where(where).orderBy(desc(checklistSubmissions.submittedAt)).limit(30).offset((page - 1) * 30),
    tx.select({ total: sql<number>`count(*)::int` }).from(checklistSubmissions).where(where),
  ]);
  return { rows, total, page, pageSize: 30 };
}

export async function getSubmission(tx: Tx, actor: Actor, id: string) {
  const [s] = await tx.select({ s: checklistSubmissions, villa: properties, by: users.fullName, template: checklistTemplates.name })
    .from(checklistSubmissions).innerJoin(properties, eq(properties.id, checklistSubmissions.propertyId))
    .innerJoin(users, eq(users.id, checklistSubmissions.submittedBy))
    .innerJoin(checklistTemplates, eq(checklistTemplates.id, checklistSubmissions.templateId))
    .where(eq(checklistSubmissions.id, id));
  if (!s) throw new NotFoundError("Checklist tidak ditemukan.");
  await assertCanViewSubmission(tx, actor, s.s);
  const answers = await tx.select().from(checklistAnswers).where(eq(checklistAnswers.submissionId, id)).orderBy(asc(checklistAnswers.section), asc(checklistAnswers.label));
  const photos = await filesFor(tx, "checklist_answer", answers.map((a) => a.id));
  return { ...s, answers, photos };
}

async function assertCanViewSubmission(tx: Tx, actor: Actor, s: { submittedBy: string; propertyId: string }) {
  const sc = scopeOf(actor, "checklist.view");
  if (!sc) throw new ForbiddenError();
  if (sc === "own") { if (s.submittedBy !== actor.id) throw new ForbiddenError(); return; }
  const scope = await propertyScope(tx, actor, "checklist.view");
  if (scope !== "all" && !scope.includes(s.propertyId)) throw new ForbiddenError();
}

/** Attachment read policy for checklist answer photos. */
export async function assertCanViewAnswer(tx: Tx, actor: Actor, answerId: string) {
  const [r] = await tx.select({ s: checklistSubmissions, mr: checklistAnswers.maintenanceRequestId }).from(checklistAnswers)
    .innerJoin(checklistSubmissions, eq(checklistSubmissions.id, checklistAnswers.submissionId)).where(eq(checklistAnswers.id, answerId));
  if (!r) throw new NotFoundError();
  try {
    await assertCanViewSubmission(tx, actor, r.s);
  } catch (e) {
    // engineers reviewing a maintenance request created from this item may see its photos
    if (r.mr && actor.perms.has("maintenance.view")) {
      const scope = await propertyScope(tx, actor, "maintenance.view");
      if (scope === "all" || scope.includes(r.s.propertyId)) return;
    }
    throw e;
  }
}

/** For the Keeper workspace: assigned villas and whether today's checklist is done. */
export async function todayChecklistStatus(tx: Tx, actor: Actor) {
  const scope = await propertyScope(tx, actor, "property.view");
  if (scope === "all") return null; // supervisors: use the checklist list instead
  if (!scope.length) return [];
  const today = todayJakarta();
  const rows = await tx.select({
    id: properties.id, name: properties.name, code: properties.code, location: locations.name, status: properties.status,
    doneAt: sql<Date | null>`(select max(s.submitted_at) from checklist_submissions s where s.property_id = "properties"."id" and s.check_date = ${today})`,
    fails: sql<number | null>`(select s.fail_count from checklist_submissions s where s.property_id = "properties"."id" and s.check_date = ${today} order by s.submitted_at desc limit 1)`,
  }).from(properties).innerJoin(locations, eq(locations.id, properties.locationId))
    .where(and(inArray(properties.id, scope), sql`${properties.deletedAt} is null`)).orderBy(asc(properties.name));
  return rows;
}

export const DEFAULT_CHECKLIST: { section: string; label: string; category: string }[] = [
  { section: "Area luar", label: "Kondisi taman", category: "garden" },
  { section: "Area luar", label: "Kondisi kolam renang (air jernih, bersih)", category: "pool" },
  { section: "Area luar", label: "Filter / pompa kolam berfungsi", category: "pool" },
  { section: "Utilitas", label: "Semua lampu menyala", category: "electrical" },
  { section: "Utilitas", label: "AC berfungsi & dingin di semua kamar", category: "ac" },
  { section: "Utilitas", label: "Suplai air & tekanan air normal", category: "plumbing" },
  { section: "Utilitas", label: "Peralatan listrik (TV, kulkas, dll.) berfungsi", category: "appliance" },
  { section: "Utilitas", label: "Saluran air / toilet tidak bocor atau mampet", category: "plumbing" },
  { section: "Interior", label: "Kondisi kamar mandi", category: "plumbing" },
  { section: "Interior", label: "Kondisi furnitur", category: "furniture" },
  { section: "Interior", label: "Kebersihan umum", category: "other" },
  { section: "Keamanan", label: "Keselamatan umum (kunci, pagar, alat pemadam, P3K)", category: "safety" },
];
