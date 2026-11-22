import { sql, desc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { attachments, backupLogs, users } from "@/db/schema";
import { type Actor, requirePermission } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { storage, type Storage } from "@/lib/storage";

/**
 * Backups.
 *  - Database: a consistent (REPEATABLE READ snapshot) logical export of every table in
 *    FK-dependency order, streamed as JSON and gzip-compressed. Works on Cloudflare Workers
 *    (no pg_dump there) with constant memory. Restorable with `npm run backup:restore`.
 *  - Files: a streamed .tar of every uploaded file (photos, documents).
 * Only holders of `backup.run` (GM / "Manager ke atas") can download; every download is audited.
 */

export const BACKUP_FORMAT = "coms-backup";
export const BACKUP_VERSION = 1;
const BATCH = 1000;

type ColumnInfo = { name: string; type: string };
export type BackupHeader = {
  format: typeof BACKUP_FORMAT; version: number; createdAt: string; createdBy: string | null;
  migrations: string[]; tableOrder: string[];
};
export type BackupTable = { name: string; columns: ColumnInfo[]; rows: unknown[][] };

/** Public tables sorted so every table comes after the tables it references. */
export async function tableOrder(tx: Tx): Promise<string[]> {
  const tables = (await tx.execute<{ t: string }>(sql`select tablename as t from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.t);
  const deps = (await tx.execute<{ child: string; parent: string }>(sql`
    select c.relname as child, p.relname as parent from pg_constraint k
    join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f' and n.nspname = 'public'`)).rows;
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t)) return;
    if (stack.has(t)) return; // self/cyclic reference: order within cycle doesn't matter for inserts with deferred checks
    stack.add(t);
    for (const d of deps) if (d.child === t && d.parent !== t) visit(d.parent, stack);
    stack.delete(t);
    seen.add(t);
    out.push(t);
  };
  tables.forEach((t) => visit(t, new Set()));
  return out;
}

async function columnsOf(tx: Tx, table: string): Promise<ColumnInfo[]> {
  return (await tx.execute<{ name: string; type: string }>(sql`
    select column_name as name, udt_name as type from information_schema.columns
    where table_schema = 'public' and table_name = ${table} order by ordinal_position`)).rows;
}

async function appliedMigrations(tx: Tx): Promise<string[]> {
  try {
    return (await tx.execute<{ hash: string }>(sql`select hash from drizzle.__drizzle_migrations order by id`)).rows.map((r) => r.hash);
  } catch {
    return [];
  }
}

const enc = new TextEncoder();

/**
 * Stream an uncompressed JSON backup. `onDone` receives totals after the last byte.
 * Runs inside one REPEATABLE READ transaction so all tables come from the same instant.
 */
export function databaseBackupStream(createdBy: string | null, onDone?: (t: { tables: number; rows: number }) => Promise<void>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let totalRows = 0;
        let tableCount = 0;
        await db.transaction(async (tx) => {
          const order = await tableOrder(tx);
          const header: BackupHeader = {
            format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), createdBy,
            migrations: await appliedMigrations(tx), tableOrder: order,
          };
          controller.enqueue(enc.encode(`{"header":${JSON.stringify(header)},"tables":[`));
          for (const [ti, t] of order.entries()) {
            const cols = await columnsOf(tx, t);
            controller.enqueue(enc.encode(`${ti ? "," : ""}{"name":${JSON.stringify(t)},"columns":${JSON.stringify(cols)},"rows":[`));
            let last: string | null = null;
            let first = true;
            for (;;) {
              const res: { rows: Record<string, unknown>[] } = await tx.execute<Record<string, unknown>>(last === null
                ? sql`select ctid::text as __ctid, * from ${sql.identifier(t)} order by ctid limit ${BATCH}`
                : sql`select ctid::text as __ctid, * from ${sql.identifier(t)} where ctid > ${last}::tid order by ctid limit ${BATCH}`);
              if (!res.rows.length) break;
              const parts = res.rows.map((r: Record<string, unknown>) => JSON.stringify(cols.map((c) => r[c.name] ?? null)));
              controller.enqueue(enc.encode((first ? "" : ",") + parts.join(",")));
              first = false;
              totalRows += res.rows.length;
              last = String(res.rows[res.rows.length - 1].__ctid);
              if (res.rows.length < BATCH) break;
            }
            controller.enqueue(enc.encode("]}"));
            tableCount++;
          }
          controller.enqueue(enc.encode("]}"));
        }, { isolationLevel: "repeatable read", accessMode: "read only" });
        await onDone?.({ tables: tableCount, rows: totalRows });
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}

export function gzip(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return stream.pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
}
export function gunzip(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return stream.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
}

function stamp(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}${g("month")}${g("day")}-${g("hour")}${g("minute")}`;
}

/** Manual download of the database backup (GM / Manager+). */
export async function startDatabaseDownload(actor: Actor): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  requirePermission(actor, "backup.run");
  await db.transaction((tx) => audit(tx, actor, { action: "backup.database_download_started", entityType: "backup" }));
  const stream = databaseBackupStream(actor.fullName, async (t) => {
    await db.transaction(async (tx) => {
      await tx.insert(backupLogs).values({ kind: "database", trigger: "manual_download", requestedBy: actor.id, tables: t.tables, rows: t.rows });
      await audit(tx, actor, { action: "backup.database_downloaded", entityType: "backup", after: t });
    });
  });
  return { filename: `coms-backup-database-${stamp()}.json.gz`, stream: gzip(stream) };
}

// ------------------------------------------------------------------ files (.tar)
function tarHeader(name: string, size: number, mtime: Date): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, off: number, len: number) => { const b = enc.encode(s); h.set(b.subarray(0, len), off); };
  const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, "0") + "\0";
  put(name.slice(0, 99), 0, 100);
  put(oct(0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(Math.floor(mtime.getTime() / 1000), 12), 136, 12);
  put("        ", 148, 8);
  put("0", 156, 1);
  put("ustar\u000000", 257, 8);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}
function tarEntry(name: string, data: Uint8Array, mtime = new Date()): Uint8Array[] {
  const pad = (512 - (data.length % 512)) % 512;
  return [tarHeader(name, data.length, mtime), data, new Uint8Array(pad)];
}

/** Manual download of every uploaded file as a .tar (with a manifest). */
export async function startFilesDownload(actor: Actor, store: Storage = storage()): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  requirePermission(actor, "backup.run");
  const rows = await db.select().from(attachments);
  await db.transaction((tx) => audit(tx, actor, { action: "backup.files_download_started", entityType: "backup", after: { files: rows.length } }));
  let i = 0, ok = 0;
  const missing: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < rows.length) {
        const a = rows[i++];
        try {
          const data = await store.get(a.storageKey);
          for (const part of tarEntry(`files/${a.storageKey}`, data, a.createdAt)) controller.enqueue(part);
          ok++;
        } catch {
          missing.push(a.storageKey);
        }
        return;
      }
      const manifest = enc.encode(JSON.stringify({
        format: "coms-files-backup", createdAt: new Date().toISOString(), createdBy: actor.fullName, missing,
        files: rows.map((r) => ({ id: r.id, key: r.storageKey, name: r.originalName, mime: r.mime, entityType: r.entityType, entityId: r.entityId, deleted: Boolean(r.deletedAt) })),
      }, null, 1));
      for (const part of tarEntry("MANIFEST.json", manifest)) controller.enqueue(part);
      controller.enqueue(new Uint8Array(1024)); // end-of-archive
      await db.transaction(async (tx) => {
        await tx.insert(backupLogs).values({ kind: "files", trigger: "manual_download", requestedBy: actor.id, files: ok, status: missing.length ? "completed_with_missing" : "completed", error: missing.length ? `${missing.length} file tidak ditemukan` : null });
        await audit(tx, actor, { action: "backup.files_downloaded", entityType: "backup", after: { files: ok, missing: missing.length } });
      });
      controller.close();
    },
  });
  return { filename: `coms-backup-files-${stamp()}.tar`, stream };
}

// ------------------------------------------------------------------ scheduled (to object storage)
export const SCHEDULED_PREFIX = "backups/";

/** Nightly automatic backup into object storage (R2), pruned after BACKUP_KEEP_DAYS (default 30). */
export async function runScheduledBackup(store: Storage = storage()) {
  try {
    let totals = { tables: 0, rows: 0 };
    const buf = new Uint8Array(await new Response(gzip(databaseBackupStream("Terjadwal", async (t) => { totals = t; }))).arrayBuffer());
    const key = await store.put(buf, "json.gz", { key: `${SCHEDULED_PREFIX}coms-backup-database-${stamp()}.json.gz`, contentType: "application/gzip" });
    const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 30);
    const cutoff = Date.now() - keepDays * 86400_000;
    const old = (await store.list(SCHEDULED_PREFIX)).filter((o) => o.uploaded.getTime() < cutoff);
    for (const o of old) await store.delete(o.key);
    await db.insert(backupLogs).values({ kind: "database", trigger: "scheduled", storageKey: key, tables: totals.tables, rows: totals.rows, sizeBytes: buf.length });
    return { key, size: buf.length, pruned: old.length };
  } catch (e) {
    await db.insert(backupLogs).values({ kind: "database", trigger: "scheduled", status: "failed", error: String((e as Error).message).slice(0, 500) });
    throw e;
  }
}

export async function listScheduledBackups(actor: Actor, store: Storage = storage()) {
  requirePermission(actor, "backup.run");
  return (await store.list(SCHEDULED_PREFIX)).sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());
}

export async function downloadScheduledBackup(actor: Actor, key: string, store: Storage = storage()) {
  requirePermission(actor, "backup.run");
  if (!key.startsWith(SCHEDULED_PREFIX) || key.includes("..")) throw new Error("invalid key");
  const data = await store.get(key);
  await db.transaction((tx) => audit(tx, actor, { action: "backup.scheduled_downloaded", entityType: "backup", entityId: key }));
  return { filename: key.slice(SCHEDULED_PREFIX.length), data };
}

export async function backupHistory(tx: Tx, actor: Actor) {
  requirePermission(actor, "backup.run");
  return tx.select({ log: backupLogs, by: users.fullName }).from(backupLogs).leftJoin(users, eq(users.id, backupLogs.requestedBy))
    .orderBy(desc(backupLogs.createdAt)).limit(30);
}

export async function lastSuccessfulBackup(tx: Tx): Promise<Date | null> {
  const [r] = await tx.select({ at: backupLogs.createdAt }).from(backupLogs)
    .where(sql`${backupLogs.kind} = 'database' and ${backupLogs.status} = 'completed'`).orderBy(desc(backupLogs.createdAt)).limit(1);
  return r?.at ?? null;
}

// ------------------------------------------------------------------ restore
export type ParsedBackup = { header: BackupHeader; tables: BackupTable[] };

/**
 * Restore a parsed backup into an EMPTY, freshly migrated database (no seed).
 * Inserts in dependency order inside one transaction, then resets serial sequences.
 */
export async function restoreBackup(tx: Tx, backup: ParsedBackup) {
  if (backup.header?.format !== BACKUP_FORMAT) throw new Error("Bukan file backup COMS.");
  if (backup.header.version > BACKUP_VERSION) throw new Error("Versi backup lebih baru dari aplikasi ini.");
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from users`)).rows;
  if (n > 0) throw new Error("Database tujuan tidak kosong. Restore hanya ke database baru yang sudah dimigrasi (tanpa seed).");
  const target = await tableOrder(tx);
  const counts: Record<string, number> = {};
  for (const t of backup.tables) {
    if (!target.includes(t.name)) throw new Error(`Tabel ${t.name} tidak ada di database tujuan (versi skema berbeda).`);
    const targetCols = new Set((await columnsOf(tx, t.name)).map((c) => c.name));
    for (const c of t.columns) if (!targetCols.has(c.name)) throw new Error(`Kolom ${t.name}.${c.name} tidak ada di database tujuan.`);
    const isJson = t.columns.map((c) => c.type === "jsonb" || c.type === "json");
    for (let i = 0; i < t.rows.length; i += 200) {
      const chunk = t.rows.slice(i, i + 200);
      const values = sql.join(chunk.map((r) => sql`(${sql.join(r.map((v, ci) => (isJson[ci] && v !== null ? sql`${JSON.stringify(v)}::jsonb` : sql`${v}`)), sql`, `)})`), sql`, `);
      await tx.execute(sql`insert into ${sql.identifier(t.name)} (${sql.join(t.columns.map((c) => sql.identifier(c.name)), sql`, `)}) values ${values}`);
    }
    counts[t.name] = t.rows.length;
  }
  // Reset sequences behind serial/bigserial columns.
  const seqs = (await tx.execute<{ tbl: string; col: string; seq: string }>(sql`
    select c.table_name as tbl, c.column_name as col, pg_get_serial_sequence('public.' || c.table_name, c.column_name) as seq
    from information_schema.columns c where c.table_schema = 'public' and c.column_default like 'nextval%'`)).rows;
  for (const s of seqs) {
    if (!s.seq) continue;
    await tx.execute(sql`select setval(${s.seq}::regclass, coalesce((select max(${sql.identifier(s.col)}) from ${sql.identifier(s.tbl)}), 0) + 1, false)`);
  }
  return counts;
}

export async function parseBackupFile(gz: Uint8Array): Promise<ParsedBackup> {
  const text = await new Response(gunzip(new Response(gz as unknown as BodyInit).body!)).text();
  return JSON.parse(text) as ParsedBackup;
}

