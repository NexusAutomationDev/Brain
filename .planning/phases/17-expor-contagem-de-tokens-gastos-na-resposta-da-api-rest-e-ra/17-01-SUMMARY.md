---
phase: 17-expor-contagem-de-tokens-gastos-na-resposta-da-api-rest-e-ra
plan: "01"
subsystem: packages/ai, packages/shared
tags: [token-usage, langgraph, state, shared-types, tdd]
dependency_graph:
  requires: []
  provides:
    - TokenUsage type in @brain-pkg/shared
    - extractTokenUsage() helper in @brain-pkg/ai
    - BrainStateAnnotation.tokenUsage with sum reducer
  affects:
    - packages/ai/src/graph/state.ts
    - packages/ai/src/index.ts
    - packages/shared/src/types/index.ts
tech_stack:
  added: []
  patterns:
    - TDD (RED/GREEN) com bun test para todas as tasks
    - Annotation sum reducer pattern (distinto de last-write-wins)
    - Zero-default para campos opcionais de provider (D-05 anti-undefined)
key_files:
  created:
    - packages/ai/src/utils/token.ts
    - packages/ai/src/__tests__/unit/token.test.ts
    - packages/ai/src/__tests__/unit/state-token.test.ts
  modified:
    - packages/shared/src/types/index.ts
    - packages/ai/src/graph/state.ts
    - packages/ai/src/index.ts
    - packages/ai/src/graph/state.test.ts
    - packages/ai/package.json
decisions:
  - "LangGraph invoke({}) sem nenhum campo retorna undefined — mínimo de 1 campo obrigatório para activar defaults (documentado em TOK-03b)"
  - "mergeUsageMetadata() do LangChain não usado — opera em snake_case, projeto usa camelCase (D-04)"
metrics:
  duration: ~20 minutes
  completed_date: "2026-06-16"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 5
---

# Phase 17 Plan 01: TokenUsage type, extractTokenUsage helper e BrainStateAnnotation.tokenUsage com reducer de soma

**One-liner:** TokenUsage camelCase type em @brain-pkg/shared, helper extractTokenUsage com guard de undefined/null, e acumulador tokenUsage com reducer de soma no BrainStateAnnotation — base de dados para exposição de tokens em todas as waves.

## What Was Built

Wave 1 da Phase 17: os três artefatos fundamentais que todas as outras waves consomem.

1. **`TokenUsage` interface** em `packages/shared/src/types/index.ts` — campos `inputTokens`, `outputTokens`, `totalTokens` (camelCase, D-04). Adicionada após `BrainOutput` sem modificar nenhum export existente (D-01).

2. **`extractTokenUsage()` helper** em `packages/ai/src/utils/token.ts` — converte `AIMessage.usage_metadata` (snake_case do LangChain) para `TokenUsage` (camelCase do projeto). Retorna zeros explícitos quando `usage_metadata` é `undefined` ou `null` (D-05). Nunca retorna `undefined` — contrato previsível para a resposta HTTP.

3. **`BrainStateAnnotation.tokenUsage`** com reducer de soma em `packages/ai/src/graph/state.ts` — padrão distinto de `last-write-wins`: cada nó llm retorna um delta, o estado acumula todos os LLM calls do turno. Default zeros (não null) — `state.tokenUsage` nunca é `undefined` após `invoke()`.

4. **Re-export de `extractTokenUsage`** no barrel `packages/ai/src/index.ts` (D-07).

5. **15 testes verdes** cobrindo TOK-01/02/03 com TDD completo (RED → GREEN).

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | TokenUsage type em @brain-pkg/shared | 5143caf | packages/shared/src/types/index.ts |
| 2 | extractTokenUsage helper + testes TOK-01/02 | 78daaed | packages/ai/src/utils/token.ts, packages/ai/src/__tests__/unit/token.test.ts |
| 3 | tokenUsage no BrainStateAnnotation + barrel + state tests | 43f426b | packages/ai/src/graph/state.ts, packages/ai/src/index.ts, packages/ai/src/graph/state.test.ts, packages/ai/src/__tests__/unit/state-token.test.ts |

## Verification Results

```
bun test (packages/ai)
 30 pass | 5 skip | 0 fail
 Ran 35 tests across 7 files
```

Testes específicos desta wave:
- `token.test.ts` — TOK-01, TOK-02a/b/c/d: 5 testes verdes
- `state-token.test.ts` — TOK-03a/b/c: 3 testes verdes, incluindo acumulação de 300 inputTokens (100+200)
- `state.test.ts` — 7 testes verdes incluindo typecheck atualizado com `tokenUsage`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] LangGraph.invoke({}) retorna undefined sem estado inicial**

- **Found during:** Task 3, teste TOK-03b
- **Issue:** `graph.invoke({})` com objeto vazio retorna `undefined` na versão do LangGraph instalada no worktree. Os defaults dos campos não são ativados sem ao menos 1 campo explícito.
- **Fix:** Substituído `graph.invoke({})` por `graph.invoke({ messages: [] })` no teste TOK-03b, seguindo o mesmo padrão dos testes existentes em `state.test.ts`. TOK-03c não foi afetado porque os nós retornam `tokenUsage` explicitamente, ativando o reducer.
- **Files modified:** `packages/ai/src/__tests__/unit/state-token.test.ts`
- **Commit:** 43f426b

**2. [Rule 3 - Blocking] pnpm install necessário no worktree**

- **Found during:** Task 2, ao tentar rodar os testes
- **Issue:** O worktree não tinha `node_modules` instalados — `bun test` falhava com "Cannot find module '@langchain/langgraph'"
- **Fix:** `pnpm install --frozen-lockfile` no worktree. Dependências instaladas de forma reprodutível.
- **Commit:** N/A (infraestrutura do ambiente, não commitado)

**3. [Rule 2 - Missing] package.json script test não incluía __tests__/unit/**

- **Found during:** Task 2, ao tentar rodar `bun test` diretamente para os novos arquivos
- **Issue:** O script `test` em `packages/ai/package.json` listava explicitamente os diretórios de teste e não incluía o novo `src/__tests__/unit`
- **Fix:** Adicionado `src/__tests__/unit` ao script `test` no `package.json`
- **Files modified:** `packages/ai/package.json`
- **Commit:** 78daaed

## Known Stubs

Nenhum. Todos os artefatos desta wave são implementações completas.

## Threat Flags

Nenhuma superfície nova além do mapeado no threat_model do plano. `extractTokenUsage` opera sobre dados internos do LLM provider (não input de usuário), sem vetor de tampering externo (T-17-01 aceito).

## Self-Check: PASSED

- [x] `packages/shared/src/types/index.ts` contém `export interface TokenUsage {` — FOUND
- [x] `packages/ai/src/utils/token.ts` existe com `export function extractTokenUsage` — FOUND
- [x] `packages/ai/src/__tests__/unit/token.test.ts` existe com 5 testes — FOUND
- [x] `packages/ai/src/__tests__/unit/state-token.test.ts` existe com 3 testes — FOUND
- [x] `packages/ai/src/graph/state.ts` contém `tokenUsage: Annotation<TokenUsage>` — FOUND
- [x] `packages/ai/src/index.ts` contém `export { extractTokenUsage }` — FOUND
- [x] Commits 5143caf, 78daaed, 43f426b existem — VERIFIED
- [x] `bun test` (packages/ai): 30 pass, 0 fail — PASSED
