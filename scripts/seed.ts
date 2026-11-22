import "dotenv/config";
import { db, pool } from "../src/db";
import { seedBase, seedDemo, DEMO_PASSWORD } from "../src/db/seed-core";

async function main() {
  const demo = process.argv.includes("--demo");
  const resetMatrix = process.argv.includes("--reset-matrix");
  await db.transaction(async (tx) => {
    const base = await seedBase(tx, { resetMatrix });
    console.log(`Katalog hak akses & peran disinkronkan. Peran baru: ${base.createdRoles.join(", ") || "-"}`);
    if (demo) {
      if (process.env.NODE_ENV === "production") throw new Error("Data demo tidak boleh di-seed di production.");
      const r = await seedDemo(tx);
      if (r.skipped) console.log("Data demo sudah ada — dilewati.");
      else console.log(`Data DEMO dibuat: ${r.users} akun, ${r.villas} villa. Password semua akun demo: ${DEMO_PASSWORD}`);
    }
  });
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
