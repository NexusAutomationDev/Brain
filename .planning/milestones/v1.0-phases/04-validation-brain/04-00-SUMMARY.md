---
phase: "04-validation-brain"
plan: "00"
subsystem: "database, apps/brain-echo"
tags: ["refactor", "workspace", "test-stubs", "nyquist", "migrate"]
dependency_graph:
  requires: []
  provides:
    - "runMigrations(sql, migrationsFolder) exportável em packages/database"
    - "workspace @brain-app/echo com package.json e tsconfig.json"
    - "4 stubs de teste Nyquist-compliant para Wave 0"
  affects:
    - "packages/database/src/migrate.ts"
    - "packages/database/src/index.ts"
    - "apps/brain-echo/"
tech_stack:
  added: []
  patterns:
    - "import.meta.main guard para script CLI reutilizável como função exportável"
    - "test.todo() stubs para Nyquist Wave 0 compliance"
key_files:
  created:
    - "apps/brain-echo/package.json"
    - "apps/brain-echo/tsconfig.json"
    - "apps/brain-echo/src/__tests__/unit/brain.test.ts"
    - "apps/brain-echo/src/__tests__/integration/webhook.test.ts"
    - "apps/brain-echo/src/__tests__/integration/restart.test.ts"
    - "apps/brain-echo/src/__tests__/integration/tenant-pool.test.ts"
  modified:
    - "packages/database/src/migrate.ts"
    - "packages/database/src/index.ts"
    - "pnpm-lock.yaml"
decisions:
  - "runMigrations aceita sql injetado (Sql, migrationsFolder) — sem criar conexão interna; caller controla lifecycle"
  - "import.meta.main guard preserva comportamento CLI original sem side-effects ao importar"
  - "apps/brain-echo usa drizzle-orm 0.45.2 (pin estável, alinhado com packages/)"
metrics:
  duration: "~8 minutos"
  completed_date: "2026-06-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 3
---

# Phase 4 Plan 00: Workspace Setup + runMigrations Refactor Summary

**One-liner:** runMigrations refatorado para função exportável com injeção de Sql + workspace @brain-app/echo criado com 4 stubs Nyquist Wave 0.

## What Was Built

### Task 1: Refatorar migrate.ts + criar workspace apps/brain-echo

**packages/database/src/migrate.ts** — Refatorado de script CLI puro para função exportável + CLI com guard:

- `export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void>` aceita conexão injetada e pasta de migrations
- `import.meta.main` guard: importar o módulo não executa migrations (side-effect removido)
- Bloco CLI preservado para `bun src/migrate.ts` continuar funcionando diretamente
- Caller é responsável por `process.exit()` — função apenas lança erro

**packages/database/src/index.ts** — Adicionado `export { runMigrations } from './migrate.js'` para consumo via `@brain-pkg/database`.

**apps/brain-echo/package.json** — Workspace `@brain-app/echo` com deps workspace:* para os 4 pacotes internos (core, database, observability, transport) + hono, postgres, drizzle-orm.

**apps/brain-echo/tsconfig.json** — Extende `../../tsconfig.base.json`, referencia 7 packages internos.

**pnpm-lock.yaml** — Atualizado para incluir apps/brain-echo no workspace (pnpm install executado sem ERR_PNPM_OUTDATED_LOCKFILE).

### Task 2: Criar stubs de teste Nyquist-compliant (Wave 0)

4 arquivos de stub criados em `apps/brain-echo/src/__tests__/`:

| Arquivo | Cobertura | Todos | Pattern |
|---------|-----------|-------|---------|
| `unit/brain.test.ts` | SC-1: IBrain contract (EchoBrain) | 6 todo + 1 pass | test.todo |
| `integration/webhook.test.ts` | SC-2: POST /api/v1/webhook end-to-end | 6 todo + 1 pass | test.todo |
| `integration/restart.test.ts` | SC-3: PostgresSaver persistência pós-restart | 3 todo + 1 pass | test.todo |
| `integration/tenant-pool.test.ts` | SC-4: 10 tenants simultâneos LRU cap | 4 todo + 1 pass | test.todo |

**Resultado do bun test unit:**
```
bun test v1.3.2
1 pass
6 todo
0 fail
Ran 7 tests across 1 file. [1055.00ms]
```

## Commits

| Task | Hash | Mensagem |
|------|------|----------|
| Task 1 | `bdc1cb3` | ♻️ refactor(database): make runMigrations exportable + create apps/brain-echo workspace |
| Task 2 | `540c760` | ✅ test(brain-echo): add Nyquist-compliant Wave 0 test stubs |

## Deviations from Plan

None — plano executado exatamente como especificado.

## Known Stubs

Os 4 arquivos de teste são stubs intencionais (Nyquist Wave 0). Cada um tem um test.todo por comportamento esperado — serão implementados nos planos subsequentes:

- `unit/brain.test.ts` → implementação completa em 04-02 (Wave 1)
- `integration/webhook.test.ts` → implementação completa em 04-04 (Wave 2)
- `integration/restart.test.ts` → implementação completa em 04-04 (Wave 2)
- `integration/tenant-pool.test.ts` → implementação completa em 04-04 (Wave 2)

Estes stubs são **intencionais** e não impedem o objetivo do plano (Wave 0 = test-first compliance).

## Threat Flags

Nenhuma nova superfície de segurança introduzida. Todas as ameaças identificadas no threat_model do plano foram mitigadas:

- **T-4-00-01**: `import.meta.main` guard confirmado em `migrate.ts` linha 17
- **T-4-00-02**: DATABASE_URL não é logada no bloco CLI; apenas erros de migration

## Self-Check: PASSED

- [x] `packages/database/src/migrate.ts` existe com `export async function runMigrations`
- [x] `packages/database/src/migrate.ts` contém `if (import.meta.main)` guard
- [x] `packages/database/src/index.ts` contém `export { runMigrations } from './migrate.js'`
- [x] `apps/brain-echo/package.json` existe com `"name": "@brain-app/echo"`
- [x] `apps/brain-echo/tsconfig.json` existe com `"extends": "../../tsconfig.base.json"`
- [x] 4 arquivos de stub criados em `__tests__/`
- [x] `bun test` unit: 1 pass, 0 fail
- [x] Commits `bdc1cb3` e `540c760` existem
