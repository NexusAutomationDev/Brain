# Phase 20: Tool Events - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Brains publicam automaticamente o resultado de cada tool relevante em um canal de saída separado (webhook via `TOOL_EVENTS_URL` ou RabbitMQ via `TOOL_EVENTS_QUEUE`), sem bloquear o fluxo principal. A intercepção acontece no BrainRunner.run() após invoke(), não dentro do grafo ou das factories de tools. Não inclui EVT-03 (eventos de FUP — Phase 22).

</domain>

<decisions>
## Implementation Decisions

### Mecanismo de Intercepção

- **D-01:** Pós-processamento no `BrainRunner.run()` — após `compiledGraph.invoke()`, filtrar ToolMessages do estado retornado (`result.messages`) cujo `name` está na whitelist. BrainRunner já tem `lead` + `thread_id` no contexto da chamada.
- **D-02:** `event_id = thread_id:tool_call_id` — derivado lendo `ToolMessage.tool_call_id` (campo nativo LangChain). Garante idempotência conforme EVT-04: dois eventos do mesmo tool call produzem o mesmo `event_id`.

### Escopo das Tools Cobertas

- **D-03:** Whitelist hardcoded no SDK core: `{ "qualify_lead", "pause_session", "finish_conversation" }`. Não configurável via ENV (YAGNI — EVT-02 especifica exatamente essas 3).
- **D-04:** Tools MCP não geram eventos — apenas tools nativas do SDK na whitelist. Mesmo que uma MCP tool tenha nome coincidente, não está no escopo desta fase.
- **D-05:** Campo `result` no evento = `ToolMessage.content` como string raw. Sem parsing JSON. Consumidor interpreta o conteúdo.

### Canal de Saída

- **D-06:** RabbitMQ tem prioridade — se `TOOL_EVENTS_QUEUE` estiver configurado, o EventPublisher usa RabbitMQ e ignora `TOOL_EVENTS_URL`. Reflete o "ou" de EVT-01: os canais são excludentes quando ambos presentes.
- **D-07:** Sem autenticação para webhook de tool events — `TOOL_EVENTS_URL` é endpoint privado/interno do operador. Sem ENV `TOOL_EVENTS_TOKEN`.
- **D-08:** Falha na publicação (HTTP 5xx, RabbitMQ inacessível) = `logger.warn` + ignorar. Publicação é fire-and-forget. Nunca bloqueia nem atrasa a resposta do Brain ao lead (EVT-01).
- **D-09:** Canal RabbitMQ de tool events reutiliza `RABBITMQ_URL` existente — sem nova ENV de conexão. EventPublisher abre um `Publisher` separado na mesma conexão.

### Localização e Ciclo de Vida do EventPublisher

- **D-10:** `EventPublisher` vive em `packages/core` — junto ao BrainRunner, não em `packages/transport` (que é para input) nem em pacote separado.
- **D-11:** Inicializado no `BrainRunner.init()` uma vez, lendo ENVs no startup. Armazenado como `private eventPublisher`. Injetável via construtor (optional parameter) para testabilidade — seguindo o padrão do `mcpClient`.

### Estrutura do Evento

Conforme EVT-02 + EVT-04:
```ts
{
  event_id: string;    // thread_id:tool_call_id (D-02)
  action: string;      // nome da tool: "qualify_lead" | "pause_session" | "finish_conversation"
  lead: {
    id: string;        // lead.uniqueId (= thread_id)
    nome: string | null;
    numero: string;
  };
  result: string;      // ToolMessage.content raw (D-05)
  timestamp: string;   // ISO 8601
}
```

### Claude's Discretion

- Tipo TypeScript exato de `EventPublisher` (interface vs classe)
- Timeout para fetch() no canal webhook (sugestão: 5s)
- Estratégia de abertura da conexão RabbitMQ no EventPublisher (lazy vs eager em init())
- Nome exato da fila no RabbitMQ: `TOOL_EVENTS_QUEUE` é lido do ENV (configurado pelo operador)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e Roadmap

- `.planning/REQUIREMENTS.md` §EVT-01, EVT-02, EVT-03, EVT-04 — definições exatas dos eventos, campos obrigatórios e comportamento de canal
- `.planning/ROADMAP.md` §Phase 20 — Success Criteria: 5 critérios de aceitação

### BrainRunner e Tools

- `packages/core/src/runner/runner.ts` — BrainRunner: onde adicionar intercepção pós-invoke() e inicialização do EventPublisher
- `packages/core/src/tools/pause-session.ts` — factory de tool; retorna string de resultado
- `packages/core/src/tools/finish-conversation.ts` — factory de tool; retorna string de resultado
- `apps/brain-sdr/src/brain.ts` — grafo LangGraph + ToolNode; referência para como ToolMessages são gerados

### Padrões de Transport (RabbitMQ)

- `packages/transport/src/rabbitmq/consumer.ts` — uso de `rabbitmq-client`: `Connection`, `createPublisher`, `confirm: true`; padrão de inicialização e lifecycle para reutilizar no EventPublisher

### Schema e Tipos Existentes

- `packages/database/src/schema/tables.ts` — tabela `leads` com colunas `uniqueId`, `nome`, `numero`
- `packages/core/src/leads/lead-service.ts` — `Lead` type: campos disponíveis no BrainRunner.run()

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/transport/src/rabbitmq/consumer.ts`: padrão de uso do `rabbitmq-client` — `new Connection(url)`, `createPublisher({ confirm: true })`, `pub.send(queue, body)` — reutilizar exatamente no EventPublisher para RabbitMQ
- `packages/core/src/runner/runner.ts` `run()` lines 183-285: após `compiledGraph.invoke()` (linha ~234), `result.messages` contém todas as mensagens do turno incluindo ToolMessages — filtrar por tipo + name
- `BrainRunner.run()` já tem `lead` (objeto com `uniqueId`, `nome`, `numero`) e `threadId` disponíveis no escopo — sem lookup adicional ao banco para construir o evento

### Established Patterns

- Webhook fire-and-forget: usar `fetch(url, { method: "POST", body: JSON.stringify(event), headers: { "Content-Type": "application/json" } })` sem await de resultado (só capturar erro em catch silencioso)
- ENV opcional com fallback: padrão `process.env.TOOL_EVENTS_URL?.trim()` — ausente = publisher desabilitado
- `mcpClient` como referência de objeto privado injetável: `constructor(options: BrainRunnerOptions)` com `options.eventPublisher?: IEventPublisher` para testabilidade
- `createLogger()` de `@brain-pkg/observability` para logs de warn em falhas

### Integration Points

- `packages/core/src/runner/runner.ts` `run()`: após linha 245 (`const result = await this.compiledGraph.invoke(...)`), antes de Step 3 (validação de output) — filtrar ToolMessages e chamar `this.eventPublisher?.publish(events)`
- `packages/core/src/runner/runner.ts` `init()`: após `_compileGraph()` (linha ~125) — inicializar `this.eventPublisher` a partir de ENVs
- `packages/core/src/runner/runner.ts` `close()`: incluir cleanup do EventPublisher (fechar Publisher RabbitMQ se aberto)

</code_context>

<specifics>
## Specific Ideas

- RabbitMQ tem prioridade sobre webhook: se `TOOL_EVENTS_QUEUE` configurado, ignora `TOOL_EVENTS_URL` — evitar broadcast acidental
- Publisher injetável no construtor (optional) para testes unitários sem conexão real — mesmo padrão do `mcpClient`
- Intercepção via `result.messages` (pós-processamento) elimina o research flag "handleToolEnd dispara para MCP tools?" — não depende de callbacks LangGraph

</specifics>

<deferred>
## Deferred Ideas

- EVT-03: eventos de FUP (`action: "fup"`) — Phase 22
- Autenticação Bearer em `TOOL_EVENTS_URL` (`TOOL_EVENTS_TOKEN`) — sem requisito atual; endpoint é privado por design
- Retry com backoff para falhas de publicação — sem requisito (fire-and-forget é o design)
- Broadcast (publicar em ambos webhook e RabbitMQ) — descartado; RabbitMQ tem prioridade quando ambos configurados
- Whitelist configurável via ENV (`TOOL_EVENTS_TOOLS`) — YAGNI; hardcoded é suficiente

</deferred>

---

*Phase: 20-tool-events*
*Context gathered: 2026-06-23*
