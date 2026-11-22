# Onboarding the real organization

Do **not** run `db:seed:demo` in production. Demo records are labelled `[DEMO]` / `DEMO-…`
and flagged `is_demo` so they can never be confused with real data.

## Step 1 — First accounts (server console)

```bash
npm run db:migrate && npm run db:seed
npm run admin:create -- --username <owner> --name "<Nama GM/Owner>" --code <EMP-000> --role gm
npm run admin:create -- --username <it.admin> --name "<Nama Admin>" --code <EMP-001> --role sysadmin
```
Each command prints a one-time temporary password; it must be changed at first login.
Only `gm` and `sysadmin` can be bootstrapped this way — everyone else is created in the app.

Separation of duties built in:
* The **System Administrator** can create accounts, roles and villas but has **no approval or financial authority** and cannot grant it.
* Roles carrying financial / approval permissions (GM, Finance, Accounting, and any role you give such permissions) can only be granted or revoked **by the GM**.
* Nobody can change their own roles.

## Step 2 — Review roles & permissions

*Pengaturan → Peran & Hak Akses.* 17 default roles are provided (GM, Supervisor Villa,
PIC Lokasi, Villa Keeper, Supervisor Engineer, Engineer, Koordinator HK, Team Leader HK,
Housekeeper, Supervisor Inventory, Staff Inventory, Purchasing Officer, CS Lead, CS Staff,
Finance, Accounting, System Administrator). Review the matrix with the GM before inviting staff.
Each permission has a data scope: own / assigned villas / department / company-wide.

## Step 3 — Locations & villas

Either manually (*Lokasi*, *Properti → Tambah villa*) or by CSV (*Pengaturan → Impor CSV*):

1. Download `template-villas.csv`. Columns:
   `code, name, location_code, location_name, location_area, address, status, bedrooms, bathrooms, max_guests, keeper_employee_code, notes`
   * `status`: `active | temporarily_unavailable | under_maintenance | inactive`
   * Unknown `location_code` → location is created with `location_name`.
   * Existing `code` → that villa is updated (re-importing is safe).
2. Click **Validasi saja** first; fix every reported row; then **Impor sekarang**.
   One bad row rejects the whole file (nothing is saved).

Import villas **after** employees if you want `keeper_employee_code` to assign keepers in the same step.

## Step 4 — Employees

CSV (`template-employees.csv`):
`employee_code, username, full_name, department_code, roles, job_title, email, phone`
* `department_code`: `MGT, PROP, ENG, HK, INV, PUR, CS, FIN, ACC, IT` (editable in *Pengaturan → Departemen*)
* `roles`: role slugs separated by `;`, e.g. `villa_keeper;location_pic`
  (slugs: `gm, supervisor_villa, location_pic, villa_keeper, supervisor_engineer, engineer, hk_coordinator, hk_team_leader, housekeeper, supervisor_inventory, inventory_staff, purchasing_officer, cs_lead, cs_staff, finance, accounting, sysadmin`)
* Finance / Accounting / GM rows must be imported by the GM (System Administrator will be refused).
* After import, download the one-time temporary password list and hand each password to the person privately. Delete the file afterwards.

Every employee gets an individual account — shared department accounts are not allowed.

## Step 5 — Assignments

* Villa → *Penugasan*: one active **Villa Keeper** per villa (assigning a new one ends the previous assignment, kept in history); optional readiness inspectors.
* Location → **PIC Lokasi** sees all villas in that cluster. A PIC assignment grants no financial authority.
* Dashboard tile **Tanpa Villa Keeper** must reach 0 — "no task without an owner".

## Step 6 — Everyday account admin

* Forgot password: the employee uses *Lupa password*; admins get an in-app notification; admin opens the employee and clicks **Terbitkan link reset password** (valid 2 h, single use), then sends the link privately (e.g. WhatsApp). When SMTP is configured this can later be emailed automatically.
* Leaving employee: **Nonaktifkan akun** — immediately logs them out everywhere and ends their villa/location assignments (history retained; nothing is deleted).
* Everything above is visible in *Audit Trail*.

## Other templates

`template-inventory.csv` and `template-suppliers.csv` are provided now so data can be prepared; their importers arrive with Stage 4.
