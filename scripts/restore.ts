/**
 * Restore a COMS database backup (.json.gz from "Backup database") into an EMPTY database.
 *   1. create a new empty database, set DATABASE_URL to it
 *   2. npm run db:migrate            (do NOT run db:seed)
 *   3. npm run backup:restore -- path/to/coms-backup-database-YYYYMMDD-HHMM.json.gz
 * Files backup (.tar): `tar -xf coms-backup-files-*.tar` then upload the `files/` folder
 * contents to the R2 bucket (e.g. `rclone copy files/ r2:coms-files/`), keeping the paths.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { db, pool } from "../src/db";
import { parseBackupFile, restoreBackup } from "../src/services/backup";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Pakai: npm run backup:restore -- <file.json.gz>");
  const parsed = await parseBackupFile(new Uint8Array(await readFile(file)));
  console.log(`Backup dibuat ${parsed.header.createdAt} oleh ${parsed.header.createdBy ?? "-"}, ${parsed.tables.length} tabel.`);
  const counts = await db.transaction((tx) => restoreBackup(tx, parsed));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Restore selesai: ${total} baris.`);
  for (const [t, n] of Object.entries(counts)) if (n) console.log(`  ${t}: ${n}`);
  await pool.end();
}
main().catch(async (e) => { console.error("Restore GAGAL (tidak ada data yang disimpan):", e.message ?? e); await pool.end(); process.exit(1); });
