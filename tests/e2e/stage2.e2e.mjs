// Stage 2 through the real UI: Scenario 3 (maintenance) and the housekeeping readiness flow.
// Field roles use a phone viewport.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? ".";
const PW = process.env.DEMO_PASSWORD ?? "demo-cottonwood-2026";
const JPG = new URL("./sample.jpg", import.meta.url).pathname;
let failures = 0;
const check = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };
const browser = await chromium.launch();
const PHONE = { width: 390, height: 844 };
async function as(u, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`); await page.fill("#username", u); await page.fill("#password", PW);
  await Promise.all([page.waitForURL(/dashboard/), page.click("button[type=submit]")]);
  return page;
}
const pick = async (page, sel, text) => page.selectOption(sel, await page.locator(`${sel} option`, { hasText: text }).first().getAttribute("value"));
const ok = async (page, text) => { await page.waitForSelector(`[role=status]:has-text("${text}")`, { timeout: 15000 }); };

// ---------- Checklist (keeper, phone)
const keeper = await as("demo.keeper1", PHONE);
await keeper.screenshot({ path: `${OUT}/s2-keeper-dashboard.png`, fullPage: true });
check((await keeper.locator("text=Checklist hari ini").count()) === 1, "keeper dashboard shows today's checklist card");
await keeper.click("a:has-text('Isi checklist')");
await keeper.waitForURL(/checklist\/baru/);
await pick(keeper, "#propertyId", "[DEMO] Villa A");
const groups = keeper.locator("section.card > div");
const n = await groups.count();
for (let i = 0; i < n; i++) await groups.nth(i).locator("label:has-text('Ya / Baik')").click();
await groups.nth(1).locator("label:has-text('Bermasalah')").click();
await groups.nth(1).locator("textarea").fill("Air kolam keruh dan berbau");
await groups.nth(1).locator("input[type=file]").setInputFiles(JPG);
await keeper.screenshot({ path: `${OUT}/s2-keeper-checklist.png`, fullPage: true });
await Promise.all([keeper.waitForURL(/checklist\/[0-9a-f-]{36}\?baru=1/), keeper.click("button:has-text('Kirim checklist')")]);
check((await keeper.locator("text=Item bermasalah (1)").count()) === 1, `checklist submitted with ${n} items, 1 failure flagged`);
await keeper.click("button:has-text('Buat permintaan maintenance')");
await keeper.waitForSelector("text=Sudah dilaporkan ke Engineering", { timeout: 15000 });
check(true, "failed checklist item turned into a maintenance request");

// ---------- Scenario 3: leaking pipe
await keeper.goto(`${BASE}/maintenance/lapor`);
await pick(keeper, "#propertyId", "[DEMO] Villa A");
await keeper.selectOption("#category", "plumbing");
await keeper.click("label:has-text('Tinggi')");
await keeper.fill("#description", "Pipa di bawah wastafel kamar 2 bocor, air menetes terus");
await keeper.setInputFiles("input[type=file][name=files]", JPG);
await Promise.all([keeper.waitForURL(/permintaan\/.*baru=1/), keeper.click("button:has-text('Kirim laporan')")]);
const mrUrl = keeper.url().split("?")[0];
check(true, "1. keeper reported the leaking pipe with a photo");

const spv = await as("demo.spv.eng");
await spv.goto(`${BASE}/notifikasi`);
check((await spv.locator("text=Laporan maintenance: [DEMO] Villa A").count()) >= 1, "2. Supervisor Engineer notified");
await spv.goto(mrUrl);
await spv.fill("#title", "Perbaiki pipa wastafel kamar 2");
await spv.selectOption("#assignTo", { index: 1 });
const engName = (await spv.locator("#assignTo option").nth(1).innerText()).split(" · ")[0];
await Promise.all([spv.waitForURL(/maintenance\/[0-9a-f-]{36}$/), spv.click("button:has-text('Buat work order')")]);
const woUrl = spv.url();
check((await spv.locator(`text=Menunggu`).first().count()) === 1, `3. work order created and assigned to ${engName}`);

const engUser = engName.includes("Engineer 1") ? "demo.eng1" : engName.includes("Engineer 2") ? "demo.eng2" : "demo.spv.eng";
const eng = await as(engUser, PHONE);
await eng.goto(woUrl);
await eng.locator("form:has(input[value=start]) input[type=file]").setInputFiles(JPG);
await eng.click("button:has-text('Mulai kerjakan')");
await eng.waitForSelector("text=Sedang ditangani", { timeout: 15000 });
await eng.fill("#findings", "Sambungan pipa aus");
await eng.fill("#repairNotes", "Ganti sambungan & seal tape");
await eng.locator("form:has(input[value=complete]) input[type=file]").setInputFiles(JPG);
await eng.click("button:has-text('Tandai selesai')");
await eng.waitForSelector("text=verifikasi Supervisor Engineer", { timeout: 15000 });
await eng.screenshot({ path: `${OUT}/s2-engineer-wo.png`, fullPage: true });
check(true, "4. engineer uploaded before & after photos and completed");

await spv.goto(woUrl);
if (engUser === "demo.spv.eng") check(false, "supervisor should not verify own work");
await spv.click("label:has-text('Setujui')"); await spv.click("button:has-text('Simpan verifikasi')");
await spv.waitForSelector("text=konfirmasi Villa Keeper", { timeout: 15000 });
check(true, "5. Supervisor Engineer verified");

await keeper.goto(woUrl);
await keeper.click("label:has-text('Sudah normal')"); await keeper.click("button:has-text('Simpan konfirmasi')");
await keeper.waitForSelector("text=Selesai dan ditutup", { timeout: 15000 });
check((await keeper.locator("text=Selesai dan ditutup").count()) === 1, "6–7. keeper confirmed, work order closed");
await spv.goto(`${BASE}/properti?q=Villa A`);
await spv.locator("table a:has-text('Villa A')").click();
await spv.waitForURL(/properti\/[0-9a-f-]{36}$/);
check((await spv.locator("text=Perbaiki pipa wastafel kamar 2").count()) >= 1, "8. maintenance history visible on the villa page");
await spv.screenshot({ path: `${OUT}/s2-villa-history.png`, fullPage: true });

// ---------- Housekeeping: cleaning is not ready until inspected
const coord = await as("demo.hk.coord");
await coord.goto(`${BASE}/housekeeping/baru`);
await pick(coord, "#propertyId", "[DEMO] Villa D");
await coord.locator("label:has-text('[DEMO] Housekeeper 1') input").check();
await Promise.all([coord.waitForURL(/housekeeping\/[0-9a-f-]{36}$/), coord.click("button:has-text('Simpan penugasan')")]);
const hkUrl = coord.url();
const hk = await as("demo.hk1", PHONE);
check((await hk.locator("text=Tugas pembersihan saya").count()) === 1 && (await hk.locator("text=[DEMO] Villa D").count()) >= 1, "housekeeper sees the task on the phone dashboard");
await hk.goto(hkUrl);
await hk.click("button:has-text('Mulai bersihkan')");
await hk.waitForSelector("button:has-text('Pembersihan selesai')", { timeout: 15000 });
await hk.locator("form:has(input[value=complete]) input[type=file]").setInputFiles(JPG);
await hk.click("button:has-text('Pembersihan selesai')");
await hk.waitForSelector("text=menunggu inspeksi kesiapan", { timeout: 15000 });
check((await hk.locator("text=Perlu inspeksi").count()) >= 1 && (await hk.locator("text=SIAP untuk tamu").count()) === 0, "after cleaning the villa is NOT ready (inspection required)");
check((await hk.locator("label:has-text('Lulus')").count()) === 0, "housekeeper cannot inspect own cleaning");
await hk.screenshot({ path: `${OUT}/s2-housekeeper.png`, fullPage: true });
await coord.reload();
check((await coord.locator("label:has-text('Lulus')").count()) === 0, "HK coordinator is not an inspector (policy)");
await keeper.goto(hkUrl);
await keeper.click("label:has-text('Lulus')"); await keeper.click("button:has-text('Simpan hasil inspeksi')");
await keeper.waitForSelector("text=SIAP untuk tamu", { timeout: 15000 });
check((await keeper.locator("text=SIAP untuk tamu").count()) >= 1, "villa keeper inspection → villa READY");

// ---------- Access boundaries
const k2 = await as("demo.keeper2", PHONE);
await k2.goto(woUrl);
check((await k2.locator("text=Akses ditolak").count()) === 1, "keeper 2 cannot open a work order of keeper 1's villa");
await hk.goto(`${BASE}/maintenance`);
check((await hk.locator("text=Laporan saya").count()) === 1 && (await hk.locator("text=Perlu ditinjau").count()) === 0, "housekeeper can report but not review maintenance");
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
