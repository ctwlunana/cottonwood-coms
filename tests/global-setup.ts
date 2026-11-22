import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://coms:coms_dev@localhost:5432/coms_test";
  if (!/test/.test(url)) throw new Error("TEST_DATABASE_URL harus menunjuk ke database test.");
  process.env.BCRYPT_COST = "4";
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await migrate(drizzle(pool), { migrationsFolder: "./migrations" });
  process.env.DATABASE_URL = url;
  const { db, pool: appPool } = await import("../src/db");
  const { seedBase, seedDemo } = await import("../src/db/seed-core");
  await db.transaction(async (tx) => { await seedBase(tx); await seedDemo(tx); });
  await appPool.end();
  await pool.end();
}
