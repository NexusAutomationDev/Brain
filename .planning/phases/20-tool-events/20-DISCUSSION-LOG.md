# Phase 20: Tool Events - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 20-tool-events
**Areas discussed:** Mecanismo de Intercepção, Escopo das Tools, Comportamento de Canal, Localização do EventPublisher

---

## Mecanismo de Intercepção

| Option | Description | Selected |
|--------|-------------|----------|
| Pós-processamento no BrainRunner.run() | Após invoke(), filtrar ToolMessages do estado retornado. BrainRunner já tem lead + thread_id. | ✓ |
| Callbacks LangGraph (handleToolEnd) | Registrar callback no invoke(). Research flag: não testado com MCP tools; lead data não disponível na callback. | |
| Wrapper nas factories de tools | Injetar EventPublisher em createPauseSessionTool etc. Tool publica internamente. | |

**User's choice:** Pós-processamento no BrainRunner.run()
**Notes:** Escolha alinha com o research flag anotado no STATE.md — evita depender de handleToolEnd para MCP tools.

---

### event_id derivation

| Option | Description | Selected |
|--------|-------------|----------|
| Ler ToolMessage.tool_call_id | Campo nativo LangChain. Determinista: thread_id:tool_call_id. | ✓ |
| Gerar UUID por evento | Simples mas perde idempotência (EVT-04). | |

**User's choice:** Sim, ler ToolMessage.tool_call_id

---

## Escopo das Tools Cobertas

### Whitelist

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded no SDK core | Set fixo: {qualify_lead, pause_session, finish_conversation}. EVT-02 especifica exatamente essas 3. | ✓ |
| Configurável via ENV TOOL_EVENTS_TOOLS | Mais flexível, adiciona surface de configuração. | |

**User's choice:** Hardcoded no SDK core

---

### MCP Tools

| Option | Description | Selected |
|--------|-------------|----------|
| Não — apenas tools nativas do SDK | MCP tools têm nomes dinâmicos. EVT-02 não menciona MCP. | ✓ |
| Sim — toda ToolMessage na whitelist | Comportamento acidental, não intencional. | |

**User's choice:** Não — apenas tools nativas do SDK

---

### Campo result

| Option | Description | Selected |
|--------|-------------|----------|
| String raw do ToolMessage.content | Consumidor interpreta. Simples, sem dependência de formato. | ✓ |
| JSON parseado se possível | qualify_lead retorna JSON; as outras retornam plain text. | |

**User's choice:** String raw do ToolMessage.content

---

## Comportamento de Canal

### Dual ENV

| Option | Description | Selected |
|--------|-------------|----------|
| Publicar em ambos — broadcast | Paralelo para webhook E RabbitMQ. | (initial selection, overridden) |
| RabbitMQ tem prioridade | Se TOOL_EVENTS_QUEUE configurado, ignora TOOL_EVENTS_URL. | ✓ |
| Webhook tem prioridade | Se TOOL_EVENTS_URL configurado, ignora TOOL_EVENTS_QUEUE. | |

**User's choice:** RabbitMQ tem prioridade
**Notes:** Usuário clarificou via mensagem inline: "se tiver o RabbitMQ habilitado, não é para usar o webhook". Decisão override da seleção inicial de broadcast.

---

### Autenticação webhook

| Option | Description | Selected |
|--------|-------------|----------|
| Sem autenticação | TOOL_EVENTS_URL é endpoint privado/interno. | ✓ |
| Via TOOL_EVENTS_TOKEN ENV | Bearer token opcional para endpoints públicos. | |

**User's choice:** Não — sem autenticação

---

### Falha na publicação

| Option | Description | Selected |
|--------|-------------|----------|
| Log warn + ignorar | Fire-and-forget. Resposta ao lead não é afetada. | ✓ |
| Retry com backoff simples | 1-3 tentativas. | |

**User's choice:** Log warn + ignorar

---

### RABBITMQ_URL

| Option | Description | Selected |
|--------|-------------|----------|
| Reutilizar RABBITMQ_URL existente | Publisher adicional na mesma conexão. Sem nova ENV. | ✓ |
| URL separada TOOL_EVENTS_RABBITMQ_URL | Broker separado. Mais ENVs e segunda conexão. | |

**User's choice:** Reutilizar RABBITMQ_URL existente

---

## Localização do EventPublisher

### Pacote

| Option | Description | Selected |
|--------|-------------|----------|
| packages/core | BrainRunner orquestra tudo. Acessível a todos os Brains automaticamente. | ✓ |
| packages/transport | Transport é para input, não output de eventos. | |
| packages/events (novo) | Isolamento total, mas adiciona pacote desnecessário. | |

**User's choice:** packages/core

---

### Ciclo de vida

| Option | Description | Selected |
|--------|-------------|----------|
| Inicializado no init(), interno ao BrainRunner | Uma vez no startup. Injetável via construtor para testes. | ✓ |
| Criado por request em run() | Recria conexão a cada mensagem — inútil para RabbitMQ. | |

**User's choice:** Inicializado no init(), interno ao BrainRunner

---

## Claude's Discretion

- Tipo TypeScript exato de EventPublisher (interface vs classe)
- Timeout do fetch() no canal webhook
- Estratégia de abertura da conexão RabbitMQ (lazy vs eager)

## Deferred Ideas

- EVT-03 (eventos de FUP) — Phase 22
- Autenticação Bearer em TOOL_EVENTS_URL — sem requisito atual
- Retry com backoff para publicação
- Broadcast (ambos canais simultâneos) — descartado
- Whitelist configurável via ENV — descartado
