"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { runAction, str, type ActionState } from "@/lib/action";
import { changePassword, revokeMySession } from "@/services/auth";
import { setMyPreferences } from "@/services/notifications";
import { AppError } from "@/lib/errors";

/** Allowed even while a password change is forced (that's its purpose). */
export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Sesi tidak valid." };
  if (str(fd, "next") !== str(fd, "next2")) return { ok: false, error: "Konfirmasi password tidak sama." };
  try {
    await db.transaction((tx) => changePassword(tx, s.actor, s.sessionId, str(fd, "current"), str(fd, "next")));
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : "Terjadi kesalahan sistem." };
  }
  redirect("/dashboard");
}

export async function revokeSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (actor, tx) => { await revokeMySession(tx, actor, str(fd, "sessionId")); return { ok: true }; });
  revalidatePath("/profil");
  return r;
}

export async function preferencesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async (actor, tx) => {
    await setMyPreferences(tx, actor, { email: fd.get("email") === "1", whatsapp: fd.get("whatsapp") === "1" });
    return { ok: true, message: "Preferensi disimpan." };
  });
}
