# Phase 34: Fundação de Handoff (Agents + DBLink) - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Mode:** `--auto` — all decisions below are Claude's recommended defaults, auto-selected without user interaction. Review before/during planning if anything looks wrong.

<domain>
## Phase Boundary

A infraestrutura de dados para transferência de lead existe e é validável isoladamente — tabela `agents` (registro de destinos configurável via SQL direto, sem redeploy), extensão `dblink` disponível por padrão em todo banco (via migration compartilhada, não a seed mechanism per-brain-type de Phase 33), e a coluna `leads.handoff_context` presente no schema — **antes** de qualquer tool (`transfer_lead`), cliente HTTP, ou fluxo de transferência ser construído. Esse fluxo fica inteiramente para Phase 35.

Esta fase NÃO constrói: a tool `transfer_lead`, nenhum mecanismo de escrita via DBLINK propriamente dito (a query/exec real que grava no banco destino), nenhum endpoint novo, nenhum sub-agente de resumo. Ela constrói apenas o **schema** e uma função de lookup isolada e testável.

</domain>

<decisions>
## Implementation Decisions

### `agents` table shape (HANDOFF-01)
- **D-01:** Colunas: `name text PRIMARY KEY` (o que a tool do LLM referenciará — configurável, nunca um enum de código, per Pitfall 12 de PITFALLS.md), `brain_type text NOT NULL` (tipo do destino, observabilidade/logging), `connection_string text NOT NULL`, `enabled boolean NOT NULL DEFAULT true`, `created_at`/`updated_at timestamp NOT NULL DEFAULT now()`. — **Reversibility:** costly — mudar o formato da PK ou remover uma coluna depois exige migration + qualquer código de Phase 35 que já a consuma.
- **D-02:** `connection_string` substitui o par `base_url`+`admin_token` do sketch original em `ARCHITECTURE.md` §Part B — aquele sketch assumia o mecanismo HTTP que o research recomendava; o usuário confirmou DBLink (ver D-05 abaixo), então a coluna certa é uma connection string usável por `dblink`/`dblink_exec` (formato libpq `key=value`, ex. `host=... port=... dbname=... user=... password=...` — **não** uma URI `postgres://`; dblink é uma extensão C que usa libpq, não um client Node). Confirmar o formato exato fica para a pesquisa/implementação de Phase 35 — Phase 34 só precisa de um `text` sem parsing/validação de formato ainda.
- **D-03 (accepted risk):** `connection_string` fica em texto puro (sem encryption-at-rest) — mesmo padrão de postura de segurança já existente no projeto (`ADMIN_TOKEN`/`DATABASE_URL` são ENV vars em texto puro; `fup_config`/`prompts` são tabelas SQL-editáveis sem UI, mesmo tier operacional). Não é um gap novo introduzido por esta fase — é consistente com o que já existe. Documentar como accepted risk na revisão de segurança desta fase (mesmo padrão de T-33-02/T-33-04 da Phase 33).

### Localização da migration (HANDOFF-01, HANDOFF-02)
- **D-04:** `CREATE EXTENSION IF NOT EXISTS dblink;` e a DDL da tabela `agents` (mais a nova coluna `leads.handoff_context text` nullable) vivem em uma migration NOVA na pasta compartilhada `packages/database/src/migrations/` (próximo tag disponível: `0012_...`, já que a última é `0011_gemini_highdim_halfvec_3072`), aplicada pelo migrator Drizzle já existente (`runMigrations()`/`_schema_lock`). **NÃO** usa o mecanismo de seed per-brain-type criado na Phase 33 (`runBrainSeed()`) — `agents`/`dblink`/`handoff_context` são schema genuinamente compartilhado entre todos os tipos de Brain (qualquer Brain pode ser origem ou destino de um handoff), diferente dos seeds de prompt/fup_config que são especificamente escopados por tipo. — **Reversibility:** one-way — uma vez aplicada em produção, é uma migration real no journal do Drizzle; revert exigiria uma nova migration de rollback, não apenas deletar o arquivo.

### Arquitetura DBLink vs. HTTP — decisão já travada, carregada desta sessão (não é uma decisão nova, é um lembrete crítico)
- **D-05 (locked, carried forward — NÃO re-litigar):** O handoff é **DBLINK-based** (Brain de origem escreve diretamente na tabela `leads` do destino via `dblink`, usando a connection string armazenada em `agents`), **não** o design HTTP-endpoint-first que `.planning/research/ARCHITECTURE.md` §Part B recomendou. Essa decisão foi confirmada pelo usuário e já está documentada em `STATE.md` ("Architecture note... deviates from research/ARCHITECTURE.md"). O endpoint HTTP (`POST /api/v1/handoff`, `BrainRunner.receiveHandoff()`, `handoff-client.ts`) vira HANDOFF-11 (v2, deferred).
  - **Implicação para pesquisa futura (Phase 35):** `.planning/research/PITFALLS.md` Pitfall 5 foi escrito assumindo que o research's próprio HTTP-recommendation seria seguido ("Model the handoff as an API/message contract, not a database credential" — literalmente o oposto do que foi decidido). Os "How to avoid" de Pitfalls 6-11 também prescrevem mitigações específicas do modelo HTTP (ack síncrono via response, endpoint dedicado, etc.) que precisam ser **re-derivadas** para o modelo DBLink por quem planejar Phase 35 — não reaproveitar essas seções literalmente. Isso não afeta Phase 34 (que não constrói lógica de transferência), mas é essencial para o researcher/planner de Phase 35 não seguir cegamente uma seção do research que o usuário já rejeitou.
  - Phase 34 em si é neutra a essa escolha na maior parte — a tabela `agents` com `connection_string` (D-01/D-02) já reflete a decisão DBLink diretamente.

### Função de lookup isolada (HANDOFF-04)
- **D-06:** Construir uma função pequena e testável agora (ex. `packages/database/src/agents.ts` — `getAgentConnection(sql, name)`), que resolve: nome desconhecido → rejeição clara (`{ok:false, reason:'not_found'}`); nome com `enabled=false` → rejeição clara (`{ok:false, reason:'disabled'}`); nome válido e habilitado → retorna a connection string + brain_type. **Sem** wiring em nenhuma tool/LLM ainda — isso é Phase 35. Isso é o que torna a fase "validável isoladamente" per o Goal do ROADMAP.md.
- **D-07:** Leitura sempre live (query direta na tabela a cada chamada), nunca snapshotada em compile-time — mesmo padrão recomendado em `ARCHITECTURE.md` (evita a classe de bug "preciso de /reload-prompts pra um agente novo funcionar").

### HANDOFF-10 no escopo de Phase 34
- **D-08:** Phase 34 não tem nenhum código que consome `thread_id` (nenhuma tool existe ainda — isso é Phase 35). HANDOFF-10 ("thread_id sempre do contexto de execução, nunca do LLM") é capturado aqui como uma **constraint documentada e travada para Phase 35 seguir**, não como código a escrever nesta fase. A verificação de Phase 34 deve tratar HANDOFF-10 como "documentado para Phase 35 — N/A em código nesta fase", não como um item não satisfeito. Phase 35's planner/verifier DEVE aplicar o mesmo padrão D-04 já usado por `pause-session.ts`/`finish-conversation.ts` (thread_id de `config.configurable.thread_id`, nunca de um argumento de tool).

### Claude's Discretion
- Nome exato do arquivo de migration e do módulo de lookup (`agents.ts` vs. outro nome) — Claude decide no planning seguindo convenções já existentes (`seed.ts`, `migrate.ts`).
- Se `leads.handoff_context` e a `agents` table entram na mesma migration física ou em duas — não afeta nenhum requirement; Claude decide durante `drizzle-kit generate`.
- Exato shape do tipo TypeScript de retorno de `getAgentConnection()` (discriminated union vs. throw) — seguir o idioma já estabelecido em `seed.ts` (throw) ou em `lead-service.ts` (retorno estruturado); Claude escolhe o que for mais consistente com o call site de Phase 35 quando isso for pesquisado.

### Reviewed Todos (not folded)
- `.planning/todos/pending/2026-08-13-fix-fup-e2e-test-brain-type-column-and-on-conflict-target.md` — score 0.6 no `todo.match-phase`, mas é sobre um bug pré-existente e não-relacionado em `fup-e2e.test.ts` (coluna `brain_type` inexistente em `leads`, target de `ON CONFLICT` inválido). Não relacionado ao escopo desta fase (schema de `agents`/`dblink`); revisado e excluído — o match é apenas overlap de keywords genéricas ("leads", "brain", "type").

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pesquisa do milestone v1.6
- `.planning/research/ARCHITECTURE.md` §"Part B — Multi-agent lead handoff" — desenho completo do handoff; **ATENÇÃO:** a recomendação de mecanismo (HTTP endpoint, `handoff-client.ts`, `BrainRunner.receiveHandoff()`) foi **overridden** pelo usuário (ver D-05) — DBLink é o mecanismo real. As seções sobre a tabela `agents` (motivação, "configurable names" requirement), `setIaAtivada()` como primeiro caller real (TD-04), `IEventPublisher`/whitelist, e o "Suggested build order across phases" permanecem válidas.
- `.planning/research/PITFALLS.md` Pitfalls 5-12 (seção "Handoff feature phase") — **ATENÇÃO:** Pitfall 5 recomenda literalmente o oposto do que foi decidido (D-05); os "How to avoid" de Pitfalls 6-11 assumem o modelo HTTP e precisam ser re-derivados para DBLink por quem pesquisar/planejar Phase 35. Pitfall 12 (configurable names, não hardcoded) é diretamente relevante a esta fase e já satisfeito pelo design da tabela `agents` (D-01).
- `.planning/STATE.md` §"Milestone v1.6 — Phases" — "Architecture note (confirmed by user...)" — registro formal da decisão DBLink-vs-HTTP (D-05).

### Requisitos e roadmap
- `.planning/REQUIREMENTS.md` §"HANDOFF — Transferência de Lead entre Agentes" (HANDOFF-01, 02, 04, 10 nesta fase; 03/05-09 em Phase 35; 11-14 são v2/out-of-scope)
- `.planning/ROADMAP.md` §"Phase 34: Fundação de Handoff (Agents + DBLink)" — goal e success criteria formais
- `.planning/PROJECT.md` §"Out of Scope" — "UI de gerenciamento de Brains — futuro" confirma que `agents` não tem UI nesta fase (SQL direto, mesmo tier de `fup_config`)

### Código existente relevante
- `packages/database/src/schema/tables.ts` — schema atual (`leads` linha 77-108, sem `brain_type`, `unique_id` **sem** unique constraint — só `numero` tem via `leads_numero_unique_idx`; `prompts` linha 65-74; `fupConfig` linha 134+)
- `packages/database/src/migrations/meta/_journal.json` — última migration aplicada: `0011_gemini_highdim_halfvec_3072` (idx 11) — próxima é `0012`
- `packages/database/src/migrate.ts` — `runMigrations()`/`_schema_lock` row-lock, mecanismo que a nova migration usa (sem mudança nele)
- `packages/database/src/seed.ts` — `runBrainSeed()` (Phase 33) — **não** usado por esta fase, mas é o precedente de "onde NÃO colocar" schema compartilhado
- `packages/core/src/leads/lead-service.ts` — `setIaAtivada()` (linha ~152-157, dead code hoje, TD-04) — ganha seu primeiro caller real em Phase 35, não nesta fase
- `packages/core/src/tools/pause-session.ts`, `finish-conversation.ts` — padrão de tool factory + thread_id de `config.configurable` (precedente D-04/HANDOFF-10 para Phase 35)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Padrão `_schema_lock` row-lock de `migrate.ts` — a nova migration reaproveita o mesmo mecanismo de aplicação idempotente, sem novo lock.
- Padrão de módulo standalone testável já estabelecido por `seed.ts` (Phase 33) — `agents.ts`/lookup function segue a mesma filosofia (função pura, `sql` injetado, testável sem mock pesado).

### Established Patterns
- Tabelas operacionais SQL-editáveis sem UI (`fup_config`, `prompts`) são o precedente direto para `agents` — mesmo tier operacional, mesma ausência de CRUD UI em v1.
- `uniqueIndex` via `(table) => ({...})` no schema Drizzle (ex. `leads_numero_unique_idx`) é o idioma para constraints — usar o mesmo padrão se `agents.name` precisar de índice explícito (embora `PRIMARY KEY` já implique unicidade).

### Integration Points
- Nenhum — esta fase é puramente aditiva ao schema (nova tabela + nova extensão + nova coluna nullable em `leads`), sem tocar em `BrainRunner`, tools, ou qualquer runtime path existente. Isso é o que a torna "validável isoladamente".

</code_context>

<specifics>
## Specific Ideas

Nenhuma referência específica de UI/UX/conteúdo — esta é uma fase de infraestrutura de dados pura, sem superfície visível ao usuário final.

</specifics>

<deferred>
## Deferred Ideas

Nenhuma nova ideia de scope creep surgiu durante esta análise `--auto`. HANDOFF-11 (endpoint HTTP opcional), HANDOFF-12 (handoff bidirecional), HANDOFF-13 (limite de hops), HANDOFF-14 (UI de admin) já estão documentados como v2/out-of-scope em `REQUIREMENTS.md` — não são novos.

</deferred>

---

*Phase: 34-Fundação de Handoff (Agents + DBLink)*
*Context gathered: 2026-08-13*
