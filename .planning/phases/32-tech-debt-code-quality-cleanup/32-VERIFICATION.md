---
phase: 32-tech-debt-code-quality-cleanup
verified: 2026-07-02T02:22:55Z
status: gaps_found
score: 6/8 must-haves verified
overrides_applied: 0
gaps:
  - truth: "bun test packages/core/src/runner/__tests__/brain-runner.test.ts exits 0, all tests pass (Plan 01 acceptance criteria)"
    status: failed
    reason: "The command silently crashes (exit code 1, zero test output, zero 'pass'/'fail' lines printed) when run against this repository's actual .env.test file. Root cause: .env.test (gitignored, local-only) sets EMBEDDING_DIMENSIONS=128. Plan 01 Task 3 (D-13 fix) removed the mock.module(\"@brain-pkg/embeddings\", ...) mock from brain-runner.test.ts, so createEmbeddingProvider() now runs for real and reads this env var, producing an OpenAIEmbeddingProvider with dimensions=128. The test file's mock SQL (makeMockSql()) hardcodes the atttypmod dimension-check query to return dimensions:1536. This mismatch (128 !== 1536) triggers runner.ts's genuine, unmocked process.exit(1) inside the very first test that calls a real init() without stubbing process.exit — killing the whole bun test worker before any test result is printed. Confirmed reproducible via direct bisection: renaming .env.test out of the way, or forcing EMBEDDING_DIMENSIONS=1536, makes all 38 tests pass cleanly; restoring .env.test reproduces the silent crash every time."
    artifacts:
      - path: "packages/core/src/runner/__tests__/brain-runner.test.ts"
        issue: "Test file's hardcoded mock dimension (1536 in makeMockSql()) is not resilient to a real EMBEDDING_DIMENSIONS env value diverging from 1536, now that createEmbeddingProvider() runs for real (D-13 fix removed the embeddings mock). Any developer/CI environment with a local .env.test whose EMBEDDING_DIMENSIONS != 1536 will hit this same silent crash."
    missing:
      - "Make the dimension-check test setup independent of the real EMBEDDING_DIMENSIONS env value — e.g. explicitly set process.env.EMBEDDING_DIMENSIONS=\"1536\" at the top of brain-runner.test.ts (mirroring the existing MIGRATIONS_FOLDER/DATABASE_URL env overrides already present at lines 156-160), or inject an explicit embeddingProvider with dimensions matching whatever the mock SQL returns in every test that doesn't already do so."
      - "Alternatively/additionally: guard against this class of bug being invisible again — a test run that hits an unmocked process.exit(1) mid-suite should be loud (e.g. CI should fail with a visible reason), not silently exit 1 with 0 printed test results. Consider whether other tests in this file (or the wider suite) have the same latent fragility now that D-13 made embeddings resolution real."
  - truth: "TECH-06 marked complete in REQUIREMENTS.md, matching the other 4/5 completed plans"
    status: failed
    reason: "REQUIREMENTS.md line 15 still shows '- [ ] **TECH-06**' (unchecked) and the Traceability table (line 81) still shows 'TECH-06 | Phase 32 | Pending' even though ROADMAP.md shows Phase 32 100% complete (5/5 plans) and this verification confirms the vast majority of the phase's code changes are genuinely implemented. This is a documentation-sync gap, not a functional one, but it means REQUIREMENTS.md's checkbox/traceability status does not reflect the phase's actual completion state."
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "TECH-06 checkbox unchecked and Traceability table status 'Pending' despite Phase 32 being reported complete in ROADMAP.md"
    missing:
      - "Update REQUIREMENTS.md: change '- [ ] **TECH-06**' to '- [x] **TECH-06**' and the Traceability table row from 'Pending' to 'Complete', once the brain-runner.test.ts gap above is closed (or an override is recorded for it)."
human_verification: []
---

# Phase 32: Code Quality Cleanup — Accumulated Warnings & Test/Doc Hygiene Verification Report

**Phase Goal:** Achados warning/info de code review acumulados nas fases 27-30 estão resolvidos e as lacunas de documentação/teste estão preenchidas, zerando o ledger de tech debt do v1.5
**Verified:** 2026-07-02T02:22:55Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `BrainRunner.init()` called twice does not double-register SIGTERM handlers | ✓ VERIFIED | `process.off('SIGTERM', this._sigtermHandler)` present in `runner.ts:248` before re-registration; also removed in `close()` (line 489) |
| 2 | Dimension-mismatch query with zero rows produces a clear error, not a raw destructure crash | ✓ VERIFIED | `runner.ts:168` guards `dimensionRows.length === 0` with `logger.error` + `process.exit(1)` before destructure |
| 3 | Duplicate `DATABASE_URL` check removed from `_compileGraph()` | ✓ VERIFIED | `grep -c "DATABASE_URL is not set"` returns 0; `_compileGraph()` reads `dbUrl!` directly, non-null-asserted, per IN-04 comment at line 510 |
| 4 | RabbitMQ retry-map keys include a channel suffix | ✓ VERIFIED | `consumer.ts:116` — `${parsed.data.IDLead}:${parsed.data.Numero}:rabbitmq` |
| 5 | `WebhookTransport.getStatus()` returns `connected:false` after `.stop()` | ✓ VERIFIED | `handler.ts:129` (`private stopped = false`), `handler.ts:164` (`connected: !this.stopped`) |
| 6 | `reembed.ts` caps at `MAX_PAGES=500`, returns `truncated:true` when hit | ✓ VERIFIED | `reembed.ts:22` (`MAX_PAGES = 500`), truncated flag threaded through logs + JSON response; test suite confirms exactly 500 SELECTs then truncated |
| 7 | `search_knowledge` truncates chunk content over 2000 chars | ✓ VERIFIED | `search-knowledge.ts:30` (`MAX_CHUNK_DISPLAY_CHARS = 2000`), `truncateContent()` wired into `formatResults()` |
| 8 | `GeminiEmbeddingProvider` rejects `EMBEDDING_DIMENSIONS != 3072` | ✓ VERIFIED | `gemini-provider.ts:28` — `if (this.dimensions !== 3072)` throws `ConfigurationError` |
| 9 | `ingest.ts` comment no longer references stale `EMBEDDING_DIMENSIONS=768` | ✓ VERIFIED | `grep -c "EMBEDDING_DIMENSIONS=768"` returns 0 |
| 10 | Shared `hasToolCall`/`getFirstToolCallName` type-guards exist and are used by both Brains | ✓ VERIFIED | `packages/core/src/brain/type-guards.ts` exports both; both `brain.ts` files import and use them (3 occurrences each: import + `routeAfterLlm` + respond-detection) |
| 11 | `RESERVED_TOOL_NAMES` derived from real tool instances in both Brains | ✓ VERIFIED | Both files: `new Set<string>([...].map((t) => t.name))` inside `buildGraph()`, replacing the old hardcoded literal |
| 12 | `LazyEmbeddingProvider`/`getEmbeddingProvider()` rationale documented inline | ✓ VERIFIED | `D-04 (Phase 32...)` and `D-05/D-10 (Phase 32...)` doc comments present in both `brain.ts` files |
| 13 | `fup-e2e.test.ts` tests are independent, no shared mutable lead state | ✓ VERIFIED | `insertLead()` helper (4 occurrences: definition + 3 call sites), old `LEAD_UNIQUE_ID` constant fully removed |
| 14 | `REQUIREMENTS.md` SUP-08 text matches `toolsRegistry.enableTool()` production API | ✓ VERIFIED | Line 34 of REQUIREMENTS.md now references `toolsRegistry.enableTool("support", ...)` |
| 15 | `requirements-completed` frontmatter backfilled on 4 flagged SUMMARY.md files | ✓ VERIFIED | All 4 files (`27-02`, `27-03`, `29-01`, `29-02`) confirmed to contain the field with correct requirement IDs |
| 16 | `brain-runner.test.ts` and `factory.test.ts` produce 0 failures when run together (D-13 root-cause fix) | ✗ FAILED | See Gap 1 below — the combined command doesn't even reach a comparable state because `brain-runner.test.ts` alone already crashes silently in this repo's actual environment |
| 17 | TECH-06 marked complete in REQUIREMENTS.md | ✗ FAILED | See Gap 2 below — checkbox and Traceability table still show Pending |

**Score:** 15/17 truths verified (or: 6/8 must-haves per plan-frontmatter aggregation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/runner/runner.ts` | Idempotent SIGTERM + defensive atttypmod handling + dedup DATABASE_URL check | ✓ VERIFIED | All 3 sub-changes confirmed via grep + code read |
| `packages/transport/src/rabbitmq/consumer.ts` | Retry map key channel suffix | ✓ VERIFIED | Confirmed |
| `packages/transport/src/webhook/handler.ts` | `stopped` flag + `getStatus()` reflects it | ✓ VERIFIED | Confirmed |
| `packages/core/src/rag/reembed.ts` | `MAX_PAGES` cap | ✓ VERIFIED | Confirmed, test suite passes with real 500-page cap behavior demonstrated in logs |
| `packages/core/src/tools/search-knowledge.ts` | Truncation of chunk content | ✓ VERIFIED | Confirmed |
| `packages/embeddings/src/gemini-provider.ts` | Fail-fast dimension validation | ✓ VERIFIED | Confirmed |
| `packages/core/src/brain/type-guards.ts` | `hasToolCall`/`getFirstToolCallName` | ✓ VERIFIED | Confirmed, exported from `@brain-pkg/core` index |
| `apps/brain-sdr/src/brain.ts`, `apps/brain-support/src/brain.ts` | Derived `RESERVED_TOOL_NAMES` + shared type-guards + doc comments | ✓ VERIFIED | Confirmed in both files |
| `packages/core/src/__tests__/integration/fup-e2e.test.ts` | 3 independent tests | ✓ VERIFIED (code) / ⚠️ pre-existing DB-state issue unrelated to this phase when run against a live migrated DB in this sandbox |
| `.planning/phases/27-tech-debt-fixes/27-02-SUMMARY.md` etc. (4 files) | `requirements-completed` frontmatter | ✓ VERIFIED | All 4 confirmed |
| `packages/core/src/runner/__tests__/brain-runner.test.ts` | No `mock.module("@brain-pkg/embeddings", ...)`, all tests pass | ⚠️ HOLLOW — code change verified present (grep confirms 0 matches), but the file's own tests do not pass in the actual repo environment (silent crash, see Gap 1) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `runner.ts init()` | `process.off('SIGTERM', ...)` | idempotent removal before re-registration | ✓ WIRED | Confirmed at line 248 |
| `webhook/handler.ts stop()` | `getStatus()` | `stopped` flag read | ✓ WIRED | Confirmed |
| `reembed.ts` pagination loop | `MAX_PAGES` constant | page counter break condition | ✓ WIRED | Confirmed, test demonstrates cap enforcement |
| `gemini-provider.ts` constructor | `ConfigurationError` | `dimensions !== 3072` check | ✓ WIRED | Confirmed |
| `brain-sdr/brain.ts routeAfterLlm` | `type-guards.ts hasToolCall` | import from `@brain-pkg/core` | ✓ WIRED | Confirmed |
| `brain-support/brain.ts routeAfterLlm` | `type-guards.ts hasToolCall` | import from `@brain-pkg/core` | ✓ WIRED | Confirmed |
| `brain-sdr/brain.ts RESERVED_TOOL_NAMES` | native tool instances | `new Set<string>(instances.map(t => t.name))` | ✓ WIRED | Confirmed |
| `fup-e2e.test.ts` each test | own uniquely-keyed lead row | per-test `unique_id` via `insertLead()` | ✓ WIRED | Confirmed by code inspection (DB-level execution blocked by unrelated pre-existing migration-tracker desync in this sandbox) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `brain-runner.test.ts` passes in isolation (Plan 01 acceptance criteria) | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | Silent crash — `bun test v1.3.2` header only, exit code 1, 0 pass/0 fail lines printed | ✗ FAIL |
| Same command, `.env.test` (gitignored local file) temporarily removed | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` (no `.env.test`) | `38 pass, 0 fail, 85 expect() calls` | ✓ PASS (proves root cause) |
| Combined `brain-runner.test.ts` + `factory.test.ts` regression check, `.env.test` disabled | `bun test --env-file=/dev/null ...` | `49 pass, 0 fail, 98 expect() calls` | ✓ PASS (proves the actual D-13 fix logic is correct; only the env-dependence is broken) |
| `transport-status.test.ts` | `bun test packages/transport/src/__tests__/unit/transport-status.test.ts` | `6 pass, 0 fail` | ✓ PASS |
| `search-knowledge.test.ts` + `gemini-provider.test.ts` | combined run | `22 pass, 0 fail` | ✓ PASS |
| `reembed.test.ts` | isolated run | `13 pass, 0 fail`, confirms MAX_PAGES=500 cap firing in logs | ✓ PASS |
| `apps/brain-sdr` + `apps/brain-support` `brain.test.ts` | combined run | `31 pass, 0 fail` | ✓ PASS |
| `type-guards.test.ts` | isolated run | `8 pass, 0 fail` | ✓ PASS |
| `pnpm --filter @brain-pkg/core / @brain-app/sdr / @brain-app/support typecheck` | all 3 | exit 0, no errors | ✓ PASS |
| `fup-e2e.test.ts` against live DB in this sandbox | `bun test packages/core/src/__tests__/integration/fup-e2e.test.ts` | Fails with Postgres 42P07 "relation already exists" — a pre-existing migration-tracker desync (documented historical issue in `27-VERIFICATION.md`, unrelated to Phase 32's isolation refactor) | ? SKIP (environment/DB-state issue, not a Phase 32 code regression) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TECH-06 | 32-01 through 32-05 (all 5 plans) | Achados warning/info de code review das fases 27-30 resolvidos e lacunas de documentação/teste preenchidas | ⚠️ MOSTLY SATISFIED, ONE REGRESSION | 15/17 observable truths verified; the code changes for every item in the audit's `tech_debt` block are genuinely present and correct. However, the concrete regression in Gap 1 means the phase's own stated verification command (`bun test brain-runner.test.ts`) does not pass in the actual repository, and REQUIREMENTS.md itself (Gap 2) was never updated to reflect completion. |

No orphaned requirements — TECH-06 is the sole requirement ID for this phase and is referenced by all 5 plans' frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/runner/__tests__/brain-runner.test.ts` | (module-level test design) | Hardcoded mock dimension (1536) with no defensive override of `EMBEDDING_DIMENSIONS` env, combined with a real (unmocked) `createEmbeddingProvider()` call | 🛑 Blocker | Causes a genuine unguarded `process.exit(1)` mid-test whenever the real `EMBEDDING_DIMENSIONS` env value (from a local, gitignored `.env.test`) differs from 1536 — silently kills the entire bun test worker with zero printed results. Confirmed reproducing in this repository's actual environment. |
| `.planning/REQUIREMENTS.md` | 15, 81 | TECH-06 checkbox/traceability not updated to Complete despite Phase 32 being reported 5/5 done | ⚠️ Warning | Documentation-sync gap; does not affect runtime behavior but breaks the "requirements traceability" contract this same phase's Plan 05 was explicitly designed to strengthen. |

(No blocker-level anti-patterns — TODO/FIXME/placeholder/stub scans — found in any of the phase's modified production source files.)

### Human Verification Required

None. Both gaps are deterministically reproducible via automated commands (see Behavioral Spot-Checks above) and do not require subjective/visual/human judgment to confirm.

### Gaps Summary

Phase 32 correctly implements the overwhelming majority of its scope: every WR-/IN- finding from Phases 27-30 that the phase set out to close has a genuine, working code fix (SIGTERM idempotency, RabbitMQ retry-key collision, WebhookTransport stale status, atttypmod defensive handling + doc, duplicate DATABASE_URL removal, reembed.ts pagination cap, ingest.ts comment fix, search-knowledge truncation, Gemini dimension validation, shared type-guards, derived RESERVED_TOOL_NAMES, LazyEmbeddingProvider/getEmbeddingProvider documentation, fup-e2e.test.ts isolation refactor, SUP-08 requirement-text alignment, and SUMMARY.md frontmatter backfill). Typechecks pass cleanly across `@brain-pkg/core`, `@brain-app/sdr`, and `@brain-app/support`.

However, one specific regression blocks a clean "zeroed tech-debt ledger" claim: Plan 01's Task 3 (the D-13 `mock.module` cross-pollution fix) correctly stopped mocking `@brain-pkg/embeddings` in `brain-runner.test.ts`, letting the real `createEmbeddingProvider()` run under test — but this makes the test file's outcome dependent on the real `EMBEDDING_DIMENSIONS` environment variable, which the test's hardcoded mock SQL (`dimensions: 1536`) does not account for. This repository's actual `.env.test` (a gitignored, local-only file with a well-documented history of exactly this class of cross-environment drift bug going back to v1.0's Phase 2) sets `EMBEDDING_DIMENSIONS=128`, causing a genuine, unmocked `process.exit(1)` to fire inside the very first test that calls a real `init()`. This silently kills the whole `bun test` worker process before any test result is printed — meaning the phase's own stated acceptance criteria ("bun test packages/core/src/runner/__tests__/brain-runner.test.ts exits 0, all tests pass") does not hold in this environment. The executor's worktree almost certainly lacked (or had a different) `.env.test`, which is why this was never caught during execution or code review.

Additionally, `.planning/REQUIREMENTS.md` was never updated to mark TECH-06 complete (still `[ ]`/"Pending"), despite ROADMAP.md showing Phase 32 at 5/5 plans complete — a documentation gap in the very requirement this phase closes.

Both gaps have concrete, narrow fixes: (1) make `brain-runner.test.ts` independent of the ambient `EMBEDDING_DIMENSIONS` env value (e.g., explicit override at the top of the file, matching the existing `MIGRATIONS_FOLDER`/`DATABASE_URL` override pattern already in the file), and (2) flip TECH-06's checkbox/traceability status once the first gap is closed.

---

*Verified: 2026-07-02T02:22:55Z*
*Verifier: Claude (gsd-verifier)*
