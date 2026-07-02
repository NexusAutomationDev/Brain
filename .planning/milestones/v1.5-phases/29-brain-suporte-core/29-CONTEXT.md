# Phase 29: Brain Suporte Core - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

`apps/brain-support` passa a existir e processa mensagens de suporte end-to-end, replicando a arquitetura já validada em `apps/brain-sdr`: recebe mensagens via webhook ou RabbitMQ (mesma interface do SDR), mantém histórico de conversa por lead via `PostgresSaver` (thread_id = lead.uniqueId), respeita o gate `ia_ativada`, e retorna `BrainOutput` estruturado validado pelo SDK. Duas diferenças deliberadas em relação ao SDR:

1. `search_knowledge` é estruturalmente sempre ativa no grafo — nenhuma ENV/flag pode desativá-la (SUP-02).
2. Não existe tool de qualificação de lead (`qualify_lead` é conceito de venda, não se aplica a suporte).

Fase 30 (Docker) e outros Brains (Customer Success, Cobrança) estão fora do escopo desta fase.

</domain>

<decisions>
## Implementation Decisions

### Tools de gestão do Brain Suporte (reinterpretação de SUP-03)

- **D-01:** O conjunto de management tools do Brain Suporte é `pause_session` + `finish_conversation` — **sem equivalente de `qualify_lead`**. A menção a "qualify" em `REQUIREMENTS.md` (SUP-03) é um artefato de cópia da lista de tools do SDR, não um requisito real para o domínio de suporte (qualificar lead para venda não faz sentido em atendimento).
- **D-02 (reinterpretação explícita de SUP-03):** `pause_session` e `finish_conversation` são **hardcoded em `buildGraph()`, exatamente como no SDR** — `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` como closures nativas sobre o `sql` do próprio Brain. **Não** vêm de um servidor MCP dinâmico. O texto literal de SUP-03 ("carregadas via MCP dinâmico, sem hardcode em `buildGraph()`") está desatualizado para essas duas tools — decisão do usuário, confirmada explicitamente após discussão, sobrepõe a letra do requirement. Planner/researcher devem seguir esta decisão, não o texto original de SUP-03.
- **D-03:** O mecanismo de MCP dinâmico genérico do core (`MultiServerMCPClient` via `MCP_URL`/`MCP_TOOLS`/`MCP_AUTH_TOKEN`, já implementado em `BrainRunner._compileGraph()` e Brain-agnóstico) continua disponível para o Brain Suporte exatamente como já funciona para o SDR — sem trabalho adicional nesta fase. Se o usuário quiser plugar tools externas futuramente (ex: via n8n), já funciona por herança do SDK. Isso satisfaz a intenção original de "MCP dinâmico" do roadmap sem forçar pause/finish por esse caminho.
- Motivo da rejeição da alternativa "MCP externo mantém pause/finish": exigiria que o servidor externo (n8n) tivesse acesso direto ao Postgres do cliente (lógica de mutação fora do controle de tipos/testes do repo) ou que este repo expusesse endpoints HTTP de callback — complexidade desnecessária quando o padrão hardcoded do SDR já é validado em produção.

### search_knowledge sempre ativa (SUP-02)

- **D-04:** `search_knowledge` deve ser estruturalmente garantida no grafo, independente do valor de `BRAIN_TOOLS`. Hoje (SDR) ela é registrada via `ToolsRegistry.enableTool("sdr", "search_knowledge")` e portanto **seria filtrada** se `BRAIN_TOOLS` não a incluir — esse comportamento NÃO pode se repetir no Suporte.
- **Claude's Discretion:** mecanismo exato — bypassar o filtro de `ctx.enabledTools` para essa tool específica, ou injetá-la depois do filtro ser aplicado em `buildGraph()`. Qualquer abordagem é aceitável desde que `search_knowledge` nunca seja removível via ENV/flag.

### Isolamento de banco entre Brains do mesmo cliente (SUP-04)

- **D-05:** Quando um cliente contrata SDR + Suporte juntos, cada Brain roda como **imagem Docker separada**, conectando ao **mesmo servidor PostgreSQL**, mas com **`DATABASE_NAME` distinto** por Brain (ex: `cliente_x_sdr` e `cliente_x_suporte`). Confirma que SUP-04 (dimensões de embedding independentes) funciona estruturalmente: cada banco tem sua própria coluna `vector(N)`, sem conflito de dimensão entre os dois Brains mesmo compartilhando o mesmo servidor Postgres.

### Persona / prompt inicial do Brain Suporte

- **D-06:** Prompt de sistema inicial é um **placeholder genérico** ("assistente de suporte, responde com base na knowledge base via `search_knowledge`, escala/pausa quando não sabe"), carregado da tabela de prompts (sem hardcode, mesmo padrão do SDR: `promptKeys: ["system"]`). Refinamento de tom/política de escalonamento fica para depois, via `/reload-prompts` — não bloqueia o planejamento técnico desta fase.
- Brain Suporte **não** tem sub-agente equivalente ao `qualifier.ts` do SDR — não foi levantada nenhuma necessidade de sub-fluxo stateful além do ReAct principal.

### Claude's Discretion

- Mecanismo exato de bypass do filtro `enabledTools` para `search_knowledge` (D-04).
- Conteúdo final do prompt de sistema além do placeholder (D-06).
- Nome/path exato do endpoint de ingest para a base de conhecimento do Suporte (reaproveitar `/api/v1/ingest` existente vs. rota dedicada) — provavelmente reaproveitar, já que é Brain-agnóstico em `packages/core/src/rag/ingest.ts`.
- Nomes de collections default para RAG do Suporte — `collections` já é parâmetro livre escolhido pelo LLM, sem default hardcoded no SDR; mesma flexibilidade se aplica.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e histórico
- `.planning/REQUIREMENTS.md` §Brain Suporte (SUP-01 a SUP-08) — critérios de aceitação oficiais. **Atenção:** SUP-03 está desatualizado quanto a `pause_session`/`finish_conversation` — ver D-01/D-02 acima, que reinterpretam a letra do requirement.
- `.planning/ROADMAP.md` §Phase 29 — goal e success criteria da fase
- `.planning/phases/28-embedding-sdk/28-CONTEXT.md` — decisões D-11 a D-15 sobre `EMBEDDING_PROVIDER` independente por Brain; deferred idea já apontava a questão de isolamento de dimensão resolvida aqui em D-05

### Implementação de referência (brain-sdr) — replicar padrão
- `apps/brain-sdr/src/index.ts` — entrypoint: TenantPoolManager, ToolsRegistry, BrainRunner init, transport startup
- `apps/brain-sdr/src/brain.ts:92-310` — `buildGraph()`: wiring de nós (llm → route → tools/respond/end), binding de tools nativas e MCP, filtro por `ctx.enabledTools`
- `apps/brain-sdr/src/server.ts` — Hono app: handlers `/health`, `/webhook`, `/ingest`, `/reembed`, `/reload-prompts`
- `apps/brain-sdr/.env.example` — ENVs documentadas (nota: falta `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS`, gap já identificado na Phase 28 — replicar COM esse gap corrigido no `.env.example` do Suporte)
- `apps/brain-sdr/Dockerfile` — padrão multi-stage (referência para Fase 30, não desta fase)

### Tools a reaproveitar (D-01/D-02)
- `packages/core/src/tools/pause-session.ts:22-44` — `createPauseSessionTool(sql)`
- `packages/core/src/tools/finish-conversation.ts:23-47` — `createFinishConversationTool(sql)`
- `packages/core/src/tools/search-knowledge.ts:46-91` — `createSearchKnowledgeTool(sql, embeddingProvider)`

### SDK core — pontos de integração
- `packages/core/src/tools/registry.ts:23-31,60-74` — `ToolsRegistry.enableTool()`/`registerBrainType()`, filtro por `BRAIN_TOOLS` (D-04 precisa contornar isso para `search_knowledge`)
- `packages/core/src/runner/runner.ts:520-576` — `MultiServerMCPClient`, fallback gracioso se MCP inacessível (D-03: já Brain-agnóstico, herdado sem trabalho extra)
- `packages/core/src/runner/runner.ts:147-173` — resolução de `IEmbeddingProvider` + validação fail-fast de dimensão vs coluna `vector(N)`
- `packages/core/src/runner/runner.ts:302-320` — gate `ia_ativada` + `thread_id = lead.uniqueId` para PostgresSaver
- `packages/core/src/brain/interface.ts:17-39,46-66` — `IBrain`, `BrainBuildContext` (contrato a implementar em `brain-support/src/brain.ts`)
- `packages/transport/src/factory.ts:20-38` — `createTransport()`, seleção `TRANSPORT` webhook/rabbitmq, Brain-agnóstico
- `packages/embeddings/src/factory.ts:17-45` — `createEmbeddingProvider()`, resolução por `EMBEDDING_PROVIDER`/`LLM_PROVIDER`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/brain-sdr/src/brain.ts` como template estrutural completo — únicas remoções: closure de `qualify_lead` (linhas ~98-120) e o node/routing específico de qualificação. `pause_session`, `finish_conversation` e `search_knowledge` são copiados como estão.
- `createTransport(runner)` (`packages/transport`) — funciona sem nenhuma mudança para o Suporte.
- `createEmbeddingProvider()` (`packages/embeddings`) — resolve independentemente por processo/container; nenhuma mudança de código necessária, só ENV própria no `.env` do Suporte.
- `ToolsRegistry` — só precisa de `enableTool("support", "pause_session")`, `enableTool("support", "finish_conversation")` (e o mecanismo especial de D-04 para `search_knowledge`).

### Established Patterns
- Prompts sempre carregados do banco (`promptKeys` + tabela `prompts`), nunca hardcoded em TS — mesmo padrão para o `system` prompt do Suporte.
- Fallback gracioso como filosofia geral do projeto (MCP inacessível, `IEventPublisher` fire-and-forget) — se aplica igualmente ao Suporte sem necessidade de reforço extra.
- `BRAIN_TOOLS` como whitelist CSV filtra tools nativas E MCP — exceção deliberada para `search_knowledge` nesta fase (D-04), primeira vez que uma tool precisa escapar desse filtro.

### Integration Points
- `apps/brain-support/src/index.ts` — novo entrypoint, espelha `apps/brain-sdr/src/index.ts` trocando `brainType: "sdr"` → `"support"` e removendo qualify.
- `apps/brain-support/src/brain.ts` — novo `IBrain`, sem `qualifier.ts` equivalente.
- `.env.example` do Suporte precisa de `DATABASE_NAME` próprio (ex: `cliente_suporte`) e das 3 ENVs de embedding (gap do SDR corrigido aqui).

</code_context>

<specifics>
## Specific Ideas

- Cenário concreto do usuário: um cliente pode contratar SDR + Suporte simultaneamente — cada um como imagem Docker separada, mesmo servidor Postgres, `DATABASE_NAME` diferente por Brain. Não há necessidade de suportar múltiplos Brains no mesmo banco nesta fase.
- Nenhuma referência visual ou exemplo de fluxo de suporte específico (ex: ticket, pedido) foi levantado — o escopo funcional do Suporte além de RAG + pause/finish é intencionalmente mínimo nesta fase.

</specifics>

<deferred>
## Deferred Ideas

- **Tool de escalonamento explícito (`escalate_to_human`)** — considerada durante a discussão e descartada para esta fase; o usuário optou por manter só `pause_session` + `finish_conversation`, que já cobrem "pausar IA" e "finalizar atendimento". Se necessidade de escalonamento formal (ex: abrir ticket, notificar humano) surgir depois, é nova capacidade — fase própria.
- **MCP externo (n8n) servindo tools de gestão via callback HTTP** — avaliado e rejeitado nesta fase em favor do hardcode (D-02). Registrado caso o produto evolua para precisar de tools de suporte mais dinâmicas/customizáveis por cliente no futuro.
- **Múltiplos Brains compartilhando o mesmo banco de um cliente** — fora de escopo; arquitetura atual (D-05) assume banco separado por Brain sempre.

### Reviewed Todos (not folded)

Nenhum todo pendente foi encontrado relacionado a esta fase (`todo match-phase 29` retornou 0 matches).

</deferred>

---

*Phase: 29-brain-suporte-core*
*Context gathered: 2026-07-01*
