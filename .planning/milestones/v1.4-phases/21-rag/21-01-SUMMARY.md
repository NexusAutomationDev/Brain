---
phase: 21-rag
plan: "01"
subsystem: embeddings, rag-test-infrastructure
tags: [tdd, embeddings, rag, wave-0, nyquist, d-17, d-14]
dependency_graph:
  requires: []
  provides:
    - "DEFAULT_MODELS lookup in createEmbeddings() (D-17)"
    - "Wave 0 RED stubs: ingest.test.ts, chunker.test.ts, search.test.ts, search-knowledge.test.ts"
    - "factory.test.ts relocated to __tests__/ with D-14/D-17 tests"
  affects:
    - "packages/ai — factory.ts no longer throws ConfigurationError when EMBEDDING_MODEL absent"
    - "packages/core — 4 new test stub files covering RAG-01..RAG-04, D-02, D-11"
tech_stack:
  patterns:
    - "DEFAULT_MODELS record lookup: provider → default model string"
    - "Wave 0 / Nyquist: test stubs committed RED before implementation"
    - "mock.module() before import pattern (bun:test)"
    - "CLAUDE.md convention: test files relocated to __tests__/ subdirectory"
key_files:
  created:
    - packages/ai/src/embeddings/__tests__/factory.test.ts
    - packages/core/src/rag/__tests__/ingest.test.ts
    - packages/core/src/rag/__tests__/chunker.test.ts
    - packages/core/src/rag/__tests__/search.test.ts
    - packages/core/src/tools/__tests__/search-knowledge.test.ts
  modified:
    - packages/ai/src/embeddings/factory.ts
    - .planning/phases/21-rag/21-VALIDATION.md
  deleted:
    - packages/ai/src/embeddings/factory.test.ts (relocated to __tests__/)
decisions:
  - "D-17 implementado: EMBEDDING_MODEL opcional com DEFAULT_MODELS por provider (openai/openrouter→text-embedding-3-small, gemini→text-embedding-004)"
  - "factory.test.ts movido de embeddings/ para embeddings/__tests__/ para conformidade com CLAUDE.md"
  - "Wave 0 stubs em estado RED confirmado — 4 arquivos com 'Cannot find module'"
metrics:
  duration: "~20 min"
  completed: "2026-06-24T19:44:14Z"
  tasks_completed: 2
  files_changed: 7
requirements:
  - RAG-01
  - RAG-02
  - RAG-03
  - RAG-04
---

# Phase 21 Plan 01: Wave 0 Stubs + D-17 createEmbeddings Defaults Summary

**One-liner:** 4 RED test stubs para RAG (ingest/chunker/search/search-knowledge) + D-17 DEFAULT_MODELS por provider em createEmbeddings() sem throw.

## What Was Built

### Task 1 — Wave 0 RED Stubs (Nyquist compliance)

Criados 4 arquivos de test stub em `packages/core/src/rag/__tests__/` e `packages/core/src/tools/__tests__/`:

- **ingest.test.ts**: 12 casos cobrindo RAG-01 (auth 401/503/400/200), RAG-04 (INSERT com embeddingModel/chunkIndex/totalChunks), D-03 (ordem DELETE→INSERT)
- **chunker.test.ts**: 7 casos cobrindo D-01/D-02 (texto curto → 1 chunk, texto longo → múltiplos chunks, cada chunk ≤1000 chars, overlap entre consecutivos)
- **search.test.ts**: 8 casos cobrindo RAG-02/RAG-03 (inArray collections), D-03a (eq embeddingModel), D-08 (gt threshold), D-07 (limit 5)
- **search-knowledge.test.ts**: 8 casos cobrindo RAG-02 ([Coleção: X] format), D-11 (string vazia quando sem resultados), RAG-03 (múltiplas collections), Zod min(1)

Todos os 4 arquivos em estado RED confirmado (`Cannot find module` — implementações ainda não existem).

### Task 2 — D-17: createEmbeddings() com defaults por provider (RED→GREEN)

**factory.ts modificado:**
- Adicionado `DEFAULT_MODELS: Record<string, string>` com `openai: "text-embedding-3-small"`, `openrouter: "text-embedding-3-small"`, `gemini: "text-embedding-004"`
- Removido `throw new ConfigurationError("EMBEDDING_MODEL env var is required", ...)`
- `EMBEDDING_MODEL` agora é opcional — resolvido via `process.env.EMBEDDING_MODEL ?? DEFAULT_MODELS[provider] ?? "text-embedding-3-small"`
- Removido import de `ConfigurationError` de `@brain-pkg/shared` (não mais utilizado)

**factory.test.ts:**
- Removidos 2 testes que verificavam o throw de ConfigurationError
- Adicionados 6 novos testes em `describe("D-14/D-17: defaults de modelo por provider")`
- Arquivo relocado de `embeddings/factory.test.ts` para `embeddings/__tests__/factory.test.ts` (conformidade CLAUDE.md)
- 8 testes passando, 0 falhas

**21-VALIDATION.md:** `wave_0_complete: true` setado.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | f871bdb | ✅ test(21-rag): add Wave 0 RED stubs for RAG ingest, chunker, search and search-knowledge tool |
| 2 | b503f05 | ✨ feat(21-rag): implement D-17 createEmbeddings() defaults per provider, move test to __tests__/ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Convention] factory.test.ts relocado para __tests__/**
- **Found during:** Task 2
- **Issue:** O arquivo `packages/ai/src/embeddings/factory.test.ts` existia fora de `__tests__/`, violando a convenção obrigatória do CLAUDE.md ("Arquivos de teste usam o sufixo `.test.ts` — Nunca criar arquivos `*.test.ts` fora de `__tests__/`")
- **Fix:** Removido `factory.test.ts` da raiz de `embeddings/`, criado novo em `embeddings/__tests__/factory.test.ts` com import corrigido para `../factory.js`
- **Files modified:** `packages/ai/src/embeddings/__tests__/factory.test.ts` (novo), `packages/ai/src/embeddings/factory.test.ts` (removido)
- **Commit:** b503f05

**2. [Rule 1 - Bug] Import path corrigido de `./factory.js` para `../factory.js`**
- **Found during:** Task 2 verification
- **Issue:** Arquivo em `__tests__/factory.test.ts` usava `import("./factory.js")` — caminho errado para módulo em diretório pai
- **Fix:** Corrigido para `import("../factory.js")`
- **Files modified:** `packages/ai/src/embeddings/__tests__/factory.test.ts`
- **Commit:** b503f05

## Known Stubs

Os 4 arquivos de test stub são stubs INTENCIONAIS (Wave 0 / Nyquist pattern) — representam o estado RED antes das implementações dos planos 02 e 03:

| Stub | File | Reason |
|------|------|--------|
| `createIngestApp` | `packages/core/src/rag/__tests__/ingest.test.ts` | Implementado no plano 21-02 |
| `splitText` | `packages/core/src/rag/__tests__/chunker.test.ts` | Implementado no plano 21-02 |
| `searchKnowledge` | `packages/core/src/rag/__tests__/search.test.ts` | Implementado no plano 21-02 |
| `createSearchKnowledgeTool` | `packages/core/src/tools/__tests__/search-knowledge.test.ts` | Implementado no plano 21-03 |

Estes stubs são o objetivo do plano 01 — sem eles os planos posteriores não têm cobertura de teste.

## Threat Surface Scan

Nenhuma nova superfície de segurança introduzida. A mudança no `factory.ts` remove um throw e adiciona defaults hardcoded não-secretos (T-21-01-02: accepted). API_KEY continua não logada (T-21-01-01: mitigated, comentário preservado).

## Self-Check: PASSED
