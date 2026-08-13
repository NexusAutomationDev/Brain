# Phase 34: Fundação de Handoff (Agents + DBLink) - Pattern Map

**Mapped:** 2026-08-13
**Files analyzed:** 6 (2 schema/migration artifacts, 1 lookup module, 3 test files)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `packages/database/src/schema/tables.ts` (add `agents` table + `leads.handoffContext` column) | model (Drizzle schema) | CRUD | `packages/database/src/schema/tables.ts` — existing `fupConfig`/`leads` definitions in the same file | exact (same file, additive) |
| `packages/database/src/migrations/0012_agents_dblink_handoff_context.sql` (+ `meta/_journal.json` entry, `meta/0012_snapshot.json`) | migration | batch/DDL | `packages/database/src/migrations/0007_v1_4_foundation.sql` | exact |
| `packages/database/src/agents.ts` (`getAgentConnection(sql, name)`) | service/utility (plain function, injected `Sql`) | request-response (single SELECT lookup) | `packages/database/src/seed.ts` (`runBrainSeed`) | role-match (closest "plain function + injected Sql" idiom in this package) |
| `packages/database/src/index.ts` (add `export { getAgentConnection } from './agents.js'`) | config/barrel | — | `packages/database/src/index.ts` (existing `runBrainSeed` export line) | exact |
| `packages/database/src/__tests__/unit/agents.test.ts` | test (unit) | request-response | `packages/database/src/__tests__/unit/seed.test.ts` | role-match (mock-`sql`/mock-module shape; simpler here — single SELECT, no `tx`/`begin`) |
| `packages/database/src/__tests__/integration/agents.integration.test.ts` | test (integration) | request-response | `packages/database/src/__tests__/integration/seed-idempotency.test.ts` | exact (same `describeOrSkip`/`TEST_DB_URL` gating idiom) |
| `packages/database/src/__tests__/integration/migration-0012.test.ts` | test (integration, file-content assertions, no live DB needed) | batch | `packages/database/src/__tests__/integration/migration-v14.test.ts` | exact |

## Pattern Assignments

### `packages/database/src/schema/tables.ts` (model, CRUD)

**Analog:** same file — `fupConfig` (lines 134-150) and `leads` (lines 77-110)

**Text-PK table idiom to copy** (`fupConfig`, lines 134-138):
```typescript
export const fupConfig = pgTable('fup_config', {
  // D-02: text PK — sem UUID separado
  brainType: text('brain_type').primaryKey(),
  // D-16: ativação por brain_type sem deletar intervalos/horários
  enabled: boolean('enabled').notNull().default(true),
```
This is the direct precedent for `agents.name` as `text().primaryKey()` (D-01) instead of a `uuid().primaryKey().defaultRandom()` id — the project already has exactly one other table (`fupConfig`) that intentionally uses a `text` PK instead of the more common `uuid` pattern seen in `memories`/`prompts`/`leads`/`knowledgeChunks`.

**Nullable additive column idiom to copy** (`leads`, line 83, and the FUP-04 columns at lines 96-106):
```typescript
  // D-03: Nome nullable — primeira mensagem pode não incluir nome
  nome: text('nome'),
  ...
  fupNextAt: timestamp('fup_next_at', { withTimezone: true }),      // nullable por design
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }), // nullable por design (D-11)
```
`leads.handoffContext: text('handoff_context')` (no `.notNull()`) follows this exact nullable-additive-column idiom — same file, same table, comment style documenting *why* it's nullable (consumed later, not this phase).

**Timestamp pair idiom** (used everywhere in this file, e.g. `fupConfig` lines 148-149):
```typescript
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
```

---

### `packages/database/src/migrations/0012_agents_dblink_handoff_context.sql` (migration, batch/DDL)

**Analog:** `packages/database/src/migrations/0007_v1_4_foundation.sql` (full file, 32 lines — read in full above)

**Bundling multiple `CREATE TABLE` + `ALTER TABLE` in one file, `--> statement-breakpoint` separators** (lines 1-31 of `0007_v1_4_foundation.sql`):
```sql
CREATE TABLE "knowledge_chunks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    ...
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fup_config" (
    "brain_type" text PRIMARY KEY NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    ...
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
Directly copy this shape for `0012_agents_dblink_handoff_context.sql`: `CREATE EXTENSION IF NOT EXISTS dblink;` first (own statement-breakpoint), then `CREATE TABLE "agents" (...)`, then `ALTER TABLE "leads" ADD COLUMN "handoff_context" text;` (nullable — no `DEFAULT`/`NOT NULL`, matching the `fup_next_at`/`last_message_at` nullable-column style, not the `fup_enabled`/`fup_step` NOT-NULL-with-default style).

**Journal entry idiom** (`meta/_journal.json`, lines 1-30 — pattern for the new idx=12 entry):
```json
{
  "idx": 2,
  "version": "7",
  "when": 1781352331000,
  "tag": "0002_echo_brain_seed",
  "breakpoints": true
},
```
Note `_journal.json` top-level `"version": "7"` is preserved; each entry needs `idx`, `version`, `when` (epoch ms), `tag` matching the SQL filename stem, `breakpoints: true`. Normally `drizzle-kit generate` produces this automatically — do not hand-write it unless the CLI is unavailable in the execution sandbox.

---

### `packages/database/src/agents.ts` (service/utility, request-response)

**Analog:** `packages/database/src/seed.ts` (full file, 108 lines — read in full above)

**Imports pattern** (lines 1-3 of `seed.ts`):
```typescript
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { Sql } from 'postgres';
```
`agents.ts` needs a different import set (no `fs`/`path` — it does a single query, not file reads), but should follow the same "type-only `Sql` import from `postgres`, no class" convention. RESEARCH.md's Pattern 3 code example already gives the concrete adaptation (`drizzle`, `eq`, `agents` schema import) — reuse that shape, not `seed.ts`'s literal imports.

**Plain-function-with-injected-`Sql`, no-class shape to copy** (`seed.ts` function signature, line 38, and its doc comment lines 23-37):
```typescript
/**
 * SEED-02/SEED-03: Seed por tipo de Brain — mecanismo separado de runMigrations(), NÃO
 * rastreado pelo drizzle. Chamado pelo BrainRunner.init() entre runMigrations() e loadPrompts().
 *
 * Recebe Sql injetado — sem criar nova conexão. Lança erro em caso de falha — a decisão de
 * terminar o processo cabe inteiramente ao caller (BrainRunner.init()), mesmo contrato
 * "throw-not-exit" de runMigrations().
 */
export async function runBrainSeed(sql: Sql, brainType: string, seedsFolder: string): Promise<void> {
```
`getAgentConnection(sql: Sql, name: string): Promise<AgentConnectionResult>` mirrors this exact signature idiom (injected `Sql` as first param, no class, no hidden connection creation) — but returns a discriminated-union `Result` object rather than throwing, per D-06's literal `{ok:false, reason:...}` contract (this is the one place `agents.ts` deliberately diverges from `seed.ts`'s throw-on-failure idiom, and CONTEXT.md's "Claude's Discretion" section explicitly sanctions this choice).

**Error handling pattern — NOT applicable to `getAgentConnection()` directly:** `seed.ts`'s retry/lock-error handling (`isLockNotAvailable`, `MAX_RETRIES` loop, lines 10-17 and 54-107) is a `_schema_lock`-specific concern for multi-writer migration/seed safety. `getAgentConnection()` is a single read-only `SELECT` with no lock contention — do not copy the retry loop. Its "error handling" is entirely the three-way discriminated return (not_found / disabled / ok) shown in RESEARCH.md's Pattern 3 code example — use that as the literal implementation, not `seed.ts`'s throw-based error handling.

---

### `packages/database/src/index.ts` (barrel/config)

**Analog:** same file (lines 15-16, existing `runBrainSeed` export)

**Export pattern to copy:**
```typescript
// Seed helper (SEED-02/SEED-03: per-brain-type seed, separate from drizzle migrations)
export { runBrainSeed } from './seed.js';
```
Add directly below it:
```typescript
// Agent lookup helper (HANDOFF-04: resolves agents.name → connection string, live query)
export { getAgentConnection } from './agents.js';
```
Note the file already does `export * from './schema/tables.js'` (line 2) — the new `agents` table export and `AgentConnectionResult` type do NOT need a separate manual export line if `agents.ts` only exports the function/type (schema re-export is automatic via the existing `export *`).

---

### `packages/database/src/__tests__/unit/agents.test.ts` (test, unit)

**Analog:** `packages/database/src/__tests__/unit/seed.test.ts` (full file, 278 lines — read in full above)

**Mock-`sql` / `mock.module()` shape to adapt** (`seed.test.ts` lines 40-75 show the heavier tagged-template + `.begin()`/`.unsafe()` mock needed for `runBrainSeed`'s transactional shape). For `getAgentConnection()`, RESEARCH.md's Code Examples section already gives the simpler, correct adaptation — mock at the `drizzle-orm/postgres-js` module level instead of the raw `sql` tagged-template level, since `getAgentConnection()` does a single `drizzle(sql).select().from().where().limit()` chain, not a multi-statement transaction:
```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let selectResult: unknown[] = [];

mock.module('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResult,
        }),
      }),
    }),
  }),
}));

import { getAgentConnection } from '../../agents.js';
```

**`beforeEach` reset idiom to copy** (`seed.test.ts` lines 30-38, 100-102):
```typescript
function resetMocks() {
  sqlCalls = [];
  ...
}
...
beforeEach(() => {
  resetMocks();
});
```
Adapt to `beforeEach(() => { selectResult = []; })`.

**Test-case structure to copy (describe/it naming in Portuguese, one `it` per rejection branch)** — mirror `seed.test.ts`'s `describe('runBrainSeed() — ...')` grouping style for `describe('getAgentConnection() — HANDOFF-04', ...)`, with three `it` blocks: not_found, disabled, ok (exact skeleton already given in RESEARCH.md's Code Examples — use it verbatim as the starting point).

**File location — do NOT copy `migrate.test.ts`'s location:** Per RESEARCH.md Pitfall 4, model the test's mock shape after `seed.test.ts`, but its **location** after `seed.test.ts`'s own placement (`__tests__/unit/`), not `packages/database/src/migrate.test.ts`'s legacy top-level-of-`src/` placement.

---

### `packages/database/src/__tests__/integration/agents.integration.test.ts` (test, integration)

**Analog:** `packages/database/src/__tests__/integration/seed-idempotency.test.ts` (full file, 81 lines — read in full above)

**`describeOrSkip` / `TEST_DB_URL` gating idiom to copy** (lines 12-17):
```typescript
const TEST_DB_URL = process.env.POSTGRES_URL ?? process.env.TEST_DATABASE_URL;

// Skip all integration tests gracefully when DB not available (avoids crashing unit test runs).
const describeOrSkip = TEST_DB_URL ? describe : describe.skip;
```

**`beforeAll`/`afterAll` real-Postgres setup/teardown-by-filter idiom to copy** (lines 37-63):
```typescript
beforeAll(async () => {
  sql = postgres(TEST_DB_URL as string, { prepare: false });
  ...
});

afterAll(async () => {
  // Cleanup rows created for all three synthetic brainTypes.
  for (const { brainType } of cases) {
    await sql`DELETE FROM fup_config WHERE brain_type = ${brainType}`;
    ...
  }
  await sql.end();
  await rm(fixturesRoot, { recursive: true, force: true });
});
```
For `agents.integration.test.ts`, adapt to: `INSERT INTO agents (...) ON CONFLICT (name) DO NOTHING` for fixture rows (`test-agent-enabled`, `test-agent-disabled`) in `beforeAll`, and `DELETE FROM agents WHERE name IN (...)` in `afterAll` — same filter-by-synthetic-identifier cleanup idiom, simpler here (no temp-directory fixture files needed since `getAgentConnection()` has no seed-file dependency). RESEARCH.md's Code Examples section already has the full concrete adaptation — use it directly.

---

### `packages/database/src/__tests__/integration/migration-0012.test.ts` (test, integration/file-content, no live DB)

**Analog:** `packages/database/src/__tests__/integration/migration-v14.test.ts` (full file, 77 lines — read in full above)

**File-content-assertion idiom to copy in full** (lines 1-30):
```typescript
import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');
const SQL_FILE = join(MIGRATIONS_DIR, '0007_v1_4_foundation.sql');
const JOURNAL_FILE = join(MIGRATIONS_DIR, 'meta/_journal.json');
const TABLES_FILE = join(import.meta.dir, '../../schema/tables.ts');

describe('Migration 0007_v1_4_foundation — scaffold (FUP-04)', () => {
  it('journal contém entry idx=7 com tag 0007_v1_4_foundation', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf-8'));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0007_v1_4_foundation');
    expect(entry).toBeDefined();
    expect(entry.idx).toBe(7);
  });

  it('arquivo SQL 0007_v1_4_foundation.sql existe', () => {
    expect(existsSync(SQL_FILE)).toBe(true);
  });

  it('SQL cria tabela knowledge_chunks', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('CREATE TABLE "knowledge_chunks"');
  });
  ...
  it('tables.ts exporta knowledgeChunks', () => {
    const source = readFileSync(TABLES_FILE, 'utf-8');
    expect(source).toContain('export const knowledgeChunks');
  });
});
```
For `migration-0012.test.ts`: same structure, pointed at `SQL_FILE = '0012_agents_dblink_handoff_context.sql'`, asserting: journal entry `idx=12`/tag matches filename; file exists; SQL contains `CREATE EXTENSION IF NOT EXISTS dblink`, `CREATE TABLE "agents"`, `"connection_string"`, `"brain_type"`, `"enabled"`, `ALTER TABLE "leads" ADD COLUMN "handoff_context"`; `tables.ts` exports `agents` and `leads` has `handoffContext`. This test needs no live DB (pure `fs` file-content assertions), matching HANDOFF-01/HANDOFF-02's "Wave 0 Gaps" entry in RESEARCH.md exactly.

---

## Shared Patterns

### Injected `Sql`, no class, no hidden connection creation
**Source:** `packages/database/src/seed.ts` (function signature, line 38) and `packages/database/src/migrate.ts` (function signature, line 30)
**Apply to:** `agents.ts`'s `getAgentConnection(sql: Sql, name: string)` — every DB-touching function in this package takes `Sql` as its first parameter; never construct a new `postgres()` connection inside a helper function.

### Parameterized queries only — never raw string interpolation
**Source:** RESEARCH.md Pattern 3 / Security Domain V5 — `eq(agents.name, name)` via Drizzle, not `sql.unsafe(...)` or template interpolation of `name`.
**Apply to:** `getAgentConnection()`. Contrast with `seed.ts`'s `tx.unsafe(content)` (line 67) — that is safe there only because `content` is literal, build-time file content, never a runtime argument; `agents.ts`'s `name` argument is data-driven and must always go through `eq()`.

### `_schema_lock`/idempotent-DDL pattern — reused, not modified
**Source:** `packages/database/src/migrate.ts` (lines 30-40) and `seed.ts` (lines 39-43)
**Apply to:** The new migration file needs no new lock mechanism — `runMigrations()`'s existing row-lock transaction wraps the new `0012_*.sql` file automatically, per D-04. Do not add any bespoke locking to `agents.ts` or the migration file.

### Test file location under `__tests__/unit/` or `__tests__/integration/`, never top-level `src/`
**Source:** `CLAUDE.md` §Conventions, reinforced by RESEARCH.md Pitfall 4 (contrasting `migrate.test.ts`'s legacy top-level placement with every Phase 33 test's correct placement)
**Apply to:** All three new test files in this phase.

### Never log/print the full `agents` row or `connectionString`
**Source:** RESEARCH.md Common Pitfalls #2, Security Domain
**Apply to:** `agents.ts` implementation and its tests — no `console.log`/`JSON.stringify` of the full row or `AgentConnectionResult`; only `name`/`brainType` are safe to log if any debug output is ever added.

## No Analog Found

None — every artifact in this phase's scope has a direct or role-matched analog in `packages/database`.

## Metadata

**Analog search scope:** `packages/database/src/` (schema, migrations, migrate.ts, seed.ts, index.ts, `__tests__/unit/`, `__tests__/integration/`) — scope explicitly bounded by RESEARCH.md's own analog identification; no broader repo search was needed since RESEARCH.md already named the exact files.
**Files scanned:** 9 (`seed.ts`, `tables.ts`, `migrate.ts`, `index.ts`, `0007_v1_4_foundation.sql`, `_journal.json`, `seed.test.ts`, `seed-idempotency.test.ts`, `migration-v14.test.ts`)
**Pattern extraction date:** 2026-08-13
