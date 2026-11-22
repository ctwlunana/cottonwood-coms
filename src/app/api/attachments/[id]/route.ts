import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { readAttachment } from "@/services/attachments";
import { AppError } from "@/lib/errors";

/** Authorized file download: access is checked against the owning record every time. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  try {
    const { meta, data } = await readAttachment(db, s.actor, id);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": meta.mime,
        "Content-Disposition": `${meta.mime === "application/pdf" ? "attachment" : "inline"}; filename="${encodeURIComponent(meta.originalName ?? "file")}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 404;
    return NextResponse.json({ error: "not available" }, { status });
  }
}
