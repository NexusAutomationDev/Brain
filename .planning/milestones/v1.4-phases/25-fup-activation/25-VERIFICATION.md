---
phase: 25-fup-activation
verified: 2026-06-25T01:50:00Z
status: passed
score: 9/9
overrides_applied: 0
re_verification: false
---

# Phase 25: FUP Activation Trigger — Verification Report

**Phase Goal:** Leads recém-criados ou configurados para FUP têm `fup_enabled` ativado automaticamente — sem necessidade de intervenção manual no banco, tornando o FUP operacional em produção sem setup adicional por lead
**Verified:** 2026-06-25T01:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Quando `fup_config` existe no banco para o Brain, novos leads têm `fup_enabled = true` setado automaticamente via `LeadService.upsertLead()` | VERIFIED | `upsertLead()` faz SELECT em `fup_config` quando `isInsert=true && brainType` fornecido; seta `fupEnabled=true` em `values()` quando `configRows[0]?.enabled === true` (lead-service.ts linhas 50-60, 67-71) |
| SC-2 | O FUP dispara sem intervenção manual no banco para leads que param de responder — fluxo FUP automático completo em produção | VERIFIED | Pipeline completo: `BrainRunner.run()` → `upsertLead(brainType)` → `fup_config` query → `fup_enabled=true` no INSERT; BrainRunner passa `this.brain.brainType` como quarto parâmetro (runner.ts linha 253) |
| SC-3 | Leads que explicitamente têm `fup_enabled = false` (desativado manualmente) não são afetados pela ativação automática | VERIFIED | `fupEnabled` ausente de `onConflictDoUpdate.set` (lead-service.ts linhas 75-80); UPDATE path nunca altera `fup_enabled`; teste 4 da suite confirma invariant D-03 |

**Score ROADMAP:** 3/3 success criteria verificados

### Must-Haves dos PLANs (todos os planos)

| # | Truth | Fonte | Status | Evidence |
|---|-------|-------|--------|----------|
| 1 | Test suite verifies INSERT with fup_config enabled=true sets fup_enabled=true | PLAN-01 | VERIFIED | `it("INSERT com fup_config enabled=true → lead retornado tem fupEnabled=true (D-02)")` — linha 213; `expect(lead.fupEnabled).toBe(true)` — linha 253 |
| 2 | Test suite verifies INSERT with fup_config enabled=false sets fup_enabled=false | PLAN-01 | VERIFIED | `it("INSERT com fup_config enabled=false...")` — linha 256; `expect(lead.fupEnabled).toBe(false)` — linha 292 |
| 3 | Test suite verifies INSERT without brainType defaults to fup_enabled=false | PLAN-01 | VERIFIED | `it("INSERT sem brainType → fupEnabled=false...")` — linha 295; `expect(selectCallCount).toBe(1)` confirma fup_config não é consultada |
| 4 | Test suite verifies UPDATE never changes fup_enabled (preserves existing value) | PLAN-01 | VERIFIED | `it("UPDATE (lead existente) preserva fupEnabled...")` — linha 332; `expect(callArg.set).not.toHaveProperty("fupEnabled")` — linha 381 |
| 5 | Test suite verifies INSERT with nonexistent fup_config defaults to fup_enabled=false | PLAN-01 | VERIFIED | `it("INSERT com fup_config inexistente → fupEnabled=false, sem erro (D-04 silent fallback)")` — linha 384; fallback silencioso confirmado |
| 6 | upsertLead() accepts optional brainType parameter | PLAN-02 | VERIFIED | Assinatura: `async upsertLead(numero: string, uniqueId: string, nome?: string, brainType?: string)` — lead-service.ts linha 38 |
| 7 | INSERT with fup_config enabled=true sets fup_enabled=true | PLAN-02 | VERIFIED | Lógica: `if (isInsert && brainType)` + `if (configRows[0]?.enabled === true) { fupEnabled = true; }` — linhas 50-60 |
| 8 | BrainRunner.run() passes this.brain.brainType to leadService.upsertLead() | PLAN-03 | VERIFIED | runner.ts linha 253: `this.brain.brainType // ← NOVO: quarto parâmetro` |
| 9 | New leads created via BrainRunner automatically have FUP activated when fup_config exists | PLAN-03 | VERIFIED | Pipeline end-to-end completo; 26/26 testes BrainRunner passam sem regressões |

**Score Total:** 9/9 must-haves verificados

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/leads/__tests__/lead-service.test.ts` | Test cases for FUP activation logic (min 200 linhas) | VERIFIED | 431 linhas; describe block "LeadService — FUP activation (Phase 25)" com 5 cases; 13/13 testes passam |
| `packages/core/src/leads/lead-service.ts` | FUP activation logic in upsertLead() (min 150 linhas, contains "brainType?: string") | VERIFIED | 171 linhas; `brainType?: string` presente na assinatura; lógica completa de ativação implementada |
| `packages/core/src/runner/runner.ts` | brainType injection to upsertLead() (contains "this.brain.brainType") | VERIFIED | `this.brain.brainType` presente na linha 253 como quarto parâmetro; comentário inline documenta a mudança |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lead-service.test.ts` | `LeadService.upsertLead()` | mock assertions on fup_enabled behavior | WIRED | `expect.*fupEnabled` presente em 6 linhas de assertion; `expect(callArg.set).not.toHaveProperty("fupEnabled")` para D-03 |
| `upsertLead()` | `fup_config` table | SELECT query when `isInsert && brainType` | WIRED | `fupConfig.*brainType` em `.where(eq(fupConfig.brainType, brainType))` — lead-service.ts linha 54 |
| `upsertLead() INSERT` | `leads.fupEnabled` | `values({ fupEnabled })` | WIRED | `fupEnabled` em `values({ numero, uniqueId, nome: nome ?? null, fupEnabled })` — lead-service.ts linha 71 |
| `BrainRunner.run()` | `LeadService.upsertLead()` | fourth parameter: `this.brain.brainType` | WIRED | runner.ts linhas 249-254; quatro parâmetros confirmados |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `lead-service.ts` upsertLead() | `fupEnabled` (boolean) | SELECT from `fup_config WHERE brain_type = brainType` + `configRows[0]?.enabled === true` | Sim — Drizzle query real com optional chaining para fallback silencioso | FLOWING |
| `runner.ts` | `this.brain.brainType` | `IBrain.brainType` string field (interface contratual) | Sim — injetado pelo Brain concreto no construtor do BrainRunner | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 5 testes FUP activation passam | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | 13 pass, 0 fail | PASS |
| 26 testes BrainRunner sem regressões | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | 26 pass, 0 fail | PASS |
| `upsertLead` aceita brainType como quarto parâmetro | Inspeção estática da assinatura | `brainType?: string` presente | PASS |
| UPDATE não altera fup_enabled | `onConflictDoUpdate.set` sem `fupEnabled` | Somente `nome` e `updatedAt` no set | PASS |

---

## Requirements Coverage

| Requirement | Definição | Status | Evidência |
|-------------|-----------|--------|-----------|
| FUP-01 | Configuração de FUP armazenada em tabela `fup_config` no banco | SATISFIED (extensão) | Phase 25 **consome** `fup_config` via SELECT em `upsertLead()`; a tabela foi criada na Phase 22 (completa). Phase 25 estende o uso sem duplicar a implementação core |
| FUP-02 | Scheduler background detecta leads silenciosos (last_message_at + limiar) | SATISFIED (extensão) | Phase 25 garante que `fup_enabled=true` é setado automaticamente na criação do lead — pré-requisito para o scheduler funcionar sem intervenção manual. Scheduler implementado na Phase 22 |

**Nota sobre FUP-01/FUP-02 no REQUIREMENTS.md:** A tabela de traceability mapeia FUP-01 e FUP-02 para a Phase 22 (completa). Os planos da Phase 25 declaram esses IDs como "extensão" — isso é correto: Phase 25 não reimplementa FUP-01/FUP-02, mas os estende com a lógica de ativação automática. Não há requisito órfão — o mapeamento na tabela de traceability refere-se à implementação base, e Phase 25 é o gap-closure explicitado no ROADMAP como "Fecha integration gap 'fup_enabled sem trigger automático'".

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | Nenhum anti-padrão identificado | — | — |

Arquivos escaneados: `lead-service.ts`, `lead-service.test.ts`, `runner.ts`. Nenhum TODO/FIXME/HACK, nenhum `return null` sem tratamento, nenhum dado hardcoded vazio que flua para rendering.

**Falhas pré-existentes no full suite (não causadas pela Phase 25):**
- 2 timeouts em `brain-runner.integration.test.ts` — testes de integração que requerem banco PostgreSQL real; existem desde a Phase 8 (último commit no arquivo: Phase 8, `4452bd5`)
- 2 falhas de mock interference em `lead-service-fup.test.ts` quando rodados em conjunto com outros arquivos — passam 3/3 quando rodados isoladamente; falha de isolamento de mocks pré-existente da Phase 22; não foi introduzida pela Phase 25 (commits da Phase 25 não tocaram esses arquivos)

---

## Human Verification Required

Nenhum item requer verificação humana. Todos os critérios de sucesso são verificáveis programaticamente e foram verificados.

---

## Gaps Summary

Nenhum gap identificado. Todos os 9 must-haves e 3 success criteria do ROADMAP foram verificados com evidência direta no código.

---

_Verified: 2026-06-25T01:50:00Z_
_Verifier: Claude (gsd-verifier)_
