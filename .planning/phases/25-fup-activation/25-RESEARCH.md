# Phase 25: FUP Activation Trigger - Research

**Researched:** 2026-06-24
**Domain:** Conditional database insertion logic, Drizzle ORM onConflictDoUpdate patterns, FUP configuration lookup
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Trigger de Ativação (upsertLead)**
- **D-01:** `upsertLead()` recebe parâmetro opcional `brainType?: string`. Quando informado, consulta `fup_config` para decidir se ativa FUP.
- **D-02:** Na INSERÇÃO (lead novo): se `fup_config` existe para o `brainType` E `enabled = true`, seta `fup_enabled = true` no lead criado.
- **D-03:** No UPDATE (lead existente): `fup_enabled` NUNCA é alterado — preserva o estado atual do lead. Isso garante que opt-out manual (operador setou `fup_enabled = false`) seja respeitado.
- **D-04:** Se `fup_config` não existir para o `brainType` (ou `brainType` não informado), comportamento silencioso: `fup_enabled = false` (default da tabela). Sem warning no log.

**Cálculo do Primeiro fup_next_at**
- **D-05:** `fup_next_at` NÃO é calculado em `upsertLead()`. Lead é criado com `fup_enabled = true` mas `fup_next_at = NULL`. O FupScheduler calcula no primeiro tick de polling.
- **D-06:** FupScheduler exige `last_message_at IS NOT NULL` para processar lead. Lead recém-criado sem mensagem não entra no ciclo de FUP — FUP só ativa após a primeira mensagem real.

**Leads Existentes**
- **D-07:** Leads que já existem no banco (antes da Phase 25) NÃO são tocados. Permanecem com `fup_enabled = false`. Operador ativa manualmente se necessário via SQL.

**Fluxo de Dados**
- **D-08:** BrainRunner.run() passa `brainType` do Brain ao chamar `leadService.upsertLead()`. O `brainType` já está disponível no contexto do Brain (IBrain.type).

### Claude's Discretion

- Implementação da query a `fup_config`: pode ser SELECT inline em `upsertLead()` ou cache no LeadService
- Estrutura interna do conditional insert vs update (Drizzle onConflictDoUpdate com lógica condicional)
- Nome exato do parâmetro: `brainType` ou `options?: { brainType?: string }`

### Deferred Ideas (OUT OF SCOPE)

- Migração em massa de leads existentes para `fup_enabled = true` — operador faz manualmente se necessário
- Coluna `fup_opted_out` para distinção explícita de opt-out — YAGNI, lógica INSERT-only é suficiente
- Cache de `fup_config` no LeadService — query simples, sem necessidade de otimização prematura

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FUP-01 | Configuração de FUP em tabela `fup_config` — não em ENV | Tabela já existe desde Phase 22; schema em `packages/database/src/schema/tables.ts` confirma `brainType text PRIMARY KEY`, `enabled boolean NOT NULL DEFAULT true` |
| FUP-02 (extensão) | Leads recém-criados têm `fup_enabled` ativado automaticamente quando `fup_config` existe | `LeadService.upsertLead()` já usa `onConflictDoUpdate` com `target: leads.numero`; estrutura pronta para lógica condicional INSERT vs UPDATE |

</phase_requirements>

---

## Summary

Phase 25 adiciona ativação automática de FUP para leads recém-criados quando `fup_config` existe e está habilitada para o `brainType`. A fase é uma extensão pontual de `LeadService.upsertLead()` — adicionar parâmetro opcional `brainType`, consultar `fup_config` inline, e setar `fup_enabled = true` APENAS no INSERT (nunca no UPDATE).

O desafio técnico central é a diferenciação INSERT vs UPDATE dentro de `onConflictDoUpdate` — Drizzle ORM não oferece hook nativo para isso, mas postgres.js permite queries com `CASE WHEN` ou `EXCLUDED` para detectar inserção. Alternativamente, usar abordagem de duas queries (SELECT antes de INSERT) é mais explícita e testável.

**Infraestrutura existente:**
- `LeadService.upsertLead()` já implementado com `onConflictDoUpdate`
- Schema `fupConfig` com `brainType` PK e `enabled` boolean
- `BrainRunner.run()` já chama `leadService.upsertLead()` e tem acesso a `this.brain.brainType`

**Primary recommendation:** Modificar `LeadService.upsertLead()` para aceitar `brainType?: string`, fazer SELECT inline de `fup_config` antes do upsert, e usar query condicional para setar `fup_enabled` apenas no INSERT. Abordagem de duas queries (SELECT + INSERT/UPDATE separados) é mais clara que `CASE WHEN` com `EXCLUDED` — facilita testes e manutenção.

---

## Standard Stack

### Core (já disponível no projeto)

| Library | Versão | Propósito | Por que usar |
|---------|--------|-----------|--------------|
| `drizzle-orm` | 0.45.x | ORM para SELECT de `fup_config` | Já usado em todo o LeadService — mantém consistência |
| `postgres` (postgres.js) | instalada | SQL executor para Drizzle queries | Já injetado no LeadService via construtor |

### Sem dependências novas

Esta fase **não requer instalação de nenhum novo pacote**. Toda a lógica usa infraestrutura existente:
- `LeadService` já tem `this.db` (Drizzle) e acesso a `sql` (postgres.js)
- Schema `fupConfig` já importado de `@brain-pkg/database`
- `BrainRunner` já tem `this.brain.brainType` disponível

---

## Architecture Patterns

### Estrutura de arquivos a modificar

```
packages/core/src/
└── leads/
    ├── lead-service.ts              # adicionar parâmetro brainType, query fup_config, lógica condicional
    └── __tests__/
        └── unit/
            └── lead-service.test.ts # adicionar testes para ativação automática
packages/core/src/
└── runner/
    └── runner.ts                    # passar this.brain.brainType ao upsertLead()
```

**Nenhum arquivo novo é criado.** Esta fase é refactoring de código existente.

### Pattern 1: Conditional Insert vs Update em Drizzle

**O que é:** Diferenciar lógica de INSERT (lead novo) vs UPDATE (lead existente) no `onConflictDoUpdate`.

**Problema:** Drizzle `onConflictDoUpdate` sempre executa o mesmo `set` para INSERT e UPDATE — não oferece hook para detectar se foi inserção ou atualização.

**Soluções avaliadas:**

#### Solução A: Query única com EXCLUDED (postgres específico)

```typescript
// Detectar INSERT vs UPDATE usando EXCLUDED (row que seria inserido)
await this.db
  .insert(leads)
  .values({
    numero,
    uniqueId,
    nome: nome ?? null,
    // fupEnabled omitido — deixa default (false) ou sobrescrito no onConflict
  })
  .onConflictDoUpdate({
    target: leads.numero,
    set: {
      nome: nome ?? null,
      updatedAt: new Date(),
      // CRITICAL: setar fupEnabled apenas se foi INSERT (EXCLUDED.id é diferente)
      fupEnabled: sql`CASE
        WHEN ${leads.id} IS DISTINCT FROM EXCLUDED.id
        THEN ${shouldEnableFup}
        ELSE ${leads.fupEnabled}
      END`,
    },
  })
  .returning();
```

**Problema:** `EXCLUDED.id` sempre será diferente porque é UUID gerado por `defaultRandom()` — comparação não funciona. Comparar `EXCLUDED.created_at` também não funciona porque `defaultNow()` é executado no INSERT.

**Veredito:** ❌ Não funciona com UUID auto-generated — precisa de coluna auxiliar ou lógica externa.

#### Solução B: Duas queries separadas (SELECT antes de INSERT)

```typescript
async upsertLead(
  numero: string,
  uniqueId: string,
  nome?: string,
  brainType?: string
): Promise<Lead> {
  // 1. Verificar se lead já existe
  const existing = await this.db
    .select()
    .from(leads)
    .where(eq(leads.numero, numero))
    .limit(1);

  const isInsert = !existing[0];

  // 2. Se INSERT e brainType informado, consultar fup_config
  let fupEnabled = false; // default da tabela
  if (isInsert && brainType) {
    const config = await this.db
      .select()
      .from(fupConfig)
      .where(eq(fupConfig.brainType, brainType))
      .limit(1);

    if (config[0]?.enabled) {
      fupEnabled = true;
    }
  }

  // 3. Upsert com fupEnabled calculado (apenas para INSERT)
  const rows = await this.db
    .insert(leads)
    .values({
      numero,
      uniqueId,
      nome: nome ?? null,
      fupEnabled, // só tem efeito no INSERT
    })
    .onConflictDoUpdate({
      target: leads.numero,
      set: {
        nome: nome ?? null,
        updatedAt: new Date(),
        // fupEnabled ausente — preserva valor atual no UPDATE
      },
    })
    .returning();

  return rows[0]!;
}
```

**Vantagens:**
- ✅ Lógica explícita INSERT vs UPDATE — fácil de entender e testar
- ✅ `fupEnabled` ausente do `set` no UPDATE — preserva estado atual (D-03)
- ✅ Query a `fup_config` só roda em INSERT — sem overhead em UPDATE

**Desvantagens:**
- ❌ SELECT extra antes do INSERT — 2 roundtrips ao banco em vez de 1
- ❌ Race condition teórica: outro processo pode inserir entre SELECT e INSERT (mitigado por UNIQUE constraint — INSERT falharia e cairia no UPDATE path)

**Veredito:** ✅ **Recomendado** — clareza e testabilidade superam custo de 1 SELECT extra. Race condition é não-problema devido a UNIQUE constraint em `numero`.

#### Solução C: UPSERT com sql.unsafe e returning xmax (postgres hack)

```typescript
// xmax = 0 indica INSERT; xmax > 0 indica UPDATE
const result = await sql`
  INSERT INTO leads (numero, unique_id, nome, fup_enabled)
  VALUES (${numero}, ${uniqueId}, ${nome ?? null}, ${fupEnabled})
  ON CONFLICT (numero) DO UPDATE SET
    nome = EXCLUDED.nome,
    updated_at = NOW()
  RETURNING *, xmax
`;

const wasInsert = result[0].xmax === '0';
```

**Problema:** `xmax` é internal system column não confiável — pode mudar entre versões do PostgreSQL. Não recomendado para lógica de aplicação.

**Veredito:** ❌ Hack frágil — evitar.

### Pattern 2: Injeção de brainType no BrainRunner

**O que é:** Passar `this.brain.brainType` de BrainRunner para LeadService sem quebrar callers existentes.

**Como:** Parâmetro opcional em `upsertLead()`:

```typescript
// Em packages/core/src/runner/runner.ts (linha ~248)
const lead: Lead = await this.leadService.upsertLead(
  event.Numero,
  event.IDLead,
  event.Name,
  this.brain.brainType  // ← NOVO: quarto parâmetro
);
```

**Compatibilidade:** Parâmetro opcional — callers antigos (testes) continuam funcionando sem modificação.

**Exemplo:** [VERIFIED: packages/core/src/brain/interface.ts]

```typescript
export interface IBrain {
  brainType: string;  // ← já existe
  // ...
}
```

### Pattern 3: Query a fup_config inline

**O que é:** Consultar `fup_config` dentro de `upsertLead()` para decidir valor de `fup_enabled`.

**Quando fazer:** Apenas em INSERT (detectado por SELECT antes do upsert).

**Exemplo:**

```typescript
import { fupConfig } from "@brain-pkg/database";
import { eq } from "drizzle-orm";

// Dentro de upsertLead(), após detectar isInsert=true
if (isInsert && brainType) {
  const configRows = await this.db
    .select({ enabled: fupConfig.enabled })
    .from(fupConfig)
    .where(eq(fupConfig.brainType, brainType))
    .limit(1);

  // D-02: ativar FUP apenas se config existe E enabled = true
  if (configRows[0]?.enabled === true) {
    fupEnabled = true;
  }
  // D-04: se não existe ou enabled = false, fupEnabled permanece false (default)
}
```

**Performance:** SELECT inline é aceitável — FUP config é row única por brain_type, query rápida (PK lookup).

**Alternativa (cache):** Deferida para otimização futura — YAGNI (premature optimization).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detectar INSERT vs UPDATE em onConflictDoUpdate | EXCLUDED comparisons, xmax hacks | SELECT before INSERT pattern | Drizzle não expõe "foi insert ou update?" nativamente; SELECT é explícito, testável, e race-safe devido a UNIQUE constraint |
| Cache de fup_config | In-memory Map, Redis cache | Query inline direto | FUP config é row única por brain_type; SELECT por PK é sub-milissegundo; cache adiciona complexidade (invalidation, staleness) sem ganho mensurável |

**Key insight:** Drizzle `onConflictDoUpdate` é otimizado para casos onde INSERT e UPDATE fazem a mesma coisa. Quando lógica precisa divergir (como aqui: ativar FUP só no INSERT), SELECT antes do INSERT é o padrão idiomático e menos propenso a bugs.

---

## Runtime State Inventory

> Phase 25 é code-only (modificação de lógica de upsert) — sem rename, refactor ou migração. Seção omitida.

---

## Common Pitfalls

### Pitfall 1: fupEnabled sobrescrito no UPDATE

**What goes wrong:** Incluir `fupEnabled` no `set` de `onConflictDoUpdate` sobrescreve o valor atual do lead a cada UPDATE — desfaz opt-out manual.

**Why it happens:** Copy-paste do padrão de `nome` (que DEVE ser atualizado) sem pensar que `fupEnabled` tem semântica diferente.

**How to avoid:** Documentar claramente que `fupEnabled` é set-once no INSERT. No UPDATE, campo ausente do `set`.

**Warning signs:** Testes de integração falham com "lead que tinha fup_enabled=false agora tem true após receber mensagem".

### Pitfall 2: Query a fup_config em TODOS os upserts

**What goes wrong:** Fazer SELECT de `fup_config` mesmo quando `brainType` não é informado ou quando é UPDATE — overhead desnecessário.

**Why it happens:** Colocar query fora do `if (isInsert && brainType)`.

**How to avoid:** Guard duplo: `if (isInsert && brainType)` antes de consultar `fup_config`.

**Warning signs:** Logs mostram query a `fup_config` em TODOS os upserts — não apenas em INSERT de leads novos.

### Pitfall 3: Assumir que fup_config sempre existe

**What goes wrong:** Query retorna `[]`, `configRows[0]` é `undefined`, e `configRows[0].enabled` lança TypeError.

**Why it happens:** Operador ainda não criou `fup_config` para o `brainType`.

**How to avoid:** Optional chaining: `configRows[0]?.enabled === true` — falsy quando row não existe.

**Warning signs:** Crash com "Cannot read property 'enabled' of undefined" no primeiro lead após deploy.

### Pitfall 4: Race condition entre SELECT e INSERT

**What goes wrong:** Dois processos simultâneos fazem SELECT (ambos retornam "não existe"), ambos tentam INSERT, segundo falha com UNIQUE constraint.

**Why it happens:** Janela de tempo entre SELECT e INSERT.

**How to avoid:** Não precisa evitar — UNIQUE constraint em `numero` garante que INSERT falha e cai no UPDATE path automaticamente. O segundo processo simplesmente atualiza o lead que o primeiro inseriu.

**Warning signs:** Nenhum — comportamento correto. Se logs mostram "UNIQUE constraint violation" seguido de retry bem-sucedido, é esperado.

---

## Code Examples

Verified patterns from existing codebase:

### LeadService.upsertLead() — Estrutura Atual

```typescript
// Source: packages/core/src/leads/lead-service.ts (linhas 36-59)
async upsertLead(numero: string, uniqueId: string, nome?: string): Promise<Lead> {
  const rows = await this.db
    .insert(leads)
    .values({
      numero,
      uniqueId,
      nome: nome ?? null,
    })
    .onConflictDoUpdate({
      target: leads.numero,
      set: {
        // LEAD-02: uniqueId ausente do set — nunca sobrescrito após primeiro insert
        nome: nome ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!rows[0]) {
    throw new Error(`upsertLead returned no rows for numero=${numero}`);
  }

  return rows[0];
}
```

### Schema fupConfig — Tabela Existente

```typescript
// Source: packages/database/src/schema/tables.ts (linhas 122-142)
export const fupConfig = pgTable('fup_config', {
  brainType: text('brain_type').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  intervalsSeconds: integer('intervals_seconds').array().notNull(),
  minHour: integer('min_hour').notNull(),
  maxHour: integer('max_hour').notNull(),
  allowedDays: text('allowed_days').array().notNull(),
  timezone: text('timezone').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### BrainRunner.run() — Chamada Atual

```typescript
// Source: packages/core/src/runner/runner.ts (linhas 248-252)
const lead: Lead = await this.leadService.upsertLead(
  event.Numero,
  event.IDLead,
  event.Name
);
// ← ADICIONAR: this.brain.brainType como quarto parâmetro
```

### IBrain.brainType — Campo Disponível

```typescript
// Source: packages/core/src/brain/interface.ts (linhas 42-43)
export interface IBrain {
  brainType: string;  // ← já disponível no BrainRunner via this.brain.brainType
  // ...
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FUP ativado manualmente via SQL direto | FUP ativado automaticamente ao criar lead quando `fup_config` existe | Phase 25 (2026-06-24) | Operador não precisa mais rodar UPDATE manual após configurar FUP — produção imediata |
| `upsertLead()` sem conhecimento de FUP | `upsertLead()` consulta `fup_config` e decide ativação | Phase 25 | LeadService agora consciente do sistema de FUP — acoplamento justificado (FUP é core feature) |

**Deprecated/outdated:**
- ❌ Ativação manual de FUP via `UPDATE leads SET fup_enabled = true WHERE ...` — após Phase 25, leads novos são ativados automaticamente

---

## Environment Availability

> Phase 25 é code-only (modificação de LeadService e BrainRunner) — sem dependências externas. Seção omitida.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, Jest-compatible API) |
| Config file | none — native Bun test runner, zero config |
| Quick run command | `bun test packages/core/src/leads/__tests__/unit/lead-service.test.ts` |
| Full suite command | `bun test` (root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FUP-01 | Query `fup_config` para decidir ativação | unit | `bun test packages/core/src/leads/__tests__/unit/lead-service.test.ts -t "fup activation"` | ❌ Wave 0 |
| FUP-02 | Lead novo com `fup_config` enabled = true recebe `fup_enabled = true` | unit | `bun test packages/core/src/leads/__tests__/unit/lead-service.test.ts -t "insert with fup"` | ❌ Wave 0 |
| FUP-02 | Lead existente NUNCA tem `fup_enabled` alterado no UPDATE | unit | `bun test packages/core/src/leads/__tests__/unit/lead-service.test.ts -t "update preserves fup"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test packages/core/src/leads/__tests__/unit/lead-service.test.ts -x` (fast feedback)
- **Per wave merge:** `bun test packages/core` (all core tests)
- **Phase gate:** Full suite green (`bun test`) antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/leads/__tests__/unit/lead-service.test.ts` — adicionar casos:
  - `upsertLead() INSERT com brainType + fup_config enabled = true → fup_enabled = true`
  - `upsertLead() INSERT com brainType + fup_config enabled = false → fup_enabled = false`
  - `upsertLead() INSERT com brainType ausente → fup_enabled = false (default)`
  - `upsertLead() UPDATE (lead existente) com fup_enabled = false → permanece false (não sobrescrito)`
  - `upsertLead() INSERT com fup_config inexistente para brainType → fup_enabled = false (silencioso)`

Estrutura de teste já existe — `packages/core/src/leads/__tests__/` presente no projeto. Wave 0 apenas adiciona novos casos.

---

## Security Domain

> Phase 25 não introduz novos vetores de ataque — modificação de lógica de negócio existente (LeadService). Seção omitida.

---

## Sources

### Primary (HIGH confidence)

- Drizzle ORM onConflictDoUpdate docs: https://orm.drizzle.team/docs/insert#on-conflict-do-update [CITED]
- PostgreSQL EXCLUDED documentation: https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT [CITED]
- Código existente: `packages/core/src/leads/lead-service.ts` [VERIFIED: Read tool]
- Schema `fupConfig`: `packages/database/src/schema/tables.ts` [VERIFIED: Read tool]
- IBrain interface: `packages/core/src/brain/interface.ts` [VERIFIED: Read tool]
- BrainRunner lifecycle: `packages/core/src/runner/runner.ts` [VERIFIED: Read tool]

### Secondary (MEDIUM confidence)

- Drizzle ORM GitHub issues: "How to detect INSERT vs UPDATE in onConflictDoUpdate" (sem solução nativa — padrão de SELECT before INSERT recomendado por comunidade) [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Modificação de LeadService: HIGH — código existente bem documentado, padrão `onConflictDoUpdate` já usado
- Query a fup_config: HIGH — schema verificado, SELECT por PK é query trivial
- Injeção de brainType: HIGH — `this.brain.brainType` já disponível, parâmetro opcional backward-compatible
- Pattern SELECT before INSERT: MEDIUM — não é idioma nativo do Drizzle, mas é pattern bem estabelecido em PostgreSQL apps

**Research date:** 2026-06-24
**Valid until:** 60 days (stable domain — DB upsert patterns não mudam rapidamente)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Drizzle `onConflictDoUpdate` não oferece hook para detectar INSERT vs UPDATE nativamente | Architecture Patterns | Se Drizzle adicionou feature nova, abordagem de SELECT before INSERT seria desnecessária (mas ainda funcional) |

**Se esta tabela tem 1 item:** SELECT before INSERT é o padrão idiomático para diferenciar INSERT vs UPDATE em Drizzle — nenhum outro assumption crítico.

---

## Open Questions

### 1. **Performance de SELECT extra em upsertLead()**

- **What we know:** SELECT before INSERT adiciona 1 roundtrip ao banco; `fup_config` é row única (PK lookup rápido)
- **What's unclear:** Em alta carga (centenas de upserts/segundo), latência extra é aceitável?
- **Recommendation:** Implementar como descrito (SELECT before INSERT); se profiling mostrar gargalo, migrar para cache de `fup_config` em memória (invalidado por TTL ou pub/sub)

### 2. **Migration de leads existentes**

- **What we know:** D-07 diz "leads existentes permanecem com fup_enabled=false"
- **What's unclear:** Operador quer migrar em massa? Fase 25 não inclui script de migração.
- **Recommendation:** Documentar SQL manual em PLAN.md: `UPDATE leads SET fup_enabled = true WHERE ia_ativada = true AND created_at > '2026-06-01'` (exemplo — operador ajusta critérios)

---
