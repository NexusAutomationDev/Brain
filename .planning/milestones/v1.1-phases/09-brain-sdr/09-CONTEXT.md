# Phase 9: Brain SDR - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 entrega o primeiro Brain real em produção: `apps/brain-sdr/`.

O que esta fase entrega:
1. App `apps/brain-sdr/` com `BrainSDR` implementando `IBrain` — grafo ReAct com 2 nós (llm + tools)
2. Tool `qualify_lead(description, session_id)` — aciona sub-agente de qualificação via tool call
3. Sub-agente de qualificação: LangGraph StateGraph stateless que busca histórico via PostgresSaver e retorna `{qualificado, motivo, proximo_passo}`
4. Prompts `system` + `qualification` no banco, com seed SQL na migration
5. TenantPoolManager ativado no entrypoint do app via `DATABASE_NAME` ENV

O que esta fase NÃO entrega:
- Outras tools além de `qualify_lead` (calendário, CRM, transferência) — pós v1.1
- Roteamento dinâmico de tenant dentro de uma instância — DATABASE_NAME é fixo por instância
- Sub-agente com persistência/checkpointer — stateless por design
- Outros Brains (Suporte, CS, Cobrança) — pós v1.1

Todo o resto (ia_ativada gate, thread_id = lead.uniqueId, janela de contexto, loadPrompts, PostgresSaver de histórico, LeadService, transports) já está implementado no BrainRunner — o Brain SDR herda tudo isso gratuitamente.

</domain>

<decisions>
## Implementation Decisions

### Acionamento do Sub-agente (SDR-05)

- **D-01:** O LLM do Brain principal decide quando acionar a qualificação via **tool call** — o Brain SDR registra a tool `qualify_lead` e o LLM a chama quando julgar o momento adequado.
- **D-02:** Grafo do Brain SDR segue o **padrão ReAct com 2 nós**: `llm` → (condicional: tool call?) → `tools` → `llm` → `__end__`. Após a tool retornar `{qualificado, motivo, proximo_passo}`, o fluxo volta ao nó `llm` que gera a mensagem final para o lead. Não há nó `response` separado.
- **D-03:** Brain SDR tem **apenas uma tool em v1.1**: `qualify_lead(description: string, session_id: string)`. Outras tools ficam para versões futuras.

### Sub-agente de Qualificação

- **D-04:** Sub-agente é implementado como **LangGraph StateGraph separado** — compilado sem checkpointer (ou MemorySaver in-memory), **stateless por design**. Não persiste nada no banco — apenas analisa e retorna.
- **D-05:** Sub-agente usa o **mesmo LLM do ENV** (`createLLM()` padrão) — sem ENVs extras, sem LLM separado.
- **D-06:** O histórico é buscado pelo **sub-agente diretamente via PostgresSaver** usando o `session_id` recebido. O sub-agente cria seu próprio PostgresSaver, carrega o checkpoint pelo thread_id (`session_id`), extrai todas as mensagens e separa em mensagens da IA (AIMessage) vs mensagens do lead (HumanMessage) antes de invocar o grafo de análise.
- **D-07:** A tool `qualify_lead` recebe dois parâmetros do LLM: `description` (breve contexto do momento da conversa) e `session_id` (thread_id do lead = lead.uniqueId). A tool executa o sub-agente e retorna `{qualificado: boolean, motivo: string, proximo_passo: string}`.

### promptKeys do Brain SDR (SDR-04)

- **D-08:** `promptKeys = ["system", "qualification"]` — duas chaves obrigatórias no banco.
  - `system`: prompt do Brain principal (como conduzir a conversa de atendimento SDR com o lead)
  - `qualification`: prompt do sub-agente (como analisar o histórico e decidir se o lead é qualificado)
- **D-09:** Prompts inseridos no banco via **seed SQL na própria migration** — INSERT com conteúdo padrão. Cliente substitui via API/update direto no banco se necessário. Zero prompts hardcoded no código.

### TenantPoolManager (INFRA-01)

- **D-10:** TenantPoolManager ativado **no entrypoint do app** (`apps/brain-sdr/src/index.ts`) — zero mudança no SDK (packages/core). Entrypoint cria o TenantPoolManager, obtém o pool via `DATABASE_NAME` ENV e passa o `sql` resultante ao `new BrainRunner({..., sql})`.
- **D-11:** **1 instância = 1 cliente** — `DATABASE_NAME` é fixo por instância Docker via ENV. TenantPoolManager gerencia o pool de conexões mas não roteia entre tenants dinamicamente.
- **D-12:** ENVs necessárias no entrypoint: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` (para TenantPoolManager) — além do `DATABASE_URL` ainda usado pelo PostgresSaver no BrainRunner.

### Claude's Discretion

- Nome exato do arquivo do sub-agente (`qualifier.ts`, `qualification-agent.ts`, etc.)
- Estrutura exata do StateGraph do sub-agente (quantos nós, como o prompt é aplicado)
- Formato do output do BrainSDR (seguir padrão do EchoBrain: `{ id, brainType, promptKeys, tools, buildGraph }`)
- Conteúdo padrão dos prompts `system` e `qualification` no seed SQL (Claude pode escolher conteúdo plausível de SDR)
- Tratamento de `QUALIFIER_TIMEOUT` ou erro no sub-agente (ConfigurationError vs fallback)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fase e Requirements

- `.planning/ROADMAP.md` §Phase 9 — Goal, success criteria, requirements SDR-01..05, INFRA-01
- `.planning/REQUIREMENTS.md` §Brain SDR e §Infraestrutura — definição formal dos requirements

### Código existente (referência e padrão)

- `apps/brain-echo/src/brain.ts` — IBrain implementation de referência para `brain-sdr/src/brain.ts`
- `apps/brain-echo/src/index.ts` — entrypoint de referência (adaptar para usar TenantPoolManager)
- `apps/brain-echo/src/server.ts` — server Hono de referência
- `packages/core/src/runner/runner.ts` — BrainRunner.run() já inclui: upsert lead, ia_ativada gate, thread_id = lead.uniqueId, getState() para janela de contexto, invoke(), saveContext()
- `packages/core/src/brain/interface.ts` — IBrain interface (promptKeys, buildGraph, tools, brainType)
- `packages/core/src/tools/registry.ts` — ToolsRegistry para registrar `qualify_lead` tool
- `packages/core/src/leads/lead-service.ts` — LeadService já implementado (não reescrever)
- `packages/database/src/pool-manager.ts` — TenantPoolManager (existente, ativar no entrypoint)
- `packages/ai/src/graph/checkpointer.ts` — createCheckpointer() + PostgresSaver.fromConnString()
- `packages/ai/src/index.ts` — createLLM() para o sub-agente

### Fases anteriores (decisões que afetam esta fase)

- `.planning/phases/08-brainrunner-conversation-history/08-CONTEXT.md` — D-01..D-09 (janela de contexto, thread_id, getState() pattern)
- `.planning/phases/07-leadservice-rabbitmq-transport/07-CONTEXT.md` — D-01..D-21 (LeadService, RabbitMQ, ia_ativada gate)
- `.planning/phases/06-leads-schema-migration/06-CONTEXT.md` — D-02 (unique_id = IDLead = thread_id)

### Convenções

- `CLAUDE.md` — runtime Bun, testes em `__tests__/`, sem arquivos de teste na raiz

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `apps/brain-echo/src/brain.ts`: template completo para `BrainSDR` — copiar e adaptar com nós `llm` + `tools`, conditional routing, e tool `qualify_lead`
- `packages/core/src/runner/runner.ts` linha ~171: `const threadId = lead.uniqueId` — já disponível como `session_id` para passar ao sub-agente via tool call
- `packages/ai/src/graph/checkpointer.ts`: `PostgresSaver.fromConnString(DATABASE_URL)` + `await checkpointer.setup()` — o sub-agente usa esse padrão para buscar o checkpoint
- `packages/database/src/pool-manager.ts`: `TenantPoolManager.getPool(databaseName)` retorna `Sql` — chamado com `process.env.DATABASE_NAME` no entrypoint
- `@langchain/langgraph`: `createReactAgent` ou `StateGraph` + `ToolNode` + condicional `shouldContinue` — padrão ReAct disponível

### Established Patterns

- `IBrain` interface: `{ id, brainType, promptKeys, tools, buildGraph(ctx) }` — BrainSDR segue exatamente
- `buildGraph()` NUNCA chama `.compile()` — BrainRunner é responsável (anti-pattern documentado em runner.ts)
- Prompts via `ctx.prompts["system"]` e `ctx.prompts["qualification"]` — sem hardcode
- Tool calling com `ctx.llm.bindTools([...tools])` em vez de `ctx.llm.invoke()` direto — necessário para tool call funcionar
- Migration com seed: `packages/database/src/migrations/` — adicionar nova migration para brain_sdr_prompts

### Integration Points

- `packages/core/src/tools/registry.ts`: registrar `brainType: "sdr"` com tool `qualify_lead`
- `apps/brain-sdr/src/index.ts`: criar TenantPoolManager → getPool(DATABASE_NAME) → new BrainRunner({ sql: pool, brain: sdrBrain, ... })
- `packages/transport/src/factory.ts`: transports já funcionam com qualquer BrainRunner — sem mudança necessária

</code_context>

<specifics>
## Specific Ideas

- **Fluxo completo do sub-agente**: tool `qualify_lead` recebe `(description, session_id)` → cria PostgresSaver → `saver.get({ configurable: { thread_id: session_id } })` → extrai `checkpoint.channel_values.messages` → filtra AIMessage vs HumanMessage → invoca sub-agente StateGraph com histórico separado → retorna `{qualificado, motivo, proximo_passo}`
- **Sub-agente stateless**: compilar com `MemorySaver` (in-memory) para evitar dependência de banco, já que é stateless por design. Ou simplesmente sem checkpointer se LangGraph permitir.
- **thread_id disponível no BrainRunner**: `threadId = lead.uniqueId` já calculado antes do invoke — o resultado é passado no state via `sessionId: threadId` e o LLM o usa como `session_id` no tool call.
- **Tool `qualify_lead` é registrada no ToolsRegistry** como qualquer outra tool — permite ser incluída/excluída por tipo de Brain sem hardcode no grafo.

</specifics>

<deferred>
## Deferred Ideas

- Tool `transfer_to_human` — transferir atendimento para humano quando necessário (pós v1.1)
- Tool `schedule_followup` — agendar follow-up no CRM (pós v1.1)
- Classificação de qualificação mais granular (SPIN/BANT completo) — pós v1.1 (já está em Out of Scope no REQUIREMENTS.md)
- Roteamento dinâmico de tenant (1 instância → múltiplos bancos) — quando escala demandar
- Sub-agente com persistência/histórico próprio — desnecessário para o caso de uso de qualificação

</deferred>

---

*Phase: 09-brain-sdr*
*Context gathered: 2026-06-14*
