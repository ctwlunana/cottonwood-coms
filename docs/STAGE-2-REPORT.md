# Stage 2 report — Villa, Keeper, Engineering, Housekeeping (+ hosting changes)

Target: *"Alur operasional villa berjalan."* — **met and tested** (service tests + browser tests in the Cloudflare Workers runtime).

## Decisions applied
| Decision | Implementation |
|---|---|
| No WhatsApp; everything in the app | WhatsApp **and** email channels removed; in-app notifications only (adapter slot kept for future in-app browser push) |
| Hosting on Cloudflare | OpenNext → Cloudflare Workers, R2 for files/backups, Hyperdrive → Supabase PostgreSQL (dedicated `COMS` project), Cron Triggers |
| Domain | `ops.cottonwoodstays.com` (www stays the public website) |
| Backup button, Manager+ only | `backup.run` permission (GM by default; protected — only GM can grant it); database + files download, nightly R2 backup, restore CLI, audit trail |
| PIC Lokasi rights | unchanged: view & report for their cluster, no financial authority |
| Every housekeeper has an account | assignments, start/finish, photos per housekeeper on the phone |
| Who declares a villa ready | only the villa's Keeper, an assigned inspector, or an HK Team Leader (of the location or the assigned team); never the cleaner; enforced in service **and** DB trigger |
| Critical reports | still reviewed by Supervisor Engineer (GM is alerted immediately) |

## Modules
* **Keeper workspace** (dashboard): today's checklist per villa, quick "Isi checklist" / "Lapor kerusakan", open work orders on my villas, items awaiting my confirmation, villas awaiting inspection.
* **Daily checklist**: configurable templates (default 12 items), Ya/Bermasalah/N/A, note + mandatory photo on failure, label snapshots, one-click maintenance request per failed item, reminder at 15:00 WIB if not submitted.
* **Maintenance**: report (photos, priority guide) → Supervisor Engineer review (convert / merge duplicate / reject) → work order (assign engineer or external vendor, SLA deadline by priority) → start (before photos) → materials / waiting parts → complete (findings, notes, before+after photos mandatory) → verification (never by the engineer who did it; DB CHECK) → Keeper confirmation (optional) → closed. Priority escalation, cancellation with reason, cost estimate/actual, full timeline, repeat-problem detection (≥2 in 90 days → supervisor + GM), equipment register, preventive schedules that auto-generate work orders and advance on closure.
* **Housekeeping**: daily board (status counts, manpower per housekeeper), schedule (multi-housekeeper, team), start → finish with photos → *inspection required* → pass = **Ready** / fail (note + photo) → re-clean, metrics (on-time readiness, re-clean rate, per-housekeeper output), teams.
* **Villa page**: maintenance history, cleaning history, checklists, equipment.
* **Escalations (every 5 min)**: unassigned critical/high WO after 30 min, overdue WO (daily, GM after 24 h), overdue cleaning, cleaning waiting > 60 min for inspection, missing checklist. All thresholds in *Pengaturan → Sistem*; deduplicated.

## Tests
* `npm test`: **57/57** (Stage 1 + backup round-trip restore + Stage 2 workflows, SoD, scopes, escalations).
* `npm run test:e2e` against the OpenNext/Workers build: **4 suites, all passed** (roles, account lifecycle, backup & photos, Stage 2 incl. Scenario 3 end-to-end on phone viewports).

## Deployment status
* Supabase `COMS` database: **created, migrated, seeded** (71 permissions, 17 roles, default checklist, accounts `gm` and `admin` with one-time temporary passwords). RLS on all 38 tables, no Data-API grants, advisor warnings fixed.
* Cloudflare: token received but it cannot read the account → Worker not deployed yet (see DEPLOYMENT.md checklist).
* GitHub: account not yet linked to Claude → code is committed locally only.

## Known limitations
* Housekeeping assignments are created manually (no booking/PMS integration yet; checkout dates come from the coordinator).
* Push notifications to the phone's lock screen are not implemented yet (in-app bell + dashboard only; the bell refreshes every 60 s).
* HEIC photos are stored but only Safari previews them.
