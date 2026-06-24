---
phase: 22-fup-autom-tico
plan: "01"
subsystem: database
tags:
  - schema
  - migration
  - fup
  - drizzle
dependency_graph:
  requires:
    - "packages/database/src/migrations/0007_v1_4_foundation.sql"
  provides:
    - "fup_failure_count column in leads table"
    - "fupFailureCount Drizzle field"
  affects:
    - "packages/database/src/schema/tables.ts"
    - "FupScheduler (22-02) — pode referenciar lead.fupFailureCount"
tech_stack:
  added: []
  patterns:
    - "ALTER TABLE ADD COLUMN com DEFAULT NOT NULL — zero-downtime para leads existentes"
    - "Journal manual com timestamp fixo para reprodutibilidade"
key_files:
  created:
    - path: "packages/database/src/migrations/0008_fup_failure_count.sql"
      description: "Migration DDL — ADD COLUMN fup_failure_count integer DEFAULT 0 NOT NULL"
  modified:
    - path: "packages/database/src/schema/tables.ts"
      description: "Campo fupFailureCount adicionado à tabela leads (após lastMessageAt)"
    - path: "packages/database/src/migrations/meta/_journal.json"
      description: "Entrada idx=8 para 0008_fup_failure_count"
decisions:
  - "fupFailureCount posicionado após lastMessageAt para agrupar campos FUP no schema"
  - "Timestamp fixo 1750100000000 no journal para garantir reprodutibilidade (não Date.now())"
metrics:
  duration: "~5 min"
  completed: "2026-06-23"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 2
---

# Phase 22 Plan 01: fup_failure_count Migration Summary

**One-liner:** Migration DDL + schema Drizzle para `fup_failure_count` — contador de falhas de FUP persistente por lead para FUP-08.

## Objective

Adicionar a coluna `fup_failure_count` à tabela `leads` — base de resiliência para FUP-08 (retry com contador persistente no banco). O FupScheduler (22-02) usa este campo para rastrear falhas por lead através de restarts.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Criar migration 0008 e atualizar schema Drizzle | `754d3e8` | `0008_fup_failure_count.sql`, `tables.ts`, `_journal.json` |

## Artifacts Delivered

### `packages/database/src/migrations/0008_fup_failure_count.sql`

```sql
ALTER TABLE "leads" ADD COLUMN "fup_failure_count" integer DEFAULT 0 NOT NULL;
```

### `packages/database/src/schema/tables.ts` (campo adicionado)

```typescript
// FUP-08: Contador de falhas de envio de FUP — persistente no banco (D-14)
// Incrementado a cada falha de LLM ou transport. Reset a cada FUP bem-sucedido.
// Quando >= 3 (MAX_FUP_FAILURES): fup_enabled setado para false automaticamente.
fupFailureCount: integer('fup_failure_count').notNull().default(0),
```

### `packages/database/src/migrations/meta/_journal.json` (entrada adicionada)

```json
{
  "idx": 8,
  "version": "7",
  "when": 1750100000000,
  "tag": "0008_fup_failure_count",
  "breakpoints": true
}
```

## Decisions Made

- **D-14 implementado:** `fupFailureCount` posicionado após `lastMessageAt` para agrupar todos os campos FUP no schema Drizzle
- **Timestamp fixo no journal:** `1750100000000` em vez de `Date.now()` — garante reprodutibilidade em reruns da migration
- **DEFAULT 0 NOT NULL:** leads existentes herdam zero falhas sem necessidade de backfill manual

## Deviations from Plan

None — plano executado exatamente como escrito.

## Known Stubs

None.

## Threat Flags

None — migration DDL pura (ADD COLUMN com DEFAULT), sem dados externos, sem risco de injeção SQL.

## Self-Check: PASSED

- [x] `packages/database/src/migrations/0008_fup_failure_count.sql` existe com DDL correto
- [x] `tables.ts` contém `fupFailureCount: integer('fup_failure_count').notNull().default(0),` em leads
- [x] `_journal.json` contém entrada `idx: 8` com tag `0008_fup_failure_count`
- [x] `grep -c "fupFailureCount" packages/database/src/schema/tables.ts` retornou `1`
- [x] TypeScript compila sem erros (verificado no repo principal com dependências instaladas)
- [x] Commit `754d3e8` existe
