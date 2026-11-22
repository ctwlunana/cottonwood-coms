import type { Tx } from "@/db";
import { auditLogs } from "@/db/schema";
import type { Actor, RequestCtx } from "./authz";

const REDACT = new Set(["passwordHash", "password_hash", "tokenHash", "token_hash", "password"]);

function clean(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(clean);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = REDACT.has(k) ? "[disamarkan]" : clean(val);
  return out;
}

/** Only keep keys that changed, so audit rows show a readable diff. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    const bv = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const av = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) { b[k] = before[k]; a[k] = after[k]; }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

/**
 * Write an audit entry. MUST be called with the same transaction as the change it
 * describes, so the change and its audit record commit (or fail) together.
 */
export async function audit(
  tx: Tx,
  actor: Pick<Actor, "id" | "ip" | "userAgent"> | null,
  e: { action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown },
  ctx?: RequestCtx,
) {
  await tx.insert(auditLogs).values({
    userId: actor?.id ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: e.before === undefined ? null : clean(e.before),
    after: e.after === undefined ? null : clean(e.after),
    ip: ctx?.ip ?? actor?.ip ?? null,
    userAgent: ctx?.userAgent ?? actor?.userAgent ?? null,
  });
}
