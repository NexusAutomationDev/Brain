# Phase 26: FUP Next-At Init Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 26-fup-next-at-init-fix
**Areas discussed:** Base do clock do FUP, Spec EVT-04

---

## Base do clock do FUP

| Option | Description | Selected |
|--------|-------------|----------|
| Sim — FUP conta do INSERT | fupNextAt = NOW() + intervals[0] no INSERT. Lead criado, nunca falou, recebe FUP no intervalo configurado. | |
| Não — FUP só após primeira mensagem | fupNextAt só é setado quando last_message_at é atualizado (primeira mensagem). | |

**User's choice:** "FUP é só quando o lead demora para responder o LLM, aí é enviado o FUP"

**Notes:** No fluxo normal do BrainRunner, upsertLead() é chamado quando a primeira mensagem chega — portanto INSERT time ≈ tempo da primeira mensagem. A decisão foi: fupNextAt = NOW() + intervals[0] no INSERT, mas com a semântica correta de que o lead é criado no momento da primeira mensagem. Phase 25 D-06 ("FUP só após primeira mensagem") era uma intenção que não chegou a ser implementada como restrição no scheduler.

---

## Spec EVT-04 — onde atualizar

| Option | Description | Selected |
|--------|-------------|----------|
| REQUIREMENTS.md + code comment | Atualizar EVT-04 no REQUIREMENTS.md e verificar code comment em fup-scheduler.ts. | ✓ |
| Só REQUIREMENTS.md | Apenas atualizar EVT-04 no REQUIREMENTS.md. | |

**User's choice:** REQUIREMENTS.md + code comment

**Notes:** EVT-04 descreve event_id = thread_id:tool_call_id para tool events. FUP events usam uniqueId:fup:step (Phase 22 D-17). Atualizar spec para documentar a divergência intencional e verificar/completar o code comment em fup-scheduler.ts.

---

## Claude's Discretion

- Extração vs duplicação da lógica de business hours para calcular fupNextAt (shared utility vs inline)
- Estrutura interna da query expandida em upsertLead() (uma query vs duas)
- Estrutura dos testes de unidade

## Deferred Ideas

- Reinicialização de fupNextAt após resetFup() quando lead responde e depois para novamente — fora do escopo desta fase
- FUP proativo para leads criados sem mensagem (bulk import) — comportamento diferente, futura feature
