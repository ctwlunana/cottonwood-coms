import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { inTx, actorFor, userId } from "./helpers";
import { login, validateSession, logout, requestPasswordReset, issueResetToken, resetPassword, changePassword, MAX_FAILS_PER_USER } from "@/services/auth";
import { setEmployeeActive } from "@/services/employees";
import { auditLogs, notifications, users } from "@/db/schema";
import { DEMO_PASSWORD } from "@/db/seed-core";

const ctx = { ip: "10.0.0.1", userAgent: "vitest" };

describe("authentication", () => {
  it("logs in, validates the session and logs out", () => inTx(async (tx) => {
    const r = await login(tx, "demo.keeper1", DEMO_PASSWORD, ctx);
    expect(r.token.length).toBeGreaterThan(30);
    const s = await validateSession(tx, r.token);
    expect(s?.userId).toBe(await userId(tx, "demo.keeper1"));
    await logout(tx, r.token, ctx);
    expect(await validateSession(tx, r.token)).toBeNull();
    const logs = await tx.select().from(auditLogs).where(eq(auditLogs.entityId, s!.userId));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["auth.login", "auth.logout"]));
  }));

  it("usernames are case-insensitive and a wrong password gives a generic error", () => inTx(async (tx) => {
    await expect(login(tx, "DEMO.KEEPER1", DEMO_PASSWORD, ctx)).resolves.toBeTruthy();
    await expect(login(tx, "demo.keeper1", "wrong", ctx)).rejects.toThrow(/Username atau password salah/);
    await expect(login(tx, "tidak.ada", "wrong", ctx)).rejects.toThrow(/Username atau password salah/);
  }));

  it("rate-limits after repeated failures, even with the right password", () => inTx(async (tx) => {
    for (let i = 0; i < MAX_FAILS_PER_USER; i++) await expect(login(tx, "demo.cs1", "bad", ctx)).rejects.toThrow();
    await expect(login(tx, "demo.cs1", DEMO_PASSWORD, ctx)).rejects.toThrow(/Terlalu banyak/);
  }));

  it("deactivation blocks login and kills existing sessions immediately", () => inTx(async (tx) => {
    const admin = await actorFor(tx, "demo.sysadmin");
    const r = await login(tx, "demo.hk1", DEMO_PASSWORD, ctx);
    await setEmployeeActive(tx, admin, await userId(tx, "demo.hk1"), false);
    expect(await validateSession(tx, r.token)).toBeNull();
    await expect(login(tx, "demo.hk1", DEMO_PASSWORD, ctx)).rejects.toThrow();
  }));

  it("cannot deactivate yourself", () => inTx(async (tx) => {
    const admin = await actorFor(tx, "demo.sysadmin");
    await expect(setEmployeeActive(tx, admin, admin.id, false)).rejects.toThrow(/sendiri/);
  }));

  it("password reset: request notifies admins, link is single-use and revokes sessions", () => inTx(async (tx) => {
    const target = await userId(tx, "demo.eng1");
    const sess = await login(tx, "demo.eng1", DEMO_PASSWORD, ctx);
    await requestPasswordReset(tx, "demo.eng1", ctx);
    await requestPasswordReset(tx, "tidak.ada", ctx); // silent
    const adminId = await userId(tx, "demo.sysadmin");
    const n = await tx.select().from(notifications).where(and(eq(notifications.userId, adminId), eq(notifications.type, "auth.password_reset_requested")));
    expect(n.length).toBe(1);

    const admin = await actorFor(tx, "demo.sysadmin");
    const { token } = await issueResetToken(tx, admin, target);
    await expect(resetPassword(tx, token, "short", ctx)).rejects.toThrow(/minimal/);
    await resetPassword(tx, token, "NewPassword123", ctx);
    expect(await validateSession(tx, sess.token)).toBeNull();
    await expect(resetPassword(tx, token, "OtherPassword123", ctx)).rejects.toThrow(/tidak valid/);
    await expect(login(tx, "demo.eng1", "NewPassword123", ctx)).resolves.toBeTruthy();
  }));

  it("users without employee.reset_password cannot issue reset links", () => inTx(async (tx) => {
    const keeper = await actorFor(tx, "demo.keeper1");
    await expect(issueResetToken(tx, keeper, await userId(tx, "demo.keeper2"))).rejects.toThrow(/hak akses/);
  }));

  it("change password enforces policy and keeps only the current session", () => inTx(async (tx) => {
    const a = await login(tx, "demo.cs2", DEMO_PASSWORD, ctx);
    const b = await login(tx, "demo.cs2", DEMO_PASSWORD, ctx);
    const actor = await actorFor(tx, "demo.cs2");
    const sa = await validateSession(tx, a.token);
    await expect(changePassword(tx, actor, sa!.sessionId, DEMO_PASSWORD, "abc")).rejects.toThrow();
    await changePassword(tx, actor, sa!.sessionId, DEMO_PASSWORD, "BrandNewPass99");
    expect(await validateSession(tx, a.token)).not.toBeNull();
    expect(await validateSession(tx, b.token)).toBeNull();
    const [u] = await tx.select().from(users).where(eq(users.id, actor.id));
    expect(u.mustChangePassword).toBe(false);
  }));
});
