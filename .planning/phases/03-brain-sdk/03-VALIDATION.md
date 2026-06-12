---
phase: 3
slug: brain-sdk
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test |
| **Config file** | none — built-in |
| **Quick run command** | `bun test packages/core` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | SDK-01 | — | IBrain contract enforced at compile time | unit | `bun test packages/core --filter IBrain` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | SDK-01 | — | BrainRegistry resolves registered brain by ID | unit | `bun test packages/core --filter BrainRegistry` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 2 | SDK-02 | — | BrainRunner.run() returns reply string | unit | `bun test packages/core --filter BrainRunner` | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 2 | SDK-02 | — | No MemorySaver in call path | unit | `bun test packages/core --filter BrainRunner` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 2 | SDK-03 | — | ToolsRegistry blocks disallowed brainType | unit | `bun test packages/core --filter ToolsRegistry` | ❌ W0 | ⬜ pending |
| 3-04-01 | 04 | 1 | SDK-04 | — | prompts table migration applies cleanly | integration | `bun test packages/database` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/__tests__/brain-registry.test.ts` — stubs for SDK-01
- [ ] `packages/core/src/__tests__/brain-runner.test.ts` — stubs for SDK-02
- [ ] `packages/core/src/__tests__/tools-registry.test.ts` — stubs for SDK-03
- [ ] `packages/database/src/__tests__/prompts-migration.test.ts` — stubs for SDK-04

*Existing bun test infrastructure in workspace covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST /reload-prompts recarrega prompts sem restart | SDK-02 | Requer container rodando com banco real | 1. Start container; 2. UPDATE prompts SET content='new' WHERE key='system'; 3. POST /reload-prompts; 4. Send message and verify new prompt used |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
