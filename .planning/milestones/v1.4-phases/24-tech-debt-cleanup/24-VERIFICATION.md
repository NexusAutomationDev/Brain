---
phase: 24-tech-debt-cleanup
verified: 2026-06-24T23:15:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 24: Tech Debt & Tracker Cleanup — Verification Report

**Phase Goal:** Corrigir debt técnico acumulado de v1.4 — WR-01..WR-04 no FupScheduler, 4 erros TypeScript pré-existentes em packages/core, e atualizar REQUIREMENTS.md tracker para refletir estado real do código
**Verified:** 2026-06-24T23:15:00Z
**Status:** PASSED
**Re-verification:** Não — verificação inicial

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | FupScheduler loga warning quando `FUP_WEBHOOK_URL` configurado mas `checkpointer` null (WR-01) | VERIFIED | `runner.ts` linha 181-187: `else if (fupWebhookUrl && !this.checkpointer)` com `logger.warn(...)` e mensagem `"FupScheduler not started — checkpointer unavailable"` |
| 2 | `resetFup()` inclui `updatedAt` na atualização — consistente com outros métodos do LeadService (WR-02) | VERIFIED | `lead-service.ts` linha 137: `.set({ fupNextAt: null, fupStep: 0, updatedAt: new Date() })`. Teste `lead-service-fup.test.ts` linha 61 verifica `updatedAt instanceof Date`. 3 testes GREEN. |
| 3 | SIGTERM listener é removido em `close()` — sem acúmulo de listeners em chamadas múltiplas (WR-03) | VERIFIED | `runner.ts` linha 93: campo `private _sigtermHandler: (() => Promise<void>) \| null = null`. Linha 194-199: handler atribuído ao campo e registrado via `process.on()`. Linhas 398-401: `process.off('SIGTERM', this._sigtermHandler)` em `close()` com nullificação do campo. |
| 4 | FupScheduler adiciona delay entre retries — sem 30 calls simultâneos ao LLM em cenário de falha (WR-04) | VERIFIED | `fup-scheduler.ts` linhas 248-250: `if (attempt < MAX_FUP_ATTEMPTS) { await new Promise((r) => setTimeout(r, 1000)); }` no bloco `catch` do loop de retry. Teste WR-04 (`fup-scheduler.test.ts` linha 299) confirma: 2 falhas + 1 sucesso na 3ª tentativa. 11 testes GREEN. |
| 5 | `bun tsc --noEmit` em packages/core retorna 0 erros (SC-5) | VERIFIED | Comando executado: saída vazia, exit code 0. Confirmado ao vivo durante verificação. |
| 6 | REQUIREMENTS.md com checkboxes e traceability refletindo estado real do código implementado | VERIFIED | RAG-02 e RAG-03: checkbox `[x]` e Status `Complete` na traceability. EVT-03: Phase 22 na traceability. Linha `*Last updated*` atualizada para 2026-06-24. |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Esperado | Status | Detalhes |
|----------|----------|--------|----------|
| `packages/core/src/runner/runner.ts` | WR-01 (else-if warning) + WR-03 (campo privado + process.off) | VERIFIED | Campo `_sigtermHandler` na linha 93; `else if` na linha 181; `process.off` na linha 399. Commit e048673. |
| `packages/core/src/leads/lead-service.ts` | `resetFup()` com `updatedAt: new Date()` | VERIFIED | Linha 137 contém `updatedAt: new Date()`. Commit 6b16718. |
| `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | Teste verificando `updatedAt instanceof Date` | VERIFIED | Linha 61: `expect(setPayload!.updatedAt).toBeInstanceOf(Date)`. 3/3 testes passam. |
| `packages/core/src/fup/fup-scheduler.ts` | `_processFupForLead()` com delay de 1s entre retries | VERIFIED | Linhas 248-250: `if (attempt < MAX_FUP_ATTEMPTS) { await new Promise((r) => setTimeout(r, 1000)); }`. Commit 6d4b525. |
| `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` | Teste WR-04 verificando comportamento de 2 falhas + 1 sucesso | VERIFIED | Linha 299: teste `"WR-04: com 2 falhas seguidas de sucesso na 3ª tentativa..."`. 11/11 testes passam. Timeout explícito 5000ms. |
| `.planning/REQUIREMENTS.md` | RAG-02/RAG-03 com `[x]` e `Complete`; EVT-03 com `Phase 22` | VERIFIED | Linhas 13-14: `[x] **RAG-02**` e `[x] **RAG-03**`. Linhas 76-77: Status `Complete`. Linha 81: `EVT-03 \| Phase 22 \| Complete`. Commit de3b298. |

### Key Link Verification

| De | Para | Via | Status | Detalhes |
|----|------|-----|--------|----------|
| `runner.ts init()` | `logger.warn` | `else if (fupWebhookUrl && !this.checkpointer)` | VERIFIED | Linha 181-187 — padrão exato do plano presente |
| `runner.ts constructor` | `_sigtermHandler field` | `private _sigtermHandler: (() => Promise<void>) \| null = null` | VERIFIED | Linha 93 — campo declarado após `mcpSessionTtlMs` |
| `runner.ts close()` | `process.off` | `process.off('SIGTERM', this._sigtermHandler)` | VERIFIED | Linha 399 — primeiro bloco de `close()`, antes de `mcpClient` |
| `fup-scheduler.ts _processFupForLead` | `setTimeout delay` | `await new Promise((r) => setTimeout(r, 1000))` | VERIFIED | Linha 249 — dentro de `if (attempt < MAX_FUP_ATTEMPTS)` |
| `REQUIREMENTS.md RAG-02 checkbox` | `[x]` | mudança de `[ ]` para `[x]` | VERIFIED | Linha 13 |
| `REQUIREMENTS.md traceability EVT-03` | `Phase 22` | valor confirmado em worktree | VERIFIED | Linha 81 — já estava correto; EVT-03 nunca foi Phase 20 no worktree |

### Data-Flow Trace (Level 4)

Não aplicável — esta fase não adiciona componentes que rendem dados dinâmicos. As mudanças são: campo privado + chamadas de processo, inclusão de campo num `.set()`, delay com `setTimeout`, e atualização de documento de rastreabilidade.

### Behavioral Spot-Checks

| Comportamento | Comando | Resultado | Status |
|---------------|---------|-----------|--------|
| TypeScript zero-error em packages/core (SC-5) | `bun tsc --noEmit -p packages/core/tsconfig.json` | Exit 0, sem saída | PASS |
| 3 testes de LeadService.resetFup() GREEN | `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | 3 pass, 0 fail | PASS |
| 11 testes de FupScheduler GREEN (incluindo WR-04) | `bun test packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` | 11 pass, 0 fail, 4.84s | PASS |
| WR-04 delay real validado no teste | Saída do teste inclui 2 warn logs separados por ~1s cada | Timestamps: 23:11:46 e 23:11:47 nos warns — confirmam delay real de 1s entre tentativas | PASS |

### Requirements Coverage

Esta fase fecha **tech debt** e não requer novos requirement IDs. Os planos declaram `requirements: []` em todos os 3 planos. O ROADMAP.md confirma: `**Requirements**: (nenhum requirement novo — closes tech debt)`.

Nenhum requirement ID mapeado para Phase 24 em REQUIREMENTS.md — consistente com o escopo declarado.

### Anti-Patterns Found

Nenhum anti-padrão detectado nas mudanças desta fase:

- `_sigtermHandler = null` em `close()` é cleanup intencional de campo nullable, não stub
- `fupNextAt: null` em `resetFup()` é valor de domínio correto (cancelar FUP), não stub
- Comentários WR-01, WR-02, WR-03, WR-04 inline são documentação de decisão, não TODOs

### Human Verification Required

Nenhum item requer verificação humana — todas as mudanças são verificáveis programaticamente:
- Padrões de código verificados via grep
- Comportamento de testes verificado via `bun test`
- Compilação TypeScript verificada via `bun tsc --noEmit`
- Estado do documento verificado via grep em REQUIREMENTS.md

---

## Gaps Summary

Nenhum gap identificado. Todos os 6 success criteria do ROADMAP estão satisfeitos com evidência direta no código.

**Observação sobre WR-03:** O ROADMAP descreve SC-3 como "SIGTERM listener é removido em `close()` do FupScheduler", mas a implementação correta está em `BrainRunner.close()` (não no FupScheduler). O FupScheduler não registra SIGTERM — o BrainRunner é quem gerencia o processo. A descrição do SC-3 usa "FupScheduler" de forma imprecisa; o intent (sem acúmulo de listeners) está plenamente satisfeito pela implementação em `BrainRunner`.

---

_Verified: 2026-06-24T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
