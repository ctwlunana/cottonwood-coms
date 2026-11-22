"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { markAllRead } from "@/services/notifications";

export async function markAllReadAction(_: ActionState): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => { await markAllRead(tx, actor); return { ok: true }; });
  revalidatePath("/", "layout");
  if (r?.ok) redirect("/notifikasi");
  return r;
}
