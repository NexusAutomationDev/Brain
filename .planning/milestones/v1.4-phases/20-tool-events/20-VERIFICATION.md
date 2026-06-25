---
phase: 20-tool-events
verified: 2026-06-23T23:30:00Z
status: gaps_found
score: 4/5 roadmap success criteria verified
overrides_applied: 0
gaps:
  - truth: "EVT-03: Quando FUP envia mensagem, publica evento { action: 'fup', lead, result: { step, message } } no canal de saída"
    status: failed
    reason: "EVT-03 é mapeado para Phase 20 no REQUIREMENTS.md (tabela de traceabilidade) mas nenhum dos dois planos da fase (20-01-PLAN, 20-02-PLAN) o reivindicou. Nenhuma implementação de publicação de eventos FUP existe no codebase. Phase 22 (FUP Automático) também não lista EVT-03 em seus requirements."
    artifacts:
      - path: "packages/core/src/runner/runner.ts"
        issue: "Sem publicação de evento FUP — TOOL_EVENTS_WHITELIST contém apenas qualify_lead, pause_session, finish_conversation; ação 'fup' ausente"
      - path: "packages/core/src/events/event-publisher.ts"
        issue: "Suporta publicação genérica (webhook + RabbitMQ), mas nenhum chamador de evento FUP existe"
    missing:
      - "Decisão explícita: EVT-03 é responsabilidade de Phase 22 (FUP scheduler) ou de uma revisão de Phase 20?"
      - "Se Phase 22: adicionar EVT-03 à lista de requirements de Phase 22 no ROADMAP.md"
      - "Se Phase 20: implementar publicação fire-and-forget de evento fup no scheduler FUP (ainda não implementado)"
---

# Phase 20: Tool Events — Verification Report

**Phase Goal:** Brains publicam automaticamente o resultado de cada tool relevante em canal de saída separado (webhook ou RabbitMQ), sem bloquear o fluxo principal
**Verified:** 2026-06-23T23:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | TOOL_EVENTS_URL configurada dispara POST fire-and-forget com `{ event_id, action, lead, result, timestamp }` para qualify_lead, pause_session, finish_conversation | ✓ VERIFIED | `EventPublisher._publishWebhook()` usa `fetch()` com `AbortSignal.timeout(5000)` e body JSON; `runner.ts` filtra e chama `publish()` sem `await`; 4 testes unitários webhook passando |
| 2 | TOOL_EVENTS_QUEUE configurada publica os mesmos eventos na fila RabbitMQ | ✓ VERIFIED | `EventPublisher._publishRabbitMQ()` usa `rabbitmq-client` com `confirm:true`; D-06: QUEUE tem prioridade sobre URL; testes unitários RabbitMQ passando (5 testes) |
| 3 | Cada evento carrega `event_id = thread_id:tool_call_id` — dois eventos do mesmo tool call produzem o mesmo `event_id` | ✓ VERIFIED | `runner.ts:286`: `event_id: \`${threadId}:${msg.tool_call_id}\``; teste EVT-04 verifica `/:call-abc-123$/`; teste idempotência em event-publisher.test.ts passando |
| 4 | Publicação de evento nunca bloqueia nem atrasa a resposta do Brain ao lead | ✓ VERIFIED | `runner.ts:303`: `this.eventPublisher.publish(toolEvents).catch(...)` sem `await` no call site; `grep -n "await.*eventPublisher.*publish"` retorna 0 resultados no run() |
| 5 | Quando nenhum ENV de Tool Events está configurado, o sistema funciona normalmente sem publicar eventos | ✓ VERIFIED | `runner.ts:145-153`: `init()` não cria EventPublisher quando ENVs ausentes; `eventPublisher` permanece `null`; teste EVT-01 sem ENV passando |

**Score:** 4/5 truths verified (EVT-03 não está coberto pelos success criteria do roadmap para Phase 20, mas está listado nos requirements)

### Requirement EVT-03 — Gap Detectado

**EVT-03** (`REQUIREMENTS.md:21`): "Quando FUP envia mensagem, publica evento `{ action: "fup", lead, result: { step, message } }` no canal de saída"

- REQUIREMENTS.md traceabilidade (`linha 83`): `EVT-03 | Phase 20 | Pending`
- Nenhum plan de Phase 20 reivindica EVT-03 nos seus campos `requirements:`
- 20-01-SUMMARY indica `requirements-completed: EVT-01, EVT-02, EVT-04` (omite EVT-03 deliberadamente)
- Phase 22 (FUP Automático) lista `Requirements: FUP-01, FUP-02, FUP-03, FUP-05, FUP-06, FUP-07, FUP-08` — EVT-03 ausente
- **Nenhuma implementação existe no codebase** para publicação de evento FUP

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/events/event-publisher.ts` | IEventPublisher interface, ToolEvent type, EventPublisher class (webhook + RabbitMQ), NoopEventPublisher | ✓ VERIFIED | 154 linhas, implementação completa, 16 testes unitários passando |
| `packages/core/src/runner/runner.ts` | BrainRunner com EventPublisher integrado em init/run/close + TOOL_EVENTS_WHITELIST | ✓ VERIFIED | Import na linha 18-19 e 28-29; WHITELIST módulo linha 32-36; init() linha 144-153; run() linha 275-307; close() linha 360-364 |
| `packages/core/src/index.ts` | Barrel exportando IEventPublisher, ToolEvent, EventPublisher, NoopEventPublisher | ✓ VERIFIED | Linhas 35-37: export type + export value |
| `packages/core/src/events/__tests__/unit/event-publisher.test.ts` | 16 testes unitários cobrindo EVT-01 (webhook + rabbitmq), EVT-04, PII, close() | ✓ VERIFIED | 16 testes passando em 213ms |
| `packages/core/src/runner/__tests__/brain-runner.test.ts` | 4 novos testes EVT: sem ENV, close injetado, whitelist EVT-02, guard name undefined | ✓ VERIFIED | 26 testes total (era 22), todos passando em 1483ms |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `runner.ts` | `events/event-publisher.ts` | `import type { IEventPublisher, ToolEvent }` + `import { EventPublisher }` | ✓ WIRED | Linhas 28-29 confirmadas |
| `runner.ts (run)` | `eventPublisher.publish()` | Fire-and-forget `.catch()` sem `await` | ✓ WIRED | Linha 303: `this.eventPublisher.publish(toolEvents).catch(...)` |
| `runner.ts (init)` | `new EventPublisher()` | Condicional em ENVs `TOOL_EVENTS_QUEUE` / `TOOL_EVENTS_URL` | ✓ WIRED | Linhas 145-153: guard `!this.eventPublisher` + `hasQueue || hasUrl` |
| `runner.ts (close)` | `eventPublisher.close()` | `await this.eventPublisher.close()` | ✓ WIRED | Linhas 360-364 |
| `index.ts` | `events/event-publisher.js` | Named exports type + value | ✓ WIRED | Linhas 36-37 |
| `BrainRunnerOptions` | `IEventPublisher` | Campo `eventPublisher?: IEventPublisher` | ✓ WIRED | Linha 51 de runner.ts |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `runner.ts` (run) | `toolEvents[]` | `result.messages` de `compiledGraph.invoke()` | Sim — filtra ToolMessages reais do LangGraph post-invoke | ✓ FLOWING |
| `event-publisher.ts` (webhook) | evento `ToolEvent` | `publish(events)` caller | Sim — constrói com `threadId`, `msg.tool_call_id`, `lead`, `msg.content` reais | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 16 testes unitários EventPublisher passam | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | 16 pass, 0 fail | ✓ PASS |
| 26 testes BrainRunner passam (inclui 4 EVT) | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | 26 pass, 0 fail | ✓ PASS |
| Sem `await` no call site de `publish()` em `run()` | `grep "await.*eventPublisher.*publish" runner.ts` | 0 resultados (apenas `close()` usa await) | ✓ PASS |
| TOOL_EVENTS_WHITELIST como constante de módulo | `grep -n "TOOL_EVENTS_WHITELIST" runner.ts` | Linha 32: `const TOOL_EVENTS_WHITELIST = new Set([...])` fora da classe | ✓ PASS |
| Full suite packages/core (exceto integration com DB) | `bun test packages/core/src` | 124 pass, 2 fail (integration tests que requerem PostgreSQL real — pre-existentes, sem relação com Phase 20) | ✓ PASS (falhas pre-existentes) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EVT-01 | 20-01-PLAN, 20-02-PLAN | Brain publica eventos em canal separado (webhook ou RabbitMQ) configurável via ENV, sem bloquear fluxo | ✓ SATISFIED | EventPublisher com dois modos + BrainRunner.init() conditional + fire-and-forget em run() |
| EVT-02 | 20-02-PLAN | qualify_lead, pause_session, finish_conversation publicam `{ action, lead, result }` automaticamente | ✓ SATISFIED | TOOL_EVENTS_WHITELIST hardcoded com 3 tools; teste EVT-02 verifica filtragem; respond fora da whitelist ignorado |
| EVT-03 | — (não reivindicado) | Quando FUP envia mensagem, publica evento `{ action: "fup", lead, result }` | ✗ NOT IMPLEMENTED | Nenhum plan de Phase 20 reivindicou EVT-03; FUP não está implementado (Phase 22); evento FUP ausente do codebase |
| EVT-04 | 20-01-PLAN, 20-02-PLAN | Cada evento carrega `event_id = thread_id:tool_call_id` para deduplicação idempotente | ✓ SATISFIED | `event_id: \`${threadId}:${msg.tool_call_id}\`` em runner.ts:286; teste EVT-04 idempotência passando |

### Anti-Patterns Found

Nenhum anti-pattern detectado nos arquivos-chave da fase (event-publisher.ts, runner.ts).

### Gaps Summary

**1 gap identificado:** EVT-03 não implementado e sem fase proprietária definida.

O REQUIREMENTS.md mapeia EVT-03 para Phase 20 (linha 83), mas Phase 20 executou apenas EVT-01, EVT-02 e EVT-04. EVT-03 trata de publicação de evento quando o scheduler FUP envia mensagem — funcionalidade que depende do FUP scheduler (Phase 22). No entanto, Phase 22 não inclui EVT-03 em sua lista de requirements no ROADMAP.md.

**Situação:** Ownership ambígua — EVT-03 é um evento de canal de saída (domínio de Phase 20) mas sua trigger pertence ao FUP scheduler (Phase 22). Requer decisão explícita antes de planejar implementação.

**Os outros 4 success criteria do roadmap para Phase 20 estão completamente verificados:**
- Canal webhook com fire-and-forget, timeout 5s e absorção silenciosa de erros
- Canal RabbitMQ com confirm:true e prioridade sobre webhook
- event_id idempotente construído como `threadId:tool_call_id`
- BrainRunnerOptions.eventPublisher injetável para testes (D-11)
- Commits verificados: `cac23d7`, `12f7ab2`, `ffad562` — todos existem no histórico git

---

_Verified: 2026-06-23T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
