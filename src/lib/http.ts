/** CSRF guard for state-changing route handlers: request must come from our own origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}
export function downloadHeaders(filename: string, type: string): HeadersInit {
  return { "Content-Type": type, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}
