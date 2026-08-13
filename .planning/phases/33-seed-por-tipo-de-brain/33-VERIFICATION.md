---
phase: 33-seed-por-tipo-de-brain
verified: 2026-08-13T17:07:32Z
status: human_needed
score: 6/7 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "SEED-04: Reiniciar o container do Brain múltiplas vezes contra o mesmo banco não duplica nem falha o seed (idempotente via ON CONFLICT DO NOTHING), verificado contra um Postgres real"
    test: "Run `TEST_DATABASE_URL=postgres://... bun test packages/database/src/__tests__/integration/seed-idempotency.test.ts` (packages/database) against a real, schema-migrated PostgreSQL instance"
    expected: "All test cases pass (not skip): for each of sdr/support/echo, calling runBrainSeed() twice in a row against synthetic seed-idem-<type> fixtures never throws, and COUNT queries on fup_config/prompts return exactly 1 row after the second call — proving ON CONFLICT DO NOTHING actually suppresses duplicate rows at the database level, not just that a mocked call resolves twice"
    why_human: "No TEST_DATABASE_URL/POSTGRES_URL was available in this sandbox (confirmed empty) and no docker-compose/test-DB fixture exists in this repo to stand one up safely; the only Postgres containers running on this host belong to unrelated projects (nexusai, evolution-api) and lack the Brain schema, so using them risks touching infrastructure this verification has no mandate over. The unit-level seed.test.ts 'idempotência' test only proves a mocked sql.begin() resolves twice without throwing — it does not exercise real Postgres ON CONFLICT DO NOTHING duplicate-suppression, which is the actual claim SEED-04 makes. A human with access to a real test database must run the gated integration test once to close this."
human_verification:
  - test: "Run `TEST_DATABASE_URL=postgres://... bun test packages/database/src/__tests__/integration/seed-idempotency.test.ts` (packages/database) against a real, schema-migrated PostgreSQL instance"
    expected: "3 describe blocks (sdr/support/echo) pass with no skips; two consecutive runBrainSeed() calls per type produce exactly 1 fup_config row and exactly 1 prompts(key='fup') row each"
    why_human: "Requires a live PostgreSQL instance with the Brain schema (fup_config, prompts, _schema_lock) already migrated; unavailable in the verification sandbox. 33-02-SUMMARY.md itself flags this same gap (D4, human_judgment: true)."
---

# Phase 33: Seed por Tipo de Brain Verification Report

**Phase Goal:** Cada imagem de Brain semeia, na inicialização, apenas os prompts e a configuração de FUP do seu próprio brain_type — FUP funciona out-of-the-box em qualquer banco novo, sem seed manual e sem contaminação cruzada entre tipos (echo/sdr/support)
**Verified:** 2026-08-13T17:07:32Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SEED-01: fresh DB for any Brain (sdr/support/echo) gets only its own brain_type's prompt rows — no cross-type leakage | ✓ VERIFIED | `packages/database/src/seeds/{sdr,support,echo}/0001_fup_defaults.sql` each hardcode only their own `brain_type` literal; `seed-cross-brain-isolation.test.ts` (16/16 pass, real file reads, no mocks) asserts none of the 6 ordered cross-type pairs' file text contains another type's literal, and each Dockerfile references only its own `seeds/<type>` path. `apps/brain-{sdr,support,echo}/Dockerfile` each `COPY` only their own subfolder (grep-confirmed, no cross-references) |
| 2 | SEED-02: fresh DB for any Brain automatically gets one `fup_config` row for its brain_type, no manual insert | ✓ VERIFIED | `runBrainSeed()` (`packages/database/src/seed.ts`) wired into `BrainRunner.init()` between `runMigrations()` and `loadPrompts()` (`packages/core/src/runner/runner.ts:151-167`); each seed SQL file INSERTs into `fup_config` with `ON CONFLICT (brain_type) DO NOTHING`; D-08 fail-fast validates the row exists post-seed (`seed.ts:73-79`, tested by `seed.test.ts`'s "D-08/D-09" describe block) |
| 3 | SEED-03: fresh DB for any Brain automatically gets a `prompts(key='fup')` row for its brain_type — FUP works without manual setup | ✓ VERIFIED | Same seed files INSERT into `prompts(brain_type, key='fup', content=<production-ready PT-BR prompt>)`, `ON CONFLICT (brain_type, key) DO NOTHING`; D-09 fail-fast validates the row exists post-seed. Content contains zero `[`/`]` placeholder characters (grep-confirmed) and no "edit before shipping" instruction — genuinely production-ready per D-06. D-10 (Plan 33-03) additionally wires `FupScheduler` to inject the sent FUP message into the lead's LangGraph checkpoint via `BrainRunner.injectMessage()`, deepening this criterion; both the happy path and the fire-and-forget failure-isolation path are covered by passing unit tests (13/13 in `fup-scheduler.test.ts`) |
| 4 | SEED-04: restarting the Brain container multiple times against the same DB does not duplicate or fail the seed (idempotent via `ON CONFLICT DO NOTHING`) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The mechanism is present and correctly shaped: every seed SQL file uses `ON CONFLICT (...) DO NOTHING` (grep-confirmed, same idiom already proven in production by migrations 0002/0005/0010); `runBrainSeed()`'s own retry/lock logic is unit-tested (16/16 pass) including a mocked "call twice, no throw" case. But the actual duplicate-suppression claim is a real-Postgres runtime behavior that only the gated `seed-idempotency.test.ts` integration test exercises — and it skipped (0 pass / 3 skip) in this environment (no `TEST_DATABASE_URL`/`POSTGRES_URL`). See Human Verification below |
| 5 | SEED-05: customer DBs already on migrations 0002/0005/0010 keep working — no destructive/retroactive migration | ✓ VERIFIED | `git log` on `migrate.ts`, `0002_echo_brain_seed.sql`, `0005_brain_sdr_prompts.sql`, `0010_brain_support_prompts.sql` shows their last touching commits all predate phase 33 (`0526219`, `27376b4`, `a810b25`, `cbcfb7b` respectively); none of phase 33's 7 commits (`70dc2cf`, `9aae1dc`, `11b0533`, `02895a8`, `55409ea`, `af329d1`, `d56027e`) modify these paths (confirmed via `git show --stat`). `seed.test.ts`'s "SEED-05" describe block re-confirms each file still contains its original marker substrings — 3/3 pass |
| 6 | `BrainRunner.init()` fails loudly (process.exit(1)) if `fup_config`/`prompts(key='fup')` is missing after seeding, instead of silently letting FupScheduler skip the lead later | ✓ VERIFIED | `seed.ts`'s D-08/D-09 validation throws a named error if either row is missing; `runner.ts`'s `.catch()` on `runBrainSeed()` logs and exits; `brain-runner.test.ts`'s "init() calls process.exit(1) when SEEDS_FOLDER ENV is not set" test passes, and `seed.test.ts`'s fail-fast tests pass (error propagates without retry, `beginCallCount` stays at 1) |
| 7 | `runBrainSeed()` never calls `process.exit()` itself — throws only, decision to exit belongs to `BrainRunner.init()` | ✓ VERIFIED | `grep -n "process.exit" packages/database/src/seed.ts` returns no match; `seed.test.ts`'s dedicated `process.exit` spy asserts zero calls across the happy path, validation-failure path, and lock-exhaustion path (all pass) |

**Score:** 6/7 truths verified (1 present + wired, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/database/src/seed.ts` | `runBrainSeed(sql, brainType, seedsFolder)` mechanism | ✓ VERIFIED | Exists, substantive (108 lines, full retry/lock/validation logic), wired into `runner.ts` and exported from `index.ts` |
| `packages/database/src/seeds/sdr/0001_fup_defaults.sql` | fup_config + prompt seed for sdr | ✓ VERIFIED | Exists, substantive, `ON CONFLICT DO NOTHING` idiom present, zero brackets |
| `packages/database/src/seeds/support/0001_fup_defaults.sql` | fup_config + prompt seed for support | ✓ VERIFIED | Exists, substantive, byte-identical shape to sdr except `brain_type` literal |
| `packages/database/src/seeds/echo/0001_fup_defaults.sql` | fup_config + prompt seed for echo | ✓ VERIFIED | Exists, substantive, byte-identical shape to sdr except `brain_type` literal |
| `packages/database/src/index.ts` | exports `runBrainSeed` | ✓ VERIFIED | `export { runBrainSeed } from './seed.js';` present |
| `packages/core/src/runner/runner.ts` | wires `runBrainSeed()` into `init()` with `SEEDS_FOLDER` fail-fast | ✓ VERIFIED | Call site at line 163, fail-fast check at line 155-161, positioned after `runMigrations()` and before `loadPrompts()` |
| `apps/brain-{sdr,support,echo}/Dockerfile` | COPY only own `seeds/<type>` subfolder + `ENV SEEDS_FOLDER` | ✓ VERIFIED | Each Dockerfile greps clean for its own path only, no cross-type references |
| `packages/database/src/__tests__/unit/seed.test.ts` | Unit suite for `runBrainSeed()` | ✓ VERIFIED | 16/16 pass, covers bootstrap, lock, ordered execution, D-08/D-09, retry, throw-not-exit, SEED-05 |
| `packages/database/src/__tests__/unit/seed-cross-brain-isolation.test.ts` | DB-free physical isolation proof | ✓ VERIFIED | 16/16 pass |
| `packages/database/src/__tests__/integration/seed-idempotency.test.ts` | Gated real-DB idempotency proof | ⚠️ ORPHANED (untested at runtime) | Exists, substantive, correctly gated (`describeOrSkip`); skips cleanly (0 pass/3 skip) with no test DB in this sandbox — never actually exercised against Postgres in this verification |
| `packages/core/src/fup/fup-scheduler.ts` (D-10) | `injectMessage` field + fire-and-forget call site | ✓ VERIFIED | Required field present, call site between `_sendFupWebhook()` and `fup_step` calculation, wrapped in `.catch()`, logs only `uniqueId` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `BrainRunner.init()` | `runBrainSeed()` | direct call after `runMigrations()`, before `loadPrompts()` | ✓ WIRED | `runner.ts:163` calls `runBrainSeed(this.sql, this.brain.brainType, seedsFolder)`, textually before the `loadPrompts()` line |
| `runBrainSeed()` | `_schema_lock` table | `FOR UPDATE NOWAIT` inside `sql.begin()` | ✓ WIRED | Same row-lock table/shape as `migrate.ts`, confirmed by dedicated unit tests; no second lock mechanism introduced |
| `apps/brain-{type}/Dockerfile` | `SEEDS_FOLDER` ENV | `COPY ... ./seeds` + `ENV SEEDS_FOLDER=/app/seeds` | ✓ WIRED | Confirmed present in all three Dockerfiles, each pointing at its own type-scoped subfolder only |
| `FupScheduler._processFupForLead()` | `BrainRunner.injectMessage()` | `this.opts.injectMessage(lead.uniqueId, message)` bound via `runner.ts:249` | ✓ WIRED | Call site confirmed between `_sendFupWebhook()` and the `fup_step` UPDATE; `runner.ts` passes `injectMessage: this.injectMessage.bind(this)` at `FupScheduler` construction |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `runBrainSeed()` unit suite | `bun test src/__tests__/unit/seed.test.ts` (packages/database) | 16 pass, 0 fail | ✓ PASS |
| Cross-brain isolation unit suite | `bun test src/__tests__/unit/seed-cross-brain-isolation.test.ts` (packages/database) | 16 pass, 0 fail | ✓ PASS |
| `BrainRunner`/runner-fup/runner-wr unit suites | `bun test src/runner/__tests__/{brain-runner,runner-fup,runner-wr}.test.ts` (packages/core) | 49 pass, 0 fail | ✓ PASS |
| `FupScheduler` D-10 unit suite | `bun test src/__tests__/unit/fup/fup-scheduler.test.ts` (packages/core) | 13 pass, 0 fail | ✓ PASS |
| Idempotency integration suite (gated) | `bun test src/__tests__/integration/seed-idempotency.test.ts` (packages/database) | 0 pass, 3 skip | ? SKIP (no TEST_DATABASE_URL/POSTGRES_URL) |
| `packages/database` typecheck | `bun run typecheck` | exit 0 | ✓ PASS |
| `packages/core` typecheck | `bun run typecheck` | exit 0 | ✓ PASS |
| SEED-05 protected files untouched | `git log -1 --format=%H` on each of the 4 protected files, cross-checked against phase 33's 7 commit hashes | all 4 pre-date phase 33; none of phase 33's commits touch them | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEED-01 | 33-02 | No cross-brain-type prompt leakage | ✓ SATISFIED | `seed-cross-brain-isolation.test.ts` 16/16 pass + manual file/Dockerfile grep |
| SEED-02 | 33-01, 33-02 | `fup_config` auto-seeded per brain_type | ✓ SATISFIED | `seed.ts` + seed SQL files + `runner.ts` wiring + unit tests |
| SEED-03 | 33-01, 33-02, 33-03 | `prompts(key='fup')` auto-seeded per brain_type; D-10 checkpoint injection | ✓ SATISFIED | Seed SQL files + `fup-scheduler.ts` D-10 wiring, both test-covered and passing |
| SEED-04 | 33-01, 33-02 | Idempotent seed, independent of drizzle/`_schema_lock` | ⚠️ PARTIALLY SATISFIED | Mechanism present (`ON CONFLICT DO NOTHING`) and unit-tested at the mock level; real-Postgres duplicate-suppression proof (the gated integration test) never ran against a live DB in this verification — see Human Verification |
| SEED-05 | 33-01, 33-02 | Migrations 0002/0005/0010 untouched | ✓ SATISFIED | `git log`/`git show --stat` confirms zero touches across all 7 phase-33 commits; unit test re-confirms markers |

No orphaned requirements — all 5 IDs declared in ROADMAP/REQUIREMENTS.md are claimed by at least one plan's `requirements:` frontmatter field, and all 5 are marked `[x]`/`Complete` in REQUIREMENTS.md.

### Anti-Patterns Found

None. Scanned all 15 files modified across the three plans for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/placeholder patterns/empty implementations. The only "placeholder" string matches were inside a code comment explaining *why* curly-brace array literals were chosen over `ARRAY[...]` (to avoid literal bracket characters that could be confused with a placeholder marker) — not an actual stub. No debt markers found.

Two pre-existing, phase-33-unrelated issues were surfaced by `33-REVIEW.md` (CR-01/CR-02, `fup-e2e.test.ts`'s nonexistent `leads.brain_type` column and invalid `ON CONFLICT` target) — confirmed via `git log`/`git show` that phase 33 only added 3 lines to that file (a no-op `injectMessage` mock, commit `d56027e`) and the actual bugs trace to commit `fe678ba` (2026-07-01), months before this phase. Both are tracked in `.planning/todos/pending/` and are correctly excluded from this phase's gap assessment per the provided known_context.

`33-REVIEW.md` also raised three WARNING-level design observations (WR-01: `fup_config.enabled=true` default auto-arms FUP even without `FUP_WEBHOOK_URL` configured; WR-02: no runtime brain_type guard on the `leads` table; WR-03: no re-entrancy guard on `FupScheduler._tick()`). These are legitimate design considerations for future hardening but do not contradict any of the phase's 5 roadmap Success Criteria as literally stated — they are noted here for visibility, not treated as blocking gaps.

### Human Verification Required

### 1. Live-database confirmation of SEED-04 idempotency

**Test:** Run `TEST_DATABASE_URL=postgres://... bun test packages/database/src/__tests__/integration/seed-idempotency.test.ts` against a real, schema-migrated PostgreSQL instance (fup_config, prompts, _schema_lock tables must already exist).
**Expected:** All test cases execute (no skips); for each of sdr/support/echo, two consecutive `runBrainSeed()` calls against synthetic `seed-idem-<type>` fixtures never throw, and a `COUNT` on `fup_config`/`prompts` for that synthetic brain_type returns exactly 1 row each time.
**Why human:** No `TEST_DATABASE_URL`/`POSTGRES_URL` was configured in this verification sandbox (confirmed empty), and no project-owned docker-compose/test-DB fixture exists to safely stand one up. The Postgres containers already running on this host belong to unrelated projects and lack the Brain schema — using them is out of scope for this verification. The claim SEED-04 makes (`ON CONFLICT DO NOTHING` actually suppresses duplicate rows against a real Postgres instance) is a runtime database behavior that the mocked unit test (`seed.test.ts`) cannot exercise — it only proves the mocked call resolves twice without throwing, not that no duplicate row was created. `33-02-SUMMARY.md` itself flags this exact gap (`D4`, `human_judgment: true`), consistent with this finding.

### Gaps Summary

No gaps found that block the phase goal. All artifacts exist, are substantive, and are correctly wired; all typechecks pass; all runnable unit test suites pass (94 tests total across 4 files: 16+16+49+13); SEED-05's non-destructive guarantee is independently confirmed via git history, not just test assertion. The single open item is a **behavior-unverified** truth (SEED-04's real-Postgres idempotency claim), which is present, correctly designed (`ON CONFLICT DO NOTHING`, the same idiom already running safely in production via migrations 0002/0005/0010), and covered by a properly-gated integration test that this sandbox cannot execute for lack of a test database — not a code defect, but an unexecuted proof. This routes the phase to `human_needed` rather than `passed`, per the verification framework's rule that presence + wiring is necessary but not sufficient for a runtime-behavior claim.

---

_Verified: 2026-08-13T17:07:32Z_
_Verifier: Claude (gsd-verifier)_
