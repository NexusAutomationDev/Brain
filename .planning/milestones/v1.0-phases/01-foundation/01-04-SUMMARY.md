---
phase: "01"
plan: "04"
subsystem: "database, observability"
tags: ["build-fix", "migrations", "drizzle-kit", "tsconfig", "gap-closure"]
dependency_graph:
  requires: []
  provides:
    - packages/observability/tsconfig.json (excludes test files)
    - packages/database/src/migrations/0000_lyrical_scrambler.sql
    - packages/database/src/migrations/meta/_journal.json
  affects:
    - pnpm build (now exits 0)
    - packages/database/src/migrate.ts (migrationsFolder now has SQL files)
tech_stack:
  added: []
  patterns:
    - drizzle.config.ts schema path narrowed to specific file (not glob) to avoid test file inclusion
key_files:
  created:
    - packages/database/src/migrations/0000_lyrical_scrambler.sql
    - packages/database/src/migrations/meta/0000_snapshot.json
    - packages/database/src/migrations/meta/_journal.json
  modified:
    - packages/observability/tsconfig.json
    - packages/database/drizzle.config.ts
    - pnpm-lock.yaml
    - pnpm-workspace.yaml
decisions:
  - "Narrowed drizzle.config.ts schema glob from ./src/schema/*.ts to ./src/schema/tables.ts — drizzle-kit runs under Node.js/CJS and cannot resolve bun:test module imported by tables.test.ts"
  - "Set esbuild allowBuilds: false in pnpm-workspace.yaml to resolve ERR_PNPM_IGNORED_BUILDS blocking pnpm install"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-11T16:53:23Z"
  tasks_completed: 3
  files_modified: 7
---

# Phase 01 Plan 04: Fix Build + Generate Migrations Summary

**One-liner:** Fixed TS2554 build errors via observability tsconfig exclude, narrowed drizzle.config schema glob to skip test files, generated 0000_lyrical_scrambler.sql with all 4 tables and pgvector HNSW index.

## What Was Done

### Task 4.1 — Fix packages/observability/tsconfig.json

Added `"src/**/*.test.ts"` to the `exclude` array in `packages/observability/tsconfig.json`, matching the existing pattern in `packages/database/tsconfig.json`.

**Before:**
```json
"exclude": ["node_modules", "dist"]
```

**After:**
```json
"exclude": ["node_modules", "dist", "src/**/*.test.ts"]
```

This fix prevents `tsc` from compiling `health.test.ts` and `logger.test.ts` during the build step, eliminating the 11 TS2554 errors caused by `it.todo()` signature incompatibility in `@types/bun`.

**Commit:** `674277d`

### Task 4.2 — Generate SQL Migration Files

Ran `drizzle-kit generate` to produce the SQL migration files that `migrate.ts` requires at runtime but which had never been created during Phase 1.

**Generated file:** `packages/database/src/migrations/0000_lyrical_scrambler.sql`

Contents:
- `CREATE TABLE "agent_state"` — LangGraph checkpoint state per thread
- `CREATE TABLE "embeddings"` — semantic memory with `vector(1536)` column
- `CREATE TABLE "memories"` — key/value long-term memory store
- `CREATE TABLE "users"` — external identity to internal UUID mapping
- HNSW index: `CREATE INDEX "embeddings_embedding_idx" USING hnsw (vector_cosine_ops) WITH (m=16, ef_construction=64)`
- BTree indexes on `memories(user_id, key)` and `embeddings(session_id)`

No credentials in generated SQL (T-04-02 mitigated — DDL only).

**Commit:** `d6aeca5`

### Task 4.3 — Verify Build and Commit pnpm-lock.yaml

`pnpm build` exits 0 with zero TypeScript errors across all 3 packages (shared, database, observability).

Also resolved `ERR_PNPM_IGNORED_BUILDS` blocking `pnpm install` by setting `esbuild: false` in `pnpm-workspace.yaml` via `pnpm approve-builds`.

**Commit:** `f98a6d0`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Narrowed drizzle.config.ts schema glob to exclude test files**
- **Found during:** Task 4.2
- **Issue:** `drizzle.config.ts` used `./src/schema/*.ts` glob which matched `tables.test.ts`. When drizzle-kit (running under Node.js CJS) tried to load the test file, it failed with `Cannot find module 'bun:test'` — bun:test is a Bun-only runtime module not available in Node.js.
- **Fix:** Changed schema path from `./src/schema/*.ts` to `./src/schema/tables.ts` in `packages/database/drizzle.config.ts`
- **Files modified:** `packages/database/drizzle.config.ts`
- **Commit:** `d6aeca5`

**2. [Rule 3 - Blocking] Resolved ERR_PNPM_IGNORED_BUILDS blocking pnpm install**
- **Found during:** Task 4.3
- **Issue:** `pnpm build` triggered a pre-install check that failed with `ERR_PNPM_IGNORED_BUILDS` because `esbuild` build scripts had not been approved (pnpm-workspace.yaml had placeholder `esbuild: set this to true or false`).
- **Fix:** Ran `pnpm approve-builds` to set `esbuild: false` in `pnpm-workspace.yaml`, then committed both files.
- **Files modified:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- **Commit:** `f98a6d0`

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm build` exit code | 0 (3/3 packages successful) |
| `ls packages/database/src/migrations/*.sql \| wc -l` | 1 |
| `ls packages/database/src/migrations/meta/_journal.json` | exists |
| `grep -c 'src/\*\*\/\*.test.ts' packages/observability/tsconfig.json` | 1 |
| `git diff HEAD -- packages/observability/tsconfig.json` | empty (committed) |
| SQL contains all 4 tables | yes |
| SQL contains vector(1536) column | yes |
| No credentials in SQL files | confirmed |

## Known Stubs

None — all generated artifacts are complete DDL. No placeholder data.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced beyond the planned DDL migration files.

## Self-Check: PASSED

- `packages/observability/tsconfig.json` — FOUND, contains exclude pattern
- `packages/database/src/migrations/0000_lyrical_scrambler.sql` — FOUND
- `packages/database/src/migrations/meta/_journal.json` — FOUND
- `packages/database/drizzle.config.ts` — FOUND, schema points to tables.ts
- Commits: 674277d, d6aeca5, f98a6d0 — all present in log
