---
phase: 06-leads-schema-migration
plan: "02"
subsystem: database, core
tags: [migration, drizzle-kit, leads, brain-runner, auto-migrate]
dependency_graph:
  requires:
    - 06-01 (leadsTable Drizzle schema + runMigrations advisory lock)
  provides:
    - 0004_even_rick_jones.sql — SQL de criação da tabela leads pronto para apply
    - BrainRunner.init() auto-executa runMigrations() antes de aceitar mensagens
  affects:
    - packages/database/src/migrations/0004_even_rick_jones.sql
    - packages/database/src/migrations/meta/_journal.json
    - packages/database/src/migrations/meta/0004_snapshot.json
    - packages/core/src/runner/runner.ts
    - apps/brain-echo/src/index.ts
tech_stack:
  added: []
  patterns:
    - drizzle-kit generate para produzir SQL de migration a partir do schema Drizzle
    - BrainRunnerOptions com migrationsFolder? opcional (ENV fallback)
    - process.exit(1) como fail-fast para MIGRATIONS_FOLDER ausente (T-06-07)
key_files:
  created:
    - packages/database/src/migrations/0004_even_rick_jones.sql
    - packages/database/src/migrations/meta/0004_snapshot.json
  modified:
    - packages/database/src/migrations/meta/_journal.json
    - packages/core/src/runner/runner.ts
    - apps/brain-echo/src/index.ts
decisions:
  - drizzle-kit gerou nome 0004_even_rick_jones em vez de 0004_leads_table — nome aceito, journal atualizado automaticamente com tag correta
  - migrationsFolder como campo opcional em BrainRunnerOptions — ENV MIGRATIONS_FOLDER como fallback (D-11)
  - process.exit(1) se MIGRATIONS_FOLDER ausente — T-06-07 mitigation (path traversal prevenido por exigir configuração explícita)
  - err: unknown em .catch() — strict TypeScript sem implicit any
metrics:
  duration: "~15 minutos"
  completed: "2026-06-14T02:10:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
---

# Phase 06 Plan 02: Migration SQL Generation + BrainRunner Auto-Migrate Summary

**One-liner:** drizzle-kit generate produziu 0004_even_rick_jones.sql com CREATE TABLE leads e BrainRunner.init() agora executa runMigrations() automaticamente via MIGRATIONS_FOLDER ENV antes de aceitar mensagens.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Gerar migration SQL com drizzle-kit | 4d06099 | packages/database/src/migrations/0004_even_rick_jones.sql, meta/_journal.json, meta/0004_snapshot.json |
| 2 | Integrar runMigrations() ao BrainRunner.init() e atualizar brain-echo | a72aebd | packages/core/src/runner/runner.ts, apps/brain-echo/src/index.ts |

## What Was Built

### Task 1: Migration SQL via drizzle-kit

Executado `drizzle-kit generate` no pacote database. O comando detectou a diferença entre o snapshot anterior e o schema atual (que agora inclui `leadsTable` do plano 01) e gerou:

- **0004_even_rick_jones.sql** — CREATE TABLE leads com 8 colunas (id, unique_id, nome, numero, ia_ativada, fullpp, created_at, updated_at), `UNIQUE INDEX leads_numero_unique_idx` em `numero`, e correção do index `memories_user_key_idx` para UNIQUE (drizzle-kit detectou divergência com snapshot)
- **meta/_journal.json** — entry idx:4 adicionada com tag `0004_even_rick_jones`
- **meta/0004_snapshot.json** — snapshot completo do estado do schema após a migration

### Task 2: BrainRunner Auto-Migrate

**packages/core/src/runner/runner.ts:**

1. `import { runMigrations } from "@brain-pkg/database"` adicionado
2. Campo `migrationsFolder?: string` adicionado à interface `BrainRunnerOptions`
3. Propriedade `private readonly migrationsFolder: string | undefined` na classe
4. Atribuição no constructor: `this.migrationsFolder = options.migrationsFolder`
5. No início de `init()`, ANTES de `loadPrompts()`:
   - Resolve `migrationsFolder` via opção ou `process.env.MIGRATIONS_FOLDER`
   - `process.exit(1)` com log de erro se ENV ausente (T-06-07 mitigation)
   - `await runMigrations(this.sql, migrationsFolder)` com `.catch()` tipado (`err: unknown`)
   - Log de conclusão das migrations

**apps/brain-echo/src/index.ts:**

- Removida chamada direta a `runMigrations()` e respectivo `await`
- Removido import de `runMigrations` de `@brain-pkg/database`
- Removidos imports `fileURLToPath`, `join`, `dirname` (não mais necessários)
- Adicionado comentário explicativo sobre `MIGRATIONS_FOLDER ENV`
- Comentário do startup atualizado: passo 1 agora é `runner.init()` (não mais migrations separadas)

## Deviations from Plan

### Auto-accepted: Nome de arquivo diferente do esperado

**Found during:** Task 1

**Issue:** O plano esperava o nome `0004_leads_table.sql`, mas drizzle-kit gerou `0004_even_rick_jones.sql` (nome gerado automaticamente com base no conteúdo/hash do schema).

**Fix:** O plano documentava explicitamente: "Se drizzle-kit renomear o arquivo com hash diferente de `0004_leads_table`, aceitar o nome gerado — o journal será atualizado automaticamente com o nome correto." Aceito sem desvio real.

**Files modified:** packages/database/src/migrations/ (nome do arquivo)

### Auto-fixed: memories_user_key_idx recriado como UNIQUE

**Found during:** Task 1

**Issue:** drizzle-kit detectou que o index `memories_user_key_idx` no snapshot anterior não estava marcado como UNIQUE index, enquanto o schema Drizzle usa `uniqueIndex()`. A migration gerada incluiu `DROP INDEX "memories_user_key_idx"` seguido de `CREATE UNIQUE INDEX "memories_user_key_idx"`.

**Fix:** Aceito — comportamento correto do drizzle-kit para sincronizar o banco com o schema. O SQL é idempotente (IF NOT EXISTS não se aplica ao DROP/CREATE pattern do drizzle).

**Files modified:** packages/database/src/migrations/0004_even_rick_jones.sql

## Known Stubs

None — sem stubs ou placeholders introduzidos.

## Threat Flags

None — nenhuma superfície de segurança nova além das já documentadas no threat_model do plano (T-06-05 a T-06-08, todos com disposição adequada). A mitigação T-06-07 foi implementada: `process.exit(1)` se `MIGRATIONS_FOLDER` não definida.

## Self-Check: PASSED

- [x] `packages/database/src/migrations/0004_even_rick_jones.sql` — FOUND: `CREATE TABLE "leads"`
- [x] `packages/database/src/migrations/0004_even_rick_jones.sql` — FOUND: `leads_numero_unique_idx`
- [x] `packages/database/src/migrations/0004_even_rick_jones.sql` — FOUND: `ia_ativada`
- [x] `packages/database/src/migrations/meta/_journal.json` — FOUND: `"idx": 4`
- [x] `packages/core/src/runner/runner.ts` — FOUND: `import { runMigrations } from "@brain-pkg/database"`
- [x] `packages/core/src/runner/runner.ts` — FOUND: `await runMigrations(this.sql, migrationsFolder)`
- [x] `packages/core/src/runner/runner.ts` — FOUND: `MIGRATIONS_FOLDER`
- [x] `apps/brain-echo/src/index.ts` — NOT FOUND: `await runMigrations` (correto — removido)
- [x] `apps/brain-echo/src/index.ts` — NOT FOUND: `import.*runMigrations` (correto — removido)
- [x] Commit 4d06099 — Task 1 migration SQL
- [x] Commit a72aebd — Task 2 BrainRunner integration
- [x] typecheck packages/core — PASSED
- [x] typecheck apps/brain-echo — PASSED
- [x] build turbo (8/8) — PASSED
