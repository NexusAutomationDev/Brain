# Phase 19: Database Foundation - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Criar todas as tabelas e colunas necessárias para RAG, Tool Events e FUP em uma única migration (`0007_v1_4_foundation`) — schema estável disponível para todos os Brains antes que qualquer feature de v1.4 seja implementada. Não inclui lógica de negócio além de `LeadService.touchLastMessage()` e atualização de `tables.ts`.

</domain>

<decisions>
## Implementation Decisions

### fup_config — Escopo e Estrutura

- **D-01:** `fup_config` é por `brain_type` — não singleton. Cada tipo de Brain (SDR, Suporte, etc.) pode ter configuração de FUP própria.
- **D-02:** `brain_type` é a Primary Key da tabela (text PK) — sem UUID separado. Upsert por brain_type.
- **D-03:** Intervalos de follow-up armazenados como `integer[]` na coluna `intervals_seconds`. Ex: `{3600, 86400, 259200}` = 3 steps. Phase 22 acessa por índice de array.
- **D-04:** Dias permitidos armazenados como `text[]` na coluna `allowed_days`. Ex: `{'mon','tue','wed','thu','fri'}`. Phase 22 verifica com `allowed_days.includes(dayOfWeek)`.
- **D-05:** Fuso horário armazenado como `text` (IANA timezone string). Ex: `'America/Sao_Paulo'`.
- **D-06:** Horários min/max armazenados como `integer` (hora do dia, 0–23). Ex: `min_hour = 8`, `max_hour = 18`.

### knowledge_chunks — Estrutura

- **D-07:** Sem campo `source_id` para deduplicação. Re-ingestão faz `DELETE WHERE collection = ?` e re-insere todos os chunks. YAGNI — RAG-F01 (re-indexação por documento) é requisito futuro.
- **D-08:** Dimensão do vetor usa o mesmo `EMBEDDING_DIM` do ENV `EMBEDDING_DIMENSIONS` (default 1536), consistente com a tabela `embeddings` existente.
- **D-09:** Sem índice HNSW na migration — Out of Scope em REQUIREMENTS.md. Index criado manualmente pós-ingestão em produção.

### leads — Novas Colunas FUP

- **D-10:** Adicionar colunas à tabela `leads`: `fup_enabled boolean NOT NULL DEFAULT false`, `fup_step integer NOT NULL DEFAULT 0`, `fup_next_at timestamptz`, `last_message_at timestamptz`.
- **D-11:** `last_message_at` é distinto de `updatedAt` — rastreia especificamente quando o humano enviou uma mensagem (não mudanças programáticas como setIaAtivada).

### LeadService.touchLastMessage()

- **D-12:** Novo método `touchLastMessage(uniqueId: string)` no LeadService atualiza `last_message_at = NOW()` por `uniqueId`.
- **D-13:** `BrainRunner.run()` chama `touchLastMessage()` ANTES do gate `ia_ativada` — FUP-06 exige "a cada mensagem recebida", incluindo quando ia_ativada=false.

### tables.ts e Migration

- **D-14:** `packages/database/src/schema/tables.ts` é atualizado com as novas tabelas (`knowledgeChunks`, `fupConfig`) e colunas adicionais em `leads` nesta fase — Drizzle ORM disponível para Phases 20/21/22.
- **D-15:** Migration nomeada `0007_v1_4_foundation.sql` — arquivo único com todo o DDL de v1.4.

### Claude's Discretion

- Tipos exatos de coluna para campos não mencionados (createdAt, updatedAt em knowledge_chunks)
- Constraints de validação SQL (CHECK) para min_hour/max_hour se necessário
- Nomenclatura exata das colunas em snake_case seguindo padrão do projeto

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e Roadmap

- `.planning/REQUIREMENTS.md` — FUP-01, FUP-04, FUP-06: definições exatas das colunas e comportamentos de FUP; seção Out of Scope para HNSW index
- `.planning/ROADMAP.md` §Phase 19 — Success Criteria: lista exata de tabelas, colunas e comportamentos esperados

### Schema Existente

- `packages/database/src/schema/tables.ts` — tabelas existentes; novas tabelas seguem o mesmo padrão
- `packages/database/src/migrations/meta/_journal.json` — journal de migrations; próxima entrada é idx=7

### Migration Existente (referência de padrão)

- `packages/database/src/migrations/0006_leads_cols_remove_users.sql` — exemplo de migration que altera tabela existente (ADD COLUMN, DROP TABLE)
- `packages/database/src/migrations/0001_lazy_deathstrike.sql` — exemplo de migration que cria nova tabela

### LeadService e BrainRunner

- `packages/core/src/leads/lead-service.ts` — onde adicionar `touchLastMessage()`
- `packages/core/src/runner/runner.ts` — onde chamar `touchLastMessage()` ANTES do gate ia_ativada (linha ~183)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/database/src/schema/tables.ts`: padrão de definição de tabelas com Drizzle (pgTable, uuid PK, timestamps padrão, indexes)
- `packages/database/src/schema/tables.ts` tabela `embeddings`: padrão de uso de `vector('embedding', { dimensions: EMBEDDING_DIM })` para colunas vetoriais — reutilizar em `knowledge_chunks`
- `packages/core/src/leads/lead-service.ts`: classe LeadService com sql injetado e métodos de update atômico — `touchLastMessage()` segue o mesmo padrão de `setFullpp()` e `setIaAtivada()`
- `packages/database/src/migrate.ts`: `runMigrations()` usa drizzle migrator — a nova migration é automaticamente aplicada no startup sem mudança no runner

### Established Patterns

- PK: `uuid('id').primaryKey().defaultRandom()` exceto em fup_config onde PK é `text('brain_type')` (D-02)
- Timestamps: `createdAt` e `updatedAt` com `.defaultNow().notNull()` em todas as tabelas
- EMBEDDING_DIM: lido de `process.env.EMBEDDING_DIMENSIONS || '1536'` — mesma lógica para knowledge_chunks
- Arrays no Drizzle PG: `integer('field', { mode: 'array' })` ou Drizzle pg-core `integer[]` — verificar sintaxe exata
- Migration SQL: usa `CREATE TABLE IF NOT EXISTS` não — usa `CREATE TABLE` diretamente (migration é idempotente via journal)

### Integration Points

- `BrainRunner.run()` linha ~183: após `upsertLead()`, antes do `if (!lead.iaAtivada)` — ponto de inserção de `touchLastMessage()`
- `packages/database/src/migrations/meta/_journal.json`: adicionar entry idx=7 para `0007_v1_4_foundation`

</code_context>

<specifics>
## Specific Ideas

- `fup_config` com `brain_type text PRIMARY KEY` em vez de UUID — desvio consciente do padrão para simplificar upsert por tipo
- `knowledge_chunks` intencionalmente separada de `embeddings` — concerns diferentes (memória de conversa vs base de conhecimento RAG)
- `allowed_days text[]` com valores 'mon','tue','wed','thu','fri','sat','sun' — consistente com convenção ISO weekday abreviada

</specifics>

<deferred>
## Deferred Ideas

- `source_id` em knowledge_chunks para deduplicação por documento — RAG-F01, requisito futuro
- Índice HNSW em knowledge_chunks — Out of Scope, criado manualmente pós-ingestão
- `fup_steps` como tabela separada — desnecessário com integer[]; reconsiderar se steps precisarem de metadados próprios
- Boolean columns por dia da semana — alternativa ao text[] se queries individuais por dia forem necessárias

</deferred>

---

*Phase: 19-database-foundation*
*Context gathered: 2026-06-23*
