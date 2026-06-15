# Milestones

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
