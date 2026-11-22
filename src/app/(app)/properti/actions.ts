"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import {
  createProperty, updateProperty, archiveProperty, assignPropertyUser, endPropertyAssignment,
} from "@/services/properties";
import { addAttachments, removeAttachment } from "@/services/attachments";

function propertyFields(fd: FormData) {
  return {
    code: str(fd, "code"), name: str(fd, "name"), locationId: str(fd, "locationId"), address: str(fd, "address"),
    status: str(fd, "status") as "active", bedrooms: str(fd, "bedrooms") as unknown as number, bathrooms: str(fd, "bathrooms") as unknown as number,
    maxGuests: str(fd, "maxGuests") ? (str(fd, "maxGuests") as unknown as number) : null, notes: str(fd, "notes"),
  };
}

export async function createPropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => {
    const p = await createProperty(tx, actor, propertyFields(fd));
    return { ok: true, data: p.id };
  });
  if (r?.ok) redirect(`/properti/${r.data}`);
  return r;
}

export async function updatePropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const r = await runAction(async (actor, tx) => { await updateProperty(tx, actor, id, propertyFields(fd)); return { ok: true }; });
  if (r?.ok) redirect(`/properti/${id}`);
  return r;
}

export async function archivePropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const r = await runAction(async (actor, tx) => { await archiveProperty(tx, actor, id, str(fd, "archived") === "1"); return { ok: true }; });
  revalidatePath(`/properti/${id}`);
  return r;
}

export async function assignPropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "propertyId");
  const r = await runAction(async (actor, tx) => {
    await assignPropertyUser(tx, actor, id, str(fd, "userId"), str(fd, "kind") === "inspector" ? "inspector" : "villa_keeper");
    return { ok: true, message: "Penugasan disimpan." };
  });
  revalidatePath(`/properti/${id}`);
  return r;
}

export async function endPropertyAssignmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => { await endPropertyAssignment(tx, actor, str(fd, "assignmentId")); return { ok: true }; });
  revalidatePath(`/properti/${str(fd, "propertyId")}`);
  return r;
}

export async function uploadPropertyPhotosAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "propertyId");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const r = await runAction(async (actor, tx) => {
    const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const res = await addAttachments(tx, actor, "property", id, data);
    return { ok: true, message: `${res.length} foto diunggah.` };
  });
  revalidatePath(`/properti/${id}`);
  return r;
}

export async function removePhotoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => { await removeAttachment(tx, actor, str(fd, "attachmentId")); return { ok: true }; });
  revalidatePath(`/properti/${str(fd, "propertyId")}`);
  return r;
}
