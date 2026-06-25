---
phase: 20-tool-events
plan: "01"
subsystem: events
tags: [rabbitmq, webhook, tool-events, event-publisher, tdd]

requires:
  - phase: 19-database-foundation
    provides: leads schema with touchLastMessage, FUP columns

provides:
  - IEventPublisher interface com publish() e close()
  - ToolEvent type com event_id, action, lead, result, timestamp
  - EventPublisher class com modo webhook (fetch + AbortSignal.timeout) e modo RabbitMQ (rabbitmq-client)
  - NoopEventPublisher class para estado desabilitado
  - 16 testes unitários cobrindo EVT-01, EVT-04 e segurança PII

affects:
  - 20-02 (BrainRunner integration — Plan 02 consome IEventPublisher)
  - qualquer Brain que use EventPublisher diretamente

tech-stack:
  added: []
  patterns:
    - "EventPublisher via ENVs: TOOL_EVENTS_QUEUE tem prioridade sobre TOOL_EVENTS_URL (D-06)"
    - "fire-and-forget: erros de publicação absorvidos com logger.warn, nunca relançados"
    - "PII isolation: apenas eventId nos logs de erro, nunca nome/numero/id do lead"
    - "init() separado do construtor: construção síncrona, conexão RabbitMQ em init() assíncrono"

key-files:
  created:
    - packages/core/src/events/event-publisher.ts
    - packages/core/src/events/__tests__/unit/event-publisher.test.ts
  modified: []

key-decisions:
  - "Construtor valida ENVs e falha rápido (ConfigurationError) — BrainRunner só instancia EventPublisher quando pelo menos um ENV está presente"
  - "init() assíncrono separado do construtor para inicializar conexão RabbitMQ — alinha com padrão do BrainRunner"
  - "NoopEventPublisher como implementação discreta para estado desabilitado — BrainRunner usa noop em vez de null check"
  - "EVT-02 (whitelist) pertence ao BrainRunner (Plan 02), não ao EventPublisher — publisher recebe eventos já filtrados"

patterns-established:
  - "IEventPublisher: interface com publish(events: ToolEvent[]) e close() — usada pelo BrainRunner como tipo"
  - "AbortSignal.timeout(5000): timeout de 5s em fetch de webhook (T-20-05)"
  - "confirm:true em createPublisher(): aguarda ack do broker RabbitMQ (padrão existente em consumer.ts)"

requirements-completed:
  - EVT-01
  - EVT-02
  - EVT-04

duration: 15min
completed: "2026-06-23"
---

# Phase 20 Plan 01: Tool Events — EventPublisher Summary

**IEventPublisher com dois modos (webhook via fetch/AbortSignal e RabbitMQ via rabbitmq-client/confirm), NoopEventPublisher, ToolEvent type e 16 testes unitários TDD cobrindo EVT-01 e EVT-04**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-23T22:15:00Z
- **Completed:** 2026-06-23T22:30:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- `EventPublisher` com modo webhook (fetch + AbortSignal.timeout(5000)) e modo RabbitMQ (rabbitmq-client Connection + confirm:true)
- `NoopEventPublisher` como implementação discreta para estado desabilitado
- `IEventPublisher` interface e `ToolEvent` type exportados de `packages/core/src/events/event-publisher.ts`
- 16 testes unitários passando (RED confirmado antes da implementação, GREEN após)
- PII (nome, numero, id) isolado dos logs — apenas eventId em warn de falha (T-20-02)

## Task Commits

1. **Task 1: TDD — IEventPublisher + EventPublisher (webhook e RabbitMQ)** - `cac23d7` (feat)

## Files Created/Modified

- `packages/core/src/events/event-publisher.ts` — IEventPublisher interface, ToolEvent type, EventPublisher class (webhook + rabbitmq), NoopEventPublisher class
- `packages/core/src/events/__tests__/unit/event-publisher.test.ts` — 16 testes unitários cobrindo EVT-01 (webhook + rabbitmq + disabled), EVT-04 (event_id idempotente), segurança PII e close()

## Decisions Made

- `init()` assíncrono separado do construtor: construção síncrona valida ENVs e falha rápido; init() inicializa conexão RabbitMQ — mesmo padrão do BrainRunner
- `NoopEventPublisher` como classe discreta em vez de null check no caller — BrainRunner instancia noop quando ENVs ausentes, publisher quando presentes
- Filtro EVT-02 (whitelist de tools) pertence ao BrainRunner (Plan 02), não ao EventPublisher — publisher recebe `ToolEvent[]` já filtrados; `publish([])` é válido e idempotente

## Deviations from Plan

None - plano executado exatamente como especificado. Implementação segue o código-template do plano com pequenas melhorias de documentação inline.

## Issues Encountered

None.

## User Setup Required

None - nenhuma configuração externa requerida para este plano. ENVs (TOOL_EVENTS_URL, TOOL_EVENTS_QUEUE, RABBITMQ_URL) são configuradas pelo operador no deploy.

## Next Phase Readiness

- `IEventPublisher` e `EventPublisher` prontos para integração no BrainRunner (Plan 02)
- Plan 02 deve: instanciar EventPublisher/NoopEventPublisher em `init()` baseado nos ENVs; implementar whitelist EVT-02 no `run()` antes de chamar `publisher.publish()`; chamar `publisher.close()` em `close()` do BrainRunner

---
*Phase: 20-tool-events*
*Completed: 2026-06-23*
