# Deployment, operations, backup & recovery

## 1. Environment variables

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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | no | Email channel. Empty ⇒ email deliveries logged as `skipped` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | no | WhatsApp Business Cloud API (requires an approved message template). Empty ⇒ `skipped`. **Adapter not verified against a live account.** |
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
