import { sql } from "drizzle-orm";
import type { Tx } from "@/db";

/**
 * Transactional, gap-free human code generator: e.g. nextCode(tx, "WO", { yearly: true }) → "WO-2026-000001".
 * Uses an UPSERT on id_counters so concurrent transactions serialize on the counter row.
 */
export async function nextCode(tx: Tx, prefix: string, opts: { yearly?: boolean; pad?: number } = {}): Promise<string> {
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Jakarta", year: "numeric" }).format(new Date());
  const key = opts.yearly ? `${prefix}-${year}` : prefix;
  const res = await tx.execute<{ value: number }>(sql`
    INSERT INTO id_counters (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = id_counters.value + 1
    RETURNING value`);
  const n = Number(res.rows[0].value);
  return `${key}-${String(n).padStart(opts.pad ?? (opts.yearly ? 6 : 3), "0")}`;
}
