# Milestones

## v1.5 Embedding SDK + Brain Suporte + Tech Debt (Shipped: 2026-07-02)

**Phases completed:** 6 phases (27-32), 21 plans, 140 commits
**Timeline:** 2026-06-29 → 2026-07-02 (~3 days)
**Files changed:** 158 files, +21.037 / -493 linhas

**Key accomplishments:**

1. **Tech Debt Fixes** (Phase 27): `BRAIN_TOOLS` whitelist agora cobre closures bound diretamente em `buildGraph()` via `enabledTools` em `BrainBuildContext`; teste de integração E2E do FupScheduler contra PostgreSQL real; `GET /health` expõe `transport: connected/disconnected` (TECH-01, TECH-02, TECH-03)
2. **Embedding SDK** (Phase 28): `packages/embeddings` com `IEmbeddingProvider` (adapters OpenAI + Gemini), migration `0009` deriva `vector(N)` de `EMBEDDING_DIMENSIONS`, `BrainRunner` conecta o semantic write path via `embeddingProvider.embed()`/`embedQuery()` — fecha MEM-03 e D-16 de v1.4 (EMBD-01..EMBD-05)
3. **Brain Suporte Core** (Phase 29): segundo Brain real (`apps/brain-support`) — webhook + RabbitMQ, `search_knowledge` estruturalmente sempre ativo, `pause_session`/`finish_conversation` nativas em `buildGraph()`, `RESERVED_TOOL_NAMES` protegendo contra shadowing por MCP, `BrainOutput` validado, histórico via PostgresSaver (SUP-01..SUP-05, SUP-07, SUP-08)
4. **Brain Suporte Docker** (Phase 30): Dockerfile multi-stage independente com `packages/embeddings` incluído, `docker-compose.yml` próprio, CI/CD (`publish-brain-support.yml`) e validação e2e real (build → migrate → /health → /api/v1/webhook) (SUP-06)
5. **Pre-Client Onboarding Hardening** (Phase 31, gap closure): CI shell hygiene (quote `$RESPONSE` + validação de URL) e proteção append-after-filter para a tool `respond` em ambos os Brains — fecha os achados do audit v1.5 marcados como bloqueadores para onboarding real (TECH-04, TECH-05)
6. **Code Quality Cleanup** (Phase 32, gap closure): zera o ledger de tech debt do v1.5 — SIGTERM idempotency, RabbitMQ retry-key collision, `WebhookTransport` stale status, `reembed.ts` MAX_PAGES cap, truncamento em `search-knowledge.ts`, validação de dimensão Gemini, `RESERVED_TOOL_NAMES` derivado, type-guards unificados, frontmatter retroativo e fix de `mock.module` cross-pollution entre testes (TECH-06)

### Known Gaps (Tech Debt)

Nenhum item de tech debt aberto ao final do milestone — v1.5 incluiu dois ciclos de gap-closure (Phases 31-32) especificamente para zerar os achados do próprio audit (`milestones/v1.5-MILESTONE-AUDIT.md`). Itens residuais não-bloqueantes:

- `fup-e2e.test.ts` não roda contra o sandbox DB local devido a um problema pré-existente e não-relacionado de estado de schema Postgres (`relation "agent_state" already exists`) — isolamento de teste confirmado via inspeção de código
- Cobertura de Nyquist validation permanece parcial entre as fases do v1.5 (só Phase 28 tem `VALIDATION.md`)
- EMBD-03 (migration `0009` com `vector(1536)` hardcoded no momento do `generate`) e SUP-03 (tools nativas em vez de MCP dinâmico) permanecem como overrides aceitos, documentados em 28-VERIFICATION.md e 29-VERIFICATION.md

---

## v1.4 RAG + Eventos de Tools + FUP Automático (Shipped: 2026-06-25)

**Phases completed:** 8 phases (19-26), 18 plans, 157 commits
**Timeline:** 2026-06-23 → 2026-06-25 (3 days)
**Files changed:** 181 files, +24.233 / -12.268 linhas

**Key accomplishments:**

1. **Database Foundation** (Phase 19): Migration 0007 com schema completo de v1.4 — tabelas `knowledge_chunks` (pgvector 1536d), `fup_config` (intervalos, timezone IANA, janela horária) e colunas FUP em `leads` (fup_enabled, fup_step, fup_next_at, last_message_at); `LeadService.touchLastMessage()` integrado ao BrainRunner antes do gate ia_ativada (FUP-04, FUP-06)
2. **Tool Events Canal de Saída** (Phase 20): `IEventPublisher` com dois adapters (webhook fire-and-forget via AbortSignal 5s + RabbitMQ confirm via rabbitmq-client) e `NoopEventPublisher` como fallback — BrainRunner publica ToolMessages da whitelist (qualify_lead, pause_session, finish_conversation) com `event_id = threadId:tool_call_id` (EVT-01..EVT-04)
3. **RAG — Base de Conhecimento Semântica** (Phase 21): `POST /api/v1/ingest` chunka texto, gera embeddings via provider configurável e armazena em pgvector com metadados (collection_name, embedding_model, chunk_index, total_chunks); `createSearchKnowledgeTool(sql)` faz cosine similarity search em múltiplas coleções — 16 testes TDD (RAG-01..RAG-04)
4. **FUP Automático** (Phase 22): `FupScheduler` background com SELECT FOR UPDATE SKIP LOCKED (multi-instância safe), geração LLM one-shot via `PostgresSaver.getTuple()`, slot calculation IANA timezone com `Intl.DateTimeFormat`, retry até 3x com `fup_failure_count`, desativação automática no último FUP e EVT-03 fire-and-forget (FUP-01..FUP-08)
5. **RAG Wiring Fix** (Phase 23): `createSearchKnowledgeTool(ctx.sql!)` vinculado no `buildGraph()` do Brain SDR — `bindTools()` e `ToolNode` com search_knowledge; RAG end-to-end funcional (RAG-02, RAG-03)
6. **Tech Debt Cleanup** (Phase 24): WR-01..WR-04 corrigidos no FupScheduler (warning null checkpointer, updatedAt em resetFup, SIGTERM handler cleanup, delay 1s entre retries); 4 erros TypeScript eliminados em packages/core; REQUIREMENTS.md tracker atualizado
7. **FUP Activation Trigger** (Phase 25): `upsertLead()` ativa `fup_enabled = true` automaticamente quando `fup_config` existe no banco para o brainType — FUP opera sem intervenção manual por lead; BrainRunner passa `brainType` como 4° parâmetro (backward compatible)
8. **FUP Next-At Init Fix** (Phase 26): `upsertLead()` calcula e persiste `fupNextAt = getNextValidSlot(rawNextAt, config)` no INSERT quando fupEnabled=true — fecha gap bloqueador FUP-02; leads criados com FUP são imediatamente elegíveis pelo scheduler

### Known Gaps (Tech Debt)

Documentado no audit `milestones/v1.4-MILESTONE-AUDIT.md` (status: `tech_debt`):

- **FUP-02 checkbox**: `[ ]` em REQUIREMENTS.md — código implementado (Phase 26); E2E runtime com banco real pendente de verificação humana
- **Human verify (Phase 19)**: Migration 0007 em banco PostgreSQL com leads pré-existentes
- **Human verify (Phase 22)**: `fup_failure_count` no schema do banco real + FupScheduler startup log com `FUP_WEBHOOK_URL`
- **Human verify (Phase 26)**: FUP Activation E2E completo com banco real e FupScheduler rodando
- **D-16** (Baixo): `vector(1536)` hardcoded na migration — mismatch se `EMBEDDING_DIMENSIONS` ENV for alterado sem re-migrar

---

## v1.3 MCP Integration + Dynamic responseMode (Shipped: 2026-06-16)

**Phases completed:** 4 phases (14-17), 9 plans, 92 commits
**Timeline:** 2026-06-15 → 2026-06-16 (2 days)
**Files changed:** 145 files, +14.132 / -1.051 linhas

**Key accomplishments:**

1. **TD-01 fix** (Phase 14): `qualifier.ts` com `prepare: false` — sub-agente de qualificação compatível com PgBouncer transaction mode; static analysis test PGB-TD01 previne regressão
2. **MCP Integration** (Phase 15): BrainRunner carrega MCP tools via `MultiServerMCPClient` no startup, regista-as em `BrainBuildContext.mcpTools` como `StructuredTool[]`; SIGTERM limpo em 511ms verificado manualmente
3. **brain-sdr + brain-echo com MCP** (Phase 15): ambos os Brains integram `ctx.mcpTools` no `bindTools()` e `ToolNode` do grafo LangGraph; fallback gracioso quando MCP server inacessível (warn + tools nativas preservadas)
4. **`createRespondTool()`** (Phase 16): factory stateless que expõe `respond` como tool LangGraph — LLM escolhe `responseMode` (text/audio/image/undefined) dinamicamente via schema-as-tool; sem hardcode no código
5. **routeAfterLlm + nó respond** (Phase 16): router em brain-sdr e brain-echo detecta chamada à `respond` tool e encaminha para nó dedicado; suporte multi-provider OpenAI + Anthropic sem branching de código (RESP-01, RESP-02, RESP-03)
6. **Token Usage Exposure** (Phase 17): `tokenUsage { inputTokens, outputTokens, totalTokens }` acumulado via `BrainStateAnnotation` (sum reducer); exposto na resposta HTTP e logado no RabbitMQ consumer; zeros explícitos para providers sem `usage_metadata`

---

## v1.2 Output Parser + Tool Contracts (Shipped: 2026-06-15)

**Phases completed:** 4 phases (10-13), 11 plans, 122 commits
**Timeline:** 2026-06-14 → 2026-06-15 (2 days)
**Files changed:** 163 files, +13.153 linhas

**Key accomplishments:**

1. Output Parser SDK entregue: `BrainOutput` (fullResponse + responseMode obrigatórios, mediaType/mediaUrl condicionais) como tipo shared; `BrainOutputSchema` Zod com `superRefine` em packages/core; `BrainRunner.run()` valida saída e lança `BrainOutputValidationError` — 17 testes verdes (PARSER-01, PARSER-02)
2. Tool Contracts SDK: `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` como factories tipadas; guard `BRAIN_TOOLS` CSV em `enableTool()`; `BrainBuildContext.sql?` + BrainRunner injeta sql no buildGraph — 22 testes verdes (TOOLS-ENV-01/02, TOOLS-STD-01/02)
3. Brain SDR migrado para contrato v1.2 completo: 3 tools bound no ToolNode LangGraph (qualify_lead + pause_session + finish_conversation); nó llm seta `brainOutput`; webhook retorna `{ fullResponse, responseMode }` (campo `reply` removido — breaking change documentado) — 25/25 testes passando (PARSER-03, TOOLS-STD-03)
4. PgBouncer compatibility (Phase 13): `prepare: false` em TenantPoolManager e no CLI de migrate.ts; row-lock transacional via `_schema_lock` substitui `pg_advisory_lock`; `saver.end()` em `finally` corrige connection leak CR-01 em qualifier.ts — 11/11 must-haves verificados (PGB-01..05)

### Known Gaps (Tech Debt)

Documentado no audit `milestones/v1.2-MILESTONE-AUDIT.md`:

- **TD-01** (Médio): `qualifier.ts` — `postgres(dbUrl, { max: 1 })` sem `prepare: false`; falha sob PgBouncer transaction mode
- **TD-03** (Baixo): `enableTool("sdr", "pause_session/finish_conversation")` inerte — essas tools não passam por `getTools()` pois são bound diretamente em `buildGraph()`
- **TD-04** (Baixo): `LeadService.setFullpp()` e `setIaAtivada()` sem callers de produção — tools fazem UPDATE Drizzle diretamente
- **TD-02** (Baixo): `brain-echo/src/index.ts` — `postgres()` sem `prepare: false`; inconsistente com estratégia PgBouncer
- 2 falhas pré-existentes em testes de integração (`brain-runner.integration.test.ts`, `checkpointer.test.ts`) — não introduzidas por v1.2

---

## v1.0 MVP (Shipped: 2026-06-13)

**Phases completed:** 4 phases, 28 plans, ~234 commits
**Timeline:** 2026-05-21 → 2026-06-13 (23 days)
**TypeScript LOC:** ~7.094

**Key accomplishments:**

1. Monorepo scaffold (pnpm workspaces + Turborepo) com base PostgreSQL + PGVector — schema de 4 tabelas (`users`, `memories`, `agent_state`, `embeddings`), TenantPoolManager LRU (max 20 tenants), migrations versionadas via drizzle-kit
2. Pacotes de domínio completos: memory 3-layer (long-term Drizzle, short-term PostgresSaver, semantic pgvector), AI/LangGraph com PostgresSaver como único checkpointer, transport webhook idempotente (DedupCache + BrainEvent Zod), Langfuse observability via callbacks condicionais
3. Brain SDK: IBrain interface + BrainBuildContext, BrainRunner lifecycle (init→run→refreshPrompts), ToolsRegistry com whitelist por tipo de Brain, prompts armazenados no banco de dados (tabela `prompts`, zero prompts hardcoded)
4. EchoBrain Docker image (419MB, multi-stage Bun) valida contrato completo end-to-end: POST /webhook → BrainRunner → LangGraph → PostgresSaver → reply (SC-2 verificado com LLM real); estado LangGraph persiste após `docker restart` (SC-3 verificado com MARKER_BRAINCORE_42)

### Known Gaps

Tech debt aceito e documentado no audit `v1.0-MILESTONE-AUDIT.md`:

- **MEM-03**: BrainRunner.run() nunca gera embeddings — `createEmbeddings()` é exportado mas nunca chamado; caminho de escrita semântica é dead code em v1. Deferido para v2.
- **OBS-02**: GET /health sem campo `transport` no status. Deferido per decisão D-15 (Phase 1); Phase 2 transport completo mas campo nunca foi adicionado. Deferido para v2.

---

## v1.1 Brain SDR + Infraestrutura Produção (Shipped: 2026-06-14)

**Phases completed:** 5 phases (5-9), 12 plans, ~124 commits
**Timeline:** 2026-06-13 → 2026-06-14 (2 days)

**Key accomplishments:**

1. Transport padronizado: BrainEvent migrado para {Name, Message, Numero, IDLead}, DedupCache removido, WebhookTransport com constructor injection e fail-fast ConfigurationError — corrige tech debt de v1.0
2. ESLint v8 + @typescript-eslint/recommended ativado nos 7 pacotes monorepo — `turbo run lint` passa 7/7 com zero erros
3. Schema `leads` com advisory lock em runMigrations() + BrainRunner auto-migrate via ENV MIGRATIONS_FOLDER — startup race condition prevenida entre múltiplas instâncias
4. LeadService com upsert atômico por numero, gate ia_ativada no BrainRunner, RabbitMQTransport com ack manual, DLQ explícita e retry — transport layer completo (webhook + rabbitmq)
5. Histórico de conversas persistente: thread_id = lead.uniqueId via PostgresSaver, context window configurável com slice(-N) no nó do grafo — conversas multi-sessão funcionando
6. Brain SDR: primeiro Brain real com grafo ReAct 2-nós, sub-agente de qualificação stateless lendo histórico via PostgresSaver.getTuple(), zero prompts hardcoded, TenantPoolManager em produção, Dockerfile multi-stage

### Known Gaps

Tech debt aceito e documentado no audit `milestones/v1.1-MILESTONE-AUDIT.md`:

- **GAP-2**: `apps/brain-sdr/.env` usa `OPENAI_API_KEY` em vez de `API_KEY` — dev-only; Docker runtime supre o valor correto
- **INFRA-02**: `apps/brain-sdr/package.json` sem script `lint` — escopo do requisito eram os 7 pacotes core (satisfeito)
- **SDR-02/SDR-03/SDR-05 partial**: arquitetura verificada; runtime completo depende de DB + LLM real em produção
- Tech debt: handler.ts sem try/catch em runner.run(), test placeholders, LangGraph internal API access — todos não-bloqueantes

---
