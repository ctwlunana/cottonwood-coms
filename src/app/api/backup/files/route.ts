import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { startFilesDownload } from "@/services/backup";
import { ForbiddenError } from "@/lib/errors";
import { sameOrigin, downloadHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "bad origin" }, { status: 403 });
  try {
    const { filename, stream } = await startFilesDownload(s.actor);
    return new Response(stream, { headers: downloadHeaders(filename, "application/x-tar") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ForbiddenError ? e.message : "Backup gagal" }, { status: e instanceof ForbiddenError ? 403 : 500 });
  }
}
