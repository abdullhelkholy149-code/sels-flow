#!/usr/bin/env bash
#
# Runs once when the Codespace (or devcontainer) is created.
#
# Goal: after this finishes, `npm run dev` works and the database already has
# the schema. Nothing here is destructive.
set -euo pipefail

cd "$(dirname "$0")/.."

log() { printf '\n\033[1;34m[setup]\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------------------
# 1. Environment file
# ---------------------------------------------------------------------------
if [ -f .env ]; then
  log '.env already exists, keeping it.'
else
  log 'Creating .env from .env.example with generated development secrets.'
  cp .env.example .env

  # Development-only secrets. Never reuse these outside a dev machine.
  auth_secret="$(openssl rand -base64 32)"
  link_secret="$(openssl rand -base64 32)"

  # BSD and GNU sed disagree about -i, so rewrite through a temp file.
  sed -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$auth_secret|" \
    -e "s|^SIGNED_LINK_SECRET=.*|SIGNED_LINK_SECRET=$link_secret|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://salesflow:salesflow@postgres:5432/salesflow?schema=public|" \
    -e "s|^TEST_DATABASE_URL=.*|TEST_DATABASE_URL=postgresql://salesflow:salesflow@postgres:5432/salesflow_test?schema=public|" \
    -e "s|^UPLOAD_DIR=.*|UPLOAD_DIR=./.data/uploads|" \
    .env >.env.tmp && mv .env.tmp .env

  chmod 600 .env
  mkdir -p .data/uploads
fi

# ---------------------------------------------------------------------------
# 2. Dependencies
# ---------------------------------------------------------------------------
log 'Installing dependencies.'
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

log 'Generating the Prisma client.'
npm run db:generate

# ---------------------------------------------------------------------------
# 3. Database
# ---------------------------------------------------------------------------
log 'Waiting for PostgreSQL.'
for _ in $(seq 1 60); do
  if pg_isready -h postgres -U salesflow -d salesflow >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if pg_isready -h postgres -U salesflow -d salesflow >/dev/null 2>&1; then
  log 'Applying migrations and seeding.'
  npm run db:deploy
  npm run db:seed || log 'Seed skipped (already seeded or failed, see output above).'
else
  log 'PostgreSQL is not reachable yet. Run these once it is up:'
  log '  npm run db:setup'
fi

log 'Ready. Start the app with: npm run dev   (port 3000 is forwarded)'
