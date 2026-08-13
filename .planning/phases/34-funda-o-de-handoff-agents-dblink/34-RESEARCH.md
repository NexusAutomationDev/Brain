# Phase 34: Fundação de Handoff (Agents + DBLink) - Research

**Researched:** 2026-08-13
**Domain:** PostgreSQL schema migrations (Drizzle ORM), extension bootstrap, isolated data-access module design
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `agents` table columns: `name text PRIMARY KEY` (what the LLM's tool will reference — configurable, never a code enum, per Pitfall 12), `brain_type text NOT NULL` (destination type, observability/logging), `connection_string text NOT NULL`, `enabled boolean NOT NULL DEFAULT true`, `created_at`/`updated_at timestamp NOT NULL DEFAULT now()`. Reversibility: costly.
- **D-02:** `connection_string` replaces the `base_url`+`admin_token` pair from `ARCHITECTURE.md` §Part B's original sketch — that sketch assumed the HTTP mechanism the research recommended; the user confirmed DBLink instead (D-05), so the correct column is a connection string usable by `dblink`/`dblink_exec` (libpq `key=value` format, e.g. `host=... port=... dbname=... user=... password=...` — **not** a `postgres://` URI; dblink is a C extension using libpq, not a Node client). Exact format confirmation is deferred to Phase 35 research/implementation — Phase 34 only needs an unvalidated `text` column.
- **D-03 (accepted risk):** `connection_string` stored in plain text (no encryption-at-rest) — same security posture already accepted for `ADMIN_TOKEN`/`DATABASE_URL` (plain ENV vars) and `fup_config`/`prompts` (SQL-editable, no UI). Not a new gap introduced by this phase; document as accepted risk in this phase's security review, same pattern as T-33-02/T-33-04.
- **D-04:** `CREATE EXTENSION IF NOT EXISTS dblink;` and the `agents` table DDL (plus the new nullable `leads.handoff_context text` column) live in a NEW migration in the shared `packages/database/src/migrations/` folder (next available tag: `0012_...`, since the last is `0011_gemini_highdim_halfvec_3072`), applied by the existing Drizzle migrator (`runMigrations()`/`_schema_lock`). Does **NOT** use Phase 33's per-brain-type seed mechanism (`runBrainSeed()`) — `agents`/`dblink`/`handoff_context` are genuinely shared schema across all Brain types (any Brain can be a handoff source or destination), unlike brain-type-scoped prompt/fup_config seeds. Reversibility: one-way — once applied in production it's a real migration in Drizzle's journal; revert requires a new rollback migration, not just deleting the file.
- **D-05 (locked, carried forward — do NOT re-litigate):** Handoff is **DBLINK-based** (source Brain writes directly into the destination's `leads` table via `dblink`, using the connection string stored in `agents`), **not** the HTTP-endpoint-first design `ARCHITECTURE.md` §Part B recommended. User-confirmed, recorded in `STATE.md`. The HTTP endpoint becomes HANDOFF-11 (v2, deferred). `PITFALLS.md` Pitfall 5's "How to avoid" and Pitfalls 6-11's HTTP-specific mitigations must be **re-derived for DBLink** by whoever plans Phase 35 — they do not apply verbatim. This does not affect Phase 34 itself (no transfer logic is built here).
- **D-06:** Build a small, testable lookup function now (e.g. `packages/database/src/agents.ts` — `getAgentConnection(sql, name)`) that resolves: unknown name → clear rejection (`{ok:false, reason:'not_found'}`); name with `enabled=false` → clear rejection (`{ok:false, reason:'disabled'}`); valid+enabled name → returns connection string + brain_type. **No** wiring into any tool/LLM yet — that's Phase 35. This is what makes the phase "validable in isolation."
- **D-07:** Reads are always live (direct query on every call), never snapshotted at compile time — same principle `ARCHITECTURE.md` recommends for the `agents` registry (avoids the "need a /reload-prompts-style call for a new agent to work" bug class).
- **D-08:** Phase 34 has no code that consumes `thread_id` (no tool exists yet — that's Phase 35). HANDOFF-10 is captured here as a **documented, locked constraint for Phase 35 to follow**, not code to write in this phase. Phase 34 verification should treat HANDOFF-10 as "documented for Phase 35 — N/A in code this phase," not as unsatisfied. Phase 35 must apply the same D-04 pattern already used by `pause-session.ts`/`finish-conversation.ts` (thread_id from `config.configurable.thread_id`, never a tool argument).

### Claude's Discretion

- Exact migration filename and lookup module name (`agents.ts` vs. another name) — follow existing conventions (`seed.ts`, `migrate.ts`).
- Whether `leads.handoff_context` and the `agents` table land in the same physical migration file or two — doesn't affect any requirement.
- Exact TypeScript return shape of `getAgentConnection()` (discriminated union vs. throw) — follow whichever idiom (`seed.ts`'s throw, or `lead-service.ts`'s structured return) is more consistent with Phase 35's future call site.

### Deferred Ideas (OUT OF SCOPE)

No new scope-creep ideas surfaced during the `--auto` context session. HANDOFF-11 (optional HTTP endpoint), HANDOFF-12 (bidirectional handoff), HANDOFF-13 (hop limit), HANDOFF-14 (admin UI) are already documented as v2/out-of-scope in `REQUIREMENTS.md` — not new.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HANDOFF-01 | Tabela `agents` armazena os agentes de destino conhecidos por um Brain (nome, tipo, connection string do banco destino), configurável via SQL direto sem redeploy | §Standard Stack / §Code Examples give the exact Drizzle table definition consistent with `tables.ts` idiom; §Architecture Patterns explains why this lives in the shared migrations folder, not the Phase 33 seed mechanism |
| HANDOFF-02 | `CREATE EXTENSION IF NOT EXISTS dblink` faz parte da migration padrão compartilhada — não depende mais de ativação manual por banco | §Architecture Patterns (Pattern 1) proves via drizzle-orm's own migrator source that this can safely live inside a normal migration file (transaction-safe, no type-dependency ordering issue unlike `vector`); §Common Pitfalls documents the superuser/trusted-extension requirement and why it's already satisfied by the existing DB role |
| HANDOFF-04 | A tool valida o nome do agente destino contra a tabela `agents` (nome desconhecido ou `enabled=false` retorna erro, sem transferir) | §Code Examples gives the `getAgentConnection()` skeleton with the three-way rejection contract; §Testable lookup function pattern maps it to the existing `seed.ts`/`lead-service.ts` idioms and the exact `__tests__/unit` + `__tests__/integration` test shape to reuse |
| HANDOFF-10 | `thread_id` do lead é sempre lido do contexto de execução (nunca do argumento da tool/LLM) | N/A in this phase's code (D-08) — §Architecture Patterns documents the `pause-session.ts`/`finish-conversation.ts` precedent Phase 35 must follow; no action required from Phase 34's plan beyond carrying this constraint forward in its own RESEARCH.md/PLAN.md for Phase 35 to inherit |
</phase_requirements>

## Summary

This phase is a narrow, purely-additive PostgreSQL schema change applied through the project's existing Drizzle migration pipeline (`runMigrations()`/`_schema_lock`), plus one small, dependency-free TypeScript module. Nothing here touches `BrainRunner`, tools, transport, or any runtime request path — which is exactly what makes it "validable in isolation" per the phase goal.

Three concrete artifacts satisfy the four requirements: (1) a new migration `0012_*.sql`, generated via `drizzle-kit generate` against a `tables.ts` addition (`agents` table + `leads.handoff_context` nullable column) with a hand-added `CREATE EXTENSION IF NOT EXISTS dblink;` statement; (2) `packages/database/src/agents.ts` exporting `getAgentConnection(sql, name)`, mirroring `seed.ts`'s "plain async function, `Sql` injected, no class" shape; (3) tests under `packages/database/src/__tests__/unit/` (mocked `sql`, mirrors `seed.test.ts`'s `mockSql`/`beginCalls`-free simple `.select()` mock) and `__tests__/integration/` (real Postgres, `TEST_DATABASE_URL`-gated, mirrors `seed-idempotency.test.ts`'s `describeOrSkip` pattern).

The one finding that most changes how this phase should be planned: reading `drizzle-orm`'s own `pg-core/dialect.js` shows `migrate()` wraps **all pending migrations into a single database transaction** (not one transaction per file). This means `CREATE EXTENSION IF NOT EXISTS dblink` can safely sit in the same migration file as the `agents` table DDL — no `vector`-style type-dependency workaround is needed, because `dblink` only provides functions (used later, at runtime, by Phase 35's `dblink_exec` calls), never a column type referenced by this migration's own DDL. It also means splitting extension bootstrap and table DDL into two separate migration files buys **no fault isolation** (a permission failure on `CREATE EXTENSION dblink` still rolls back the whole batch, including the harmless `agents` table creation, on a brand-new database's first boot) — so use one migration file for simplicity, matching the project's own `0007_v1_4_foundation.sql` precedent (multiple tables + column adds bundled together).

**Primary recommendation:** Add `agents` + `leads.handoff_context` to `tables.ts`, run `drizzle-kit generate`, hand-insert `CREATE EXTENSION IF NOT EXISTS dblink;` as the first statement of the generated `0012_*.sql` file (rename it to something descriptive, e.g. `0012_agents_dblink_handoff_context.sql`, matching the project's rename-after-generate convention), then implement `getAgentConnection()` as a plain function in `packages/database/src/agents.ts`, exported from `index.ts`, tested with the same mock-`sql` unit pattern as `seed.test.ts` plus a `TEST_DATABASE_URL`-gated integration test.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `agents` table (destination registry) | Database / Storage | — | Pure persistence; no application logic owns its shape beyond the schema definition itself |
| `dblink` extension bootstrap | Database / Storage | API / Backend (migration code) | The artifact (Postgres extension) lives in the DB tier, but the bootstrap trigger is backend code (`runMigrations()`) that already owns this responsibility for `vector` |
| `leads.handoff_context` column | Database / Storage | — | Additive schema-only change; consumption (read + clear) is explicitly Phase 35, not this phase |
| `getAgentConnection()` lookup function | API / Backend | Database / Storage | Application-level business logic (three-way rejection contract: not_found / disabled / ok) sitting directly on top of a live DB query — same tier as `LeadService` and `seed.ts` |

## Standard Stack

### Core

No new packages are introduced by this phase. Everything needed already exists in the monorepo at these pinned, currently-installed versions:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 (installed, confirmed via `node_modules`) | Schema definition + migrator | Already the project's ORM; `agents`/`handoff_context` follow the exact same `pgTable`/`text`/`boolean`/`timestamp` idiom as `fupConfig`/`leads` |
| `drizzle-kit` | 0.31.10 (installed, confirmed via `node_modules`) | `drizzle-kit generate` — snapshot-diff migration file generation | Already the project's migration generator; produces the next `meta/0012_snapshot.json` + SQL file from the `tables.ts` diff |
| `postgres` (postgres.js) | 3.4.9 (installed) | Runtime `Sql` type + tagged-template queries | Already the project's Postgres driver; `getAgentConnection(sql, name)` takes the same injected `Sql` type as `runBrainSeed`/`LeadService` |
| PostgreSQL server | 16.x/17.x (project uses `pgvector/pgvector:pg17` and `:pg14` images in observed deployments) `[VERIFIED: local Docker image inspection]` | Runtime database | Already the project's DB; `dblink` ships as a standard Postgres **contrib** module bundled with the same server image already in use — no separate install step, no new Docker base image |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun:test` (built-in) | Bun 1.3.x (installed: `1.3.2`) | Unit + integration tests | Already the project's test runner; no config needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A hand-written `CREATE EXTENSION IF NOT EXISTS dblink` inside a normal Drizzle-generated migration file | Hardcoding it in `migrate.ts` (the `vector` precedent) | The `vector` precedent hardcodes the extension in `migrate.ts` because `vector` is a **type** referenced by column definitions inside the same-transaction `CREATE TABLE` statements, historically deemed safer to bootstrap outside the migrator's own transaction. `dblink` has no such type dependency (it only exposes functions, consumed later at runtime by Phase 35 — never by this migration's own DDL), so it can safely live inside a normal versioned migration file instead. D-04 already locks this choice; this note exists purely to explain *why* the precedent differs without contradicting it. |
| One migration file bundling `dblink` + `agents` + `handoff_context` | Two separate migration files | No practical benefit: `drizzle-orm`'s migrator batches **all pending migrations into one transaction** (see §Architecture Patterns), so splitting buys zero fault isolation. One file is simpler and matches the `0007_v1_4_foundation.sql` precedent (multiple tables + column adds bundled). |

**Installation:**

No `npm`/`bun add` install step is required — `dblink` is not an npm package (searching npm for "dblink" surfaces unrelated JavaScript packages that are **not** what this phase needs). It is a native PostgreSQL contrib extension, already compiled into the project's Postgres Docker image (confirmed present at `/usr/local/share/postgresql/extension/dblink.control` in the same image layer as `vector.control`). Enabling it is a single SQL statement (`CREATE EXTENSION IF NOT EXISTS dblink;`), not a package install.

**Version verification:** N/A — no new dependency versions to verify. `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, and `postgres@3.4.9` are already pinned and installed in this repo (confirmed via `node_modules/.bun/drizzle-orm@0.45.2/...` and `packages/database/package.json`).

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** `dblink` is a PostgreSQL server-side contrib extension enabled via SQL (`CREATE EXTENSION`), not an npm/pip/cargo package; no `package.json` dependency is added. The Package Legitimacy Gate protocol is skipped per its own scope ("whenever this phase installs external packages").

**Packages removed due to [SLOP] verdict:** none (N/A)
**Packages flagged as suspicious [SUS]:** none (N/A)

## Architecture Patterns

### System Architecture Diagram

```
tables.ts (schema source of truth)
   │  add: agents table, leads.handoff_context column
   ▼
`drizzle-kit generate`  ──────────────►  meta/0012_snapshot.json + 0012_*.sql (auto-diffed)
                                              │
                                              │  (hand-edit: insert
                                              │   CREATE EXTENSION IF NOT EXISTS dblink;
                                              │   as first statement, rename file descriptively)
                                              ▼
BrainRunner.init()  ──►  runMigrations(sql, MIGRATIONS_FOLDER)
                              │
                              ├─ CREATE TABLE IF NOT EXISTS _schema_lock (idempotent, outside tx)
                              ├─ INSERT ... ON CONFLICT DO NOTHING (idempotent, outside tx)
                              ├─ CREATE EXTENSION IF NOT EXISTS vector (existing, outside tx)
                              └─ sql.begin(tx => {
                                    SELECT ... FOR UPDATE NOWAIT   (row-lock acquisition)
                                    migrate(db, { migrationsFolder })
                                       └─ db.dialect.migrate():
                                            session.transaction(tx2 => {
                                              for each PENDING migration file (in journal order):
                                                for each statement in file:
                                                  tx2.execute(statement)      ◄── dblink + agents + handoff_context
                                                                                    land here, same nested transaction
                                                INSERT INTO __drizzle_migrations (hash, created_at)
                                            })
                                 })

Result on a fresh client DB, first boot:
  agents table exists (empty) ──► populated later via direct SQL INSERT by ops (no UI, no redeploy)
  dblink extension available  ──► consumed later by Phase 35's dblink_exec() calls (not this phase)
  leads.handoff_context exists (NULL for all rows) ──► read/cleared later by Phase 35 (not this phase)

getAgentConnection(sql, name) — isolated, testable, NOT wired to anything yet:
  SELECT * FROM agents WHERE name = $1
     no row            → { ok: false, reason: 'not_found' }
     row, enabled=false → { ok: false, reason: 'disabled' }
     row, enabled=true  → { ok: true, connectionString, brainType }
```

### Recommended Project Structure

```
packages/database/src/
├── schema/
│   └── tables.ts          # add: export const agents = pgTable(...); add handoffContext column to leads
├── migrations/
│   ├── 0012_agents_dblink_handoff_context.sql   # new — generated + hand-edited
│   └── meta/
│       ├── _journal.json  # new entry idx=12
│       └── 0012_snapshot.json  # auto-generated by drizzle-kit
├── agents.ts               # new — getAgentConnection(sql, name)
├── index.ts                # add: export { getAgentConnection } from './agents.js';
└── __tests__/
    ├── unit/
    │   └── agents.test.ts           # mocked sql, mirrors seed.test.ts's mock shape
    └── integration/
        └── agents.integration.test.ts  # real Postgres, TEST_DATABASE_URL-gated, mirrors seed-idempotency.test.ts
```

### Pattern 1: Extension bootstrap inside a versioned migration file is transaction-safe for `dblink` (unlike the historical `vector` workaround)

**What:** `drizzle-orm`'s postgres-js dialect (`pg-core/dialect.js`, confirmed by direct source read in this repo's `node_modules`) wraps **every pending migration file** into a single `session.transaction(async (tx) => { for await (const migration of migrations) { for (const stmt of migration.sql) { await tx.execute(...) } } })`. This means all statements in `0012_agents_dblink_handoff_context.sql` — including `CREATE EXTENSION IF NOT EXISTS dblink;` — run inside one Postgres transaction, and `CREATE EXTENSION` is standard transactional DDL (no `CONCURRENTLY`-style restriction applies).

**When to use:** Any time a migration needs to guarantee an extension exists before/alongside DDL that depends on it. Here, `agents`/`handoff_context` don't actually reference any `dblink`-provided type (dblink only exposes *functions*, consumed later at runtime by Phase 35 — never referenced by this migration's own column definitions), so there isn't even a strict statement-ordering requirement — but placing `CREATE EXTENSION` first in the file, before the table DDL, is still good practice and matches how a human reading the file would expect dependencies declared.

**Why this differs from the `vector` precedent:** `migrate.ts` hardcodes `await sql\`CREATE EXTENSION IF NOT EXISTS vector\`;` **outside** `runMigrations()`'s own row-lock transaction, run every single time `runMigrations()` is called (not inside any specific migration file) — this exists because `vector` is a **column type** (`vector(1536)`) referenced directly inside `0000_lyrical_scrambler.sql`'s own `CREATE TABLE "embeddings"` statement, and the codebase's historical author evidently wanted that guarantee decoupled from the migrator's own transaction/session boundary. `dblink` has no such type dependency — D-04 already locks the correct choice (inside the new migration file), and this pattern entry exists only to explain why the two extensions are bootstrapped differently without suggesting `dblink` should be moved to `migrate.ts` too.

**Example:**
```sql
-- Source: packages/database/src/migrations/0007_v1_4_foundation.sql (existing precedent for
-- bundling multiple CREATE TABLE + ALTER TABLE statements in one migration file)
-- packages/database/src/migrations/0012_agents_dblink_handoff_context.sql

CREATE EXTENSION IF NOT EXISTS dblink;
--> statement-breakpoint
CREATE TABLE "agents" (
	"name" text PRIMARY KEY NOT NULL,
	"brain_type" text NOT NULL,
	"connection_string" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "handoff_context" text;
```

### Pattern 2: `agents` table Drizzle schema definition

**What:** Follows the exact same idiom already used by `fupConfig` (text primary key, no separate UUID) and `leads` (nullable text columns, `boolean().notNull().default(...)`, `timestamp().defaultNow().notNull()`).

**When to use:** This is the literal schema addition for HANDOFF-01.

**Example:**
```typescript
// Source: modeled directly on packages/database/src/schema/tables.ts's existing fupConfig
// and leads table conventions (text PK pattern from fupConfig, nullable-text pattern from leads.nome)

// HANDOFF-01: agents — registro de destinos conhecidos por um Brain, populável via SQL direto
// D-01: name como PK (o que a tool do LLM referenciará — configurável, nunca enum de código)
export const agents = pgTable('agents', {
  name: text('name').primaryKey(),
  brainType: text('brain_type').notNull(),
  // D-02: formato libpq key=value ("host=... dbname=... user=... password=..."),
  // NÃO uma URI postgres:// — dblink é uma extensão C que usa libpq, não um client Node.
  // Sem parsing/validação de formato nesta fase (Phase 35 cuida disso).
  connectionString: text('connection_string').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

And the additive column on `leads`:
```typescript
// Add to the existing leads pgTable definition (packages/database/src/schema/tables.ts:77-110)
// HANDOFF-01/02: handoff_context nullable — populated by Phase 35's transfer_lead tool,
// read + cleared by the destination Brain on its next inbound message (Phase 35, not this phase).
handoffContext: text('handoff_context'),
```

### Pattern 3: Testable, always-live lookup function (`getAgentConnection`)

**What:** A plain async function (not a class) taking an injected `Sql`, mirroring `seed.ts`'s "no class, `Sql` injected, throw-or-return" shape rather than `LeadService`'s class-with-constructor shape — `seed.ts` is the closer analog per D-06/D-07 because it, too, is a standalone, DB-agnostic function with zero wiring into `BrainRunner` in its first landed form.

**When to use:** HANDOFF-04's validation logic, and the one function Phase 35's `transfer_lead` tool will call directly.

**Example:**
```typescript
// Source: modeled on packages/database/src/seed.ts's plain-function-with-injected-Sql shape,
// and packages/core/src/leads/lead-service.ts's discriminated-return idiom is avoided here in
// favor of a Result-object return (matches D-06's literal {ok:false, reason:...} contract)

import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { agents } from './schema/tables.js';
import type { Sql } from 'postgres';

export type AgentConnectionResult =
  | { ok: true; connectionString: string; brainType: string }
  | { ok: false; reason: 'not_found' | 'disabled' };

/**
 * HANDOFF-04/D-06/D-07: Resolve um nome de agente destino contra a tabela `agents`.
 * Leitura sempre live (sem snapshot em compile-time) — nova linha em `agents` fica
 * imediatamente utilizável, sem qualquer /reload equivalente.
 *
 * Query parametrizada via Drizzle (eq()) — nunca interpolação de string — previne SQL injection
 * mesmo que `name` venha eventualmente de um argumento de tool validado pelo LLM (Phase 35).
 *
 * @param sql - postgres.js Sql instance do tenant (injetado, sem criar nova conexão)
 * @param name - nome do agente destino (agents.name, PK)
 */
export async function getAgentConnection(sql: Sql, name: string): Promise<AgentConnectionResult> {
  const db = drizzle(sql);
  const rows = await db.select().from(agents).where(eq(agents.name, name)).limit(1);
  const row = rows[0];

  if (!row) {
    return { ok: false, reason: 'not_found' };
  }
  if (!row.enabled) {
    return { ok: false, reason: 'disabled' };
  }
  return { ok: true, connectionString: row.connectionString, brainType: row.brainType };
}
```

### Anti-Patterns to Avoid

- **Snapshotting `agents` rows at `_compileGraph()`/startup time:** Would reintroduce the exact staleness bug class `ARCHITECTURE.md` explicitly warns against for this table (D-07) — a newly-inserted agent wouldn't become usable without an equivalent of `/reload-prompts`. Always query live.
- **Interpolating `name` directly into a raw SQL string instead of using Drizzle's `eq()`:** SQL injection risk, however unlikely given `name` originates from a tool-call argument in Phase 35. Always parameterize.
- **Reusing `runBrainSeed()`/the per-brain-type seed mechanism for this schema:** D-04 explicitly rules this out — `agents`/`dblink`/`handoff_context` are shared across all Brain types, not brain-type-scoped content like `fup_config`/prompt seeds.
- **Hardcoding a `dblink`-specific type dependency ordering that doesn't exist:** Unlike `vector`, `dblink` provides no column type — there is no risk of "CREATE TABLE referencing a not-yet-created type" here, so no special same-transaction-ordering workaround (like `migrate.ts`'s pre-transaction `vector` bootstrap) is needed for `dblink`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Which Postgres extension provides cross-database SQL execution" | A custom npm dependency search for "dblink" client libraries | The native PostgreSQL `dblink` contrib extension already bundled in the project's Postgres Docker image | `dblink` is server-side C code exposed via SQL functions, not a client library; no npm package is the right tool here — searching npm for "dblink" only surfaces unrelated JS packages |
| Idempotent, retry-safe schema application | A bespoke migration runner for this one new file | The existing `runMigrations()`/`_schema_lock` mechanism, completely untouched | D-04 already locks this; `runMigrations()` already handles row-locking, retry-on-`55P03`, and idempotent `_schema_lock` bootstrap — a new migration file is a pure input to a mechanism that already exists |
| Result/rejection shape for "is this a valid, enabled destination" | A custom exception hierarchy or generic boolean | The `{ok:false, reason:'not_found'|'disabled'}` / `{ok:true,...}` discriminated union shown in Code Examples | Matches D-06's literal contract; keeps the eventual Phase 35 tool handler's error branching simple and matches existing structured-return idioms already in the codebase (`isErrorToolResult()` convention in `event-publisher.ts`) |

**Key insight:** Every artifact this phase needs already has a nearly-identical precedent somewhere in `packages/database` (`fupConfig` for the table shape, `seed.ts` for the function shape, `migrate.ts`'s `vector` bootstrap for the extension-bootstrap question). The main risk isn't "what pattern to invent" — it's correctly reusing the *closest* existing pattern rather than a superficially-similar but wrong one (e.g. copying `LeadService`'s class shape when `seed.ts`'s plain-function shape is the better fit here).

## Common Pitfalls

### Pitfall 1: `dblink` is not a "trusted" extension — `CREATE EXTENSION dblink` requires superuser, same as `vector` already does

**What goes wrong:** If the Brain's `DATABASE_URL` role is not a Postgres superuser (and `dblink` has not already been installed by a DBA), `CREATE EXTENSION IF NOT EXISTS dblink;` fails with a permission error. Because `drizzle-orm`'s migrator batches **all pending migrations into one transaction** (confirmed by direct source read of `pg-core/dialect.js` in this repo), that failure rolls back the *entire* migration batch — on a brand-new client database's first boot, that means `agents` and `leads.handoff_context` (both harmless, permission-safe DDL) also fail to apply, and the Brain does not start at all (`runMigrations()`'s existing throw-not-exit contract propagates the error to `BrainRunner.init()`).

**Why it happens:** `dblink`'s extension control file (confirmed by direct read of `dblink.control` inside this project's actual `pgvector/pgvector:pg17` Docker image layer, at `/usr/local/share/postgresql/extension/dblink.control`) has **no** `trusted = true` line — meaning it defaults to `superuser = true`, same as PostgreSQL's default for any extension that isn't explicitly marked trusted.

**How to avoid:** This is **not a new risk introduced by this phase** — `vector.control` in the same Docker image layer *also* has no `trusted = true` line, and `CREATE EXTENSION IF NOT EXISTS vector` already runs successfully today via `migrate.ts` for every currently-deployed Brain instance (confirmed via `apps/brain-sdr/.env.example`'s `DATABASE_URL=postgresql://postgres:...`, using the default Postgres superuser role from the standard `postgres`/`pgvector` Docker image). Since `dblink` requires the exact same privilege level `vector` already successfully uses in production, no new operational precondition needs to be introduced. The only actionable step: don't assume some future non-standard deployment (e.g. a restricted, non-superuser managed-Postgres role) will "just work" — if that scenario ever arises, it already breaks `vector` today, so document the superuser requirement once, generally, rather than solving it narrowly for `dblink`.

**Warning signs:** A fresh client database's first `runMigrations()` call throwing a Postgres `permission denied to create extension "dblink"` error — verify the `DATABASE_URL` role is superuser before assuming this migration is broken.

### Pitfall 2: Never log `agents.connection_string` — it's a plaintext credential

**What goes wrong:** `connection_string` embeds a plaintext libpq password (D-03, accepted risk for storage — but that acceptance doesn't extend to observability/logs). If `getAgentConnection()`'s result, or any future debug/error path, logs the full row or the full `AgentConnectionResult` object via `pino` (the project's structured logger), the destination's DB password leaks into log aggregation.

**Why it happens:** It's easy to `console.log`/`logger.info(row)` an entire query result while debugging, especially once Phase 35 wires this into a tool that also needs to log its own success/failure for observability.

**How to avoid:** Only log `agents.name` and `agents.brain_type` (both safe, non-secret identifiers) — never `connectionString`. This phase's own tests should assert that no test fixture accidentally treats `connectionString` as loggable/safe-to-print output.

**Warning signs:** Any test assertion or debug statement that does a wholesale `JSON.stringify(row)` / `console.log(agentRow)` without explicitly picking safe fields.

### Pitfall 3: `dblink`'s functions are PUBLIC-executable by default once the extension is created

**What goes wrong:** PostgreSQL grants `EXECUTE` on newly-created extension functions to `PUBLIC` by default (unless explicitly revoked). Once `dblink`/`dblink_exec` exist in a database, **any** role that can connect to that database can call them — including using stored `agents.connection_string` values to reach arbitrary hosts if a SQL-injection vector ever existed elsewhere in the app.

**Why it happens:** This is standard, well-documented PostgreSQL extension-function default behavior — most developers don't realize function-level grants default to `PUBLIC`.

**How to avoid:** Not a Phase 34 blocker today — this project currently uses exactly one DB role per tenant (`postgres`, already effectively trusted with everything). Flag as a forward-looking note for Phase 35/future hardening: if the project ever introduces a lower-privileged application role distinct from the migration-owning role, consider `REVOKE EXECUTE ON FUNCTION dblink_exec(text) FROM PUBLIC;` scoped to that role split. Not required now; document as an open question for future security review, not a Phase 34 task.

**Warning signs:** N/A for this phase (no code exercises `dblink_exec` yet) — surfaced here so Phase 35's research doesn't have to rediscover it.

### Pitfall 4: `migrate.test.ts` and the new test's location — don't perpetuate a pre-`__tests__/` convention file

**What goes wrong:** `packages/database/src/migrate.test.ts` sits directly in `src/`, not under `__tests__/unit/` or `__tests__/integration/` — it predates (or was never migrated to) the project's current test-folder convention documented in `CLAUDE.md` and already followed by every Phase 33 test file (`seed.test.ts`, `seed-cross-brain-isolation.test.ts`, `migration-v14.test.ts`, `seed-idempotency.test.ts`, all correctly under `__tests__/unit` or `__tests__/integration`).

**Why it happens:** Copy-pasting the nearest physically-adjacent test file (`migrate.test.ts`) as a starting template, rather than the nearest *convention-compliant* one (`seed.test.ts`), would silently reproduce the legacy location.

**How to avoid:** Model the new `getAgentConnection()` unit test's **mock shape** after `migrate.test.ts`/`seed.test.ts`'s `mockSql` pattern, but its **file location** after `seed.test.ts`/`seed-cross-brain-isolation.test.ts`'s `__tests__/unit/` placement. Do not create a new top-level `agents.test.ts` next to `agents.ts`.

**Warning signs:** A new `*.test.ts` file appearing directly under `packages/database/src/` instead of under `__tests__/unit/` or `__tests__/integration/`.

### Pitfall 5 (carried forward from PITFALLS.md, still directly relevant): Hardcoding destination agent names defeats the "configurable names" requirement

**What goes wrong:** Building `agents.name` as a real, data-driven column (this phase) is necessary but not sufficient — Phase 35's tool-schema/prompt design must not reintroduce a hardcoded enum of valid destination names anywhere (e.g. a Zod `z.enum([...])` on the tool's `destination` argument, or a TypeScript union type).

**Why it happens:** Enums feel type-safe and are a natural LLM-tool-schema instinct, but any static enum silently reintroduces the exact seed-drift bug class Phase 33 was built to fix, just for `agents` instead of prompts.

**How to avoid:** This phase's own `agents` table + `getAgentConnection()` already satisfy the requirement correctly (D-01, D-06/D-07 — always a live DB query, never a compiled list). This pitfall is recorded here purely so Phase 35's plan doesn't regress it when designing the `transfer_lead` tool's Zod schema (`destination: z.string()`, not `z.enum([...])`).

**Warning signs:** Any `z.enum(['support','sdr','echo'])`-shaped tool argument schema appearing in Phase 35's plan.

## Code Examples

### Migration file (complete)

```sql
-- Source: modeled on packages/database/src/migrations/0007_v1_4_foundation.sql (bundling
-- multiple CREATE TABLE + ALTER TABLE statements in one file) and the project's own
-- CREATE EXTENSION precedent in packages/database/src/migrate.ts (for vector)
-- packages/database/src/migrations/0012_agents_dblink_handoff_context.sql

CREATE EXTENSION IF NOT EXISTS dblink;
--> statement-breakpoint
CREATE TABLE "agents" (
	"name" text PRIMARY KEY NOT NULL,
	"brain_type" text NOT NULL,
	"connection_string" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "handoff_context" text;
```

### Unit test skeleton for `getAgentConnection()`

```typescript
// Source: modeled on packages/database/src/__tests__/unit/seed.test.ts's mockSql pattern
// (simpler here: no sql.begin()/tx needed, getAgentConnection() does a single SELECT)
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let selectResult: unknown[] = [];

// drizzle(sql).select().from(agents).where(...).limit(1) chain — mock at the drizzle level
// rather than the raw sql tagged-template level, mirroring how simple single-query reads
// are typically tested versus seed.ts's multi-statement transaction shape.
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

describe('getAgentConnection() — HANDOFF-04', () => {
  beforeEach(() => {
    selectResult = [];
  });

  it('nome desconhecido retorna {ok:false, reason:"not_found"}', async () => {
    selectResult = [];
    const result = await getAgentConnection({} as never, 'unknown-agent');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('nome com enabled=false retorna {ok:false, reason:"disabled"}', async () => {
    selectResult = [{ name: 'support', brainType: 'support', connectionString: 'host=x', enabled: false }];
    const result = await getAgentConnection({} as never, 'support');
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });

  it('nome válido e enabled=true retorna connectionString + brainType', async () => {
    selectResult = [{ name: 'support', brainType: 'support', connectionString: 'host=x dbname=y', enabled: true }];
    const result = await getAgentConnection({} as never, 'support');
    expect(result).toEqual({ ok: true, connectionString: 'host=x dbname=y', brainType: 'support' });
  });
});
```

### Integration test skeleton (real Postgres, gated)

```typescript
// Source: modeled on packages/database/src/__tests__/integration/seed-idempotency.test.ts's
// describeOrSkip + TEST_DATABASE_URL gating convention
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { getAgentConnection } from '../../agents.js';

const TEST_DB_URL = process.env.POSTGRES_URL ?? process.env.TEST_DATABASE_URL;
const describeOrSkip = TEST_DB_URL ? describe : describe.skip;

describeOrSkip('getAgentConnection() — integration (HANDOFF-04)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL as string, { prepare: false });
    await sql`INSERT INTO agents (name, brain_type, connection_string, enabled)
      VALUES ('test-agent-enabled', 'support', 'host=x dbname=y', true)
      ON CONFLICT (name) DO NOTHING`;
    await sql`INSERT INTO agents (name, brain_type, connection_string, enabled)
      VALUES ('test-agent-disabled', 'support', 'host=x dbname=y', false)
      ON CONFLICT (name) DO NOTHING`;
  });

  afterAll(async () => {
    await sql`DELETE FROM agents WHERE name IN ('test-agent-enabled', 'test-agent-disabled')`;
    await sql.end();
  });

  test('nome inexistente → not_found', async () => {
    const result = await getAgentConnection(sql, 'does-not-exist');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('nome disabled → disabled', async () => {
    const result = await getAgentConnection(sql, 'test-agent-disabled');
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });

  test('nome válido e enabled → connectionString + brainType', async () => {
    const result = await getAgentConnection(sql, 'test-agent-enabled');
    expect(result).toEqual({ ok: true, connectionString: 'host=x dbname=y', brainType: 'support' });
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Handoff modeled as HTTP endpoint + admin-token client (`ARCHITECTURE.md` §Part B original recommendation) | DBLink-based direct cross-database write, connection string stored in `agents` | User decision during Phase 34's `/gsd-discuss-phase` session (D-05), recorded in `STATE.md` | `agents` table shape changes from `base_url`+`admin_token` to `connection_string`; no HTTP client/endpoint code is built in this phase or the next |
| `agents` table sketch used `base_url text NOT NULL` + `admin_token text NOT NULL` | `connection_string text NOT NULL` (libpq key=value format) | Same D-05 override | Directly affects this phase's schema — D-01/D-02 already reflect the corrected shape |

**Deprecated/outdated:**
- `ARCHITECTURE.md` §Part B's HTTP-endpoint mechanism recommendation, `handoff-client.ts`, `BrainRunner.receiveHandoff()`, `POST /api/v1/handoff` — all superseded by the DBLink decision; only the `agents` table's existence-motivation and "configurable names" reasoning from that doc remain valid, per CONTEXT.md's explicit caveat.
- `PITFALLS.md` Pitfall 5's "How to avoid" and Pitfalls 6-11's HTTP-specific mitigation guidance — written assuming the now-rejected HTTP model; must be re-derived for DBLink, not reused verbatim, whenever Phase 35 is researched.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Every currently-deployed Brain instance's `DATABASE_URL` role is Postgres superuser (inferred from `apps/brain-sdr/.env.example`'s `postgres:...` user and the fact that `CREATE EXTENSION vector` already succeeds in production) | Common Pitfalls #1 | If some deployed instance actually uses a restricted, non-superuser role today (undetected because `vector` was bootstrapped once, long ago, by a DBA out-of-band), `CREATE EXTENSION dblink` could fail on that specific instance even though `vector` "already works" there. Low risk (docker-compose `.env.example` files consistently show the `postgres` superuser account), but not independently re-verified against a live production database in this research session. |
| A2 | `dblink.control`'s absence of a `trusted = true` line in the project's actual `pgvector/pgvector:pg17` Docker image (confirmed via direct file read) implies `superuser = true` (the documented PostgreSQL default) | Standard Stack / Common Pitfalls #1 | This is a well-documented PostgreSQL default behavior (`trusted` defaults to `false`, `superuser` defaults to `true`), verified against the actual project image's control file — very low risk, but the "implies superuser" inference itself relies on documented PostgreSQL defaults, not an explicit `superuser = true` line observed in the file. |

**If this table is empty:** N/A — see entries above; both are low-risk inferences, not unverified guesses, but flagged per the provenance rule since neither was tested by actually attempting `CREATE EXTENSION dblink` as a non-superuser role against a live Brain database in this research session.

## Open Questions (RESOLVED)

1. **RESOLVED — Exact `connection_string` format Phase 35 will require (host/port/dbname/user/password field completeness, SSL mode, etc.)**
   - What we know: it must be a libpq `key=value` string, not a `postgres://` URI (D-02).
   - What's unclear: whether Phase 35 will need `sslmode`, `connect_timeout`, or other libpq params baked into the stored string, and whether any validation/parsing should happen at write-time (SQL INSERT time, by ops) vs. read-time (Phase 35's `dblink_exec` call).
   - Recommendation (closes this question for Phase 34's scope): Phase 34 stores it as an unvalidated `text` column exactly as D-02 specifies — defer format validation entirely to Phase 35, where the actual `dblink_exec` call site will surface any format issues immediately and concretely.

2. **RESOLVED — Whether any currently-deployed Brain instance uses a non-superuser `DATABASE_URL` role (see Assumption A1)**
   - What we know: all `.env.example` files in this repo show the `postgres` superuser account or the `pgvector`/`postgres` official Docker image defaults.
   - What's unclear: whether any live client deployment has since been reconfigured with a restricted role (outside this repo's visibility).
   - Recommendation (closes this question for Phase 34's scope): no Phase 34 code change is needed either way — if this ever surfaces as a real deployment failure, the fix is operational (grant the role superuser, or have a DBA pre-install `dblink`/`vector` once), not a schema/code change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL server (local/dev) | Integration tests (`TEST_DATABASE_URL`-gated) | ✗ (not running in this research session — `pg_isready` returned "no response" on `localhost:5432`) | psql client 16.14 present | Integration tests are already designed to skip gracefully (`describeOrSkip`) when no test DB is configured — no blocker for planning or unit tests |
| Docker | Local Postgres via `pgvector/pgvector:pg17`/`:pg14` images | ✓ | Docker Engine 29.4.1 | — |
| `dblink` Postgres contrib extension | HANDOFF-02 | ✓ (confirmed present in the project's actual Postgres Docker image at `/usr/local/share/postgresql/extension/dblink.control`) | 1.2 (per control file `default_version`) | — |
| `drizzle-kit` CLI | Generating migration `0012_*` | ✓ | 0.31.10 (installed) | — |
| Bun runtime | Running `bun test` | ✓ | 1.3.2 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local test Postgres instance not currently running — integration tests skip gracefully; spin up `docker compose`/a local Postgres before running `bun test` in `packages/database` if integration coverage is desired during execution.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun 1.3.2, built-in, Jest-compatible API) |
| Config file | none — Bun's test runner needs no config file |
| Quick run command | `cd packages/database && bun test src/__tests__/unit/agents.test.ts` |
| Full suite command | `cd packages/database && bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HANDOFF-01 | `agents` table has correct columns/PK/defaults | unit (schema/migration content assertion, mirrors `migration-v14.test.ts`) | `bun test src/__tests__/integration/migration-0012.test.ts` | ❌ Wave 0 |
| HANDOFF-02 | Migration file contains `CREATE EXTENSION IF NOT EXISTS dblink` | unit (SQL file content assertion, mirrors `migration-v14.test.ts`) | `bun test src/__tests__/integration/migration-0012.test.ts` | ❌ Wave 0 |
| HANDOFF-04 | `getAgentConnection()` returns correct not_found/disabled/ok results | unit (mocked `sql`) | `bun test src/__tests__/unit/agents.test.ts` | ❌ Wave 0 |
| HANDOFF-04 | `getAgentConnection()` against a real inserted/disabled/missing row | integration (`TEST_DATABASE_URL`-gated) | `bun test src/__tests__/integration/agents.integration.test.ts` | ❌ Wave 0 |
| HANDOFF-10 | N/A in this phase's code (D-08 — documented constraint only) | manual-only (documentation review) | N/A — verify Phase 35's plan carries this constraint forward | N/A |

### Sampling Rate

- **Per task commit:** `bun test src/__tests__/unit/agents.test.ts` (fast, mocked, no DB needed)
- **Per wave merge:** `bun test` (full `packages/database` suite, includes integration tests if `TEST_DATABASE_URL` is set)
- **Phase gate:** Full suite green (or integration tests explicitly, gracefully skipped with `TEST_DATABASE_URL` unset — documented, not a silent gap) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/database/src/__tests__/unit/agents.test.ts` — covers HANDOFF-04 (mocked)
- [ ] `packages/database/src/__tests__/integration/agents.integration.test.ts` — covers HANDOFF-04 (real DB, gated)
- [ ] `packages/database/src/__tests__/integration/migration-0012.test.ts` — covers HANDOFF-01/HANDOFF-02 (file-content assertions, mirrors `migration-v14.test.ts`; no live DB needed)
- [ ] Framework install: none — `bun:test` already configured, no new setup needed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new authentication surface in this phase |
| V3 Session Management | No | No session concept touched |
| V4 Access Control | Partial | `agents.enabled` flag is the access-control gate for HANDOFF-04 (a disabled destination is rejected); no new role/permission model introduced |
| V5 Input Validation | Yes | `getAgentConnection(sql, name)` must use Drizzle's parameterized `eq()` (never raw string interpolation) — see Code Examples |
| V6 Cryptography | Deferred (accepted risk, D-03) | `connection_string` stored in plain text, consistent with existing `ADMIN_TOKEN`/`DATABASE_URL` posture — documented, not solved, in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via `name` argument to `getAgentConnection()` | Tampering | Parameterized query via Drizzle's `eq(agents.name, name)` — never string-interpolated raw SQL (see Code Examples, Pattern 3) |
| Credential leakage of `connection_string` via logs/observability (`pino`) | Information Disclosure | Never log the full `agents` row or `AgentConnectionResult` object — only log `name`/`brainType` (see Common Pitfalls #2) |
| Lateral movement via `dblink`'s default-PUBLIC function grants once installed | Elevation of Privilege | Not exploitable today (single DB role per tenant); documented as a forward-looking note for Phase 35/future role-separation hardening (see Common Pitfalls #3) — no action required in Phase 34 |
| Migration-batch failure blocking Brain startup on privilege-restricted deployments | Denial of Service | Documented operational precondition (DB role must be superuser, already implicitly required by the pre-existing `vector` extension) — see Common Pitfalls #1 |

## Sources

### Primary (HIGH confidence)

- Direct source read: `node_modules/.bun/drizzle-orm@0.45.2/node_modules/drizzle-orm/pg-core/dialect.js` (confirms migrator batches all pending migrations into one transaction) `[VERIFIED: local node_modules inspection]`
- Direct file read: `dblink.control` and `vector.control` inside this project's actual `pgvector/pgvector:pg17` Docker image layer at `/var/lib/docker/overlay2/.../usr/local/share/postgresql/extension/` `[VERIFIED: local Docker image layer inspection]`
- Direct file reads: `packages/database/src/schema/tables.ts`, `packages/database/src/migrate.ts`, `packages/database/src/seed.ts`, `packages/database/src/migrations/*.sql`, `packages/database/src/migrations/meta/_journal.json`, `packages/database/src/__tests__/**/*.test.ts`, `packages/database/src/migrate.test.ts`, `packages/core/src/tools/pause-session.ts`, `packages/core/src/tools/finish-conversation.ts`, `packages/core/src/leads/lead-service.ts`, `packages/database/drizzle.config.ts`, `packages/database/package.json` `[VERIFIED: local codebase inspection]`
- Local environment probes: `docker images`/`docker ps -a` (confirms `pgvector/pgvector:pg17`/`:pg14` in active use), `psql --version` (16.14), `bun --version` (1.3.2), `pg_isready` (no local server running) `[VERIFIED: local environment inspection]`

### Secondary (MEDIUM confidence)

- PostgreSQL official docs on `dblink_connect`/trusted extensions, cross-referenced with the direct control-file read above `[CITED: postgresql.org/docs/current/contrib-dblink-connect.html, postgresql.org/docs/13/extend-extensions.html]`

### Tertiary (LOW confidence)

- General web-search summaries on PgBouncer transaction-mode + `dblink`/session-state interaction — inconclusive, flagged as forward-looking context for Phase 35 (not load-bearing for this phase's schema-only scope) `[ASSUMED — not independently verified against a live PgBouncer + dblink test in this session]`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every artifact modeled on an existing, directly-read precedent in this exact codebase
- Architecture: HIGH — the single most consequential claim (migrator batches all migrations in one transaction) was verified by reading `drizzle-orm`'s own installed source code, not inferred
- Pitfalls: HIGH for the extension-privilege finding (verified via direct control-file read against the actual project Docker image); MEDIUM for the `dblink`-function-PUBLIC-grant forward-looking note (well-documented Postgres behavior, not independently re-tested against a live DB in this session)

**Research date:** 2026-08-13
**Valid until:** 2026-09-12 (30 days — stable domain: Postgres extension semantics and this repo's own migration conventions change slowly; re-verify only if `drizzle-orm`/`drizzle-kit` are upgraded before Phase 34 executes)
