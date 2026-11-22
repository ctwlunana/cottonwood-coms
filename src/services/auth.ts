import { and, eq, gt, isNull, sql, desc } from "drizzle-orm";
import type { Tx } from "@/db";
import { users, sessions, loginAttempts, passwordResetTokens, passwordResetRequests } from "@/db/schema";
import { hashPassword, verifyPassword, newToken, sha256, passwordPolicyError } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { AppError, AuthError, ValidationError, NotFoundError } from "@/lib/errors";
import { type Actor, type RequestCtx, requirePermission } from "@/lib/authz";
import { notify, usersWithPermission } from "@/lib/notify";
import { getSetting } from "./settings";

export const SESSION_ABSOLUTE_DAYS = 7;
export const RATE_WINDOW_MIN = 15;
export const MAX_FAILS_PER_USER = 5;
export const MAX_FAILS_PER_IP = 20;
export const RESET_TOKEN_HOURS = 2;

// Precomputed hash so login timing is similar for unknown usernames.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("dummy-password-for-timing-1"));

export type LoginResult = { token: string; userId: string; mustChangePassword: boolean };

async function recentFailures(tx: Tx, where: ReturnType<typeof eq>) {
  const since = new Date(Date.now() - RATE_WINDOW_MIN * 60_000);
  const [r] = await tx.select({ c: sql<number>`count(*)::int` }).from(loginAttempts)
    .where(and(where, eq(loginAttempts.success, false), gt(loginAttempts.at, since)));
  return r.c;
}

export async function login(tx: Tx, usernameRaw: string, password: string, ctx: RequestCtx): Promise<LoginResult> {
  const username = usernameRaw.trim().toLowerCase();
  if (!username || !password) throw new ValidationError("Username dan password wajib diisi.");

  if ((await recentFailures(tx, eq(loginAttempts.username, username))) >= MAX_FAILS_PER_USER
    || (ctx.ip && (await recentFailures(tx, eq(loginAttempts.ip, ctx.ip))) >= MAX_FAILS_PER_IP)) {
    throw new AppError("RATE_LIMITED", `Terlalu banyak percobaan login gagal. Coba lagi dalam ${RATE_WINDOW_MIN} menit.`, 429);
  }

  const [u] = await tx.select().from(users).where(eq(users.username, username));
  const ok = await verifyPassword(password, u?.passwordHash ?? (await getDummyHash()));
  if (!u || !ok || !u.isActive) {
    await tx.insert(loginAttempts).values({ username, ip: ctx.ip ?? null, success: false });
    await audit(tx, u ? { id: u.id } : null, {
      action: "auth.login_failed", entityType: "user", entityId: u?.id ?? null,
      after: { username, reason: !u ? "unknown_user" : !u.isActive ? "inactive" : "bad_password" },
    }, ctx);
    // Same message for every failure: don't reveal which usernames exist.
    throw new AuthError("Username atau password salah, atau akun tidak aktif.");
  }

  const token = newToken();
  await tx.insert(sessions).values({
    userId: u.id, tokenHash: sha256(token), ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 400) ?? null,
    expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_DAYS * 86400_000),
  });
  await tx.insert(loginAttempts).values({ username, ip: ctx.ip ?? null, success: true });
  await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await audit(tx, { id: u.id }, { action: "auth.login", entityType: "user", entityId: u.id }, ctx);
  return { token, userId: u.id, mustChangePassword: u.mustChangePassword };
}

/** Validate a session token. Returns the user id, or null when invalid/expired/revoked. */
export async function validateSession(tx: Tx, token: string | undefined | null): Promise<{ userId: string; sessionId: string; mustChangePassword: boolean } | null> {
  if (!token) return null;
  const [row] = await tx.select({ s: sessions, active: users.isActive, mcp: users.mustChangePassword })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)));
  if (!row || row.s.revokedAt || !row.active) return null;
  const now = Date.now();
  const idleHours = await getSetting<number>(tx, "session.idle_hours", 12);
  if (row.s.expiresAt.getTime() < now || row.s.lastSeenAt.getTime() + idleHours * 3600_000 < now) return null;
  // Touch at most once per minute to limit writes.
  if (now - row.s.lastSeenAt.getTime() > 60_000) {
    await tx.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.s.id));
  }
  return { userId: row.s.userId, sessionId: row.s.id, mustChangePassword: row.mcp };
}

export async function logout(tx: Tx, token: string, ctx: RequestCtx) {
  const [s] = await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: "logout" })
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt))).returning();
  if (s) await audit(tx, { id: s.userId }, { action: "auth.logout", entityType: "user", entityId: s.userId }, ctx);
}

export async function revokeAllSessions(tx: Tx, userId: string, reason: string, exceptSessionId?: string) {
  const conds = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (exceptSessionId) conds.push(sql`${sessions.id} <> ${exceptSessionId}`);
  await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(and(...conds));
}

export async function listMySessions(tx: Tx, actor: Actor) {
  return tx.select({
    id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt,
    lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt,
  }).from(sessions)
    .where(and(eq(sessions.userId, actor.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function revokeMySession(tx: Tx, actor: Actor, sessionId: string) {
  const [s] = await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: "revoked_by_user" })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, actor.id))).returning();
  if (!s) throw new NotFoundError("Sesi tidak ditemukan.");
  await audit(tx, actor, { action: "auth.session_revoked", entityType: "session", entityId: sessionId });
}

export async function changePassword(tx: Tx, actor: Actor, currentSessionId: string, current: string, next: string) {
  const [u] = await tx.select().from(users).where(eq(users.id, actor.id));
  if (!(await verifyPassword(current, u.passwordHash))) throw new ValidationError("Password saat ini salah.");
  const err = passwordPolicyError(next);
  if (err) throw new ValidationError(err);
  if (await verifyPassword(next, u.passwordHash)) throw new ValidationError("Password baru harus berbeda dari password lama.");
  await tx.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, passwordChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, actor.id));
  await revokeAllSessions(tx, actor.id, "password_changed", currentSessionId);
  await audit(tx, actor, { action: "auth.password_changed", entityType: "user", entityId: actor.id });
}

/**
 * "Forgot password" from the login page. Always returns silently (no user enumeration).
 * Without email configured, administrators are notified in-app to issue a reset link.
 */
export async function requestPasswordReset(tx: Tx, usernameRaw: string, ctx: RequestCtx) {
  const username = usernameRaw.trim().toLowerCase();
  const [u] = await tx.select().from(users).where(eq(users.username, username));
  if (!u || !u.isActive) return;
  const since = new Date(Date.now() - 30 * 60_000);
  const recent = await tx.select({ id: passwordResetRequests.id }).from(passwordResetRequests)
    .where(and(eq(passwordResetRequests.userId, u.id), gt(passwordResetRequests.createdAt, since))).limit(1);
  if (recent.length) return; // throttle
  const [req] = await tx.insert(passwordResetRequests).values({ userId: u.id, ip: ctx.ip ?? null }).returning();
  await audit(tx, null, { action: "auth.password_reset_requested", entityType: "user", entityId: u.id }, ctx);
  const admins = await usersWithPermission(tx, "employee.reset_password", [u.id]);
  await notify(tx, {
    type: "auth.password_reset_requested", userIds: admins, priority: "normal",
    title: "Permintaan reset password",
    body: `${u.fullName} (${u.username}) meminta reset password.`,
    link: `/karyawan/${u.id}`, entityType: "user", entityId: u.id, dedupeKey: `pwreset:${req.id}`,
  });
}

/** Admin issues a one-time reset link (shown once; only the hash is stored). */
export async function issueResetToken(tx: Tx, actor: Actor, userId: string): Promise<{ token: string; expiresAt: Date }> {
  requirePermission(actor, "employee.reset_password");
  if (userId === actor.id) throw new ValidationError("Gunakan menu Profil untuk mengganti password Anda sendiri.");
  const [u] = await tx.select().from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError("Karyawan tidak ditemukan.");
  if (!u.isActive) throw new ValidationError("Akun tidak aktif. Aktifkan akun terlebih dahulu.");
  // invalidate older unused tokens
  await tx.update(passwordResetTokens).set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 3600_000);
  await tx.insert(passwordResetTokens).values({ userId, tokenHash: sha256(token), issuedBy: actor.id, expiresAt });
  await tx.update(passwordResetRequests).set({ handledAt: new Date(), handledBy: actor.id })
    .where(and(eq(passwordResetRequests.userId, userId), isNull(passwordResetRequests.handledAt)));
  await audit(tx, actor, { action: "auth.reset_link_issued", entityType: "user", entityId: userId, after: { expiresAt } });
  return { token, expiresAt };
}

export async function checkResetToken(tx: Tx, token: string) {
  const [t] = await tx.select({ t: passwordResetTokens, fullName: users.fullName, username: users.username })
    .from(passwordResetTokens).innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, sha256(token)));
  if (!t || t.t.usedAt || t.t.expiresAt.getTime() < Date.now()) return null;
  return { userId: t.t.userId, fullName: t.fullName, username: t.username, tokenId: t.t.id };
}

export async function resetPassword(tx: Tx, token: string, next: string, ctx: RequestCtx) {
  const t = await checkResetToken(tx, token);
  if (!t) throw new ValidationError("Link reset tidak valid atau sudah kedaluwarsa.");
  const err = passwordPolicyError(next);
  if (err) throw new ValidationError(err);
  await tx.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, passwordChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, t.userId));
  await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, t.tokenId));
  await revokeAllSessions(tx, t.userId, "password_reset");
  await audit(tx, { id: t.userId }, { action: "auth.password_reset", entityType: "user", entityId: t.userId }, ctx);
}
