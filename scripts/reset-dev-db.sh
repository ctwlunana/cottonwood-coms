#!/usr/bin/env bash
# DEVELOPMENT ONLY: drop & recreate the local database with demo data (used before e2e runs).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
case "$DATABASE_URL" in *localhost*|*127.0.0.1*) ;; *) echo "Menolak: DATABASE_URL bukan database lokal"; exit 1;; esac
DB="${DATABASE_URL##*/}"
psql "${DATABASE_URL%/*}/postgres" -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
npm run -s db:migrate && npm run -s db:seed:demo
