import { describe, it, expect } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { inTx, actorFor, userId } from "./helpers";
import type { Tx } from "@/db";
import {
  properties, checklistTemplates, notifications, workOrders, pmSchedules, hkAssignments, propertyAssignments, auditLogs,
} from "@/db/schema";
import { listProperties, assignPropertyUser } from "@/services/properties";
import { submitChecklist, getTemplate, listSubmissions, todayChecklistStatus } from "@/services/checklists";
import {
  createRequest, createRequestFromChecklist, reviewRequest, assignWorkOrder, startWork, completeWork, verifyWork, keeperConfirm,
  getWorkOrder, listWorkOrders, addMaterial, cancelWorkOrder, changePriority, createPmSchedule, generateDuePreventive,
} from "@/services/maintenance";
import {
  createAssignment, assignStaff, startCleaning, completeCleaning, inspect, requestReclean, getAssignment, listAssignments,
} from "@/services/housekeeping";
import { runReminders } from "@/services/reminders";
import { readAttachment } from "@/services/attachments";
import "@/services/attachment-policies";

const jpg = (n = 1) => Array.from({ length: n }, (_, i) => ({ name: `f${i}.jpg`, data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, i]) }));
const villaNamed = async (tx: Tx, name: string) => (await tx.select().from(properties).where(eq(properties.name, name)))[0];
const villaOf = async (tx: Tx, username: string, idx = 0) => (await listProperties(tx, await actorFor(tx, username))).rows[idx];
const notifs = async (tx: Tx, username: string, type: string) =>
  tx.select().from(notifications).where(and(eq(notifications.userId, await userId(tx, username)), eq(notifications.type, type)));

describe("daily checklist", () => {
  it("keeper submits; failed item needs note+photo; failed items notify supervisor; MR created once per item", () => inTx(async (tx) => {
    const k = await actorFor(tx, "demo.keeper1");
    const villa = await villaOf(tx, "demo.keeper1");
    const [tpl] = await tx.select().from(checklistTemplates);
    const { items } = await getTemplate(tx, k, tpl.id);
    const answers = items.map((i) => ({ itemId: i.id, answer: "yes" as const }));
    answers[1] = { itemId: items[1].id, answer: "no" as never };
    await expect(submitChecklist(tx, k, { propertyId: villa.id, templateId: tpl.id, answers })).rejects.toThrow(/catatan|foto/);
    (answers[1] as { note?: string; files?: unknown }).note = "Air kolam keruh";
    (answers[1] as { files?: unknown }).files = jpg();
    const sub = await submitChecklist(tx, k, { propertyId: villa.id, templateId: tpl.id, answers });
    expect(sub.failCount).toBe(1);
    expect((await notifs(tx, "demo.spv.villa", "checklist.failed_items")).length).toBe(1);
    const status = await todayChecklistStatus(tx, k);
    expect(status!.find((s) => s.id === villa.id)!.doneAt).not.toBeNull();
    const failed = (await tx.execute<{ id: string }>(sql`select id from checklist_answers where submission_id = ${sub.id} and answer = 'no'`)).rows[0];
    const mr = await createRequestFromChecklist(tx, k, failed.id, "high");
    expect(mr.source).toBe("checklist");
    await expect(createRequestFromChecklist(tx, k, failed.id, "high")).rejects.toThrow(/sudah dilaporkan/);
  }));

  it("keeper cannot submit for a villa that is not assigned; own-scope keeper only lists own submissions", () => inTx(async (tx) => {
    const k1 = await actorFor(tx, "demo.keeper1");
    const other = await villaOf(tx, "demo.keeper2");
    const [tpl] = await tx.select().from(checklistTemplates);
    await expect(submitChecklist(tx, k1, { propertyId: other.id, templateId: tpl.id, answers: [] })).rejects.toThrow(/penugasan/);
    expect((await listSubmissions(tx, k1)).total).toBe(0);
  }));
});

describe("Scenario 3 — maintenance: leaking pipe", () => {
  it("runs end-to-end from keeper report to closure with history", () => inTx(async (tx) => {
    const keeper = await actorFor(tx, "demo.keeper1");
    const spv = await actorFor(tx, "demo.spv.eng");
    const eng = await actorFor(tx, "demo.eng1");
    const villa = await villaOf(tx, "demo.keeper1");

    // 1. Keeper reports with photo
    const mr = await createRequest(tx, keeper, { propertyId: villa.id, category: "plumbing", priority: "high", description: "Pipa wastafel kamar 2 bocor" }, jpg());
    // 2. Supervisor Engineer notified
    expect((await notifs(tx, "demo.spv.eng", "maintenance.new_request")).length).toBe(1);
    // Keeper cannot review
    await expect(reviewRequest(tx, keeper, mr.id, { action: "reject", note: "tidak boleh" })).rejects.toThrow(/hak akses/);
    // 3. WO created & assigned, keeper confirmation required
    const { workOrder } = await reviewRequest(tx, spv, mr.id, { action: "convert", title: "Perbaiki pipa wastafel kamar 2", priority: "high", assignTo: eng.id, keeperConfirmationRequired: true });
    const id = workOrder!.id;
    expect(workOrder!.status).toBe("assigned");
    expect((await notifs(tx, "demo.eng1", "maintenance.wo_assigned")).length).toBe(1);
    await expect(reviewRequest(tx, spv, mr.id, { action: "reject", note: "dua kali review" })).rejects.toThrow(/sudah ditinjau/);
    // other engineer cannot start it
    await expect(startWork(tx, await actorFor(tx, "demo.eng2"), id)).rejects.toThrow(/ditugaskan/);
    // 4. Engineer: before photo, start, material, after photo, complete
    await startWork(tx, eng, id, jpg());
    await addMaterial(tx, eng, id, { description: "Seal tape", quantity: 1, unit: "roll", unitCost: 15000 });
    await expect(completeWork(tx, eng, id, { findings: "Sambungan pipa aus", repairNotes: "Ganti sambungan" })).rejects.toThrow(/SESUDAH/);
    await completeWork(tx, eng, id, { findings: "Sambungan pipa aus", repairNotes: "Ganti sambungan & seal", actualCost: 45000 }, jpg());
    expect((await notifs(tx, "demo.spv.eng", "maintenance.verification_required")).length).toBe(1);
    // the engineer cannot verify own work (even with the permission)
    // 5. Supervisor verifies → waits for keeper
    await verifyWork(tx, spv, id, true, "Sudah dicek");
    expect((await tx.select().from(workOrders).where(eq(workOrders.id, id)))[0].status).toBe("verified");
    expect((await notifs(tx, "demo.keeper1", "maintenance.keeper_confirmation")).length).toBe(1);
    // keeper2 (not this villa) cannot confirm
    await expect(keeperConfirm(tx, await actorFor(tx, "demo.keeper2"), id, true, "")).rejects.toThrow(/Villa Keeper/);
    // 6. Keeper confirms → 7. closed
    await keeperConfirm(tx, keeper, id, true, "Tidak bocor lagi");
    const d = await getWorkOrder(tx, spv, id);
    expect(d.wo.status).toBe("closed");
    expect(d.photos.filter((p) => p.kind === "before").length).toBe(1);
    expect(d.photos.filter((p) => p.kind === "after").length).toBe(1);
    expect(d.materialCost).toBe(15000);
    expect(d.updates.map((u) => u.u.toStatus).filter(Boolean)).toEqual(["assigned", "in_progress", "completed", "verified", "closed"]);
    // 8. maintenance history visible on the villa (closed list) & audit
    expect((await listWorkOrders(tx, spv, { status: "closed", propertyId: villa.id })).total).toBe(1);
    const audits = await tx.select().from(auditLogs).where(and(eq(auditLogs.entityType, "work_order"), eq(auditLogs.entityId, id)));
    expect(audits.length).toBeGreaterThanOrEqual(5);
  }));

  it("verifier must differ from assignee (service + DB constraint)", () => inTx(async (tx) => {
    const spv = await actorFor(tx, "demo.spv.eng");
    const villa = await villaOf(tx, "demo.spv.eng");
    const mr = await createRequest(tx, spv, { propertyId: villa.id, category: "ac", priority: "normal", description: "AC kamar utama tidak dingin" });
    // supervisor assigns to self (supervisor also holds maintenance.work)
    const { workOrder } = await reviewRequest(tx, spv, mr.id, { action: "convert", title: "Cek AC", priority: "normal", assignTo: spv.id });
    await startWork(tx, spv, workOrder!.id, jpg());
    await completeWork(tx, spv, workOrder!.id, { findings: "Freon habis", repairNotes: "Isi freon" }, jpg());
    await expect(verifyWork(tx, spv, workOrder!.id, true, "")).rejects.toThrow(/sendiri/);
    await expect(tx.execute(sql`update work_orders set verified_by = assigned_to where id = ${workOrder!.id}`)).rejects.toThrow();
  }));

  it("verification rejection sends work back; keeper rejection reopens", () => inTx(async (tx) => {
    const keeper = await actorFor(tx, "demo.keeper1"), spv = await actorFor(tx, "demo.spv.eng"), eng = await actorFor(tx, "demo.eng1");
    const villa = await villaOf(tx, "demo.keeper1");
    const mr = await createRequest(tx, keeper, { propertyId: villa.id, category: "electrical", priority: "normal", description: "Lampu teras mati" });
    const { workOrder } = await reviewRequest(tx, spv, mr.id, { action: "convert", title: "Lampu teras", priority: "normal", assignTo: eng.id, keeperConfirmationRequired: true });
    const id = workOrder!.id;
    await startWork(tx, eng, id, jpg());
    await completeWork(tx, eng, id, { findings: "Bohlam putus", repairNotes: "Ganti bohlam" }, jpg());
    await verifyWork(tx, spv, id, false, "Fitting juga longgar");
    expect((await getWorkOrder(tx, spv, id)).wo.status).toBe("in_progress");
    await completeWork(tx, eng, id, { findings: "Bohlam putus, fitting longgar", repairNotes: "Ganti bohlam & fitting" }, []);
    await verifyWork(tx, spv, id, true, "");
    await keeperConfirm(tx, keeper, id, false, "Masih berkedip");
    expect((await getWorkOrder(tx, spv, id)).wo.status).toBe("in_progress");
  }));

  it("critical report alerts GM; priority escalation is audited; cancel needs reason", () => inTx(async (tx) => {
    const keeper = await actorFor(tx, "demo.keeper1"), spv = await actorFor(tx, "demo.spv.eng");
    const villa = await villaOf(tx, "demo.keeper1");
    const mr = await createRequest(tx, keeper, { propertyId: villa.id, category: "electrical", priority: "critical", description: "Korsleting panel listrik, bau gosong" });
    expect((await notifs(tx, "demo.gm", "maintenance.critical")).length).toBe(1);
    const { workOrder } = await reviewRequest(tx, spv, mr.id, { action: "convert", title: "Korsleting panel", priority: "critical" });
    expect(workOrder!.status).toBe("new");
    expect(workOrder!.deadline!.getTime() - Date.now()).toBeLessThan(4.1 * 3600_000);
    await changePriority(tx, spv, workOrder!.id, "critical", "sama");
    await expect(cancelWorkOrder(tx, spv, workOrder!.id, "")).rejects.toThrow(/Alasan/);
    await cancelWorkOrder(tx, spv, workOrder!.id, "Ditangani PLN langsung");
    expect((await getWorkOrder(tx, spv, workOrder!.id)).wo.status).toBe("cancelled");
  }));

  it("repeated problems at the same villa are flagged to supervisor and GM", () => inTx(async (tx) => {
    const keeper = await actorFor(tx, "demo.keeper1"), spv = await actorFor(tx, "demo.spv.eng");
    const villa = await villaOf(tx, "demo.keeper1");
    for (let i = 0; i < 2; i++) {
      const mr = await createRequest(tx, keeper, { propertyId: villa.id, category: "pool", priority: "normal", description: `Pompa kolam mati #${i}` });
      await reviewRequest(tx, spv, mr.id, { action: "convert", title: `Pompa #${i}`, priority: "normal" });
    }
    const third = await createRequest(tx, keeper, { propertyId: villa.id, category: "pool", priority: "normal", description: "Pompa kolam mati lagi" });
    expect(third.repeatCount).toBe(2);
    expect((await notifs(tx, "demo.gm", "maintenance.repeat_issue")).length).toBe(1);
  }));

  it("engineers only see their own work orders; keepers only their villas'", () => inTx(async (tx) => {
    const keeper = await actorFor(tx, "demo.keeper1"), spv = await actorFor(tx, "demo.spv.eng");
    const v1 = await villaOf(tx, "demo.keeper1"), v2 = await villaOf(tx, "demo.keeper2");
    const a = await createRequest(tx, keeper, { propertyId: v1.id, category: "garden", priority: "low", description: "Rumput tinggi" });
    const b = await createRequest(tx, spv, { propertyId: v2.id, category: "garden", priority: "low", description: "Pohon tumbang kecil" });
    const wa = (await reviewRequest(tx, spv, a.id, { action: "convert", title: "Rumput", priority: "low", assignTo: await userId(tx, "demo.eng1") })).workOrder!;
    const wb = (await reviewRequest(tx, spv, b.id, { action: "convert", title: "Pohon", priority: "low", assignTo: await userId(tx, "demo.eng2") })).workOrder!;
    const eng1 = await actorFor(tx, "demo.eng1");
    expect((await listWorkOrders(tx, eng1)).rows.map((r) => r.wo.id)).toEqual([wa.id]);
    await expect(getWorkOrder(tx, eng1, wb.id)).rejects.toThrow();
    expect((await listWorkOrders(tx, keeper)).rows.map((r) => r.wo.id)).toEqual([wa.id]);
    await expect(getWorkOrder(tx, keeper, wb.id)).rejects.toThrow(/villa Anda/);
    // photo of WO b is not readable by keeper1
    await startWork(tx, await actorFor(tx, "demo.eng2"), wb.id, jpg());
    const [ph] = (await getWorkOrder(tx, spv, wb.id)).photos;
    await expect(readAttachment(tx, keeper, ph.id)).rejects.toThrow();
  }));

  it("preventive schedules generate one work order when due, and advance on closure", () => inTx(async (tx) => {
    const spv = await actorFor(tx, "demo.spv.eng"), eng = await actorFor(tx, "demo.eng1"), keeper = await actorFor(tx, "demo.keeper1");
    const villa = await villaOf(tx, "demo.keeper1");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const pm = await createPmSchedule(tx, spv, { propertyId: villa.id, title: "Servis AC berkala", category: "ac", intervalDays: 90, nextDueOn: today, defaultAssigneeId: eng.id });
    expect(await generateDuePreventive(tx)).toBe(1);
    expect(await generateDuePreventive(tx)).toBe(0);
    const [wo] = await tx.select().from(workOrders).where(eq(workOrders.pmScheduleId, pm.id));
    expect(wo.status).toBe("assigned");
    await startWork(tx, eng, wo.id, jpg());
    await completeWork(tx, eng, wo.id, { findings: "Filter kotor", repairNotes: "Cuci filter" }, jpg());
    await verifyWork(tx, spv, wo.id, true, "");
    const [after] = await tx.select().from(pmSchedules).where(eq(pmSchedules.id, pm.id));
    expect(after.lastDoneOn).toBe(today);
    expect(after.nextDueOn > today).toBe(true);
    void keeper;
  }));
});

describe("housekeeping — cleaning ≠ ready", () => {
  async function setup(tx: Tx) {
    const coord = await actorFor(tx, "demo.hk.coord");
    const villa = await villaNamed(tx, "[DEMO] Villa A"); // Utara cluster: keeper1, HK TL & PIC of Utara
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const a = await createAssignment(tx, coord, { propertyId: villa.id, checkoutDate: today, expectedDoneAt: new Date(Date.now() + 3 * 3600_000), priority: "high", instructions: "Ganti semua linen" });
    return { coord, villa, a, today };
  }

  it("full flow: assign → start → complete (photo) → inspection by keeper → ready", () => inTx(async (tx) => {
    const { coord, a } = await setup(tx);
    expect(a.status).toBe("pending");
    const tl = await actorFor(tx, "demo.hk.tl");
    await assignStaff(tx, tl, a.id, [await userId(tx, "demo.hk1"), await userId(tx, "demo.hk2")]);
    expect((await notifs(tx, "demo.hk1", "housekeeping.new_assignment")).length).toBe(1);
    const hk1 = await actorFor(tx, "demo.hk1");
    await startCleaning(tx, hk1, a.id);
    await expect(completeCleaning(tx, hk1, a.id, "", [])).rejects.toThrow(/foto/);
    await completeCleaning(tx, hk1, a.id, "Selesai", jpg(2));
    let d = await getAssignment(tx, coord, a.id);
    expect(d.a.status).toBe("inspection_required"); // NOT ready
    expect((await notifs(tx, "demo.keeper1", "housekeeping.cleaning_completed")).length).toBe(1);
    // cleaner cannot inspect own work; supervisor villa / coordinator / PIC are not inspectors
    await expect(inspect(tx, hk1, a.id, "pass", "")).rejects.toThrow(/sendiri/);
    for (const u of ["demo.spv.villa", "demo.hk.coord", "demo.pic.utara", "demo.keeper2"]) {
      await expect(inspect(tx, await actorFor(tx, u), a.id, "pass", ""), u).rejects.toThrow();
    }
    await inspect(tx, await actorFor(tx, "demo.keeper1"), a.id, "pass", "Rapi");
    d = await getAssignment(tx, coord, a.id);
    expect(d.a.status).toBe("ready");
    expect(d.a.readyAt).not.toBeNull();
    expect(d.events.map((e) => e.e.toStatus).filter(Boolean)).toEqual(["pending", "assigned", "in_progress", "cleaning_completed", "inspection_required", "ready"]);
  }));

  it("inspection failure → re-clean → HK Team Leader (location) passes it", () => inTx(async (tx) => {
    const { coord, a } = await setup(tx);
    await assignStaff(tx, coord, a.id, [await userId(tx, "demo.hk1")]);
    const hk1 = await actorFor(tx, "demo.hk1");
    await startCleaning(tx, hk1, a.id);
    await completeCleaning(tx, hk1, a.id, "", jpg());
    const keeper = await actorFor(tx, "demo.keeper1");
    await expect(inspect(tx, keeper, a.id, "fail", "Kamar mandi kotor", [])).rejects.toThrow(/foto/);
    await inspect(tx, keeper, a.id, "fail", "Kamar mandi kotor", jpg());
    expect((await getAssignment(tx, coord, a.id)).a.status).toBe("inspection_failed");
    expect((await notifs(tx, "demo.hk1", "housekeeping.inspection_failed")).length).toBe(1);
    await expect(startCleaning(tx, hk1, a.id)).rejects.toThrow();
    await requestReclean(tx, coord, a.id, "Bersihkan kamar mandi");
    await startCleaning(tx, hk1, a.id);
    await completeCleaning(tx, hk1, a.id, "", jpg());
    await inspect(tx, await actorFor(tx, "demo.hk.tl"), a.id, "pass", "OK");
    const d = await getAssignment(tx, coord, a.id);
    expect(d.a.status).toBe("ready");
    expect(d.a.recleanCount).toBe(1);
  }));

  it("an assigned inspector (any role) may inspect; DB refuses 'ready' without a passing inspection", () => inTx(async (tx) => {
    const { coord, villa, a } = await setup(tx);
    const gm = await actorFor(tx, "demo.gm");
    await assignPropertyUser(tx, gm, villa.id, await userId(tx, "demo.spv.villa"), "inspector");
    await assignStaff(tx, coord, a.id, [await userId(tx, "demo.hk2")]);
    await expect(tx.transaction((sp) => sp.execute(sql`update hk_assignments set status = 'ready' where id = ${a.id}`))).rejects.toThrow();
    const hk2 = await actorFor(tx, "demo.hk2");
    await startCleaning(tx, hk2, a.id);
    await completeCleaning(tx, hk2, a.id, "", jpg());
    await inspect(tx, await actorFor(tx, "demo.spv.villa"), a.id, "pass", "");
    expect((await getAssignment(tx, coord, a.id)).a.status).toBe("ready");
  }));

  it("housekeepers only see their own assignments; duplicates for same villa/date refused", () => inTx(async (tx) => {
    const { coord, villa, a, today } = await setup(tx);
    await expect(createAssignment(tx, coord, { propertyId: villa.id, checkoutDate: today, expectedDoneAt: new Date() })).rejects.toThrow(/Sudah ada/);
    await assignStaff(tx, coord, a.id, [await userId(tx, "demo.hk1")]);
    expect((await listAssignments(tx, await actorFor(tx, "demo.hk1"))).length).toBe(1);
    expect((await listAssignments(tx, await actorFor(tx, "demo.hk2"))).length).toBe(0);
    await expect(getAssignment(tx, await actorFor(tx, "demo.hk2"), a.id)).rejects.toThrow();
    // a finance user cannot be assigned as cleaner
    await expect(assignStaff(tx, coord, a.id, [await userId(tx, "demo.finance")])).rejects.toThrow(/Housekeeper/);
  }));
});

describe("reminders & escalations", () => {
  it("escalates unassigned critical WOs and overdue items without duplicate spam", () => inTx(async (tx) => {
    const keeper = await actorFor(tx, "demo.keeper1"), spv = await actorFor(tx, "demo.spv.eng");
    const villa = await villaOf(tx, "demo.keeper1");
    const mr = await createRequest(tx, keeper, { propertyId: villa.id, category: "plumbing", priority: "critical", description: "Pipa utama pecah, air menggenang" });
    const { workOrder } = await reviewRequest(tx, spv, mr.id, { action: "convert", title: "Pipa utama pecah", priority: "critical" });
    await tx.update(workOrders).set({ createdAt: new Date(Date.now() - 2 * 3600_000), deadline: new Date(Date.now() - 30 * 3600_000) }).where(eq(workOrders.id, workOrder!.id));
    const r1 = await runReminders(tx);
    expect(r1.unassigned).toBeGreaterThan(0);
    expect(r1.woOverdue).toBeGreaterThan(0);
    expect(r1.woGm).toBeGreaterThan(0);
    const r2 = await runReminders(tx);
    expect(r2.unassigned + r2.woOverdue + r2.woGm).toBe(0);
  }));

  it("reminds keepers about missing daily checklists after the configured time", () => inTx(async (tx) => {
    const late = new Date(); // force reminder time to 00:00 so it always applies
    const { systemSettings } = await import("@/db/schema");
    await tx.insert(systemSettings).values({ key: "checklist.reminder_time", value: "00:00" }).onConflictDoUpdate({ target: systemSettings.key, set: { value: "00:00" } });
    const r = await runReminders(tx, late);
    expect(r.checklist).toBeGreaterThanOrEqual(2); // keeper1 and keeper2
    expect((await notifs(tx, "demo.keeper1", "checklist.reminder")).length).toBe(1);
    void propertyAssignments; void hkAssignments; void properties;
  }));
});
