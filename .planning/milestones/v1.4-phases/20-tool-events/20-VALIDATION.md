---
phase: 20
slug: tool-events
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
audited: 2026-06-24
---

# Phase 20 — Validation Strategy

> Contrato de validação retroativa para a Phase 20 (tool-events). Reconstruído a partir de PLAN e SUMMARY, estado B.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Jest-compatible API) |
| **Config file** | none — zero-config, nativo no Bun runtime |
| **Quick run command** | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` |
| **Full suite command** | `bun test packages/core/src` |
| **Estimated runtime** | ~1–2 segundos (unit); ~3–5 segundos (full core) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts`
- **After every plan wave:** Run `bun test packages/core/src`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | EVT-01 (webhook) | T-20-05 | AbortSignal.timeout(5000) previne hang em webhook lento | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | ✅ | ✅ green |
| 20-01-01 | 01 | 1 | EVT-01 (RabbitMQ) | T-20-08 | fire-and-forget: erros absorvidos com logger.warn, nunca relançados | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | ✅ | ✅ green |
| 20-01-01 | 01 | 1 | EVT-04 (event_id idempotência) | — | event_id = threadId:toolCallId — dois eventos do mesmo call produzem mesmo ID | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | ✅ | ✅ green |
| 20-02-01 | 02 | 2 | EVT-01 (sem ENV = null) | T-20-10 | Sem ENVs: eventPublisher permanece null, runner funciona normalmente | integration | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |
| 20-02-01 | 02 | 2 | EVT-02 (whitelist runner) | T-20-07 | qualify_lead/pause_session/finish_conversation publicam; respond ignorado | integration | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |
| 20-02-01 | 02 | 2 | EVT-04 (event_id no runner) | — | event_id construído como `${threadId}:${tool_call_id}` no runner | integration | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |
| 20-02-02 | 02 | 2 | EVT-01 (barrel export) | — | IEventPublisher, ToolEvent, EventPublisher, NoopEventPublisher exportados | integration | `bun test packages/core/src` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Framework (`bun test`) e configuração já presentes no projeto.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Quando FUP scheduler envia mensagem, publica evento `{ action: "fup", lead, result: { step, message } }` no canal de saída | EVT-03 | Não implementado em Phase 20. Ownership ambígua: REQUIREMENTS.md mapeia para Phase 20, mas trigger pertence ao FUP scheduler (Phase 22, não implementada). Requer decisão explícita de ownership antes de implementar. **Ação pendente:** adicionar EVT-03 aos requirements de Phase 22 no ROADMAP.md ou criar plano suplementar de Phase 20. | Verificar manualmente após Phase 22 (FUP scheduler) ser implementada: configurar TOOL_EVENTS_URL, disparar FUP via scheduler, confirmar que evento `{ action: "fup" }` chega no endpoint configurado. |

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 4 |
| Resolved (PARTIAL → COVERED) | 3 |
| Manual-only (EVT-03) | 1 |

**Root cause dos PARTIALs:** `runner.ts` recebeu `leadService.resetFup()` em fase posterior (Phase 21), mas o mock de `LeadService` em `brain-runner.test.ts:131` não foi atualizado. Fix: `resetFup: mock(async () => {})` adicionado ao mock (1 linha).

**Resultado pós-fix:** 45 testes passando (16 unit + 26 runner + 3 runner-fup), 0 falhas.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify — 6 de 7 behaviors cobertos por testes automáticos
- [x] Sampling continuity: nenhum gap de 3+ tasks consecutivas sem verify
- [x] Wave 0: infraestrutura pré-existente cobre todos os requisitos
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` — EVT-03 aceito como manual-only (blocked on Phase 22)

**Approval:** approved 2026-06-24
