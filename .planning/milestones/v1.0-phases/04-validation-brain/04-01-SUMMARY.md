---
phase: "04-validation-brain"
plan: "01"
subsystem: "apps/brain-echo"
tags: ["feat", "brain-sdk", "echo-brain", "ibrain", "langgraph", "hono", "entrypoint"]
dependency_graph:
  requires:
    - "packages/core (IBrain, BrainRunner, ToolsRegistry, createCoreApp)"
    - "packages/observability (createHealthApp, createLogger)"
    - "packages/transport (createWebhookApp)"
    - "packages/database (runMigrations)"
    - "packages/ai (BrainStateAnnotation)"
  provides:
    - "echoBrain: IBrain — implementação completa do contrato IBrain para Echo Brain"
    - "createServer(sql, runner): Hono — monta 3 sub-apps em único app"
    - "main() — entrypoint sequencial com fail-fast startup"
  affects:
    - "apps/brain-echo/src/brain.ts"
    - "apps/brain-echo/src/server.ts"
    - "apps/brain-echo/src/index.ts"
    - "apps/brain-echo/src/__tests__/unit/brain.test.ts"
    - "apps/brain-echo/package.json"
    - "pnpm-lock.yaml"
tech_stack:
  added:
    - "@brain-pkg/ai: workspace:* — BrainStateAnnotation para o StateGraph"
    - "@langchain/langgraph: ^1.4.1 — StateGraph e addNode/addEdge para buildGraph()"
  patterns:
    - "IBrain implementation: exporta objeto constante (não classe) com buildGraph() retornando StateGraph não compilado"
    - "Hono app.route('/') para composição de sub-apps sem prefixo de path"
    - "Startup sequencial fail-fast: DATABASE_URL check → runMigrations → runner.init → Bun.serve"
    - "MIGRATIONS_DIR env var como escape hatch para Docker path resolution"
key_files:
  created:
    - "apps/brain-echo/src/brain.ts"
    - "apps/brain-echo/src/server.ts"
    - "apps/brain-echo/src/index.ts"
  modified:
    - "apps/brain-echo/src/__tests__/unit/brain.test.ts"
    - "apps/brain-echo/package.json"
    - "pnpm-lock.yaml"
decisions:
  - "echoBrain como const object (não classe) — alinhado ao padrão IBrain do CONTEXT.md D-01/D-02/D-03"
  - "Adicionado @brain-pkg/ai e @langchain/langgraph como dependências diretas de @brain-app/echo — brain.ts importa StateGraph diretamente"
  - "MIGRATIONS_DIR env var preferida no Docker; fallback via import.meta.url + fileURLToPath para desenvolvimento local"
metrics:
  duration: "~15 minutos"
  completed_date: "2026-06-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 3
---

# Phase 4 Plan 01: EchoBrain Implementation + Server + Entrypoint Summary

**One-liner:** EchoBrain IBrain implementado com StateGraph não compilado + Hono server compondo 3 sub-apps + entrypoint sequencial fail-fast com migrations → runner.init → Bun.serve.

## What Was Built

### Task 1: EchoBrain (brain.ts) + Testes unitários IBrain

Criado `apps/brain-echo/src/brain.ts` implementando o contrato IBrain completo:

- `id: "brain-echo"`, `brainType: "echo"`, `promptKeys: ["system"]`, `tools: []`
- `buildGraph()` cria StateGraph com nó `llm` que invoca `ctx.llm` com o system prompt do banco
- Retorna StateGraph **não compilado** — BrainRunner chama `.compile({ checkpointer })` (D-03)
- Edges: `__start__` → `llm` → `__end__`

Atualizado `apps/brain-echo/src/__tests__/unit/brain.test.ts` substituindo stubs `.todo()` por 6 testes reais:
1. placeholder (sempre passa)
2. `echoBrain.id === "brain-echo"`
3. `echoBrain.brainType === "echo"`
4. `echoBrain.promptKeys.toEqual(["system"])`
5. `echoBrain.tools.toEqual([])`
6. `buildGraph(ctx)` retorna StateGraph com `.addNode` e `.compile` (não chamado)

Resultado: **6/6 testes passam**.

### Task 2: server.ts + index.ts

Criado `apps/brain-echo/src/server.ts`:
- `createServer(sql: Sql, runner: BrainRunner): Hono`
- Monta 3 sub-apps via `app.route("/", ...)`: `createHealthApp`, `createWebhookApp`, `createCoreApp`

Criado `apps/brain-echo/src/index.ts`:
- `main()` com startup sequencial:
  1. Valida `DATABASE_URL` (exit 1 se ausente)
  2. `runMigrations(sql, migrationsDir)` com catch → exit 1
  3. `runner.init()` (exit 1 interno se prompt 'system' não existe no DB)
  4. `Bun.serve({ port, fetch: app.fetch })`

## Test Results

```
bun test apps/brain-echo/src/__tests__/unit

 6 pass
 0 fail
 8 expect() calls
Ran 6 tests across 1 file. [1.77s]
```

## Verification

- `grep "IBrain" apps/brain-echo/src/brain.ts` → importação de tipo + anotação no const ✓
- `grep "\.compile(" apps/brain-echo/src/brain.ts` → apenas comentários, zero chamadas reais ✓
- `grep "process.exit(1)" apps/brain-echo/src/index.ts` → 2 ocorrências (DATABASE_URL check + migration catch) ✓
- `grep "createHealthApp\|createWebhookApp\|createCoreApp" apps/brain-echo/src/server.ts` → 9 linhas (imports + app.route) ✓

## Commits

| Hash | Descrição |
|------|-----------|
| `7b038b9` | ✨ feat(brain-echo): implement EchoBrain IBrain contract + unit tests |
| `389d222` | ✨ feat(brain-echo): implement server.ts + index.ts entrypoint |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing dependency] Adicionado @brain-pkg/ai e @langchain/langgraph ao package.json de @brain-app/echo**

- **Found during:** Task 1 (RED phase — testes falhando com "Cannot find module '@langchain/langgraph'")
- **Issue:** `brain.ts` importa `StateGraph` de `@langchain/langgraph` e `BrainStateAnnotation` de `@brain-pkg/ai` diretamente, mas esses pacotes não estavam listados como dependências diretas em `apps/brain-echo/package.json`. O Bun não resolve dependências transitivas de workspace packages.
- **Fix:** Adicionado `"@brain-pkg/ai": "workspace:*"` e `"@langchain/langgraph": "^1.4.1"` ao `dependencies` do `apps/brain-echo/package.json`; rodado `pnpm install --filter @brain-app/echo` para atualizar o lockfile.
- **Files modified:** `apps/brain-echo/package.json`, `pnpm-lock.yaml`
- **Commit:** `7b038b9`

**2. [Rule 3 - Blocking] Instalação de dependências pnpm no worktree**

- **Found during:** Task 1 (testes falhando no contexto do git worktree)
- **Issue:** O git worktree em `.claude/worktrees/agent-ad5e76964aa79dc55/` não tinha `node_modules` com o pnpm store (`.pnpm/`). O `pnpm install` precisou ser rodado no worktree para criar o virtual store local.
- **Fix:** Executado `pnpm install` no worktree; `pnpm install --filter @brain-app/echo` após adicionar as dependências.
- **Impact:** `pnpm-lock.yaml` não foi modificado (lockfile já estava atualizado); apenas symlinks locais foram criados.
- **Commit:** `7b038b9`

## Known Stubs

Nenhum. `tools: []` em `echoBrain.tools` é intencional por decisão D-02 do CONTEXT.md (sem tools na fase de validação; BrainRunner exercita ToolsRegistry com lista vazia).

## Threat Flags

Nenhuma nova superfície de ataque introduzida além do que o threat model do plano já contempla. Os 3 endpoints (`/health`, `/api/v1/webhook`, `/reload-prompts`) herdam as proteções implementadas nos packages: Zod validation no webhook (T-4-01-01), X-Admin-Token com fail-closed no /reload-prompts (T-4-01-04).
