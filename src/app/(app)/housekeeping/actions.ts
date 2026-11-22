"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, filesFrom, type ActionState } from "@/lib/action";
import {
  createAssignment, assignStaff, startCleaning, completeCleaning, inspect, requestReclean, cancelAssignment, updateAssignment, saveTeam,
} from "@/services/housekeeping";
import type { Priority } from "@/lib/labels";

const jkt = (v: string) => (v ? new Date(v.length === 16 ? `${v}:00+07:00` : v) : undefined);

export async function createAssignmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => {
    const a = await createAssignment(tx, actor, {
      propertyId: str(fd, "propertyId"), checkoutDate: str(fd, "checkoutDate"), expectedDoneAt: jkt(str(fd, "expectedDoneAt")) as Date,
      teamId: str(fd, "teamId"), priority: (str(fd, "priority") || "normal") as Priority, instructions: str(fd, "instructions"), staffIds: fd.getAll("staffIds").map(String),
    });
    return { ok: true, data: a.id };
  });
  if (r?.ok) redirect(`/housekeeping/${r.data}`);
  return r;
}

export async function hkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const op = str(fd, "op");
  const files = await filesFrom(fd, "files");
  const r = await runAction(async (actor, tx) => {
    switch (op) {
      case "staff": await assignStaff(tx, actor, id, fd.getAll("staffIds").map(String)); return { ok: true, message: "Petugas disimpan." };
      case "start": await startCleaning(tx, actor, id); return { ok: true, message: "Pembersihan dimulai." };
      case "complete": await completeCleaning(tx, actor, id, str(fd, "note"), files); return { ok: true, message: "Selesai — menunggu inspeksi." };
      case "inspect": await inspect(tx, actor, id, str(fd, "result") === "pass" ? "pass" : "fail", str(fd, "note"), files); return { ok: true, message: "Hasil inspeksi disimpan." };
      case "reclean": await requestReclean(tx, actor, id, str(fd, "note")); return { ok: true, message: "Pembersihan ulang diminta." };
      case "cancel": await cancelAssignment(tx, actor, id, str(fd, "note")); return { ok: true, message: "Penugasan dibatalkan." };
      case "update": await updateAssignment(tx, actor, id, { expectedDoneAt: jkt(str(fd, "expectedDoneAt")), priority: (str(fd, "priority") || undefined) as Priority | undefined, instructions: str(fd, "instructions") }); return { ok: true, message: "Penugasan diperbarui." };
      default: return { ok: false, error: "Aksi tidak dikenal." };
    }
  });
  revalidatePath(`/housekeeping/${id}`);
  return r;
}

export async function teamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => {
    await saveTeam(tx, actor, str(fd, "id") || null, { name: str(fd, "name"), locationId: str(fd, "locationId"), leaderId: str(fd, "leaderId"), memberIds: fd.getAll("memberIds").map(String) });
    return { ok: true, message: "Tim disimpan." };
  });
  revalidatePath("/housekeeping/tim");
  return r;
}
