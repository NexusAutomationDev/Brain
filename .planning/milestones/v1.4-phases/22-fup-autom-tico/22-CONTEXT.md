# Phase 22: FUP Automático - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Scheduler background detecta leads silenciosos (sem resposta após intervalo configurado) e envia follow-ups personalizados gerados por LLM one-shot, respeitando horário comercial e fuso horário IANA. Inclui: FupScheduler dentro do BrainRunner, cancelamento de FUPs ao receber mensagem (FUP-06), desativação automática no último FUP (FUP-05), proteção concorrente com SELECT FOR UPDATE SKIP LOCKED (FUP-02), retry até 3x em falha (FUP-08), e publicação de evento EVT-03 via EventPublisher.

**Não inclui:** RAG, novos transports, dashboard de FUP, FUP iniciado por tool call explícita (FUP-F01), re-indexação semântica.

</domain>

<decisions>
## Implementation Decisions

### Canal de Saída do FUP

- **D-01:** Canal de entrega é `FUP_WEBHOOK_URL` ENV — scheduler faz POST para esta URL com payload `{ Name, Numero, Message, IDLead }` (mesmo formato do webhook de entrada). O operador aponta para Z-API, Twilio, ou middleware do cliente.
- **D-02:** Se `FUP_WEBHOOK_URL` estiver ausente na inicialização, o FupScheduler não inicia — silencioso, sem erro de startup. Brain funciona normalmente sem FUP. Mesmo padrão do EventPublisher (sem ENV = noop).
- **D-03:** Sem autenticação no POST para `FUP_WEBHOOK_URL` — endpoint privado/interno do operador. Mesmo padrão do TOOL_EVENTS_URL (D-07 da Phase 20).

### Localização e Ciclo de Vida do FupScheduler

- **D-04:** `FupScheduler` é inicializado dentro de `BrainRunner.init()` e parado em `BrainRunner.close()`. Mesmo ciclo de vida do Brain — sem infra extra, segue padrão de `mcpClient` e `eventPublisher`.
- **D-05:** Intervalo de polling configurável via ENV `FUP_POLL_INTERVAL_MS` (default: `30000` = 30 segundos). O scheduler roda um "tick" a cada intervalo: busca leads elegíveis e processa FUPs pendentes.
- **D-06:** `FupScheduler` recebe o `sql` injetado no BrainRunner — reutiliza a conexão existente (TenantPoolManager já gerencia pool por cliente). Sem nova conexão.
- **D-07:** Concorrência entre múltiplas instâncias: query de busca de leads usa `SELECT ... FOR UPDATE SKIP LOCKED`. Instâncias que perdem a disputa pulam silenciosamente — FUP-02 especifica exatamente esse padrão.

### Elegibilidade e Processamento de FUP

- **D-08:** Lead elegível para FUP quando: `fup_enabled = true` AND `ia_ativada = true` AND `fup_next_at <= NOW()` AND `fup_step < len(intervals_seconds)`. Filtro adicional: `fup_config.enabled = true` para o `brain_type`.
- **D-09:** Ao processar um FUP: incrementar `fup_step`, calcular próximo `fup_next_at = NOW() + intervals_seconds[fup_step]` respeitando janela de horário/dias (FUP-07). Se fora da janela: agendar para próximo slot válido (primeira hora permitida do próximo dia permitido).
- **D-10:** Último FUP (quando `fup_step + 1 >= len(intervals_seconds)`): após envio bem-sucedido, setar `ia_ativada = false` AND `fup_enabled = false` no lead (FUP-05). O lead sai do ciclo de FUP automaticamente.

### Prompt e Geração de Conteúdo (FUP-03)

- **D-11:** Prompt FUP vem da tabela `prompts` com `key = 'fup'` para o `brain_type` do Brain. Zero alterações de schema — reutiliza estrutura existente com `key='system'`, `key='qualifier'` etc.
- **D-12:** Chamada LLM one-shot usando histórico da conversa via `PostgresSaver.getTuple(thread_id)` — recupera as últimas mensagens do lead e as inclui no contexto da chamada LLM. Sem invocar o grafo LangGraph completo.
- **D-13:** Se `key='fup'` não existir no banco para o `brain_type`, o scheduler loga `logger.warn` e pula o lead sem processar. Sem prompt hardcoded de fallback. Operador deve inserir o prompt antes de ativar FUP.

### Resiliência e Retry (FUP-08)

- **D-14:** `failure_count` por lead — coluna na tabela `leads` (nova coluna `fup_failure_count integer NOT NULL DEFAULT 0`). A cada falha de LLM ou transport, incrementar `fup_failure_count`. Se `fup_failure_count >= 3`, marcar lead com `fup_enabled = false` e logar alerta (`logger.error`). Reset do contador a cada FUP bem-sucedido.
- **D-15:** Retry imediato dentro do mesmo tick: até 3 tentativas com backoff simples (sem exponencial para v1.4 — YAGNI). Se falhar 3x no mesmo tick, escrever no banco e aguardar próximo polling.

### EVT-03 — Evento de FUP via EventPublisher

- **D-16:** Ao enviar FUP com sucesso, `FupScheduler` chama `eventPublisher.publish([fupEvent])` fire-and-forget (sem await no call site). Reutiliza `IEventPublisher` e canal `TOOL_EVENTS_URL`/`TOOL_EVENTS_QUEUE` já configurado.
- **D-17:** Estrutura do evento FUP (EVT-03):
  ```ts
  {
    event_id: string;   // `${lead.uniqueId}:fup:${fup_step}` — idempotente por step
    action: "fup";
    lead: { id: string; nome: string | null; numero: string };
    result: { step: number; message: string };  // diferente do result de tool events (string raw)
    timestamp: string;  // ISO 8601
  }
  ```
- **D-18:** `FupScheduler` recebe `eventPublisher: IEventPublisher | null` no construtor — injetável para testes. Se null (sem TOOL_EVENTS_* configurado), pula a publicação silenciosamente.

### FUP-06 — Cancelamento ao Receber Mensagem

- **D-19:** Quando o lead responde, `BrainRunner.run()` já chama `touchLastMessage()`. Além disso, deve setar `fup_next_at = NULL` e `fup_step = 0` no lead — resetando o ciclo de FUP. `fup_enabled` permanece `true` (lead continua elegível para novo ciclo de FUP se silenciar novamente). Implementado via novo método `LeadService.resetFup(uniqueId)`.

### Claude's Discretion

- Localização exata do `FupScheduler`: `packages/core/src/fup/fup-scheduler.ts` (seguindo padrão de `events/event-publisher.ts`)
- Nome exato da coluna de retry: `fup_failure_count` (migration nova se não existir — verificar se está na tabela leads)
- Estrutura interna do tick do scheduler (batch size, limite de leads por tick)
- LLM provider para chamada one-shot do FUP (reutilizar `createLLM()` do BrainRunner)
- Formato exato do payload POST para `FUP_WEBHOOK_URL` (verificar se inclui `Name` com nome do bot)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e Roadmap

- `.planning/REQUIREMENTS.md` — FUP-01 a FUP-08 e EVT-03: definições exatas dos requisitos; seção FUP — Futuro para o que está fora do escopo
- `.planning/ROADMAP.md` §Phase 22 — Success Criteria: 5 critérios a verificar

### Schema e Decisões de Phase 19

- `.planning/phases/19-database-foundation/19-CONTEXT.md` — D-01 a D-16: todas as decisões de schema FUP já tomadas (brain_type PK, intervals_seconds integer[], allowed_days text[], fup_enabled/fup_step/fup_next_at em leads)
- `packages/database/src/schema/tables.ts` — definições Drizzle de `leads`, `fupConfig`, `prompts`, `knowledgeChunks`

### Implementações de Referência (padrões a replicar)

- `packages/core/src/runner/runner.ts` — BrainRunner: ciclo de vida init/run/close, injeção de dependências (mcpClient, eventPublisher) — FupScheduler segue o mesmo padrão
- `packages/core/src/leads/lead-service.ts` — LeadService: padrão de métodos SQL (touchLastMessage, setIaAtivada) — LeadService.resetFup() segue o mesmo padrão
- `packages/core/src/events/event-publisher.ts` — IEventPublisher interface e EventPublisher: padrão de publicação fire-and-forget, já implementado na Phase 20
- `packages/transport/src/rabbitmq/consumer.ts` — padrão de retry (retryMap), failure_count, DLQ — adaptar para lógica de retry do FUP (FUP-08)

### PostgresSaver (para FUP-03)

- `packages/core/src/runner/runner.ts` linha ~100: como `PostgresSaver` é criado e configurado — FupScheduler precisa de referência ao checkpointer para `getTuple(thread_id)`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `BrainRunner.init()`: padrão de inicialização de dependências opcionais — `if (!this.eventPublisher) { const publisher = new EventPublisher(); await publisher.init(); this.eventPublisher = publisher; }` — FupScheduler segue o mesmo padrão condicional
- `LeadService`: classe com sql injetado e métodos de update atômico — base para `resetFup(uniqueId)` que seta `fup_next_at = NULL, fup_step = 0`
- `IEventPublisher.publish(events: ToolEvent[])`: interface já disponível — FupScheduler chama `eventPublisher.publish([fupEvent])` com ToolEvent estendido (action='fup', result como objeto)
- `createLLM()` em `packages/core`: factory de LLM — FupScheduler reutiliza o mesmo createLLM() para chamada one-shot

### Established Patterns

- Dependências opcionais no BrainRunner: campo `private X: T | null = null` + inicialização condicional em `init()` + cleanup em `close()` — FupScheduler segue EXATAMENTE esse padrão
- `SELECT FOR UPDATE SKIP LOCKED`: pattern de concorrência já validado no projeto (vide Phase 19 para migrations com advisory lock — FUP-02 usa SKIP LOCKED diretamente em leads)
- Tabela `prompts` com `(brain_type, key)` unique: `SELECT content FROM prompts WHERE brain_type = ? AND key = 'fup'` — sem migration adicional
- `logger.warn({ err, ... }, "mensagem")`: padrão de log de falha não-bloqueante — mesmo de EventPublisher

### Integration Points

- `BrainRunner.init()` (runner.ts ~linha 125): após `_compileGraph()` e inicialização do `eventPublisher` — ponto de inserção do `FupScheduler.start()`
- `BrainRunner.run()` (runner.ts ~linha 220): após `touchLastMessage()` — adicionar `LeadService.resetFup(lead.uniqueId)` para FUP-06
- `BrainRunner.close()` (runner.ts ~linha 355): após fechar `eventPublisher` — adicionar `FupScheduler.stop()`
- `packages/core/src/index.ts`: barrel export — exportar `FupScheduler`, `IFupScheduler` junto com EventPublisher

</code_context>

<specifics>
## Specific Ideas

- `FUP_POLL_INTERVAL_MS` ENV com default 30000ms — controlável em staging (ex: 5000ms para testar rápido) sem alterar código
- `event_id` do FUP = `${lead.uniqueId}:fup:${fup_step}` — garante idempotência por step (mesmo step re-enviado produz mesmo event_id)
- Payload do POST para `FUP_WEBHOOK_URL` usa mesmo schema do BrainEventSchema: `{ Name, Message, Numero, IDLead }` — consumidor downstream pode processar FUP e resposta humana pelo mesmo endpoint

</specifics>

<deferred>
## Deferred Ideas

- `FUP_REPLY_QUEUE` (RabbitMQ dedicado para saída de FUP) — não necessário para v1.4; FUP_WEBHOOK_URL cobre o caso de uso
- Autenticação no POST para FUP_WEBHOOK_URL (`FUP_WEBHOOK_TOKEN`) — endpoint privado; auth pode ser adicionada em patch se necessário
- Backoff exponencial no retry de FUP — FUP-F01 (futuro); v1.4 usa retry simples até 3x
- Dashboard de status de FUPs — FUP-F02 (futuro)
- FUP por segmento de leads — FUP-F03 (futuro)
- EVT-F01: retry com backoff exponencial no canal de eventos (v1.4 é fire-and-forget)

</deferred>

---

*Phase: 22-fup-autom-tico*
*Context gathered: 2026-06-23*
