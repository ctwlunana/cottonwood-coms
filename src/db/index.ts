import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
/** A transaction or the root db — services accept either. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

declare global {
  // eslint-disable-next-line no-var
  var __comsPool: Pool | undefined;
}

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diatur");
  return new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
}

// Reuse pool across hot reloads in dev.
export const pool: Pool = globalThis.__comsPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalThis.__comsPool = pool;

export const db: DB = drizzle(pool, { schema });
export { schema };
