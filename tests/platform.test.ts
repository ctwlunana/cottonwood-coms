import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { inTx, actorFor, userId } from "./helpers";
import { notify, dispatchPending } from "@/lib/notify";
import { notificationDeliveryLogs, notifications, properties } from "@/db/schema";
import { listMyNotifications, markRead } from "@/services/notifications";
import { importVillas, importEmployees } from "@/services/imports";
import { parseCsv, toCsv } from "@/lib/csv";
import { sniff } from "@/lib/storage";
import { addAttachments } from "@/services/attachments";
import { nextCode } from "@/lib/codes";
import { listProperties } from "@/services/properties";

describe("notifications", () => {
  it("deduplicates and logs skipped external channels when not configured", () => inTx(async (tx) => {
    const u = await userId(tx, "demo.spv.eng");
    const base = { type: "test.event", userIds: [u], title: "Uji", dedupeKey: "k1", priority: "critical" as const };
    expect(await notify(tx, base)).toBe(1);
    expect(await notify(tx, base)).toBe(0);
    const r = await dispatchPending(tx, undefined, new Date("2026-01-01T05:00:00Z")); // 12:00 WIB
    expect(r.skipped).toBe(2);
    const logs = await tx.select().from(notificationDeliveryLogs).where(eq(notificationDeliveryLogs.recipientId, u));
    expect(logs.map((l) => `${l.channel}:${l.status}`).sort()).toEqual(["email:skipped", "in_app:sent", "whatsapp:skipped"]);
    expect(logs.find((l) => l.channel === "email")!.error).toMatch(/belum dikonfigurasi/);
  }));

  it("retries failing channels then marks failed; quiet hours defer non-critical", () => inTx(async (tx) => {
    const u = await userId(tx, "demo.cs1");
    await tx.execute(`update users set email = 'x@example.invalid' where id = '${u}'`);
    await tx.insert((await import("@/db/schema")).notificationPreferences).values({ userId: u, type: "*", inApp: true, email: true, whatsapp: false });
    await notify(tx, { type: "t", userIds: [u], title: "Normal" });
    const failing = [{ name: "email" as const, configured: () => true, address: () => "x", send: async () => ({ ok: false as const, error: "smtp down", retryable: true }) }];
    const night = new Date("2026-01-01T16:00:00Z"); // 23:00 WIB
    expect((await dispatchPending(tx, failing, night)).failed).toBe(0); // deferred
    const day = new Date("2026-01-01T05:00:00Z");
    for (let i = 0; i < 3; i++) await dispatchPending(tx, failing, day);
    const [log] = await tx.select().from(notificationDeliveryLogs).where(eq(notificationDeliveryLogs.channel, "email"));
    expect(log.status).toBe("failed");
    expect(log.retryCount).toBe(3);
  }));

  it("only the owner can read/mark a notification", () => inTx(async (tx) => {
    const u = await userId(tx, "demo.keeper1");
    await notify(tx, { type: "t", userIds: [u], title: "Halo", link: "/properti" });
    const [n] = await tx.select().from(notifications).where(eq(notifications.userId, u));
    await expect(markRead(tx, await actorFor(tx, "demo.keeper2"), n.id)).rejects.toThrow();
    expect(await markRead(tx, await actorFor(tx, "demo.keeper1"), n.id)).toBe("/properti");
    expect((await listMyNotifications(tx, await actorFor(tx, "demo.keeper1"), { unreadOnly: true })).total).toBe(0);
  }));
});

describe("CSV import", () => {
  it("rejects the whole file when any row is invalid (nothing written)", () => inTx(async (tx) => {
    const admin = await actorFor(tx, "demo.sysadmin");
    const before = (await tx.select().from(properties)).length;
    const r = await importVillas(tx, admin, "code,name,location_code,bedrooms,bathrooms\nIMP-01,Villa Impor,IMP,2,2\nIMP-02,,IMP,x,1\n");
    expect(r.errors.length).toBeGreaterThan(0);
    expect((await tx.select().from(properties)).length).toBe(before);
  }));

  it("imports villas, creates locations, assigns keepers, updates by code", () => inTx(async (tx) => {
    const admin = await actorFor(tx, "demo.sysadmin");
    const csv = "code,name,location_code,location_name,bedrooms,bathrooms,keeper_employee_code\nIMP-01,Villa Impor 1,IMP,Lokasi Impor,2,2,DEMO-005\nIMP-02,Villa Impor 2,IMP,,3,2,\n";
    const r = await importVillas(tx, admin, csv);
    expect(r).toMatchObject({ created: 2, updated: 0, errors: [] });
    const r2 = await importVillas(tx, admin, csv.replace("Villa Impor 2", "Villa Impor Dua"));
    expect(r2).toMatchObject({ created: 0, updated: 2 });
    const keeper = await actorFor(tx, "demo.keeper1"); // DEMO-005 = keeper1
    expect((await listProperties(tx, keeper)).rows.map((x) => x.code)).toContain("IMP-01");
  }));

  it("imports employees with roles and returns one-time passwords", () => inTx(async (tx) => {
    const admin = await actorFor(tx, "demo.sysadmin");
    const r = await importEmployees(tx, admin, "employee_code;username;full_name;department_code;roles\nE-100;baru.satu;Karyawan Baru;HK;housekeeper\n");
    expect(r.created).toBe(1);
    expect(r.credentials![0].temporaryPassword).toMatch(/^.{4}-.{4}-.{4}$/);
    // financial role via import is still blocked for sysadmin
    await expect(importEmployees(tx, admin, "employee_code,username,full_name,department_code,roles\nE-101,baru.dua,Baru Dua,FIN,finance\n")).rejects.toThrow(/GM/);
  }));

  it("csv utils handle quotes and neutralize formulas", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([{ a: "x, y", b: 'he said "hi"' }]);
    expect(toCsv([{ a: "=cmd()" }])).toContain("'=cmd()");
  });
});

describe("files & codes", () => {
  it("detects file type from magic bytes, not the name", () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(sniff(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });
  it("only villa managers can attach villa photos; bad types rejected", () => inTx(async (tx) => {
    const [p] = await tx.select().from(properties).limit(1);
    await expect(addAttachments(tx, await actorFor(tx, "demo.keeper1"), "property", p.id, [{ name: "a.jpg", data: Buffer.from([0xff, 0xd8, 0xff]) }])).rejects.toThrow(/hak akses/);
    await expect(addAttachments(tx, await actorFor(tx, "demo.gm"), "property", p.id, [{ name: "a.jpg", data: Buffer.from("not an image") }])).rejects.toThrow(/tidak didukung/);
    const ok = await addAttachments(tx, await actorFor(tx, "demo.gm"), "property", p.id, [{ name: "a.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) }]);
    expect(ok[0].mime).toBe("image/jpeg");
  }));
  it("generates sequential codes", () => inTx(async (tx) => {
    const a = await nextCode(tx, "TST", { yearly: true });
    const b = await nextCode(tx, "TST", { yearly: true });
    expect(Number(b.split("-").pop()) - Number(a.split("-").pop())).toBe(1);
  }));
});
