# Phase 6: Leads Schema + Migration - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 entrega a fundação de dados para o Brain SDR:
1. Tabela `leads` criada no banco com UNIQUE constraint em `numero` e todos os campos necessários para Phases 7-9
2. Brain verifica/cria tabelas automaticamente na inicialização — nunca aceita mensagens sem schema pronto
3. Race condition prevenida via advisory lock — múltiplas instâncias coordenam sem colisão

Esta fase não implementa cadastro de leads nem validação de mensagens — esses são Phases 7+.

</domain>

<decisions>
## Implementation Decisions

### Schema da tabela `leads`

- **D-01:** `id` = uuid PK DEFAULT gen_random_uuid() — padrão de todas as tabelas do projeto
- **D-02:** `unique_id` = text NOT NULL — vem do campo `IDLead` do payload (webhook/rabbit), nunca gerado pela app. **Revisão de decisão anterior:** STATE.md dizia "nunca do payload direto" — esta sessão definiu que IDLead do payload IS o unique_id (e portanto o thread_id para PostgresSaver)
- **D-03:** `nome` = text nullable — primeira mensagem pode não incluir nome do lead
- **D-04:** `numero` = text NOT NULL + UNIQUE constraint — chave de upsert para identificação do lead
- **D-05:** `ia_ativada` = boolean NOT NULL DEFAULT true — leads criados já estão ativos por padrão; desativação é ação manual explícita
- **D-06:** `fullpp` = boolean nullable — flag "follow up AI" (true/false, sem regra de negócio em v1.1)
- **D-07:** `createdAt`/`updatedAt` = timestamp DEFAULT now() NOT NULL — padrão das outras tabelas
- **D-08:** Tabela `leads` é aditiva — tabela `users` NÃO é removida em v1.1 (decisão de STATE.md mantida)
- **D-09:** Definição Drizzle adicionada em `packages/database/src/schema/tables.ts` e exportada pelo barrel `index.ts` — drizzle-kit generate produz o arquivo SQL da migration

### Auto-migrate na Inicialização

- **D-10:** `runMigrations()` é chamada dentro de `BrainRunner.init()` — o SDK cuida automaticamente para todos os Brains sem boilerplate por app
- **D-11:** Caminho das migrations configurável via ENV `MIGRATIONS_FOLDER` — cada app define no .env (ex: `MIGRATIONS_FOLDER=./src/migrations`)
- **D-12:** Ordem garantida: `runMigrations()` completa → `BrainRunner` continua init → Brain aceita mensagens. Se migration falha, BrainRunner não sobe

### Advisory Lock

- **D-13:** `pg_advisory_lock(KEY)` blocking dentro de `runMigrations()` — segunda instância espera até a primeira terminar de migrar (lock liberado automaticamente quando conexão fecha)
- **D-14:** Lock key = constante numérica fixa arbitrária (Claude decide o número) — advisory locks são por database no PostgreSQL, então isolamento multi-tenant é automático (cada banco do cliente tem seu próprio espaço de locks)
- **D-15:** Arquitetura multi-instância: cliente com 2× Brain SDR no mesmo banco → ambas tentam migrar ao subir → a primeira pega o lock, a segunda aguarda → seguro

### Claude's Discretion

- Número exato do advisory lock key (qualquer constante fixa funciona)
- Estratégia de geração do arquivo SQL da migration (drizzle-kit generate ou raw SQL formatado no padrão existente)
- Mensagem de log quando migration completa vs. quando aguarda no lock

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fase e Requirements

- `.planning/ROADMAP.md` §Phase 6 — Goal, success criteria, requirements LEAD-01 e LEAD-04
- `.planning/REQUIREMENTS.md` §LEAD-01, §LEAD-04 — definição formal dos requirements

### Código existente a modificar/estender

- `packages/database/src/schema/tables.ts` — onde a tabela `leads` deve ser adicionada (padrão pgTable com Drizzle)
- `packages/database/src/migrate.ts` — `runMigrations()` a receber advisory lock e ser chamada por BrainRunner
- `packages/database/src/index.ts` — barrel que exporta tabelas via `export * from './schema/tables.js'` (leads será exportado automaticamente)
- `packages/database/src/migrations/meta/_journal.json` — journal das migrations existentes (nova migration deve seguir o padrão v7)
- `packages/core/src/brain-runner.ts` — onde `runMigrations()` deve ser chamada em `init()`

### Migrations existentes (padrão a seguir)

- `packages/database/src/migrations/0000_lyrical_scrambler.sql` — formato SQL com `CREATE TABLE` + `--> statement-breakpoint`
- `packages/database/src/migrations/meta/_journal.json` — format v7, entries com idx, version, when, tag, breakpoints

### Convenções

- `CLAUDE.md` — constraints de runtime (Bun), convenções de teste, paths

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/database/src/migrate.ts`: `runMigrations(sql: Sql, migrationsFolder: string)` já existe, exportada, aceita sql injetado — apenas adicionar advisory lock antes de `migrate(db, ...)`
- `packages/database/src/index.ts`: barrel já faz `export * from './schema/tables.js'` — leads será exportada automaticamente ao adicionar em tables.ts
- `packages/database/src/schema/tables.ts`: padrão pgTable() com uuid PK, text, boolean, timestamp, uniqueIndex — copiar padrão para `leads`

### Established Patterns

- UUID PK com `uuid('id').primaryKey().defaultRandom()` — padrão de todas as tabelas
- `uniqueIndex()` do drizzle-orm/pg-core para UNIQUE constraints (ver `memories_user_key_idx` em memories)
- Timestamps: `timestamp('created_at').defaultNow().notNull()` + updated_at — padrão em todas as tabelas
- Migrations: SQL gerado pelo drizzle-kit, arquivos com breakpoints (`--> statement-breakpoint`), journal v7

### Integration Points

- `BrainRunner.init()` em `packages/core/src/brain-runner.ts` — ponto de entrada para chamar runMigrations() com sql + MIGRATIONS_FOLDER
- `apps/brain-echo` e futuros apps: precisam definir `MIGRATIONS_FOLDER` no .env e passar sql para BrainRunner
- `packages/database/src/migrate.test.ts`: testes existentes são todos `.todo()` — pode-se implementar testes de integração para o advisory lock

</code_context>

<specifics>
## Specific Ideas

- `fullpp` é uma flag booleana simples ("follow up IA") — não tem regra de negócio em v1.1, apenas persiste o valor
- `unique_id` = IDLead do payload = thread_id para PostgresSaver — é o elo entre lead, conversa e histórico
- Advisory lock é por database no PostgreSQL: clientes com múltiplas instâncias do mesmo Brain são coordenados automaticamente sem config adicional
- BrainRunner recebe `sql` no construtor ou init (já tem para inicializar Drizzle/PostgresSaver) — usar mesma conexão para runMigrations()

</specifics>

<deferred>
## Deferred Ideas

- Remover tabela `users` — deferido para v2 (quando não houver mais referências)
- `unique_id` com validação de formato (ex: só aceitar UUIDs) — v2 se necessário
- Timeout configurável no advisory lock (hoje: blocking indefinido) — avaliar em produção

</deferred>

---

*Phase: 06-leads-schema-migration*
*Context gathered: 2026-06-13*
