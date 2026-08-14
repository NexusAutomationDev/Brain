---
phase: 34-funda-o-de-handoff-agents-dblink
verified: 2026-08-14T02:15:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 34: Fundação de Handoff (Agents + DBLink) Verification Report

**Phase Goal:** A infraestrutura de dados para transferência de lead existe e é validável
isoladamente — tabela `agents` como registro de destinos, extensão `dblink` disponível por
padrão em todo banco, e a coluna `leads.handoff_context` já presente no schema (seu uso
ponta-a-ponta é validado na Fase 35) — antes de qualquer tool ou fluxo de transferência ser
construído.

**Verified:** 2026-08-14T02:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Schema inclui tabela `agents` (name PK, brain_type, connection_string, enabled, timestamps), populável via INSERT SQL direto sem redeploy (HANDOFF-01) | ✓ VERIFIED | `packages/database/src/schema/tables.ts:157-167` defines all 6 columns exactly as specified. Independently re-ran a fresh migration against a new scratch Postgres 17 container (`brain-verify34-pg`, port 5435) and confirmed via `psql \d agents` all 6 columns present with correct types/defaults. `agents.integration.test.ts` inserts rows via plain `INSERT ... ON CONFLICT DO NOTHING` SQL (no redeploy, no code path beyond raw SQL) — independently re-ran, 3/3 pass. |
| 2 | Migration compartilhada executa `CREATE EXTENSION IF NOT EXISTS dblink` automaticamente na inicialização (HANDOFF-02) | ✓ VERIFIED | `packages/database/src/migrations/0012_agents_dblink_handoff_context.sql:1` — first statement. Independently re-ran `bun src/migrate.ts` against a brand-new scratch DB and confirmed via `psql -c "SELECT extname FROM pg_extension WHERE extname='dblink'"` exactly one row returned — no manual activation performed. |
| 3 | Consultar `agents` por nome desconhecido ou `enabled=false` retorna rejeição clara; nome válido/habilitado retorna connection string (HANDOFF-04) | ✓ VERIFIED | `packages/database/src/agents.ts:25-37` implements the exact three-way `not_found`/`disabled`/`ok` contract using `eq(agents.name, name)` (no `sql.unsafe`, no string interpolation). Independently re-ran both `bun test src/__tests__/unit/agents.test.ts` (3/3 pass) and `bun test src/__tests__/integration` against a fresh real Postgres instance (22/22 pass, including `agents.integration.test.ts`'s 3 cases and `migration-0012.test.ts`'s 5 assertions) — not skipped. |
| 4 | Qualquer código relacionado a handoff resolve `thread_id` exclusivamente do contexto de execução/configurable, nunca de argumento de tool/LLM (HANDOFF-10) | ✓ VERIFIED (as documented constraint) | Confirmed no code in this phase (or anywhere in the monorepo outside `packages/core/src/tools/pause-session.ts`/`finish-conversation.ts`) consumes `thread_id` in a handoff context — grepped `apps/`, `packages/core/src/tools/` and found zero call sites importing `getAgentConnection` or handling handoff-related `thread_id`. This is correct per D-08 (Phase 34 builds no tool/LLM call site). The constraint itself is explicitly and non-silently carried forward: documented in `34-CONTEXT.md` D-08 ("Phase 35's planner/verifier DEVE aplicar o mesmo padrão D-04 já usado por pause-session.ts/finish-conversation.ts"), in `34-02-PLAN.md`'s `must_haves.truths`, and in `34-02-SUMMARY.md`'s coverage table (id D5, `human_judgment: true`, explicit rationale). Not silently dropped. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/database/src/schema/tables.ts` | `agents` pgTable + `leads.handoffContext` nullable column | ✓ VERIFIED | Both present exactly as specified, lines 107-109 and 155-167 |
| `packages/database/src/migrations/0012_agents_dblink_handoff_context.sql` | dblink + agents + handoff_context DDL, in order | ✓ VERIFIED | Confirmed statement order via file read; applied successfully against real Postgres (independently re-run) |
| `packages/database/src/migrations/meta/_journal.json` | idx=12 entry, tag `0012_agents_dblink_handoff_context` | ✓ VERIFIED | Confirmed present |
| `packages/database/src/migrations/meta/0012_snapshot.json` | valid snapshot, prevId chains to 0011 | ✓ VERIFIED | `0012_snapshot.json.prevId` (`f1f161af-...`) matches `0011_snapshot.json.id` exactly — snapshot chain intact |
| `packages/database/src/agents.ts` | `getAgentConnection(sql, name)` + `AgentConnectionResult` type | ✓ VERIFIED | Both exported, implementation matches spec exactly (parameterized `eq()`, live query, no logging of full row) |
| `packages/database/src/index.ts` | barrel-exports `getAgentConnection`/`AgentConnectionResult` | ✓ VERIFIED | Lines 18-20 |
| `packages/database/src/__tests__/unit/agents.test.ts` | 3 mocked unit tests | ✓ VERIFIED | Re-ran independently: 3/3 pass |
| `packages/database/src/__tests__/integration/agents.integration.test.ts` | 3 real-Postgres integration tests, `describeOrSkip`/`TEST_DATABASE_URL`-gated | ✓ VERIFIED | Re-ran independently against a fresh scratch container: 3/3 pass, not skipped |
| `packages/database/src/__tests__/integration/migration-0012.test.ts` | 5 file-content assertions | ✓ VERIFIED | Re-ran independently: 5/5 pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `runMigrations()` (`migrate.ts`, unmodified) | migration 0012 | Existing `_schema_lock` row-lock transaction mechanism | ✓ WIRED | No changes to `migrate.ts`; migration 0012 applies inside the same existing mechanism — confirmed by independent from-scratch re-run |
| `getAgentConnection()` | `agents` table | `eq(agents.name, name)` Drizzle query | ✓ WIRED | Confirmed via source read + real-DB integration test results (correct row returned/rejected per fixture) |
| `index.ts` | `agents.ts` | barrel re-export | ✓ WIRED | `export { getAgentConnection } from './agents.js';` present and functional (imported successfully by test files) |
| `BrainRunner.init()` (Phase 6, unmodified) | `runMigrations()` | Existing boot sequence | ✓ WIRED | No `runner.ts` changes were needed or made — confirmed via `git show --stat` on phase 34 commits (only `packages/database/*` and `.planning/*` files touched) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration 0012 applies against fresh Postgres 17 | `bun src/migrate.ts` (independent scratch container, port 5435) | Exit 0, "Migrations completed successfully" | ✓ PASS |
| `agents` table has all 6 columns | `psql "$DATABASE_URL" -c '\d agents'` | name, brain_type, connection_string, enabled, created_at, updated_at all present | ✓ PASS |
| `leads.handoff_context` column present | `psql "$DATABASE_URL" -c '\d leads'` | `handoff_context \| text` present, nullable | ✓ PASS |
| `dblink` extension installed | `psql -c "SELECT extname FROM pg_extension WHERE extname='dblink'"` | 1 row returned | ✓ PASS |
| Unit tests for `getAgentConnection` | `bun test src/__tests__/unit/agents.test.ts` | 3 pass / 0 fail | ✓ PASS |
| Integration tests (real DB) | `TEST_DATABASE_URL=... bun test src/__tests__/integration` | 22 pass / 0 fail (46 expect calls) | ✓ PASS |
| Migration content test | `bun test src/__tests__/integration/migration-0012.test.ts` | 5 pass / 0 fail | ✓ PASS |
| Full `packages/database` scoped suite | `bun test` (no `TEST_DATABASE_URL`) | 105 pass / 0 fail / 8 skip (113 total) | ✓ PASS — matches SUMMARY claim exactly |

All spot-checks were re-run independently in this verification session (fresh Docker container, not reusing any container from the execution session), not merely re-quoted from SUMMARY.md.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| HANDOFF-01 | 34-01 | `agents` table, SQL-editable destination registry | ✓ SATISFIED | Schema + migration + real-DB confirmation |
| HANDOFF-02 | 34-01 | `dblink` extension auto-bootstrap | ✓ SATISFIED | Migration statement + real-DB confirmation |
| HANDOFF-04 | 34-02 | `getAgentConnection()` three-way lookup contract | ✓ SATISFIED | Unit + integration tests, independently re-run |
| HANDOFF-10 | 34-02 | `thread_id` from execution context only | ✓ SATISFIED (documented constraint, N/A in code by design) | CONTEXT.md D-08, PLAN must_haves, SUMMARY coverage table — carried forward for Phase 35, not silently dropped |

No orphaned requirements: `.planning/REQUIREMENTS.md` maps exactly HANDOFF-01/02/04/10 to Phase 34 (lines 57-60), matching the union of both plans' frontmatter `requirements` fields.

### Anti-Patterns Found

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any file created/modified by this phase (`agents.ts`, `tables.ts`, `index.ts`, the migration SQL, or the three new test files). No empty-implementation stubs, no hardcoded-empty-data patterns, no console.log-only implementations. This is a backend-only schema/lookup phase with no UI surface, consistent with the phase's stated scope.

One pre-existing test-infrastructure item was correctly identified and NOT auto-fixed (out of scope per the Scope Boundary rule): `pool-manager.test.ts`'s global `mock.module('postgres', ...)` pollutes the full unscoped `packages/database bun test` run, causing `seed-idempotency.test.ts` to fail when the whole suite runs in one process. Confirmed pre-existing (reproduces on unmodified master before this phase's changes) and correctly documented in a new pending todo + `WINDOWS.md` entry rather than silently ignored or masked.

### Attribution Check: `@brain-pkg/observability` Test Failure (Independently Verified)

The user flagged a monorepo-wide `npm test` failure in `@brain-pkg/observability` and asked for independent (not take-on-faith) confirmation that it is unrelated to Phase 34.

**Findings:**
- `git show --stat` on all three Phase 34 commits (`4d57f34`, `c24e041`, `4bc6ca4`) confirms they touch exclusively `packages/database/*` and `.planning/*` files — zero overlap with `packages/observability`.
- `git log -- packages/observability` shows the last commits touching that package predate Phase 34 by weeks (`b11e370`, `d40558e`, from the LOG_LEVEL/health-check work), confirming no Phase 34 code ever touched this package.
- Independently ran `bun test` inside `packages/observability` (isolated from any Phase 34 changes) and reproduced 4 failures in `health-transport.test.ts` (`expect(result.status).toBe('degraded')` receiving `'error'` instead, etc.) — this is the exact symptom already described in the pre-existing, dated `.planning/todos/pending/2026-07-02-fix-cross-test-mock-module-pollution-in-full-suite-runs.md` (created 2026-07-02, over a month before Phase 34, and explicitly confirmed there as reproducing "on both a clean pre-phase-32 checkout and current master").
- Root cause matches exactly: `server.test.ts`'s `mock.module('./health.js', ...)` leaking into `health-transport.test.ts` in the same `bun test` worker process — a known, already-tracked, pre-existing bug class (same as the `pool-manager.test.ts` issue discovered during Phase 34 execution, and the `D-13` fix applied to `brain-runner.test.ts`/`factory.test.ts` in Phase 32).

**Conclusion:** Independently confirmed — this is NOT a Phase 34 regression. It is the pre-existing, already-tracked cross-test `mock.module()` pollution bug, unrelated in both git history and root cause to any file this phase touched.

### Human Verification Required

None. All must-haves are verified programmatically with independent, freshly-provisioned Postgres re-runs (not merely re-quoting SUMMARY.md claims).

### Gaps Summary

No gaps found. All 4 roadmap Success Criteria are met:

1. `agents` table schema — present, correct, SQL-editable, confirmed against real Postgres.
2. `dblink` extension bootstrap — present in shared migration, confirmed automatic (no manual step) against real Postgres.
3. `getAgentConnection()` three-way lookup contract — implemented, unit + integration tested, independently re-verified against real Postgres.
4. HANDOFF-10 (`thread_id` context-only constraint) — correctly has no code to exercise in this phase by design (D-08); the constraint is explicitly and durably documented (not silently dropped) for Phase 35 to inherit and apply the same `config.configurable.thread_id` pattern already proven in `pause-session.ts`/`finish-conversation.ts`.

The `@brain-pkg/observability` test failure visible in a monorepo-wide `npm test` run was independently investigated and confirmed to be an unrelated, pre-existing, already-tracked bug with zero git-history or code overlap with Phase 34's changes.

One minor, non-blocking code-review finding (WR-01 in `34-REVIEW.md`) notes that the mocked unit test for `getAgentConnection()` doesn't itself assert the `where()` predicate is name-aware, and no CI workflow currently sets `TEST_DATABASE_URL` to run the integration suite automatically. This does not block the phase — the real-Postgres integration tests (which DO exercise the actual filter-by-name behavior) were independently re-run in this verification and passed cleanly — but it's worth carrying forward as a testing-hygiene note, consistent with how `34-REVIEW.md` already flagged it.

---

_Verified: 2026-08-14T02:15:00Z_
_Verifier: Claude (gsd-verifier)_
