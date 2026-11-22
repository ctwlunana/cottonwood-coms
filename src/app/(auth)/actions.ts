"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/db";
import { login, logout, requestPasswordReset, resetPassword } from "@/services/auth";
import { AppError } from "@/lib/errors";
import { requestCtx, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from "@/lib/session";
import type { ActionState } from "@/lib/action";

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requestCtx();
  let mustChange = false;
  try {
    // No wrapping transaction: failed-attempt rows must persist for rate limiting.
    const r = await login(db, String(fd.get("username") ?? ""), String(fd.get("password") ?? ""), ctx);
    await setSessionCookie(r.token);
    mustChange = r.mustChangePassword;
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : "Terjadi kesalahan sistem." };
  }
  redirect(mustChange ? "/profil?wajib=1" : "/dashboard");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await db.transaction(async (tx) => logout(tx, token, await requestCtx()));
  await clearSessionCookie();
  redirect("/login");
}

export async function forgotAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await db.transaction(async (tx) => requestPasswordReset(tx, String(fd.get("username") ?? ""), await requestCtx()));
  } catch (e) {
    console.error(e);
  }
  return { ok: true, message: "Jika username terdaftar, administrator telah diberi tahu dan akan mengirimkan link reset kepada Anda." };
}

export async function resetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const pw = String(fd.get("password") ?? ""), pw2 = String(fd.get("password2") ?? "");
  if (pw !== pw2) return { ok: false, error: "Konfirmasi password tidak sama." };
  try {
    await db.transaction(async (tx) => resetPassword(tx, String(fd.get("token") ?? ""), pw, await requestCtx()));
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : "Terjadi kesalahan sistem." };
  }
  redirect("/login?reset=1");
}
