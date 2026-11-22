import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isWorkers } from "@/lib/runtime";
import { db } from "@/db";
import { validateSession } from "@/services/auth";
import { loadActor, type Actor, type RequestCtx } from "@/lib/authz";

export const SESSION_COOKIE = "coms_session";

/** Accept only plain IPv4/IPv6 literals (stored in an inet column). */
function isIpLiteral(s: string): boolean {
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s)) return true;
  return s.length <= 45 && /^[0-9a-f:]+$/i.test(s) && s.includes(":");
}

export async function requestCtx(): Promise<RequestCtx> {
  const h = await headers();
  // Only trust X-Forwarded-For when deployed behind our own reverse proxy.
  // On Cloudflare the true client IP is in CF-Connecting-IP (set by Cloudflare, not spoofable).
  const fwd = process.env.TRUST_PROXY === "true" ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : null;
  const raw = (isWorkers ? h.get("cf-connecting-ip") : null) || fwd || h.get("x-real-ip") || null;
  return { ip: raw && isIpLiteral(raw) ? raw : null, userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.COOKIE_SECURE === "true", maxAge: 7 * 86400,
  });
}
export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Current actor or null. Cached per request. */
export const getSession = cache(async (): Promise<{ actor: Actor; sessionId: string; mustChangePassword: boolean } | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await validateSession(db, token);
  if (!s) return null;
  try {
    const actor = await loadActor(db, s.userId, await requestCtx());
    return { actor, sessionId: s.sessionId, mustChangePassword: s.mustChangePassword };
  } catch {
    return null;
  }
});

/** For pages: redirect to login if not authenticated; force password change if required. */
export async function requireActor(opts: { allowPasswordChange?: boolean } = {}): Promise<Actor> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.mustChangePassword && !opts.allowPasswordChange) redirect("/profil?wajib=1");
  return s.actor;
}
