---
phase: 10-output-parser-sdk
plan: "04"
subsystem: shared, core
tags: [gap-closure, build-artifacts, test-fix, zod, bun]
depends_on:
  - 10-01-SUMMARY.md
  - 10-02-SUMMARY.md
  - 10-03-SUMMARY.md
provides:
  - PARSER-02: BrainRunner.run() lança BrainOutputValidationError e testes provam isso (17/17)
affects:
  - packages/shared/src/ (remoção de artefatos stale não rastreados)
  - packages/shared/dist/ (rebuild com BrainOutputValidationError)
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - pnpm-lock.yaml
tech-stack:
  added: []
  patterns:
    - "Mock de módulos zod-dependentes para evitar 'cached value already set' em bun 1.3.2"
    - "DATABASE_URL fake em testes para evitar process.exit(1) silencioso no _compileGraph()"
key-files:
  created: []
  modified:
    - packages/core/src/runner/__tests__/brain-runner.test.ts
    - pnpm-lock.yaml
decisions:
  - "Substituir await import(@langchain/langgraph) e @langchain/core/messages por mock.module() nos testes para evitar conflito de zod v4 em bun 1.3.2"
  - "Adicionar DATABASE_URL no setup de testes para satisfazer o check em _compileGraph() e evitar process.exit(1) silencioso"
  - "Manter dist/ do shared fora do git — rebuild local resolve o gap de resolução de módulo"
metrics:
  duration: "~45min"
  completed: "2026-06-15T04:42:48Z"
  tasks_completed: 2
  files_changed: 2
requirements:
  - PARSER-01
  - PARSER-02
---

# Phase 10 Plan 04: Gap Closure — Remoção de Artefatos .js Stale de shared/src/ Summary

**One-liner:** Remoção de artefatos de build obsoletos em packages/shared/src/ e correção de dois bugs silenciosos no arquivo de teste do BrainRunner — zod v4 "cached value already set" e DATABASE_URL não definida causando process.exit(1).

## O Que Foi Feito

### Task 1: Remoção dos arquivos .js stale de packages/shared/src/

Os arquivos `.js`, `.js.map`, `.d.ts` e `.d.ts.map` em `packages/shared/src/` eram artefatos de build gerados na Fase 1 (tsc rodou sem `rootDir` configurado). Esses arquivos:
- Nunca foram rastreados pelo git
- Sombreavam os `.ts` atualizados quando o bun resolvia imports `.js` no barrel `src/index.ts`
- O `src/errors/index.js` stale não continha `BrainOutputValidationError` (adicionado na Fase 10 Plan 01 ao `.ts`)

Arquivos removidos do filesystem (não rastreados no git):
- `packages/shared/src/errors/index.js`, `.js.map`, `.d.ts`, `.d.ts.map`
- `packages/shared/src/types/index.js`, `.js.map`, `.d.ts`, `.d.ts.map`
- `packages/shared/src/utils/index.js`, `.js.map`, `.d.ts`, `.d.ts.map`
- `packages/shared/src/index.js`, `.js.map`, `.d.ts`, `.d.ts.map`

Após remoção, `bun --print "import('@brain-pkg/shared')"` retorna `[BrainError, BrainOutputValidationError, ConfigurationError]`.

### Task 2: Rebuild do dist/ e correção dos testes

**Rebuild do shared:**
- Executado `bun run build --cwd packages/shared` via turbo
- `dist/errors/index.js` contém `BrainOutputValidationError`
- O tsc com `outDir: ./dist` não recriou arquivos em `src/`

**Correção do brain-runner.test.ts (dois bugs descobertos):**

**Bug 1 — Zod v4 "cached value already set":** O arquivo de teste importava estaticamente `@langchain/core/messages` e usava `await import("@langchain/langgraph")`. Ambos inicializam partes do zod v4 de forma que conflitavam com a inicialização de `schema.ts` (que usa `z.object()`). O processo bun terminava silenciosamente com exit code 1 sem output.

Solução: mockar `@langchain/langgraph` e `@langchain/core/messages` completamente via `mock.module()`, substituindo os imports reais por classes mock leves. O `MemorySaver` real não é necessário nos testes pois o `compiledGraph` em si é completamente mockado via `brain.buildGraph`.

**Bug 2 — DATABASE_URL não definida:** O `runner.init()` chama `_compileGraph()` internamente, que verifica `process.env.DATABASE_URL`. Se ausente, chama `process.exit(1)`. Esse `process.exit()` terminava o processo do bun test silenciosamente antes de qualquer teste ser executado. O arquivo de teste definia `MIGRATIONS_FOLDER` mas não `DATABASE_URL`.

Solução: adicionar `process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/testdb"` no setup do teste (antes dos imports). O mock de `@brain-pkg/ai.createCheckpointer` intercepta antes de qualquer conexão real ser feita.

## Resultados de Verificação

| Verificação | Comando | Resultado |
|-------------|---------|-----------|
| .js stale removido | `! test -f packages/shared/src/errors/index.js` | PASS |
| dist tem BrainOutputValidationError | `grep "BrainOutputValidationError" packages/shared/dist/errors/index.js` | PASS |
| 17 testes do BrainRunner | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | 17 pass, 0 fail |
| Output schema (sem regressão) | `bun test packages/core/src/__tests__/unit/output` | 9 pass, 0 fail |
| Transport (sem regressão) | `bun test packages/transport/src` | 32 pass, 0 fail |
| Brain-echo unit (sem regressão) | `bun test apps/brain-echo/src/__tests__/unit` | 10 pass, 0 fail |

**Score Phase 10 Gate:** 8/8 truths verificadas (ver VERIFICATION.md)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod v4 "cached value already set" causa exit silencioso do bun test**
- **Found during:** Task 2 (rodando os testes após rebuild)
- **Issue:** Importar `@langchain/langgraph` via `await import()` e `@langchain/core/messages` via import estático causava conflito na inicialização do zod v4 quando `schema.ts` tentava criar `z.object()`. O processo bun terminava com exit code 1 sem output, mascarando o problema.
- **Fix:** Substituir todos os imports reais de `@langchain/langgraph` e `@langchain/core/messages` por `mock.module()` com classes mock leves (MockMemorySaver, MockAIMessage, MockHumanMessage). Como o `compiledGraph` é completamente mockado via `brain.buildGraph`, o MemorySaver real não é necessário.
- **Files modified:** `packages/core/src/runner/__tests__/brain-runner.test.ts`
- **Commit:** badf95a

**2. [Rule 2 - Missing Critical] DATABASE_URL ausente causa process.exit(1) silencioso nos testes**
- **Found during:** Task 2 (investigação da falha silenciosa)
- **Issue:** `_compileGraph()` em `runner.ts` verifica `process.env.DATABASE_URL` e chama `process.exit(1)` se ausente. O arquivo de teste definia `MIGRATIONS_FOLDER` mas omitia `DATABASE_URL`. Resultado: `runner.init()` terminava o processo silenciosamente antes de qualquer teste executar.
- **Fix:** Adicionar `process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/testdb"` no setup do arquivo de teste. O mock de `createCheckpointer` intercepta antes de qualquer conexão real.
- **Files modified:** `packages/core/src/runner/__tests__/brain-runner.test.ts`
- **Commit:** badf95a

## Known Stubs

Nenhum stub identificado. Todos os exports são funcionais.

## Threat Flags

Nenhuma nova superfície de segurança introduzida. Apenas remoção de artefatos e correção de testes.

## Self-Check: PASSED

- [x] `packages/shared/src/errors/index.js` não existe
- [x] `packages/shared/dist/errors/index.js` contém `BrainOutputValidationError`
- [x] `bun test brain-runner.test.ts` — 17 pass, 0 fail
- [x] Commit `badf95a` existe: `git log --oneline | grep badf95a`
