import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { downloadScheduledBackup } from "@/services/backup";
import { ForbiddenError } from "@/lib/errors";
import { sameOrigin, downloadHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "bad origin" }, { status: 403 });
  const key = String((await req.formData()).get("key") ?? "");
  try {
    const { filename, data } = await downloadScheduledBackup(s.actor, key);
    return new Response(data as unknown as BodyInit, { headers: downloadHeaders(filename, "application/gzip") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ForbiddenError ? e.message : "File tidak ditemukan" }, { status: e instanceof ForbiddenError ? 403 : 404 });
  }
}
