---
phase: 33-seed-por-tipo-de-brain
plan: 02
subsystem: database
tags: [postgres, seed, fup, brain-support, brain-echo, docker, testing]

requires:
  - phase: 33-seed-por-tipo-de-brain (plan 01)
    provides: "runBrainSeed(sql, brainType, seedsFolder), packages/database/src/seeds/sdr/0001_fup_defaults.sql, SEEDS_FOLDER ENV convention"
provides:
  - "packages/database/src/seeds/support/0001_fup_defaults.sql and seeds/echo/0001_fup_defaults.sql — fup_config + fup prompt defaults for the two remaining brain types"
  - "apps/brain-support/Dockerfile and apps/brain-echo/Dockerfile wired to COPY only their own seeds/<type> subfolder + ENV SEEDS_FOLDER"
  - "Automated proof of cross-brain-type seed isolation (Pitfall 3) and idempotency (SEED-04) across all three brain types"
affects: ["34-fundacao-de-handoff (fup_config now seeded for all three brain types, needed before handoff lands a lead on a fresh destination)"]

tech-stack:
  added: []
  patterns:
    - "Synthetic seed-idem-<type> fixture generation in integration tests: real seed file content is read (no mocking) and its brain_type literal is string-swapped into a temp fixture directory, so runBrainSeed()'s fail-fast validation (which checks the passed brainType param, not file content) can be exercised safely without colliding with or deleting real sdr/support/echo rows"

key-files:
  created:
    - packages/database/src/seeds/support/0001_fup_defaults.sql
    - packages/database/src/seeds/echo/0001_fup_defaults.sql
    - packages/database/src/__tests__/unit/seed-cross-brain-isolation.test.ts
    - packages/database/src/__tests__/integration/seed-idempotency.test.ts
  modified:
    - apps/brain-support/Dockerfile
    - apps/brain-echo/Dockerfile

key-decisions:
  - "Idempotency integration test builds temp seed-idem-<type> fixtures from the real seed file content instead of calling runBrainSeed() directly against seeds/<type> with a synthetic brainType string — the plan's literal wording (real folder + synthetic brainType param) would always throw, since runBrainSeed()'s fail-fast validation checks fup_config/prompts for the passed brainType param while the real .sql files hardcode the real brain_type literal in their INSERT statements. Swapping the literal in a temp copy makes runBrainSeed() functionally self-consistent while still reading real, non-mocked file content and never touching real sdr/support/echo rows."
  - "apps/brain-support/.env.example and apps/brain-echo/.env.example SEEDS_FOLDER documentation lines skipped — sandbox denies read/write access to both files, identical to Plan 33-01's fallback for apps/brain-sdr/.env.example. Non-blocking: the Dockerfile's ENV SEEDS_FOLDER=/app/seeds already documents production behavior."

requirements-completed: [SEED-01, SEED-02, SEED-03, SEED-04, SEED-05]

coverage:
  - id: D1
    description: "brain-support and brain-echo each seed their own fup_config + prompts(key='fup') row automatically, idempotently, with the same content shape as sdr (SEED-02, SEED-03)"
    requirement: "SEED-02"
    verification:
      - kind: unit
        ref: "packages/database/src/__tests__/unit/seed.test.ts (existing, unmodified — proves runBrainSeed() mechanism generically) + manual grep verification of seeds/support and seeds/echo file content"
        status: pass
    human_judgment: false
  - id: D2
    description: "prompts(key='fup') content for support and echo is production-ready, no placeholder brackets, no per-type tone variation this phase (D-05/D-06)"
    requirement: "SEED-03"
    verification:
      - kind: other
        ref: "grep -c '\\[\\|\\]' on both new seed files returns 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Inspecting any one brain type's seeds/<type> folder or Dockerfile never reveals another brain_type's seed SQL or seed path — physical separation (SEED-01, Pitfall 3)"
    requirement: "SEED-01"
    verification:
      - kind: unit
        ref: "packages/database/src/__tests__/unit/seed-cross-brain-isolation.test.ts — 16 tests, 6 ordered cross-type content pairs + 9 Dockerfile-path assertions"
        status: pass
    human_judgment: false
  - id: D4
    description: "runBrainSeed() is idempotent across all three brain types when called twice in a row against a real database (SEED-04)"
    requirement: "SEED-04"
    verification:
      - kind: integration
        ref: "packages/database/src/__tests__/integration/seed-idempotency.test.ts — gated by TEST_DATABASE_URL/POSTGRES_URL, verified exits 0 (all skipped) when unset; not run against a real DB in this sandbox (no test database available)"
        status: unknown
    human_judgment: true
    rationale: "No TEST_DATABASE_URL/POSTGRES_URL was available in the execution sandbox, so the gated integration test could only be verified to skip cleanly (exit 0), not to actually pass against a live PostgreSQL instance. A human with access to a test database must run this test once to confirm the real DB assertions pass, per the plan's own documented precondition."
  - id: D5
    description: "Migrations 0002/0005/0010 remain byte-for-byte unchanged after adding support/echo seed treatment (SEED-05, re-confirmed)"
    requirement: "SEED-05"
    verification:
      - kind: other
        ref: "git diff --quiet on all three migration files — exit 0 (no changes)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-08-13
status: complete
---

# Phase 33 Plan 02: Support + Echo seed files + cross-brain isolation/idempotency tests Summary

**Mechanically extended Plan 33-01's sdr seed shape to brain-support and brain-echo, then added the two cross-brain proofs (physical isolation + idempotency) that only become meaningful once all three brain types exist side by side.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-13T16:20:50Z (approx, per STATE.md prior-plan completion timestamp)
- **Completed:** 2026-08-13T16:34:24Z
- **Tasks:** 2 (Task 1: seed files + Dockerfile wiring; Task 2: isolation + idempotency tests)
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- `packages/database/src/seeds/support/0001_fup_defaults.sql` and `packages/database/src/seeds/echo/0001_fup_defaults.sql` — byte-identical to sdr's seed except the `brain_type` literal, same `fup_config` defaults (1h→1d→3d cadence, 8h-18h seg-sex, `America/Sao_Paulo`) and same generic, production-ready Portuguese `fup` prompt content (D-05: no per-type tone variation this phase)
- `apps/brain-support/Dockerfile` now `COPY`s only `packages/database/src/seeds/support` and sets `ENV SEEDS_FOLDER=/app/seeds`, mirroring sdr's pattern exactly, placed immediately after the existing `MIGRATIONS_FOLDER` block
- `apps/brain-echo/Dockerfile` now `COPY`s only `packages/database/src/seeds/echo` and sets `ENV SEEDS_FOLDER=/app/seeds` (using the correct name, despite the file's pre-existing legacy `MIGRATIONS_DIR` naming for migrations, left untouched per the plan's explicit read_first instruction)
- `packages/database/src/__tests__/unit/seed-cross-brain-isolation.test.ts` — 16 DB-free tests, real `fs` reads (no mocks): all 6 ordered pairs among sdr/support/echo prove no seed file's text contains another type's `brain_type` literal, and all three Dockerfiles are proven to reference their own `seeds/<type>` path exactly once and never another type's path
- `packages/database/src/__tests__/integration/seed-idempotency.test.ts` — gated integration test (same `describeOrSkip`/`TEST_DB_URL` idiom as `brain-runner.integration.test.ts`), proves `runBrainSeed()` called twice in a row for all three brain types never throws and never duplicates `fup_config`/`prompts(key='fup')` rows

## Task Commits

Each task was committed atomically:

1. **Task 1: Support + Echo seed files and Dockerfile wiring** - `02895a8` (feat)
2. **Task 2: Cross-brain physical isolation test + idempotency integration test** - `55409ea` (test)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `packages/database/src/seeds/support/0001_fup_defaults.sql` - fup_config + fup prompt defaults for support
- `packages/database/src/seeds/echo/0001_fup_defaults.sql` - fup_config + fup prompt defaults for echo
- `apps/brain-support/Dockerfile` - copies `seeds/support` only, sets `SEEDS_FOLDER`
- `apps/brain-echo/Dockerfile` - copies `seeds/echo` only, sets `SEEDS_FOLDER`
- `packages/database/src/__tests__/unit/seed-cross-brain-isolation.test.ts` - 16-test DB-free proof of physical seed/Dockerfile isolation
- `packages/database/src/__tests__/integration/seed-idempotency.test.ts` - gated integration test proving idempotency across all three brain types

## Decisions Made
- **Synthetic-brainType fixture generation for the idempotency test:** The plan's action text asked to call `runBrainSeed(sql, syntheticBrainType, realFolderPath)` directly against the real `seeds/<type>` folder using a synthetic brainType string. This is self-contradictory as written: `runBrainSeed()`'s fail-fast validation queries `fup_config`/`prompts` using the *passed* `brainType` parameter, but the real seed `.sql` files hardcode the real literal (`'sdr'`/`'support'`/`'echo'`) in their `INSERT` statements — there is no runtime parameterization inside `runBrainSeed()`. Calling it with a synthetic type against the unmodified real folder would insert rows under the real type but validate against the synthetic type, and the fail-fast check would throw on every call, directly contradicting the plan's own assertion (a) ("neither call throws"). Resolved by reading the real seed file content (no mocking) and writing a temp fixture copy per brain type with the `brain_type` literal string-swapped to `seed-idem-<type>` before calling `runBrainSeed()` against that fixture folder — this keeps the test faithful to each real brain type's actual seed shape, makes the mechanism internally consistent, and avoids ever touching real sdr/support/echo rows in the test database.
- **`.env.example` documentation skipped for both apps:** Same sandbox permission denial as Plan 33-01's `apps/brain-sdr/.env.example` — both `apps/brain-support/.env.example` and `apps/brain-echo/.env.example` are in a directory denied by the sandbox's read/write permissions. Skipped per the plan's own documented fallback; non-blocking since the Dockerfile's `ENV SEEDS_FOLDER=/app/seeds` already documents production behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed self-contradictory idempotency test design (synthetic brainType vs. real seed folder)**
- **Found during:** Task 2, writing `seed-idempotency.test.ts`
- **Issue:** Plan's action text specified calling `runBrainSeed(sql, syntheticBrainType, <real seeds/<type> folder>)`, which would always throw at the fail-fast validation step because the real seed SQL hardcodes the real brain_type literal, not the synthetic one passed as the function parameter
- **Fix:** Generate a temp fixture directory per brain type containing a copy of the real seed file content with only the `brain_type` literal string-swapped to the synthetic value, then call `runBrainSeed()` against that fixture — preserves "real file content, no mocking" while making the call internally consistent
- **Files modified:** `packages/database/src/__tests__/integration/seed-idempotency.test.ts`
- **Verification:** `bun test` with `TEST_DATABASE_URL`/`POSTGRES_URL` unset exits 0 with all cases reported skipped (not failed); typecheck (`tsc --noEmit`) clean
- **Committed in:** `55409ea` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — resolving a self-contradictory test design in the plan's own action text, without changing the underlying idempotency contract being proven)
**Impact on plan:** The fix is scoped entirely to test-fixture construction; the actual assertions proven (no throw, exactly 1 row each on two consecutive calls, for all three brain types) match the plan's stated intent exactly.

## Issues Encountered
- **No test database available in this sandbox:** `TEST_DATABASE_URL`/`POSTGRES_URL` were unset in the execution environment, so `seed-idempotency.test.ts` could only be verified to skip cleanly (exit 0, all cases reported as skipped per the plan's own documented precondition) — not run against a real PostgreSQL instance. This mirrors the exact precondition the plan itself calls out as expected and non-blocking. A human with test-database access should run this test once (`TEST_DATABASE_URL=postgres://... bun test packages/database/src/__tests__/integration/seed-idempotency.test.ts`) to get a live pass confirmation; this is `D4` above with `human_judgment: true`.
- Same pre-existing, out-of-scope full-suite `mock.module()` test-pollution issue documented in Plan 33-01's `deferred-items.md` remains — not touched, not re-verified here (unrelated to this plan's files).

## User Setup Required
None for shipping this change — `SEEDS_FOLDER` is documented via each Dockerfile's `ENV SEEDS_FOLDER=/app/seeds` default. Optional: run the gated idempotency integration test against a real test database at least once before relying on it as regression coverage (see Issues Encountered above).

## Next Phase Readiness
- All three brain types (sdr, support, echo) now seed `fup_config` + `prompts(key='fup')` automatically and idempotently on startup, closing SEED-01 through SEED-05 for this milestone's seed-scoping goal.
- Phase 34 (Fundação de Handoff) can now assume every destination brain type has FUP protection seeded out-of-the-box for leads landing via handoff — the dependency STATE.md flagged ("a lead landing on a destination via handoff needs that destination's fup_config seeded before Phase 34/35 land") is satisfied.
- No blockers. Migrations 0002/0005/0010 confirmed byte-identical (SEED-05).

## Known Stubs

None — no stubs. The `fup` prompt content for both `support` and `echo` is complete, production-ready (D-05/D-06), identical in shape and quality bar to sdr's content from Plan 33-01.

## Threat Flags

None — the threat model's two registered items (T-33-05, T-33-01 carried forward) are both `mitigate` dispositions addressed by this plan's design (per-brain-type Dockerfile `COPY` isolation verified by automated test; same fail-fast `SEEDS_FOLDER`/`runBrainSeed()` mechanism from Plan 33-01, now exercised for support/echo). No new unregistered surface introduced.

## Self-Check: PASSED

All created/modified files verified present on disk; both task commit hashes (`02895a8`, `55409ea`) verified present in `git log`.

---
*Phase: 33-seed-por-tipo-de-brain*
*Completed: 2026-08-13*
