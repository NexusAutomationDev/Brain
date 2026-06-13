---
phase: 03-brain-sdk
plan: "02"
subsystem: core/prompts
tags: [prompts, database, migration, drizzle, sdk-04, tdd]
dependency_graph:
  requires: ["03-00"]
  provides: ["loadPrompts()", "prompts migration SQL"]
  affects: ["packages/core", "packages/database"]
tech_stack:
  added: ["drizzle-orm@0.45.2 (direct dep in core)", "postgres@^3.4.9 (direct dep in core)"]
  patterns: ["Sql injection pattern (mirrors long-term.ts)", "TDD RED-GREEN", "drizzle-kit generate for migrations"]
key_files:
  created:
    - packages/database/src/migrations/0001_lazy_deathstrike.sql
    - packages/core/src/prompts/loader.ts
  modified:
    - packages/core/src/prompts/__tests__/loader.test.ts
    - packages/core/package.json
    - packages/database/src/migrations/meta/_journal.json
    - packages/database/src/migrations/meta/0001_snapshot.json
    - pnpm-lock.yaml
decisions:
  - "drizzle-orm and postgres added as direct deps of packages/core because loader.ts imports them directly"
  - "Migration generated via drizzle-kit generate in main repo then copied to worktree (worktree lacks pnpm node_modules for drizzle-kit binary)"
  - "inArray imported from drizzle-orm directly (not re-exported from @brain-pkg/database) — correct per plan spec"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-12"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 5
---

# Phase 03 Plan 02: Prompts Loader e Migration SQL Summary

**One-liner:** `loadPrompts(sql, brainType, keys)` com query Drizzle filtrada por `(brain_type, key)` e migration SQL gerada via drizzle-kit para tabela `prompts`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Gerar migration SQL da tabela prompts | 7c8dd51 | `0001_lazy_deathstrike.sql`, `meta/_journal.json`, `meta/0001_snapshot.json` |
| 2 (RED) | TDD RED — testes failing para loadPrompts | dfb510a | `packages/core/src/prompts/__tests__/loader.test.ts` |
| 2 (GREEN) | Implementar loadPrompts() — 3 testes verdes | e92f252 | `packages/core/src/prompts/loader.ts`, `packages/core/package.json`, `pnpm-lock.yaml` |

## What Was Built

### Migration SQL (Task 1)

`packages/database/src/migrations/0001_lazy_deathstrike.sql` criado via `bunx drizzle-kit generate`:

- `CREATE TABLE "prompts"` com 6 colunas: `id`, `brain_type`, `key`, `content`, `created_at`, `updated_at`
- `CREATE UNIQUE INDEX "prompts_brain_type_key_idx"` em `(brain_type, key)`
- Journal atualizado com entry `0001` para aplicação automática via `migrate.ts` no startup

### loadPrompts() (Task 2 — TDD)

`packages/core/src/prompts/loader.ts`:

```typescript
export async function loadPrompts(
  sql: Sql,
  brainType: string,
  keys: string[]
): Promise<Record<string, string>>
```

- Recebe instância `Sql` (postgres.js) — padrão idêntico ao `long-term.ts`
- Cria `drizzle(sql)` localmente — sem estado global
- Query: `and(eq(prompts.brainType, brainType), inArray(prompts.key, keys))` — filtro duplo (T-3-02-02)
- Retorna `Record<string, string>` via `Object.fromEntries(rows.map(r => [r.key, r.content]))`
- Early return `{}` quando `keys.length === 0`

### Testes (3 verdes)

- Test 1: Retorna `{ system: "...", greeting: "..." }` quando mock retorna 2 rows
- Test 2: Retorna apenas as keys solicitadas (`{ system: "..." }`) — confirma isolamento
- Test 3: Retorna `{}` quando mock retorna rows vazias

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] drizzle-orm não resolvível em packages/core**
- **Found during:** Task 2 (TDD GREEN) — bun test falhou com `Cannot find module 'drizzle-orm/postgres-js'`
- **Issue:** `packages/core` não tinha `drizzle-orm` como dependência direta; pnpm workspace resolve via hoisting mas o bun test runner não encontrou o módulo
- **Fix:** Adicionado `"drizzle-orm": "0.45.2"` e `"postgres": "^3.4.9"` em `packages/core/package.json` + `pnpm install`
- **Files modified:** `packages/core/package.json`, `pnpm-lock.yaml`
- **Commit:** e92f252

**2. [Rule 3 - Blocking] drizzle-kit binary não disponível no worktree**
- **Found during:** Task 1 — `bunx drizzle-kit generate` no path do worktree falhou com `Cannot find module 'drizzle-kit'`
- **Issue:** Worktree não tinha `node_modules` próprio; drizzle-kit binary só presente em `/root/Brain/packages/database/node_modules/.bin/`
- **Fix:** Rodou `drizzle-kit generate` no repo principal (`/root/Brain/packages/database`) e copiou os arquivos gerados para o worktree
- **Files modified:** `packages/database/src/migrations/0001_lazy_deathstrike.sql`, `meta/` (copiados)
- **Commit:** 7c8dd51

## Known Stubs

Nenhum. A implementação completa está funcional com 3 testes verdes e sem valores hardcoded.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: sql_injection_surface | packages/core/src/prompts/loader.ts | `brainType` e `keys` vêm de caller externo — Drizzle parametriza as queries automaticamente via prepared statements, mas o caller deve validar inputs antes de chamar `loadPrompts()` |

## Self-Check

- [x] `packages/database/src/migrations/0001_lazy_deathstrike.sql` existe
- [x] `packages/core/src/prompts/loader.ts` existe
- [x] `packages/core/src/prompts/__tests__/loader.test.ts` atualizado com 3 testes
- [x] Commits 7c8dd51, dfb510a, e92f252 existem em `git log`
- [x] `bun test packages/core/src/prompts` — 3 pass, 0 fail
- [x] Nenhuma string hardcoded de prompt em `packages/core/src` (grep confirmado)

## Self-Check: PASSED
