---
phase: 34
slug: funda-o-de-handoff-agents-dblink
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-13
---

# Phase 34 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (Bun 1.3.2, built-in, Jest-compatible API) |
| **Config file** | none — Bun's test runner needs no config file |
| **Quick run command** | `cd packages/database && bun test src/__tests__/unit/agents.test.ts` |
| **Full suite command** | `cd packages/database && bun test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/database && bun test src/__tests__/unit/agents.test.ts`
- **After every plan wave:** Run `cd packages/database && bun test` (full suite, includes integration tests when `TEST_DATABASE_URL` is set)
- **Before `/gsd-verify-work`:** Full suite must be green (or integration tests explicitly, gracefully skipped with `TEST_DATABASE_URL` unset — documented, not a silent gap)
- **Max feedback latency:** 10 seconds for all task-level test runs, **with one documented exception:** 34-01-02 and 34-02-02 each provision a scratch `pgvector/pgvector:pg17` Docker container (poll-wait for `pg_isready`, run `drizzle-kit generate`/`bun src/migrate.ts`, then a full test pass) before tearing it down — these two tasks are expected to take **30-90 seconds**, not 10s, because they deliberately prove the migration against a real, freshly-provisioned Postgres instance rather than a mock. This is inherent to closing Phase 33's "no real test DB" gap, not a regression.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 34-01-01 | 01 | 1 | — (checkpoint:decision) | — | Reversibility gate confirms D-01 (costly)/D-04 (one-way) shape before migration 0012 is generated/applied | manual | N/A — `checkpoint:decision`, human resume-signal ("option-a"/"option-b") | N/A | ⬜ pending |
| 34-01-02 | 01 | 1 | HANDOFF-01, HANDOFF-02 | T-34-01, T-34-02, T-34-03 | Migration 0012 (`agents` table + `leads.handoff_context` + `CREATE EXTENSION IF NOT EXISTS dblink`) applies against a real, freshly-provisioned Postgres 17 and is confirmed via `psql` | integration | see task's `<automated>` block (provisions `brain-phase34-test-pg`, runs `drizzle-kit generate` + `bun src/migrate.ts`, `psql` assertions, tears down) | ❌ W0 | ⬜ pending |
| 34-02-01 | 02 | 2 | HANDOFF-04 | T-34-04, T-34-05 | `getAgentConnection()` returns correct not_found/disabled/ok results; never logs the full row/result | unit | `bun test src/__tests__/unit/agents.test.ts` | ❌ W0 | ⬜ pending |
| 34-02-02 | 02 | 2 | HANDOFF-01, HANDOFF-02, HANDOFF-04 | — | Full suite (incl. `agents.integration.test.ts` + `migration-0012.test.ts`) passes with 0 skips against a real, independently-provisioned Postgres 17 | integration | see task's `<automated>` block (provisions `brain-phase34-test-pg`, runs `bun src/migrate.ts`, `TEST_DATABASE_URL=... bun test`, tears down) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/database/src/__tests__/unit/agents.test.ts` — covers HANDOFF-04 (mocked `sql`) — created by 34-02-01, not a separate pre-task gap
- [x] `packages/database/src/__tests__/integration/agents.integration.test.ts` — covers HANDOFF-04 (real DB, `TEST_DATABASE_URL`-gated) — created by 34-02-02
- [x] `packages/database/src/__tests__/integration/migration-0012.test.ts` — covers HANDOFF-01/HANDOFF-02 (file-content assertions, mirrors `migration-v14.test.ts`; no live DB needed) — created by 34-02-02
- [x] Framework install: none — `bun:test` already configured, no new setup needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `thread_id` resolution pattern documented and carried forward | HANDOFF-10 | No code in this phase consumes `thread_id` (no tool exists yet — that's Phase 35, per D-08); this phase only needs to document the constraint for Phase 35 to inherit | Confirm PLAN.md/RESEARCH.md for Phase 34 explicitly documents the `pause-session.ts`/`finish-conversation.ts` `config.configurable.thread_id` pattern as a locked constraint for Phase 35 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (34-01-01 is `checkpoint:decision`, exempt by type; the other 3 tasks all have `<automated>`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (only 1 checkpoint task total, not 3 consecutive)
- [x] Wave 0 covers all MISSING references (all 3 new test files are created by the plan's own tasks, not left as separate gaps)
- [x] No watch-mode flags
- [x] Feedback latency < 10s for all tasks except the two documented real-Postgres provisioning tasks (34-01-02, 34-02-02: 30-90s, see Sampling Rate)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
