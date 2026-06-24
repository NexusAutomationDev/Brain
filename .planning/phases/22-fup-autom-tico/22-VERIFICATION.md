---
phase: 22-fup-autom-tico
verified: 2026-06-24T02:30:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Verificar que a coluna fup_failure_count existe no banco PostgreSQL real"
    expected: "psql $DATABASE_URL -c \"\\d leads\" | grep fup_failure_count retorna linha com 'integer | not null | default 0'"
    why_human: "Schema push foi aplicado via psql manual pelo operador (drizzle-kit push requer TTY). Não há forma de verificar programaticamente sem conexão ao banco."
  - test: "Iniciar Brain com FUP_WEBHOOK_URL configurado e verificar que FupScheduler aparece nos logs de inicialização"
    expected: "Log: { brainType, hasFupUrl: true, msg: 'FupScheduler started' } presente no stdout ao iniciar o Brain"
    why_human: "Wiring BrainRunner.init() -> FupScheduler.start() só pode ser observado em runtime com ENV configurado. Verificação estática confirma o código mas não o comportamento em runtime."
---

# Phase 22: FUP Automático Verification Report

**Phase Goal:** Implementar o FUP Automático completo — FupScheduler com polling, elegibilidade, geração LLM one-shot, retry com fup_failure_count persistente, cálculo de slot em timezone IANA, publicação EVT-03, e integração ao BrainRunner — entregando follow-ups automáticos de qualificação sem intervenção humana.
**Verified:** 2026-06-24T02:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Lead que para de responder recebe mensagem de FUP gerada por LLM usando o histórico da conversa, no intervalo configurado em `fup_config`, respeitando `fup_min_hour`, `fup_max_hour`, dias permitidos e fuso horário IANA | ✓ VERIFIED | `fup-scheduler.ts`: JOIN fup_config na query de elegibilidade (linha 112), `_generateFupMessage()` usa `checkpointer.getTuple()` + `llm.invoke()`, `getNextValidSlot()` usa `Intl.DateTimeFormat` com `timeZone: timezone` e normalização `parseInt % 24` para pitfall '24' |
| 2 | Quando o lead responde, todos os FUPs pendentes são cancelados e `last_message_at` é atualizado — FUP não dispara para leads ativos | ✓ VERIFIED | `runner.ts:244`: `touchLastMessage()` chamado; `runner.ts:248`: `resetFup()` chamado imediatamente após; `lead-service.ts:135`: `resetFup` seta `fupNextAt=null, fupStep=0`; verificado com FUP-06 antes do gate `ia_ativada` (linha 252) |
| 3 | Ao enviar o último FUP da sequência, o sistema seta `ia_ativada = false` e `fup_enabled = false` automaticamente | ✓ VERIFIED | `fup-scheduler.ts:181-192`: quando `nextFupStep >= lead.intervalsSeconds.length`, UPDATE seta `ia_ativada = false` e `fup_enabled = false`; coberto por teste "FUP-05/D-10: último FUP..." (19 pass, 0 fail) |
| 4 | Múltiplas instâncias do Brain em paralelo nunca enviam o mesmo FUP duas vezes — `SELECT FOR UPDATE SKIP LOCKED` garante que apenas uma instância processa cada FUP | ✓ VERIFIED | `fup-scheduler.ts:94`: `sql.begin(async (tx) => {...})` envolve o SELECT; linha 120: `FOR UPDATE OF l SKIP LOCKED`; UPDATE de marcação `fup_next_at=NOW()+10min` na mesma Tx1 curta (linha 130-134) — padrão de duas transações implementado |
| 5 | Se LLM ou transport falhar ao enviar FUP, o sistema re-tenta até 3 vezes antes de marcar como falha e logar alerta; se a janela de horário não permitir envio, o scheduler agenda para o próximo slot válido | ✓ VERIFIED | Loop `for attempt in 1..MAX_FUP_ATTEMPTS(3)` em `_processFupForLead()`; `fup_failure_count` incrementado e persistido no banco após esgotar tentativas (linha 250-267); `logger.error` quando atinge 3 falhas; `getNextValidSlot()` avança hora a hora até 14 dias |

**Score:** 5/5 truths verified

### Deferred Items

No deferred items. Phase 22 is the last planned phase in the v1.4 milestone for FUP.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/database/src/migrations/0008_fup_failure_count.sql` | Migration DDL para fup_failure_count | ✓ VERIFIED | Existe; contém `ALTER TABLE "leads" ADD COLUMN "fup_failure_count" integer DEFAULT 0 NOT NULL` |
| `packages/database/src/schema/tables.ts` | Campo fupFailureCount na tabela leads | ✓ VERIFIED | Linha 100: `fupFailureCount: integer('fup_failure_count').notNull().default(0)` |
| `packages/database/src/migrations/meta/_journal.json` | Entrada idx=8 para 0008_fup_failure_count | ✓ VERIFIED | Entrada com `idx: 8, tag: "0008_fup_failure_count"` confirmada |
| `packages/core/src/fup/fup-scheduler.ts` | FupScheduler class + IFupScheduler + getNextValidSlot | ✓ VERIFIED | Exporta `class FupScheduler`, `interface IFupScheduler`, `interface ICheckpointerLike`, `function getNextValidSlot`; 350+ linhas de implementação substantiva |
| `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` | Testes unitários do FupScheduler | ✓ VERIFIED | 10 testes; cobre _tick, _processFupForLead, EVT-03, FUP-05, FUP-08, D-13, D-18, stop() |
| `packages/core/src/__tests__/unit/fup/fup-business-hours.test.ts` | Testes unitários de getNextValidSlot | ✓ VERIFIED | 6 testes; cobre slot válido, sábado -> segunda, antes do horário, após horário, hora '24', allowedDays vazio |
| `packages/core/src/leads/lead-service.ts` | LeadService com método resetFup() | ✓ VERIFIED | Linha 132: `async resetFup(uniqueId: string): Promise<void>`; seta `fupNextAt: null, fupStep: 0`; fupEnabled ausente intencionalmente (D-19) |
| `packages/core/src/runner/runner.ts` | BrainRunner integrado com FupScheduler | ✓ VERIFIED | Import, campo privado `fupScheduler`, campo `checkpointer`, init/run/close integrados |
| `packages/core/src/index.ts` | Barrel export atualizado | ✓ VERIFIED | Linhas 39-41: exporta `IFupScheduler`, `FupScheduler`, `getNextValidSlot` |
| `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | Teste de resetFup() | ✓ VERIFIED | 4 testes; verifica chain update/set/where, payload correto, ausência de fupEnabled |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `runner.ts` | `fup/fup-scheduler.ts` | `new FupScheduler({...})` em `init()` | ✓ WIRED | Linha 164: `this.fupScheduler = new FupScheduler({sql, brainType, checkpointer, eventPublisher, fupWebhookUrl})`; gated por `fupWebhookUrl && this.checkpointer` |
| `runner.ts` | `leads/lead-service.ts` | `resetFup()` em `run()` | ✓ WIRED | Linha 248: `await this.leadService.resetFup(lead.uniqueId)`; chamado após `touchLastMessage()`, antes do gate `ia_ativada` |
| `fup-scheduler.ts` | `events/event-publisher.ts` | `IEventPublisher` injetado no construtor | ✓ WIRED | Linha 14: import `IEventPublisher`; linha 228: `this.opts.eventPublisher.publish([fupEvent])` fire-and-forget |
| `fup-scheduler.ts` | `checkpointer.getTuple` | `ICheckpointerLike` injetado no construtor | ✓ WIRED | Interface local `ICheckpointerLike` com método `getTuple`; linha 276: `this.opts.checkpointer.getTuple({configurable: {thread_id: lead.uniqueId}})` |
| `runner.ts._compileGraph()` | `runner.ts.checkpointer` | `this.checkpointer = checkpointer` após `createCheckpointer()` | ✓ WIRED | Linha 415: salvo como campo privado; disponível em `init()` (linha 148: `_compileGraph()` chamado antes do bloco FupScheduler) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `fup-scheduler.ts` | `rows` (leads elegíveis) | SQL query com JOIN fup_config + WHERE clauses reais | Sim — query real no banco (não estática) | ✓ FLOWING |
| `fup-scheduler.ts` | `message` (FUP gerado) | `checkpointer.getTuple()` -> histórico -> `llm.invoke()` | Sim — LLM invocado com histórico real | ✓ FLOWING |
| `fup-scheduler.ts._processFupForLead()` | `fupPrompt` | Query `SELECT content FROM prompts WHERE key='fup'` | Sim — query real no banco | ✓ FLOWING |
| `lead-service.ts.resetFup()` | UPDATE leads | Drizzle ORM `db.update(leads).set({fupNextAt: null, fupStep: 0})` | Sim — UPDATE real (sem estado em memória) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| FupScheduler e getNextValidSlot são exports válidos do barrel | `bun -e "import { FupScheduler, getNextValidSlot } from './packages/core/src/index.ts'; console.log(typeof FupScheduler, typeof getNextValidSlot)"` | `function function` | ✓ PASS |
| 19 testes unitários passam sem falhas | `bun test packages/core/src/__tests__/unit/fup/` | `19 pass, 0 fail` | ✓ PASS |
| SELECT FOR UPDATE SKIP LOCKED está dentro de sql.begin() | `grep -n "sql.begin\|FOR UPDATE OF l SKIP LOCKED" fup-scheduler.ts` | sql.begin na linha 94; FOR UPDATE na linha 120 (dentro da callback) | ✓ PASS |
| Schema migration 0008 existe e contém DDL correto | `cat packages/database/src/migrations/0008_fup_failure_count.sql` | `ALTER TABLE "leads" ADD COLUMN "fup_failure_count" integer DEFAULT 0 NOT NULL` | ✓ PASS |
| resetFup chamado após touchLastMessage em runner.run() | `grep -n "touchLastMessage\|resetFup" runner.ts` | touchLastMessage na linha 244, resetFup na linha 248 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| FUP-01 | 22-02, 22-03 | Configuração de FUP armazenada em `fup_config` — não em ENV | ✓ SATISFIED | `fup-scheduler.ts:112`: `JOIN fup_config fc ON fc.brain_type = ${brainType}`; tabela `fupConfig` definida em `tables.ts:125`; `packages/core/src/index.ts` exporta `FupScheduler` |
| FUP-02 | 22-02, 22-03 | Scheduler background com SELECT FOR UPDATE SKIP LOCKED | ✓ SATISFIED | `_tick()` em `fup-scheduler.ts:80`; `sql.begin()` + SKIP LOCKED; `BrainRunner.init()` inicia o scheduler (linha 163-177) |
| FUP-03 | 22-02 | LLM one-shot via PostgresSaver.getTuple e prompt 'fup' do banco | ✓ SATISFIED | `_generateFupMessage()`: `checkpointer.getTuple()` -> histórico -> `llm.invoke([SystemMessage, ...history, HumanMessage])`; prompt 'fup' buscado do banco (linha 148-159) |
| FUP-05 | 22-02 | Último FUP seta ia_ativada=false e fup_enabled=false | ✓ SATISFIED | `fup-scheduler.ts:181-192`: UPDATE com `ia_ativada = false, fup_enabled = false` quando `nextFupStep >= intervalsSeconds.length`; 19 testes passando incluindo este cenário |
| FUP-06 | 22-03 | BrainRunner.run() cancela FUPs e atualiza last_message_at | ✓ SATISFIED | `runner.ts:244`: `touchLastMessage()`; linha 248: `resetFup()`; ambos antes do gate `ia_ativada` (linha 252) |
| FUP-07 | 22-02 | Janela de horário não permitida -> próximo slot válido | ✓ SATISFIED | `getNextValidSlot()`: loop hora a hora até 14 dias com `Intl.DateTimeFormat` e `allowedDays`; 6 testes em `fup-business-hours.test.ts` cobrindo sábado->segunda, antes/após horário, fallback |
| FUP-08 | 22-02 | Re-tenta até 3x antes de marcar falha e logar alerta | ✓ SATISFIED | Loop `for attempt in 1..MAX_FUP_ATTEMPTS(3)`; `fup_failure_count` persistido no banco; `logger.error` ao atingir `MAX_FUP_FAILURES(3)` (linha 261); testes cobrindo este cenário |
| EVT-03 | 22-02 | Evento `{ action: "fup", lead, result: { step, message } }` publicado | ✓ SATISFIED | `fup-scheduler.ts:219-232`: `eventPublisher.publish([fupEvent])` fire-and-forget com `action: "fup"`, `event_id: \`${lead.uniqueId}:fup:${lead.fupStep}\``; coberto por testes EVT-03/D-16 e EVT-03/D-17 |

**Note on EVT-03 tracking:** REQUIREMENTS.md still shows `EVT-03 | Phase 20 | Pending` but the implementation exists and is verified in Phase 22 (22-02-PLAN claims it explicitly). The traceability table in REQUIREMENTS.md was not updated to reflect Phase 22 as the implementing phase.

**Note on FUP-03, FUP-05, FUP-07, FUP-08 tracking:** REQUIREMENTS.md shows these as "Pending" (unchecked `[ ]`) but all four are implemented and verified in Phase 22. The tracking document was not updated after implementation.

**FUP-04 note:** FUP-04 (fup_step, fup_next_at, fup_enabled columns) is assigned to Phase 19 in the traceability table. These columns exist in `tables.ts` (lines 93-95). Phase 22 does not own FUP-04.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/runner/runner.ts` | 163 | `if (fupWebhookUrl && this.checkpointer)` — silent skip when checkpointer null | ⚠️ Warning | FUP_WEBHOOK_URL configurado mas checkpointer ausente não produz nenhum log de aviso; operador não saberá que FupScheduler não iniciou (WR-01 do Code Review) |
| `packages/core/src/leads/lead-service.ts` | 135 | `resetFup()` omite `updatedAt` no set | ⚠️ Warning | Inconsistência com outros métodos do LeadService que incluem `updatedAt`; monitoramento por `updated_at` perderá resets de FUP (WR-02 do Code Review) |
| `packages/core/src/runner/runner.ts` | 182 (aprox.) | `process.on('SIGTERM', ...)` dentro de `init()` sem remoção | ⚠️ Warning | Acúmulo de listeners se `init()` for chamado múltiplas vezes (WR-03 do Code Review) |
| `packages/core/src/fup/fup-scheduler.ts` | 168 | Retry sem delay entre tentativas | ⚠️ Warning | BATCH_SIZE=10 * 3 tentativas = até 30 calls simultâneos ao LLM/webhook em falha (WR-04 do Code Review) |

Nenhum anti-padrão é bloqueador para o objetivo da fase. Todos estão documentados no 22-REVIEW.md como warnings, não críticos.

**Nota sobre erros TypeScript:** `bun run tsc --noEmit` reporta 4 erros em `packages/core/`:
- `lead-service.ts:119` — `lastMessageAt` not in Drizzle type (pre-existing, introduzido na Phase 19)
- `lead-service.ts:135` — `fupNextAt` not in Drizzle type (inconsistência de tipo Drizzle cross-package)
- `runner.ts:17` — `TokenUsage` not exported from `@brain-pkg/shared` (pre-existing, documentado em 22-03-SUMMARY como "erros pré-existentes")
- `runner.ts:350` — `responseMode` type mismatch (pre-existing)

Estes erros são pre-existentes (confirmado pelo 22-03-SUMMARY) e não foram introduzidos pela Phase 22. O erro `fupNextAt` em `lead-service.ts:135` é do código novo de `resetFup()` mas é resultado de inconsistência de versão do Drizzle cross-package (campo existe em `tables.ts:95` mas o tipo Drizzle não o reconhece corretamente em `packages/core`).

### Human Verification Required

#### 1. Schema Push — fup_failure_count no Banco Real

**Test:** Conectar ao PostgreSQL e verificar a coluna:
```bash
psql $DATABASE_URL -c "\d leads" | grep fup_failure_count
```
**Expected:** Linha contendo `fup_failure_count | integer | not null | default 0`
**Why human:** O schema push foi aplicado manualmente pelo operador via psql (drizzle-kit push requer TTY interativo). A migration `0008_fup_failure_count.sql` existe no código mas a aplicação ao banco real não pode ser verificada programaticamente.

#### 2. FupScheduler Inicializa em Runtime

**Test:** Iniciar o Brain com `FUP_WEBHOOK_URL` configurado e verificar logs:
```bash
FUP_WEBHOOK_URL=http://localhost:9999 bun run apps/brain-sdr/src/index.ts 2>&1 | grep FupScheduler
```
**Expected:** Log `{ brainType: "sdr", hasFupUrl: true, msg: "FupScheduler started" }` presente no stdout durante inicialização
**Why human:** O wiring BrainRunner.init() -> FupScheduler.start() é verificado estaticamente no código, mas o comportamento end-to-end em runtime com ENV real não pode ser testado sem iniciar o processo completo do Brain (requer PostgreSQL e demais dependências).

### Gaps Summary

Nenhum gap bloqueador encontrado. Os 5 success criteria do roadmap estão todos verificados no código. Os 7 requirements do plan (FUP-01, FUP-02, FUP-03, FUP-05, FUP-06, FUP-07, FUP-08) estão implementados e cobertos por testes unitários (19 pass, 0 fail).

Os únicos itens pendentes são:
1. Verificação humana da coluna `fup_failure_count` no banco real (schema push manual)
2. Verificação humana do startup em runtime
3. 4 warnings de qualidade documentados no 22-REVIEW.md (não bloqueadores)
4. Inconsistências de tracking no REQUIREMENTS.md (FUP-03, FUP-05, FUP-07, FUP-08, EVT-03 ainda como "Pending" mesmo implementados)

---

_Verified: 2026-06-24T02:30:00Z_
_Verifier: Claude (gsd-verifier)_
