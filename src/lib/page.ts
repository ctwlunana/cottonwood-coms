import "server-only";
import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "./errors";

/** Run a page loader: NotFound → 404, Forbidden → { denied } so the page renders an access-denied view. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; denied: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) return { ok: false, denied: e.message };
    throw e;
  }
}
