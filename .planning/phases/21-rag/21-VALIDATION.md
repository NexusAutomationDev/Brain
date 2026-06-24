---
phase: 21
slug: rag
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-24
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
| 21-W0-01 | Wave 0 | 0 | RAG-01, RAG-04 | T-D-13 | 401 sem token; 503 sem INGEST_TOKEN | unit | `bun test packages/core/src/rag/__tests__/ingest.test.ts` | ❌ W0 | ⬜ pending |
| 21-W0-02 | Wave 0 | 0 | D-02 | — | N/A | unit | `bun test packages/core/src/rag/__tests__/chunker.test.ts` | ❌ W0 | ⬜ pending |
| 21-W0-03 | Wave 0 | 0 | RAG-02, RAG-03 | — | N/A | unit | `bun test packages/core/src/rag/__tests__/search.test.ts` | ❌ W0 | ⬜ pending |
| 21-W0-04 | Wave 0 | 0 | RAG-02, RAG-03, D-11 | — | N/A | unit | `bun test packages/core/src/tools/__tests__/search-knowledge.test.ts` | ❌ W0 | ⬜ pending |
| 21-W0-05 | Wave 0 | 0 | D-17 | — | N/A | unit | `bun test packages/ai/src/embeddings/__tests__/factory.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/rag/__tests__/ingest.test.ts` — stubs para RAG-01, RAG-04
- [ ] `packages/core/src/rag/__tests__/chunker.test.ts` — stubs para D-02
- [ ] `packages/core/src/rag/__tests__/search.test.ts` — stubs para RAG-02, RAG-03
- [ ] `packages/core/src/tools/__tests__/search-knowledge.test.ts` — stubs para RAG-02, RAG-03, D-11
- [ ] `packages/ai/src/embeddings/__tests__/factory.test.ts` — stubs para D-17 (defaults por provider)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST /api/v1/ingest integrado com brain-sdr em execução | RAG-01 | Requer Brain rodando com DB real e INGEST_TOKEN configurado | Subir brain-sdr, chamar POST /api/v1/ingest com Bearer token válido, verificar registro no banco |
| search_knowledge retorna resultados ordenados por score cosine real | RAG-02, RAG-03 | Requer pgvector com dados reais e embedding model configurado | Ingerir textos, chamar tool via LangGraph, verificar ordenação por score |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
