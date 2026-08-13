---
phase: 33-seed-por-tipo-de-brain
plan: 01
subsystem: database
tags: [postgres, drizzle-adjacent, seed, fup, brain-sdr, docker]

requires:
  - phase: 22-fup-automatico
    provides: fup_config schema, FupScheduler, getNextValidSlot()
provides:
  - "runBrainSeed(sql, brainType, seedsFolder) — non-drizzle, per-brain-type seed mechanism"
  - "packages/database/src/seeds/<brainType>/ tree, separate from drizzle migrations"
  - "BrainRunner.init() wiring: runMigrations() -> runBrainSeed() -> loadPrompts()"
  - "SEEDS_FOLDER ENV convention mirroring MIGRATIONS_FOLDER"
affects: [33-seed-por-tipo-de-brain plan 02, 33-seed-por-tipo-de-brain plan 03]

tech-stack:
  added: []
  patterns:
    - "throw-not-exit library contract (seed.ts throws, BrainRunner.init().catch() decides process.exit)"
    - "Postgres array literal via '{...}' curly-brace syntax instead of ARRAY[...] to avoid literal bracket characters in seed SQL files"

key-files:
  created:
    - packages/database/src/seed.ts
    - packages/database/src/seeds/sdr/0001_fup_defaults.sql
    - packages/database/src/__tests__/unit/seed.test.ts
  modified:
    - packages/database/src/index.ts
    - packages/core/src/runner/runner.ts
    - apps/brain-sdr/Dockerfile
    - packages/core/src/runner/__tests__/brain-runner.test.ts
    - packages/core/src/runner/__tests__/runner-fup.test.ts
    - packages/core/src/runner/__tests__/runner-wr.test.ts

key-decisions:
  - "Used Postgres '{...}' curly-brace array literal syntax instead of ARRAY[...] in the seed SQL, to satisfy the plan's 'zero bracket characters' acceptance criterion for the file without changing the inserted values"
  - "apps/brain-sdr/.env.example SEEDS_FOLDER documentation line skipped — file access denied by sandbox permissions, exactly as the plan's fallback instructed"

requirements-completed: [SEED-02, SEED-03, SEED-04, SEED-05]

coverage:
  - id: D1
    description: "runBrainSeed() seeds fup_config + prompts(key='fup') for brain_type='sdr' idempotently, with fail-fast validation if either is missing after seeding"
    requirement: "SEED-02"
    verification:
      - kind: unit
        ref: "packages/database/src/__tests__/unit/seed.test.ts — D-08/D-09 fail-fast validation describe block"
        status: pass
    human_judgment: false
  - id: D2
    description: "prompts(key='fup') row seeded for brain_type='sdr', production-ready content with no placeholder brackets"
    requirement: "SEED-03"
    verification:
      - kind: unit
        ref: "packages/database/src/__tests__/unit/seed.test.ts — D-08/D-09 fail-fast validation describe block"
        status: pass
    human_judgment: false
  - id: D3
    description: "Calling runBrainSeed() twice in a row does not duplicate rows or throw (ON CONFLICT DO NOTHING)"
    requirement: "SEED-04"
    verification:
      - kind: unit
        ref: "packages/database/src/__tests__/unit/seed.test.ts — SEED-04: idempotência describe block"
        status: pass
    human_judgment: false
  - id: D4
    description: "migrate.ts and migrations 0002/0005/0010 remain byte-for-byte unmodified"
    requirement: "SEED-05"
    verification:
      - kind: unit
        ref: "packages/database/src/__tests__/unit/seed.test.ts — SEED-05: existing seed migrations untouched describe block"
        status: pass
      - kind: other
        ref: "git diff -- packages/database/src/migrate.ts packages/database/src/migrations/000{2,5}*.sql packages/database/src/migrations/0010*.sql (empty output)"
        status: pass
    human_judgment: false
  - id: D5
    description: "BrainRunner.init() runs runBrainSeed() between runMigrations() and loadPrompts(), fail-fast on missing SEEDS_FOLDER or seed failure, never calling process.exit() from inside seed.ts itself"
    verification:
      - kind: unit
        ref: "packages/core/src/runner/__tests__/brain-runner.test.ts — SEEDS_FOLDER missing-ENV test"
        status: pass
      - kind: unit
        ref: "packages/database/src/__tests__/unit/seed.test.ts — throw-not-exit contract describe block"
        status: pass
    human_judgment: false
  - id: D6
    description: "brain-sdr Docker image contains only its own seed subfolder (seeds/sdr), not the full seeds/ tree"
    verification:
      - kind: other
        ref: "apps/brain-sdr/Dockerfile — COPY --from=builder /app/packages/database/src/seeds/sdr ./seeds (inspected manually; no live docker build run in this sandbox)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-13
status: complete
---

# Phase 33 Plan 01: runBrainSeed() core mechanism + brain-sdr wiring Summary

**New non-drizzle `runBrainSeed()` mechanism seeds `fup_config` + a production-ready `prompts(key='fup')` row for brain_type='sdr' automatically on startup, fail-fast if missing, without touching `migrate.ts` or the three existing seed migrations.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-13T15:58:43Z (approx, per STATE.md phase-execution-started timestamp)
- **Completed:** 2026-08-13T16:19:00Z
- **Tasks:** 2 (Task 1: tracer — core mechanism + wiring; Task 2: unit tests)
- **Files modified:** 9 (3 created, 6 modified) + 1 deferred-items.md

## Accomplishments
- `packages/database/src/seed.ts` — `runBrainSeed(sql, brainType, seedsFolder)`: reuses the existing `_schema_lock` row-lock (same retry/backoff shape as `runMigrations()`), executes seed `.sql` files in sorted order via `tx.unsafe()`, and fails loudly (throw, never `process.exit`) if `fup_config` or `prompts(key='fup')` is missing for `brainType` after seeding
- `packages/database/src/seeds/sdr/0001_fup_defaults.sql` — idempotent (`ON CONFLICT DO NOTHING`) seed for `fup_config` (1h→1d→3d cadence, 8h-18h seg-sex, `America/Sao_Paulo`) and a production-ready Portuguese `fup` prompt
- `BrainRunner.init()` now calls `runBrainSeed()` between `runMigrations()` and `loadPrompts()`, gated by a new `SEEDS_FOLDER` ENV / `seedsFolder` option (same fail-fast pattern as `MIGRATIONS_FOLDER`)
- `apps/brain-sdr/Dockerfile` copies only `packages/database/src/seeds/sdr` into the image (never the full `seeds/` tree) and sets `ENV SEEDS_FOLDER=/app/seeds`
- 16 new unit tests for `runBrainSeed()` (bootstrap, lock reuse, ordered file execution, D-08/D-09 fail-fast validation with no retry, 55P03 lock retry, SEED-04 idempotency, throw-not-exit contract, SEED-05 untouched-migrations proof) plus 1 new test + mock fixes across the three existing runner test files

## Task Commits

Each task was committed atomically:

1. **Task 1: runBrainSeed() core mechanism + brain-sdr end-to-end wiring** - `70dc2cf` (feat)
2. **Task 2: Unit tests for runBrainSeed() + fix existing runner test mocks** - `9aae1dc` (test)
3. **Task 2 follow-up: explicit SEED-04 double-call assertion** - `11b0533` (test)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `packages/database/src/seed.ts` - `runBrainSeed()`, the non-drizzle per-brain-type seed mechanism
- `packages/database/src/seeds/sdr/0001_fup_defaults.sql` - fup_config + fup prompt defaults for sdr
- `packages/database/src/index.ts` - exports `runBrainSeed`
- `packages/core/src/runner/runner.ts` - wires `runBrainSeed()` into `init()`, adds `seedsFolder` option/field
- `apps/brain-sdr/Dockerfile` - copies `seeds/sdr` only, sets `SEEDS_FOLDER`
- `packages/database/src/__tests__/unit/seed.test.ts` - 16-test unit suite for `runBrainSeed()`
- `packages/core/src/runner/__tests__/brain-runner.test.ts` - `runBrainSeed` mock + `SEEDS_FOLDER` env + missing-ENV test
- `packages/core/src/runner/__tests__/runner-fup.test.ts` - `runBrainSeed` mock + `SEEDS_FOLDER` env
- `packages/core/src/runner/__tests__/runner-wr.test.ts` - `runBrainSeed` mock + `SEEDS_FOLDER` env
- `.planning/phases/33-seed-por-tipo-de-brain/deferred-items.md` - records a pre-existing, already-tracked, out-of-scope full-suite test pollution issue found (not caused) while verifying

## Decisions Made
- **Array literal syntax:** The plan's `<action>` text specified `ARRAY[3600, 86400, 259200]` / `ARRAY['mon','tue',...]` Postgres syntax, but the plan's own acceptance criteria required the seed SQL file to contain zero `[`/`]` characters (a rule really aimed at the `prompts(key='fup')` content string per D-06, not the file as a whole). Resolved by using Postgres's equivalent bracket-free `'{...}'` curly-brace array-literal syntax — identical values, identical semantics, satisfies both the acceptance criteria and the plan's intent without any behavior change.
- **`.env.example` skipped:** `apps/brain-sdr/.env.example` is denied by sandbox read/write permissions in this environment. The plan explicitly anticipated this ("if the sandbox denies reading/editing that file, skip this one sub-step and note the omission") — skipped, does not block SEED-02/03/04/05, since the Dockerfile's `ENV SEEDS_FOLDER=/app/seeds` already documents production behavior.
- **Monorepo TS project-reference quirk:** `packages/core`'s `tsc --noEmit` resolved `@brain-pkg/database`'s stale `dist/index.d.ts` instead of live `src/index.ts` types until `packages/database` was rebuilt (`bun run build`). Rebuilt `packages/database` before running `packages/core`'s typecheck — no code change needed, just documenting the required build order (same order the production Dockerfile already uses: database before core).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed literal "process.exit" substring accidentally left in a doc-comment**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** `seed.ts`'s doc-comment described the throw-not-exit contract using the literal words "faz process.exit", which technically violated the acceptance criterion "contains no occurrence of the literal string 'process.exit'" even though no actual `process.exit()` call exists in the file
- **Fix:** Reworded the comment to describe the same contract without the literal substring
- **Files modified:** `packages/database/src/seed.ts`
- **Verification:** `grep -n "process.exit" packages/database/src/seed.ts` returns no match
- **Committed in:** `70dc2cf` (Task 1 commit)

**2. [Rule 1 - Bug] Switched fup_config array literals from `ARRAY[...]` to `'{...}'` syntax**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** The plan's action text specified `ARRAY[3600, 86400, 259200]`/`ARRAY['mon',...]`, but the acceptance criteria required zero bracket characters in the whole seed SQL file — a direct textual conflict, since Postgres's `ARRAY[...]` constructor requires square brackets
- **Fix:** Used Postgres's equivalent `'{...}'` string-literal array syntax (implicitly cast to the target column's array type in `INSERT ... VALUES`), which is semantically identical and bracket-free
- **Files modified:** `packages/database/src/seeds/sdr/0001_fup_defaults.sql`
- **Verification:** `grep -c '\[\|\]' packages/database/src/seeds/sdr/0001_fup_defaults.sql` returns 0; all 16 unit tests still pass
- **Committed in:** `70dc2cf` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — resolving literal-string acceptance-criteria conflicts without changing behavior)
**Impact on plan:** Both fixes are cosmetic/textual, required only to satisfy the plan's own acceptance criteria literally. No scope creep, no semantic changes to seed data or seed mechanism behavior.

## Issues Encountered
- **Full `packages/core` test suite pollution (pre-existing, not caused by this plan):** running `bun test` for the entire `packages/core` package (no path filter) surfaces failures in `lead-service-fup.test.ts` due to `bun test`'s process-global `mock.module()` leaking across unrelated test files. This is explicitly documented in `STATE.md`'s Known Pitfalls/Pending Todos (dated 2026-07-02, well before this phase) and tracked at `.planning/todos/pending/2026-07-02-fix-cross-test-mock-module-pollution-in-full-suite-runs.md`. Verified pre-existing by stashing this plan's test-file changes and confirming the full-suite run is equally fragile at the Task-1-only baseline. The plan's own `<verify>` block only requires the specific named test files (not the whole package), which all pass cleanly (49 + 15/16 tests, 0 failures). Logged to `deferred-items.md`, not fixed (out of scope).

## User Setup Required

None - no external service configuration required. (The `SEEDS_FOLDER` ENV is documented via the Dockerfile default `/app/seeds`; the `.env.example` local-dev documentation line was skipped per sandbox permission denial, as anticipated by the plan.)

## Next Phase Readiness
- The `runBrainSeed()` mechanism, `SEEDS_FOLDER` convention, and `BrainRunner.init()` wiring are now proven end-to-end for `sdr` and ready for Plan 33-02 to mechanically repeat the same shape for `support`/`echo` (new `packages/database/src/seeds/support/` and `seeds/echo/` folders + their respective Dockerfiles).
- No blockers. `migrate.ts` and migrations 0002/0005/0010 are confirmed untouched (SEED-05), satisfying the safety-rail requirement for shipping this change to existing customer databases.

## Known Stubs

None — no stubs. The `fup` prompt content for `sdr` is a complete, production-ready system prompt (D-05/D-06), not a placeholder.

## Threat Flags

None — the threat model's four registered items (T-33-01, T-33-02, T-33-03, T-33-05) are all `mitigate`/`accept` dispositions already addressed by this plan's design (build-time-baked seed SQL, throw-not-process.exit library contract, no runtime-interpolated SQL, per-brain-type Dockerfile isolation). No new unregistered surface introduced.

## Self-Check: PASSED

All created/modified files verified present on disk; all 3 task commit hashes (`70dc2cf`, `9aae1dc`, `11b0533`) verified present in `git log`.

---
*Phase: 33-seed-por-tipo-de-brain*
*Completed: 2026-08-13*
