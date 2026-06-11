---
phase: 2
slug: domain-packages
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Jest-compatible API) |
| **Config file** | none — native Bun test runner, no config needed |
| **Quick run command** | `bun test packages/memory packages/ai packages/transport` |
| **Full suite command** | `pnpm test` (Turborepo runs all packages) |
| **Estimated runtime** | ~5–10 seconds (unit); ~20–30 seconds (integration with PG) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/{package-under-change}`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-00-01 | 00 | 0 | setup | — | N/A | setup | `psql -c "\\l" \| grep brain_test` | ✅ W0 | ⬜ pending |
| 2-01-01 | 01 | 1 | AI-01 | T-2-01 | PostgresSaver only; MemorySaver prohibited in non-unit | integration | `bun test packages/ai --filter "PostgresSaver"` | ✅ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | AI-02 | — | N/A | unit | `bun test packages/ai --filter "subgraph"` | ✅ W0 | ⬜ pending |
| 2-01-03 | 01 | 1 | AI-03 | T-2-02 | No Set/Map/Date/Buffer in state schema | unit | `bun test packages/ai --filter "state-schema"` | ✅ W0 | ⬜ pending |
| 2-01-04 | 01 | 1 | AI-04 | T-2-03 | EMBEDDING_MODEL/DIMENSIONS from env only | unit | `bun test packages/ai --filter "embedding"` | ✅ W0 | ⬜ pending |
| 2-01-05 | 01 | 1 | AI-05 | T-2-04 | ConfigurationError if LLM_PROVIDER absent | unit | `bun test packages/ai --filter "llm-factory"` | ✅ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | MEM-01 | — | N/A | integration | `bun test packages/memory --filter "short-term"` | ✅ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | MEM-02 | T-2-05 | No PII leakage in memory writes | integration | `bun test packages/memory --filter "long-term"` | ✅ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | MEM-03 | — | fire-and-forget; no await blocking | integration | `bun test packages/memory --filter "semantic"` | ✅ W0 | ⬜ pending |
| 2-02-04 | 02 | 1 | MEM-04 | — | N/A | integration | `bun test packages/memory --filter "MemoryManager"` | ✅ W0 | ⬜ pending |
| 2-03-01 | 03 | 1 | TRANS-01 | — | N/A | unit | `bun test packages/transport --filter "ITransport"` | ✅ W0 | ⬜ pending |
| 2-03-02 | 03 | 1 | TRANS-02 | T-2-06 | Validate Content-Type; reject malformed JSON | integration | `bun test packages/transport --filter "webhook"` | ✅ W0 | ⬜ pending |
| 2-03-03 | 03 | 1 | TRANS-03 | T-2-07 | Idempotency key prevents replay attacks | integration | `bun test packages/transport --filter "idempotency"` | ✅ W0 | ⬜ pending |
| 2-03-04 | 03 | 1 | TRANS-04 | — | ConfigurationError if TRANSPORT unknown | unit | `bun test packages/transport --filter "transport-factory"` | ✅ W0 | ⬜ pending |
| 2-04-01 | 04 | 2 | OBS-03 | T-2-08 | No secrets in Langfuse trace payloads | integration | `bun test packages/ai --filter "langfuse"` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/ai/src/graph.test.ts` — stubs for AI-01, AI-02, AI-03, AI-04, AI-05
- [ ] `packages/ai/src/llm-factory.test.ts` — stubs for AI-05
- [ ] `packages/memory/src/memory-manager.test.ts` — stubs for MEM-01 through MEM-04
- [ ] `packages/transport/src/webhook.test.ts` — stubs for TRANS-02, TRANS-03
- [ ] `packages/transport/src/transport-factory.test.ts` — stubs for TRANS-01, TRANS-04
- [ ] `scripts/setup-test-db.sh` — create `brain_test`, enable pgvector, apply Phase 1 migration

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Langfuse traces visible in dashboard | OBS-03 / SC-4 | Requires live Langfuse account + network | Set LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY, run integration test, check Langfuse UI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
