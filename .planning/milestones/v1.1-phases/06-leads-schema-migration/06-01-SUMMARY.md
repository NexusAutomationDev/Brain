---
phase: 06-leads-schema-migration
plan: "01"
subsystem: database
tags: [schema, drizzle, leads, advisory-lock, migrations]
dependency_graph:
  requires: []
  provides:
    - leadsTable Drizzle definition exportada de packages/database
    - runMigrations() com pg_advisory_lock serializing concurrent instances
  affects:
    - packages/database/src/schema/tables.ts
    - packages/database/src/migrate.ts
    - packages/database/src/index.ts (barrel — zero changes, auto-exports leads)
tech_stack:
  added: []
  patterns:
    - Drizzle pgTable com boolean field e uniqueIndex
    - pg_advisory_lock/pg_advisory_unlock em try/finally para serialização de migrations
key_files:
  modified:
    - packages/database/src/schema/tables.ts
    - packages/database/src/migrate.ts
decisions:
  - MIGRATION_LOCK_KEY = 7316882 — chave fixa arbitrária por database; colisão entre Brains no mesmo DB não é cenário v1.1 (T-06-03 accept)
  - boolean('fullpp') sem .notNull() — nullable intencional (D-06); flag sem regra de negócio em v1.1
  - Tabela users preservada — aditiva em v1.1 (D-08); remoção em v2
metrics:
  duration: "~8 minutos"
  completed: "2026-06-14T01:29:49Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 06 Plan 01: Leads Schema + Advisory Lock Summary

**One-liner:** leadsTable Drizzle schema com 8 campos (D-01 a D-07) + uniqueIndex em `numero`, e runMigrations() serializado via pg_advisory_lock/pg_advisory_unlock em try/finally.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Adicionar leadsTable ao schema Drizzle | 3844905 | packages/database/src/schema/tables.ts |
| 2 | Adicionar pg_advisory_lock ao runMigrations() | 34a6c63 | packages/database/src/migrate.ts |

## What Was Built

### Task 1: leadsTable Drizzle Schema

Adicionado `boolean` ao import de `drizzle-orm/pg-core` e definida a tabela `leads` com todos os campos especificados:

- **D-01**: `id` — UUID PK com `defaultRandom()`
- **D-02**: `unique_id` — TEXT NOT NULL, vínculo com `thread_id` do PostgresSaver
- **D-03**: `nome` — TEXT nullable (primeira mensagem pode não incluir nome)
- **D-04**: `numero` — TEXT NOT NULL + `uniqueIndex('leads_numero_unique_idx')` para upsert em Phase 7
- **D-05**: `ia_ativada` — BOOLEAN NOT NULL DEFAULT true
- **D-06**: `fullpp` — BOOLEAN nullable (sem `.notNull()`)
- **D-07**: `created_at` + `updated_at` — timestamps com `defaultNow().notNull()`

Tabela `users` preservada sem nenhuma modificação (D-08 — aditiva).

### Task 2: pg_advisory_lock em runMigrations()

Modificada a função `runMigrations()` para serializar execuções concorrentes:

1. `MIGRATION_LOCK_KEY = 7316882` — constante arbitrária fixa (D-14)
2. `await sql\`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})\`` ANTES de qualquer operação
3. Lógica de migration envolvida em `try/finally`
4. `await sql\`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})\`` no `finally` — garante liberação mesmo em erro
5. Logs estruturados via `console.log` nas 4 transições de estado

Lock é por database no PostgreSQL — isolamento multi-tenant automático (D-15).

## Deviations from Plan

None — plano executado exatamente como especificado.

## Known Stubs

None — sem stubs ou placeholders introduzidos.

## Threat Flags

None — nenhuma superfície de segurança nova além das já documentadas no threat_model do plano (T-06-01 a T-06-04, todos com disposition `accept`).

## Self-Check: PASSED

- [x] `packages/database/src/schema/tables.ts` — FOUND: `export const leads`
- [x] `packages/database/src/schema/tables.ts` — FOUND: `leads_numero_unique_idx`
- [x] `packages/database/src/schema/tables.ts` — FOUND: `export const users` (preservada)
- [x] `packages/database/src/migrate.ts` — FOUND: `MIGRATION_LOCK_KEY = 7316882`
- [x] `packages/database/src/migrate.ts` — FOUND: `pg_advisory_lock` + `pg_advisory_unlock`
- [x] `packages/database/src/migrate.ts` — FOUND: `finally` block com unlock
- [x] Commit 3844905 — Task 1 leadsTable
- [x] Commit 34a6c63 — Task 2 advisory lock
