---
phase: 29-brain-suporte-core
plan: 02
requirements-completed: [SUP-01, SUP-08]
subsystem: brain-support
tags: [migrations, env-config, testing, tools-registry, hono]
dependency_graph:
  requires:
    - apps/brain-support/src/brain.ts (Plan 01 — supportBrain, brainType "support")
    - apps/brain-support/src/index.ts (Plan 01 — ToolsRegistry wiring)
    - apps/brain-support/src/server.ts (Plan 01 — createServer composition)
    - packages/database/src/migrations/0005_brain_sdr_prompts.sql (seed pattern reference)
  provides:
    - packages/database/src/migrations/0010_brain_support_prompts.sql (seeded system prompt for brain_type='support')
    - apps/brain-support/.env.example (documented ENV surface, including embedding vars)
    - apps/brain-support/src/__tests__/unit/toolsregistry-support.test.ts
    - apps/brain-support/src/__tests__/unit/server.test.ts
  affects:
    - BrainRunner.init() startup for brain-support (no longer process.exit(1) on missing prompt)
tech_stack:
  added: []
  patterns:
    - "Idempotent SQL seed migrations with ON CONFLICT DO NOTHING, one per Brain type"
    - "Per-Brain .env.example documenting independent EMBEDDING_PROVIDER/MODEL/DIMENSIONS"
key_files:
  created:
    - packages/database/src/migrations/0010_brain_support_prompts.sql
    - apps/brain-support/.env.example
    - apps/brain-support/src/__tests__/unit/toolsregistry-support.test.ts
    - apps/brain-support/src/__tests__/unit/server.test.ts
  modified:
    - packages/database/src/migrations/meta/_journal.json
decisions:
  - "PORT=3002 default for brain-support (vs brain-sdr's 3001) to avoid local port collision when both Brains run simultaneously in dev"
  - "DATABASE_NAME=brain_suporte as distinct default from brain-sdr's DATABASE_NAME=brain, reinforcing D-05 (independent databases per Brain when co-deployed)"
metrics:
  duration: "~15 minutes"
  completed: 2026-07-01
---

# Phase 29 Plan 02: Migration Seed, .env.example, and Unit Tests for Brain Suporte Summary

Seeded the placeholder `system` prompt for `brain_type='support'` via migration 0010, documented the complete `.env.example` for `apps/brain-support` (closing the Phase 28 gap where brain-sdr's `.env.example` never listed `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS`), and added unit tests proving `ToolsRegistry` wiring and Hono server composition are correct for the `"support"` brainType.

## What Was Built

**Task 1 — Migration 0010:** Created `packages/database/src/migrations/0010_brain_support_prompts.sql`, an idempotent `INSERT ... ON CONFLICT (brain_type, key) DO NOTHING` seeding the `system` prompt for `brain_type='support'`, mirroring the existing `0005_brain_sdr_prompts.sql` pattern. Registered the migration in `packages/database/src/migrations/meta/_journal.json` with `idx: 10`, `tag: "0010_brain_support_prompts"`, `when: 1783000000000` (chronologically after the `0009` entry). Only the `system` key is seeded — Brain Suporte has no `qualification` sub-agent (D-06), unlike Brain SDR's two-key seed.

**Task 2 — `.env.example`:** Created `apps/brain-support/.env.example` documenting the full ENV surface needed to run the Brain standalone: database (with explicit D-05 comment about needing a distinct `DATABASE_NAME` from brain-sdr when co-deployed for the same client), migrations, LLM, the 3 embedding ENVs (`EMBEDDING_PROVIDER=openai`, `EMBEDDING_MODEL=text-embedding-3-small`, `EMBEDDING_DIMENSIONS=1536`), transport, webhook/ingest tokens, context window, observability, LangSmith, RabbitMQ, MCP, and re-embed sections. `PORT` defaults to `3002` and `DATABASE_NAME` defaults to `brain_suporte` — both intentionally distinct from brain-sdr's defaults (`3001` / `brain`) to avoid collisions and reinforce per-Brain isolation.

**Task 3 — Unit tests:**
- `apps/brain-support/src/__tests__/unit/toolsregistry-support.test.ts` — 4 tests proving `ToolsRegistry` configured exactly as `index.ts` configures it (`pause_session`, `finish_conversation`, `search_knowledge`) returns those 3 tools, never throws when the brainType is registered (even with an empty tool list), throws `ConfigurationError` when `"support"` was never registered, and that `search_knowledge` stays enabled independent of `BRAIN_TOOLS`.
- `apps/brain-support/src/__tests__/unit/server.test.ts` — 4 tests proving `createServer()` mounts `/health`, `/api/v1/webhook`, and `/reload-prompts` (none return 404), and that `/api/v1/ingest` correctly returns 404 when `embeddingProvider` is omitted — confirming the conditional mounting behavior from Plan 01's `server.ts` is preserved.

All 8 new tests pass (`bun test apps/brain-support/src/__tests__/unit/toolsregistry-support.test.ts apps/brain-support/src/__tests__/unit/server.test.ts` — 8 pass, 0 fail, 13 assertions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Worktree branch was stale relative to merged Plan 01 work**

- **Found during:** Initial worktree branch check (mandatory first step)
- **Issue:** This worktree's branch (`worktree-agent-ae81b9589989ec2fd`) was created from an earlier commit and did not include Plan 01's already-merged work (`apps/brain-support/{brain.ts,index.ts,server.ts}`, `package.json`, `tsconfig.json`), even though `master` (target base `82f09408d7823bbf19130054574184d8b452389d`) already contained it. Reading the plan's `<read_first>` files for Task 3 (`apps/brain-support/src/brain.ts`, `src/index.ts`, `src/server.ts`) failed with "file does not exist."
- **Fix:** Ran `git rebase 82f09408d7823bbf19130054574184d8b452389d`, which fast-forwarded cleanly (no conflicts) since the worktree branch was a direct ancestor. Confirmed `git merge-base HEAD 82f0940... == HEAD` after rebase.
- **Files affected:** None modified directly — rebase only updated the branch pointer to include already-committed Plan 01 files.
- **Commit:** N/A (rebase, no new commit)

**2. [Rule 3 - Blocking issue] `apps/brain-support` workspace package not linked / dependencies missing**

- **Found during:** Task 3 verification (`bun test`)
- **Issue:** `bun test` failed with `Cannot find package 'hono' from '.../apps/brain-support/src/server.ts'` — the new `@brain-app/support` workspace package (added in Plan 01) had never been through `pnpm install` in this worktree, so its dependency symlinks did not exist.
- **Fix:** Ran `pnpm install --frozen-lockfile` at the repo root (lockfile already had all needed entries — no lockfile changes, only `node_modules` populated).
- **Files affected:** None (node_modules is gitignored; no diff to commit).
- **Commit:** N/A

### Notes (not deviations, informational)

- The plan's Task 2 acceptance criteria states `grep -c "EMBEDDING_PROVIDER\|EMBEDDING_MODEL\|EMBEDDING_DIMENSIONS" apps/brain-support/.env.example` should return `3`. The actual count is `5`, because the plan's own specified `.env.example` template content (which was copied verbatim per the `<action>` instructions) includes 2 explanatory comment lines that also contain the substrings `EMBEDDING_PROVIDER` and `EMBEDDING_DIMENSIONS` (lines: `# EMBEDDING_PROVIDER ausente = fallback...` and `# EMBEDDING_DIMENSIONS deve bater com...`). The 3 required `KEY=value` assignment lines (`EMBEDDING_PROVIDER=openai`, `EMBEDDING_MODEL=text-embedding-3-small`, `EMBEDDING_DIMENSIONS=1536`) are all present exactly as specified — the substantive acceptance criterion (documenting all 3 embedding ENVs) is fully satisfied. This is a minor grep-count miscalculation in the plan text itself, not a deviation in implementation; content matches the plan's literal template byte-for-byte.

## Self-Check: PASSED

All created files verified present on disk:
- FOUND: packages/database/src/migrations/0010_brain_support_prompts.sql
- FOUND: apps/brain-support/.env.example
- FOUND: apps/brain-support/src/__tests__/unit/toolsregistry-support.test.ts
- FOUND: apps/brain-support/src/__tests__/unit/server.test.ts

All task commits verified in git history:
- FOUND: cbcfb7b (Task 1 — migration seed)
- FOUND: 9ebccad (Task 2 — .env.example)
- FOUND: 941a7d1 (Task 3 — unit tests)
