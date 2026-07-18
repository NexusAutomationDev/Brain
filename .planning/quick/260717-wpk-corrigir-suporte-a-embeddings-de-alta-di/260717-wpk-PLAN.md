---
phase: quick-260717-wpk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/database/src/schema/tables.ts
  - packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql
  - packages/database/src/migrations/meta/_journal.json
  - packages/database/src/migrations/meta/0011_snapshot.json
  - packages/database/src/migrations/0009_embedding_dimensions_fix.sql
autonomous: true
requirements: [QUICK-01]

must_haves:
  truths:
    - "Regenerating the Drizzle schema with EMBEDDING_DIMENSIONS=3072 produces a `halfvec(3072)` column with a `halfvec_cosine_ops` HNSW index for `embeddings`, and a `halfvec(3072)` column for `knowledge_chunks` — not `vector(3072)`, which pgvector rejects for HNSW above 2000 dimensions"
    - "The default (EMBEDDING_DIMENSIONS unset or <=2000, e.g. 1536/OpenAI) code path is byte-for-byte unchanged: `vector(N)` column + `vector_cosine_ops` index, confirmed by typecheck, lint, and the full existing `tables.test.ts` suite passing unmodified"
    - "A real `drizzle-kit generate` run at EMBEDDING_DIMENSIONS=3072 against the tracked migration history produces a migration that applies with zero SQL errors against a database currently at the production (post-0010, vector(1536)) schema state"
    - "`packages/core/src/runner/runner.ts`'s atttypmod-based dimension fail-fast check is empirically confirmed correct for halfvec(N) columns (typmod stores N directly, same as vector(N)) — no code change needed there"
    - "`0009_embedding_dimensions_fix.sql`'s SQL statements are unchanged (still emit vector(1536) unconditionally) — only its header comment gains a cross-reference to the new halfvec migration"
    - "The new migration file's header comment makes it unambiguous to a future engineer that it must NOT be copied into the standard `brain-sdr:1.5` (1536/OpenAI) image build"
  artifacts:
    - path: "packages/database/src/schema/tables.ts"
      provides: "EMBEDDING_DIM > 2000 conditional selecting halfvec vs vector column type and halfvec_cosine_ops vs vector_cosine_ops op-class, applied to both embeddings and knowledge_chunks"
    - path: "packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql"
      provides: "Real drizzle-kit-generated migration (TRUNCATE + DROP INDEX + 2x ALTER COLUMN TYPE halfvec(3072) + CREATE INDEX halfvec_cosine_ops), with a loud header comment marking it excluded from the standard image build"
    - path: "packages/database/src/migrations/meta/_journal.json"
      provides: "New idx=11 entry registering 0011_gemini_highdim_halfvec_3072"
    - path: "packages/database/src/migrations/0009_embedding_dimensions_fix.sql"
      provides: "Updated header comment cross-referencing the new halfvec flavor path (SQL statements unchanged)"
  key_links:
    - from: "packages/database/src/schema/tables.ts EMBEDDING_DIM > 2000 threshold"
      to: "pgvector's real HNSW/IVFFlat 2000-dimension cap for the `vector` type"
      via: "EMBEDDING_NEEDS_HALFVEC constant"
      pattern: "EMBEDDING_NEEDS_HALFVEC"
    - from: "packages/database/src/migrations/meta/_journal.json idx=11 entry"
      to: "packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql"
      via: "tag: 0011_gemini_highdim_halfvec_3072"
      pattern: "0011_gemini_highdim_halfvec_3072"
    - from: "apps/brain-sdr/Dockerfile COPY packages/database/src/migrations ./migrations (unmodified, out of scope)"
      to: "packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql header comment"
      via: "explicit warning that this file must be excluded from the standard image build — enforced by documentation only, not by tooling"
      pattern: "DO NOT SHIP THIS FILE IN THE STANDARD"
---

<objective>
Fix the root cause of the brain_sdr_PIEDADE crash-loop: pgvector caps HNSW/IVFFlat indexes at 2000 dimensions for the `vector` type, but the Gemini embedding provider (`gemini-embedding-001`) always outputs 3072 dimensions (fixed, no reduction parameter). Migration 0009 hardcodes `vector(1536)`, and even a manual `ALTER TABLE ... TYPE vector(3072)` fails with pgvector's "cannot have more than 2000 dimensions for hnsw index" error. This plan makes the schema and migration tooling produce `halfvec(3072)` (pgvector's half-precision type, HNSW-capable up to 4000 dims) whenever EMBEDDING_DIMENSIONS exceeds 2000, so the next Gemini/high-dim tenant does not hit this same wall — without touching the already-applied 0009 migration or the standard `brain-sdr:1.5` (1536/OpenAI) image.

A manual SQL hotfix (DROP INDEX + ALTER) was already given directly to the user to unblock the PIEDADE tenant right now, in parallel to this task. This plan is the code/schema fix so the bug does not recur for the next Gemini client.

Purpose: Prevent every future Gemini/high-dim-embedding Brain deployment from crash-looping on boot, and leave a correct, tested reference migration for whoever builds the first Gemini-specific brain-sdr image variant.
Output: `packages/database/src/schema/tables.ts` conditionally emits `halfvec`/`vector`; a real, drizzle-kit-generated, dev-Postgres-validated `0011_gemini_highdim_halfvec_3072.sql` migration; `0009`'s comment cross-references it.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@packages/database/src/schema/tables.ts
@packages/database/src/migrations/0009_embedding_dimensions_fix.sql
@packages/database/src/migrations/meta/_journal.json
@packages/embeddings/src/gemini-provider.ts
@packages/core/src/runner/runner.ts

<already_confirmed_this_session>
The following was empirically validated in THIS planning session, against the real repo and the local dev Postgres already available in this environment (127.0.0.1:5432, database brain_test, pgvector 0.8.2 installed) — the executor does not need to re-derive any of this, only reproduce it:

- `halfvec` is exported from `drizzle-orm/pg-core` (installed 0.45.2) with the exact same call signature as `vector`: `halfvec('embedding', { dimensions: N })`. `getSQLType()` returns `halfvec(N)`.
- The ternary column-type pattern below typechecks cleanly (`bun run typecheck`) and lints cleanly (`bun run lint`) in `packages/database`, both at the default EMBEDDING_DIMENSIONS (1536) and at EMBEDDING_DIMENSIONS=3072.
- All 38 existing tests in `packages/database/src/schema/tables.test.ts` pass unmodified after the change (test env uses EMBEDDING_DIMENSIONS=128, which stays on the `vector` branch).
- A real `EMBEDDING_DIMENSIONS=3072 bunx drizzle-kit generate --dialect postgresql --schema ./src/schema/tables.ts --out ./src/migrations --name gemini_highdim_halfvec_3072` run (from `packages/database/`, after applying the schema change below) against the existing tracked migration history produces exactly this diff SQL (drizzle-kit does not require a live DB connection for `generate`, only `DATABASE_URL` to be set in env — it is diff-based against local snapshot files, not DB introspection):
  `DROP INDEX "embeddings_embedding_idx";` / `ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072);` / `ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072);` / `CREATE INDEX "embeddings_embedding_idx" ON "embeddings" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m=16,ef_construction=64);`
  (No TRUNCATE — drizzle-kit omits it, exactly like it already omits it for 0009. It must be added by hand.)
- The full sequence (TRUNCATE + the four generated statements above) was executed inside `BEGIN; ... ROLLBACK;` against the dev Postgres (which is currently at the real post-0010 production schema: `embeddings`/`knowledge_chunks` both `vector(1536)`, `embeddings` has the `vector_cosine_ops` HNSW index) — it applied with **zero errors**. `\d embeddings` / `\d knowledge_chunks` mid-transaction confirmed `halfvec(3072)` columns and a `halfvec_cosine_ops` HNSW index.
- `SELECT atttypmod FROM pg_attribute WHERE attrelid = 'knowledge_chunks'::regclass AND attname = 'embedding'` returned exactly `3072` for the `halfvec(3072)` column — confirming pgvector's typmod encoding is the same 1:1 mapping (N stored directly, no offset) for `halfvec(N)` as it already is for `vector(N)`. `packages/core/src/runner/runner.ts`'s existing fail-fast check (lines ~153-187) needs NO changes.
- IMPORTANT gotcha confirmed empirically: because drizzle-kit tracks ONE linear schema timeline in `meta/_journal.json`/`meta/*_snapshot.json`, once a migration is registered at EMBEDDING_DIMENSIONS=3072, a SUBSEQUENT `drizzle-kit generate` run with the default EMBEDDING_DIMENSIONS (1536) silently proposes a migration REVERTING `embeddings`/`knowledge_chunks` back to `vector(1536)`. This must be documented in the new migration's header comment (it is, see Reference Content below) so a future developer regenerating for an unrelated schema change does not accidentally commit a silent revert-to-vector(1536) diff.
</already_confirmed_this_session>

<reference_content>
Exact text/code to reproduce verbatim — do not paraphrase or reformat.

### 1. `packages/database/src/schema/tables.ts` — exact diff (already validated)

Import line (add `halfvec` next to `vector`, same import source `drizzle-orm/pg-core`):
```
import { pgTable, text, uuid, timestamp, jsonb, boolean, index, vector, halfvec, uniqueIndex, integer } from 'drizzle-orm/pg-core';
```

Insert immediately after the existing `EMBEDDING_DIM` range-validation `if` block (after its closing `}`, before the `// DB-01: Memories table` comment):
```
const EMBEDDING_NEEDS_HALFVEC = EMBEDDING_DIM > 2000;
const EMBEDDING_OP_CLASS = EMBEDDING_NEEDS_HALFVEC ? 'halfvec_cosine_ops' : 'vector_cosine_ops';
```

In the `embeddings` table definition, replace the `embedding` column line:
```
  embedding: (EMBEDDING_NEEDS_HALFVEC
    ? halfvec('embedding', { dimensions: EMBEDDING_DIM })
    : vector('embedding', { dimensions: EMBEDDING_DIM })
  ).notNull(),
```
and replace `.op('vector_cosine_ops')` in `embeddingIdx` with `.op(EMBEDDING_OP_CLASS)`.

In the `knowledgeChunks` table definition, replace the `embedding` column line with the SAME ternary as above (no index change needed there — this table has no HNSW index in code today):
```
  embedding: (EMBEDDING_NEEDS_HALFVEC
    ? halfvec('embedding', { dimensions: EMBEDDING_DIM })
    : vector('embedding', { dimensions: EMBEDDING_DIM })
  ).notNull(),
```

### 2. Final content of `packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql`

After running the `drizzle-kit generate` command (Task 2), replace the generated file's content with exactly this (generated statements preserved verbatim, TRUNCATE and header comment added by hand):
```sql
-- ============================================================================
-- GEMINI / HIGH-DIMENSION EMBEDDING FLAVOR — NOT PART OF THE STANDARD BUILD
-- ============================================================================
-- Generated via `EMBEDDING_DIMENSIONS=3072 drizzle-kit generate` — Gemini's
-- gemini-embedding-001 always outputs 3072 dimensions (see
-- packages/embeddings/src/gemini-provider.ts). pgvector caps HNSW/IVFFlat
-- indexes at 2000 dimensions for the `vector` type, so this migration converts
-- embeddings.embedding and knowledge_chunks.embedding to halfvec(3072)
-- (half-precision, pgvector >= 0.7.0; HNSW supported up to 4000 dims;
-- confirmed against pgvector 0.8.2 in dev).
--
-- CRITICAL — DO NOT SHIP THIS FILE IN THE STANDARD brain-sdr:1.5 IMAGE:
-- apps/brain-sdr/Dockerfile currently does
-- `COPY packages/database/src/migrations ./migrations` (the entire folder),
-- and runMigrations() applies every migration registered in
-- meta/_journal.json unconditionally on every boot. If this file is present
-- when that image is rebuilt, EXISTING 1536/OpenAI tenants sharing that image
-- will have embeddings/knowledge_chunks TRUNCATED and force-converted to
-- halfvec(3072) on next deploy — silent data loss, not a crash. A future
-- Gemini/high-dim brain-sdr image variant must use a build step that
-- includes this file while the STANDARD image build explicitly excludes it.
-- This is deferred ops/build work — NOT done as part of this fix.
--
-- DEV-WORKFLOW GOTCHA: because this migration is registered in the same
-- linear meta/_journal.json timeline used by the standard 1536 flavor, any
-- FUTURE `bun run db:generate` in this package run with the default
-- EMBEDDING_DIMENSIONS (1536) will treat this halfvec(3072) state as the new
-- baseline and silently propose a migration reverting embeddings/
-- knowledge_chunks back to vector(1536) (confirmed empirically). Regenerate
-- with EMBEDDING_DIMENSIONS=3072 for unrelated schema changes, or manually
-- inspect/discard any spurious vector(1536) revert diff before committing.
--
-- drizzle-kit generate omits TRUNCATE (same limitation documented in
-- 0009_embedding_dimensions_fix.sql) — added by hand below, same pattern.
-- ============================================================================
TRUNCATE TABLE "embeddings", "knowledge_chunks";
--> statement-breakpoint
DROP INDEX "embeddings_embedding_idx";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072);
--> statement-breakpoint
CREATE INDEX "embeddings_embedding_idx" ON "embeddings" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m=16,ef_construction=64);
```

### 3. Addition to `packages/database/src/migrations/0009_embedding_dimensions_fix.sql`

Insert this new paragraph into the header comment, after the existing 4 comment lines and before the `TRUNCATE TABLE "embeddings", "knowledge_chunks";` statement. Do NOT touch any line below the comment block (the 3 existing SQL statement lines stay byte-identical):
```sql
-- For dimensions > 2000 (e.g. Gemini's fixed 3072), pgvector's HNSW/IVFFlat
-- index cap forces a different column type — see
-- 0011_gemini_highdim_halfvec_3072.sql, which converts to halfvec(3072)
-- instead of vector(N). That file is NOT part of the standard brain-sdr:1.5
-- (1536/OpenAI) image build — see its header comment for the full rationale
-- and the required build-time exclusion for future Gemini/high-dim image
-- variants.
```
</reference_content>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Make the embedding column type conditional on dimension (vector vs halfvec)</name>
  <files>packages/database/src/schema/tables.ts</files>
  <action>
Apply the exact diff given in the "1. tables.ts" block of the Reference Content section above, to `packages/database/src/schema/tables.ts`:
- Add `halfvec` to the existing `drizzle-orm/pg-core` import (same line as `vector`).
- Add the two new constants `EMBEDDING_NEEDS_HALFVEC` and `EMBEDDING_OP_CLASS` right after the existing `EMBEDDING_DIM` range-validation block. `EMBEDDING_NEEDS_HALFVEC` is true when `EMBEDDING_DIM` exceeds pgvector's real HNSW/IVFFlat cap for the `vector` type (2000 dimensions) — above that, only `halfvec` supports an HNSW index (up to 4000 dims, pgvector >= 0.7.0, confirmed against the installed 0.8.2 in dev).
- In the `embeddings` table, swap the `embedding` column definition and the index's op-class for the ternary versions given in the reference (picks `halfvec`/`halfvec_cosine_ops` when `EMBEDDING_NEEDS_HALFVEC`, otherwise the existing `vector`/`vector_cosine_ops`).
- In the `knowledgeChunks` table, swap only the `embedding` column definition for the same ternary (this table has no HNSW index defined in code today — per its existing D-09 comment, any index is created manually post-ingestion in production — so there is no op-class to change there; only the column type must stay consistent with whatever gets manually indexed later).
- Do not touch any other table or column in this file.
  </action>
  <verify>
    <automated>cd /root/Brain/packages/database && bun run typecheck && bun run lint && EMBEDDING_DIMENSIONS=3072 bun run typecheck && EMBEDDING_DIMENSIONS=3072 bun run lint && bun test src/schema/tables.test.ts && test "$(grep -c 'EMBEDDING_NEEDS_HALFVEC' src/schema/tables.ts)" = "4" && test "$(grep -c "halfvec('embedding'" src/schema/tables.ts)" = "2" && grep -q "^import.*halfvec.*from 'drizzle-orm/pg-core'" src/schema/tables.ts && echo TASK1_PASS</automated>
  </verify>
  <done>`tables.ts` typechecks and lints cleanly at both the default dimension and EMBEDDING_DIMENSIONS=3072; the existing `tables.test.ts` suite (38 tests) still passes unmodified; `embeddings` and `knowledge_chunks` both pick `halfvec`/`halfvec_cosine_ops` when EMBEDDING_DIM > 2000, and `vector`/`vector_cosine_ops` otherwise.</done>
</task>

<task type="auto">
  <name>Task 2: Generate the Gemini/high-dim migration via drizzle-kit and harden it with the required warnings</name>
  <files>
    packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql
    packages/database/src/migrations/meta/_journal.json
    packages/database/src/migrations/meta/0011_snapshot.json
    packages/database/src/migrations/0009_embedding_dimensions_fix.sql
  </files>
  <action>
Before running any command below, export `DATABASE_URL` pointing at the local dev Postgres already used earlier in this quick-task session (host 127.0.0.1, port 5432, database `brain_test`) — reuse the credentials already established in this session's shell/environment context; do not paste the password into any committed file.

From `packages/database/`, run drizzle-kit generate with `EMBEDDING_DIMENSIONS=3072` set, targeting dialect `postgresql`, schema `./src/schema/tables.ts`, output folder `./src/migrations` (the real, tracked folder — not a scratch copy), and migration name `gemini_highdim_halfvec_3072`. This is diff-based against the local snapshot chain already present in `src/migrations/meta/` (idx 0 through 10) — it does not need a live DB connection to compute the diff, only `DATABASE_URL` set in the environment. This produces `0011_gemini_highdim_halfvec_3072.sql`, a new `meta/0011_snapshot.json`, and a new idx=11 entry in `meta/_journal.json` (already confirmed in this session to emit exactly: `DROP INDEX "embeddings_embedding_idx"`, both `ALTER TABLE ... SET DATA TYPE halfvec(3072)` statements, and the `CREATE INDEX ... USING hnsw (... halfvec_cosine_ops)` statement — no TRUNCATE, same limitation already documented in 0009).

Replace the generated `.sql` file's content with the exact block given in section "2. Final content of ... 0011_gemini_highdim_halfvec_3072.sql" of the Reference Content in `<context>` above — this preserves the four generated statements verbatim (in the same order, with the same `--> statement-breakpoint` separators drizzle-kit already emits) and prepends the required `TRUNCATE TABLE "embeddings", "knowledge_chunks";` statement plus the full header warning comment. Copy that block verbatim — it is the deliverable, not a draft.

Do not hand-edit `meta/_journal.json` or `meta/0011_snapshot.json` — they are drizzle-kit's own generated output and must be left exactly as generated.

Finally, edit `packages/database/src/migrations/0009_embedding_dimensions_fix.sql`: insert the paragraph given in section "3. Addition to ... 0009_embedding_dimensions_fix.sql" of the Reference Content, in the exact position described there (after the existing header comment, before the first SQL statement). Do not change anything else in that file — its three SQL statement lines (the TRUNCATE and the two `ALTER TABLE ... TYPE vector(1536)` lines) must remain byte-identical to what they are today.
  </action>
  <verify>
    <automated>cd /root/Brain/packages/database && test -f src/migrations/0011_gemini_highdim_halfvec_3072.sql && grep -q 'TRUNCATE TABLE "embeddings", "knowledge_chunks"' src/migrations/0011_gemini_highdim_halfvec_3072.sql && grep -q 'DROP INDEX "embeddings_embedding_idx"' src/migrations/0011_gemini_highdim_halfvec_3072.sql && grep -q 'ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072)' src/migrations/0011_gemini_highdim_halfvec_3072.sql && grep -q 'ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072)' src/migrations/0011_gemini_highdim_halfvec_3072.sql && grep -q 'CREATE INDEX "embeddings_embedding_idx" ON "embeddings" USING hnsw ("embedding" halfvec_cosine_ops)' src/migrations/0011_gemini_highdim_halfvec_3072.sql && grep -q 'DO NOT SHIP THIS FILE IN THE STANDARD' src/migrations/0011_gemini_highdim_halfvec_3072.sql && grep -q '"tag": "0011_gemini_highdim_halfvec_3072"' src/migrations/meta/_journal.json && test -f src/migrations/meta/0011_snapshot.json && grep -q '0011_gemini_highdim_halfvec_3072' src/migrations/0009_embedding_dimensions_fix.sql && diff <(grep -E '^(TRUNCATE|ALTER)' src/migrations/0009_embedding_dimensions_fix.sql) <(printf 'TRUNCATE TABLE "embeddings", "knowledge_chunks";\nALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(1536);\nALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(1536);\n') && echo TASK2_PASS</automated>
  </verify>
  <done>`0011_gemini_highdim_halfvec_3072.sql` exists with TRUNCATE + DROP INDEX + 2x ALTER COLUMN TYPE halfvec(3072) + CREATE INDEX halfvec_cosine_ops, plus the full warning header; `meta/_journal.json` has a new idx=11 entry tagged `0011_gemini_highdim_halfvec_3072`; `meta/0011_snapshot.json` exists; `0009_embedding_dimensions_fix.sql`'s three SQL statement lines are unchanged, only its header comment now cross-references 0011.</done>
</task>

<task type="auto">
  <name>Task 3: Validate the generated migration against the dev Postgres and confirm halfvec's atttypmod behavior</name>
  <files>packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql</files>
  <action>
Using the same `DATABASE_URL` exported for Task 2 (dev Postgres at 127.0.0.1:5432, database `brain_test` — currently at the real post-0010 production schema, `embeddings`/`knowledge_chunks` both `vector(1536)`), run the exact SQL statements from the newly created `0011_gemini_highdim_halfvec_3072.sql` (TRUNCATE, DROP INDEX, both ALTER COLUMN TYPE, CREATE INDEX) wrapped in `BEGIN; ... ROLLBACK;` via `psql`, so the dev database is left unmodified afterward — it is a shared resource other sessions/tasks may reuse and must stay at its original `vector(1536)` baseline.

Inside that same transaction, before the ROLLBACK, query `pg_attribute.atttypmod` for `knowledge_chunks.embedding` and confirm it returns exactly `3072` — this empirically confirms pgvector's `halfvec(N)` typmod encoding stores `N` directly (no offset), identical to `vector(N)`. This is the confirmation needed for the must-have about `packages/core/src/runner/runner.ts`'s existing fail-fast dimension check (lines ~153-187) remaining correct as-is.

After the ROLLBACK, run a second, separate query confirming `embeddings.embedding` is still reported as `vector(1536)` (via `format_type(atttypid, atttypmod)` on `pg_attribute`) — this proves the validation transaction left no residual mutation on the shared dev database.

Do not modify `packages/core/src/runner/runner.ts` — this task only confirms its existing atttypmod-based logic is correct for halfvec; no code there needs to change.
  </action>
  <verify>
    <automated>: "${DATABASE_URL:?Set DATABASE_URL to the dev Postgres (127.0.0.1:5432/brain_test) before running this check}"; psql "$DATABASE_URL" -X -q -t -A <<'SQL' | grep -qx 3072 && psql "$DATABASE_URL" -X -q -t -A -c "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid='embeddings'::regclass AND attname='embedding';" | grep -qx 'vector(1536)' && echo TASK3_PASS
BEGIN;
TRUNCATE TABLE "embeddings", "knowledge_chunks";
DROP INDEX "embeddings_embedding_idx";
ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072);
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072);
CREATE INDEX "embeddings_embedding_idx" ON "embeddings" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m=16, ef_construction=64);
SELECT atttypmod FROM pg_attribute WHERE attrelid = 'knowledge_chunks'::regclass AND attname = 'embedding';
ROLLBACK;
SQL</automated>
  </verify>
  <done>The exact statements from 0011 applied with zero SQL errors against a database at the real post-0010 (vector(1536)) schema state; atttypmod for the resulting halfvec(3072) column reads back as 3072; the transaction was rolled back and the dev database is confirmed still at vector(1536) afterward; runner.ts is unmodified.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|--------------|
| Docker build-time (Dockerfile `COPY` of the migrations folder) → runtime `migrate()` | `apps/brain-sdr/Dockerfile` copies the entire `packages/database/src/migrations` folder into every built image; `runMigrations()` applies every migration registered in that folder's `meta/_journal.json` unconditionally on every boot, regardless of which embedding provider/dimension that specific tenant is configured for |
| `.env`-configured `EMBEDDING_DIMENSIONS` → schema generation | `packages/database/src/schema/tables.ts` reads `EMBEDDING_DIMENSIONS` from `process.env` at module-load/generate-time to decide column type — a misconfigured or stale value silently changes what `drizzle-kit generate` produces |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-wpk-01 | Tampering | `packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql` registered in the shared `meta/_journal.json` | high | mitigate | Prominent, impossible-to-miss header comment (verified via automated grep in Task 2) explains this migration TRUNCATEs and force-converts embeddings/knowledge_chunks to halfvec(3072), and that it must be excluded from any rebuild of the standard `brain-sdr:1.5` image. No code/tooling currently enforces this exclusion — it is a documentation-only mitigation; the residual risk (a naive image rebuild after this change ships would silently corrupt 1536/OpenAI tenant data) must be flagged as a follow-up in the plan's SUMMARY for whoever next touches `apps/brain-sdr/Dockerfile` or builds a Gemini-specific image variant. Rebuilding/publishing images is explicitly out of scope for this quick task. |
| T-wpk-02 | Tampering / Repudiation | `packages/database/src/schema/tables.ts` `EMBEDDING_DIM > 2000` threshold | medium | mitigate | Threshold is hardcoded to pgvector's documented, version-stable HNSW/IVFFlat cap (2000 dimensions); covered by automated typecheck+lint+test verification at both the default (1536) and high-dimension (3072) configurations in Task 1, preventing silent drift between the code's assumption and pgvector's real behavior. |
| T-wpk-03 | Denial of Service | `packages/core/src/runner/runner.ts` boot fail-fast dimension check | low | accept | Behavior is unchanged by this plan; Task 3 empirically re-confirms the existing `atttypmod` logic is correct for `halfvec(N)` columns, so the existing crash-loop protection (fail fast with a clear log message instead of a cryptic Postgres error) continues to work for the halfvec path exactly as it already does for vector. |
</threat_model>

<verification>
After all three tasks:

1. `cd packages/database && bun run typecheck && bun run lint` passes at both the default EMBEDDING_DIMENSIONS and EMBEDDING_DIMENSIONS=3072.
2. `bun test src/schema/tables.test.ts` — all 38 existing tests still pass.
3. `cat packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql` contains TRUNCATE + DROP INDEX + 2x ALTER COLUMN TYPE halfvec(3072) + CREATE INDEX halfvec_cosine_ops, plus the full warning header (checked verbatim via grep in Task 2's verify).
4. `packages/database/src/migrations/meta/_journal.json` has a new idx=11 entry tagged `0011_gemini_highdim_halfvec_3072`; `meta/0011_snapshot.json` exists.
5. `packages/database/src/migrations/0009_embedding_dimensions_fix.sql`'s three SQL statement lines are byte-identical to before this plan (diff-checked in Task 2's verify); only its header comment gained a cross-reference to 0011.
6. The exact SQL from 0011 was applied inside a rolled-back transaction against the dev Postgres with zero errors, and `atttypmod` for the resulting `halfvec(3072)` column read back as `3072` (Task 3).
7. `packages/core/src/runner/runner.ts` is untouched (`git diff --quiet -- packages/core/src/runner/runner.ts`).
8. No Dockerfile, docker-compose, or image build/publish step was touched by this plan.
</verification>

<success_criteria>
- Regenerating the schema at EMBEDDING_DIMENSIONS=3072 produces `halfvec(3072)` + `halfvec_cosine_ops` for `embeddings`, and `halfvec(3072)` for `knowledge_chunks` — no more pgvector "cannot have more than 2000 dimensions for hnsw index" error at this dimension.
- The default (1536/OpenAI, current production) code path is provably unchanged: same generated SQL type, same passing test suite, same untouched 0009 migration statements.
- A real, drizzle-kit-generated `0011_gemini_highdim_halfvec_3072.sql` exists, is registered in the migration journal, and has been proven to apply cleanly against a database at the real production (post-0010) schema state.
- The file's header comment makes the "do not ship in the standard image" constraint and the "regenerate with EMBEDDING_DIMENSIONS=3072" dev-workflow gotcha unmissable to the next engineer who touches this package or builds a Gemini-specific image.
- `runner.ts`'s dimension fail-fast check is confirmed correct for halfvec without any code change.
</success_criteria>

<output>
Create `.planning/quick/260717-wpk-corrigir-suporte-a-embeddings-de-alta-di/260717-wpk-SUMMARY.md` when done. Include, in addition to the standard summary content:
- Explicit confirmation that `0011_gemini_highdim_halfvec_3072.sql` is now present in `packages/database/src/migrations/` and registered in the shared journal used by `apps/brain-sdr/Dockerfile`'s wholesale `COPY`.
- A clearly flagged residual risk / follow-up: the standard `brain-sdr:1.5` image must NOT be rebuilt from `master` without first excluding `0011_gemini_highdim_halfvec_3072.sql` (or otherwise ensuring only 1536-flavor tenants receive the image built from a migrations folder that stops at 0010) — this is unresolved ops/build work, out of scope for this quick task, and should be tracked before the next `brain-sdr:1.5` rebuild.
</output>

