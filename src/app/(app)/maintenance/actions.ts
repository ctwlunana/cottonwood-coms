"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, filesFrom, type ActionState } from "@/lib/action";
import {
  createRequest, reviewRequest, assignWorkOrder, changePriority, startWork, setWaiting, addWoPhotos, addComment, addMaterial,
  completeWork, verifyWork, keeperConfirm, cancelWorkOrder, setEstimatedCost, createEquipment, createPmSchedule, setPmActive,
} from "@/services/maintenance";
import type { Priority } from "@/lib/labels";

const optDate = (v: string) => (v ? new Date(v.length === 16 ? `${v}:00+07:00` : v) : undefined);

export async function reportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const files = await filesFrom(fd, "files");
  const r = await runAction(async (actor, tx) => {
    const mr = await createRequest(tx, actor, {
      propertyId: str(fd, "propertyId"), category: str(fd, "category") as "other", priority: str(fd, "priority") as Priority,
      description: str(fd, "description"), discoveredAt: optDate(str(fd, "discoveredAt")),
    }, files);
    return { ok: true, data: mr.id };
  });
  if (r?.ok) redirect(`/maintenance/permintaan/${r.data}?baru=1`);
  return r;
}

export async function reviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "requestId");
  const action = str(fd, "action");
  const r = await runAction(async (actor, tx) => {
    const input = action === "convert" ? {
      action: "convert" as const, title: str(fd, "title"), priority: str(fd, "priority") as Priority, assignTo: str(fd, "assignTo"),
      vendorName: str(fd, "vendorName"), deadline: optDate(str(fd, "deadline")), estimatedCost: str(fd, "estimatedCost") ? Number(str(fd, "estimatedCost").replace(/\D/g, "")) : undefined,
      keeperConfirmationRequired: fd.get("keeperConfirmationRequired") === "1", note: str(fd, "note"),
    } : action === "merge" ? { action: "merge" as const, workOrderId: str(fd, "workOrderId"), note: str(fd, "note") }
      : { action: "reject" as const, note: str(fd, "note") };
    const res = await reviewRequest(tx, actor, id, input);
    return { ok: true, data: res.workOrder?.id ?? null };
  });
  if (r?.ok && r.data) redirect(`/maintenance/${r.data}`);
  revalidatePath(`/maintenance/permintaan/${id}`);
  return r;
}

/** One action endpoint for all work-order transitions; the service enforces who may do what. */
export async function woAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const op = str(fd, "op");
  const files = await filesFrom(fd, "files");
  const r = await runAction(async (actor, tx) => {
    switch (op) {
      case "assign": await assignWorkOrder(tx, actor, id, { assignTo: str(fd, "assignTo"), vendorName: str(fd, "vendorName"), deadline: optDate(str(fd, "deadline")), note: str(fd, "note") }); return { ok: true, message: "Penugasan disimpan." };
      case "priority": await changePriority(tx, actor, id, str(fd, "priority") as Priority, str(fd, "note")); return { ok: true, message: "Prioritas diubah." };
      case "start": await startWork(tx, actor, id, files, str(fd, "note")); return { ok: true, message: "Pekerjaan dimulai." };
      case "waiting": await setWaiting(tx, actor, id, str(fd, "status") as "waiting_parts", str(fd, "note")); return { ok: true, message: "Status diperbarui." };
      case "resume": await startWork(tx, actor, id, files, str(fd, "note") || "Dilanjutkan"); return { ok: true, message: "Pekerjaan dilanjutkan." };
      case "photos": await addWoPhotos(tx, actor, id, str(fd, "kind") as "before", files); return { ok: true, message: "Foto ditambahkan." };
      case "comment": await addComment(tx, actor, id, str(fd, "note")); return { ok: true, message: "Catatan ditambahkan." };
      case "material": await addMaterial(tx, actor, id, { description: str(fd, "description"), quantity: Number(str(fd, "quantity")), unit: str(fd, "unit"), unitCost: str(fd, "unitCost") ? Number(str(fd, "unitCost").replace(/\D/g, "")) : undefined }); return { ok: true, message: "Material dicatat." };
      case "complete": await completeWork(tx, actor, id, { findings: str(fd, "findings"), repairNotes: str(fd, "repairNotes"), actualCost: str(fd, "actualCost") ? Number(str(fd, "actualCost").replace(/\D/g, "")) : undefined }, files); return { ok: true, message: "Ditandai selesai — menunggu verifikasi." };
      case "verify": await verifyWork(tx, actor, id, str(fd, "decision") === "approve", str(fd, "note")); return { ok: true, message: "Verifikasi disimpan." };
      case "confirm": await keeperConfirm(tx, actor, id, str(fd, "decision") === "ok", str(fd, "note")); return { ok: true, message: "Konfirmasi disimpan." };
      case "cancel": await cancelWorkOrder(tx, actor, id, str(fd, "note")); return { ok: true, message: "Work order dibatalkan." };
      case "estimate": await setEstimatedCost(tx, actor, id, Number(str(fd, "estimatedCost").replace(/\D/g, ""))); return { ok: true, message: "Estimasi disimpan." };
      default: return { ok: false, error: "Aksi tidak dikenal." };
    }
  });
  revalidatePath(`/maintenance/${id}`);
  return r;
}

export async function equipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => {
    await createEquipment(tx, actor, { propertyId: str(fd, "propertyId"), name: str(fd, "name"), category: str(fd, "category") as "ac", brand: str(fd, "brand"), model: str(fd, "model"), serialNo: str(fd, "serialNo"), installedOn: str(fd, "installedOn"), notes: str(fd, "notes") });
    return { ok: true, message: "Peralatan disimpan." };
  });
  revalidatePath("/maintenance/preventif");
  return r;
}
export async function pmAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => {
    if (str(fd, "op") === "toggle") { await setPmActive(tx, actor, str(fd, "id"), str(fd, "active") === "1"); return { ok: true }; }
    await createPmSchedule(tx, actor, { propertyId: str(fd, "propertyId"), equipmentId: str(fd, "equipmentId"), title: str(fd, "title"), category: str(fd, "category") as "ac", intervalDays: Number(str(fd, "intervalDays")), nextDueOn: str(fd, "nextDueOn"), defaultAssigneeId: str(fd, "defaultAssigneeId"), instructions: str(fd, "instructions") });
    return { ok: true, message: "Jadwal preventif disimpan." };
  });
  revalidatePath("/maintenance/preventif");
  return r;
}
