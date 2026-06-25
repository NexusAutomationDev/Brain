---
phase: 26-fup-next-at-init-fix
verified: 2026-06-25T04:10:00Z
status: human_needed
score: 5/6
overrides_applied: 0
gaps: []
human_verification:
  - test: "Flow FUP Activation E2E: criar novo lead com fup_config ativa, aguardar um intervalo, verificar que o FupScheduler processa o lead e envia o FUP"
    expected: "Lead recém-criado com fup_enabled=true e fupNextAt preenchido é selecionado pelo tick do FupScheduler após fup_next_at <= NOW(), LLM gera mensagem, evento EVT-03 publicado"
    why_human: "Requer banco PostgreSQL real com fup_config populada e FupScheduler rodando — não testável com grep ou bun test unitário"
---

# Phase 26: FUP Next-At Init Fix — Verification Report

**Phase Goal:** Fechar o gap bloqueador FUP-02: leads criados com fup_enabled=true têm fup_next_at=NULL, e a cláusula fup_next_at <= NOW() do FupScheduler nunca avalia NULL como verdadeiro no PostgreSQL — portanto esses leads jamais são processados pelo scheduler.
**Verified:** 2026-06-25T04:10:00Z
**Status:** human_needed
**Re-verification:** Não — verificação inicial

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | upsertLead() em INSERT com fupEnabled=true persiste fupNextAt como Date concreto (não null) | VERIFIED | lead-service.ts linhas 73-83: guard `config.intervalsSeconds.length > 0`, cálculo `new Date(Date.now() + config.intervalsSeconds[0]! * 1000)` e chamada a `getNextValidSlot()` atribuída a `fupNextAt`. Linha 94: `fupNextAt` incluso em `values()`. Teste FUP-02/Phase26 Test 1 passa confirmando `instanceof Date` |
| 2 | upsertLead() em INSERT com fupEnabled=false mantém fupNextAt como null | VERIFIED | lead-service.ts linha 53: `let fupNextAt: Date | null = null` como default. Sem fup_config ou `enabled=false`, o bloco do if não executa. Testes FUP-02/Phase26 Tests 2 e 3 passam verificando `fupNextAt === null` |
| 3 | upsertLead() em UPDATE nunca altera fupNextAt (campo ausente do set{}) | VERIFIED | lead-service.ts linhas 96-105: `onConflictDoUpdate.set{}` contém apenas `nome` e `updatedAt` — `fupNextAt` intencionalmente ausente (comentado como "INSERT-only; UPDATE nunca altera"). Teste FUP-02/Phase26 Test 4 confirma `valuesArg.fupNextAt === null` no UPDATE path |
| 4 | FupScheduler._tick() processa lead recém-criado no próximo poll após fup_next_at <= NOW() | VERIFIED | fup-scheduler.ts linha 115: `AND l.fup_next_at <= NOW()` presente e inalterado. Com fupNextAt agora populado no INSERT, a condição será satisfeita após o intervalo configurado. Não há gap de implementação no scheduler — o gap era ausência de fupNextAt no INSERT (agora corrigido) |
| 5 | EVT-04 em REQUIREMENTS.md documenta exceção de formato de event_id para FUP events | VERIFIED | REQUIREMENTS.md linha 22: `**Exceção FUP:** eventos de FUP usam event_id = ${lead.uniqueId}:fup:${fup_step} — FUP events não têm tool_call_id (D-17 da Phase 22, decisão intencional).` O conteúdo semântico está correto — o padrão literal `uniqueId:fup:step` do PLAN era uma simplificação; o texto real usa notação de template string |
| 6 | Flow FUP Activation E2E completo: novo lead → fupEnabled=true, fupNextAt setado → scheduler processa → FUP enviado | UNCERTAIN — human needed | Verificável apenas com banco real e FupScheduler rodando. Partes individuais verificadas (INSERT popula fupNextAt, scheduler tem cláusula correta), mas integração end-to-end requer ambiente de integração |

**Score:** 5/6 truths verified (1 requer human verification)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | Testes do novo comportamento fupNextAt no INSERT | VERIFIED | 7 testes passando: 3 de resetFup() + 4 novos de upsertLead(). Contém `makeUpsertDbMock` com selectCallCount. `bun test` confirma `7 pass, 0 fail` |
| `packages/core/src/leads/lead-service.ts` | upsertLead() com cálculo e persistência de fupNextAt | VERIFIED | Import de `getNextValidSlot` na linha 8. Cálculo na linha 76. `fupNextAt` em `values()` na linha 94. Ausente de `set{}` na linha 101 |
| `packages/core/src/fup/fup-scheduler.ts` | Code comment EVT-04 divergência | VERIFIED | Linha 223: `// D-17: formato diverge intencionalmente de EVT-04 (thread_id:tool_call_id).` com 3 linhas de comentário expandido |
| `.planning/REQUIREMENTS.md` | EVT-04 com nota de exceção FUP events | VERIFIED | Linha 22 contém a nota de exceção com `${lead.uniqueId}:fup:${fup_step}`. O gsd-tools reportou falso positivo buscando literal `uniqueId:fup:step` — o texto real usa notação de template string, semanticamente equivalente |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/core/src/leads/lead-service.ts` | `packages/core/src/fup/fup-scheduler.ts` | `import { getNextValidSlot }` | VERIFIED | gsd-tools: "Pattern found in source". Linha 8 de lead-service.ts confirma |
| `packages/core/src/leads/lead-service.ts` | `leads.fupNextAt` | `INSERT values({ fupNextAt })` | VERIFIED | gsd-tools: "Pattern found in source". Linha 94 de lead-service.ts confirma |
| `FupScheduler._tick()` | `leads.fupNextAt` | `WHERE fup_next_at <= NOW()` | VERIFIED (manual) | gsd-tools retornou "Source file not found" porque buscou arquivo literal "FupScheduler._tick()" — falso negativo do tool. Verificação manual: `fup-scheduler.ts` linha 115 confirma `AND l.fup_next_at <= NOW()` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `lead-service.ts → upsertLead()` | `fupNextAt` | `getNextValidSlot(new Date(Date.now() + config.intervalsSeconds[0]! * 1000), ...)` | Sim — Date calculado dinamicamente a partir de `Date.now()` + config do banco | FLOWING |
| `fup-scheduler.ts → _tick()` | leads com `fup_next_at <= NOW()` | Query SQL com `SELECT FOR UPDATE SKIP LOCKED` | Sim — dados reais do banco PostgreSQL | FLOWING (pré-existente, não alterado) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 4 novos testes upsertLead() fupNextAt passam | `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | `7 pass, 0 fail` | PASS |
| 3 testes resetFup() sem regressão | (incluídos no mesmo comando acima) | `7 pass, 0 fail` | PASS |
| Suite FUP completa sem regressão | `bun test packages/core/src/__tests__/unit/fup/` | `24 pass, 0 fail` | PASS |
| Suite lead-service.test.ts (Phase 25) sem regressão | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | `13 pass, 0 fail` | PASS |
| Sem importação circular fup-scheduler → lead-service | `grep -rn "import.*lead-service" fup-scheduler.ts` | sem output | PASS |
| comment EVT-04 expandido em fup-scheduler.ts | `grep -n "diverge intencionalmente de EVT-04" fup-scheduler.ts` | linha 223 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Descrição | Status | Evidence |
|-------------|------------|-----------|--------|---------|
| FUP-02 | 26-01-PLAN.md | Scheduler background detecta leads silenciosos e processa FUPs com SELECT FOR UPDATE SKIP LOCKED | PARTIAL | Phase 26 fecha o gap específico de `fup_next_at=NULL` no INSERT — tornando leads elegíveis para o scheduler. O scheduler em si (SELECT FOR UPDATE SKIP LOCKED) foi implementado em fases anteriores. FUP-02 em REQUIREMENTS.md permanece `[ ]` e status `Pending` — o SUMMARY documenta isso como intencional (reset para rastrear que Phase 26 é gap closure parcial). **Nota:** FUP-02 como escrito descreve o scheduler completo, que está implementado. O gap que Phase 26 fecha (fupNextAt no INSERT) é o elo faltante que tornava o scheduler não-funcional para leads novos |

**Nota sobre FUP-02 em REQUIREMENTS.md:** O checkbox `[ ]` permanece aberto e o status da tabela está `Pending`. O SUMMARY (linha 99 do REQUIREMENTS.md) documenta: `"Phase 26 gap closure: FUP-02 reset [ ], traceability Phase 22→26 Pending"` — indicando que a decisão de manter o requirement aberto foi intencional. Recomenda-se marcar FUP-02 como `[x]` se o entendimento é que o scheduler estava funcional antes e Phase 26 completou o último gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| Nenhum encontrado | — | — | — | — |

Verificação manual de stubs e placeholders:
- `lead-service.ts`: sem `TODO`, `FIXME`, `return null` estranhos; implementação substantiva
- `lead-service-fup.test.ts`: sem stubs; testes verificam comportamento real com assertions sobre `instanceof Date`
- `fup-scheduler.ts`: code comment expandido; sem novos stubs introduzidos

### Human Verification Required

#### 1. Flow FUP Activation E2E

**Teste:** Com banco PostgreSQL real e fup_config populada (`enabled=true, intervals_seconds=[3600], ...`):
1. Criar novo lead via `BrainRunner.run()` com evento de primeira mensagem
2. Verificar que `leads.fup_next_at` foi preenchido com Date ~1 hora à frente (ajustado para business hours)
3. Aguardar o intervalo ou atualizar manualmente `fup_next_at` para NOW() - 1 second
4. Verificar que o próximo tick do FupScheduler seleciona o lead e envia o FUP
5. Verificar publicação de evento EVT-03 no canal configurado

**Expected:** Lead recém-criado com `fup_enabled=true` e `fup_next_at` preenchido é processado pelo FupScheduler no próximo tick após `fup_next_at <= NOW()`, gerando e enviando a mensagem FUP.

**Why human:** Requer banco PostgreSQL real com pgvector, fup_config populada, FupScheduler rodando em background, e canal de eventos configurado — não testável programaticamente com testes unitários.

---

### Gaps Summary

Nenhum gap bloqueador identificado. O objetivo principal da fase — corrigir `fup_next_at=NULL` no INSERT de leads com FUP ativo — foi alcançado com implementação substantiva e testes unitários cobrindo 4 cenários. Um item (SC-3 do ROADMAP: flow E2E) requer verificação humana em ambiente de integração.

**Nota de rastreabilidade:** FUP-02 em REQUIREMENTS.md permanece com `[ ]` e status `Pending`. Se o entendimento do time é que o scheduler estava funcional antes e Phase 26 completou o último gap bloqueador, recomenda-se atualizar REQUIREMENTS.md marcando FUP-02 como `[x]` e `Complete`.

---

_Verified: 2026-06-25T04:10:00Z_
_Verifier: Claude (gsd-verifier)_
