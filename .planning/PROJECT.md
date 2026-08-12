# Brain Core

## What This Is

Plataforma monorepo para construção de agentes de IA especializados (Brains). Cada Brain — SDR, Suporte, Customer Success, etc. — é empacotado como uma imagem Docker independente, mas compartilha o mesmo núcleo de infraestrutura: transport, memória, embeddings, Tools Registry e Brain SDK. O produto é vendido/distribuído para clientes que contratam o Brain adequado ao seu caso de uso.

O primeiro Brain real (SDR) foi entregue no v1.1 — atende leads no WhatsApp com histórico de conversa persistente, gate ia_ativada, sub-agente de qualificação e zero prompts hardcoded. No v1.4, os Brains ganharam base de conhecimento semântica via RAG (pgvector), canal de saída para eventos de tools (webhook/RabbitMQ) e scheduler de follow-up automático para leads silenciosos.

## Core Value

Uma infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base.

## Current Milestone: v1.6 Transferência de Lead entre Agentes + Seed por Brain

**Goal:** Corrigir o seeding de cada Brain para ser específico do seu próprio tipo (prompts + fup_config + prompt padrão de FUP) e construir a capacidade de um agente transferir um lead ativo (dados + contexto de conversa) para outro agente, possivelmente em outro banco de dados.

**Target features:**
- Seed de prompts escopado por `brain_type` — cada imagem só roda o seed do seu próprio tipo, sem prompt de outro Brain vazando pro banco
- Seed padrão de `fup_config` + prompt `key='fup'` para cada Brain existente (sdr, support, echo) — FUP passa a funcionar out-of-the-box em banco novo
- Mecanismo (tool) para a IA decidir transferir o lead para outro agente, com nomes de agente configuráveis (não fixos em 2-3 tipos)
- Transferência do lead completo (dados + contexto de conversa) para o banco do agente destino, que assume o atendimento

## Last Milestone: v1.5 Embedding SDK + Brain Suporte + Tech Debt — SHIPPED 2026-07-02

6 fases (27-32), 21 planos, 140 commits, 158 arquivos, +21.037 / -493 linhas, ~3 dias. Embedding SDK (`packages/embeddings` com IEmbeddingProvider) + segundo Brain real (`apps/brain-support` com RAG obrigatório e MCP) + dois ciclos de gap-closure (Phases 31-32) que zeraram o ledger de tech debt do próprio audit v1.5.

## Requirements

### Validated

**v1.0 — MVP**

- ✓ Monorepo estruturado com `packages/` (shared, database, observability) — v1.0
- ✓ Schema PostgreSQL + PGVector (users, memories, agent_state, embeddings) — v1.0
- ✓ Multi-tenancy: 1 banco por cliente, seleção via `DATABASE_NAME` env (TenantPoolManager, LRU max 20) — v1.0
- ✓ Observabilidade básica (health check GET /health, logging estruturado com Pino) — v1.0
- ✓ `apps/` directory com Brain packages — v1.0
- ✓ Brain SDK: IBrain interface + BrainRunner lifecycle (init → run) + ToolsRegistry — v1.0
- ✓ Transport layer (Webhook): POST /api/v1/webhook traversa BrainRunner → LangGraph → resposta — v1.0
- ✓ Tools Registry: registerBrainType + enableTool por tipo de Brain — v1.0
- ✓ Docker: multi-stage Dockerfile (node:22-slim builder + oven/bun:1 runner), imagem por Brain — v1.0
- ✓ PostgresSaver: estado LangGraph persistido no PostgreSQL, dura container restart — v1.0

**v1.1 — Brain SDR + Infraestrutura Produção**

- ✓ Transport layer (RabbitMQ): seleção via `TRANSPORT=rabbitmq` env com campos padronizados (Name, Message, Numero, IDLead) — v1.1
- ✓ Schema: tabela `leads` (id, unique_id, nome, numero, ia_ativada, fullpp) com advisory lock em runMigrations() — v1.1
- ✓ Auto-migrate na inicialização do Brain (verificar/criar tabelas via ENV MIGRATIONS_FOLDER) — v1.1
- ✓ Fluxo: cadastro automático de lead na primeira mensagem + verificação `ia_ativada` — v1.1
- ✓ Histórico de conversas vinculado ao lead (thread_id = lead.uniqueId, recuperação via PostgresSaver) — v1.1
- ✓ Correção WebhookTransport.start() com runner injection (GAP-1) — v1.1
- ✓ Webhook: campos de entrada padronizados (Name, Message, Numero, IDLead) — v1.1
- ✓ Lint pipeline ativo em todos os 7 pacotes (turbo run lint passa 7/7) — v1.1
- ✓ Multi-tenant: TenantPoolManager ativo em produção no Brain SDR — v1.1
- ✓ Brain SDR: primeiro Brain real com fluxo de atendimento, qualificação e sub-agente — v1.1

**v1.2 — Output Parser + Tool Contracts**

- ✓ Output Parser SDK: `BrainOutput` type (fullResponse + responseMode obrigatórios) + `BrainOutputSchema` Zod com validação condicional — v1.2
- ✓ BrainRunner.run() valida saída do grafo e lança `BrainOutputValidationError` se null ou schema inválido — v1.2
- ✓ Tool Contracts SDK: `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` disponíveis no core — v1.2
- ✓ `BRAIN_TOOLS` ENV como whitelist CSV para `enableTool()` — controle de tools em runtime — v1.2
- ✓ Brain SDR migrado para contrato v1.2: BrainOutput estruturado, 3 tools no grafo, webhook sem campo `reply` — v1.2
- ✓ PgBouncer compatibility: `prepare: false` em TenantPoolManager, row-lock transacional em migrate, CR-01 fix em qualifier.ts — v1.2

**v1.3 — MCP Integration + Dynamic responseMode**

- ✓ TD-01 fix: `qualifier.ts` com `prepare: false` — compatível com PgBouncer transaction mode — v1.3
- ✓ MCP Integration: BrainRunner carrega tools via `MultiServerMCPClient` no startup; fallback gracioso se inacessível; SIGTERM limpo em 511ms — v1.3
- ✓ brain-sdr e brain-echo: MCP tools integradas no `bindTools()` + `ToolNode` do grafo LangGraph — v1.3
- ✓ `createRespondTool()`: factory stateless — LLM escolhe `responseMode` (text/audio/image) via schema-as-tool, sem hardcode — v1.3
- ✓ `routeAfterLlm` + nó `respond`: multi-provider OpenAI + Anthropic sem branching de código (RESP-01, RESP-02, RESP-03) — v1.3
- ✓ Token Usage Exposure: `tokenUsage` acumulado via `BrainStateAnnotation` (sum reducer), exposto em HTTP response e logado no RabbitMQ consumer — v1.3

**v1.4 — RAG + Eventos de Tools + FUP Automático**

- ✓ RAG-01: POST /api/v1/ingest — chunka, embede (provider configurável) e armazena no pgvector com metadados obrigatórios — v1.4
- ✓ RAG-02: LLM chama `search_knowledge(query, collections[])` e recebe trechos ordenados por similaridade cosine — v1.4
- ✓ RAG-03: `search_knowledge` aceita array de coleções e busca em múltiplas simultaneamente em único response — v1.4
- ✓ RAG-04: Cada chunk registra collection_name, embedding_model, chunk_index e total_chunks como metadados não-nulos — v1.4
- ✓ EVT-01: Brain publica eventos de tools em canal separado (webhook/RabbitMQ via ENV) sem bloquear o fluxo principal — v1.4
- ✓ EVT-02: qualify_lead, pause_session e finish_conversation publicam evento `{ action, lead, result }` automaticamente — v1.4
- ✓ EVT-03: FUP publica evento `{ action: "fup", lead, result: { step, message } }` no canal de saída — v1.4
- ✓ EVT-04: event_id = `thread_id:tool_call_id` (exceção FUP: `uniqueId:fup:step` — decisão intencional D-17) — v1.4
- ✓ FUP-01: Configuração de FUP (intervalos, min/max hora, dias, timezone IANA) em tabela `fup_config` no banco — v1.4
- ✓ FUP-02: Scheduler SELECT FOR UPDATE SKIP LOCKED; E2E integration test contra PostgreSQL real — Phase 27
- ✓ FUP-03: Conteúdo de FUP gerado por LLM one-shot via PostgresSaver.getTuple() usando histórico da conversa — v1.4
- ✓ FUP-04: Estado FUP persistido em leads: fup_step, fup_next_at, fup_enabled — v1.4
- ✓ FUP-05: Último FUP seta ia_ativada=false e fup_enabled=false automaticamente — v1.4
- ✓ FUP-06: BrainRunner.run() cancela FUPs pendentes e atualiza last_message_at a cada mensagem — v1.4
- ✓ FUP-07: Janela de horário/dias → slot IANA válido calculado por `getNextValidSlot()` — v1.4
- ✓ FUP-08: Retry até 3x com fup_failure_count; logar alerta após falha — v1.4

**v1.5 — Embedding SDK (Phase 28)**

- ✓ EMBD-01: `IEmbeddingProvider` interface (`embed()`, `embedQuery()`, `dimensions`, `providerName`) implementável por qualquer provider — Phase 28
- ✓ EMBD-02: `OpenAIEmbeddingProvider` disponível como adapter padrão em `packages/embeddings` — Phase 28
- ✓ EMBD-03: Migration `0009` cria coluna `vector(N)` com N derivado de `EMBEDDING_DIMENSIONS` em generate-time (override pré-produção: TRUNCATE deve ser re-adicionado manualmente na regeneração — ver 28-VERIFICATION.md) — Phase 28
- ✓ EMBD-04: Brain configura provider, modelo e dimensões via ENV sem alterar código TypeScript — Phase 28
- ✓ EMBD-05: `BrainRunner` conecta semantic write path (`createEmbeddings`) ao `IEmbeddingProvider` — MEM-03 resolvido, escrita semântica deixou de ser dead code — Phase 28

**v1.5 — Brain Suporte Core (Phase 29)**

- ✓ SUP-01: Brain Suporte recebe mensagens via webhook e RabbitMQ configurável por ENV (mesma interface do SDR) — Phase 29
- ✓ SUP-02: `search_knowledge` sempre ativa no grafo — `RESERVED_TOOL_NAMES` bloqueia colisão de nome vinda de `ctx.mcpTools` antes de `bindTools()`/`ToolNode` (gap SUP-02/D-04 fechado em 29-03) — Phase 29
- ✓ SUP-03: Tools do grafo via MCP dinâmico, sem hardcode (reinterpretado per D-01/D-02: `pause_session`/`finish_conversation` são closures nativas hardcoded, sem `qualify_lead` — desvio confirmado pelo usuário) — Phase 29
- ✓ SUP-04: `IEmbeddingProvider` configurável por ENV, independente do SDR — Phase 29
- ✓ SUP-05: `BrainOutput` estruturado validado pelo SDK — Phase 29
- ✓ SUP-07: Gate `ia_ativada` + histórico persistente via `PostgresSaver` (thread_id = lead.uniqueId) — Phase 29
- ✓ SUP-08: Brain Suporte registrado no `ToolsRegistry` com tipo `"support"` — Phase 29

**v1.5 — Brain Suporte Docker (Phase 30)**

- ✓ SUP-06: `Dockerfile` multi-stage independente para `apps/brain-support`, incluindo `packages/embeddings` desde o início; `docker-compose.yml` de produção espelhando `apps/brain-sdr` (Postgres externo via `host.docker.internal`); CI/CD (`publish-brain-support.yml`) e validação e2e real (build → migrations → /health → /api/v1/webhook) — Phase 30

**v1.5 — Tech Debt Onboarding Hardening (Phase 31)**

- ✓ TECH-04: CI workflows quote shell variables and validate DockGate API responses — prevents misleading error messages from unquoted variables and invalid URLs — Phase 31
- ✓ TECH-05: Respond tool structurally protected from BRAIN_TOOLS misconfiguration via append-after-filter pattern + RESERVED_TOOL_NAMES guard; embedding ENV documentation in brain-sdr .env.example; migration 0009 inline warning about hardcoded vector dimensions — Phase 31

**v1.5 — Tech Debt Code Quality Cleanup (Phase 32)**

- ✓ TECH-06: Achados warning/info de code review das fases 27-30 resolvidos (SIGTERM idempotency, RabbitMQ retry-key collision, WebhookTransport stale status, reembed MAX_PAGES cap, search-knowledge truncation, Gemini dimension validation, RESERVED_TOOL_NAMES derivado, type-guards de mensagem AI unificados) + lacunas de documentação/teste preenchidas (frontmatter retroativo, fup-e2e.test.ts isolamento de teste, mock.module cross-pollution entre brain-runner.test.ts/factory.test.ts corrigido) — Phase 32

### Active

**Backlog (pós v1.4)**

- [x] Brain Suporte (`apps/brain-support`) — Phase 29
- [ ] Outros Brains: Customer Success
- [ ] Sub-agente de qualificação avançada com SPIN/BANT completo
- [ ] Brain SDR publicando respostas de volta ao RabbitMQ (canal de resposta async)
- [x] Resolver TD-03: `BRAIN_TOOLS` whitelist agora cobre closures em buildGraph() via enabledTools — Phase 27
- [x] Embedding SDK (`packages/embeddings`): IEmbeddingProvider + adapter OpenAI/Gemini + dimensões via ENV — Phase 28
- [ ] responseMode dinâmico via structured output multi-provider (OpenAI + Google) — hoje hardcoded "text" em brain.ts
- [ ] CI/CD: build + publish imagem Docker do brain-sdr via DockGate (Phase 18 backlog)

### Out of Scope

- Brain SDR com sub-agente de qualificação avançada (SPIN/BANT completo) — simplificado para v1.1; deferido para próximo milestone
- Mecanismo de licenciamento (LICENSE_KEY) — futuro
- UI de gerenciamento de Brains — futuro
- Migração para tenant_id nas tabelas — futuro quando escala demandar
- fullpp com regra de negócio — futuro quando necessário
- Outros Brains específicos (Suporte, CS, Cobrança, RH) — pós v1.2
- `BRAIN_TOOLS_DISABLED` (lista de exclusão) — whitelist é suficiente por ora

## Context

**v1.5 (shipped 2026-07-02):** 6 fases (27-32), 21 planos, 140 commits, 158 arquivos (+21.037 / -493 linhas), ~3 dias. `packages/embeddings` com `IEmbeddingProvider` (adapters OpenAI + Gemini) desacoplando embeddings do core; segundo Brain real `apps/brain-support` com RAG estruturalmente obrigatório, `pause_session`/`finish_conversation` nativas e `RESERVED_TOOL_NAMES` protegendo contra shadowing por MCP; Dockerfile + CI/CD independentes validados end-to-end. Dois ciclos de gap-closure (Phases 31-32) nasceram do próprio audit do milestone e zeraram o ledger de tech debt antes do ship.

**v1.4 (shipped 2026-06-25):** 8 fases (19-26), 18 planos, 157 commits, 181 arquivos (+24.233 / -12.268 linhas), 3 dias. RAG com pgvector (POST /api/v1/ingest + search_knowledge tool); canal de eventos de tools (IEventPublisher webhook+RabbitMQ fire-and-forget); FupScheduler background com SELECT FOR UPDATE SKIP LOCKED, geração LLM one-shot via PostgresSaver.getTuple(), IANA timezone slot calculation e retry até 3x. upsertLead() ativa fup_enabled automaticamente via fup_config e calcula fupNextAt no INSERT.

**v1.3 (shipped 2026-06-16):** 4 fases (14-17), 9 planos, 92 commits, 145 arquivos (+14.132 / -1.051 linhas), 2 dias. MCP Integration via `@langchain/mcp-adapters`; schema-as-tool pattern para responseMode dinâmico; token usage acumulado via BrainStateAnnotation (sum reducer) e exposto em HTTP + RabbitMQ log.

**v1.2 (shipped 2026-06-15):** 4 fases (10-13), 11 planos, 122 commits, 163 arquivos alterados (+13.153 linhas), 2 dias de desenvolvimento. Contrato de saída estruturado entregue em todos os Brains; PgBouncer-compatible desde Phase 13.

**v1.1 (shipped 2026-06-14):** 5 fases (5-9), 12 planos, ~124 commits, 2 dias.

**v1.0 (shipped 2026-06-13):** ~7.094 linhas TypeScript, 4 fases (1-4), 28 planos, 234 commits, 23 dias.

Stack validado: Bun + Hono + Drizzle (postgres.js driver) + LangGraph + PostgresSaver + pgvector + Pino + Langfuse + `@langchain/mcp-adapters`.

O Brain SDR tem uma arquitetura com sub-agente de qualificação stateless: o Brain principal conversa com leads e aciona o sub-agente quando chega o momento de qualificar. O sub-agente lê o histórico via PostgresSaver.getTuple() e retorna {qualificado, motivo, proximo_passo}. Toda comunicação de transport é via webhook (TRANSPORT=webhook) ou RabbitMQ (TRANSPORT=rabbitmq), selecionável via ENV. Desde v1.2, toda resposta é `BrainOutput` estruturado. Desde v1.3, Brains conectam a ferramentas externas via MCP e o LLM controla responseMode dinamicamente. Desde v1.4, Brains têm base de conhecimento semântica (RAG), publicam eventos de tools em canal externo e enviam follow-ups automáticos para leads silenciosos.

Brains planejados para o futuro: Suporte, Customer Success, Cobrança, RH, Jurídico, E-commerce, Agendamento.

**Tech debt (v1.5 — ledger zerado no ship, ver `milestones/v1.5-MILESTONE-AUDIT.md`):**
- ~~TD-03~~: ✓ Resolvido em Phase 27 — `enabledTools` cobre closures em buildGraph()
- ~~OBS-02~~: ✓ Resolvido em Phase 27 — GET /health expõe TransportStatus
- ~~FUP-02~~: ✓ Resolvido em Phase 27 — E2E integration test contra PostgreSQL real
- ~~MEM-03~~: ✓ Resolvido em Phase 28 — `BrainRunner` chama `embeddingProvider.embed()`/`embedQuery()` em query/save time; semantic write path deixou de ser dead code
- ~~D-16~~: ✓ Resolvido em Phase 28 (com ressalva) — migration `0009` deriva `vector(N)` de `EMBEDDING_DIMENSIONS` em generate-time; TRUNCATE deve ser re-adicionado manualmente na regeneração e o valor commitado (1536) é OpenAI-specific — aceito como tradeoff pré-produção, ver 28-VERIFICATION.md
- ~~`apps/brain-sdr/.env.example` sem doc de embedding ENVs~~: ✓ Resolvido em Phase 31
- ~~respond tool sem append-after-filter guard~~: ✓ Resolvido em Phase 31 (TECH-05)
- ~~22 achados warning/info de code review das fases 27-30~~: ✓ Resolvidos em Phase 32 (TECH-06)
- TD-04 (não relacionado a v1.5, carry-over antigo): `LeadService.setFullpp()` / `setIaAtivada()` sem callers de produção
- brain-echo `hasOtherToolCall` guard ausente no nó LLM — non-fatal, brain-echo é validation-only

## Constraints

- **Runtime**: Bun — performance e compatibilidade com Hono/Drizzle são critério de escolha de libs
- **Framework HTTP**: Hono — zero deps, performance superior com Bun, edge-compatible
- **ORM**: Drizzle — lightweight, TypeScript nativo, sem overhead de geração de client
- **AI**: LangGraph/LangChain — orquestração de agentes e fluxos
- **DB**: PostgreSQL + PGVector — memória de longo prazo, embeddings e RAG
- **Produto**: imagens Docker por Brain, clientes usam só a imagem contratada

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hono sobre Express | Melhor integração com Bun, zero deps, performance superior | ✓ Good — sem fricção em nenhuma das fases; sub-apps em brain-echo e brain-sdr triviais |
| Drizzle sobre Prisma | Lightweight, TypeScript nativo, sem geração de client, melhor com Bun | ✓ Good — único ajuste: usar `postgres.js` como driver (não `bun:sql`) por bug de conexão |
| Brain SDK no core desde v1 | Consistência no registro de Brains; evita refatoração quando criar o primeiro Brain | ✓ Good — brain-sdr integrou sem refatoração do SDK |
| 1 banco por cliente (inicial) | Isolamento simples agora; migrar para tenant_id quando escala demandar | ✓ Good — TenantPoolManager ativo em produção via DATABASE_NAME no brain-sdr |
| Tools Registry por tipo de Brain | Cada tipo define seu conjunto base de tools no código | ✓ Good — enableTool("sdr","qualify_lead") funcionou sem problemas |
| v1 = só infraestrutura core | Nenhum Brain específico no v1; garantir base sólida antes de implementar SDR | ✓ Good — decisão validada; base absorveu Brain SDR sem refatoração estrutural |
| postgres.js como driver Drizzle (não bun:sql) | Bug de conexão travada após constraint errors no bun:sql | ✓ Good — zero problemas com postgres.js durante todo o desenvolvimento |
| WebhookTransport runner injection via construtor (v1.1) | Fail-fast ConfigurationError se runner ausente | ✓ Good — GAP-1 resolvido; createTransport(runner) é API idiomática agora |
| rabbitmq-client@5.0.8 (não amqplib-bun) | Zero deps, Bun-compatible, auto-reconnect built-in; amqplib-bun tem bugs com large-message | ✓ Good — testes passaram, DLQ implementada sem dependência de configuração de broker |
| Sub-agente de qualificação stateless (sem checkpointer) | Lê histórico via PostgresSaver.getTuple() mas não persiste estado próprio | ✓ Good — evita acumulação de checkpoints do sub-agente; fallback gracioso em todos os pontos de falha |
| Drizzle _journal.json para migrations (GAP-1 v1.1) | Drizzle exige entrada no journal para executar SQL — 0005 foi adicionado pós-audit | ✓ Fixed — migrate() agora aplica seed de prompts SDR na inicialização |
| BrainOutput em shared, BrainOutputSchema em core (v1.2) | Evitar ciclo de dependência ai→core; type sem Zod em shared, schema Zod somente em core | ✓ Good — separação funcionou em todas as fases; transport usa duck typing IBrainRunnerLike |
| Tools padrão como factories com closure sobre sql (v1.2) | Mesmo padrão do boundQualifyTool — factory recebe sql e retorna StructuredTool | ✓ Good — pause_session e finish_conversation funcionando; thread_id vem de configurable, nunca do LLM |
| BRAIN_TOOLS como whitelist CSV via ENV (v1.2, fix v1.5/Phase 27) | Controle de tools em runtime sem recompilação — enableTool() silenciosamente ignora tools fora da whitelist | ✓ Fixed — TD-03 resolvido: enabledTools flui via BrainBuildContext, cobre closures nativas e mcpTools |
| row-lock via _schema_lock (v1.2, substitui pg_advisory_lock) | pg_advisory_lock não funciona sob PgBouncer (connection-level lock perdido na devolução do pool) | ✓ Good — row-lock transacional funciona em qualquer pooler; DDL idempotente fora de transação |
| rabbitmq-client (não amqplib-bun) mantido em v1.2 | Sem mudança de decisão — zero deps, Bun-compatible, auto-reconnect built-in | ✓ Good — RabbitMQ consumer fire-and-forget por design; TD-05 documentado mas não é bug |
| schema-as-tool para responseMode (v1.3) | `withStructuredOutput()` + `bindTools()` mutuamente exclusivos (langchainjs #7757) — `createRespondTool()` via `bindTools()` + nó `respond` + router | ✓ Good — multi-provider sem branching; UAT 2/2 OpenAI + Anthropic |
| MCP transport `"streamable_http"` com underscore (v1.3) | Hífen lança ValueError sem mensagem clara (mcp-adapters #322) | ✓ Good — documentado em PITFALL list para evitar regressão |
| MCP client lifecycle em `_compileGraph()` (v1.3) | Inicializado uma vez por processo, não por request — evita N conexões simultâneas | ✓ Good — SIGTERM limpo em 511ms verificado manualmente |
| ResponseMode `"undefined"` como valor sentinela (v1.3) | LLM precisa de valor de saída antes de conhecer o responseMode correto — `"undefined"` comunica "não determinado ainda" | ✓ Good — BrainOutputSchema aceita "undefined" como válido; fallback D-10 restaurado em 039330d |
| BrainStateAnnotation.tokenUsage com sum reducer (v1.3) | ReAct faz múltiplos LLM calls por turno — reducer acumula tokens de todos os nós llm automaticamente | ✓ Good — tokenUsage reflete turno completo, não apenas último call |
| IEventPublisher como interface + NoopEventPublisher (v1.4) | Brains não devem saber se eventos estão configurados — injeção via BrainRunner.init() mantém zero config no Brain | ✓ Good — Brain SDR não tem nenhuma referência a ENVs de eventos |
| EVT-03 ownership → Phase 22 (não Phase 20) (v1.4) | FUP events não têm tool_call_id — o campo event_id foi redefinido como exceção documentada (D-17) | ✓ Good — traceability corrigida em Phase 24; gap fechado sem regressão |
| fupNextAt calculado no INSERT em lead-service (v1.4) | Alternativa era calcular no scheduler tick — inserir no INSERT garante que o lead é elegível imediatamente sem race condition | ✓ Good — Phase 26 fechou gap FUP-02; getNextValidSlot() importado diretamente de fup-scheduler.ts |
| getNextValidSlot compartilhado via import direto (v1.4) | Evita duplicação de lógica de slot entre FupScheduler e LeadService — mesma função, mesmo comportamento | ✓ Good — D-05 Opção A validada em Phase 26 |
| IEmbeddingProvider com embed()/embedQuery()/dimensions/providerName (v1.5) | Provider-agnostic desde o design; OpenAI como adapter padrão, Gemini como segunda implementação real para provar a generalização da interface | ✓ Good — Brain Suporte usa provider/modelo/dimensões independentes do SDR sem tocar core |
| vector(N) derivado de EMBEDDING_DIMENSIONS em generate-time, não runtime (v1.5, D-16) | drizzle-kit generate não suporta ENV dinâmica em DDL — TRUNCATE necessário na regeneração para trocar dimensão | ⚠️ Revisit — aceito como tradeoff pré-produção; requer TRUNCATE manual documentado inline na migration 0009 se EMBEDDING_DIMENSIONS mudar |
| pause_session/finish_conversation nativas no Brain Suporte, não MCP dinâmico (v1.5, D-01/D-02) | Mesmo padrão do SDR — tools de gestão como closures no buildGraph(); MCP dinâmico genérico do core continua disponível para tools externas | ✓ Good — desvio confirmado pelo usuário; SUP-03 reinterpretado sem bloquear requirement |
| RESERVED_TOOL_NAMES derivado das instâncias de tool reais, não literal hardcoded (v1.5, Phase 32) | Evitar drift silencioso se um novo core refactor renomear uma tool nativa — a lista deriva de `instances.map(t => t.name)` | ✓ Good — brain-sdr e brain-support alinhados sem duplicação |
| getEmbeddingProvider() singleton de vida do processo, sem invalidação (v1.5, D-05/D-10) | ENVs de embedding são fixas por container neste modelo de deployment — sem caso de uso de reload em runtime | ✓ Good — decisão documentada inline; nenhum caller precisou de invalidação |
| resetFup() preserva fupEnabled (v1.4) | Ao receber mensagem, apenas fupNextAt e fupStep são zerados — fup_enabled permanece true para futuros FUPs | ✓ Good — D-19 da Phase 22; lead que responde continua elegível para próximos FUPs |
| brainType como 4° parâmetro opcional em upsertLead (v1.4) | Backward compatible com callers existentes — brainType só é necessário para ativar FUP automaticamente | ✓ Good — Phase 25 integrou sem quebrar callers anteriores |

## Evolution

Este documento evolui nas transições de fase e marcos de milestone.

**Após cada transição de fase** (via `/gsd-transition`):
1. Requirements invalidados? → Mover para Out of Scope com motivo
2. Requirements validados? → Mover para Validated com referência de fase
3. Novos requirements? → Adicionar em Active
4. Decisões a registrar? → Adicionar em Key Decisions
5. "What This Is" ainda preciso? → Atualizar se divergiu

**Após cada milestone** (via `/gsd-complete-milestone`):
1. Revisão completa de todas as seções
2. Core Value check — ainda é a prioridade certa?
3. Auditoria em Out of Scope — motivos ainda válidos?
4. Atualizar Context com estado atual

---
*Last updated: 2026-07-02 após v1.5 milestone (shipped — Phases 27-32, tech debt ledger zerado)
