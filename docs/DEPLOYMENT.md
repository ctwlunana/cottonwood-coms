# Deployment, operations, backup & recovery

## 0. Production architecture (current)

| Part | Service | Notes |
|---|---|---|
| App | **Cloudflare Workers** (Workers Paid, USD 5/month) via OpenNext | `wrangler.jsonc`, custom entry `worker.ts` (adds Cron Triggers) |
| Database | **Supabase PostgreSQL**, project `COMS` (Singapore, free plan) | separate from the public-website project; app role `coms_app` owns all tables; RLS on, no Data-API grants |
| DB connection | **Cloudflare Hyperdrive** → Supabase session pooler (port 5432) | binding `HYPERDRIVE` |
| Files & nightly backups | **Cloudflare R2** bucket `coms-files` | binding `FILES`; `attachments/…` and `backups/…` |
| Scheduler | Cron Triggers: `*/5 * * * *` (reminders, escalations, notifications), `0 19 * * *` = 02:00 WIB (backup to R2) | secret `CRON_SECRET` |
| Domain | `ops.cottonwoodstays.com` (custom domain on the Worker) | requires the `cottonwoodstays.com` zone in Cloudflare |
| Communication | in-app notifications only (no WhatsApp, no email) | |

### Current production (Nov 2026)
* URL: **https://coms.ctwlunana.workers.dev** (temporary, until `cottonwoodstays.com` is moved to Cloudflare → `ops.cottonwoodstays.com`).
* Code: GitHub `ctwlunana/cottonwood-coms` (private). **Every push to `main` runs typecheck + 57 tests against PostgreSQL, then deploys** (`.github/workflows/deploy.yml`). The deploy also sets a fresh `CRON_SECRET`.
* Required GitHub secret: `CLOUDFLARE_API_TOKEN` (Cloudflare *Account API token* with Workers Scripts, Workers R2 Storage, Hyperdrive, Workers KV Storage: Edit, Account Settings: Read).
* Cloudflare resources: Worker `coms`, R2 bucket `coms-files` (APAC), Hyperdrive `coms-db` (→ Supabase session pooler, role `coms_app`, query caching disabled).
* Supabase project `COMS` (ap-southeast-1). The `coms_app` password exists only inside the Hyperdrive config; to rotate it: set a new password for `coms_app` in Supabase, then update Hyperdrive (`wrangler hyperdrive update <id> --origin-password ...`).

### First deployment checklist (reference)
1. Cloudflare: upgrade to **Workers Paid**; create API token (Edit Cloudflare Workers template + Workers R2 Storage Edit + Hyperdrive Edit + Account Settings Read).
2. `npx wrangler r2 bucket create coms-files`
3. `npx wrangler hyperdrive create coms-db --connection-string="postgres://coms_app.<project-ref>:<password>@aws-<n>-ap-southeast-1.pooler.supabase.com:5432/postgres"` → put the returned id into `wrangler.jsonc` (`TODO_HYPERDRIVE_ID`).
4. `openssl rand -base64 32 | npx wrangler secret put CRON_SECRET`
5. `npm run cf:deploy` (builds with OpenNext and deploys). Until the domain is on Cloudflare, remove the `routes` entry and use the `*.workers.dev` URL; set `APP_URL` accordingly.
6. Domain: add `cottonwoodstays.com` to Cloudflare (Free plan), check that the imported DNS records include the website (www) and **email MX/TXT records**, then change the nameservers at GoDaddy to the two Cloudflare nameservers. After activation, restore the `routes` custom domain `ops.cottonwoodstays.com` and redeploy.
7. In Supabase → Project Settings → API, you may additionally disable the Data API (COMS never uses it).

### Database migrations in production
`DATABASE_URL=<Supabase session-pooler URL for coms_app> npm run db:migrate` (from any machine/CI with network access). `db:migrate` also re-applies `coms_lockdown()` so new tables get RLS and no API grants. Run `npm run db:seed` afterwards to add new permissions/roles of a release.


## 1. Environment variables (Node / self-hosted alternative)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_URL` | yes | Public base URL, e.g. `https://coms.example.com` (used in reset links & emails) |
| `COOKIE_SECURE` | yes in prod | `true` when served over HTTPS (session cookie gets `Secure`) |
| `TRUST_PROXY` | behind proxy | `true` only when a reverse proxy you control sets `X-Forwarded-For` (used for audit IP + login rate limit) |
| `UPLOAD_DIR` | yes | Directory for uploaded files, **outside** the web root; include in backups |
| `UPLOAD_MAX_MB` | no | Per-file upload limit (default 10) |
| `DB_POOL_MAX` | no | DB pool size (default 10) |
| `BCRYPT_COST` | no | Password hash cost (default 12) |
| `CRON_SECRET` | Workers | Shared secret between the Cron Trigger and `/api/cron` |
| `STORAGE_DRIVER` | no | `r2` forces the R2 adapter (automatic on Workers) |
| `BACKUP_DIR`, `BACKUP_KEEP_DAYS` | no | For `scripts/backup.sh` (defaults `./backups`, 30) |
| `TEST_DATABASE_URL` | tests | Must contain "test"; it is wiped on every test run |
| `DEMO_PASSWORD` | dev | Password for demo accounts |

Never commit `.env`. Generate strong DB passwords.

## 2. Recommended low-cost deployment: one VPS

Size: 2 vCPU / 4 GB RAM is ample for ~100 users. Ubuntu 24.04.

```bash
# as root
apt-get install -y postgresql-16 nodejs npm caddy   # Node 22 via NodeSource if distro version is older
sudo -u postgres createuser -P coms && sudo -u postgres createdb -O coms coms
git clone <repo> /opt/coms && cd /opt/coms
cp .env.example .env && nano .env          # DATABASE_URL, APP_URL, COOKIE_SECURE=true, TRUST_PROXY=true, UPLOAD_DIR=/var/lib/coms/uploads
npm ci && npm run build
npm run db:migrate && npm run db:seed      # NO --demo in production
npm run admin:create -- --username <owner> --name "<Nama GM>" --code <EMP-000> --role gm
npm run admin:create -- --username <admin> --name "<Nama Admin>" --code <EMP-001> --role sysadmin
```

Run as a service (`/etc/systemd/system/coms.service`):

```ini
[Unit]
Description=COMS
After=network.target postgresql.service
[Service]
WorkingDirectory=/opt/coms
EnvironmentFile=/opt/coms/.env
ExecStart=/usr/bin/npx next start -p 3000 -H 127.0.0.1
Restart=always
User=coms
[Install]
WantedBy=multi-user.target
```

HTTPS reverse proxy (`/etc/caddy/Caddyfile`): `coms.example.com { reverse_proxy 127.0.0.1:3000 }` — Caddy obtains certificates automatically.

Cron (`crontab -u coms -e`):
```
*/5 * * * * cd /opt/coms && npm run cron >> /var/log/coms/cron.log 2>&1
0 2 * * *   /opt/coms/scripts/backup.sh >> /var/log/coms/backup.log 2>&1
```

Uptime monitor: `GET /api/health` → `{"status":"ok"}`.

Alternative: `deploy/docker-compose.yml` (app + Postgres). It was written but **not built in the development environment** (no Docker daemon) — test before relying on it.

Managed alternative: any Node host + managed PostgreSQL (Supabase/Neon/RDS). Local-disk uploads then need a persistent volume, or an S3-compatible storage adapter (interface in `src/lib/storage.ts`).

## 3. Updating

```bash
cd /opt/coms && git pull && npm ci && npm run build && npm run db:migrate && npm run db:seed && systemctl restart coms
```
`db:seed` adds new permissions/roles introduced by a release but never overwrites matrix customizations.

## 4. Backup & recovery

**In the app (Manager ke atas / GM):** *Pengaturan → Backup data*
* **Backup File — Database**: consistent snapshot of all tables, `.json.gz`, downloaded to your device.
* **Backup File — Foto & Dokumen**: all uploaded files as `.tar` with `MANIFEST.json`.
* Automatic nightly database backup to R2 (02:00 WIB, kept 30 days), downloadable from the same page.
* Restore a database backup: create an empty database, `npm run db:migrate` (no seed), then `npm run backup:restore -- <file.json.gz>`. Files: `tar -xf` and upload the `files/` contents to R2 keeping the paths.
* The dashboard warns the GM when the last successful backup is older than 7 days.

### Self-hosted PostgreSQL (alternative)

* `scripts/backup.sh` writes `coms-db-<stamp>.dump` (pg_dump custom format, verified with `pg_restore --list`) and `coms-uploads-<stamp>.tar.gz`, keeps 30 days.
* **Copy backups off the server daily** (e.g. `rclone` to cloud storage). A backup on the same disk is not a backup.
* Restore (tested during Stage 1 on a scratch database):

```bash
systemctl stop coms
sudo -u postgres dropdb coms && sudo -u postgres createdb -O coms coms
pg_restore --no-owner -d "$DATABASE_URL" backups/coms-db-<stamp>.dump
tar -xzf backups/coms-uploads-<stamp>.tar.gz -C /var/lib/coms/
systemctl start coms
```

* Do a restore drill at least quarterly.
* The audit log is append-only (DB trigger); restore re-inserts rows, which is allowed.

## 5. Logs

Application errors go to stdout (`journalctl -u coms`). Failed notification deliveries are in `notification_delivery_logs` (status `failed`, `error`, `retry_count`).
