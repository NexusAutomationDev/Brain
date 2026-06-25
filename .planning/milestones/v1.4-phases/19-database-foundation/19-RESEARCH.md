# Phase 19: Database Foundation — Research

**Researched:** 2026-06-23
**Domain:** Drizzle ORM pg-core schema, PostgreSQL migrations, LeadService pattern
**Confidence:** HIGH — todo o domínio é verificado contra o código existente no repo

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**fup_config — Escopo e Estrutura**
- D-01: `fup_config` é por `brain_type` — não singleton. Cada tipo de Brain tem configuração própria.
- D-02: `brain_type` é a Primary Key da tabela (text PK) — sem UUID separado.
- D-03: Intervalos armazenados como `integer[]` na coluna `intervals_seconds`. Ex: `{3600, 86400, 259200}`.
- D-04: Dias permitidos como `text[]` na coluna `allowed_days`. Ex: `{'mon','tue','wed','thu','fri'}`.
- D-05: Fuso horário como `text` (IANA string). Ex: `'America/Sao_Paulo'`.
- D-06: Horários min/max como `integer` (hora do dia, 0–23).
- D-16: Coluna `enabled boolean NOT NULL DEFAULT true` para controle de ativação sem deletar config.

**knowledge_chunks — Estrutura**
- D-07: Sem `source_id` — re-ingestão faz DELETE WHERE collection + re-insert. YAGNI.
- D-08: Dimensão do vetor usa mesmo `EMBEDDING_DIM` do ENV `EMBEDDING_DIMENSIONS` (default 1536).
- D-09: Sem índice HNSW na migration — criado manualmente pós-ingestão em produção.

**leads — Novas Colunas FUP**
- D-10: Adicionar colunas: `fup_enabled boolean NOT NULL DEFAULT false`, `fup_step integer NOT NULL DEFAULT 0`, `fup_next_at timestamptz`, `last_message_at timestamptz`.
- D-11: `last_message_at` é distinto de `updatedAt` — rastreia especificamente quando o humano enviou mensagem.

**LeadService.touchLastMessage()**
- D-12: Novo método `touchLastMessage(uniqueId: string)` atualiza `last_message_at = NOW()`.
- D-13: `BrainRunner.run()` chama `touchLastMessage()` ANTES do gate `ia_ativada` — FUP-06 exige "a cada mensagem recebida".

**tables.ts e Migration**
- D-14: `packages/database/src/schema/tables.ts` atualizado com `knowledgeChunks` e `fupConfig` nesta fase.
- D-15: Migration nomeada `0007_v1_4_foundation.sql` — arquivo único com todo o DDL de v1.4.

### Claude's Discretion
- Tipos exatos de coluna para campos não mencionados (createdAt, updatedAt em knowledge_chunks)
- Constraints de validação SQL (CHECK) para min_hour/max_hour se necessário
- Nomenclatura exata das colunas em snake_case seguindo padrão do projeto

### Deferred Ideas (OUT OF SCOPE)
- `source_id` em knowledge_chunks para deduplicação por documento — RAG-F01, requisito futuro
- Índice HNSW em knowledge_chunks — Out of Scope, criado manualmente pós-ingestão
- `fup_steps` como tabela separada
- Boolean columns por dia da semana
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FUP-04 | Estado de FUP de cada lead persistido no banco com colunas `fup_step`, `fup_next_at` e `fup_enabled` na tabela `leads` — sem estado em memória | Colunas adicionadas via ADD COLUMN na migration; Drizzle schema atualizado em tables.ts |
| FUP-06 | BrainRunner.run() cancela todos os FUPs pendentes e atualiza `last_message_at` do lead a cada mensagem recebida | `LeadService.touchLastMessage()` chamado ANTES do gate `ia_ativada` em runner.ts:~183 |
</phase_requirements>

---

## Summary

Esta fase é exclusivamente de **schema e migration** — nenhuma lógica de negócio além do método `touchLastMessage()` e da chamada em `BrainRunner.run()`. O trabalho é bem delimitado e de baixo risco técnico: criar a migration `0007_v1_4_foundation.sql`, atualizar `tables.ts` com os novos schemas Drizzle, adicionar a entrada no journal, adicionar `touchLastMessage()` ao `LeadService`, e chamar esse método no `BrainRunner`.

O projeto já tem todos os padrões estabelecidos para executar essa fase com segurança: migrations manuais via SQL puro, schema Drizzle com `pgTable`, `vector()` para embeddings, e atualização atômica de colunas via `drizzle.update().set().where()`. O pattern de array em Drizzle 0.45.x é `.array()` encadeado no builder da coluna (`integer('field').array()`, `text('field').array()`).

**Recomendação primária:** Criar migration SQL manual seguindo o padrão do projeto (não usar `drizzle-kit generate` — poderia gerar um snapshot inconsistente com as migrations manuais existentes). Atualizar `tables.ts` em paralelo com a migration para que Phases 20/21/22 possam usar o schema TypeScript.

---

## Project Constraints (from CLAUDE.md)

- Runtime: Bun 1.x — `bun test` para testes
- ORM: Drizzle 0.45.x (pin) — `drizzle-orm/pg-core`
- DB: PostgreSQL 16 + pgvector 0.8.x
- Testes em `packages/<pacote>/src/__tests__/unit/` e `__tests__/integration/` — nunca ao lado do código
- Commits seguem Conventional Commits com emoji — nunca incluir Co-Authored-By Claude
- Não criar arquivos `.md` de documentação fora de `docs/`
- Código compartilhado entre Brains vai em `packages/`, não em `apps/`

---

## Standard Stack

### Core (já instalado no projeto)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `drizzle-orm` | 0.45.2 | ORM + schema TypeScript | [VERIFIED: packages/database/package.json] |
| `drizzle-kit` | ^0.31.10 | CLI migrations | [VERIFIED: packages/database/package.json] |
| `pgvector` (npm) | ^0.3.0 | pgvector Node.js client | [VERIFIED: packages/database/package.json] |
| `postgres` | ^3.4.9 | Driver postgres.js | [VERIFIED: packages/database/package.json] |

### Imports necessários em tables.ts

O schema atual importa de `drizzle-orm/pg-core`:

```typescript
import {
  pgTable, text, uuid, timestamp, jsonb,
  boolean, index, vector, uniqueIndex
} from 'drizzle-orm/pg-core';
```

Para as novas tabelas, adicionar `integer` (já existe no pg-core):

```typescript
import {
  pgTable, text, uuid, timestamp, jsonb,
  boolean, index, vector, uniqueIndex, integer // adicionar
} from 'drizzle-orm/pg-core';
```

[VERIFIED: /root/Brain/node_modules/.bun/drizzle-orm@0.45.2/node_modules/drizzle-orm/pg-core/columns/index.d.ts]

---

## Architecture Patterns

### Estrutura do Projeto (padrão estabelecido)

```
packages/database/src/
├── schema/
│   └── tables.ts              # schema Drizzle — EDITAR
├── migrations/
│   ├── meta/
│   │   └── _journal.json      # journal — EDITAR (adicionar idx=7)
│   ├── 0006_leads_cols_remove_users.sql
│   └── 0007_v1_4_foundation.sql  # CRIAR

packages/core/src/
├── leads/
│   ├── lead-service.ts        # EDITAR — adicionar touchLastMessage()
│   └── __tests__/
│       └── lead-service.test.ts  # EDITAR — adicionar testes
├── runner/
│   └── runner.ts              # EDITAR — chamar touchLastMessage()
```

### Pattern 1: Definição de Tabela Drizzle (padrão existente)

**O que é:** `pgTable()` com tipos pg-core, timestamps padrão, PK UUID
**Quando usar:** Toda nova tabela — sem exceção

```typescript
// Source: packages/database/src/schema/tables.ts (existente)
export const prompts = pgTable('prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  brainType: text('brain_type').notNull(),
  key: text('key').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  brainTypeKeyIdx: uniqueIndex('prompts_brain_type_key_idx').on(table.brainType, table.key),
}));
```

[VERIFIED: packages/database/src/schema/tables.ts]

### Pattern 2: Coluna vector() para embeddings

```typescript
// Source: packages/database/src/schema/tables.ts (embeddings table)
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);

embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
```

[VERIFIED: packages/database/src/schema/tables.ts]

### Pattern 3: Array de inteiros em Drizzle 0.45.x

Drizzle 0.45.x expõe `.array()` como método encadeável em qualquer builder de coluna:

```typescript
// Source: drizzle-orm/pg-core/columns/common.d.ts (verificado no node_modules)
// integer[] para intervals_seconds
intervalsSeconds: integer('intervals_seconds').array().notNull(),
// text[] para allowed_days
allowedDays: text('allowed_days').array().notNull(),
```

O SQL gerado é `integer[]` / `text[]` respectivamente.

[VERIFIED: /root/Brain/node_modules/.bun/drizzle-orm@0.45.2/node_modules/drizzle-orm/pg-core/columns/common.d.ts]

### Pattern 4: timestamp com timezone (timestamptz)

As colunas `fup_next_at` e `last_message_at` devem usar `timestamp with time zone` para suportar comparações corretas de horário com fuso. Drizzle suporta:

```typescript
// timestamp({ withTimezone: true }) gera TIMESTAMPTZ no SQL
fupNextAt: timestamp('fup_next_at', { withTimezone: true }),  // nullable — sem .notNull()
lastMessageAt: timestamp('last_message_at', { withTimezone: true }), // nullable
```

O CONTEXT.md especifica `timestamptz` para ambas as colunas. O driver `postgres.js` mapeia `TIMESTAMPTZ` para `Date` no TypeScript automaticamente.

[ASSUMED] — o parâmetro `{ withTimezone: true }` em `timestamp()` do Drizzle 0.45.x gera `TIMESTAMPTZ`. Verificar na documentação se necessário, mas é o comportamento esperado e consistente com a API Drizzle.

### Pattern 5: fup_config com text PRIMARY KEY (desvio consciente do padrão)

```typescript
// D-02: brain_type como text PK — sem UUID separado
export const fupConfig = pgTable('fup_config', {
  brainType: text('brain_type').primaryKey(),
  // ...demais colunas
});
```

[VERIFIED: D-02 em CONTEXT.md — desvio consciente e documentado]

### Pattern 6: Migration SQL manual

```sql
-- Padrão do projeto: CREATE TABLE direto (sem IF NOT EXISTS)
-- Tabelas separadas por --> statement-breakpoint
-- Source: 0001_lazy_deathstrike.sql
CREATE TABLE "prompts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    ...
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fup_enabled" boolean DEFAULT false NOT NULL;
```

[VERIFIED: packages/database/src/migrations/0001_lazy_deathstrike.sql e 0006_leads_cols_remove_users.sql]

### Pattern 7: touchLastMessage() no LeadService

```typescript
// Source: packages/core/src/leads/lead-service.ts — padrão de setFullpp() e setIaAtivada()
async touchLastMessage(uniqueId: string): Promise<void> {
  await this.db
    .update(leads)
    .set({ lastMessageAt: new Date() })
    .where(eq(leads.uniqueId, uniqueId));
}
```

[VERIFIED: padrão derivado de setFullpp() e setIaAtivada() em lead-service.ts]

### Pattern 8: Chamada em BrainRunner.run() ANTES do gate ia_ativada

```typescript
// Source: packages/core/src/runner/runner.ts linha ~183
// Ponto de inserção: APÓS upsertLead(), ANTES do if (!lead.iaAtivada)
const lead = await this.leadService.upsertLead(event.Numero, event.IDLead, event.Name);

// D-13: FUP-06 — atualizar last_message_at INCONDICIONALMENTE (antes do gate)
await this.leadService.touchLastMessage(lead.uniqueId);

if (!lead.iaAtivada) {
  this.logger.debug({ numero: event.Numero }, "ia_ativada=false — ignoring message");
  return null;
}
```

[VERIFIED: runner.ts linhas 183-194]

### Anti-Patterns a Evitar

- **Não usar `drizzle-kit generate`** para criar a migration — o projeto usa migrations SQL manuais. Usar `drizzle-kit generate` criaria snapshots que conflitam com o journal existente que não tem todos os snapshots (apenas 0000, 0001, 0004 existem).
- **Não usar `timestamp()` sem `{ withTimezone: true }` para `fup_next_at`/`last_message_at`** — colunas de agendamento FUP devem ser TIMESTAMPTZ para comparações de fuso corretas.
- **Não chamar `touchLastMessage()` dentro do branch `if (!lead.iaAtivada)`** — deve ser ANTES do gate (D-13, FUP-06).
- **Não omitir `NOT NULL DEFAULT false` em `fup_enabled`** — leads existentes ficam com `fup_enabled = false` após a migration, que é o comportamento correto.

---

## Don't Hand-Roll

| Problema | Não Construir | Usar | Motivo |
|----------|--------------|------|--------|
| Tipos de array em Drizzle | Tipo customizado manual | `.array()` encadeado no builder | API nativa do Drizzle 0.45.x — sem workaround necessário |
| Migration aplicada no startup | Lógica de startup custom | `runMigrations()` existente em `packages/database/src/migrate.ts` | Já cuida de advisory lock, extension vector e journal |
| Update atômico de coluna | Query raw SQL | `drizzle.update().set().where()` | Padrão do projeto, tipado, seguro |

---

## Common Pitfalls

### Pitfall 1: Journal sem snapshot correspondente

**O que dá errado:** O `_journal.json` tem entradas, mas `meta/` só tem snapshots para 0000, 0001 e 0004. Adicionar idx=7 sem o snapshot correspondente pode quebrar `drizzle-kit` mas NÃO quebra o `runMigrations()` (que usa o migrator do drizzle que lê o journal + arquivos SQL diretamente).

**Por que acontece:** O projeto usa migrations manuais — os snapshots são opcionais para execução, mas necessários para `drizzle-kit generate` futuro.

**Como evitar:** Adicionar apenas a entrada no `_journal.json` e o arquivo `.sql`. Não é necessário criar um snapshot JSON para migrations manuais — o `migrate()` do drizzle funciona sem ele.

[VERIFIED: comportamento verificado ao ler `_journal.json` e `meta/` — apenas 0000, 0001, 0004 têm snapshots]

### Pitfall 2: EMBEDDING_DIM hardcoded na migration SQL

**O que dá errado:** A migration SQL precisa de um valor numérico para `vector(EMBEDDING_DIM)`. O ENV não está disponível no momento de escrita do SQL estático.

**Por que acontece:** O arquivo `.sql` é estático — não interpola variáveis de ambiente.

**Como evitar:** Usar o valor default (1536) diretamente na migration SQL — igual ao que `0000_lyrical_scrambler.sql` faz com `"embedding" vector(1536)`. O `tables.ts` usa o ENV para geração de tipos TypeScript; a migration usa o default hard-coded.

[VERIFIED: 0000_lyrical_scrambler.sql linha 15 — `"embedding" vector(1536)`]

### Pitfall 3: Colunas nullable vs NOT NULL nas colunas FUP de leads

**O que dá errado:** `fup_next_at` e `last_message_at` devem ser NULLABLE — um lead que nunca recebeu FUP não tem `fup_next_at`; um lead que nunca enviou mensagem depois da migration não tem `last_message_at`.

**Por que acontece:** Confundir os campos com timestamps padrão `NOT NULL DEFAULT NOW()`.

**Como evitar:** `fup_next_at timestamptz` e `last_message_at timestamptz` sem NOT NULL — nullable por design. `fup_enabled boolean NOT NULL DEFAULT false` e `fup_step integer NOT NULL DEFAULT 0` são NOT NULL pois têm defaults válidos.

[VERIFIED: D-10 em CONTEXT.md]

### Pitfall 4: touchLastMessage() chamado DEPOIS do gate ia_ativada

**O que dá errado:** FUP-06 exige que `last_message_at` seja atualizado "a cada mensagem recebida" — inclusive quando `ia_ativada = false`. Se o call for depois do gate, mensagens de leads com IA desativada não resetam o FUP.

**Por que acontece:** Sequência natural do código existente é: upsert → gate → processar. Inserir `touchLastMessage()` no lugar errado.

**Como evitar:** Sempre ANTES do `if (!lead.iaAtivada)` — D-13 documenta isso explicitamente.

[VERIFIED: D-13 em CONTEXT.md + runner.ts linhas 183-194]

### Pitfall 5: Mock de lead-service.test.ts precisa das novas colunas

**O que dá errado:** O mock do `@brain-pkg/database` em `lead-service.test.ts` lista colunas explicitamente. Após adicionar `lastMessageAt` ao schema, o mock pode precisar de atualização para os testes de `touchLastMessage()` funcionarem.

**Por que acontece:** Testes de unidade mockam o schema Drizzle.

**Como evitar:** Ao adicionar `touchLastMessage()`, adicionar `lastMessageAt: 'leads.last_message_at'` ao mock do `@brain-pkg/database` nos testes existentes (ou criar um mock separado no novo teste).

[VERIFIED: packages/core/src/leads/__tests__/lead-service.test.ts linha 35-47]

---

## Code Examples

### knowledge_chunks em tables.ts

```typescript
// Source: padrão derivado de embeddings (tables.ts) + D-07, D-08, D-09
export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  collection: text('collection').notNull(),
  content: text('content').notNull(),
  // D-08: mesma dimensão que embeddings — EMBEDDING_DIM do ENV
  embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
  embeddingModel: text('embedding_model').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  totalChunks: integer('total_chunks').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // D-09: sem índice HNSW — criado manualmente pós-ingestão
});
```

### fup_config em tables.ts

```typescript
// Source: D-01 a D-06, D-16 em CONTEXT.md
export const fupConfig = pgTable('fup_config', {
  // D-02: text PK — sem UUID separado
  brainType: text('brain_type').primaryKey(),
  // D-16: enabled para controle sem deletar config
  enabled: boolean('enabled').notNull().default(true),
  // D-03: integer[] para intervalos em segundos
  intervalsSeconds: integer('intervals_seconds').array().notNull(),
  // D-06: horários como integer (0–23)
  minHour: integer('min_hour').notNull(),
  maxHour: integer('max_hour').notNull(),
  // D-04: text[] para dias da semana
  allowedDays: text('allowed_days').array().notNull(),
  // D-05: timezone IANA como text
  timezone: text('timezone').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### Novas colunas em leads (tables.ts)

```typescript
// Source: D-10, D-11 em CONTEXT.md — adicionar ao pgTable('leads', {...})
fupEnabled: boolean('fup_enabled').notNull().default(false),
fupStep: integer('fup_step').notNull().default(0),
// nullable — sem .notNull()
fupNextAt: timestamp('fup_next_at', { withTimezone: true }),
lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
```

### Migration SQL 0007_v1_4_foundation.sql

```sql
-- Source: padrão de 0001_lazy_deathstrike.sql e 0006_leads_cols_remove_users.sql
CREATE TABLE "knowledge_chunks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "collection" text NOT NULL,
    "content" text NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "embedding_model" text NOT NULL,
    "chunk_index" integer NOT NULL,
    "total_chunks" integer NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fup_config" (
    "brain_type" text PRIMARY KEY NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "intervals_seconds" integer[] NOT NULL,
    "min_hour" integer NOT NULL,
    "max_hour" integer NOT NULL,
    "allowed_days" text[] NOT NULL,
    "timezone" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fup_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fup_step" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fup_next_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_message_at" timestamptz;
```

### Entrada no _journal.json

```json
{
  "idx": 7,
  "version": "7",
  "when": 1750000000000,
  "tag": "0007_v1_4_foundation",
  "breakpoints": true
}
```

### touchLastMessage() no LeadService

```typescript
// Source: padrão de setFullpp() e setIaAtivada() em lead-service.ts
async touchLastMessage(uniqueId: string): Promise<void> {
  await this.db
    .update(leads)
    .set({ lastMessageAt: new Date() })
    .where(eq(leads.uniqueId, uniqueId));
}
```

---

## Validation Architecture

`nyquist_validation: true` em `.planning/config.json` — seção obrigatória.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (nativo — sem config file) |
| Config file | Nenhum — Bun detecta automaticamente |
| Quick run command | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` |
| Full suite command | `bun test packages/core packages/database` |

### Phase Requirements → Test Map

| Req ID | Comportamento | Tipo de Teste | Comando Automatizado | Arquivo Existe? |
|--------|---------------|--------------|----------------------|-----------------|
| FUP-04 | `leads` tem colunas `fup_enabled`, `fup_step`, `fup_next_at`, `last_message_at` | unit (schema) | `bun test packages/database/src/migrate.test.ts` | ✅ (existente, não cobre novas colunas) |
| FUP-06 | `touchLastMessage()` atualiza `last_message_at` via `db.update().set()` | unit | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | ✅ (existente, não tem o método ainda) |
| FUP-06 | `BrainRunner.run()` chama `touchLastMessage()` ANTES do gate `ia_ativada` | unit | `bun test packages/core/src/runner/__tests__/` | ❌ Wave 0 |

### Sampling Rate

- **Por commit de task:** `bun test packages/core/src/leads/__tests__/lead-service.test.ts`
- **Por wave merge:** `bun test packages/core packages/database`
- **Phase gate:** Suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/runner/__tests__/runner-touchlastmessage.test.ts` — cobre chamada a `touchLastMessage()` em `BrainRunner.run()` (novo arquivo)
- [ ] Atualizar `packages/core/src/leads/__tests__/lead-service.test.ts` — adicionar testes de `touchLastMessage()` e atualizar mock do schema com novas colunas

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Testes + execução | ✓ | 1.3.2 | — |
| drizzle-orm | Schema + migrations | ✓ | 0.45.2 | — |
| PostgreSQL (runtime) | Migration de banco | ✓ (dev local) | — | — |

[VERIFIED: bun --version = 1.3.2; packages/database/package.json]

Sem dependências ausentes que bloqueiem a fase — é código puro e arquivo SQL estático.

---

## Assumptions Log

| # | Claim | Seção | Risco se Errado |
|---|-------|-------|-----------------|
| A1 | `timestamp('col', { withTimezone: true })` em Drizzle 0.45.x gera `TIMESTAMPTZ` no SQL | Code Examples | Baixo — workaround: usar `sql\`timestamptz\`` com `customType` ou escrever TIMESTAMPTZ direto na migration SQL (já feito) e manter `timestamp()` sem `withTimezone` no schema TS, aceitando ligeira inconsistência de tipos |
| A2 | `_journal.json` sem snapshot correspondente não quebra `runMigrations()` em produção | Pitfall 1 | Baixo — o `migrate()` do drizzle lê journal + SQLs, não snapshots; snapshots são para CLI apenas |

---

## State of the Art

| Abordagem Anterior | Abordagem Atual | Quando Mudou | Impacto |
|-------------------|----------------|--------------|---------|
| Migrations via `drizzle-kit generate` | Migrations SQL manuais | Desde Phase 1 do projeto | Controle total sobre DDL; sem conflitos de snapshot |
| UUID PK em todas as tabelas | `text PRIMARY KEY` para `fup_config` | D-02 (phase 19) | Upsert por brain_type sem JOIN em UUID; simplifica queries |

---

## Sources

### Primary (HIGH confidence)
- `packages/database/src/schema/tables.ts` — schema existente, padrões de coluna e tabela
- `packages/database/src/migrations/0001_lazy_deathstrike.sql` — padrão CREATE TABLE manual
- `packages/database/src/migrations/0006_leads_cols_remove_users.sql` — padrão ADD COLUMN
- `packages/database/src/migrations/meta/_journal.json` — próximo idx = 7
- `packages/core/src/leads/lead-service.ts` — padrão de update atômico
- `packages/core/src/runner/runner.ts` — ponto de inserção de touchLastMessage()
- `packages/database/package.json` — versões de dependências
- `/root/Brain/node_modules/.bun/drizzle-orm@0.45.2/.../pg-core/columns/common.d.ts` — API `.array()`
- `/root/Brain/node_modules/.bun/drizzle-orm@0.45.2/.../pg-core/columns/index.d.ts` — exports disponíveis
- `.planning/phases/19-database-foundation/19-CONTEXT.md` — todas as decisões D-01 a D-16

### Tertiary (LOW confidence — assumptions)
- A1: `timestamp({ withTimezone: true })` → TIMESTAMPTZ [ASSUMED — não verificado em docs Drizzle 0.45.x]

---

## Metadata

**Confidence breakdown:**
- Schema Drizzle (tabelas, colunas, arrays): HIGH — verificado diretamente nos type definitions instalados
- Migration SQL (DDL, padrões): HIGH — verificado contra migrations existentes no repo
- LeadService touchLastMessage(): HIGH — padrão idêntico a setFullpp() e setIaAtivada() existentes
- BrainRunner ponto de inserção: HIGH — linha exata verificada em runner.ts
- timestamp withTimezone: ASSUMED — LOW, mas risco mínimo (migration usa TIMESTAMPTZ diretamente)

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stack estável, sem mudanças esperadas em drizzle-orm 0.45.x)
