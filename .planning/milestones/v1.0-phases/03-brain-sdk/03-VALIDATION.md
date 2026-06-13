---
phase: 3
slug: brain-sdk
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-12
audited: 2026-06-13
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
| 3-01-01 | 01 | 1 | SDK-01 | — | IBrain contract enforced at compile time | unit | `bun test packages/core/src/brain/__tests__/brain-registry.test.ts` | ✅ | ✅ green |
| 3-01-02 | 01 | 1 | SDK-01 | — | BrainRegistry resolves registered brain by ID | unit | `bun test packages/core/src/brain/__tests__/brain-registry.test.ts` | ✅ | ✅ green |
| 3-02-01 | 02 | 2 | SDK-02 | — | BrainRunner.run() returns reply string | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |
| 3-02-02 | 02 | 2 | SDK-02 | — | No MemorySaver in call path | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |
| 3-03-01 | 03 | 2 | SDK-03 | — | ToolsRegistry blocks disallowed brainType | unit | `bun test packages/core/src/tools/__tests__/tools-registry.test.ts` | ✅ | ✅ green |
| 3-04-01 | 04 | 1 | SDK-04 | — | prompts table schema (brainType+key unique, all columns NOT NULL) | unit | `bun test packages/database/src/schema/tables.test.ts` | ✅ | ✅ green |
| 3-04-02 | 04 | 3 | SDK-04 | T-3-04-01 T-3-04-02 | POST /reload-prompts: 401 / 200 / 503 auth behaviors | unit | `bun test packages/core/src/__tests__/server.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/core/src/brain/__tests__/brain-registry.test.ts` — SDK-01 BrainRegistry
- [x] `packages/core/src/runner/__tests__/brain-runner.test.ts` — SDK-02 BrainRunner
- [x] `packages/core/src/tools/__tests__/tools-registry.test.ts` — SDK-03 ToolsRegistry
- [x] `packages/core/src/prompts/__tests__/loader.test.ts` — SDK-04 loadPrompts
- [x] `packages/database/src/schema/tables.test.ts` — SDK-04 prompts schema
- [x] `packages/core/src/__tests__/server.test.ts` — SDK-04 /reload-prompts auth

*All wave 0 requirements fulfilled.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST /reload-prompts recarrega prompts sem restart | SDK-02 | Requer container rodando com banco real | 1. Start container; 2. UPDATE prompts SET content='new' WHERE key='system'; 3. POST /reload-prompts; 4. Send message and verify new prompt used |

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all requirements
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ 2026-06-13

---

## Validation Audit 2026-06-13

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |
