---
phase: 21-rag
plan: "02"
subsystem: rag
tags: [tdd, rag, wave-2, green, chunker, search, ingest, hono, drizzle, pgvector]
dependency_graph:
  requires:
    - "21-01: Wave 0 RED stubs + D-17 createEmbeddings() defaults"
  provides:
    - "packages/core/src/rag/chunker.ts: splitText() recursive character split (D-01/D-02)"
    - "packages/core/src/rag/search.ts: searchKnowledge() cosine similarity + resolveEmbeddingModel() (RAG-02/RAG-03/D-03a/D-07/D-08)"
    - "packages/core/src/rag/ingest.ts: createIngestApp(sql) Hono POST /api/v1/ingest (RAG-01/D-03/D-13/RAG-04)"
    - "packages/core/src/rag/index.ts: barrel export do módulo rag/"
  affects:
    - "packages/core — RAG module completo disponível via @brain-pkg/core (import from 'rag/')"
tech_stack:
  added: []
  patterns:
    - "Recursive character text split: própria implementação sem @langchain/textsplitters (não instalado)"
    - "cosineDistance drizzle-orm: 1 - (cosineDistance(col, vec)) via sql<number> template"
    - "inArray + eq WHERE combinados: multi-collection + model filter"
    - "Bearer token auth: startsWith('Bearer ') + slice(7) — rejeita token sem prefixo"
    - "Fail-closed 503: INGEST_TOKEN ausente → 503 antes de checar auth"
    - "DELETE before INSERT: D-03 re-ingest pattern com dois filtros obrigatórios"
key_files:
  created:
    - packages/core/src/rag/chunker.ts
    - packages/core/src/rag/search.ts
    - packages/core/src/rag/ingest.ts
    - packages/core/src/rag/index.ts
  modified:
    - packages/core/src/rag/__tests__/chunker.test.ts (bug fix: async/await adicionado)
decisions:
  - "Implementação própria de RecursiveCharacterTextSplitter sem @langchain/textsplitters — pacote não instalado; fallback próprio com comportamento equivalente"
  - "Bearer token check usa startsWith('Bearer ') + slice(7) em vez de .replace('Bearer ', '') — garante rejeição de token direto sem prefixo"
metrics:
  duration: "~25 min"
  completed: "2026-06-24T19:52:30Z"
  tasks_completed: 2
  files_changed: 5
requirements:
  - RAG-01
  - RAG-02
  - RAG-03
  - RAG-04
---

# Phase 21 Plan 02: RAG Core Implementation — chunker.ts, search.ts, ingest.ts Summary

**One-liner:** RAG core implementado com split recursivo próprio (1000/200 chars), cosine search multi-coleção com filtro por embeddingModel, e endpoint POST /api/v1/ingest com Bearer auth fail-closed e DELETE+INSERT batch.

## What Was Built

Todos os 3 arquivos de implementação do núcleo RAG foram criados, tornando GREEN os 27 testes RED criados no Plano 01:

### chunker.ts (D-01/D-02)
- `splitText(text): Promise<string[]>` — implementação recursiva própria (sem `@langchain/textsplitters`)
- Separadores: `["\n\n", "\n", " ", ""]` — prioridade parágrafo → linha → espaço → chars
- CHUNK_SIZE=1000, CHUNK_OVERLAP=200 hardcoded (YAGNI — sem ENV)
- Retorna array vazio para texto vazio; array com 1 elemento para texto <= 1000 chars

### search.ts (RAG-02/RAG-03/D-03a/D-07/D-08)
- `searchKnowledge(db, queryVector, collections, embeddingModel, topK=5, threshold=0.5): Promise<ChunkResult[]>`
- Cosine similarity via `1 - (cosineDistance(col, vec))` — padrão de `packages/memory/src/semantic.ts`
- WHERE: `inArray(collection, collections) AND eq(embeddingModel, model) AND gt(similarity, 0.5)`
- Guard: `collections.length === 0 → return []` (T-21-02-06)
- `resolveEmbeddingModel()`: EMBEDDING_MODEL ENV → default por LLM_PROVIDER
- Interface `ChunkResult` exportada para uso em tools

### ingest.ts (RAG-01/D-03/D-13/RAG-04)
- `createIngestApp(sql): Hono` — sub-app Hono com POST /api/v1/ingest
- Auth: 503 se INGEST_TOKEN ausente → 401 se Bearer inválido/ausente → 400 se body inválido
- D-03: DELETE WHERE (collection AND embeddingModel) antes do INSERT batch
- RAG-04: INSERT registra `embeddingModel`, `chunkIndex`, `totalChunks` não-nulos
- T-21-02-02: limite 1MB em body.text → 413 se excedido

### index.ts (barrel)
- Exporta `splitText`, `searchKnowledge`, `resolveEmbeddingModel`, `ChunkResult`, `createIngestApp`

## Test Results

```
bun test packages/core/src/rag/__tests__/
27 pass, 0 fail (chunker: 8, search: 8, ingest: 11)
```

Sem regressões em `packages/core/src/__tests__/` (57 pass, 0 fail).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] chunker.test.ts: testes chamavam splitText() sem await**
- **Found during:** Task 1 — testes retornavam Promise em vez de string[]
- **Issue:** Os testes do Wave 0 chamavam `splitText()` sincronamente mas a função é `async`
- **Fix:** Adicionado `async/await` em todos os 8 testes de chunker.test.ts
- **Files modified:** `packages/core/src/rag/__tests__/chunker.test.ts`
- **Commit:** 745dbea

**2. [Rule 1 - Bug] ingest.ts: Bearer token sem prefixo "Bearer " era aceito como válido**
- **Found during:** Task 2 — teste "retorna 401 sem o prefixo Bearer" falhava
- **Issue:** `authHeader?.replace("Bearer ", "")` retornava o token original quando o prefixo estava ausente, fazendo token direto passar autenticação
- **Fix:** Substituído por `authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null`
- **Files modified:** `packages/core/src/rag/ingest.ts`
- **Commit:** 3ae044d (incorporado antes do commit)

**3. [Rule 3 - Blocker] @langchain/textsplitters não instalado**
- **Found during:** Task 1 — pacote não presente em node_modules/@langchain/
- **Fix:** Usado fallback próprio de RecursiveCharacterTextSplitter conforme documentado no plano como alternativa válida
- **Files modified:** packages/core/src/rag/chunker.ts (implementação própria)

**4. [Rule 3 - Blocker] Worktree sem node_modules**
- **Found during:** Task 1 — `Cannot find package 'drizzle-orm'` nos testes
- **Fix:** Criados symlinks de node_modules dos pacotes do projeto principal para o worktree
- **Impact:** Nenhum arquivo de código alterado — apenas infraestrutura de test runner

## Known Stubs

Nenhum stub no código de produção deste plano. Todos os campos são populados com dados reais.

## Threat Flags

Nenhuma nova superfície de ameaça além do já documentado no `<threat_model>` do plano.

## Self-Check: PASSED
