import "server-only";
import { db, type Tx } from "@/db";
import { AppError, AuthError, ValidationError } from "@/lib/errors";
import { dispatchPending } from "@/lib/notify";
import { getSession } from "@/lib/session";
import type { Actor } from "@/lib/authz";

export type ActionState = { ok?: boolean; error?: string; fields?: Record<string, string>; message?: string; data?: unknown } | null;

/**
 * Wrap a server action: authenticate, run the body in ONE transaction (so the change,
 * its audit entry and its notifications commit together), map domain errors to
 * user-facing messages, then deliver queued external notifications best-effort.
 */
export async function runAction<T extends ActionState>(fn: (actor: Actor, tx: Tx) => Promise<T>): Promise<T | ActionState> {
  const s = await getSession();
  if (!s) return { ok: false, error: new AuthError().message };
  if (s.mustChangePassword) return { ok: false, error: "Anda wajib mengganti password terlebih dahulu." };
  try {
    const out = await db.transaction((tx) => fn(s.actor, tx));
    db.transaction((tx) => dispatchPending(tx)).catch((e) => console.error("[notify] dispatch gagal", e));
    return out;
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message, fields: e.fields };
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("[action] error", e);
    return { ok: false, error: "Terjadi kesalahan sistem. Perubahan tidak disimpan. Silakan coba lagi." };
  }
}

export function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
}
