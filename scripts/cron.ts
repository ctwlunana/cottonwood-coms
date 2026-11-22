/**
 * Scheduled jobs — run every 5 minutes from system cron / a platform scheduler:
 *   *\/5 * * * *  cd /opt/coms && npm run cron >> /var/log/coms-cron.log 2>&1
 * Stage 1: deliver pending external notifications, housekeeping of auth tables.
 * Later stages add reminders, overdue detection and escalations here.
 */
import "dotenv/config";
import { lt, and, isNotNull, or } from "drizzle-orm";
import { db, pool } from "../src/db";
import { dispatchPending } from "../src/lib/notify";
import { loginAttempts, sessions } from "../src/db/schema";

async function main() {
  const started = Date.now();
  const r = await db.transaction((tx) => dispatchPending(tx));
  // Keep 90 days of login attempts and revoked/expired sessions (the audit log keeps the permanent record).
  const cutoff = new Date(Date.now() - 90 * 86400_000);
  await db.delete(loginAttempts).where(lt(loginAttempts.at, cutoff));
  await db.delete(sessions).where(and(lt(sessions.expiresAt, cutoff), or(isNotNull(sessions.revokedAt), lt(sessions.expiresAt, new Date()))));
  console.log(`[cron ${new Date().toISOString()}] notifikasi: ${JSON.stringify(r)} (${Date.now() - started} ms)`);
  await pool.end();
}
main().catch(async (e) => { console.error("[cron] GAGAL", e); await pool.end(); process.exit(1); });
