import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { startDatabaseDownload } from "@/services/backup";
import { ForbiddenError } from "@/lib/errors";
import { sameOrigin, downloadHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST only (state-changing: writes audit + backup log). Same-origin check guards against CSRF. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "bad origin" }, { status: 403 });
  try {
    const { filename, stream } = await startDatabaseDownload(s.actor);
    return new Response(stream, { headers: downloadHeaders(filename, "application/gzip") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ForbiddenError ? e.message : "Backup gagal" }, { status: e instanceof ForbiddenError ? 403 : 500 });
  }
}

