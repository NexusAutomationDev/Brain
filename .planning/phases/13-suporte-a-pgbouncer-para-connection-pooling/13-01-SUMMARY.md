---
phase: 13-suporte-a-pgbouncer-para-connection-pooling
plan: "01"
subsystem: database
tags: [pgbouncer, connection-pooling, row-lock, migrations, tdd]
dependency_graph:
  requires: []
  provides:
    - TenantPoolManager com prepare:false (PgBouncer-compatible)
    - runMigrations() com row-lock via _schema_lock
    - documentação de compatibilidade PgBouncer em createCheckpointer()
  affects:
    - packages/database/src/pool-manager.ts
    - packages/database/src/migrate.ts
    - packages/ai/src/graph/checkpointer.ts
tech_stack:
  added: []
  patterns:
    - Row-lock via SELECT FOR UPDATE NOWAIT dentro de sql.begin()
    - DDL idempotente (CREATE TABLE IF NOT EXISTS) fora de transação
    - prepare:false no postgres.js para compatibilidade com PgBouncer
key_files:
  created: []
  modified:
    - packages/database/src/pool-manager.ts
    - packages/database/src/migrate.ts
    - packages/database/src/migrate.test.ts
    - packages/database/src/pool-manager.test.ts
    - packages/ai/src/graph/checkpointer.ts
decisions:
  - prepare:false sempre ativo no TenantPoolManager — sem condicional por ENV
  - Row-lock via _schema_lock substitui pg_advisory_lock — compatível com PgBouncer transaction mode
  - DDL de _schema_lock executado fora de transação (Pitfall 4 — DDL autocommit)
  - Retry até 3 tentativas com 200ms sleep em erro 55P03 (lock_not_available)
  - createCheckpointer() documenta limitação do PostgresSaver com PgBouncer transaction mode < 1.21
metrics:
  duration: ~25min
  completed: "2026-06-15T21:24:04Z"
  tasks_completed: 2
  files_modified: 5
---

# Phase 13 Plan 01: PgBouncer Compatibility — pool-manager, migrate, checkpointer

TDD completo: prepare:false no TenantPoolManager, row-lock _schema_lock em runMigrations(), documentação PgBouncer em createCheckpointer().

## What Was Built

Eliminação dos dois bloqueios para PgBouncer:

1. **`prepare: false` no TenantPoolManager** (`pool-manager.ts`): O método `getPool()` agora sempre cria instâncias `postgres()` com `prepare: false` — desabilitando prepared statements no nível do driver. Compatível com PgBouncer em qualquer modo (session, transaction, statement).

2. **Row-lock via `_schema_lock`** (`migrate.ts`): O `pg_advisory_lock` foi completamente removido. A nova implementação:
   - Cria a tabela `_schema_lock` idempotentemente via `CREATE TABLE IF NOT EXISTS` **fora** de transação (DDL autocommit — Pitfall 4 do RESEARCH.md)
   - Insere `id=1` com `ON CONFLICT DO NOTHING`
   - Adquire lock via `SELECT id FROM _schema_lock WHERE id = 1 FOR UPDATE NOWAIT` **dentro** de `sql.begin()`
   - Retry automático até 3 tentativas com 200ms sleep em erro PostgreSQL 55P03
   - Bloco CLI agora usa `prepare: false` (PGB-05)

3. **Documentação PgBouncer** (`checkpointer.ts`): JSDoc expandido documentando que o `PostgresSaver` usa o driver `pg` (node-postgres) internamente — sem opção de desabilitar prepared statements em pg v8.21 — e listando as configurações PgBouncer suportadas (session mode recomendado; transaction mode requer PgBouncer >= 1.21 com `max_prepared_statements > 0`).

## Tests

- `migrate.test.ts`: 7 testes adaptados de pg_advisory_lock para row-lock (_schema_lock). Mock `sql.begin()` com Proxy para rastrear queries dentro da transação. Teste estático PGB-05 verifica `prepare: false` no CLI via `readFileSync`.
- `pool-manager.test.ts`: 7 stubs `it.todo()` substituídos por implementações reais. Mock do módulo `postgres` com `capturedConfigs` para verificar `prepare: false`. Testes PGB-01 (2 testes), DB-03 (3 testes), DB-04 (1 teste).
- **Total: 38 testes passando, 0 falhas** (inclui testes pré-existentes de `index.test.ts`)

## Deviations from Plan

None — plan executed exactly as written.

O TDD RED→GREEN foi executado conforme especificado:
- **RED**: Testes adaptados/implementados → 7 falhas confirmadas
- **GREEN**: Implementação adicionada → 14/14 novos testes passando, 38 total

## Known Stubs

None.

## Threat Surface Scan

Nenhuma nova superfície de ataque introduzida. As mudanças são internas à camada de banco de dados:
- `_schema_lock` é uma tabela interna de controle, não exposta via API
- `prepare: false` reduz superfície de ataque (elimina prepared statement cache)
- Ameaças T-13-01-01 a T-13-01-04 do threat model do plano foram mitigadas conforme especificado

## Self-Check: PASSED

Arquivos verificados:
- `/root/Brain/packages/database/src/pool-manager.ts` — `prepare: false` presente
- `/root/Brain/packages/database/src/migrate.ts` — `_schema_lock`, `FOR UPDATE NOWAIT`, zero `pg_advisory_lock`
- `/root/Brain/packages/database/src/migrate.test.ts` — `_schema_lock` presente, `pg_advisory_lock` apenas em teste de negação
- `/root/Brain/packages/database/src/pool-manager.test.ts` — `prepare` presente, zero `it.todo`
- `/root/Brain/packages/ai/src/graph/checkpointer.ts` — `PgBouncer` e `session mode` presentes

Commits verificados:
- `c64e609` — ✅ test(13-01): RED — adaptar migrate.test.ts e implementar pool-manager.test.ts
- `a20cf45` — ✨ feat(13-01): GREEN — PgBouncer compatibility: prepare:false + row-lock + doc
