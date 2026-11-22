import { NextResponse } from "next/server";
import { lt, and, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { dispatchPending } from "@/lib/notify";
import { loginAttempts, sessions } from "@/db/schema";
import { runScheduledBackup } from "@/services/backup";
import { runReminders } from "@/services/reminders";

export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Scheduled jobs, invoked by the Cloudflare Cron Trigger (worker.ts → scheduled) with a secret.
 *   job=frequent : notification delivery + auth table housekeeping (every 5 min)
 *   job=backup   : nightly database backup into R2 (02:00 WIB)
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const job = new URL(req.url).searchParams.get("job") ?? "frequent";
  try {
    if (job === "backup") return NextResponse.json({ ok: true, backup: await runScheduledBackup() });
    const reminders = await db.transaction((tx) => runReminders(tx));
    const delivered = await db.transaction((tx) => dispatchPending(tx));
    const cutoff = new Date(Date.now() - 90 * 86400_000);
    await db.delete(loginAttempts).where(lt(loginAttempts.at, cutoff));
    await db.delete(sessions).where(and(lt(sessions.expiresAt, cutoff), or(isNotNull(sessions.revokedAt), lt(sessions.expiresAt, new Date()))));
    return NextResponse.json({ ok: true, reminders, delivered });
  } catch (e) {
    console.error(`[cron:${job}] gagal`, e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
