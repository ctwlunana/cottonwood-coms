# COMS — Cottonwood Operations Management System

Internal operations platform for Cottonwood Boutique Stays Indonesia (≈38 villas).
UI in Bahasa Indonesia; code and technical docs in English.

**Status: Stage 1 (Foundation) complete.** See [`docs/STAGE-1-REPORT.md`](docs/STAGE-1-REPORT.md).

| Doc | Content |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, layering, RBAC model, security, stage plan |
| [docs/ERD.md](docs/ERD.md) | Database relationship diagrams (all stages) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Env vars, deployment, cron, backup & recovery |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | First admin, employees, villas, CSV import |
| [docs/STAGE-1-REPORT.md](docs/STAGE-1-REPORT.md) | What works, how to test, limitations, open decisions |

## Quick start (development)

Requirements: Node 22+, PostgreSQL 14+.

```bash
cp .env.example .env            # then edit DATABASE_URL
npm install
npm run db:migrate              # apply migrations
npm run db:seed:demo            # roles/permissions + clearly-labelled [DEMO] data
npm run dev                     # http://localhost:3000
```

Demo accounts (development only): `demo.gm`, `demo.sysadmin`, `demo.spv.villa`,
`demo.pic.utara`, `demo.keeper1`, `demo.keeper2`, `demo.spv.eng`, `demo.eng1`,
`demo.hk.coord`, `demo.hk1`, `demo.spv.inv`, `demo.inv1`, `demo.purchasing`,
`demo.cs.lead`, `demo.cs1`, `demo.finance`, `demo.accounting` — password
`demo-cottonwood-2026` (override with `DEMO_PASSWORD`).

## Tests

```bash
npm test                         # 37 service-level tests against a real PostgreSQL test DB (TEST_DATABASE_URL)
npm run build && npm start &     # then:
BASE=http://localhost:3000 npm run test:e2e   # browser tests through the real UI (Playwright)
```

## Scripts

| Script | Purpose |
|---|---|
| `db:generate` | Generate a migration after editing `src/db/schema` |
| `db:migrate` | Apply migrations |
| `db:seed` | Sync permission catalog, departments, default roles (idempotent; never overwrites a customized matrix) |
| `db:seed -- --reset-matrix` | Reset default roles to the default permission matrix |
| `admin:create` | Create the first real GM / System Administrator account |
| `cron` | Scheduled jobs (run every 5 min) |
| `backup` | `pg_dump` + uploads archive with retention |
