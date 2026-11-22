"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, filesFrom, type ActionState } from "@/lib/action";
import { submitChecklist, addTemplateItem, setTemplateItemActive, createTemplate, setTemplateActive } from "@/services/checklists";
import { createRequestFromChecklist } from "@/services/maintenance";
import type { Priority } from "@/lib/labels";

export async function submitChecklistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const itemIds = [...fd.keys()].filter((k) => k.startsWith("a:")).map((k) => k.slice(2));
  const answers = await Promise.all(itemIds.map(async (id) => ({
    itemId: id, answer: str(fd, `a:${id}`) as "yes", note: str(fd, `n:${id}`), files: await filesFrom(fd, `f:${id}`),
  })));
  const r = await runAction(async (actor, tx) => {
    const s = await submitChecklist(tx, actor, { propertyId: str(fd, "propertyId"), templateId: str(fd, "templateId"), notes: str(fd, "notes"), answers });
    return { ok: true, data: s.id };
  });
  if (r?.ok) redirect(`/checklist/${r.data}?baru=1`);
  return r;
}

export async function reportItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => {
    const mr = await createRequestFromChecklist(tx, actor, str(fd, "answerId"), (str(fd, "priority") || "normal") as Priority, str(fd, "extra"));
    return { ok: true, message: `Dilaporkan ke Engineering (${mr.code}).` };
  });
  revalidatePath(`/checklist/${str(fd, "submissionId")}`);
  return r;
}

export async function createTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => ({ ok: true, data: (await createTemplate(tx, actor, { name: str(fd, "name"), description: str(fd, "description") })).id }));
  if (r?.ok) redirect(`/pengaturan/checklist/${r.data}`);
  return r;
}
export async function addItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "templateId");
  const r = await runAction(async (actor, tx) => {
    await addTemplateItem(tx, actor, id, { label: str(fd, "label"), section: str(fd, "section"), category: str(fd, "category") as "other", photoRequiredOnFail: fd.get("photo") === "1", sortOrder: Number(str(fd, "sortOrder") || 0) });
    return { ok: true, message: "Item ditambahkan." };
  });
  revalidatePath(`/pengaturan/checklist/${id}`);
  return r;
}
export async function toggleItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => { await setTemplateItemActive(tx, actor, str(fd, "itemId"), str(fd, "active") === "1"); return { ok: true }; });
  revalidatePath(`/pengaturan/checklist/${str(fd, "templateId")}`);
  return r;
}
export async function toggleTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => { await setTemplateActive(tx, actor, str(fd, "templateId"), str(fd, "active") === "1"); return { ok: true }; });
  revalidatePath(`/pengaturan/checklist/${str(fd, "templateId")}`);
  return r;
}
