# Phase 24: Tech Debt & Tracker Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 24-tech-debt-cleanup
**Areas discussed:** WR-04 Delay, TypeScript SC-5, WR-03 SIGTERM, REQUIREMENTS.md

---

## WR-04 — Delay entre retries

| Option | Description | Selected |
|--------|-------------|----------|
| 1 segundo fixo | Simples, previsível, resolve thundering herd sem complexidade | ✓ |
| 2 segundos fixo | Mais conservador, mais latência por lead em retry | |
| Exponencial: 1s, 2s, 4s | Adequado para rate limiting, mas adiciona complexidade | |

**User's choice:** 1 segundo fixo
**Notes:** Resolve o WR-04 (BATCH_SIZE=10 × 3 retries = 30 calls simultâneos em falha) sem adicionar complexidade. Backoff exponencial foi deferido para FUP-F01.

---

## TypeScript SC-5 — 0 erros encontrados

| Option | Description | Selected |
|--------|-------------|----------|
| SC-5 já está met — documentar e fechar | tsc --noEmit retorna 0 erros; erros resolvidos incidentalmente em fases anteriores | ✓ |
| Investigar e confirmar a origem dos 4 erros | Checar git log, mais rastreabilidade | |

**User's choice:** Documentar e fechar
**Notes:** Os 4 erros do audit (lastMessageAt, fupNextAt Drizzle types, TokenUsage, responseMode) foram resolvidos durante as fases anteriores. SC-5 verificado como já met em 2026-06-24.

---

## WR-03 — Abordagem SIGTERM cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Campo privado + process.off() em close() | Padrão idiomático — remove apenas o handler do BrainRunner | ✓ |
| process.removeAllListeners('SIGTERM') | Mais simples mas remove todos os handlers externos também | |

**User's choice:** Campo privado + process.off()
**Notes:** Salvar handler como `private readonly _sigtermHandler` no constructor; chamar `process.off('SIGTERM', this._sigtermHandler)` em `close()`.

---

## REQUIREMENTS.md — Escopo do update

| Option | Description | Selected |
|--------|-------------|----------|
| RAG-02, RAG-03 + EVT-03 traceability | Atualiza checkboxes + corrige EVT-03 Phase 20→22 | ✓ |
| Apenas RAG-02 e RAG-03 | Mínimo para fechar Phase 23 | |

**User's choice:** RAG-02, RAG-03 + EVT-03 traceability
**Notes:** EVT-03 foi implementado em fup-scheduler.ts da Phase 22, mas o tracker ainda aponta Phase 20. Corrigir tudo de uma vez deixa o REQUIREMENTS.md 100% acurado.

---

## Claude's Discretion

- Ordem dos WR fixes no plano
- Mensagem exata do warning WR-01
- Onde exatamente inserir o delay em WR-04
- Testes de unidade para verificação dos fixes

## Deferred Ideas

- Backoff exponencial para retries (FUP-F01)
- Prompt 'fup' validado no startup
- fup_enabled trigger automático (Phase 25)
- FUP_RETRY_DELAY_MS configurável via ENV
