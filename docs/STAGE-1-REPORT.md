# Stage 1 report — Foundation

Target: *"Setiap karyawan login dengan hak akses berbeda."* — **met and tested.**

## Completed & functional

| Area | What works |
|---|---|
| Architecture | Next.js 15 + PostgreSQL 16 + Drizzle; docs in `ARCHITECTURE.md`, full-system ERD in `ERD.md` |
| Database | 21 tables, 2 migrations, FKs/indexes/partial unique indexes, append-only audit trigger, CHECK constraints |
| Authentication | Login/logout, bcrypt, hashed server-side sessions (idle 12 h configurable / absolute 7 d), DB-backed login rate limit (5/user, 20/IP per 15 min), generic error messages, forced password change for new accounts, change password (other sessions revoked), list/revoke own sessions |
| Password reset | "Lupa password" → in-app notification to admins → single-use 2 h link issued by admin → reset revokes all sessions. No email needed. |
| RBAC | 75-permission catalog covering all 6 stages, 17 default roles, multi-role users, scoped permissions (own / assigned / department / all), editable matrix UI, backend enforcement in every service |
| Control rules | Sysadmin has no financial authority and cannot grant it; financial roles/permissions only changeable by GM; nobody edits own roles or own role's permissions; approval threshold (Rp10.000.000, configurable) only changeable by GM |
| Employees | List/search/filter, create (one-time temp password), edit, roles, activate/deactivate (kills sessions, ends assignments), reset link, account history |
| Departments | CRUD (10 defaults) |
| Locations & villas | CRUD, status, filters (location, name/code, keeper, status, "no keeper"), mobile cards, photos (magic-byte validated, authorized download), archive instead of delete, keeper/inspector/PIC assignments with history, per-villa change history |
| Scope | Keeper sees only assigned villas (list, detail, direct URL, photos); PIC sees own cluster; supervisors/GM see all |
| Audit trail | Every login/logout/failed login, create/update/status/assignment/role/permission/setting/import change with before/after diff, IP and user agent; filterable viewer; DB rejects UPDATE/DELETE/TRUNCATE |
| Notifications | Engine with dedupe, per-user channel preferences, quiet hours (22:00–07:00 default, critical bypasses), in-app bell with unread count (polls every 60 s), click opens record & marks read, delivery log per channel with status/error/retry; email (SMTP) and WhatsApp adapters disabled until configured → logged as `skipped` |
| Settings | Org name, timezone, GM approval threshold, quiet hours, session idle timeout |
| Onboarding | `admin:create` bootstrap, CSV import of villas & employees (validate-first, all-or-nothing, re-import updates villas), CSV templates for villas/employees/inventory/suppliers |
| Ops | `/api/health`, `npm run cron`, `scripts/backup.sh` (backup **and restore verified**), systemd/Caddy instructions, Docker compose (untested) |
| Security | Server-side authz, zod validation, parameterized SQL, CSRF via Server Action origin check + SameSite cookie, security headers, upload sniffing/size limits, CSV formula-injection guard, no-index; `npm audit --omit=dev`: 0 vulnerabilities |

## Test results

* `npm test` — **37/37 passed** (auth, rate limit, reset, sessions, scope per role, permission boundaries, SoD guards, matrix changes, audit immutability, notifications/dedupe/quiet hours/retries, CSV import atomicity, upload validation, code generation).
* `npm run test:e2e` against the production build — **all passed**:
  * `roles.e2e`: GM/Keeper (mobile 390 px)/Sysadmin/Housekeeper see different menus and data; keeper denied on admin pages and on another keeper's villa by URL; sysadmin sees financial permissions locked; dashboard drill-down lists the underlying villas.
  * `lifecycle.e2e`: admin creates keeper → forced password change → GM assigns villa → keeper sees it → forgot password → admin notified → link → reset (old session revoked) → deactivate (immediate logout, login refused, villa shows "no keeper") → full chain visible in audit trail.

## How to test Stage 1 yourself

1. `npm run db:seed:demo`, `npm run dev`, open `/login`.
2. Log in as `demo.gm` → dashboard tiles → click **Tanpa Villa Keeper** → assign a keeper.
3. Log in as `demo.keeper1` on a phone → only 3 villas; try `/karyawan` → *Akses ditolak*.
4. Log in as `demo.sysadmin` → *Pengaturan → Peran & Hak Akses → Villa Keeper* → approval/finance rows are locked; try giving `demo.keeper1` the Finance role → refused.
5. *Audit Trail* → every action above is listed with before/after.

## Not yet built (by design — later stages)

Checklists, maintenance/work orders, housekeeping, CS cases & shift reports, Lost & Found, inventory, purchasing, finance/accounting/petty cash, approval center & rules, GM executive dashboard, reports/exports, escalation rules. Their permissions already exist in the matrix (marked "modul tahap N"), but no menu items or buttons are shown until the module exists.

## Requires external credentials / services

* **Email**: SMTP credentials (any provider, e.g. Google Workspace, Mailgun, Brevo free tier).
* **WhatsApp Business Cloud API**: Meta business account, phone number ID, token, and an approved template. Code path exists but is unverified.
* **Hosting**: a VPS or managed host + domain for HTTPS.
* **Off-site backup target** (e.g. any S3-compatible bucket / Google Drive via rclone).

## Known limitations

* Docker files not built here (no Docker daemon in the dev container).
* HEIC photos are stored and downloadable but browsers other than Safari may not preview them.
* Rate limiting uses the client IP only when `TRUST_PROXY=true` behind your own proxy; otherwise per-username only.
* Occupancy / check-in / check-out figures (needed by the GM dashboard) require a booking source; no booking-system integration exists. Stage 3/6 will provide manual/CSV booking entry unless a verified API is available.

## Business decisions needed (before / during Stage 2)

1. **Location PIC default rights** — currently: see & report on all villas in the cluster, confirm repairs, inspect readiness, no financial rights. OK?
2. **Housekeeper accounts** — ~50 housekeepers: does each have a smartphone for an individual account, or do Team Leaders update status on their behalf?
3. **Who inspects villa readiness** — Villa Keeper of that villa only, or any assigned inspector / HK Team Leader?
4. **Maintenance auto-routing** — should every Keeper report go to Supervisor Engineer for review (current design), or should Critical issues create a work order immediately?
5. **Hosting choice & domain**, and whether to set up SMTP now.
