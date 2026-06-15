---
phase: 11-tool-contracts-sdk
plan: "02"
subsystem: core-sdk
tags: [tool-contracts, pause-session, finish-conversation, brain-runner, barrel-exports, tdd, wave-2]
dependency_graph:
  requires:
    - 11-01 (BrainBuildContext.sql opcional, testes RED scaffold)
  provides:
    - createPauseSessionTool(sql): StructuredTool — pause_session
    - createFinishConversationTool(sql): StructuredTool — finish_conversation
    - BrainRunner._compileGraph() injeta sql: this.sql ao BrainBuildContext
    - packages/core barrel exporta ambas as factories (SDK-07)
  affects:
    - packages/core (tools + runner + barrel)
    - Fase 12 (consumidora das factories via ctx.sql no buildGraph())
tech_stack:
  added: []
  patterns:
    - Factory function com closure sobre sql (D-11) — mesmo padrão do boundQualifyTool
    - thread_id lido do RunnableConfig (D-04) — nunca do LLM (D-06)
    - UPDATE atômico em finish_conversation — iaAtivada=false + fullpp=false no mesmo .set()
    - Named exports explícitos no barrel — sem export star (T-3-04-04)
key_files:
  created:
    - packages/core/src/tools/pause-session.ts
    - packages/core/src/tools/finish-conversation.ts
  modified:
    - packages/core/src/runner/runner.ts
    - packages/core/src/index.ts
decisions:
  - "D-03: sql: this.sql adicionado ao BrainBuildContext em _compileGraph() — ctx.sql disponível para factories"
  - "D-04/D-06: thread_id extraído do RunnableConfig config?.configurable?.thread_id — nunca parâmetro do LLM"
  - "D-11: factories exportadas (não instâncias) — createPauseSessionTool(sql) e createFinishConversationTool(sql)"
  - "TOOLS-STD-02: update atômico em finish_conversation — .set({ iaAtivada: false, fullpp: false }) em único UPDATE"
metrics:
  duration: "12 minutes"
  completed_date: "2026-06-15"
  tasks_completed: 2
  files_changed: 4
---

# Phase 11 Plan 02: Tool Contracts SDK — Factories Summary

**One-liner:** `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` implementadas como factories com closure sobre sql, BrainRunner injeta `sql: this.sql` ao BrainBuildContext, e ambas exportadas pelo barrel — completando TOOLS-STD-01 e TOOLS-STD-02.

## What Was Built

### Task 1: Factories createPauseSessionTool e createFinishConversationTool (GREEN)

Criados 2 arquivos de factory em `packages/core/src/tools/`:

| Arquivo | Exporta | Comportamento |
|---------|---------|---------------|
| `pause-session.ts` | `createPauseSessionTool(sql: Sql)` | UPDATE `leads.fullpp=false` via `thread_id` do RunnableConfig |
| `finish-conversation.ts` | `createFinishConversationTool(sql: Sql)` | UPDATE atômico `iaAtivada=false + fullpp=false` no mesmo `.set()` |

**Padrão implementado:**
- Factory function com closure sobre `sql` — cria `db = drizzle(sql)` e retorna `StructuredTool` via `tool()` do `@langchain/core/tools`
- `thread_id` lido de `config?.configurable?.thread_id` (segundo argumento do handler) — nunca do schema da tool
- Guard obrigatório: `if (!threadId) return "Erro: thread_id não disponível na configuração"`
- `finish_conversation` faz **um único UPDATE** com `{ iaAtivada: false, fullpp: false, updatedAt: new Date() }` — atomicidade garantida (Pitfall 1 mitigado)

### Task 2: BrainRunner sql injection + barrel exports

**`packages/core/src/runner/runner.ts`** — `_compileGraph()`
- Adicionado `sql: this.sql` ao objeto `ctx: BrainBuildContext` (D-03)
- `buildGraph()` do Brain agora recebe `ctx.sql` e pode chamar `createPauseSessionTool(ctx.sql!)` diretamente

**`packages/core/src/index.ts`** — SDK-07
- Adicionados 2 exports nomeados explícitos após SDK-06:
  - `export { createPauseSessionTool } from "./tools/pause-session.js"`
  - `export { createFinishConversationTool } from "./tools/finish-conversation.js"`
- Sem `export *` — segue padrão T-3-04-04

## Test Results

```
bun test packages/core/src/tools/__tests__/pause-session.test.ts
  4/4 pass (GREEN)

bun test packages/core/src/tools/__tests__/finish-conversation.test.ts
  4/4 pass (GREEN)

bun test packages/core/
  63 pass, 5 skip, 0 fail (68 total)

cd packages/core && bun run build (tsc)
  0 erros — build limpo
```

## Commits

| Task | Hash | Mensagem |
|------|------|----------|
| Task 1 | `6367cfd` | `✨ feat(11-02): createPauseSessionTool e createFinishConversationTool (TOOLS-STD-01/02)` |
| Task 2 | `a6931a4` | `✨ feat(11-02): BrainRunner passa sql ao BrainBuildContext + barrel exports SDK-07` |

## Decisions Made

1. **D-03 — `sql: this.sql` no BrainBuildContext:** Adicionado ao objeto `ctx` em `_compileGraph()`. O campo já existia como `sql?: Sql` na interface (D-01 do Plan 01). A passagem permite que qualquer Brain acesse `ctx.sql!` em `buildGraph()` para criar tools bound ao tenant.

2. **D-04/D-06 — thread_id do RunnableConfig:** Ambas as tools leem `config?.configurable?.thread_id` como segundo argumento do handler — padrão LangChain. O schema das tools é `z.object({})` — sem parâmetro de identificador do LLM, eliminando risco de alucinação (T-11-04 mitigado).

3. **D-11 — Factories, não instâncias:** Exportadas `createPauseSessionTool` e `createFinishConversationTool` (não `pauseSessionTool`/`finishConversationTool`). O Brain chama `createXTool(ctx.sql!)` dentro de `buildGraph()` — cada instância de Brain tem seu próprio `sql` isolado.

4. **TOOLS-STD-02 — UPDATE atômico:** `finish_conversation` usa um único `.set({ iaAtivada: false, fullpp: false, updatedAt: new Date() })` — impossível ter `ia_ativada=false` sem `fullpp=false` (T-11-05 mitigado).

## Deviations from Plan

### Auto-fixed Issues

Nenhum — plano executado exatamente conforme especificado.

### Notas de Implementação

- O worktree não tinha `node_modules` (apenas o repo principal tem). Foi necessário rodar `bun install` para instalar as dependências workspace antes de rodar os testes. O build completo via `bun run build` na raiz (turbo) construiu os pacotes dependentes na ordem correta, gerando os `dist/` necessários para o `tsc` do `packages/core`.
- O `git reset --soft` inicial (para alinhar ao commit base do orquestrador) desfez os commits do Plan 01 como staged changes. Foi necessário restaurar os arquivos via `git checkout HEAD -- <files>` antes de prosseguir com a implementação.

## Known Stubs

Nenhum — todas as factories são implementações completas prontas para produção. A integração (Fase 12: habilitar `pause_session` e `finish_conversation` no Brain SDR via `enableTool()`) é responsabilidade da próxima fase.

## Threat Flags

Nenhuma superfície nova além do que está no `<threat_model>` do plano:
- T-11-04 (Spoofing via thread_id): mitigado com guard `if (!threadId) return "Erro"`
- T-11-05 (Tampering via atomicidade): mitigado com UPDATE único em `finish_conversation`
- T-11-06/T-11-07: aceitos conforme planejado

## Self-Check: PASSED

### Files Exist

- FOUND: `packages/core/src/tools/pause-session.ts`
- FOUND: `packages/core/src/tools/finish-conversation.ts`
- FOUND: `packages/core/src/runner/runner.ts` (modificado)
- FOUND: `packages/core/src/index.ts` (modificado)

### Commits Exist

- FOUND: `6367cfd` — feat(11-02): createPauseSessionTool e createFinishConversationTool
- FOUND: `a6931a4` — feat(11-02): BrainRunner passa sql ao BrainBuildContext + barrel exports SDK-07
