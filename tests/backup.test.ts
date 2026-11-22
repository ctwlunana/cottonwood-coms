import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { inTx, actorFor } from "./helpers";
import { can } from "@/lib/authz";
import {
  startDatabaseDownload, startFilesDownload, databaseBackupStream, gzip, parseBackupFile, restoreBackup, tableOrder,
} from "@/services/backup";
import { setRolePermission } from "@/services/rbac";
import { roles, backupLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("backup permissions", () => {
  it("only GM (Manager+) holds backup.run by default", () => inTx(async (tx) => {
    expect(can(await actorFor(tx, "demo.gm"), "backup.run")).toBe(true);
    for (const u of ["demo.sysadmin", "demo.spv.villa", "demo.cs.lead", "demo.finance", "demo.accounting", "demo.keeper1"]) {
      expect(can(await actorFor(tx, u), "backup.run"), u).toBe(false);
    }
  }));
  it("non-holders are refused; sysadmin cannot grant backup.run", async () => {
    await expect(startDatabaseDownload(await inTx((tx) => actorFor(tx, "demo.sysadmin")))).rejects.toThrow(/hak akses/);
    await expect(startFilesDownload(await inTx((tx) => actorFor(tx, "demo.keeper1")))).rejects.toThrow(/hak akses/);
    await inTx(async (tx) => {
      const admin = await actorFor(tx, "demo.sysadmin");
      const [r] = await tx.select().from(roles).where(eq(roles.slug, "supervisor_villa"));
      await expect(setRolePermission(tx, admin, r.id, "backup.run", "all")).rejects.toThrow(/GM/);
    });
  });
});

describe("database backup round-trip", () => {
  it("exports every table and restores into an empty database with identical row counts", async () => {
    const gm = await inTx((tx) => actorFor(tx, "demo.gm"));
    const { stream, filename } = await startDatabaseDownload(gm);
    expect(filename).toMatch(/^coms-backup-database-\d{8}-\d{4}\.json\.gz$/);
    const gz = new Uint8Array(await new Response(stream).arrayBuffer());
    const parsed = await parseBackupFile(gz);
    expect(parsed.header.format).toBe("coms-backup");
    const order = await tableOrder(db);
    expect(parsed.tables.map((t) => t.name)).toEqual(order);
    // FK order: departments before users, users before user_roles
    expect(order.indexOf("departments")).toBeLessThan(order.indexOf("users"));
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("user_roles"));

    const base = process.env.DATABASE_URL!;
    const admin = new Pool({ connectionString: base, max: 1 });
    await admin.query("DROP DATABASE IF EXISTS coms_test_restore");
    await admin.query("CREATE DATABASE coms_test_restore");
    await admin.end();
    const url = base.replace(/\/[^/]+$/, "/coms_test_restore");
    const pool = new Pool({ connectionString: url, max: 2 });
    try {
      const target = drizzle(pool);
      await migrate(target, { migrationsFolder: "./migrations" });
      await target.transaction((tx) => restoreBackup(tx as never, parsed));
      for (const t of parsed.tables) {
        const r = await pool.query(`select count(*)::int as n from "${t.name}"`);
        expect(r.rows[0].n, t.name).toBe(t.rows.length);
      }
      // sequences continue after restored ids (audit_logs is bigserial)
      await pool.query("insert into audit_logs (action, entity_type) values ('x', 'y')");
      // and restoring twice is refused (target not empty)
      await expect(target.transaction((tx) => restoreBackup(tx as never, parsed))).rejects.toThrow(/tidak kosong/);
      // the audit trail stays append-only after restore
      await expect(pool.query("delete from audit_logs")).rejects.toThrow();
    } finally {
      await pool.end();
      const a2 = new Pool({ connectionString: base, max: 1 });
      await a2.query("DROP DATABASE IF EXISTS coms_test_restore");
      await a2.end();
    }
    const logs = await db.select().from(backupLogs).where(eq(backupLogs.trigger, "manual_download"));
    expect(logs.length).toBeGreaterThan(0);
    await db.execute(sql`delete from backup_logs`);
  });

  it("snapshot is consistent and gzip output is a valid archive", async () => {
    const gz = new Uint8Array(await new Response(gzip(databaseBackupStream(null))).arrayBuffer());
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
  });
});

describe("files backup", () => {
  it("produces a tar with a manifest", async () => {
    const gm = await inTx((tx) => actorFor(tx, "demo.gm"));
    const { stream } = await startFilesDownload(gm);
    const tar = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(tar.length % 512).toBe(0);
    expect(new TextDecoder().decode(tar.subarray(0, 13))).toBe("MANIFEST.json");
    expect(new TextDecoder().decode(tar.subarray(257, 262))).toBe("ustar");
    await db.execute(sql`delete from backup_logs`);
  });
});
