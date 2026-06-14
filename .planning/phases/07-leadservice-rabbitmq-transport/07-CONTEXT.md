# Phase 7: LeadService + RabbitMQ Transport - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 entrega dois entregáveis independentes:

1. **LeadService** — cadastro automático de leads na primeira mensagem + gate `ia_ativada` para descartar silenciosamente mensagens de leads inativos (LEAD-02, LEAD-03)
2. **RabbitMQ Transport** — consumer com ack manual, retry com backoff, publicação na DLQ após falha permanente e reconexão automática (TRP-03, TRP-04, TRP-05, TRP-06)
3. **TRP-01** (validação de campos obrigatórios no webhook via Zod) — já implementado em Phase 5 via `BrainEventSchema.safeParse`; Phase 7 formaliza com cobertura de teste explícita.

Esta fase não implementa histórico de conversa vinculado ao lead (Phase 8) nem o Brain SDR (Phase 9).

</domain>

<decisions>
## Implementation Decisions

### LeadService — Localização e Interface

- **D-01:** LeadService fica em `packages/core/src/leads/lead-service.ts` — junto ao BrainRunner, que é o único consumidor em v1.1. Evita criar acoplamento em packages/database e é consistente com onde a lógica de orchestração mora.
- **D-02:** Interface: `class LeadService` com `sql` injetado no construtor (`new LeadService(sql)`). Padrão consistente com BrainRunner, MemoryManager. Métodos: `upsertLead(numero, uniqueId, nome?): Promise<Lead>` e `getByNumero(numero): Promise<Lead | null>`.
- **D-03:** Quem chama o upsert: `BrainRunner.run()` — não os transport handlers. Qualquer transport que chamar `runner.run()` automaticamente obtém o comportamento de cadastro de lead. Evita drift entre transports futuros.

### Gate ia_ativada

- **D-04:** Gate verificado dentro de `BrainRunner.run()` imediatamente após o upsert — único ponto de controle, funciona para qualquer transport.
- **D-05:** Quando `lead.iaAtivada === false`: `BrainRunner.run()` retorna `null` silenciosamente (sem chamar LLM, sem log além de debug). LEAD-03 exige "ignorado silenciosamente antes de qualquer chamada LLM".
- **D-06:** Fluxo em `BrainRunner.run()`: `upsertLead(numero, uniqueId, nome)` → verificar `iaAtivada` → se false: return null → continuar com LLM.

### RabbitMQ Transport — Estrutura

- **D-07:** Biblioteca: `rabbitmq-client@^5.0.8` (decisão de STATE.md mantida) — zero deps, Bun-compatible, auto-reconnect built-in.
- **D-08:** Padrão de construtor igual ao WebhookTransport (Phase 5 D-09): `new RabbitMQTransport(runner)` implementa `ITransport`.
- **D-09:** `factory.ts` atualizado para incluir `case "rabbitmq": return new RabbitMQTransport(runner)` no switch de TRANSPORT ENV.

### RabbitMQ — ENVs de Configuração (TRP-04)

- **D-10:** `RABBITMQ_URL` — connection string (ex: `amqp://user:pass@host:5672`)
- **D-11:** `RABBITMQ_QUEUE` — nome da fila de entrada (consumer)
- **D-12:** `RABBITMQ_DLQ` — nome da fila de saída para mensagens com falha permanente
- **D-13:** `RABBITMQ_RETRY_DELAY_MS` — backoff entre retries em ms (default: 1000)

### RabbitMQ — Provisioning (TRP-05)

- **D-14:** Transport NÃO cria nem declara filas, exchanges ou bindings — apenas conecta e consome. Filas (`RABBITMQ_QUEUE` e `RABBITMQ_DLQ`) são pré-configuradas pelo ops antes do deploy.
- **D-15:** `prefetch=1` — uma mensagem por consumer de cada vez (TRP-05).

### RabbitMQ — Política de Retry e Falha Permanente (TRP-05)

- **D-16:** **3 tentativas** por mensagem — após 3 falhas consecutivas a mensagem é considerada permanentemente falha.
- **D-17:** Backoff fixo entre tentativas: `RABBITMQ_RETRY_DELAY_MS` ms de espera entre cada retry.
- **D-18:** Contador de tentativas em memória (`Map<deliveryTag, count>`) — simples e sem dependência de x-death header (que requer configuração de DLX no broker).
- **D-19:** Após 3 falhas: publicar mensagem original na `RABBITMQ_DLQ` via default exchange + ack a mensagem original da fila principal (sem nack). Evita dependência de configuração de DLX no broker.
- **D-20:** Todas as exceções tratadas igualmente: `log.error({ err, deliveryTag, attempt }, "message processing failed")`. Sem classificação de transiente vs permanente em v1.1.

### TRP-01 — Validação do Webhook

- **D-21:** BrainEventSchema.safeParse já valida os campos `{Name, Message, Numero, IDLead}` e retorna 400 se algum faltar — implementado em Phase 5. Phase 7 adiciona teste explícito cobrindo o caso de campo faltando (ex: sem `IDLead`) para satisfazer formalmente TRP-01.

### Claude's Discretion

- Nome exato do arquivo do LeadService (`lead-service.ts` ou `leads.ts`)
- Mensagem de log quando `ia_ativada=false` (debug level, pode ser omitida)
- Timeout de conexão do rabbitmq-client
- Tratamento de `RABBITMQ_DLQ` ausente no ENV (ConfigurationError no start() ou apenas log warning?)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fase e Requirements

- `.planning/ROADMAP.md` §Phase 7 — Goal, success criteria, requirements LEAD-02, LEAD-03, TRP-01, TRP-03, TRP-04, TRP-05, TRP-06
- `.planning/REQUIREMENTS.md` §Transport e §Leads — definição formal dos requirements

### Código existente a modificar/estender

- `packages/core/src/runner/runner.ts` — BrainRunner.run() onde LeadService é chamado e gate ia_ativada é verificado
- `packages/transport/src/factory.ts` — adicionar case "rabbitmq" no switch
- `packages/transport/src/interface.ts` — ITransport interface (NÃO muda)
- `packages/transport/src/webhook/handler.ts` — WebhookTransport (referência de padrão para RabbitMQTransport)
- `packages/transport/src/webhook/handler.test.ts` — testes a estender para TRP-01 (campo faltando)
- `packages/database/src/schema/tables.ts` — schema da tabela `leads` (D-04 do Phase 6, já existe)
- `packages/database/src/index.ts` — barrel que exporta `leads` table

### Contexto de fases anteriores

- `.planning/phases/05-transport-foundation/05-CONTEXT.md` — D-09 (padrão de construtor para RabbitMQTransport)
- `.planning/phases/06-leads-schema-migration/06-CONTEXT.md` — D-02 (unique_id = IDLead), D-04 (numero = UNIQUE key), D-05 (ia_ativada DEFAULT true)

### Convenções

- `CLAUDE.md` — constraints de runtime (Bun), convenções de teste, paths

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/core/src/runner/runner.ts`: BrainRunner já recebe `sql` no construtor — LeadService pode ser instanciado dentro de `_compileGraph()` ou diretamente no construtor
- `packages/transport/src/webhook/handler.ts`: WebhookTransport — template exato para RabbitMQTransport (construtor com runner, start/stop, ITransport)
- `packages/transport/src/factory.ts`: switch de TRANSPORT ENV — adicionar `case "rabbitmq"` com `new RabbitMQTransport(runner)`
- `packages/database/src/schema/tables.ts`: `leads` table já definida com todos os campos (uniqueId, numero UNIQUE, iaAtivada, nome, etc.)
- `packages/database/src/index.ts`: `export * from './schema/tables.js'` exporta `leads` automaticamente
- `@brain-pkg/shared`: `ConfigurationError` para fail-fast em start() quando ENVs ausentes

### Established Patterns

- Construtor com injeção: `new Class({ dep1, dep2 })` — BrainRunner, MemoryManager
- Classe com sql injetado: MemoryManager, BrainRunner — LeadService seguirá o mesmo padrão
- `ConfigurationError` para configuração ausente em startup (WebhookTransport, BrainRunner)
- Drizzle upsert: `.insert(leads).values({...}).onConflictDoUpdate({ target: leads.numero, set: {...} })` — padrão de upsert com uniqueIndex

### Integration Points

- `BrainRunner.run()` linha ~151: atualmente usa `event.Numero` como threadId — após Phase 7, lead é upsertado aqui e `lead.uniqueId` estará disponível (Phase 8 vai usar `lead.uniqueId` como threadId)
- `packages/transport/src/index.ts`: barrel do pacote transport — exportar `RabbitMQTransport` aqui
- `apps/brain-echo` (e futuros apps): ENV vars `RABBITMQ_URL`, `RABBITMQ_QUEUE`, `RABBITMQ_DLQ`, `RABBITMQ_RETRY_DELAY_MS` precisam estar no .env.example

</code_context>

<specifics>
## Specific Ideas

- O campo `nome` no upsert vem de `event.Name` do payload — LeadService.upsertLead(event.Numero, event.IDLead, event.Name)
- `RABBITMQ_DLQ` é a fila de destino para falhas permanentes — consumer publica explicitamente lá (não via mecanismo DLX do broker), o que elimina dependência de configuração de `x-dead-letter-exchange` na fila principal
- rabbitmq-client@^5.0.8 já tem auto-reconnect built-in — RabbitMQTransport.start() configura o consumer e o cliente cuida da reconexão automaticamente (TRP-05)
- Phase 8 vai substituir `event.Numero` por `lead.uniqueId` como `thread_id` — o LeadService criado em Phase 7 provê o `lead.uniqueId` que Phase 8 vai consumir

</specifics>

<deferred>
## Deferred Ideas

- x-death header do RabbitMQ para tracking de retries persistente entre restarts — pode ser avaliado quando o volume de mensagens justificar (v1.2)
- Timeout configurável no rabbitmq-client — default do cliente por ora
- Classif icação de erros transientes vs permanentes para política de retry diferenciada — v1.2 com observabilidade de DLQ

</deferred>

---

*Phase: 07-leadservice-rabbitmq-transport*
*Context gathered: 2026-06-14*
