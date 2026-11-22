// Account lifecycle through the real UI:
// sysadmin creates a Keeper → new user forced to change temp password → GM assigns a villa →
// keeper sees it → forgot-password request notifies admin → admin issues link → user resets →
// admin deactivates → login refused. Everything ends up in the audit trail.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = process.env.DEMO_PASSWORD ?? "demo-cottonwood-2026";
const suffix = Date.now().toString(36);
const uname = `uji.keeper.${suffix}`;
let failures = 0;
const check = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };
const browser = await chromium.launch();

async function login(page, u, p) {
  await page.goto(`${BASE}/login`); await page.fill("#username", u); await page.fill("#password", p);
  await page.click("button[type=submit]");
  await page.waitForLoadState("networkidle");
}
const ctxPage = async () => { const c = await browser.newContext(); return [c, await c.newPage()]; };

// 1. sysadmin creates employee
const [ac, admin] = await ctxPage();
await login(admin, "demo.sysadmin", PW);
await admin.goto(`${BASE}/karyawan/baru`);
await admin.fill("input[name=fullName]", "Uji Keeper E2E");
await admin.fill("input[name=employeeCode]", `E2E-${suffix}`);
await admin.fill("input[name=username]", uname);
await admin.selectOption("select[name=departmentId]", { label: "Property Operations" });
await admin.locator("label:has(span.font-medium:text-is('Villa Keeper')) input[type=checkbox]").check();
await admin.click("button:has-text('Buat akun')");
await admin.waitForSelector("text=Password sementara");
const temp = (await admin.locator("p.font-mono").innerText()).trim();
check(/^.{4}-.{4}-.{4}$/.test(temp), "temporary password shown once");

// 2. new user must change password
const [uc, user] = await ctxPage();
await login(user, uname, temp);
check(user.url().includes("/profil"), "first login is forced to the change-password page");
await user.goto(`${BASE}/properti`);
check(user.url().includes("/profil"), "other pages blocked until password is changed");
await user.fill("input[name=current]", temp); await user.fill("input[name=next]", "PasswordBaru2026"); await user.fill("input[name=next2]", "PasswordBaru2026");
await Promise.all([user.waitForURL(/dashboard/), user.click("button:has-text('Simpan password')")]);
check((await user.locator("text=Belum ada villa yang ditugaskan").count()) === 1, "new keeper has no villas yet");

// 3. GM assigns villa F (unassigned demo villa)
const [gc, gm] = await ctxPage();
await login(gm, "demo.gm", PW);
await gm.goto(`${BASE}/properti?keeper=none`);
await gm.locator("table a:has-text('Villa F')").click();
await gm.waitForURL(/properti\/[0-9a-f-]{36}$/);
await gm.locator("form:has(input[name=kind][value=villa_keeper]) select[name=userId]").selectOption({ label: `Uji Keeper E2E (E2E-${suffix})` });
await gm.locator("form:has(input[name=kind][value=villa_keeper]) button[type=submit]").click();
await gm.waitForSelector("text=Penugasan disimpan");
await user.goto(`${BASE}/properti`);
check((await user.locator("text=Villa F").count()) >= 1, "keeper now sees the assigned villa");

// 4. forgot password → admin notified → issue link → reset
const [fc, anon] = await ctxPage();
await anon.goto(`${BASE}/lupa-password`); await anon.fill("#username", uname); await anon.click("button[type=submit]");
await anon.waitForSelector("text=administrator telah diberi tahu");
await admin.goto(`${BASE}/notifikasi`);
check((await admin.locator(`text=Permintaan reset password`).count()) >= 1, "admin got an in-app notification");
await admin.locator("a:has-text('Permintaan reset password')").first().click();
await admin.waitForURL(/karyawan\/[0-9a-f-]{36}/);
admin.once("dialog", (d) => d.accept());
await admin.click("button:has-text('Terbitkan link reset password')");
await admin.waitForSelector("p.select-all");
const link = (await admin.locator("p.select-all").innerText()).trim();
check(link.includes("/reset-password/"), "reset link issued");
await anon.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
await anon.fill("#password", "LagiBaru2026x"); await anon.fill("#password2", "LagiBaru2026x");
await Promise.all([anon.waitForURL(/login\?reset=1/), anon.click("button[type=submit]")]);
await user.reload();
check(user.url().includes("/login"), "existing session was revoked by the reset");
await login(user, uname, "LagiBaru2026x");
check(user.url().includes("/dashboard"), "login with new password works");

// 5. deactivate → session dies, login refused
await admin.reload();
admin.once("dialog", (d) => d.accept());
await admin.click("button:has-text('Nonaktifkan akun')");
await admin.waitForSelector("text=Aktifkan akun");
await user.goto(`${BASE}/dashboard`);
check(user.url().includes("/login"), "deactivated user is logged out immediately");
await login(user, uname, "LagiBaru2026x");
check(user.url().includes("/login"), "deactivated user cannot log in");

// 6. audit trail shows the chain
await admin.goto(`${BASE}/audit?entityType=user`);
const txt = await admin.locator("table.table").innerText();
for (const a of ["Karyawan dibuat", "Peran karyawan diubah", "Ganti password", "Link reset diterbitkan", "Reset password", "Akun dinonaktifkan"]) check(txt.includes(a), `audit contains '${a}'`);
await gm.goto(`${BASE}/properti?keeper=none`);
check((await gm.locator("table a:has-text('Villa F')").count()) === 1, "after deactivation Villa F shows as 'no keeper' again");

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
