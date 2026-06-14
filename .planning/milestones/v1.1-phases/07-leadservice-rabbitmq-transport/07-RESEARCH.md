# Phase 7: LeadService + RabbitMQ Transport - Research

**Researched:** 2026-06-13
**Domain:** LeadService (Drizzle upsert, BrainRunner gate), RabbitMQ Consumer (rabbitmq-client v5)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**LeadService — Localização e Interface**
- D-01: LeadService em `packages/core/src/leads/lead-service.ts`
- D-02: `class LeadService` com `sql` injetado no construtor. Métodos: `upsertLead(numero, uniqueId, nome?): Promise<Lead>` e `getByNumero(numero): Promise<Lead | null>`
- D-03: Quem chama o upsert: `BrainRunner.run()` — não os transport handlers

**Gate ia_ativada**
- D-04: Gate verificado dentro de `BrainRunner.run()` imediatamente após o upsert
- D-05: Quando `lead.iaAtivada === false`: retorna `null` silenciosamente (sem chamada LLM)
- D-06: Fluxo: `upsertLead(numero, uniqueId, nome)` → verificar `iaAtivada` → se false: return null → continuar com LLM

**RabbitMQ Transport — Estrutura**
- D-07: Biblioteca: `rabbitmq-client@^5.0.8` — zero deps, Bun-compatible, auto-reconnect built-in
- D-08: `new RabbitMQTransport(runner)` implementa `ITransport`
- D-09: `factory.ts` atualizado com `case "rabbitmq": return new RabbitMQTransport(runner)`

**RabbitMQ — ENVs**
- D-10: `RABBITMQ_URL` — connection string
- D-11: `RABBITMQ_QUEUE` — fila de entrada
- D-12: `RABBITMQ_DLQ` — fila de saída para falhas permanentes
- D-13: `RABBITMQ_RETRY_DELAY_MS` — backoff entre retries (default: 1000)

**RabbitMQ — Provisioning**
- D-14: Transport NÃO declara filas nem exchanges — apenas conecta e consome
- D-15: `prefetch=1` (qos.prefetchCount=1)

**RabbitMQ — Retry e Falha Permanente**
- D-16: 3 tentativas por mensagem
- D-17: Backoff fixo de `RABBITMQ_RETRY_DELAY_MS` ms entre retries
- D-18: Contador de tentativas em memória: `Map<deliveryTag, count>`
- D-19: Após 3 falhas: publicar na `RABBITMQ_DLQ` via default exchange + ack a mensagem original
- D-20: Todas as exceções tratadas igualmente com `log.error`

**TRP-01**
- D-21: BrainEventSchema.safeParse já implementado em Phase 5; Phase 7 adiciona teste explícito cobrindo campo faltando

### Claude's Discretion
- Nome exato do arquivo (`lead-service.ts` ou `leads.ts`)
- Mensagem de log quando `ia_ativada=false` (debug level, pode ser omitida)
- Timeout de conexão do rabbitmq-client
- Tratamento de `RABBITMQ_DLQ` ausente no ENV (ConfigurationError no start() ou apenas log warning?)

### Deferred Ideas (OUT OF SCOPE)
- x-death header do RabbitMQ para tracking de retries persistente entre restarts — v1.2
- Timeout configurável no rabbitmq-client — default do cliente por ora
- Classificação de erros transientes vs permanentes para política de retry diferenciada — v1.2
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEAD-02 | Lead cadastrado automaticamente na primeira mensagem — upsert por `numero`, `unique_id` gerado pela aplicação e nunca sobrescrito | Drizzle `onConflictDoUpdate` pattern confirmado via codebase; `leads` table com `uniqueIndex` em `numero` existe em Phase 6 |
| LEAD-03 | Mensagens de lead com `ia_ativada=false` são ignoradas silenciosamente antes de qualquer processamento | Gate em `BrainRunner.run()` imediatamente após upsert; retorna `null` sem chamar LLM |
| TRP-01 | Webhook valida campos obrigatórios e rejeita com erro se faltar algum | BrainEventSchema.safeParse já implementado; Phase 7 adiciona teste explícito de campo faltando |
| TRP-03 | Transport RabbitMQ via rabbitmq-client consome fila com campos `{Name, Message, Numero, IDLead}` | rabbitmq-client v5.0.8 API verificada via GitHub; `createConsumer` com body parse via BrainEventSchema |
| TRP-04 | Nome da fila RabbitMQ configurável via ENV | ENVs D-10 a D-13 definidas; pattern de ConfigurationError estabelecido no codebase |
| TRP-05 | RabbitMQ opera com manual ack/nack, Dead Letter Queue, prefetch=1 e reconexão automática | ConsumerStatus enum confirmado (ACK=0, REQUEUE=1, DROP=2); auto-reconnect built-in no rabbitmq-client; DLQ via Publisher explícito (não DLX broker) |
| TRP-06 | Seleção de transport via ENV `TRANSPORT=webhook\|rabbitmq` | `factory.ts` já tem switch; adicionar `case "rabbitmq"` |
</phase_requirements>

---

## Summary

Esta fase tem dois entregáveis independentes: **LeadService** e **RabbitMQTransport**. Ambos seguem padrões já estabelecidos no codebase e não requerem nova arquitetura — apenas extensão de padrões existentes.

**LeadService** é simples: classe com `sql` injetado (padrão MemoryManager/BrainRunner), Drizzle upsert em `leads.numero`, retorno de `Lead`. O gate `ia_ativada` entra em `BrainRunner.run()` após o upsert — ponto único de controle que funciona para qualquer transport. A assinatura de `BrainRunner.run()` muda de `Promise<BrainRunResult>` para `Promise<BrainRunResult | null>`, o que requer atualização de todos os callers (WebhookTransport handler, testes).

**RabbitMQTransport** usa `rabbitmq-client@5.0.8` que já tem auto-reconnect built-in. A API principal é `connection.createConsumer()` para consumo e `connection.createPublisher()` para publicar na DLQ. O controle manual de ack é feito via `ConsumerStatus` enum retornado pelo handler callback — não via `basicAck/basicNack` direto. O padrão de retry com contador em memória (`Map<deliveryTag, count>`) substitui mecanismo DLX do broker por ser mais simples e sem dependência de configuração do servidor RabbitMQ.

**Recomendação primária:** Implementar na ordem LeadService → Gate BrainRunner → RabbitMQTransport → testes, aproveitando os padrões já estabelecidos no codebase sem introduzir novos conceitos.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rabbitmq-client` | 5.0.8 | AMQP 0-9-1 client para RabbitMQ | Zero deps, Bun-compatible, auto-reconnect built-in, decision D-07 |
| `drizzle-orm` | 0.45.2 (já instalado) | ORM para Drizzle upsert do lead | Já no stack; `onConflictDoUpdate` para upsert atômico |
| `zod` | ^3.23.8 (já instalado) | Validação do payload RabbitMQ | Reusa BrainEventSchema existente |
| `@brain-pkg/shared` | workspace (já instalado) | ConfigurationError para fail-fast startup | Padrão estabelecido no codebase |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` via `@brain-pkg/observability` | ^9.x (já instalado) | Logs de retry, DLQ, gate ia_ativada | Todos os logs de processamento RabbitMQ |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `rabbitmq-client` | `amqplib-bun` | amqplib-bun tem bug de "invalid frame" para mensagens grandes (Bun issue #5627) — descartado |
| DLX broker-side | Publisher explícito para DLQ | DLX broker-side requer configuração do servidor RabbitMQ (x-dead-letter-exchange); Publisher explícito é autocontido |
| x-death header counter | `Map<deliveryTag, count>` em memória | x-death requer DLX broker-side; Map em memória é suficiente para v1.1 |

**Instalação:**
```bash
# Adicionar ao packages/transport/package.json
bun add rabbitmq-client@^5.0.8
```

**Verificação de versão:** [VERIFIED: npm registry] `rabbitmq-client@5.0.8` é a versão latest (publicada há 6 meses). Compatível com RabbitMQ 4.1.x+ (requer >= 5.0.3).

---

## Architecture Patterns

### Estrutura de Arquivos a Criar/Modificar

```
packages/core/src/
├── leads/
│   └── lead-service.ts          # NOVO — LeadService class
│   └── __tests__/
│       └── lead-service.test.ts # NOVO — unit tests (mock sql)
├── runner/
│   └── runner.ts                # MODIFICAR — upsertLead + gate ia_ativada em run()
│   └── __tests__/
│       └── brain-runner.test.ts # MODIFICAR — testar gate ia_ativada + run() → null

packages/transport/src/
├── rabbitmq/
│   └── consumer.ts              # NOVO — RabbitMQTransport class
├── webhook/
│   └── handler.test.ts          # MODIFICAR — adicionar teste TRP-01 campo faltando
├── factory.ts                   # MODIFICAR — case "rabbitmq"
├── factory.test.ts              # MODIFICAR — testar case "rabbitmq"
└── index.ts                     # MODIFICAR — export RabbitMQTransport

apps/brain-echo/
└── .env.example                 # MODIFICAR — adicionar RABBITMQ_* vars
```

**Nota sobre convenção de testes:** CLAUDE.md exige `__tests__/` para novos arquivos. Pacotes `transport`, `database`, `memory` têm arquivos `.test.ts` inline (legado). Para Phase 7: novos testes em `packages/core` usam `__tests__/` (padrão já estabelecido lá); novos testes em `packages/transport` ficam inline na subpasta `rabbitmq/` para consistência com os testes existentes do pacote.

### Pattern 1: LeadService — Upsert por Numero

**O que é:** Upsert atômico via Drizzle `onConflictDoUpdate` — insere se não existe, atualiza `nome` e `updatedAt` se já existe. `unique_id` nunca é sobrescrito no update (LEAD-02: "gerado pela aplicação e nunca sobrescrito").

**Quando usar:** `BrainRunner.run()` chama antes de qualquer processamento LLM.

```typescript
// Source: padrão confirmado via packages/memory/src/long-term.ts + tables.ts schema
import { drizzle } from "drizzle-orm/postgres-js";
import { leads } from "@brain-pkg/database";
import type { Sql } from "postgres";

export type Lead = typeof leads.$inferSelect;

export class LeadService {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(sql: Sql) {
    this.db = drizzle(sql);
  }

  async upsertLead(numero: string, uniqueId: string, nome?: string): Promise<Lead> {
    const rows = await this.db
      .insert(leads)
      .values({ numero, uniqueId, nome: nome ?? null })
      .onConflictDoUpdate({
        target: leads.numero,        // UNIQUE index em leads.numero (Phase 6)
        set: {
          nome: nome ?? null,         // atualiza nome se vier novo
          updatedAt: new Date(),
          // uniqueId NÃO está no set — nunca sobrescrito (LEAD-02)
        },
      })
      .returning();
    return rows[0];
  }

  async getByNumero(numero: string): Promise<Lead | null> {
    const rows = await this.db
      .select()
      .from(leads)
      .where(eq(leads.numero, numero))
      .limit(1);
    return rows[0] ?? null;
  }
}
```

### Pattern 2: Gate ia_ativada em BrainRunner.run()

**O que é:** Após upsert do lead, verificar `iaAtivada`. Se `false`, retornar `null` sem chamar LLM.

**Impacto na assinatura:** `BrainRunner.run()` passa de `Promise<BrainRunResult>` para `Promise<BrainRunResult | null>`. O WebhookTransport handler precisa tratar `null` — retornar 200 com `{ status: "ignored" }` ou similar.

```typescript
// Source: padrão derivado de runner.ts existente + CONTEXT.md D-04 a D-06
async run(event: BrainEvent): Promise<BrainRunResult | null> {
  if (!this.compiledGraph || !this.memoryManager) {
    throw new ConfigurationError("BrainRunner.init() must be called before run()");
  }

  // D-06: Fluxo: upsert → gate → LLM
  const lead = await this.leadService.upsertLead(
    event.Numero,
    event.IDLead,
    event.Name
  );

  // D-04/D-05: Gate — retorna null silenciosamente
  if (!lead.iaAtivada) {
    this.logger.debug({ numero: event.Numero }, "ia_ativada=false, ignoring message");
    return null;
  }

  // ... restante do método (LLM, graph, etc.)
}
```

**Onde instanciar LeadService:** Dentro de `_compileGraph()` ou no construtor, após ter `sql` disponível. O padrão do construtor já recebe `sql`.

### Pattern 3: RabbitMQTransport — Consumer com Retry Manual

**O que é:** Consumer `rabbitmq-client` com `prefetch=1`, contador de retries em memória, publicação explícita na DLQ após 3 falhas.

**API confirmada via GitHub source:** `ConsumerStatus.ACK=0`, `ConsumerStatus.REQUEUE=1`, `ConsumerStatus.DROP=2`. Retornar `ConsumerStatus.DROP` do handler callback = `BasicNack(requeue=false)`.

```typescript
// Source: [VERIFIED: github.com/cody-greene/node-rabbitmq-client src/Consumer.ts]
import { Connection, ConsumerStatus } from "rabbitmq-client";
import { BrainEventSchema } from "../webhook/events.js";
import { ConfigurationError } from "@brain-pkg/shared";
import { createLogger } from "@brain-pkg/observability";
import type { ITransport } from "../interface.js";
import type { IBrainRunnerLike } from "../webhook/handler.js";

const MAX_ATTEMPTS = 3;

export class RabbitMQTransport implements ITransport {
  private rabbit?: Connection;
  private sub?: ReturnType<Connection["createConsumer"]>;
  private pub?: ReturnType<Connection["createPublisher"]>;
  private readonly retryMap = new Map<bigint, number>(); // deliveryTag → attempt count
  private readonly logger = createLogger();

  constructor(private readonly runner: IBrainRunnerLike) {}

  async start(): Promise<void> {
    const url = process.env.RABBITMQ_URL;
    const queue = process.env.RABBITMQ_QUEUE;
    const dlq = process.env.RABBITMQ_DLQ;
    const retryDelayMs = parseInt(process.env.RABBITMQ_RETRY_DELAY_MS ?? "1000", 10);

    if (!url || !queue || !dlq) {
      throw new ConfigurationError(
        "RABBITMQ_URL, RABBITMQ_QUEUE e RABBITMQ_DLQ são obrigatórios",
        { url: !!url, queue: !!queue, dlq: !!dlq }
      );
    }

    this.rabbit = new Connection(url);
    this.rabbit.on("error", (err) => this.logger.error({ err }, "RabbitMQ connection error"));
    this.rabbit.on("connection", () => this.logger.info({}, "RabbitMQ connected"));

    // Publisher para DLQ — lazy (canal criado na primeira publicação)
    this.pub = this.rabbit.createPublisher({ confirm: true });

    this.sub = this.rabbit.createConsumer(
      {
        queue,
        // D-15: prefetch=1
        qos: { prefetchCount: 1 },
        // requeue: false — não requeue automático; controle manual via retryMap
        requeue: false,
      },
      async (msg) => {
        const deliveryTag = msg.deliveryTag;
        const attempt = (this.retryMap.get(deliveryTag) ?? 0) + 1;
        this.retryMap.set(deliveryTag, attempt);

        const parsed = BrainEventSchema.safeParse(msg.body);
        if (!parsed.success) {
          // Schema inválido — não tem sentido tentar novamente
          this.logger.error({ body: msg.body, deliveryTag }, "Invalid BrainEvent from RabbitMQ");
          this.retryMap.delete(deliveryTag);
          await this.pub!.send(dlq, msg.body); // DLQ explícita
          return ConsumerStatus.ACK; // ack a mensagem original (já está na DLQ)
        }

        try {
          await this.runner.run(parsed.data);
          this.retryMap.delete(deliveryTag);
          return ConsumerStatus.ACK;
        } catch (err) {
          this.logger.error({ err, deliveryTag, attempt }, "message processing failed");

          if (attempt >= MAX_ATTEMPTS) {
            // D-19: Publicar na DLQ + ack a mensagem original
            this.retryMap.delete(deliveryTag);
            await this.pub!.send(dlq, msg.body);
            return ConsumerStatus.ACK;
          }

          // D-17: Backoff fixo entre tentativas
          // Nota: REQUEUE coloca de volta na fila mas deliveryTag muda no re-deliver
          // Usar sleep + REQUEUE, ou manter map com conteúdo ao invés do tag
          await Bun.sleep(retryDelayMs);
          return ConsumerStatus.REQUEUE; // requeue para retry (deliveryTag muda no próximo deliver)
        }
      }
    );

    this.sub.on("error", (err) => this.logger.error({ err }, "RabbitMQ consumer error"));
  }

  async stop(): Promise<void> {
    await this.sub?.close();
    await this.pub?.close();
    await this.rabbit?.close();
    this.retryMap.clear();
  }
}
```

### Anti-Patterns a Evitar

- **Não usar `basicAck`/`basicNack` direto via `channel.acquire()`:** A API de alto nível (`createConsumer`) gerencia o canal internamente com auto-reconnect. Usar o channel bruto perde essa garantia.
- **Não declarar filas no Transport (D-14):** Filas são pré-configuradas por ops. `queueOptions` não deve ser passado no `createConsumer` — isso causaria erro se a fila não existir com os parâmetros exatos.
- **Não usar `requeue: true` global no Consumer:** Com `requeue: true`, qualquer exceção do handler causa requeue automático sem controle de tentativas — loop infinito garantido.
- **Não exportar estado interno do LeadService:** `run()` retorna `BrainRunResult | null` — o `Lead` object não vaza para o transport layer.
- **Não colocar `upsertLead` no transport handler:** D-03 explícito — qualquer transport que chamar `runner.run()` obtém o comportamento automaticamente.

---

## Don't Hand-Roll

| Problema | Não Construir | Usar em Vez | Por quê |
|----------|---------------|-------------|---------|
| Auto-reconnect RabbitMQ | Lógica de retry de conexão | `rabbitmq-client` Connection built-in | Gerencia heartbeat, reconexão exponencial, re-subscribe automaticamente |
| Upsert atômico | INSERT + SELECT + UPDATE em 3 queries | `drizzle.insert().onConflictDoUpdate()` | Race condition em 3 queries separadas sob alta concorrência |
| Validação do payload RabbitMQ | Verificação manual de campos | `BrainEventSchema.safeParse(msg.body)` | Schema já definido, reutilizado do webhook |
| Consumer ack/nack management | `ch.basicAck()` manual | `ConsumerStatus` enum retornado do callback | `createConsumer` gerencia o channel; ack manual via channel pode conflitar com reconnect |

---

## Pitfall Crítico: deliveryTag muda no REQUEUE

### O que acontece de errado

`deliveryTag` é um `bigint` específico do **canal AMQP atual**. Quando o consumer faz `REQUEUE` (BasicNack requeue=true), a mensagem volta para a fila com um **novo deliveryTag** quando re-entregue. A `Map<deliveryTag, count>` perde o rastreio e o contador recomeça do zero — loop de retries infinito.

### Por que acontece

AMQP 0-9-1: delivery tags são válidos apenas no contexto do canal onde foram recebidos. Re-delivered messages têm a flag `redelivered=true` e um novo `deliveryTag`.

### Como evitar

**Opção A (mais simples — recomendada para v1.1):** Usar `msg.redelivered` + contar por conteúdo ao invés de `deliveryTag`:

```typescript
// Map por hash do conteúdo ou por campo único (ex: IDLead + Numero)
const msgKey = `${parsed.data.IDLead}:${parsed.data.Numero}`;
const attempt = (this.retryMap.get(msgKey) ?? 0) + 1;
```

**Opção B:** Não usar REQUEUE — simplesmente aguardar (`Bun.sleep`) e depois retornar `ACK` sem REQUEUE, mas isso descarta a mensagem se o sleep for interrompido por crash. Não recomendado.

**Opção C (plano D-18 original):** Usar `deliveryTag` mas aceitar que após reconnect o counter reseta (comportamento aceitável para v1.1 — limite de 3 tentativas por "sessão de conexão").

**Decisão do planner:** Escolher entre Opção A ou C com base no requisito TRP-05 ("reconexão automática"). A Opção A é mais correta mas muda levemente o D-18. A Opção C preserva o D-18 exato mas tem o comportamento documentado de "counter reseta após reconnect". Ambas são válidas para v1.1 — o planner deve fixar a escolha.

---

## Common Pitfalls

### Pitfall 1: deliveryTag muda após REQUEUE (ver seção dedicada acima)

**O que dá errado:** Counter de retries não funciona com deliveryTag como chave.
**Como evitar:** Usar chave de conteúdo (`IDLead:Numero`) ou aceitar reset após reconnect.
**Sinal de alerta:** Mensagens entrando em loop infinito de retry.

### Pitfall 2: queueOptions no createConsumer declara fila silenciosamente

**O que dá errado:** Se `queueOptions: { durable: true }` for passado mas a fila existente tem `durable: false`, o broker retorna erro de canal e o consumer fecha.
**Por que acontece:** `createConsumer` com `queueOptions` chama `queueDeclare` com esses params. Se divergir da fila existente, AMQP erro 406 (PRECONDITION_FAILED).
**Como evitar:** D-14 já está correto — não passar `queueOptions` no `createConsumer`. A fila deve ser pré-configurada por ops.

### Pitfall 3: run() retornando null quebra callers que não tratam null

**O que dá errado:** `WebhookTransport` faz `return c.json({ status: "ok", reply: result.reply })` mas `result` é `null` — TypeError em produção.
**Por que acontece:** Mudança na assinatura de `BrainRunner.run()` para `Promise<BrainRunResult | null>`.
**Como evitar:** Atualizar `handler.ts` e todos os testes que chamam `runner.run()`. O planner deve incluir task de atualização do WebhookTransport handler.

### Pitfall 4: LeadService instanciado antes do sql estar pronto

**O que dá errado:** Se LeadService for instanciado no construtor de BrainRunner e `drizzle(sql)` for chamado antes de `init()`, pode haver race condition em hot-reload.
**Como evitar:** Instanciar LeadService dentro de `init()` ou em `_compileGraph()`, onde `sql` já está validado. Alternativa: instanciar no construtor (sql é sempre passado no construtor do BrainRunner).

### Pitfall 5: Publisher DLQ sem confirm=true pode perder mensagens

**O que dá errado:** Se `createPublisher({ confirm: false })` (default), a publicação na DLQ não aguarda confirmação do broker. Se o broker estiver sobrecarregado, a mensagem pode ser perdida silenciosamente.
**Como evitar:** `confirm: true` no Publisher da DLQ — a mensagem foi processada 3 vezes, é valiosa para debug.

### Pitfall 6: Bun.sleep no handler consumer bloqueia o prefetch slot

**O que dá errado:** Com `prefetch=1`, durante o `Bun.sleep(retryDelayMs)` dentro do handler nenhuma outra mensagem é processada. Em caso de muitas falhas consecutivas, o consumer fica travado.
**Por que acontece:** Esperado com `prefetch=1` e retry síncrono.
**Como evitar:** É o comportamento desejado para v1.1 (backpressure natural). Apenas documentar.

---

## Code Examples

### Drizzle upsert com onConflictDoUpdate (padrão confirmado no codebase)

```typescript
// Source: [VERIFIED: packages/memory/src/long-term.ts — padrão onConflictDoUpdate]
// Source: [VERIFIED: packages/database/src/schema/tables.ts — leads table schema]
await db
  .insert(leads)
  .values({ numero, uniqueId, nome: nome ?? null })
  .onConflictDoUpdate({
    target: leads.numero,       // uniqueIndex em leads.numero
    set: {
      nome: nome ?? null,
      updatedAt: new Date(),
      // uniqueId ausente do set — nunca sobrescrito (LEAD-02)
    },
  })
  .returning();
```

### rabbitmq-client Connection + Consumer básico

```typescript
// Source: [VERIFIED: github.com/cody-greene/node-rabbitmq-client README + src/Consumer.ts]
import { Connection, ConsumerStatus } from "rabbitmq-client";

const rabbit = new Connection("amqp://guest:guest@localhost:5672");
rabbit.on("error", (err) => console.error("connection error", err));
rabbit.on("connection", () => console.log("connected"));

const sub = rabbit.createConsumer(
  { queue: "brain-events", qos: { prefetchCount: 1 }, requeue: false },
  async (msg) => {
    // Return ConsumerStatus to control ack behavior:
    // ACK = 0 (default, auto-ack on return)
    // REQUEUE = 1 (BasicNack requeue=true)
    // DROP = 2 (BasicNack requeue=false)
    console.log("received", msg.body);
    return ConsumerStatus.ACK;
  }
);

sub.on("error", (err) => console.error("consumer error", err));

// Shutdown
await sub.close();
await rabbit.close();
```

### rabbitmq-client Publisher para DLQ

```typescript
// Source: [VERIFIED: github.com/cody-greene/node-rabbitmq-client src/Connection.ts]
const pub = rabbit.createPublisher({ confirm: true });

// Publicar diretamente em uma fila via default exchange
await pub.send("brain-dlq", originalMessageBody);

await pub.close();
```

### factory.ts com case "rabbitmq"

```typescript
// Source: [VERIFIED: packages/transport/src/factory.ts — padrão existente]
import { RabbitMQTransport } from "./rabbitmq/consumer.js";

case "rabbitmq":
  return new RabbitMQTransport(runner);
```

### Gate ia_ativada em BrainRunner.run()

```typescript
// Source: [VERIFIED: packages/core/src/runner/runner.ts — estrutura existente]
// D-06: Fluxo confirmado
async run(event: BrainEvent): Promise<BrainRunResult | null> {
  // ... guard compiledGraph

  const lead = await this.leadService.upsertLead(
    event.Numero, event.IDLead, event.Name
  );

  if (!lead.iaAtivada) {
    this.logger.debug({ numero: event.Numero }, "ia_ativada=false — ignoring");
    return null;
  }

  // thread_id ainda usa event.Numero em Phase 7
  // Phase 8 vai substituir por lead.uniqueId
  const threadId = event.Numero;
  // ... restante
}
```

---

## Runtime State Inventory

> Esta fase não é de rename/refactor — não se aplica. Porém, nota relevante:

A tabela `leads` existe no banco `brain_test` e no banco de produção após Phase 6. A migration que criou a tabela já foi aplicada. O LeadService vai **inserir novos registros** na tabela existente — não há migração de dados necessária nesta fase.

**Nada encontrado nas 5 categorias:** Nenhum estado runtime precisa ser modificado antes desta fase. Phase 7 apenas adiciona novos registros à tabela `leads` existente.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | LeadService upsert, BrainRunner | ✓ | pg14 (pgvector/pgvector:pg14) | — |
| RabbitMQ | RabbitMQTransport consumer/publisher | ✓ | management image (rodando há 2 dias) | — |
| Bun | Runtime, testes | ✓ | 1.3.2 | — |
| Docker | Infraestrutura local | ✓ | 29.4.1 | — |
| `rabbitmq-client` npm | RabbitMQTransport | ✗ (não instalado) | 5.0.8 disponível | Instalar via `bun add` |

**Missing dependencies with no fallback:**
- `rabbitmq-client@^5.0.8` — não instalado em `packages/transport`. Wave 0 deve instalar.

**Missing dependencies with fallback:**
- Nenhum.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, Bun 1.3.2) |
| Config file | Nenhum — `bun test` auto-descobre `*.test.ts` |
| Quick run command | `cd packages/core && bun test` / `cd packages/transport && bun test` |
| Full suite command | `bun run test` (turbo — todos os pacotes) |

### Phase Requirements → Test Map

| Req ID | Comportamento | Tipo | Comando Automatizado | Arquivo Existe? |
|--------|---------------|------|----------------------|----------------|
| LEAD-02 | upsertLead cria lead novo; segunda chamada com mesmo numero não duplica | unit | `cd packages/core && bun test src/leads` | ❌ Wave 0 |
| LEAD-02 | upsertLead não sobrescreve uniqueId no update | unit | `cd packages/core && bun test src/leads` | ❌ Wave 0 |
| LEAD-03 | BrainRunner.run() retorna null quando ia_ativada=false | unit | `cd packages/core && bun test src/runner` | ❌ Wave 0 (modificar existente) |
| LEAD-03 | BrainRunner.run() não chama LLM quando ia_ativada=false | unit | `cd packages/core && bun test src/runner` | ❌ Wave 0 (modificar existente) |
| TRP-01 | POST /webhook sem IDLead retorna 400 | unit | `cd packages/transport && bun test src/webhook/handler.test.ts` | ❌ Wave 0 (modificar existente) |
| TRP-03 | RabbitMQTransport processa mensagem válida e chama runner.run() | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ Wave 0 |
| TRP-04 | RabbitMQTransport.start() lança ConfigurationError se RABBITMQ_URL ausente | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ Wave 0 |
| TRP-05 | Após 3 falhas, mensagem é publicada na DLQ e ACK enviado | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ Wave 0 |
| TRP-05 | Após 3 falhas, runner.run() NÃO é chamada uma 4ª vez | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ Wave 0 |
| TRP-06 | createTransport("rabbitmq") retorna RabbitMQTransport | unit | `cd packages/transport && bun test src/factory.test.ts` | ❌ Wave 0 (modificar existente) |

### Sampling Rate
- **Por task commit:** `cd packages/<pacote> && bun test`
- **Por wave merge:** `bun run test` (suite completa turbo)
- **Phase gate:** Suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/leads/__tests__/lead-service.test.ts` — cobre LEAD-02 com mock de sql/drizzle
- [ ] `packages/core/src/runner/__tests__/brain-runner.test.ts` — adicionar testes LEAD-03 (gate ia_ativada)
- [ ] `packages/transport/src/rabbitmq/consumer.test.ts` — cobre TRP-03, TRP-04, TRP-05 com mock de rabbitmq-client
- [ ] `packages/transport/src/webhook/handler.test.ts` — adicionar teste TRP-01 campo faltando (ex: sem IDLead explícito com expect 400)
- [ ] `packages/transport/src/factory.test.ts` — adicionar case "rabbitmq" test

**Nota TRP-01:** O handler.test.ts já tem teste "POST with missing required BrainEvent field (only Name) returns 400" que cobre campos faltando. O planner deve verificar se o teste existente já satisfaz TRP-01 formalmente ou se precisa de um teste específico sem `IDLead`.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | não | N/A — RabbitMQ usa credenciais na connection string |
| V3 Session Management | não | N/A |
| V4 Access Control | não | N/A |
| V5 Input Validation | **sim** | `BrainEventSchema.safeParse(msg.body)` antes de qualquer processamento |
| V6 Cryptography | não | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Payload malformado via RabbitMQ | Tampering | BrainEventSchema.safeParse — igual ao webhook |
| Loop infinito de retry (DoS interno) | DoS | MAX_ATTEMPTS=3 + DLQ explícita |
| RABBITMQ_URL com credenciais em log | Information Disclosure | Não logar env vars sensíveis — apenas boolean (url: !!url) no ConfigurationError context |
| Lead de numero inexistente com ia_ativada manipulation | Elevation of Privilege | iaAtivada vem do banco (upsert), nunca do payload |

---

## Project Constraints (from CLAUDE.md)

Diretivas obrigatórias que o planner deve verificar:

- **Runtime:** Bun 1.x — todos os testes rodam via `bun test`
- **HTTP Framework:** Hono — não relevante para LeadService/RabbitMQ, mas WebhookTransport usa
- **ORM:** Drizzle com `postgres.js` driver — LeadService usa `drizzle(sql)` onde `sql: Sql` é `postgres.js` instance
- **Test location:** Novos arquivos de teste em `__tests__/` dentro do pacote (exceto `packages/transport` onde o padrão estabelecido é inline — ver nota acima)
- **Test suffix:** `.test.ts`
- **Manual test files:** em `manual/` (gitignored) — não no repo
- **Docs:** em `docs/` — não criar `.md` de documentação fora de `.planning/`
- **Commits:** Conventional Commits com emoji (ex: `✨ feat(transport): add RabbitMQTransport`)
- **Não incluir** `Co-Authored-By: Claude` nos commits

---

## Open Questions

1. **deliveryTag vs msgKey para retry counter**
   - O que sabemos: AMQP deliveryTag muda após REQUEUE; D-18 especifica `Map<deliveryTag, count>`
   - O que está incerto: Se o planner deve manter D-18 exato (com comportamento de reset após reconnect) ou adotar `IDLead:Numero` como chave (mais correto mas diverge de D-18)
   - Recomendação: Usar `IDLead:Numero` como chave — mais robusto e o espírito de D-18 é "contar tentativas por mensagem". Se o usuário quiser D-18 literal, é aceitável com a ressalva documentada.

2. **RABBITMQ_DLQ ausente no ENV: ConfigurationError ou log warning?**
   - Claude's Discretion (D-69 do CONTEXT.md)
   - Recomendação: `ConfigurationError` em `start()` — fail-fast é o padrão do projeto (WebhookTransport, BrainRunner). DLQ ausente em produção seria silenciosamente perigoso.

3. **Onde instanciar LeadService no BrainRunner?**
   - O que sabemos: `sql` é passado no construtor de BrainRunner; LeadService precisa de `sql`
   - Recomendação: Instanciar no construtor de BrainRunner (`this.leadService = new LeadService(this.sql)`) — simples, sem lazy initialization.

4. **WebhookTransport handler: o que retornar quando run() retorna null?**
   - O que sabemos: Atualmente retorna `{ status: "ok", reply: result.reply }` — vai quebrar com `result === null`
   - Recomendação: Retornar `{ status: "ignored" }` com HTTP 200 — não expõe razão interna (ASVS V5).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `amqplib` / `amqplib-bun` | `rabbitmq-client@^5.0.8` | Decisão Phase 7 (STATE.md) | Zero deps, auto-reconnect built-in, Bun-compatible |
| DLX configurado no broker | Publisher explícito para DLQ | Decisão D-19 | Sem dependência de configuração do servidor RabbitMQ |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `drizzle(sql).insert(leads).values(...).returning()` retorna `Lead[]` com `rows[0]` sendo o lead inserido/atualizado | Code Examples | Se Drizzle `.returning()` retornar array vazio em edge cases (ex: ON CONFLICT sem set), `rows[0]` seria undefined — adicionar guard |
| A2 | `msg.body` em rabbitmq-client é o payload desserializado como objeto JS (não Buffer/string) | Code Examples | Se for Buffer/string, precisaria de `JSON.parse(msg.body)` antes do BrainEventSchema.safeParse |
| A3 | `Bun.sleep(ms)` funciona dentro de handler async do rabbitmq-client sem efeitos colaterais | Pitfalls / Code Examples | Se rabbitmq-client usa Worker threads internamente, o Bun.sleep pode não bloquear corretamente |

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: github.com/cody-greene/node-rabbitmq-client src/Consumer.ts] — ConsumerStatus enum (ACK=0, REQUEUE=1, DROP=2), ConsumerHandler signature, requeue option
- [VERIFIED: github.com/cody-greene/node-rabbitmq-client README.md] — Connection API, createConsumer, createPublisher, shutdown pattern
- [VERIFIED: github.com/cody-greene/node-rabbitmq-client src/Connection.ts] — createPublisher API, PublisherProps
- [VERIFIED: npm registry] — rabbitmq-client@5.0.8 latest, zero deps, MIT, published 6 months ago
- [VERIFIED: packages/database/src/schema/tables.ts] — leads table schema (uniqueId, numero UNIQUE, iaAtivada DEFAULT true)
- [VERIFIED: packages/memory/src/long-term.ts] — Drizzle onConflictDoUpdate pattern
- [VERIFIED: packages/core/src/runner/runner.ts] — BrainRunner structure, constructor pattern, run() signature
- [VERIFIED: packages/transport/src/webhook/handler.ts] — WebhookTransport pattern (template para RabbitMQTransport)
- [VERIFIED: packages/transport/src/factory.ts] — switch TRANSPORT ENV pattern
- [VERIFIED: packages/transport/src/webhook/events.ts] — BrainEventSchema definition

### Secondary (MEDIUM confidence)
- [VERIFIED: docker ps output] — RabbitMQ management image rodando localmente (porta 5672)
- [VERIFIED: packages/transport/src/webhook/handler.test.ts] — padrão de mock do runner para testes de transport

### Tertiary (LOW confidence)
- Nenhum — todos os claims críticos foram verificados via codebase ou GitHub source.

---

## Metadata

**Confidence breakdown:**
- LeadService: HIGH — schema confirmado, pattern Drizzle confirmado, localização decidida
- RabbitMQTransport: HIGH — API rabbitmq-client verificada via source GitHub, padrão de factory confirmado
- Retry counter (deliveryTag pitfall): MEDIUM — comportamento AMQP documentado, mas não testado com rabbitmq-client especificamente
- Testes: HIGH — padrão bun test + mock.module estabelecido no codebase

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (rabbitmq-client v5 é estável; Drizzle 0.45.x pinado)
