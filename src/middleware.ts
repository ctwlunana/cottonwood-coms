import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/lupa-password", "/reset-password", "/api/health", "/api/cron"];

/** Cheap gate only (cookie presence). Real session + permission checks happen server-side on every request. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get("coms_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return new NextResponse(null, { status: 307, headers: { Location: "/login" } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
