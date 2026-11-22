import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { isWorkers, cfEnv, cfCtx } from "@/lib/runtime";

export type DB = NodePgDatabase<typeof schema>;
/** A transaction or the root db — services accept either. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

declare global {
  // eslint-disable-next-line no-var
  var __comsPool: Pool | undefined;
}

function nodePool(): Pool {
  if (!globalThis.__comsPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL belum diatur");
    globalThis.__comsPool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
  }
  return globalThis.__comsPool;
}

/**
 * Cloudflare Workers may not share sockets between requests, so each request gets its own
 * small pool connected through Hyperdrive (which does the real connection pooling at the edge).
 * Max 4 connections stays under the Workers limit of 6 simultaneous outgoing connections.
 */
const perRequest = new WeakMap<object, DB>();
function workersDb(): DB {
  const ctx = cfCtx();
  let d = perRequest.get(ctx);
  if (!d) {
    const hd = cfEnv().HYPERDRIVE;
    if (!hd) throw new Error("Binding HYPERDRIVE belum dikonfigurasi");
    d = drizzle(new Pool({ connectionString: hd.connectionString, max: 4 }), { schema });
    perRequest.set(ctx, d);
  }
  return d;
}

let nodeDb: DB | undefined;
function current(): DB {
  if (isWorkers) return workersDb();
  return (nodeDb ??= drizzle(nodePool(), { schema }));
}

/** The database handle. Resolves to the right connection for the current runtime/request. */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = current() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

/** Node-only pool (scripts close it when done). */
export const pool = { end: async () => { if (globalThis.__comsPool) { await globalThis.__comsPool.end(); globalThis.__comsPool = undefined; nodeDb = undefined; } } };
export { schema };
