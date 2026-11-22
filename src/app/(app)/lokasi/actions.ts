"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { createLocation, updateLocation, assignLocationUser, endLocationAssignment } from "@/services/properties";

const fields = (fd: FormData) => ({ code: str(fd, "code"), name: str(fd, "name"), area: str(fd, "area"), notes: str(fd, "notes") });

export async function createLocationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => ({ ok: true, data: (await createLocation(tx, actor, fields(fd))).id }));
  if (r?.ok) redirect(`/lokasi/${r.data}`);
  return r;
}
export async function updateLocationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const r = await runAction(async (actor, tx) => {
    await updateLocation(tx, actor, id, { ...fields(fd), isActive: str(fd, "isActive") === "1" });
    return { ok: true, message: "Lokasi disimpan." };
  });
  revalidatePath(`/lokasi/${id}`);
  return r;
}
export async function assignLocationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "locationId");
  const r = await runAction(async (actor, tx) => {
    await assignLocationUser(tx, actor, id, str(fd, "userId"), str(fd, "kind") === "hk_team_leader" ? "hk_team_leader" : "location_pic");
    return { ok: true, message: "Penugasan disimpan." };
  });
  revalidatePath(`/lokasi/${id}`);
  return r;
}
export async function endLocationAssignmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => { await endLocationAssignment(tx, actor, str(fd, "assignmentId")); return { ok: true }; });
  revalidatePath(`/lokasi/${str(fd, "locationId")}`);
  return r;
}
