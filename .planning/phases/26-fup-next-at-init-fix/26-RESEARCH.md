# Phase 26: FUP Next-At Init Fix - Research

**Researched:** 2026-06-25
**Domain:** LeadService upsertLead — cálculo e persistência de fupNextAt no INSERT; integração FupScheduler eligibility; atualização de spec EVT-04
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Base do Clock do FUP**
- **D-01:** `fupNextAt` é calculado no INSERT de `upsertLead()` — `fupNextAt = NOW() + intervals_seconds[0]`, ajustado para próximo slot dentro de business hours (`min_hour`, `max_hour`, `allowed_days`, `timezone` da `fup_config`).
- **D-02:** No fluxo normal do BrainRunner, `upsertLead()` é chamado quando o lead envia a primeira mensagem — portanto INSERT time ≈ tempo da primeira mensagem. Isso satisfaz o requisito de "FUP é apenas quando o lead para de responder ao LLM".
- **D-03:** O FUP clock parte do INSERT, não de `last_message_at`. A semântica é: lead criado pelo BrainRunner na chegada da primeira mensagem → `fupNextAt = now + interval[0]` → se não responder no intervalo, o scheduler processa.
- **D-04:** Query em `upsertLead()` para `fup_config` precisa ser expandida: hoje busca apenas `enabled`, deve passar a buscar também `intervals_seconds`, `min_hour`, `max_hour`, `allowed_days`, `timezone` para calcular o slot correto.

**Compartilhamento de Lógica de Business Hours**
- **D-05 (Claude's Discretion):** A lógica de business hours (calcular próximo slot válido) existe no `FupScheduler`. Pode ser extraída para `packages/core/src/fup/scheduling-utils.ts` e reutilizada por ambos, OU duplicada inline em `upsertLead()`.

**EVT-04 — Documentação da Divergência**
- **D-06:** REQUIREMENTS.md deve ser atualizado: EVT-04 descreve `event_id = thread_id:tool_call_id` para tool events, mas FUP events usam `event_id = uniqueId:fup:step` (decisão D-17 da Phase 22). A divergência é intencional — FUP não tem `tool_call_id`. Atualizar EVT-04 para incluir essa exceção explicitamente.
- **D-07:** Verificar o code comment em `fup-scheduler.ts` onde `event_id` é construído — garantir que já documenta `uniqueId:fup:step` e o motivo da divergência. Se incompleto, completar.

### Claude's Discretion

- Estratégia de extração vs. duplicação da lógica de business hours (D-05)
- Estratégia interna de query em `upsertLead()` (uma query expandida vs. duas queries separadas)
- Estrutura dos testes de unidade para o novo comportamento de `fupNextAt` no INSERT

### Deferred Ideas (OUT OF SCOPE)

- Reinicialização de `fupNextAt` após `resetFup()` — `touchLastMessage()` poderia calcular `fupNextAt` nesse caso, mas está fora do escopo desta fase
- FUP proativo para leads criados sem mensagem inicial (bulk import, CRM sync) — comportamento diferente da semântica atual; futura feature separada

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FUP-02 | Scheduler background detecta leads silenciosos e processa FUPs usando SELECT FOR UPDATE SKIP LOCKED | O gap é: `_tick()` exige `fup_next_at <= NOW()` mas leads criados em Phase 25 têm `fup_next_at = NULL`. Fix: upsertLead() deve persistir `fupNextAt = getNextValidSlot(NOW() + intervals_seconds[0], ...)` no INSERT quando `fupEnabled=true` |

</phase_requirements>

---

## Summary

Phase 26 fecha um gap de integração preciso e cirúrgico: Phase 25 ativou `fup_enabled = true` no INSERT de leads novos, mas deixou `fup_next_at = NULL`. O `FupScheduler._tick()` tem uma WHERE clause `AND l.fup_next_at <= NOW()` — NULL nunca satisfaz essa condição no PostgreSQL, portanto leads criados com FUP ativado jamais são processados pelo scheduler.

A correção requer três mudanças:

1. **`upsertLead()`** — expandir a query de `fup_config` para buscar todos os campos de business hours (`intervals_seconds`, `min_hour`, `max_hour`, `allowed_days`, `timezone`) além de `enabled`, calcular `fupNextAt = getNextValidSlot(NOW() + intervals_seconds[0], ...)` e persistir no `values()` do INSERT (ausente do `set{}` do UPDATE).

2. **Extração de `getNextValidSlot()`** — a função já existe e está exportada em `fup-scheduler.ts`. A decisão de extração vs. import direto é do escopo do planner (D-05).

3. **EVT-04 em REQUIREMENTS.md** — adicionar nota de exceção para FUP events que usam `uniqueId:fup:step` em vez de `thread_id:tool_call_id`.

**Descoberta crítica:** Phase 25 D-06 afirmou "FupScheduler exige `last_message_at IS NOT NULL`" — mas ao auditar o código atual de `fup-scheduler.ts` (linhas 113-118), essa condição NÃO existe na WHERE clause. O scheduler filtra por `fup_enabled`, `ia_ativada`, `fup_next_at <= NOW()`, `fup_step`, `fc.enabled` e `fup_failure_count`. Uma vez que `fupNextAt` seja persistido no INSERT, o scheduler processará o lead no primeiro tick após o intervalo — sem barreira de `last_message_at`.

**Primary recommendation:** Expandir a query de `fup_config` em `upsertLead()` para uma única SELECT com todos os campos necessários; importar `getNextValidSlot` de `fup-scheduler.ts` diretamente (sem extração prematura); persistir `fupNextAt` no INSERT conditionally (apenas quando `fupEnabled = true`).

---

## Standard Stack

### Core (já disponível — sem instalação necessária)

| Library | Versão | Propósito | Por que usar |
|---------|--------|-----------|--------------|
| `drizzle-orm` | 0.45.x | SELECT expandido de `fup_config` | Já usado em LeadService; `eq()`, `select()` padrões estabelecidos |
| `postgres` (postgres.js) | instalada | Driver SQL executor | Já injetado no LeadService via construtor |
| `getNextValidSlot` | — (função interna) | Cálculo de próximo slot com business hours | Já implementada e testada em `fup-scheduler.ts`, linha 355-388; exportada |

**Não é necessária nenhuma instalação de pacote.** [VERIFIED: grep no codebase]

---

## Architecture Patterns

### Anatomia do Gap (diagnóstico preciso)

```
Phase 25 INSERT result:
  fup_enabled = true   ✓
  fup_next_at = NULL   ✗  ← GAP

FupScheduler._tick() WHERE (linha 115):
  AND l.fup_next_at <= NOW()   ← NULL nunca satisfaz → lead nunca processado
```

**Fix aplicado em Phase 26:**

```
Phase 26 INSERT result:
  fup_enabled = true                          ✓
  fup_next_at = getNextValidSlot(NOW() + intervals_seconds[0], ...)   ✓
```

### Padrão de Modificação de `upsertLead()` — Step by Step

O método atual tem 3 etapas:

```
Step 1: SELECT existing (detecta INSERT vs UPDATE)
Step 2: SELECT fup_config — HOJE busca apenas { enabled }
Step 3: INSERT.onConflictDoUpdate — fupEnabled no values(), ausente do set{}
```

**Phase 26 modifica Step 2 e Step 3:**

```typescript
// Step 2 EXPANDIDO: buscar todos os campos de business hours
// [VERIFIED: campo fupConfig.intervalsSeconds, minHour, maxHour, allowedDays, timezone
//  existem no schema tables.ts linhas 131-138]
if (isInsert && brainType) {
  const configRows = await this.db
    .select({
      enabled: fupConfig.enabled,
      intervalsSeconds: fupConfig.intervalsSeconds,
      minHour: fupConfig.minHour,
      maxHour: fupConfig.maxHour,
      allowedDays: fupConfig.allowedDays,
      timezone: fupConfig.timezone,
    })
    .from(fupConfig)
    .where(eq(fupConfig.brainType, brainType))
    .limit(1);

  if (configRows[0]?.enabled === true) {
    fupEnabled = true;
    // D-01: calcular fupNextAt = NOW() + intervals_seconds[0], ajustado para business hours
    const rawNextAt = new Date(Date.now() + (configRows[0].intervalsSeconds[0] ?? 0) * 1000);
    fupNextAt = getNextValidSlot(
      rawNextAt,
      configRows[0].minHour,
      configRows[0].maxHour,
      configRows[0].allowedDays,
      configRows[0].timezone,
    );
  }
}

// Step 3: INSERT com fupNextAt no values(), ausente do set{}
await this.db
  .insert(leads)
  .values({
    numero,
    uniqueId,
    nome: nome ?? null,
    fupEnabled,
    fupNextAt,  // ← NOVO: Date | null; null quando fupEnabled=false
  })
  .onConflictDoUpdate({
    target: leads.numero,
    set: {
      nome: nome ?? null,
      updatedAt: new Date(),
      // fupEnabled e fupNextAt ausentes do set{} — nunca sobrescritos no UPDATE
    },
  })
  .returning();
```

### Estratégia de Importação de `getNextValidSlot`

**Opção A (recomendada): Import direto**
```typescript
// Em lead-service.ts:
import { getNextValidSlot } from "../fup/fup-scheduler.js";
```

- A função já é `export function getNextValidSlot(...)` em `fup-scheduler.ts` [VERIFIED: linha 355]
- Sem refactor adicional, sem novo arquivo
- Risco mínimo de regressão

**Opção B: Extração para `scheduling-utils.ts`**
```
packages/core/src/fup/scheduling-utils.ts  ← nova função
packages/core/src/fup/fup-scheduler.ts    ← re-exporta de scheduling-utils
packages/core/src/leads/lead-service.ts   ← importa de scheduling-utils
```

- Mais limpo arquiteturalmente (SRP), mas adiciona um arquivo e possíveis re-exports
- Apropriado se houver mais consumidores no futuro

**Planner decide** conforme D-05. Opção A tem menor risco de regressão e menor scope.

### Pattern INSERT-only (sem tocar UPDATE)

O padrão já estabelecido em Phase 25 (preservado aqui):

```typescript
// fupEnabled e fupNextAt em values() → afeta o INSERT
// fupEnabled e fupNextAt ausentes de set{} → UPDATE não toca esses campos
.values({ ..., fupEnabled, fupNextAt })
.onConflictDoUpdate({
  set: {
    nome: nome ?? null,
    updatedAt: new Date(),
    // fupEnabled: AUSENTE ← D-03 de Phase 25 preservado
    // fupNextAt: AUSENTE ← D-01/D-03 de Phase 26
  }
})
```

[VERIFIED: padrão já implementado em lead-service.ts linhas 65-82]

### Struct de tipos

```typescript
// Variáveis locais em upsertLead():
let fupEnabled = false;
let fupNextAt: Date | null = null;  // ← NOVO: null = não setado; Date = calculado

// Quando fupEnabled = false → fupNextAt permanece null → INSERT com NULL
// Quando fupEnabled = true  → fupNextAt = Date calculada → INSERT com timestamp
```

### EVT-04 — Atualização de REQUIREMENTS.md

**Texto atual (linha 23 de REQUIREMENTS.md):**
```
- [x] **EVT-04**: Cada evento carrega `event_id` derivado de `thread_id:tool_call_id` para permitir deduplicação idempotente pelo consumidor
```

**Texto após Phase 26 (adicionar nota de exceção):**
```
- [x] **EVT-04**: Cada evento carrega `event_id` derivado de `thread_id:tool_call_id` para permitir deduplicação idempotente pelo consumidor. **Exceção FUP:** eventos de FUP usam `event_id = ${lead.uniqueId}:fup:${fup_step}` — FUP events não têm `tool_call_id` (D-17 da Phase 22, decisão intencional).
```

### EVT-04 — Code comment em `fup-scheduler.ts`

**Estado atual (linha 222):**
```typescript
event_id: `${lead.uniqueId}:fup:${lead.fupStep}`,  // D-17: idempotente por step
```

[VERIFIED: fup-scheduler.ts linha 222]

O comment atual menciona D-17 mas não documenta a divergência com EVT-04 explicitamente. Conforme D-07, deve ser completado para:

```typescript
event_id: `${lead.uniqueId}:fup:${lead.fupStep}`,
// D-17: formato diverge intencionalmente de EVT-04 (thread_id:tool_call_id).
// FUP events não têm tool_call_id — identificados por uniqueId:fup:step.
// Idempotente: mesmo step re-enviado produz o mesmo event_id.
```

---

## Don't Hand-Roll

| Problema | Não construir | Usar em vez | Por quê |
|---------|---------------|-------------|---------|
| Cálculo de próximo slot com timezone/business hours | Nova implementação | `getNextValidSlot()` de `fup-scheduler.ts` | Já implementada, testada (20 testes passando), lida com edge cases de meia-noite Intl, allowedDays vazio, fallback de 14 dias |
| Detecção INSERT vs UPDATE | Abordagem EXCLUDED no Drizzle | SELECT prévia (`isInsert = !existing[0]`) | Padrão já estabelecido em lead-service.ts; mais legível e testável que CASE WHEN com EXCLUDED |

**Key insight:** Toda a lógica complexa (business hours, timezone, loop de até 14 dias) já existe e é testada. Phase 26 apenas conecta os pontos: chama essa lógica no momento certo (INSERT de lead novo com FUP ativado).

---

## Common Pitfalls

### Pitfall 1: NULL no postgres para comparison com timestamp

**O que dá errado:** Quando `fup_next_at IS NULL`, a WHERE clause `fup_next_at <= NOW()` retorna NULL (não false, não true) — PostgreSQL exclui silenciosamente o lead do resultado.

**Por que acontece:** Semântica de NULL em SQL: qualquer comparação com NULL resulta em NULL, que é avaliado como falso em contextos booleanos.

**Como evitar:** Garantir que `fupNextAt` sempre é um `Date` concreto no INSERT quando `fupEnabled = true`. Nunca persistir `NULL` como fupNextAt quando fup está ativo.

**Sinais de alerta:** Lead com `fup_enabled = true` e `fup_next_at IS NULL` — indica bug no INSERT.

### Pitfall 2: intervals_seconds pode ser array vazio

**O que dá errado:** Se `fup_config.intervals_seconds = []`, então `intervals_seconds[0]` é `undefined`, e `NOW() + undefined * 1000` resulta em `NaN` milliseconds → `new Date(NaN)` → timestamp inválido.

**Por que acontece:** Schema define `integer('intervals_seconds').array().notNull()` — NOT NULL mas sem checagem de `length > 0` no banco.

**Como evitar:** Guard defensivo antes de calcular:
```typescript
if (configRows[0]?.enabled === true && configRows[0].intervalsSeconds.length > 0) {
  fupEnabled = true;
  const firstInterval = configRows[0].intervalsSeconds[0]!;
  // ... calcular fupNextAt
}
```

**Sinais de alerta:** `fupNextAt` retornando `Invalid Date`; erros de conversão de timestamp no Drizzle.

### Pitfall 3: `getNextValidSlot` importado de fup-scheduler pode criar dependência circular

**O que dá errado:** `lead-service.ts` importa de `fup-scheduler.ts`, mas `fup-scheduler.ts` não importa nada de `lead-service.ts` atualmente — sem ciclo. No entanto, se no futuro `fup-scheduler.ts` importar `lead-service.ts`, haverá ciclo.

**Por que acontece:** Circular imports em Bun/Node podem causar undefined exports em runtime.

**Como evitar:** Na abordagem de import direto (Opção A), verificar que não há ciclo. Alternativa: extrair `getNextValidSlot` para `scheduling-utils.ts` (Opção B) elimina o risco.

**Sinais de alerta:** `TypeError: getNextValidSlot is not a function` em runtime (symptom de circular import).

### Pitfall 4: Teste de upsertLead precisa mockar o db com `select().from().where()` (dois níveis de select)

**O que dá errado:** O padrão de mock atual em `lead-service-fup.test.ts` mocka apenas `db.update()`. O `upsertLead()` usa `db.select()` (dois vezes: uma para detectar INSERT, outra para buscar `fup_config`), `db.insert()` e `db.onConflictDoUpdate()`. Um mock incompleto lança TypeError.

**Por que acontece:** Drizzle usa builder pattern encadeado — cada método retorna um objeto com métodos aninhados.

**Como evitar:** Usar o padrão de mock mais flexível que simula o SELECT chain completo, retornando valores controlados (lead existente = `[existingLead]` ou `[]` para INSERT, config = `[fupConfigRow]` ou `[]`).

**Padrão de mock recomendado para `upsertLead()` tests:**
```typescript
function makeUpsertDbMock(opts: {
  existing: Lead | null;
  fupConfigRow: FupConfigRow | null;
  insertResult: Lead;
}) {
  const insertReturningMock = mock(() => Promise.resolve([opts.insertResult]));
  const onConflictMock = mock(() => ({ returning: insertReturningMock }));
  const insertValuesMock = mock(() => ({ onConflictDoUpdate: onConflictMock }));
  const insertMock = mock(() => ({ values: insertValuesMock }));

  let selectCallCount = 0;
  const limitMock = mock(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // Primeira chamada: SELECT existing lead
      return Promise.resolve(opts.existing ? [opts.existing] : []);
    }
    // Segunda chamada: SELECT fup_config
    return Promise.resolve(opts.fupConfigRow ? [opts.fupConfigRow] : []);
  });
  const whereMock = mock(() => ({ limit: limitMock }));
  const fromMock = mock(() => ({ where: whereMock }));
  const selectMock = mock(() => ({ from: fromMock }));

  return { selectMock, insertMock, onConflictMock, insertValuesMock, insertReturningMock };
}
```

---

## Code Examples

### Trecho da implementação de `upsertLead()` com fupNextAt

```typescript
// [VERIFIED: padrão estabelecido em lead-service.ts — extensão direta]
// [VERIFIED: getNextValidSlot exportada de fup-scheduler.ts linha 355]

import { getNextValidSlot } from "../fup/fup-scheduler.js";  // ou de scheduling-utils.ts

async upsertLead(numero: string, uniqueId: string, nome?: string, brainType?: string): Promise<Lead> {
  const existing = await this.db
    .select()
    .from(leads)
    .where(eq(leads.numero, numero))
    .limit(1);

  const isInsert = !existing[0];

  let fupEnabled = false;
  let fupNextAt: Date | null = null;  // ← NOVO

  if (isInsert && brainType) {
    const configRows = await this.db
      .select({
        enabled: fupConfig.enabled,
        intervalsSeconds: fupConfig.intervalsSeconds,  // ← EXPANDIDO
        minHour: fupConfig.minHour,                   // ← EXPANDIDO
        maxHour: fupConfig.maxHour,                   // ← EXPANDIDO
        allowedDays: fupConfig.allowedDays,           // ← EXPANDIDO
        timezone: fupConfig.timezone,                 // ← EXPANDIDO
      })
      .from(fupConfig)
      .where(eq(fupConfig.brainType, brainType))
      .limit(1);

    const config = configRows[0];
    // Guard: enabled AND array não-vazio (Pitfall 2)
    if (config?.enabled === true && config.intervalsSeconds.length > 0) {
      fupEnabled = true;
      const rawNextAt = new Date(Date.now() + config.intervalsSeconds[0]! * 1000);
      fupNextAt = getNextValidSlot(
        rawNextAt,
        config.minHour,
        config.maxHour,
        config.allowedDays,
        config.timezone,
      );
    }
  }

  const rows = await this.db
    .insert(leads)
    .values({
      numero,
      uniqueId,
      nome: nome ?? null,
      fupEnabled,
      fupNextAt,  // ← NOVO: Date no INSERT com FUP ativo; null caso contrário
    })
    .onConflictDoUpdate({
      target: leads.numero,
      set: {
        nome: nome ?? null,
        updatedAt: new Date(),
        // fupEnabled e fupNextAt ausentes — INSERT-only, nunca sobrescritos no UPDATE
      },
    })
    .returning();

  if (!rows[0]) throw new Error(`upsertLead returned no rows for numero=${numero}`);
  return rows[0];
}
```

### Assinatura de `getNextValidSlot` (referência para testes)

```typescript
// [VERIFIED: fup-scheduler.ts linha 355-388]
export function getNextValidSlot(
  from: Date,
  minHour: number,
  maxHour: number,
  allowedDays: string[],
  timezone: string
): Date
```

---

## State of the Art

| Abordagem Antiga | Abordagem Atual (Phase 26) | Quando Mudou | Impacto |
|-----------------|---------------------------|--------------|---------|
| `fupNextAt = NULL` no INSERT (Phase 25 D-05) | `fupNextAt = getNextValidSlot(NOW() + intervals_seconds[0])` no INSERT | Phase 26 | Scheduler processa leads novos sem intervenção manual |
| `fup_config` query busca apenas `enabled` | Query expandida para todos os campos de business hours | Phase 26 | Uma query em vez de duas; sem refetch no scheduler |

**Deprecated/outdated:**
- Phase 25 D-05 ("fup_next_at NÃO é calculado em upsertLead()") — substituído por D-01 de Phase 26
- Phase 25 D-06 ("FupScheduler exige last_message_at IS NOT NULL") — INCORRETO: auditoria do código real (fup-scheduler.ts linhas 113-118) confirma que essa condição NÃO existe na WHERE clause atual. Não há barreira de `last_message_at` no scheduler. Este assertion de D-06 era provavelmente uma intenção futura não implementada.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getNextValidSlot` não cria dependência circular ao ser importada em `lead-service.ts` | Architecture Patterns | Circular import poderia causar `undefined` em runtime; baixo risco pois fup-scheduler não importa lead-service |
| A2 | `fup_config.intervals_seconds[0]` existe e é válido quando `enabled = true` | Common Pitfalls | Se array vazio, `fupNextAt = Invalid Date` — coberto pelo guard em Pitfall 2 |

---

## Open Questions

1. **Extração vs. import direto de `getNextValidSlot`**
   - O que sabemos: função já existe e é exportada de `fup-scheduler.ts`
   - O que está em aberto: D-05 delega decisão ao planner
   - Recomendação: import direto (Opção A) para menor scope; extração (Opção B) se mais consumers forem previstos

2. **`fup_next_at` no UPDATE quando lead responde (resetFup)**
   - O que sabemos: `resetFup()` seta `fupNextAt = null, fupStep = 0`; lead fica com `fup_enabled = true` mas `fup_next_at = NULL` após resposta
   - O que está em aberto: isso reproduz o gap original para o segundo ciclo de FUP
   - Recomendação: documentar como known limitation; o CONTEXT.md já lista como DEFERRED. Não bloqueia FUP-02 (primeiro ciclo funciona).

---

## Environment Availability

Step 2.6: SKIPPED — fase é exclusivamente code/config changes (modificação de lead-service.ts, comments em fup-scheduler.ts, atualização de REQUIREMENTS.md). Nenhuma dependência externa nova.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, Bun 1.3.2) |
| Config file | nenhum — bun detecta automaticamente |
| Quick run command | `bun test packages/core/src/__tests__/unit/fup/` |
| Full suite command | `bun test packages/core/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FUP-02 (INSERT path) | `upsertLead()` com `fupEnabled=true` persiste `fupNextAt != null` no INSERT | unit | `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | Parcial (arquivo existe, testa apenas resetFup) |
| FUP-02 (scheduler path) | `_tick()` processa lead com `fup_next_at <= NOW()` (novo comportamento desbloqueado) | unit | `bun test packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` | ✅ Testa tick, mas com mock — precisa verificar que o mock reflete o novo estado |
| FUP-02 (e2e lógico) | INSERT com FUP ativo → `fupNextAt = NOW() + interval[0]` ajustado → scheduler processa | unit (composição) | `bun test packages/core/src/__tests__/unit/fup/` | Parcial — precisa de novos testes em lead-service-fup.test.ts |
| D-06/EVT-04 | Comment em fup-scheduler.ts documenta divergência de event_id | manual review | — | ✅ Linha 222 existe; verificar se comment é suficiente |

### Sampling Rate

- **Por task commit:** `bun test packages/core/src/__tests__/unit/fup/`
- **Por wave merge:** `bun test packages/core/`
- **Phase gate:** Suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] Novos testes em `lead-service-fup.test.ts` para comportamento de `fupNextAt` no INSERT:
  - `upsertLead() com fupEnabled=true persiste fupNextAt como Date (não null)`
  - `upsertLead() com fupEnabled=false mantém fupNextAt=null`
  - `upsertLead() em UPDATE não altera fupNextAt`
  - `upsertLead() com intervals_seconds=[] mantém fupNextAt=null (guard Pitfall 2)`

---

## Security Domain

Esta fase modifica apenas lógica de persistência interna (cálculo de timestamp e SELECT expandido de tabela própria). Nenhuma superfície de input externo é adicionada. Nenhuma categoria ASVS adicional é introduzida além das já cobertas pelo projeto.

| ASVS Category | Applies | Note |
|---------------|---------|------|
| V5 Input Validation | não (nova) | `intervals_seconds[0]` vem do banco (operador-controlled), não do payload externo |
| V2 Authentication | não | sem novo endpoint |

---

## Sources

### Primary (HIGH confidence)

- `packages/core/src/leads/lead-service.ts` — código atual de `upsertLead()` com Phase 25 implementado; padrão SELECT → INSERT/UPDATE; query de `fup_config` atual (linhas 39-88)
- `packages/core/src/fup/fup-scheduler.ts` — `_tick()` WHERE clause (linhas 113-118); `getNextValidSlot()` função exportada (linhas 355-388); code comment D-17 (linha 222)
- `packages/database/src/schema/tables.ts` — schema Drizzle: `leads.fupNextAt`, `fupConfig.intervalsSeconds/minHour/maxHour/allowedDays/timezone` (linhas 71-141)
- `.planning/phases/26-fup-next-at-init-fix/26-CONTEXT.md` — decisões D-01 a D-07

### Secondary (MEDIUM confidence)

- `.planning/phases/25-fup-activation/25-CONTEXT.md` — contexto da Phase 25; D-05/D-06 (now superseded)
- `.planning/phases/22-fup-autom-tico/22-CONTEXT.md` — D-17 (event_id format), D-08/D-09 (elegibilidade e cálculo de próximo slot)
- `packages/core/src/__tests__/unit/fup/` — padrões de teste existentes (mock do db, monkey-patch de métodos privados)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — sem dependências novas; código existente verificado no repositório
- Architecture: HIGH — gap diagnosticado com precisão via auditoria do WHERE clause; padrão INSERT-only verificado no codebase
- Pitfalls: HIGH — baseados em comportamento documentado do SQL (NULL comparisons) e análise do código atual
- Test patterns: HIGH — padrão de mock existente verificado nos arquivos de teste

**Research date:** 2026-06-25
**Valid until:** Estável — código do projeto é a fonte primária; sem dependências de packages externos em mudança
