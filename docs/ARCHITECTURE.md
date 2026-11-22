# COMS — Technical Architecture

Cottonwood Operations Management System. Internal web app for ~38 villas
(scalable), ~80+ employees, Indonesian UI.

## 1. Repository inspection result

The workspace was **empty** (no code, no git, no existing backend, no env
config, no integrations). Nothing to preserve or reuse. The architecture below is
therefore a fresh, deliberately small stack.

## 2. Stack decision

| Concern | Choice | Why |
|---|---|---|
| Web framework | **Next.js 15 (App Router) + React 19 + TypeScript** | One deployable for UI + server logic. Server Components query the DB directly (no public REST API surface to secure twice). Server Actions have built-in Origin/Host CSRF check. |
| Database | **PostgreSQL 16** | Relational integrity (FKs, CHECKs, transactions), row locking for stock/approval races, free, runs anywhere (VPS, Supabase, Neon, RDS). |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Typed SQL, parameterized queries (no SQL injection), plain SQL migration files committed to git, no native engine binary. |
| Auth | **Own session auth**: bcrypt (cost 12) hashes, random 256-bit session tokens stored *hashed* in `sessions`, httpOnly + Secure + SameSite=Lax cookie | No paid auth service; server-side revocation (deactivate user ⇒ all sessions die immediately). |
| Styling | Tailwind CSS 4 | Small, mobile-first utility CSS, no design-system dependency. |
| Files | Local disk adapter (`UPLOAD_DIR`) behind an authorized download route; adapter interface ready for S3-compatible storage | Zero cost initially; never served from `public/`. |
| Notifications | `notify()` engine → in-app (always) + adapters for Email (SMTP) and WhatsApp Business (Cloud API) | Adapters are **disabled unless credentials exist**; every attempt is written to `notification_delivery_logs` (incl. `skipped`/`failed`). |
| Scheduler | `scripts/cron.ts` run by system cron / platform scheduler every 5 min (reminders, escalations, overdue checks) | No queue infrastructure needed at this size. |
| Tests | Vitest against a real PostgreSQL test DB | Tests the real SQL, constraints and permission logic — not mocks. |

Hosting target (cheapest reliable): one small VPS (2 vCPU / 4 GB) running
Node 22 + PostgreSQL with nightly `pg_dump` backups, or Vercel + managed
Postgres. See `docs/DEPLOYMENT.md`.

## 3. Layering

```
src/app/**            Pages (Server Components) + Server Actions  — thin
   │  getActor()  ─── reads session cookie, loads user + effective permissions
   ▼
src/services/**       Business logic. EVERY function takes an `Actor` and
                      calls authz checks itself (requirePermission / scope
                      filters). Pages cannot bypass it.
   ▼
src/lib/authz.ts      Permission + scope evaluation, segregation-of-duty guards
src/lib/audit.ts      Append-only audit writer (same DB transaction as change)
src/lib/notify/**     Notification engine + channel adapters
src/db/schema/**      Drizzle schema (single source of truth) → migrations/
```

Rule: **authorization lives in services, not in the UI.** The UI hides
buttons for convenience only. Tests call services directly with actors of
different roles to prove boundaries.

## 4. Authorization model (RBAC + scope)

* `permissions` — fixed catalog of codes defined in code
  (`src/lib/permissions.ts`), synced to DB by the seed. Example:
  `property.view`, `maintenance.assign`, `inventory.request_approve`.
* `roles` — configurable (17 default roles). A user may hold several roles
  (`user_roles`).
* `role_permissions(role, permission, scope)` — the **permission matrix**,
  editable in *Pengaturan → Peran & Hak Akses* by holders of `rbac.manage`.
  Scope values:
  * `own` — only records the user created or is assigned to
  * `assigned` — records of villas assigned to the user
    (`property_assignments`) or villas in locations they are PIC of
  * `department` — records of the user's department
  * `all` — company-wide
* Effective permission = union of roles, widest scope wins.
* **Financial approval authority is never implied by a role name.** The
  System Administrator role has `rbac.manage`/`employee.manage` but no
  `approval.*`, `finance.*` or `accounting.*` permissions by default.
  Approval authority (Stage 5) = `approval.decide` permission **and** a
  matching `approval_rules` row (type, amount range, department).
* Anti privilege escalation: a user cannot edit their own roles, and cannot
  grant a permission they don't themselves hold (except GM).
* Segregation-of-duty guards (enforced in services, also tested):
  requester ≠ approver; purchasing officer ≠ PR/PO approver; finance ≠
  payment approver; inventory staff ≠ stock-movement approver; petty cash
  custodian ≠ reconciler; split-transaction detection for thresholds.

## 5. Data integrity

* All timestamps `timestamptz` (UTC in DB); displayed in `Asia/Jakarta`.
* Money: `numeric(15,0)` IDR (Rupiah has no practical minor unit) — never
  float.
* Human-readable codes (`VL-001`, `WO-2026-000123`, `CS-2026-000045`) from a
  transactional counter table `id_counters` (no gaps from races).
* Soft delete / cancellation only for operational and financial records
  (`status` + `cancelled_*` / `deleted_at`). No hard-delete UI.
* `audit_logs` is **append-only**: a DB trigger rejects UPDATE/DELETE.
  Audit rows are written inside the same transaction as the change, so a
  change without an audit entry cannot commit.
* Inventory balances are derived from an immutable `stock_movements` ledger
  (Stage 4); balance tables are caches updated in the same transaction with
  row locks; adjustments require an approved adjustment movement.
* Status transitions are validated by explicit state machines per module.

## 6. Security

* bcrypt password hashing, minimum password policy, forced change on first
  login for admin-created accounts.
* Login rate limit: DB-backed (`login_attempts`), 5 failures / 15 min per
  username and 20 / 15 min per IP.
* Session: hashed token, 12h idle / 7d absolute expiry, revocable; list +
  revoke own sessions; all sessions revoked on deactivate & password reset.
* CSRF: Server Actions (Origin check) + SameSite=Lax cookie; no
  state-changing GET routes.
* Input validation with zod on every action.
* Guest PII (phone, email, address, booking ref) behind `cs.guest_pii_view`;
  masked otherwise (Stage 3).
* File upload: MIME sniffing by magic bytes, size limit, random storage
  names, served only through an authorized route.
* Secrets only via environment variables (`.env` never committed).

## 7. Notifications

`notify({ type, recipients, entity, priority, dedupeKey })`:
1. Resolve recipients (users or "holders of permission X for villa Y").
2. Deduplicate by `dedupe_key` within a window.
3. Respect `notification_preferences` + quiet hours (critical ignores quiet
   hours).
4. Insert `notifications` (in-app) and enqueue each external channel in
   `notification_delivery_logs` (`pending|sent|failed|skipped`, retry count,
   error). Missing credentials ⇒ `skipped` with reason — never silent.

Escalation engine (Stage 6) runs on the scheduler with configurable
`escalation_rules` (e.g. High not acknowledged in 30 min → supervisor;
overdue N hours → GM).

## 8. Delivery stages

| Stage | Scope | Testable outcome |
|---|---|---|
| 1 | Foundation: DB, auth, RBAC matrix, employees, departments, locations, villas, assignments, audit log, notification core, CSV import (villas, employees) | Each employee logs in with different rights; Keeper sees only assigned villas |
| 2 | Keeper workspace, checklists, maintenance/work orders, housekeeping | Villa operational flow |
| 3 | CS cases & tasks, communication log, shift report/handover, Lost & Found | Shift report + guest case flow |
| 4 | Inventory ledger, stock requests, purchasing (PR→PO→GRN→invoice) | Controlled stock & purchasing |
| 5 | Finance, accounting, petty cash, approval center & rules | Auditable expenses/payments |
| 6 | GM dashboard, department dashboards, reports, escalations, reminders | GM monitors all operations |

See `docs/ERD.md` for the full relational model (all stages).
