/**
 * Create the first real account(s).
 *   npm run admin:create -- --username budi --name "Budi S" --code EMP-001 --role sysadmin
 *   npm run admin:create -- --username owner --name "Nama Owner" --code EMP-000 --role gm
 * Prints a one-time temporary password; the user must change it at first login.
 */
import "dotenv/config";
import { db, pool } from "../src/db";
import { bootstrapUser } from "../src/db/seed-core";
import { tempPassword } from "../src/lib/crypto";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const username = arg("username"), name = arg("name"), code = arg("code"), role = arg("role") ?? "sysadmin";
  if (!username || !name || !code) throw new Error("Wajib: --username --name --code [--role gm|sysadmin]");
  if (!["gm", "sysadmin"].includes(role)) throw new Error("Bootstrap hanya untuk peran gm atau sysadmin; peran lain dibuat dari aplikasi.");
  const pw = tempPassword();
  await db.transaction((tx) => bootstrapUser(tx, { username, fullName: name, employeeCode: code, roleSlug: role, deptCode: role === "gm" ? "MGT" : "IT", password: pw }));
  console.log(`Akun ${username} (${role}) dibuat.\nPassword sementara (tampil sekali): ${pw}\nWajib diganti saat login pertama.`);
  await pool.end();
}
main().catch(async (e) => { console.error(e.message ?? e); await pool.end(); process.exit(1); });
