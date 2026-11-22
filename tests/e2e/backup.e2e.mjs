// Backup buttons + photo storage, through the real UI.
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = process.env.DEMO_PASSWORD ?? "demo-cottonwood-2026";
let failures = 0;
const check = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };
const browser = await chromium.launch();
// fetch from inside the page so the browser's own (Secure, httpOnly) session cookie is used
const fetchIn = (page, url, init = {}) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, i); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, len: b.length };
}, [url, init]);
async function as(u) {
  const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.fill("#username", u); await page.fill("#password", PW);
  await Promise.all([page.waitForURL(/dashboard/), page.click("button[type=submit]")]);
  return { ctx, page };
}

// GM uploads a villa photo
const gm = await as("demo.gm");
await gm.page.goto(`${BASE}/properti?q=Villa A`);
await gm.page.locator("table a:has-text('Villa A')").click();
await gm.page.waitForURL(/properti\/[0-9a-f-]{36}$/);
const villaUrl = gm.page.url();
await gm.page.setInputFiles("input[type=file][name=files]", new URL("./sample.jpg", import.meta.url).pathname);
await gm.page.click("button:has-text('Unggah foto')");
await gm.page.waitForSelector("text=1 foto diunggah");
const imgSrc = await gm.page.locator("figure img").first().getAttribute("src");
const r = await fetchIn(gm.page, imgSrc);
check(r.status === 200 && r.len === readFileSync(new URL("./sample.jpg", import.meta.url)).length, "photo stored and served back byte-identical");

// keeper1 is keeper of Villa A → can see; keeper2 → 403
const k1 = await as("demo.keeper1");
check((await fetchIn(k1.page, imgSrc)).status === 200, "assigned keeper can view the villa photo");
const k2 = await as("demo.keeper2");
check((await fetchIn(k2.page, imgSrc)).status === 403, "other keeper gets 403 on the photo URL");

// GM: backup buttons
await gm.page.goto(`${BASE}/pengaturan/backup`);
const [dl] = await Promise.all([gm.page.waitForEvent("download"), gm.page.click("button:has-text('Backup File — Database')")]);
check(/^coms-backup-database-\d{8}-\d{4}\.json\.gz$/.test(dl.suggestedFilename()), `database backup downloaded: ${dl.suggestedFilename()}`);
const json = JSON.parse(gunzipSync(readFileSync(await dl.path())).toString());
const users = json.tables.find((t) => t.name === "users");
check(json.header.format === "coms-backup" && users.rows.length >= 21, `backup contains ${json.tables.length} tables, ${users.rows.length} users`);
const pwCol = users.columns.findIndex((c) => c.name === "password_hash");
check(pwCol >= 0, "backup includes password hashes (needed for restore) — file must be kept private");
const [dl2] = await Promise.all([gm.page.waitForEvent("download"), gm.page.click("button:has-text('Backup File — Foto & Dokumen')")]);
const tar = readFileSync(await dl2.path());
check(tar.length % 512 === 0 && tar.includes(Buffer.from("MANIFEST.json")), `files backup is a tar (${tar.length} bytes)`);
await gm.page.reload();
check((await gm.page.locator("text=diunduh oleh [DEMO] General Manager").count()) >= 2, "backup history shows both downloads");

// Sysadmin: no backup access
const sa = await as("demo.sysadmin");
await sa.page.goto(`${BASE}/pengaturan`);
check((await sa.page.locator("text=Backup data").count()) === 0, "sysadmin does not see Backup in settings");
const forged = await fetchIn(sa.page, "/api/backup/database", { method: "POST" });
check(forged.status === 403, `sysadmin POST to backup endpoint refused (${forged.status})`);
// cross-site form post from another origin: browser sends Origin: evil → must be refused
const evil = await gm.ctx.newPage();
await evil.route("https://evil.example/", (r) => r.fulfill({ contentType: "text/html", body: `<form id=f method=post action="${BASE}/api/backup/database"></form><script>f.submit()</script>` }));
const [resp] = await Promise.all([evil.waitForResponse((x) => x.url().includes("/api/backup/database")), evil.goto("https://evil.example/")]);
check(resp.status() === 403 || resp.status() === 401, `cross-origin backup request refused (${resp.status()})`);

// Audit
await gm.page.goto(`${BASE}/audit?action=backup`);
check((await gm.page.locator("text=Backup database diunduh").count()) >= 1, "backup download recorded in audit trail");
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
