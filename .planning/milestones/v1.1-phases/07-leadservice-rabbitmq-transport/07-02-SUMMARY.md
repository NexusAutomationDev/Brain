---
phase: "07-leadservice-rabbitmq-transport"
plan: "02"
subsystem: "transport"
tags: ["rabbitmq", "consumer", "ack-manual", "dlq", "retry", "tdd"]
dependency_graph:
  requires:
    - "packages/transport/src/webhook/events.ts (BrainEventSchema)"
    - "packages/transport/src/webhook/handler.ts (IBrainRunnerLike)"
    - "packages/transport/src/interface.ts (ITransport)"
    - "@brain-pkg/shared (ConfigurationError)"
    - "@brain-pkg/observability (createLogger)"
  provides:
    - "RabbitMQTransport class (TRP-03, TRP-04, TRP-05)"
    - "createTransport('rabbitmq') → RabbitMQTransport (TRP-06)"
    - "packages/transport barrel export de RabbitMQTransport"
    - "apps/brain-echo/.env.example com ENVs RabbitMQ documentadas"
  affects:
    - "packages/transport/src/factory.ts (case 'rabbitmq' adicionado)"
    - "packages/transport/src/index.ts (barrel atualizado)"
tech_stack:
  added:
    - "rabbitmq-client@5.0.8 — zero deps, Bun-compatible, auto-reconnect built-in"
    - "@brain-pkg/observability (workspace) adicionado como dep do transport"
  patterns:
    - "TDD: RED (stubs de teste) → GREEN (implementação) → sem refactor necessário"
    - "Retry key por IDLead:Numero — robusto contra deliveryTag reset após REQUEUE"
    - "DLQ explícita via Publisher.confirm=true + ConsumerStatus.ACK (sem DLX broker)"
    - "prefetch=1 + requeue=false — controle manual de ack, backpressure natural"
key_files:
  created:
    - "packages/transport/src/rabbitmq/consumer.ts (RabbitMQTransport)"
    - "packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts (7 testes TRP-03/04/05)"
    - "apps/brain-echo/.env.example (ENVs documentadas)"
  modified:
    - "packages/transport/src/factory.ts (case 'rabbitmq' + import RabbitMQTransport)"
    - "packages/transport/src/index.ts (export RabbitMQTransport)"
    - "packages/transport/src/factory.test.ts (TRP-06 + kafka variant)"
    - "packages/transport/package.json (rabbitmq-client@^5.0.8, @brain-pkg/observability)"
decisions:
  - "rabbitmq-client@5.0.8 instalado (não amqplib-bun) — zero deps, suporte Bun confirmado"
  - "Retry key = IDLead:Numero (Opção A) — sobrevive a deliveryTag reset após REQUEUE"
  - "DLQ via Publisher explícito + ACK (não DLX) — sem dependência de configuração de broker"
  - "@brain-pkg/observability adicionado como dep do transport para structured logging consistente"
  - "Testes em src/__tests__/unit/rabbitmq/ — conforme convention CLAUDE.md (não ao lado do código)"
metrics:
  duration: "~10 min"
  completed_date: "2026-06-14"
  tasks_completed: 3
  files_created: 3
  files_modified: 4
requirements:
  - TRP-03
  - TRP-04
  - TRP-05
  - TRP-06
---

# Phase 7 Plan 02: RabbitMQ Consumer Transport Summary

**One-liner:** RabbitMQTransport com consumer ack manual, retry por IDLead:Numero (max 3), DLQ explícita via Publisher e seleção por TRANSPORT=rabbitmq env.

## Tasks Executadas

| Task | Nome | Commit | Arquivos Principais |
|------|------|--------|---------------------|
| W0 (RED) | Instalar rabbitmq-client e criar stubs de teste | e38c3d6 | consumer.test.ts, factory.test.ts, package.json |
| 1 (GREEN) | Implementar RabbitMQTransport | 12ef89d | packages/transport/src/rabbitmq/consumer.ts |
| 2 | Integrar factory e atualizar barrel + .env.example | 701f5dc | factory.ts, index.ts, .env.example |

## Resultados de Verificação

```
# Suite completa do pacote transport
bun test — 22 pass, 0 fail, 42 expect() calls (4 files)

# Testes TRP-03/04/05
consumer.test.ts — 7 pass, 0 fail

# Testes TRP-06 (factory)
factory.test.ts — 7 pass, 0 fail
```

## Success Criteria — Todos Atendidos

- [x] TRANSPORT=rabbitmq inicia RabbitMQTransport via factory sem erro
- [x] Mensagem {Name, Message, Numero, IDLead} processada com sucesso recebe ConsumerStatus.ACK
- [x] Payload sem IDLead vai direto para DLQ sem chamar runner.run()
- [x] Após 3 falhas em runner.run(), mensagem publicada na DLQ e ConsumerStatus.ACK retornado
- [x] runner.run() não é chamado uma 4a vez após 3 falhas (retryMap limpo + DLQ acionado)
- [x] start() lança ConfigurationError se RABBITMQ_URL, RABBITMQ_QUEUE ou RABBITMQ_DLQ ausentes
- [x] bun test no pacote transport sai com código 0 (22/22 testes passando)
- [x] apps/brain-echo/.env.example documenta RABBITMQ_URL, RABBITMQ_QUEUE, RABBITMQ_DLQ, RABBITMQ_RETRY_DELAY_MS

## Detalhes de Implementação

### rabbitmq-client@5.0.8

Versão instalada confirmada em `package.json`:
```json
"rabbitmq-client": "^5.0.8"
```

### Chave de Retry: IDLead:Numero

Conforme Opção A do RESEARCH.md — a chave `${IDLead}:${Numero}` é usada no `retryMap` ao invés do `deliveryTag`. O `deliveryTag` é um `bigint` que muda após cada `REQUEUE`, o que zeraria o contador de retries a cada tentativa, criando loop infinito. A chave por conteúdo é estável entre reconnects e requeuees.

### Fluxo de Mensagem

```
msg.body → BrainEventSchema.safeParse()
  ├── FALHA → pub.send(DLQ, body) + ACK (sem retry — erro permanente)
  └── OK → runner.run(parsed.data)
        ├── SUCESSO → retryMap.delete(key) + ACK
        └── ERRO → retryMap[key]++
              ├── attempt < 3 → Bun.sleep(retryDelayMs) + REQUEUE
              └── attempt >= 3 → retryMap.delete(key) + pub.send(DLQ) + ACK
```

## Deviações do Plano

### 1. [Rule 2 - Missing Dep] @brain-pkg/observability adicionado ao transport

**Encontrado em:** Task 1
**Problema:** O plano usa `createLogger()` de `@brain-pkg/observability` no consumer.ts, mas o pacote `@brain-pkg/transport` não tinha essa dependência declarada.
**Correção:** Adicionado `"@brain-pkg/observability": "workspace:*"` ao `package.json` do transport. Isso é correto — observabilidade consistente via Pino é obrigatório para operação em produção.
**Arquivos:** `packages/transport/package.json`
**Commit:** e38c3d6

### 2. [CLAUDE.md Convention] Teste em src/__tests__/unit/ em vez de src/rabbitmq/

**Encontrado em:** Task W0
**Problema:** O plano especificava o teste em `packages/transport/src/rabbitmq/consumer.test.ts`, mas CLAUDE.md proíbe `*.test.ts` fora de `__tests__/`.
**Correção:** Arquivo criado em `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts`. O import relativo `../../../rabbitmq/consumer.js` funciona corretamente.
**Impacto:** Caminho do arquivo difere do plano, mas convention do projeto é respeitada. Critérios de aceitação funcionais foram todos atendidos.

## Known Stubs

Nenhum — todos os comportamentos implementados são concretos e testados.

## Threat Flags

Nenhum novo endpoint ou superfície de ataque introduzida além do descrito no `<threat_model>` do plano. O consumer.ts implementa exatamente as mitigações T-07-06, T-07-07, T-07-08 especificadas.

## Self-Check: PASSED

- [x] `packages/transport/src/rabbitmq/consumer.ts` — FOUND
- [x] `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` — FOUND
- [x] `packages/transport/src/factory.ts` contém `case "rabbitmq"` — FOUND
- [x] `packages/transport/src/index.ts` contém `export { RabbitMQTransport }` — FOUND
- [x] `apps/brain-echo/.env.example` — FOUND
- [x] Commit e38c3d6 — FOUND (RED state: testes + package.json)
- [x] Commit 12ef89d — FOUND (GREEN: consumer.ts implementado)
- [x] Commit 701f5dc — FOUND (factory + barrel + .env.example)
- [x] bun test (22 pass, 0 fail) — PASSED
