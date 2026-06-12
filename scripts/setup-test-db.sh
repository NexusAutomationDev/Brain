#!/usr/bin/env bash
# setup-test-db.sh
# Creates the brain_test database, enables pgvector, and runs Phase 1 migrations.
# Reads PGHOST, PGPORT, PGUSER, PGPASSWORD from environment.
# T-2-W0-01: Reads PGPASSWORD from env, never echoes it; no secrets committed to this file.

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"

export PGPASSWORD

echo "Setting up brain_test database..."

# Create brain_test database (no-op if already exists)
if command -v createdb &>/dev/null; then
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" brain_test 2>/dev/null || true
else
  bun -e "
const {default: pg} = await import('postgres');
const sql = pg('postgres://\${PGUSER}:\${PGPASSWORD}@\${PGHOST}:\${PGPORT}/postgres');
const dbs = await sql\`SELECT datname FROM pg_database WHERE datname = 'brain_test'\`;
if (dbs.length === 0) { await sql.unsafe('CREATE DATABASE brain_test'); console.log('Created brain_test'); }
else { console.log('brain_test already exists'); }
await sql.end();
" 2>/dev/null || true
fi

# Enable pgvector extension
if command -v psql &>/dev/null; then
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d brain_test -c "CREATE EXTENSION IF NOT EXISTS vector;"
else
  bun -e "
const {default: pg} = await import('postgres');
const sql = pg('postgres://\${PGUSER}:\${PGPASSWORD}@\${PGHOST}:\${PGPORT}/brain_test');
await sql\`CREATE EXTENSION IF NOT EXISTS vector\`;
console.log('pgvector extension enabled');
await sql.end();
"
fi

# Run Phase 1 migration via Drizzle Kit against brain_test.
# EMBEDDING_DIMENSIONS=10 matches FakeEmbeddings dimensions for test compatibility
# (see RESEARCH.md pitfall 6 and key finding 4 — FakeEmbeddings defaults to 10 dimensions).
DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/brain_test" \
EMBEDDING_DIMENSIONS=10 \
bunx drizzle-kit migrate --config packages/database/drizzle.config.ts

echo "brain_test database ready."
