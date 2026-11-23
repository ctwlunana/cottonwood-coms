import type { NextRequest } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { markRead } from "@/services/notifications";

/**
 * Opening a notification marks it read and redirects to the related record.
 * Note: GET with a side-effect limited to the user's own read-flag (idempotent, no CSRF risk of consequence).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 303, headers: { Location: "/login" } });
  const { id } = await params;
  let link: string | null = null;
  try { link = await markRead(db, s.actor, id); } catch { /* not found → list */ }
  const safe = link && link.startsWith("/") && !link.startsWith("//") ? link : "/notifikasi";
  // Relative Location: independent of how the runtime reports the request host.
  return new Response(null, { status: 303, headers: { Location: safe } });
}
