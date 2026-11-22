// End-to-end smoke test through the real UI: each demo role logs in and sees different rights.
// Usage: BASE=http://localhost:3100 OUT=<dir> node tests/e2e/roles.e2e.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? ".";
const PW = process.env.DEMO_PASSWORD ?? "demo-cottonwood-2026";
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch();
async function as(username, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#username", username);
  await page.fill("#password", PW);
  await Promise.all([page.waitForURL(/dashboard|profil/), page.click("button[type=submit]")]);
  return { ctx, page };
}
const navLabels = async (page) => (await page.locator("aside nav a").allInnerTexts()).map((t) => t.split("\n").pop().replace(/\d+$/, "").trim());

// --- GM
{
  const { ctx, page } = await as("demo.gm");
  const nav = await navLabels(page);
  check(["Dashboard", "Properti / Villa", "Karyawan", "Audit Trail", "Pengaturan"].every((n) => nav.includes(n)), `GM nav: ${nav.join(", ")}`);
  check((await page.locator("text=Total villa").count()) === 1, "GM dashboard shows company-wide villa total");
  await page.screenshot({ path: `${OUT}/gm-dashboard.png`, fullPage: true });
  await page.click("text=Tanpa Villa Keeper");
  await page.waitForURL(/keeper=none/);
  const rows = await page.locator("table tbody tr").count();
  check(rows === 4, `drill-down 'Tanpa Villa Keeper' lists the 4 unassigned villas (got ${rows})`);
  await page.goto(`${BASE}/pengaturan/peran`);
  await page.screenshot({ path: `${OUT}/gm-matrix.png` });
  check((await page.locator("text=Approval Center").count()) >= 1 || (await page.locator("text=approval.decide").count()) >= 1, "permission matrix renders");
  await ctx.close();
}
// --- Villa Keeper (mobile)
{
  const { ctx, page } = await as("demo.keeper1", { width: 390, height: 844 });
  await page.screenshot({ path: `${OUT}/keeper-mobile-dashboard.png`, fullPage: true });
  check((await page.locator("text=Villa yang ditugaskan kepada saya").count()) === 1, "Keeper sees 'my villas' card");
  await page.goto(`${BASE}/properti`);
  const cards = await page.locator("ul.md\\:hidden > li").count();
  check(cards === 3, `Keeper sees exactly 3 assigned villas (got ${cards})`);
  await page.screenshot({ path: `${OUT}/keeper-mobile-villas.png`, fullPage: true });
  for (const url of ["/karyawan", "/audit", "/pengaturan/peran", "/properti/baru"]) {
    await page.goto(`${BASE}${url}`);
    check((await page.locator("text=Akses ditolak").count()) === 1, `Keeper denied at ${url}`);
  }
  await page.click("button[aria-label='Buka menu']");
  const mnav = (await page.locator("div.fixed nav a").allInnerTexts()).map((t) => t.trim());
  check(!mnav.some((t) => /Karyawan|Audit|Pengaturan/.test(t)), `Keeper mobile nav hides admin modules: ${mnav.join(", ")}`);
  await ctx.close();
}
// --- Keeper cannot open another keeper's villa by URL
{
  const k2 = await as("demo.keeper2");
  await k2.page.goto(`${BASE}/properti`);
  const href = await k2.page.locator("table tbody tr a").first().getAttribute("href");
  await k2.ctx.close();
  const k1 = await as("demo.keeper1");
  await k1.page.goto(`${BASE}${href}`);
  check((await k1.page.locator("text=tidak termasuk dalam penugasan").count()) === 1, "Keeper 1 blocked from Keeper 2's villa via direct URL");
  await k1.ctx.close();
}
// --- System admin: can manage accounts but not finance
{
  const { ctx, page } = await as("demo.sysadmin");
  await page.goto(`${BASE}/pengaturan/peran`);
  await Promise.all([page.waitForURL(/pengaturan\/peran\/[0-9a-f-]{36}/), page.click("a:has-text('Villa Keeper')")]);
  const disabled = await page.locator("input[type=checkbox][disabled]").count();
  check(disabled >= 5, `Sysadmin sees financial permissions locked (${disabled} locked)`);
  await page.screenshot({ path: `${OUT}/sysadmin-role-edit.png` });
  await page.goto(`${BASE}/pengaturan/sistem`);
  check((await page.locator("text=Hanya GM yang dapat mengubah").count()) === 1, "Sysadmin cannot change approval threshold");
  await ctx.close();
}
// --- Housekeeper: no property access at all
{
  const { ctx, page } = await as("demo.hk1", { width: 390, height: 844 });
  await page.goto(`${BASE}/properti`);
  check((await page.locator("text=Akses ditolak").count()) === 1, "Housekeeper denied on villa list");
  await ctx.close();
}
// --- Wrong password
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.fill("#username", "demo.gm"); await page.fill("#password", "salah");
  await page.click("button[type=submit]");
  await page.waitForSelector("form div[role=alert]");
  check((await page.locator("form div[role=alert]").innerText()).includes("salah"), "wrong password shows error");
  await page.screenshot({ path: `${OUT}/login-error.png` });
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
