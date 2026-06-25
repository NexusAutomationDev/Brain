---
phase: 19-database-foundation
plan: "01"
subsystem: database
tags: [migration, schema, drizzle, pgvector, rag, fup, knowledge-chunks, fup-config]
dependency_graph:
  requires: []
  provides:
    - "migration 0007_v1_4_foundation — DDL para knowledge_chunks, fup_config e colunas FUP em leads"
    - "knowledgeChunks Drizzle table — consumível por Phase 21 (RAG ingest + search)"
    - "fupConfig Drizzle table — consumível por Phase 22 (FUP Automático scheduler)"
    - "leads.fupEnabled, leads.fupStep, leads.fupNextAt, leads.lastMessageAt — estado FUP por lead"
  affects:
    - "Phase 20 (Tool Events) — sem dependência direta deste schema"
    - "Phase 21 (RAG) — knowledge_chunks é a tabela de ingestão e busca semântica"
    - "Phase 22 (FUP Automático) — fup_config + colunas leads são o estado do scheduler"
tech_stack:
  added: []
  patterns:
    - "integer[] via Drizzle .array() para intervalos de FUP em segundos"
    - "text[] via Drizzle .array() para dias permitidos no scheduler"
    - "text PRIMARY KEY para fup_config.brain_type — desvio consciente de UUID padrão"
    - "nullable timestamptz para fup_next_at e last_message_at — leads existentes sem valor"
    - "vector(EMBEDDING_DIM) com EMBEDDING_DIM=1536 hardcoded no SQL (ENV não disponível em DDL estático)"
key_files:
  created:
    - packages/database/src/migrations/0007_v1_4_foundation.sql
    - packages/database/src/__tests__/integration/migration-v14.test.ts
  modified:
    - packages/database/src/migrations/meta/_journal.json
    - packages/database/src/schema/tables.ts
decisions:
  - "D-02: fup_config usa brain_type text PK em vez de UUID — simplifica upsert por tipo de Brain"
  - "D-08: vector(1536) hardcoded no SQL — EMBEDDING_DIM ENV não disponível em arquivo SQL estático"
  - "D-09: sem índice HNSW na migration — criado manualmente pós-ingestão em produção (Out of Scope)"
  - "D-16: fup_config.enabled para ativar/desativar por brain_type sem perder configuração"
  - "Migration manual (não drizzle-kit generate) — projeto usa migrations SQL manuais com journal"
metrics:
  duration: "~20 min"
  completed_date: "2026-06-23"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 2
  tests_added: 13
  commits: 3
---

# Phase 19 Plan 01: Database Foundation Schema Summary

**One-liner:** Migration SQL manual `0007_v1_4_foundation` criando `knowledge_chunks` (RAG), `fup_config` (scheduler FUP) e 4 colunas FUP em `leads`, com definições Drizzle correspondentes em `tables.ts`.

## What Was Built

Quatro artefatos constituem o schema estável para v1.4:

### 1. `packages/database/src/migrations/0007_v1_4_foundation.sql`

Migration SQL manual com DDL completo para as 3 features de v1.4:

- **`CREATE TABLE knowledge_chunks`**: base de conhecimento RAG com `embedding vector(1536)`, `collection`, `content`, `embedding_model`, `chunk_index`, `total_chunks`, timestamps. Sem índice HNSW (Out of Scope — criado manualmente pós-ingestão).
- **`CREATE TABLE fup_config`**: configuração do scheduler FUP com `brain_type text PRIMARY KEY`, `enabled`, `intervals_seconds integer[]`, `min_hour`, `max_hour`, `allowed_days text[]`, `timezone`, timestamps.
- **4 ADD COLUMNs em `leads`**: `fup_enabled boolean NOT NULL DEFAULT false`, `fup_step integer NOT NULL DEFAULT 0`, `fup_next_at timestamptz` (nullable), `last_message_at timestamptz` (nullable).

### 2. `packages/database/src/migrations/meta/_journal.json`

Entry `idx=7` adicionada para `0007_v1_4_foundation`. Journal agora com 8 entries (idx 0–7). `runMigrations()` aplicará a migration automaticamente no próximo startup sem nenhuma alteração no runner.

### 3. `packages/database/src/schema/tables.ts`

- Import de `integer` adicionado ao `drizzle-orm/pg-core`
- Tabela `leads` estendida com 4 colunas FUP (dentro do objeto de colunas existente)
- Nova exportação `knowledgeChunks` com `vector('embedding', { dimensions: EMBEDDING_DIM })`
- Nova exportação `fupConfig` com `integer('intervals_seconds').array()` e `text('allowed_days').array()`

O `index.ts` exporta tudo via `export * from './schema/tables.js'` — `knowledgeChunks` e `fupConfig` são automaticamente disponíveis em `@brain-pkg/database`.

### 4. `packages/database/src/__tests__/integration/migration-v14.test.ts`

13 testes de scaffold Wave 0 que verificam a existência e conteúdo dos artefatos via `fs.readFileSync` — sem banco de dados real. Todos passam GREEN após as Tasks 2 e 3.

## Decisions Implemented

| Decision | Implementação |
|----------|---------------|
| D-02 | `brainType: text('brain_type').primaryKey()` — sem UUID separado em fupConfig |
| D-03 | `intervalsSeconds: integer('intervals_seconds').array().notNull()` |
| D-04 | `allowedDays: text('allowed_days').array().notNull()` |
| D-05 | `timezone: text('timezone').notNull()` — IANA string |
| D-06 | `minHour`, `maxHour`: `integer` 0–23 |
| D-07 | `knowledge_chunks` sem `source_id` — re-ingestão por DELETE+INSERT (YAGNI) |
| D-08 | `vector(1536)` hardcoded no SQL; `vector('embedding', { dimensions: EMBEDDING_DIM })` no Drizzle |
| D-09 | Sem índice HNSW na migration — Out of Scope |
| D-10 | `fup_enabled NOT NULL DEFAULT false`, `fup_step NOT NULL DEFAULT 0` |
| D-11 | `fup_next_at` e `last_message_at` são nullable — leads existentes não têm esses valores |
| D-15 | Migration nomeada `0007_v1_4_foundation.sql` — arquivo único com todo DDL de v1.4 |
| D-16 | `fup_config.enabled` — ativar/desativar por brain_type sem deletar config |

## Deviations from Plan

### Restauração de Arquivos de Planejamento

**Encontrado durante:** Task 1 (commit inicial)

**Problema:** O `git reset --soft` executado durante o ajuste de base do worktree deixou as remoções dos arquivos de planejamento (`.planning/phases/19-database-foundation/`) como staged. O commit da Task 1 incluiu inadvertidamente a deleção desses 6 arquivos.

**Fix:** Restaurados via `git checkout b5ed4bb -- .planning/phases/19-database-foundation/` e commitados em `c68299e`.

**Impacto:** Nenhum — arquivos de planejamento foram restaurados integralmente antes das Tasks 2 e 3.

**Classificação:** [Rule 3 - Blocking Issue] correção de problema que afetou os arquivos de estado do projeto.

## Known Stubs

Nenhum. Todos os artefatos entregues são DDL e definições de schema completos — sem valores hardcoded de placeholder, sem lógica pendente neste plano.

## Threat Surface Scan

Nenhuma nova superfície de rede, endpoint HTTP, ou caminho de autenticação introduzida. As mitigações T-19-01 e T-19-04 do threat model foram implementadas: migration é arquivo estático commitado no git (sem interpolação), journal commitado no git com entry única idx=7.

## Verification

```bash
# 13 scaffold tests GREEN
bun test ./packages/database/src/__tests__/integration/migration-v14.test.ts
# 13 pass, 0 fail

# Verificação manual dos artefatos
grep -c 'CREATE TABLE' packages/database/src/migrations/0007_v1_4_foundation.sql
# → 2

grep '0007_v1_4_foundation' packages/database/src/migrations/meta/_journal.json
# → "tag": "0007_v1_4_foundation"

grep 'knowledgeChunks\|fupConfig' packages/database/src/schema/tables.ts
# → export const knowledgeChunks, export const fupConfig

grep 'fupEnabled\|fupStep\|fupNextAt\|lastMessageAt' packages/database/src/schema/tables.ts
# → todos os 4 campos
```

## Notes for Downstream Phases

- **Phase 20 (Tool Events):** Nenhuma dependência direta deste schema. Fase independente.
- **Phase 21 (RAG):** Usar `knowledgeChunks` de `@brain-pkg/database` para ingestão (POST /api/v1/ingest) e busca semântica (`search_knowledge` tool). Índice HNSW deve ser criado manualmente em produção após primeira ingestão.
- **Phase 22 (FUP Automático):** Usar `fupConfig` para configuração do scheduler e `leads.fupEnabled`, `leads.fupStep`, `leads.fupNextAt`, `leads.lastMessageAt` para controle de estado por lead. `LeadService.touchLastMessage()` (D-12, D-13) será implementado nesta fase.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| 0007_v1_4_foundation.sql existe | FOUND |
| migration-v14.test.ts existe | FOUND |
| _journal.json existe | FOUND |
| tables.ts existe | FOUND |
| Commit 4ce96c3 (Task 1 TDD RED) | FOUND |
| Commit 4d53940 (Task 2 migration SQL) | FOUND |
| Commit 5c5bcc5 (Task 3 tables.ts) | FOUND |
| 13 scaffold tests GREEN | 13 pass, 0 fail |
