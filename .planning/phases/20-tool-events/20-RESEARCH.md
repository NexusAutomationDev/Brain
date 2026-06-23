# Phase 20: Tool Events - Research

**Researched:** 2026-06-23
**Domain:** Event publishing pós-invoke LangGraph, fire-and-forget, BrainRunner extensão
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Mecanismo de Intercepção**
- **D-01:** Pós-processamento no `BrainRunner.run()` — após `compiledGraph.invoke()`, filtrar ToolMessages do estado retornado (`result.messages`) cujo `name` está na whitelist.
- **D-02:** `event_id = thread_id:tool_call_id` — derivado lendo `ToolMessage.tool_call_id`. Garante idempotência (EVT-04).

**Escopo das Tools**
- **D-03:** Whitelist hardcoded: `{ "qualify_lead", "pause_session", "finish_conversation" }`. Não configurável via ENV.
- **D-04:** Tools MCP não geram eventos — apenas tools nativas da whitelist.
- **D-05:** Campo `result` = `ToolMessage.content` como string raw. Sem parsing JSON.

**Canal de Saída**
- **D-06:** RabbitMQ tem prioridade — se `TOOL_EVENTS_QUEUE` configurado, ignora `TOOL_EVENTS_URL`.
- **D-07:** Sem autenticação para `TOOL_EVENTS_URL` — endpoint interno/privado.
- **D-08:** Falha na publicação = `logger.warn` + ignorar. Nunca bloqueia a resposta.
- **D-09:** Canal RabbitMQ reutiliza `RABBITMQ_URL` existente. EventPublisher abre `Publisher` separado.

**Localização e Lifecycle**
- **D-10:** `EventPublisher` em `packages/core` — junto ao BrainRunner.
- **D-11:** Inicializado em `BrainRunner.init()`, armazenado como `private eventPublisher`. Injetável via construtor (optional parameter) para testabilidade.

**Estrutura do Evento**
```ts
{
  event_id: string;    // thread_id:tool_call_id
  action: string;      // "qualify_lead" | "pause_session" | "finish_conversation"
  lead: { id: string; nome: string | null; numero: string; };
  result: string;      // ToolMessage.content raw
  timestamp: string;   // ISO 8601
}
```

### Claude's Discretion
- Tipo TypeScript exato de `EventPublisher` (interface vs classe)
- Timeout para `fetch()` no canal webhook (sugestão: 5s)
- Estratégia de abertura da conexão RabbitMQ no EventPublisher (lazy vs eager em `init()`)
- Nome exato da fila no RabbitMQ: lido do `TOOL_EVENTS_QUEUE` ENV

### Deferred Ideas (OUT OF SCOPE)
- EVT-03: eventos de FUP (`action: "fup"`) — Phase 22
- Autenticação Bearer em `TOOL_EVENTS_URL`
- Retry com backoff para falhas de publicação
- Broadcast em ambos webhook e RabbitMQ simultaneamente
- Whitelist configurável via ENV
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVT-01 | Brain publica eventos em canal separado (webhook via `TOOL_EVENTS_URL` ou RabbitMQ via `TOOL_EVENTS_QUEUE`) configurável via ENV, sem bloquear fluxo principal | Padrão fire-and-forget com `fetch()` sem await e `pub.send()` assíncrono não-bloqueante confirmado no codebase |
| EVT-02 | `qualify_lead`, `pause_session` ou `finish_conversation` publicam `{ action, lead, result }` automaticamente | `result.messages` pós-invoke contém `ToolMessage` com campos `name`, `tool_call_id`, `content` — verificado no type def de `@langchain/core` |
| EVT-03 | FORA DO ESCOPO desta fase (Phase 22) | — |
| EVT-04 | `event_id = thread_id:tool_call_id` para deduplicação idempotente | `ToolMessage.tool_call_id` é campo nativo da classe `ToolMessage` — verificado em `tool.d.ts` de `@langchain/core@1.1.48` |
</phase_requirements>

---

## Summary

Esta fase implementa um canal de saída de eventos de tool no `BrainRunner`. O mecanismo é simples: após `compiledGraph.invoke()` retornar, filtrar as mensagens no estado resultante para encontrar `ToolMessage`s cujo campo `name` pertence à whitelist `{ "qualify_lead", "pause_session", "finish_conversation" }` e publicar um evento estruturado para o canal configurado (webhook ou RabbitMQ).

O `BrainRunner` já tem todo o contexto necessário no escopo de `run()`: `lead` (com `uniqueId`, `nome`, `numero`) e `threadId`. O campo `event_id` é derivado diretamente de `thread_id:toolMessage.tool_call_id`, que é um campo nativo de `ToolMessage` na versão instalada de `@langchain/core@1.1.48`. Não há lookups adicionais ao banco nem dependência de callbacks do LangGraph.

O `EventPublisher` vive em `packages/core/src/events/` (novo diretório), é injetável como optional no `BrainRunnerOptions`, e reutiliza o padrão de `rabbitmq-client` já estabelecido em `packages/transport/src/rabbitmq/consumer.ts`. Para o canal webhook, o padrão é `fetch()` com timeout de 5s dentro de um `try/catch` que absorve erros silenciosamente.

**Primary recommendation:** Implementar `EventPublisher` como classe com interface `IEventPublisher` em `packages/core/src/events/`, seguindo o padrão de injeção do `mcpClient`. A intercepção acontece entre as linhas ~245 e ~248 do `runner.ts` atual (após `invoke()`, antes da validação de `brainOutput`).

---

## Standard Stack

### Core — Já na stack, sem instalações novas

| Library | Version | Purpose | Por que |
|---------|---------|---------|---------|
| `rabbitmq-client` | ^5.0.8 | Publisher RabbitMQ no EventPublisher | Já usada em `packages/transport`; `createPublisher({ confirm: true })` — API confirmada no codebase |
| `@langchain/core` | ^1.1.48 | `ToolMessage`, `ToolMessage.isInstance()` | Instalada em `packages/core`; `ToolMessage.tool_call_id` e `ToolMessage.name` verificados no type def |
| `fetch` (Bun built-in) | Bun 1.x | HTTP webhook fire-and-forget | Built-in no Bun; sem dependência adicional |
| `@brain-pkg/observability` | workspace | `createLogger()` para warn em falhas | Já importada no runner.ts |

**Instalações necessárias:** Nenhuma. Toda a stack está presente.

---

## Architecture Patterns

### Estrutura de Arquivos Recomendada

```
packages/core/src/
  events/
    event-publisher.ts        # IEventPublisher interface + EventPublisher class
    __tests__/
      unit/
        event-publisher.test.ts   # testes unitários (mock de fetch e rabbitmq-client)
  runner/
    runner.ts                 # MODIFICADO: init() e run() com EventPublisher
```

### Pattern 1: IEventPublisher com injeção opcional

**O que é:** Interface TypeScript + classe concreta. O construtor do `BrainRunner` aceita `eventPublisher?: IEventPublisher` como optional. Em produção, `init()` cria o publisher real. Em testes, injeta um mock.

**Quando usar:** Padrão já estabelecido para `mcpClient` no `BrainRunner` — replicar exatamente.

```typescript
// packages/core/src/events/event-publisher.ts
// [VERIFIED: codebase — pattern do mcpClient em runner.ts]

export interface ToolEvent {
  event_id: string;    // `${threadId}:${toolCallId}`
  action: string;
  lead: { id: string; nome: string | null; numero: string };
  result: string;
  timestamp: string;   // new Date().toISOString()
}

export interface IEventPublisher {
  publish(events: ToolEvent[]): Promise<void>;
  close(): Promise<void>;
}

export class EventPublisher implements IEventPublisher {
  // Detecta canal no construtor (lê ENVs) — não em publish()
  // RabbitMQ tem prioridade (D-06)
  constructor(private readonly logger: ReturnType<typeof createLogger>) {}
  // ...
}
```

### Pattern 2: Filtro de ToolMessages pós-invoke

**O que é:** Após `invoke()` retornar `result`, iterar `result.messages` e coletar `ToolMessage`s cujo `name` está na whitelist.

**Quando usar:** Único ponto de intercepção — sem callbacks LangGraph, sem modificar as tools.

```typescript
// Inserir após linha ~245 em runner.ts (após invoke(), antes do Step 3)
// [VERIFIED: codebase runner.ts linhas 234-247 + @langchain/core tool.d.ts]

import { ToolMessage } from "@langchain/core/messages";

const TOOL_EVENTS_WHITELIST = new Set([
  "qualify_lead",
  "pause_session",
  "finish_conversation",
]);

const toolEvents: ToolEvent[] = [];
for (const msg of result.messages ?? []) {
  if (
    ToolMessage.isInstance(msg) &&
    typeof msg.name === "string" &&
    TOOL_EVENTS_WHITELIST.has(msg.name)
  ) {
    toolEvents.push({
      event_id: `${threadId}:${msg.tool_call_id}`,
      action: msg.name,
      lead: {
        id: lead.uniqueId,
        nome: lead.nome ?? null,
        numero: lead.numero,
      },
      result: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      timestamp: new Date().toISOString(),
    });
  }
}

// Fire-and-forget — não await para não bloquear resposta
if (toolEvents.length > 0) {
  this.eventPublisher?.publish(toolEvents).catch((err: unknown) => {
    this.logger.warn({ err }, "EventPublisher.publish failed — ignoring (fire-and-forget)");
  });
}
```

### Pattern 3: Webhook fire-and-forget com timeout

**O que é:** `fetch()` com `AbortSignal.timeout(5000)` — sem await no call site.

**Quando usar:** Canal webhook (`TOOL_EVENTS_URL` configurado e `TOOL_EVENTS_QUEUE` ausente).

```typescript
// [VERIFIED: codebase — padrão de fetch + CONTEXT.md D-07 + D-08]
// Timeout de 5s: Claude's Discretion — sugestão do CONTEXT.md

async publish(events: ToolEvent[]): Promise<void> {
  for (const event of events) {
    try {
      await fetch(this.webhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      this.logger.warn({ err, eventId: event.event_id }, "Webhook event publish failed — ignoring");
    }
  }
}
```

### Pattern 4: RabbitMQ Publisher reutilizando `RABBITMQ_URL`

**O que é:** `new Connection(RABBITMQ_URL)` + `createPublisher({ confirm: true })` — mesmo padrão do `consumer.ts`.

**Quando usar:** Canal RabbitMQ (`TOOL_EVENTS_QUEUE` configurado).

```typescript
// [VERIFIED: codebase packages/transport/src/rabbitmq/consumer.ts linhas 67-76]
// D-09: reutiliza RABBITMQ_URL existente

import { Connection } from "rabbitmq-client";

// Na inicialização (eager — em init() do BrainRunner):
const rabbit = new Connection(process.env.RABBITMQ_URL!);
const pub = rabbit.createPublisher({ confirm: true });

// No publish():
await pub.send(this.queue, event);

// No close():
await pub.close();
await rabbit.close();
```

### Pattern 5: Detecção de canal no construtor

**O que é:** Ler ENVs no construtor do `EventPublisher`. Se `TOOL_EVENTS_QUEUE` está presente, usa RabbitMQ e ignora `TOOL_EVENTS_URL`. Se apenas `TOOL_EVENTS_URL`, usa webhook. Se nenhum, `publish()` é no-op.

```typescript
// [VERIFIED: CONTEXT.md D-06, D-09]
// Leitura de ENV no construtor — falha rápido se RABBITMQ_URL ausente quando TOOL_EVENTS_QUEUE configurado

const queue = process.env.TOOL_EVENTS_QUEUE?.trim();
const webhookUrl = process.env.TOOL_EVENTS_URL?.trim();

if (queue) {
  const rabbitUrl = process.env.RABBITMQ_URL;
  if (!rabbitUrl) throw new ConfigurationError("TOOL_EVENTS_QUEUE requer RABBITMQ_URL");
  // modo RabbitMQ — ignora webhookUrl (D-06)
} else if (webhookUrl) {
  // modo webhook
} else {
  // modo desabilitado — publish() é no-op
}
```

### Anti-Patterns a Evitar

- **Await no call site de `publish()`:** `this.eventPublisher.publish(...)` deve ser fire-and-forget no `run()`. O await vai dentro do método `publish()` para processar cada evento em série. O call site usa `.catch()` sem await.
- **Await no BrainRunner.run():** Nunca `await this.eventPublisher?.publish(...)` — viola EVT-01 (não bloquear resposta).
- **Criar nova conexão RabbitMQ por evento:** A conexão e o Publisher são criados uma vez em `init()`, reutilizados em cada `publish()`.
- **Usar `result.messages.filter(m => m.type === "tool")`:** Usar `ToolMessage.isInstance(msg)` — é o type guard oficial de `@langchain/core@1.1.48` (verificado no type def).
- **Acessar `msg.name` sem verificar tipo:** `name` é campo de `BaseMessageFields` (opcional) — verificar `typeof msg.name === "string"` antes de usar.
- **Modificar tools ou grafo:** Toda a lógica fica em `BrainRunner.run()`, fora do grafo.

---

## Don't Hand-Roll

| Problema | Não Construir | Usar Em Vez | Por que |
|----------|---------------|-------------|---------|
| Type guard para ToolMessage | `msg._getType() === "tool"` | `ToolMessage.isInstance(msg)` | API oficial, type-safe, não acessa campos internos |
| Timeout em fetch | setTimeout + AbortController manual | `AbortSignal.timeout(5000)` | API Web padrão disponível no Bun |
| Conexão RabbitMQ | Parser AMQP próprio | `rabbitmq-client@^5.0.8` | Já na stack; auto-reconnect built-in |

---

## Common Pitfalls

### Pitfall 1: `result.messages` pode conter ToolMessages do histórico inteiro, não só do turno atual

**O que dá errado:** LangGraph acumula mensagens no estado. `result.messages` contém todo o histórico do turno, incluindo mensagens de turnos anteriores se o grafo não filtrar.

**Por que acontece:** `BrainStateAnnotation` usa um reducer que acumula mensagens. Em um ReAct loop dentro de um turno, `result.messages` terá todas as mensagens do turno: HumanMessage → AIMessage (com tool_call) → ToolMessage → AIMessage (resposta final). Mensagens de turnos anteriores ficam no checkpointer, não em `result`.

**Como evitar:** O pós-processamento em `result.messages` está correto — o objeto `result` retornado por `invoke()` é o estado final do grafo, não o histórico acumulado do checkpointer. ToolMessages em `result.messages` pertencem ao turno atual.

**Verificação:** [ASSUMED] — Baseado no comportamento documentado do LangGraph StateGraph com reducer de mensagens. A prática é verificar que `event_id = threadId:tool_call_id` é único por chamada (EVT-04), o que resolve qualquer duplicata acidental.

### Pitfall 2: `ToolMessage.name` pode ser `undefined` em certos contextos

**O que dá errado:** Filtrar por `msg.name` sem verificar que é string resulta em `undefined` passando a verificação de whitelist se a whitelist tiver `undefined` como chave.

**Por que acontece:** `BaseMessageFields` define `name` como `string | undefined`. ToolMessages criados com `new ToolMessage({ content, tool_call_id })` sem `name` explícito terão `name = undefined`.

**Como evitar:** Guard explícito: `typeof msg.name === "string" && TOOL_EVENTS_WHITELIST.has(msg.name)`.

[VERIFIED: codebase — `base.d.ts` linha 46: `name: string | undefined` em `StoredMessageData`]

### Pitfall 3: RabbitMQ Publisher não inicializado quando `RABBITMQ_URL` ausente mas `TOOL_EVENTS_QUEUE` presente

**O que dá errado:** `EventPublisher` construído sem `RABBITMQ_URL` disponível — erro de runtime na primeira mensagem.

**Por que acontece:** `TOOL_EVENTS_QUEUE` indica intenção de usar RabbitMQ, mas `RABBITMQ_URL` pode não estar no ambiente de deploy.

**Como evitar:** Validar no construtor do `EventPublisher` (ou em `BrainRunner.init()`): se `TOOL_EVENTS_QUEUE` está presente, verificar `RABBITMQ_URL` e lançar `ConfigurationError` com mensagem clara.

[VERIFIED: codebase — `consumer.ts` linhas 58-64 usa mesmo padrão de validação de ENVs]

### Pitfall 4: `ToolMessage.content` pode não ser string

**O que dá errado:** O tipo de `ToolMessage.content` é `string | Array<ContentBlock>`. Fazer `msg.content.toUpperCase()` falha se for array.

**Por que acontece:** `@langchain/core@1.1.48` suporta content estruturado além de strings simples.

**Como evitar:** Coerção segura ao construir o evento: `typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)`.

[VERIFIED: codebase — `base.d.ts` define `MessageContent = string | Array<ContentBlock>`]

### Pitfall 5: Await acidental em `run()` bloqueia resposta ao lead

**O que dá errado:** `await this.eventPublisher?.publish(events)` no `run()` — o lead recebe a resposta APÓS a publicação do evento.

**Por que acontece:** Esquecimento do padrão fire-and-forget ao adicionar o bloco de publicação.

**Como evitar:** No `run()`, sempre: `this.eventPublisher?.publish(events).catch(...)` — sem `await`. O `await` fica **dentro** do método `publish()` nos loops internos.

[VERIFIED: CONTEXT.md D-08, EVT-01]

### Pitfall 6: Bun + `AbortSignal.timeout()` — verificar disponibilidade

**O que dá errado:** `AbortSignal.timeout()` pode não estar disponível em versões antigas do Bun.

**Por que acontece:** API foi adicionada no Node.js 17.3 / disponível no Bun 1.x.

**Como evitar:** Usar `AbortController` com `setTimeout` como fallback se necessário, ou confirmar que o Bun instalado suporta `AbortSignal.timeout`. [ASSUMED] — Bun 1.x é o runtime deste projeto; API provavelmente disponível, mas não verificado com `Bun.version`.

---

## Code Examples

### Exemplo Completo: EventPublisher

```typescript
// packages/core/src/events/event-publisher.ts
// [VERIFIED: padrões de rabbitmq-client do consumer.ts + ToolMessage type def + CONTEXT.md]

import { Connection } from "rabbitmq-client";
import { createLogger } from "@brain-pkg/observability";
import { ConfigurationError } from "@brain-pkg/shared";

export interface ToolEvent {
  event_id: string;
  action: string;
  lead: { id: string; nome: string | null; numero: string };
  result: string;
  timestamp: string;
}

export interface IEventPublisher {
  publish(events: ToolEvent[]): Promise<void>;
  close(): Promise<void>;
}

/** No-op publisher — quando nenhum ENV de Tool Events está configurado */
export class NoopEventPublisher implements IEventPublisher {
  async publish(_events: ToolEvent[]): Promise<void> {}
  async close(): Promise<void> {}
}

export class EventPublisher implements IEventPublisher {
  private readonly logger = createLogger();
  private readonly mode: "webhook" | "rabbitmq";
  private readonly webhookUrl?: string;
  private readonly queue?: string;
  private rabbit?: InstanceType<typeof Connection>;
  private pub?: ReturnType<InstanceType<typeof Connection>["createPublisher"]>;

  constructor() {
    const queue = process.env.TOOL_EVENTS_QUEUE?.trim();
    const webhookUrl = process.env.TOOL_EVENTS_URL?.trim();

    if (queue) {
      // D-06: RabbitMQ tem prioridade
      if (!process.env.RABBITMQ_URL) {
        throw new ConfigurationError(
          "TOOL_EVENTS_QUEUE requer RABBITMQ_URL configurado",
          { hasQueue: true, hasRabbitUrl: false }
        );
      }
      this.mode = "rabbitmq";
      this.queue = queue;
    } else if (webhookUrl) {
      this.mode = "webhook";
      this.webhookUrl = webhookUrl;
    } else {
      // Nunca deve ser instanciado sem ENV — BrainRunner.init() verifica antes
      throw new ConfigurationError("EventPublisher requer TOOL_EVENTS_QUEUE ou TOOL_EVENTS_URL", {});
    }
  }

  /** Inicializa conexão RabbitMQ (eager, em BrainRunner.init()) */
  async init(): Promise<void> {
    if (this.mode === "rabbitmq") {
      this.rabbit = new Connection(process.env.RABBITMQ_URL!);
      this.pub = this.rabbit.createPublisher({ confirm: true });
    }
  }

  async publish(events: ToolEvent[]): Promise<void> {
    for (const event of events) {
      if (this.mode === "webhook") {
        await this._publishWebhook(event);
      } else {
        await this._publishRabbitMQ(event);
      }
    }
  }

  private async _publishWebhook(event: ToolEvent): Promise<void> {
    try {
      await fetch(this.webhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      this.logger.warn({ err, eventId: event.event_id }, "Webhook event publish failed — ignoring");
    }
  }

  private async _publishRabbitMQ(event: ToolEvent): Promise<void> {
    if (!this.pub) {
      this.logger.warn({ eventId: event.event_id }, "RabbitMQ publisher not ready — ignoring");
      return;
    }
    try {
      await this.pub.send(this.queue!, event);
    } catch (err) {
      this.logger.warn({ err, eventId: event.event_id }, "RabbitMQ event publish failed — ignoring");
    }
  }

  async close(): Promise<void> {
    await this.pub?.close();
    await this.rabbit?.close();
  }
}
```

### Exemplo: Modificação em BrainRunner

```typescript
// packages/core/src/runner/runner.ts
// [VERIFIED: codebase runner.ts + CONTEXT.md D-10, D-11]

// Adicionar ao BrainRunnerOptions:
export interface BrainRunnerOptions {
  // ... existentes ...
  /** EventPublisher injetável para testes (D-11). Ausente = criado em init() a partir de ENVs. */
  eventPublisher?: IEventPublisher;
}

// Adicionar como campo privado:
private eventPublisher: IEventPublisher | null = null;

// Em init(), após _compileGraph():
const hasQueue = !!process.env.TOOL_EVENTS_QUEUE?.trim();
const hasUrl = !!process.env.TOOL_EVENTS_URL?.trim();
if (options.eventPublisher) {
  this.eventPublisher = options.eventPublisher;
} else if (hasQueue || hasUrl) {
  const publisher = new EventPublisher();
  await publisher.init();
  this.eventPublisher = publisher;
}

// Em run(), após invoke() e antes do Step 3:
const TOOL_EVENTS_WHITELIST = new Set(["qualify_lead", "pause_session", "finish_conversation"]);
const toolEvents: ToolEvent[] = [];
for (const msg of result.messages ?? []) {
  if (ToolMessage.isInstance(msg) && typeof msg.name === "string" && TOOL_EVENTS_WHITELIST.has(msg.name)) {
    toolEvents.push({
      event_id: `${threadId}:${msg.tool_call_id}`,
      action: msg.name,
      lead: { id: lead.uniqueId, nome: lead.nome ?? null, numero: lead.numero },
      result: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      timestamp: new Date().toISOString(),
    });
  }
}
if (toolEvents.length > 0) {
  this.eventPublisher?.publish(toolEvents).catch((err: unknown) => {
    this.logger.warn({ err }, "EventPublisher.publish failed — ignoring");
  });
}

// Em close():
await this.eventPublisher?.close();
this.eventPublisher = null;
```

### Exemplo: Teste Unitário do EventPublisher

```typescript
// packages/core/src/events/__tests__/unit/event-publisher.test.ts
// [VERIFIED: padrão de testes existentes em brain-runner.test.ts]

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { EventPublisher, NoopEventPublisher } from "../../event-publisher.js";

describe("EventPublisher — webhook mode", () => {
  test("publish() chama fetch com payload correto", async () => {
    process.env.TOOL_EVENTS_URL = "http://internal.example.com/events";
    delete process.env.TOOL_EVENTS_QUEUE;

    const fetchMock = mock(async () => new Response("ok", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const publisher = new EventPublisher();
    await publisher.publish([{
      event_id: "lead-123:call-456",
      action: "pause_session",
      lead: { id: "lead-123", nome: "João", numero: "5511999990001" },
      result: "Sessão pausada com sucesso",
      timestamp: "2026-06-23T00:00:00.000Z",
    }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    delete process.env.TOOL_EVENTS_URL;
  });

  test("publish() absorve erro de fetch silenciosamente", async () => {
    process.env.TOOL_EVENTS_URL = "http://unreachable/events";
    delete process.env.TOOL_EVENTS_QUEUE;
    globalThis.fetch = mock(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;

    const publisher = new EventPublisher();
    // Não deve lançar
    await expect(publisher.publish([{
      event_id: "x:y", action: "pause_session",
      lead: { id: "x", nome: null, numero: "123" },
      result: "ok", timestamp: "2026-06-23T00:00:00.000Z",
    }])).resolves.toBeUndefined();

    delete process.env.TOOL_EVENTS_URL;
  });
});

describe("NoopEventPublisher", () => {
  test("publish() é no-op e não lança", async () => {
    const noop = new NoopEventPublisher();
    await expect(noop.publish([])).resolves.toBeUndefined();
  });
});
```

---

## State of the Art

| Abordagem Antiga | Abordagem Atual | Impacto |
|-----------------|-----------------|---------|
| Callbacks LangGraph (`handleToolEnd`) | Pós-processamento em `result.messages` | Elimina dependência de API interna; funciona independente de MCP ou tools nativas |
| Novo pacote `@brain-pkg/events` | Novo diretório `events/` em `packages/core` | Menor overhead; EventPublisher só tem 1 consumidor (BrainRunner) |

---

## Assumptions Log

| # | Claim | Section | Risco se Errado |
|---|-------|---------|-----------------|
| A1 | `result.messages` de `compiledGraph.invoke()` contém apenas mensagens do turno atual, não histórico de turnos anteriores | Architecture Patterns — Pattern 2 | Baixo: `event_id = threadId:tool_call_id` é idempotente (EVT-04); duplicatas seriam desduplicadas pelo consumidor |
| A2 | `AbortSignal.timeout(5000)` está disponível no Bun 1.x instalado | Common Pitfalls — Pitfall 6 | Baixo: fallback é `AbortController` + `setTimeout` (5 linhas adicionais) |
| A3 | `ToolMessage.name` é o nome da tool (`"pause_session"` etc.) em `@langchain/core@1.1.48` | Architecture Patterns — Pattern 2 | Alto: se `name` não for o nome da tool, o filtro de whitelist nunca dispararia; verificar com teste no Wave 0 |

**A3 requer validação:** Confirmar que `ToolMessage.name` = nome da tool escrevendo um teste que inspira o estado real de `invoke()` com um `qualify_lead` real. O `brain.ts` do SDR (`brain-sdr`) cria `ToolMessage` explicitamente com `name: "respond"` — confirma que `name` é preenchido. O `ToolNode` interno do LangGraph também preenche `name` automaticamente.

---

## Open Questions

1. **Quando múltiplas tools são chamadas no mesmo turno**
   - O que sabemos: Um ReAct loop pode invocar `qualify_lead` e depois `pause_session` no mesmo turno
   - O que é incerto: Ordem de aparição em `result.messages` — provavelmente cronológica
   - Recomendação: Implementar `for...of` em `result.messages` em ordem, publicar todos os eventos. `event_id` diferente por `tool_call_id` garante deduplicação no consumidor (EVT-04)

2. **`ToolMessage.name` no contexto de `ToolNode` do LangGraph**
   - O que sabemos: `ToolNode` do LangGraph cria `ToolMessage` com `name` preenchido (verificado em `mcp-tool-error.test.ts` linha 24 — `name: "failing_mcp_tool"` aparece nas propriedades resultantes)
   - O que é incerto: Se `ToolNode` usa `tool.name` da definição da tool como `ToolMessage.name`
   - Recomendação: Wave 0 deve incluir um teste de integração que verifique `ToolMessage.name` no estado real

---

## Environment Availability

Dependências desta fase são inteiramente internas à stack existente.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `rabbitmq-client` | EventPublisher (RabbitMQ mode) | Sim | ^5.0.8 | — |
| `@langchain/core` (`ToolMessage`) | Filtro pós-invoke | Sim | ^1.1.48 | — |
| Bun built-in `fetch` | EventPublisher (webhook mode) | Sim | Bun 1.x | — |
| `RABBITMQ_URL` (ENV) | EventPublisher RabbitMQ mode | Condicional | — | N/A se TOOL_EVENTS_QUEUE ausente |

**Missing dependencies with no fallback:** Nenhuma. Toda infraestrutura está presente.

---

## Validation Architecture

`workflow.nyquist_validation` = true — seção obrigatória.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in) |
| Config file | Nenhum — `bun test src` em `package.json` do core |
| Quick run command | `bun test packages/core/src/events` |
| Full suite command | `bun test packages/core/src` |

### Phase Requirements → Test Map

| Req ID | Comportamento | Tipo de Teste | Comando Automatizado | Arquivo Existe? |
|--------|--------------|--------------|---------------------|----------------|
| EVT-01 (webhook) | `publish()` chama `fetch` fire-and-forget; `run()` não bloqueia | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | Não — Wave 0 |
| EVT-01 (rabbitmq) | `publish()` chama `pub.send()` fire-and-forget | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | Não — Wave 0 |
| EVT-01 (disabled) | Sem ENV = sem publicação, sistema funciona normalmente | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | Existe (modificar) |
| EVT-02 | Filtro de whitelist captura ToolMessages corretos | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | Não — Wave 0 |
| EVT-04 | `event_id = threadId:tool_call_id` idempotente | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | Não — Wave 0 |
| D-11 (injeção) | `BrainRunnerOptions.eventPublisher` override funciona em testes | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | Existe (adicionar casos) |

### Sampling Rate

- **Por commit de tarefa:** `bun test packages/core/src/events`
- **Por merge de wave:** `bun test packages/core/src`
- **Phase gate:** Suite completa verde antes do `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/events/event-publisher.ts` — implementação principal
- [ ] `packages/core/src/events/__tests__/unit/event-publisher.test.ts` — cobertura de EVT-01, EVT-02, EVT-04
- [ ] Atualizar `packages/core/src/index.ts` — exportar `IEventPublisher`, `ToolEvent`, `EventPublisher`

---

## Security Domain

`security_enforcement` não está explicitamente desabilitado — seção obrigatória.

### Applicable ASVS Categories

| ASVS Category | Aplica | Controle Padrão |
|---------------|--------|----------------|
| V2 Authentication | Não | — (endpoint interno, D-07) |
| V3 Session Management | Não | — |
| V4 Access Control | Não | — (ENV configurado por operador, não por lead) |
| V5 Input Validation | Sim | Whitelist hardcoded em `Set<string>` — dados externos (nomes de tools) validados antes de entrar no evento |
| V6 Cryptography | Não | — |

### Known Threat Patterns

| Pattern | STRIDE | Mitigação |
|---------|--------|-----------|
| ToolMessage.name com valor malicioso de LLM alucinado | Tampering | Whitelist hardcoded em `Set` — rejeita qualquer nome fora da lista; CONTEXT.md D-03 |
| Log de PII em evento de falha | Information Disclosure | `logger.warn` loga apenas `eventId` e `err` — nunca o payload completo (consistente com T-07-08 do consumer.ts) |
| SSRF via `TOOL_EVENTS_URL` | Elevation of Privilege | URL configurada pelo operador via ENV — sem acesso de lead ao valor; fora do escopo desta fase |
| `RABBITMQ_URL` logado em erro | Information Disclosure | Verificar presença com `!!process.env.RABBITMQ_URL`, nunca logar valor (mesma convenção do consumer.ts) |

---

## Sources

### Primary (HIGH confidence)

- Codebase `packages/core/src/runner/runner.ts` — estrutura exata do `BrainRunner`, lifecycle, campos disponíveis no escopo de `run()`
- Codebase `packages/transport/src/rabbitmq/consumer.ts` — padrão de `rabbitmq-client`: `Connection`, `createPublisher({ confirm: true })`, `pub.send(queue, body)`
- Codebase `packages/core/src/runner/__tests__/brain-runner.test.ts` — padrão de mocking e teste do BrainRunner para EVT tests
- `/root/Brain/node_modules/.pnpm/@langchain+core@1.1.48_.../dist/messages/tool.d.ts` — `ToolMessage`: campos `tool_call_id`, `name`, `content`, `status`; type guard `ToolMessage.isInstance()`
- `/root/Brain/node_modules/.pnpm/@langchain+core@1.1.48_.../dist/messages/base.d.ts` — `name: string | undefined` em `BaseMessageFields`
- Codebase `.planning/phases/20-tool-events/20-CONTEXT.md` — todas as decisões locked (D-01 a D-11)
- Codebase `packages/core/src/tools/pause-session.ts` e `finish-conversation.ts` — retornam strings como `ToolMessage.content`

### Secondary (MEDIUM confidence)

- Codebase `apps/brain-sdr/src/__tests__/unit/mcp-tool-error.test.ts` — confirma que `ToolNode` preenche `ToolMessage` com `tool_call_id` correto

### Tertiary (LOW confidence)

- Nenhuma. Todos os claims críticos foram verificados direto no codebase instalado.

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — sem instalações novas; tudo verificado no codebase
- Architecture: HIGH — padrões replicados de consumer.ts e runner.ts existentes
- Pitfalls: HIGH (Pitfalls 1-5) / MEDIUM (Pitfall 6 — AbortSignal.timeout no Bun não verificado)
- Validação: HIGH — framework bun test ativo, diretório `__tests__/unit/` e `__tests__/integration/` já estabelecidos

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stack estável; `@langchain/core` e `rabbitmq-client` sem breaking changes esperados)
