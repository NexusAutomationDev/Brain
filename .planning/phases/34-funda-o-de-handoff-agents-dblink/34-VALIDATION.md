---
phase: 34
slug: funda-o-de-handoff-agents-dblink
status: draft
nyquist_compliant: false
wave_0_complete: false
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
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

To be populated with concrete Task IDs once `gsd-planner` assigns them in PLAN.md. In the interim, RESEARCH.md's "Phase Requirements → Test Map" gives the requirement-level mapping:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | HANDOFF-01 | — | `agents` table has correct columns/PK/defaults | integration | `bun test src/__tests__/integration/migration-0012.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | HANDOFF-02 | — | Migration file contains `CREATE EXTENSION IF NOT EXISTS dblink` | integration | `bun test src/__tests__/integration/migration-0012.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | HANDOFF-04 | — | `getAgentConnection()` returns correct not_found/disabled/ok results | unit | `bun test src/__tests__/unit/agents.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | HANDOFF-04 | — | `getAgentConnection()` against a real inserted/disabled/missing row | integration | `bun test src/__tests__/integration/agents.integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/database/src/__tests__/unit/agents.test.ts` — covers HANDOFF-04 (mocked `sql`)
- [ ] `packages/database/src/__tests__/integration/agents.integration.test.ts` — covers HANDOFF-04 (real DB, `TEST_DATABASE_URL`-gated)
- [ ] `packages/database/src/__tests__/integration/migration-0012.test.ts` — covers HANDOFF-01/HANDOFF-02 (file-content assertions, mirrors `migration-v14.test.ts`; no live DB needed)
- [ ] Framework install: none — `bun:test` already configured, no new setup needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `thread_id` resolution pattern documented and carried forward | HANDOFF-10 | No code in this phase consumes `thread_id` (no tool exists yet — that's Phase 35, per D-08); this phase only needs to document the constraint for Phase 35 to inherit | Confirm PLAN.md/RESEARCH.md for Phase 34 explicitly documents the `pause-session.ts`/`finish-conversation.ts` `config.configurable.thread_id` pattern as a locked constraint for Phase 35 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
