---
phase: 21
slug: rag
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
validated: 2026-06-24
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.3.2) |
| **Config file** | none — `bun test` via scripts em `package.json` |
| **Quick run command** | `bun test packages/core/src/rag/ packages/core/src/tools/__tests__/search-knowledge.test.ts` |
| **Full suite command** | `bun test packages/core/src` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/rag/ packages/core/src/tools/__tests__/search-knowledge.test.ts`
- **After every plan wave:** Run `bun test packages/core/src`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-W0-01 | Wave 0 | 0 | RAG-01, RAG-04 | T-D-13 | 401 sem token; 503 sem INGEST_TOKEN | unit | `bun test packages/core/src/rag/__tests__/ingest.test.ts` | ✅ | ✅ green |
| 21-W0-02 | Wave 0 | 0 | D-02 | — | N/A | unit | `bun test packages/core/src/rag/__tests__/chunker.test.ts` | ✅ | ✅ green |
| 21-W0-03 | Wave 0 | 0 | RAG-02, RAG-03 | — | N/A | unit | `bun test packages/core/src/rag/__tests__/search.test.ts` | ✅ | ✅ green |
| 21-W0-04 | Wave 0 | 0 | RAG-02, RAG-03, D-11 | — | N/A | unit | `bun test packages/core/src/tools/__tests__/search-knowledge.test.ts` | ✅ | ✅ green |
| 21-W0-05 | Wave 0 | 0 | D-14, D-17 | — | N/A | unit | `bun test packages/ai/src/embeddings/__tests__/factory.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/core/src/rag/__tests__/ingest.test.ts` — RAG-01, RAG-04 ✅
- [x] `packages/core/src/rag/__tests__/chunker.test.ts` — D-02 ✅
- [x] `packages/core/src/rag/__tests__/search.test.ts` — RAG-02, RAG-03 ✅
- [x] `packages/core/src/tools/__tests__/search-knowledge.test.ts` — RAG-02, RAG-03, D-11 ✅
- [x] `packages/ai/src/embeddings/__tests__/factory.test.ts` — D-14, D-17 ✅

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST /api/v1/ingest integrado com brain-sdr em execução | RAG-01 | Requer Brain rodando com DB real e INGEST_TOKEN configurado | Subir brain-sdr, chamar POST /api/v1/ingest com Bearer token válido, verificar registro no banco |
| search_knowledge retorna resultados ordenados por score cosine real | RAG-02, RAG-03 | Requer pgvector com dados reais e embedding model configurado | Ingerir textos, chamar tool via LangGraph, verificar ordenação por score |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s (observed: ~750ms for full suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-24

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 11 (batch isolation failures) |
| Resolved | 11 |
| Escalated | 0 |

**Root cause:** Bun 1.3.2 shares module registry across test files in a single `bun test` invocation. Three fixes applied:
1. `createSearchKnowledgeTool` — added optional `searchFn` DI param; removed `mock.module("search.js")` cross-contamination
2. `factory.ts` — exported `resolveEmbeddingModel` and `parseDimensions` for mock-free unit testing of D-14/D-17/D-06
3. `factory.test.ts` — assertions now test exported pure functions instead of inspecting mock instance internals

All 45 tests green in batch mode. Run command: `bun test packages/core/src/rag/__tests__/ingest.test.ts packages/core/src/rag/__tests__/chunker.test.ts packages/core/src/rag/__tests__/search.test.ts packages/core/src/tools/__tests__/search-knowledge.test.ts packages/ai/src/embeddings/__tests__/factory.test.ts`
