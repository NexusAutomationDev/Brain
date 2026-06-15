# Phase 13: Suporte a PgBouncer para Connection Pooling - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Adaptar o Brain Core para ser compatível com PgBouncer na frente do PostgreSQL — modificando como as conexões são criadas e gerenciadas para funcionar com um proxy de connection pooling externo, sem quebrar funcionalidades existentes.

Scope:
- `packages/database` (TenantPoolManager, runMigrations) — compatibilidade postgres.js + migração do advisory lock
- `packages/ai` (createCheckpointer) — PostgresSaver com DATABASE_URL via PgBouncer
- `apps/brain-sdr/src/qualifier.ts` — fix do CR-01 (connection leak)
- ENVs: sem nova variável DATABASE_DIRECT_URL — uma URL só (DATABASE_URL)

Out of scope:
- PgBouncer service no docker-compose (clientes configuram externamente)
- Documentação de deployment/infra do PgBouncer em si
- Suporte a outros proxies (Pgpool-II, Odyssey)

</domain>

<decisions>
## Implementation Decisions

### Compatibilidade postgres.js com PgBouncer

- **D-01:** `prepare: false` é setado **sempre** em todas as instâncias `postgres()` — sem flag ENV, sem branch condicional. postgres.js desabilita prepared statements graciosamente mesmo sem PgBouncer. Elimina o principal bloqueio para transaction mode.
- **D-02:** Sem variável `DATABASE_DIRECT_URL` — uma única `DATABASE_URL` para todas as conexões (postgres.js, PostgresSaver, migrations). Sem bifurcação de config.
- **D-03:** Sem flag ENV como `PGBOUNCER_MODE` — o código é sempre PgBouncer-compatible após esta fase.

### Modo PgBouncer suportado

- **D-04:** Suporte a **ambos os modos**: session mode e transaction mode. Session mode é mais simples e compatível com tudo. Transaction mode requer as mudanças adicionais desta fase (especialmente migrations e CR-01).
- **D-05:** A compatibilidade do PostgresSaver (LangGraph checkpointer, que usa `pg` internamente) com transaction mode **deve ser investigada e testada durante a fase**. Se incompatível, documentar que o checkpointer requer session mode — decisão final no PLAN.md após pesquisa.

### Migrations — substituição do advisory lock

- **D-06:** O `pg_advisory_lock()` em `runMigrations()` é **substituído** por um row-lock em tabela `_schema_lock` (ex: `id=1 INTEGER PRIMARY KEY`). A serialização ocorre via `BEGIN + SELECT ... FOR UPDATE NOWAIT` em loop — lock de linha é transação-scoped, 100% compatível com PgBouncer transaction mode.
- **D-07:** A tabela `_schema_lock` é criada via `CREATE TABLE IF NOT EXISTS` no início de `runMigrations()` — sem nova migration para isso (DDL idempotente direto).
- **D-08:** O comportamento observável de `runMigrations()` permanece idêntico — apenas a mecânica de locking muda. API pública não muda.

### Fix CR-01 — qualifier.ts connection leak

- **D-09:** O `PostgresSaver.fromConnString(dbUrl)` dentro de `runQualificationAgent()` em `qualifier.ts` é fechado em `finally`. Verificar se PostgresSaver expõe método `close()` ou `end()` na versão pinada (`^1.0.1`) — preferir API tipada; se não existir, usar `(saver as any).db?.end?.()`.
- **D-10:** Alternativa avaliada mas descartada: refatorar para `PostgresSaver.fromPool(sql)` — exigiria mudança na assinatura de `runQualificationAgent()` e passagem do `sql` para o qualifier. Fix em `finally` é menor e menos invasivo.

### ENVs e configuração

- **D-11:** `DATABASE_URL` continua sendo a única variável de conexão — aponta diretamente para PostgreSQL em setup simples, ou para PgBouncer em setup produção. Nenhuma nova ENV obrigatória.
- **D-12:** `TenantPoolManager` recebe `prepare: false` no `postgres()` config object — backwards compatible (sem impacto em setup sem PgBouncer).

### Testes

- **D-13:** Testes unitários existentes devem continuar passando — `prepare: false` não muda o comportamento funcional do postgres.js, apenas desabilita prepared statements de cache.
- **D-14:** Testes de integração para validar que migrations rodam com transaction pooling (via `pg_bouncer` mode ou simulado com `pool_mode` setting) são **desejáveis mas não bloqueantes** — planner decide escopo dos testes.

### Claude's Discretion

- Naming da tabela de lock (`_schema_lock`, `schema_migrations_lock`, etc.) — o planner decide
- Estratégia de retry no `SELECT ... FOR UPDATE NOWAIT` (loop com sleep, ou sem retry) — o planner decide
- Se PostgresSaver é incompatível com transaction mode: se documentar limitação ou fazer wrapper — decidir após pesquisa

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Código existente relevante

- `packages/database/src/pool-manager.ts` — TenantPoolManager atual, recebe `prepare: false` em D-12
- `packages/database/src/migrate.ts` — `runMigrations()` com advisory lock a ser substituído (D-06/D-07)
- `packages/ai/src/graph/checkpointer.ts` — `createCheckpointer()` com PostgresSaver, investiga D-05
- `apps/brain-sdr/src/qualifier.ts` — bug CR-01 (D-09), `PostgresSaver.fromConnString()` sem close

### Review da fase anterior

- `.planning/phases/12-brain-sdr-integration/12-REVIEW.md` — CR-01 (crítico), WR-01, WR-02, WR-03 (warnings também podem ser incluídos no escopo desta fase ou no backlog)

### Pitfalls documentados

- `.planning/research/PITFALLS.md` — seção sobre advisory locks e incompatibilidade com PgBouncer transaction mode

### Dependências externas a pesquisar

- `@langchain/langgraph-checkpoint-postgres` v1.0.1 — verificar se usa prepared statements internamente (D-05)
- `postgres.js` docs — configuração de `prepare: false` com PgBouncer
- `pg` (node-postgres) — comportamento com PgBouncer transaction mode

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `TenantPoolManager` (`packages/database/src/pool-manager.ts`) — recebe `prepare: false` adicionado ao `postgres()` call, zero mudança na API pública
- `runMigrations(sql, folder)` (`packages/database/src/migrate.ts`) — substituição interna do lock; assinatura não muda
- `createCheckpointer(connectionString)` (`packages/ai/src/graph/checkpointer.ts`) — pode precisar de flag ou config para desabilitar prepared statements no `pg` driver

### Established Patterns

- `postgres.js` é o driver padrão do projeto (não `bun:sql`) — `prepare: false` é opção nativa do postgres.js
- Fail-fast no startup (process.exit(1)) — manter para erros de conexão
- `try/finally` para fechar conexões — pattern já existe em `saveQualificationToMemories` em `qualifier.ts`

### Integration Points

- `apps/brain-sdr/src/index.ts` — cria `TenantPoolManager` com config hardcoded `max: 10, idle_timeout: 300` — local onde `prepare: false` entra
- `BrainRunner._compileGraph()` — chama `createCheckpointer(dbUrl)` — connection para PostgresSaver

</code_context>

<specifics>
## Specific Ideas

- O padrão `DATABASE_URL` (PgBouncer) + `DATABASE_DIRECT_URL` (PG direto) é o padrão Supabase/Prisma — o usuário deliberadamente rejeitou essa abordagem em favor de uma URL única. O planner deve respeitar isso.
- `prepare: false` sempre ativo é uma escolha de "always compatible" — não é degradação de performance significativa para este workload (agentes de IA com latência de LLM dominante).

</specifics>

<deferred>
## Deferred Ideas

- **WR-01** (`main()` sem `.catch()` em `index.ts`) e **WR-02** (timing attack no bearer token) da Phase 12 review — ficam para backlog como quick tasks; não são bloqueantes para PgBouncer.
- **WR-03** (cobertura de testes para 401/503 no handler) — backlog.
- PgBouncer no docker-compose de desenvolvimento — explicitamente fora do escopo desta fase.
- Suporte a `PGBOUNCER_MODE` ENV para controle explícito do modo — rejeitado em favor de sempre-compatível.

</deferred>

---

*Phase: 13-suporte-a-pgbouncer-para-connection-pooling*
*Context gathered: 2026-06-15*
