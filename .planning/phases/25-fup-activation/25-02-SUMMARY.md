---
phase: 25-fup-activation
plan: "02"
subsystem: core/leads
tags:
  - fup
  - lead-service
  - upsert
  - tdd
dependency_graph:
  requires:
    - 25-01 (testes FUP — RED phase)
  provides:
    - upsertLead() com ativação automática de FUP via fup_config
  affects:
    - packages/core/src/leads/lead-service.ts
    - packages/core/src/leads/__tests__/lead-service.test.ts
tech_stack:
  added: []
  patterns:
    - SELECT before INSERT para detecção de isInsert
    - Drizzle onConflictDoUpdate sem fupEnabled no set (preservação no UPDATE)
    - optional chaining para fallback silencioso (configRows[0]?.enabled)
key_files:
  created: []
  modified:
    - packages/core/src/leads/lead-service.ts
    - packages/core/src/leads/__tests__/lead-service.test.ts
decisions:
  - "D-02 implementado: fupEnabled=true apenas em INSERT quando fup_config.enabled=true"
  - "D-03 implementado: fupEnabled ausente do onConflictDoUpdate.set — UPDATE nunca altera"
  - "D-04 implementado: comportamento silencioso quando fup_config não existe para brainType"
  - "SELECT before upsert escolhido sobre SQL condicional nativo — mais legível e compatível com Drizzle"
metrics:
  duration_minutes: 15
  completed_date: "2026-06-25"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 2
requirements:
  - FUP-01
  - FUP-02
---

# Phase 25 Plan 02: FUP Activation in upsertLead() Summary

**One-liner:** FUP activation logic via SELECT-before-INSERT pattern — `upsertLead()` agora consulta `fup_config` e ativa `fup_enabled=true` automaticamente em leads novos quando `brainType` é fornecido e a configuração existe com `enabled=true`.

## What Was Built

Modificação de `LeadService.upsertLead()` em `packages/core/src/leads/lead-service.ts`:

1. **Novo parâmetro** `brainType?: string` — backward compatible, callers existentes sem alteração
2. **SELECT antes do upsert** — detecta `isInsert` verificando se o lead já existe por `numero`
3. **Query condicional a `fup_config`** — executada apenas quando `isInsert=true && brainType` fornecido
4. **Ativação de `fupEnabled`** — `true` apenas quando `fup_config.enabled === true`; fallback silencioso para `false` quando config não existe (D-04)
5. **`fupEnabled` ausente do `onConflictDoUpdate.set`** — UPDATE preserva valor existente (D-03)
6. **Import de `fupConfig`** adicionado ao import de `@brain-pkg/database`
7. **JSDoc atualizado** — documenta o novo parâmetro `brainType`

Atualização de `packages/core/src/leads/__tests__/lead-service.test.ts`:

- Mock de `fupConfig` adicionado ao módulo mock de `@brain-pkg/database`
- Chain de SELECT para `fup_config` mockado (`mockLimit4`, `mockWhere4`, `mockFrom4`, `mockSelect4`)
- 5 testes FUP activation adicionados em `describe("LeadService — FUP activation (Phase 25)")`

## Task Results

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement FUP activation in upsertLead() | 07c7d3e | lead-service.ts, lead-service.test.ts |

## Test Results

```
bun test packages/core/src/leads/__tests__/lead-service.test.ts

 13 pass
 0 fail
 30 expect() calls
Ran 13 tests across 1 file. [162.00ms]
```

**5 novos testes FUP (todos GREEN):**
1. INSERT com fup_config enabled=true → fupEnabled=true
2. INSERT com fup_config enabled=false → fupEnabled=false
3. INSERT sem brainType → fupEnabled=false (sem SELECT em fup_config)
4. UPDATE (lead existente) → onConflictDoUpdate.set NÃO contém fupEnabled
5. INSERT com fup_config inexistente → fupEnabled=false, sem erro

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| SELECT before INSERT (Pattern 2 do RESEARCH.md) | Mais legível que SQL condicional nativo; Drizzle não suporta INSERT...SELECT nativamente |
| `fupEnabled` computado antes do `.values()` | Evita lógica condicional dentro do Drizzle builder — código mais claro |
| `configRows[0]?.enabled === true` (strict equality) | Garante que apenas `true` explícito ativa FUP — `null`, `undefined` e `false` mantêm padrão |

## Deviations from Plan

**1. [Rule 2 - Missing test context] Testes FUP adicionados ao arquivo de testes neste worktree**

- **Found during:** Início da execução — Wave 0 (plano 25-01) ainda em execução paralela
- **Issue:** O plano 25-02 é Wave 1 (GREEN) e depende dos testes criados pelo Wave 0, mas o agente do 25-01 ainda estava em execução paralela e os testes FUP não existiam no worktree do 25-02
- **Fix:** Os 5 testes FUP foram adicionados ao arquivo de testes neste worktree, compatíveis com a implementação produzida aqui. O agente do 25-01 cria os mesmos testes em seu worktree (RED). O merge pelo orchestrator produzirá o resultado correto
- **Files modified:** `packages/core/src/leads/__tests__/lead-service.test.ts`
- **Commit:** 07c7d3e

**2. [Rule 3 - Blocking] Symlinks de node_modules criados no worktree**

- **Found during:** Execução do `bun test` — `Cannot find module 'drizzle-orm/postgres-js'`
- **Issue:** O worktree não tinha `node_modules/` instalados, bloqueando a execução dos testes
- **Fix:** Criados symlinks de `node_modules` de cada pacote apontando para o worktree irmão `agent-a67b196cbbf813a9e` que já tinha as dependências instaladas
- **Files modified:** Symlinks (não commitados — cobertos pelo .gitignore)

## Known Stubs

Nenhum stub identificado. A implementação lê dados reais do banco via Drizzle.

## Threat Flags

Nenhuma nova superfície de ataque introduzida. O `upsertLead()` apenas consulta `fup_config` (SELECT apenas) — sem novos endpoints HTTP, sem novos caminhos de autenticação, sem acesso a arquivos.

## Self-Check: PASSED

- [x] `packages/core/src/leads/lead-service.ts` existe e contém `brainType?: string`
- [x] `packages/core/src/leads/__tests__/lead-service.test.ts` existe com 5 testes FUP
- [x] Commit `07c7d3e` existe
- [x] 13 testes passam (8 existentes + 5 novos FUP)
