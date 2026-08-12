# Phase 33: Seed por Tipo de Brain - Pattern Map

**Mapped:** 2026-08-12
**Files analyzed:** 9 (new/modified)
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|----------------|
| `packages/database/src/seeds/sdr/*.sql` | migration/seed | CRUD (idempotent INSERT) | `packages/database/src/migrations/0005_brain_sdr_prompts.sql` | exact |
| `packages/database/src/seeds/support/*.sql` | migration/seed | CRUD (idempotent INSERT) | `packages/database/src/migrations/0010_brain_support_prompts.sql` | exact |
| `packages/database/src/seeds/echo/*.sql` | migration/seed | CRUD (idempotent INSERT) | `packages/database/src/migrations/0002_echo_brain_seed.sql` | exact |
| `packages/database/src/seed.ts` (`runBrainSeed()`) | service/utility | file-I/O + CRUD | `packages/database/src/migrate.ts` (`runMigrations()`) | role-match (same file, same package, sibling function) |
| `packages/core/src/runner/runner.ts` (modify `init()`) | controller/lifecycle | request-response (startup sequence) | same file, existing `runMigrations()` call block (lines ~130-165) | exact (same file, insert-after pattern) |
| `packages/core/src/fup/fup-scheduler.ts` (modify `FupSchedulerOptions` + send path, D-10) | service | event-driven / streaming (poll loop) | same file, `_generateFupMessage`/`_sendFupWebhook` (lines ~284-330) | exact (same file, extend existing method) |
| `apps/brain-sdr/Dockerfile`, `apps/brain-support/Dockerfile`, `apps/brain-echo/Dockerfile` (add `COPY seeds/<type>` + `SEEDS_FOLDER` ENV) | config | file-I/O | existing `COPY .../migrations` + `ENV MIGRATIONS_FOLDER` block (`brain-sdr/Dockerfile:93-102`) | exact |
| `apps/brain-{sdr,support,echo}/.env.example` (add `SEEDS_FOLDER`) | config | — | existing `MIGRATIONS_FOLDER` line in same file | exact |
| Fail-fast validation inside `runBrainSeed()` (SELECT check, D-08/D-09) | utility (assertion) | request-response | `BrainRunner.init()` promptKeys fail-fast loop (`runner.ts` ~lines 183-195) | exact (philosophy/structure copy, not same file) |

## Pattern Assignments

### `packages/database/src/seeds/<brainType>/*.sql` (migration/seed, CRUD)

**Analog:** `packages/database/src/migrations/0005_brain_sdr_prompts.sql` (also `0002_echo_brain_seed.sql`, `0010_brain_support_prompts.sql` — all three share the identical idiom)

**Full pattern to copy** (`0005_brain_sdr_prompts.sql:1-13`):
```sql
-- Seed: prompts do Brain SDR
-- D-09: Prompts inseridos via migration SQL — cliente atualiza no banco sem deploy
-- ON CONFLICT DO NOTHING garante idempotência (seguro rodar múltiplas vezes)
-- CRÍTICO: brain_type = 'sdr' deve ser idêntico a sdrBrain.brainType em brain.ts
-- Se divergir, BrainRunner.init() lança process.exit(1) por missing prompt key

INSERT INTO prompts (brain_type, key, content)
VALUES (
  'sdr',
  'system',
  '...'
)
ON CONFLICT (brain_type, key) DO NOTHING;
```

**What's new for this phase:** each `<brainType>` seed folder gets an additional `INSERT INTO fup_config (...) ON CONFLICT (brain_type) DO NOTHING` and `INSERT INTO prompts (brain_type, key, content) VALUES (<type>, 'fup', '...') ON CONFLICT (brain_type, key) DO NOTHING`, using the exact `ON CONFLICT` idiom above. The `fup_config` PK is `brain_type` alone (not a composite), so its conflict target is `(brain_type)`:
```sql
INSERT INTO fup_config (brain_type, enabled, intervals_seconds, min_hour, max_hour, allowed_days, timezone)
VALUES ('sdr', true, ARRAY[3600, 86400, 259200], 8, 18, ARRAY['mon','tue','wed','thu','fri'], 'America/Sao_Paulo')
ON CONFLICT (brain_type) DO NOTHING;
```
Values match `fupConfig` schema in `packages/database/src/schema/tables.ts:134-149` and the test fixture defaults at `packages/core/src/leads/__tests__/lead-service.test.ts:218` (`{ enabled: true, intervalsSeconds: [3600], minHour: 8, maxHour: 18, allowedDays: ["mon","tue","wed","thu","fri"], timezone: "America/Sao_Paulo" }` — D-02/D-03 use `[3600, 86400, 259200]` instead of `[3600]`).

**CRITICAL — do NOT reuse migration numbering/journal.** These new files are NOT drizzle-tracked (Pitfall 1/3): no entry in `packages/database/src/migrations/meta/_journal.json`, not copied into `packages/database/src/migrations/`. They live in a sibling `seeds/` tree read by the new `runBrainSeed()` function, not by `runMigrations()`/drizzle's `migrate()`.

---

### `packages/database/src/seed.ts` — `runBrainSeed(sql, brainType, seedsFolder)` (service, file-I/O + CRUD)

**Analog:** `packages/database/src/migrate.ts` — `runMigrations()` (full file, `migrate.ts:1-102`)

**Imports pattern** (`migrate.ts:1-3`):
```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from 'postgres';
```
For `runBrainSeed()`, swap the drizzle migrator import for plain file-reading (`fs.readdir`/`fs.readFile` + `sql.unsafe()` or per-file `sql.file()`), since this is NOT drizzle-tracked DDL — it's raw idempotent SQL executed directly against the injected `Sql`.

**Function signature + doc-comment convention** (`migrate.ts:21-30`):
```typescript
/**
 * Exportável: chamado pelo entrypoint de apps/brain-echo no startup.
 * Recebe Sql injetado — sem criar nova conexão.
 * Lança erro em caso de falha (o caller decide se faz process.exit).
 */
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
```
Copy this exact shape for `runBrainSeed(sql: Sql, brainType: string, seedsFolder: string): Promise<void>` — same "receives injected Sql, throws on failure, caller decides process.exit" contract used throughout `BrainRunner.init()`.

**Row-lock reuse — IMPORTANT:** Do NOT create a second lock table. D-09 requires the fail-fast validation to run "no mesmo lock/escopo do resto do seed — uma vez por deploy." The existing `_schema_lock` row-lock (`migrate.ts:33-34, 47-58`) already serializes all instances against concurrent startup; the cleanest place to call `runBrainSeed()` is either (a) inside the same `sql.begin(async (tx) => {...})` block in `runMigrations()` right after `await migrate(db, { migrationsFolder })` — reusing the lock without any new locking code — or (b) as a distinct call in `BrainRunner.init()` immediately after `runMigrations()` resolves, relying on the fact only one instance's `runMigrations()` call actually executes the lock-holding branch. Prefer (a) if `runBrainSeed()` needs the same tx-scoped guarantee; the CONTEXT.md D-09 note explicitly flags this as an open implementation decision — Claude's Discretion.

**Error handling pattern** (`migrate.ts:60-74` — retry-then-throw shape):
```typescript
} catch (err: unknown) {
  if (isLockNotAvailable(err) && attempt < MAX_RETRIES - 1) { ... continue; }
  if (isLockNotAvailable(err)) { throw new Error(`...`); }
  throw err; // Outros erros — propagar imediatamente
}
```

**Fail-fast SELECT validation (D-08/D-09) — analog:** copy the philosophy/structure of `BrainRunner.init()`'s promptKeys loop (`runner.ts` ~183-195):
```typescript
for (const key of this.brain.promptKeys) {
  if (!(key in this.prompts)) {
    this.logger.error({ brainId: this.brain.id, brainType: this.brain.brainType, missingKey: key },
      "Missing prompt key — cannot start Brain");
    process.exit(1);
  }
}
```
`runBrainSeed()` should end with an equivalent `SELECT` for `fup_config WHERE brain_type = $1` and `prompts WHERE brain_type = $1 AND key = 'fup'`, throwing (not `process.exit` — this is a library function, the caller `BrainRunner.init()` already has the `process.exit(1)` convention on `.catch()`, see below) a loud `Error` if either is missing.

---

### `packages/core/src/runner/runner.ts` — call `runBrainSeed()` in `init()` (controller/lifecycle)

**Analog:** same file's existing `runMigrations()` call block, `runner.ts:141-149`:
```typescript
const migrationsFolder = this.migrationsFolder ?? process.env.MIGRATIONS_FOLDER;
if (!migrationsFolder) {
  this.logger.error({ brainId: this.brain.id }, 'MIGRATIONS_FOLDER not set — cannot run migrations');
  process.exit(1);
}
await runMigrations(this.sql, migrationsFolder).catch((err: unknown) => {
  this.logger.error({ brainId: this.brain.id, err }, 'Migrations failed — aborting init');
  process.exit(1);
});
this.logger.info({ brainId: this.brain.id }, 'Migrations completed');
```
Copy this exact block shape for `SEEDS_FOLDER`/`runBrainSeed()`, inserted immediately after (same fail-fast `.catch()` → `process.exit(1)` convention), and BEFORE `this.prompts = await loadPrompts(...)` (`runner.ts:180`) — ordering matters per D-08 (seed must land before the promptKeys fail-fast check that follows at `runner.ts:183-195`).

**Import to add** (mirrors `runner.ts:11`):
```typescript
import { runMigrations } from "@brain-pkg/database";
// add:
import { runBrainSeed } from "@brain-pkg/database";
```

---

### `packages/core/src/fup/fup-scheduler.ts` — D-10 checkpoint persistence (service, event-driven)

**Analog:** same file, `FupSchedulerOptions` interface (`fup-scheduler.ts:43-49`):
```typescript
export interface FupSchedulerOptions {
  sql: Sql;
  brainType: string;
  checkpointer: ICheckpointerLike;
  eventPublisher: IEventPublisher | null;
  fupWebhookUrl: string;
}
```
Add a new field, e.g. `injectMessage: (threadId: string, content: string) => Promise<void>` — a callback, not the raw `compiledGraph`, to keep `FupScheduler` decoupled from LangGraph internals (matches how `checkpointer` is already narrowed to `ICheckpointerLike` rather than the full LangGraph checkpointer type).

**Call-site pattern to copy — `BrainRunner.injectMessage()`** (`runner.ts:287-305`):
```typescript
async injectMessage(threadId: string, content: string): Promise<void> {
  if (!this.compiledGraph) {
    throw new ConfigurationError("BrainRunner.init() must be called before injectMessage()", { brainId: this.brain.id });
  }
  await this.compiledGraph.updateState(
    { configurable: { thread_id: threadId } },
    { messages: [new AIMessage(content)] }
  );
  this.logger.info({ brainId: this.brain.id, threadId }, "Debug message injected into thread checkpoint");
}
```
When instantiating `FupScheduler` in `runner.ts:219-226`, pass `injectMessage: this.injectMessage.bind(this)` (or an inline arrow) as the new option — `compiledGraph` already exists in that scope from `_compileGraph()` at `runner.ts:203`, so no new wiring beyond this bind.

**Send-path integration point** (`fup-scheduler.ts:172-173`, inside `_processFupForLead`):
```typescript
const message = await this._generateFupMessage(lead, fupPrompt);
await this._sendFupWebhook(lead, message);
// NEW: also persist to checkpoint
await this.opts.injectMessage(lead.uniqueId, message);
```
Add the new call right after `_sendFupWebhook()` succeeds, before the `UPDATE leads SET fup_step = ...` block — same message string used for both the webhook payload and the checkpoint injection, avoiding a second LLM call.

**Error handling convention already in place for this method** (`fup-scheduler.ts:250-260`, the retry loop) — the new `injectMessage()` call should be wrapped so a checkpoint-write failure does NOT abort an otherwise-successful FUP send (webhook already delivered); log-and-continue, matching the existing `eventPublisher.publish([...]).catch(...)` fire-and-forget-with-warn pattern at `fup-scheduler.ts:222-228`:
```typescript
this.opts.eventPublisher.publish([fupEvent]).catch((err: unknown) => {
  this.logger.warn({ err, eventId: fupEvent.event_id }, "FUP EVT-03 publish falhou — ignorando");
});
```

---

### Dockerfiles — `apps/brain-{sdr,support,echo}/Dockerfile` (config, file-I/O)

**Analog:** existing `COPY .../migrations` + `ENV MIGRATIONS_FOLDER` block (`apps/brain-sdr/Dockerfile:93-102`):
```dockerfile
# Migrations SQL — NÃO estão em dist/, DEVEM ser copiadas explicitamente (Pitfall 1)
# Copiadas para /app/migrations/ — path configurado via ENV MIGRATIONS_FOLDER
COPY --from=builder /app/packages/database/src/migrations ./migrations

# Variáveis de ambiente padrão
ENV PORT=3000
ENV NODE_ENV=production
# MIGRATIONS_FOLDER: informa ao runner.ts onde encontrar os arquivos SQL em runtime
ENV MIGRATIONS_FOLDER=/app/migrations
```
Add, immediately after — **critically, copying ONLY that Brain's own subfolder** (Pitfall 3 — physical separation, not just query filtering):
```dockerfile
# Seed per-brain-type — SÓ o subfolder deste tipo, nunca a árvore completa (Pitfall 3)
COPY --from=builder /app/packages/database/src/seeds/sdr ./seeds
ENV SEEDS_FOLDER=/app/seeds
```
(`support`/`echo` Dockerfiles use `seeds/support` / `seeds/echo` respectively — same block shape.)

**Verification idiom to note in the plan** (from PITFALLS.md Pitfall 3): after building, `find /app -name "*.sql" | xargs grep <other-type>` should return zero hits inside a given Brain's image.

---

### `.env.example` files (config)

**Analog:** existing `MIGRATIONS_FOLDER` documentation line in each app's `.env.example` (same file, parallel ENV). Add `SEEDS_FOLDER=../../packages/database/src/seeds/<type>` (local-dev path) mirroring however `MIGRATIONS_FOLDER` is documented for local dev in that file.

## Shared Patterns

### Idempotent seed INSERT (`ON CONFLICT DO NOTHING`)
**Source:** `packages/database/src/migrations/0002_echo_brain_seed.sql`, `0005_brain_sdr_prompts.sql`, `0010_brain_support_prompts.sql`
**Apply to:** all 3 new `packages/database/src/seeds/<brainType>/*.sql` files — both the relocated prompt seeds and the new `fup_config`/`key='fup'` rows.

### Fail-fast startup validation
**Source:** `packages/core/src/runner/runner.ts` promptKeys loop (~183-195) and the `MIGRATIONS_FOLDER` missing-ENV check (~141-146)
**Apply to:** `runBrainSeed()`'s D-08/D-09 post-seed `SELECT` assertion, and the new `SEEDS_FOLDER` missing-ENV check in `BrainRunner.init()`.

### Injected-Sql, throw-not-exit library function contract
**Source:** `packages/database/src/migrate.ts::runMigrations()` doc-comment (`migrate.ts:21-25`: "Recebe Sql injetado ... Lança erro em caso de falha (o caller decide se faz process.exit)")
**Apply to:** `runBrainSeed()` — same package, same contract; the `process.exit(1)` decision stays in `BrainRunner.init()`'s `.catch()`, not inside `packages/database`.

### Fire-and-forget-with-warn for non-critical side effects
**Source:** `fup-scheduler.ts:222-228` (`eventPublisher.publish(...).catch(...)`)
**Apply to:** the new checkpoint-injection call in `_processFupForLead()` (D-10) — a failure to persist to checkpoint must not fail the overall FUP send, which already succeeded via webhook.

## No Analog Found

None — every file in scope has a direct or near-direct analog already in the codebase (this phase is explicitly additive/parallel to existing, well-established seed and lifecycle patterns).

## Metadata

**Analog search scope:** `packages/database/src/migrations/`, `packages/database/src/migrate.ts`, `packages/core/src/runner/runner.ts`, `packages/core/src/fup/fup-scheduler.ts`, `packages/core/src/prompts/loader.ts`, `packages/core/src/leads/lead-service.ts` + test fixtures, `packages/database/src/schema/tables.ts`, `apps/brain-{sdr,support,echo}/Dockerfile`
**Files scanned:** 13
**Pattern extraction date:** 2026-08-12
