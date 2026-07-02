---
phase: 28-embedding-sdk
reviewed: 2026-07-01T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - apps/brain-sdr/.env.example
  - apps/brain-sdr/package.json
  - apps/brain-sdr/src/brain.ts
  - apps/brain-sdr/src/index.ts
  - apps/brain-sdr/src/server.ts
  - apps/brain-sdr/tsconfig.json
  - packages/ai/package.json
  - packages/ai/src/index.ts
  - packages/core/package.json
  - packages/core/src/index.ts
  - packages/core/src/rag/__tests__/ingest.test.ts
  - packages/core/src/rag/__tests__/reembed.test.ts
  - packages/core/src/rag/index.ts
  - packages/core/src/rag/ingest.ts
  - packages/core/src/rag/reembed.ts
  - packages/core/src/rag/search.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/__tests__/runner-fup.test.ts
  - packages/core/src/runner/__tests__/runner-wr.test.ts
  - packages/core/src/runner/runner.ts
  - packages/core/src/tools/__tests__/search-knowledge.test.ts
  - packages/core/src/tools/search-knowledge.ts
  - packages/core/tsconfig.json
  - packages/database/.env.example
  - packages/database/src/migrate.ts
  - packages/database/src/migrations/0009_embedding_dimensions_fix.sql
  - packages/database/src/migrations/meta/0008_snapshot.json
  - packages/database/src/migrations/meta/0009_snapshot.json
  - packages/database/src/migrations/meta/_journal.json
  - packages/embeddings/package.json
  - packages/embeddings/src/__tests__/unit/factory.test.ts
  - packages/embeddings/src/__tests__/unit/gemini-provider.test.ts
  - packages/embeddings/src/__tests__/unit/openai-provider.test.ts
  - packages/embeddings/src/factory.ts
  - packages/embeddings/src/gemini-provider.ts
  - packages/embeddings/src/index.ts
  - packages/embeddings/src/openai-provider.ts
  - packages/embeddings/src/provider.interface.ts
  - packages/embeddings/tsconfig.json
  - tsconfig.base.json
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: issues_found
---

# Phase 28: Code Review Report

**Reviewed:** 2026-07-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 26 (non-empty diffs; several files are pure config/passthrough)
**Status:** issues_found

## Summary

This phase introduces `@brain-pkg/embeddings` (a provider-agnostic `IEmbeddingProvider` abstraction with OpenAI and Gemini implementations), wires it into `BrainRunner`, RAG ingest/search/re-embed, and `search_knowledge`, and adds migration `0009_embedding_dimensions_fix.sql` plus a fail-fast dimension-consistency check in `runner.ts`. The design is generally solid: fail-closed auth on RAG endpoints, defensive guards against empty embedding vectors (Pitfall 3), and a dimension mismatch check that prevents silent data corruption at startup.

The most serious issue is a **destructive, irreversible migration** (`0009_embedding_dimensions_fix.sql`) that unconditionally truncates the `embeddings` and `knowledge_chunks` tables and hardcodes `vector(1536)` — contradicting the stated purpose of making dimensions ENV-configurable. Several warnings concern silent correctness gaps around lazy provider resolution in `brain-sdr/src/brain.ts` and inconsistent documentation of the target dimension value (768 vs 1536 vs 3072) across files.

## Critical Issues

### CR-01: Migration 0009 truncates production data and hardcodes vector(1536), contradicting its stated purpose

**File:** `packages/database/src/migrations/0009_embedding_dimensions_fix.sql:1-5`
**Issue:** The migration unconditionally runs `TRUNCATE TABLE "embeddings", "knowledge_chunks";` followed by `ALTER COLUMN "embedding" TYPE vector(1536)` on both tables. Two problems:

1. **Destructive and irreversible by design, with no guard.** Every customer database that runs `runMigrations()` (which happens automatically at Brain startup per `packages/database/src/migrate.ts` and the project's documented "auto-migrate on init" behavior) will have `embeddings` and `knowledge_chunks` silently wiped the first time this migration runs — with no confirmation, backup step, or opt-out. For a multi-tenant product where each customer runs their own Postgres, this is data loss with no rollback path once `_journal.json` records `0009` as applied.
2. **The column type is hardcoded to `vector(1536)`, not derived from `EMBEDDING_DIMENSIONS`.** The commit history and `runner.ts:170` error message ("Fix EMBEDDING_DIMENSIONS or regenerate migration 0009") imply the intent is that operators regenerate this migration per-deployment to match their configured `EMBEDDING_DIMENSIONS`. But as committed, this migration bakes in `1536` for every consumer of the package, regardless of the `EMBEDDING_PROVIDER`/`EMBEDDING_DIMENSIONS` they configure (e.g., Gemini's default of 3072 per `gemini-provider.ts:22`, or the `.env.example` comment mentioning 768). If a Gemini-configured Brain runs this migration as-is, `init()`'s own dimension check (`runner.ts:155-173`) will immediately fail-fast with a mismatch (1536 vs 3072) right after the destructive TRUNCATE has already run — the data is lost before the safety check even has a chance to prevent it.

**Fix:** At minimum, add a safety guard/comment making the destructive nature explicit and unambiguous, and — since dimensions must be baked into the migration SQL at generation time (per the project's own `.env.example` comment) — ship parameterized/templated migration generation (e.g., a script that renders `vector(N)` from `EMBEDDING_DIMENSIONS` before `drizzle-kit generate`) rather than a single committed SQL file with a hardcoded value used by all consumers:
```sql
-- 0009_embedding_dimensions_fix.sql
-- WARNING: irreversible — wipes all existing embeddings/knowledge_chunks rows.
-- Regenerate this file with the deployment's EMBEDDING_DIMENSIONS before applying;
-- 1536 only matches EMBEDDING_PROVIDER=openai (text-embedding-3-small default).
TRUNCATE TABLE "embeddings", "knowledge_chunks";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(${EMBEDDING_DIMENSIONS});
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(${EMBEDDING_DIMENSIONS});
```
At a minimum, document this prominently in `packages/database/.env.example` (which currently only warns that dimensions "cannot be changed after first migration," not that 0009 truncates existing data) and in a migration guide, so operators don't apply it against a populated production database without reviewing/backing up first.

## Warnings

### WR-01: `ingest.ts` comment claims `EMBEDDING_DIMENSIONS=768` while every other reference uses 1536/3072

**File:** `packages/core/src/rag/ingest.ts:74-77`
**Issue:** The comment states: "D-16: EMBEDDING_DIMENSIONS=768 garante compatibilidade OpenAI/Gemini na mesma coluna pgvector." This is inconsistent with:
- `packages/database/.env.example:9` (`EMBEDDING_DIMENSIONS=1536`)
- `packages/embeddings/src/openai-provider.ts:13` (default 1536)
- `packages/embeddings/src/gemini-provider.ts:22` (default 3072, and the file's own docstring says Gemini's wrapper exposes no way to reduce below 3072 — "Pitfall 4")
- Migration `0009_embedding_dimensions_fix.sql` (hardcoded 1536)

Since Gemini's `GoogleGenerativeAIEmbeddings` wrapper cannot produce fewer than 3072 dimensions (per the provider's own docstring), setting `EMBEDDING_DIMENSIONS=768` would make the Gemini provider unusable (it would always produce 3072-dim vectors, failing the `runner.ts` dimension check). This comment is actively misleading for anyone trying to configure a Brain to support both providers on the same collection.
**Fix:** Correct the comment to reflect the real constraint — cross-provider compatibility in the same `vector(N)` column is only achievable if both providers can be configured to the same dimension, and Gemini's floor is 3072 with the current wrapper:
```ts
// D-16: Para usar múltiplos providers na mesma coluna pgvector, EMBEDDING_DIMENSIONS deve
// ser um valor suportado por ambos. Gemini (via @langchain/google-genai) não expõe redução
// abaixo de 3072 — ver Pitfall 4 em gemini-provider.ts. Misturar OpenAI (1536 default) e
// Gemini na mesma coluna exige configurar OpenAI com dimensions=3072 explicitamente.
```

### WR-02: `LazyEmbeddingProvider.dimensions`/`providerName` silently return placeholder values before first resolution, risking incorrect metadata on first call

**File:** `apps/brain-sdr/src/brain.ts:37-61`
**Issue:** `LazyEmbeddingProvider` returns `"unresolved"` for `providerName` and `0` for `dimensions` until `embed()`/`embedQuery()` is awaited once. The code comment (lines 24-28) claims this is safe because `search-knowledge.ts` "só lê providerName após o await de embedQuery()" — and indeed `createSearchKnowledgeTool` (search-knowledge.ts:60-68) calls `embedQuery()` before reading `providerName`. However, this is a fragile invariant that depends entirely on call-order discipline in every future consumer of `boundSearchKnowledgeTool`'s embedding provider (or any other future tool wired the same way). There is no compile-time or runtime guard preventing a future caller from reading `.dimensions` or `.providerName` before calling `embed()`/`embedQuery()` at least once — it will silently return `0`/`"unresolved"` instead of throwing, which could pass silently into a DB filter (e.g., `WHERE embedding_model = 'unresolved'`) or a dimension check, producing confusing empty-result-set bugs rather than a clear failure.
**Fix:** Consider making the pre-resolution access fail loudly instead of returning a placeholder, or eagerly resolve the provider at construction time with a resolved promise cached at module scope (already partially done via `embeddingProviderPromise`) so that `sdrBrain.buildGraph()` awaits resolution once during `BrainRunner.init()`-adjacent startup rather than deferring to first tool invocation:
```ts
get providerName(): string {
  if (!this.resolved) {
    throw new Error("LazyEmbeddingProvider.providerName accessed before embed()/embedQuery() resolved the provider");
  }
  return this.resolved.providerName;
}
```

### WR-03: `reembed.ts` re-embed loop issues one `UPDATE` per row instead of batching, and has no upper bound on total pages processed

**File:** `packages/core/src/rag/reembed.ts:66-102`
**Issue:** The `for (;;)` loop has no maximum iteration count. If `knowledgeChunks` contains a very large number of rows for a `collection` with a stale `embeddingModel`, this HTTP request handler will run for as long as it takes to page through the entire result set (200 rows/page), each row triggering a separate awaited `UPDATE`. Since this executes inside a single Hono request handler with no timeout or cancellation and no progress persisted between pages, a client disconnect or process restart mid-run leaves the operation partially applied with no resumption marker (the caller only learns final `updated`/`skipped` counts if the request completes). This isn't a security issue, but it is a correctness/operability gap: a request that legitimately takes minutes/hours ties up a connection and offers no partial-progress visibility if it fails partway.
**Fix:** At minimum, log progress per page (currently only a single summary log at the end) so operators have visibility if the process is killed mid-run, and consider capping total pages processed per request (returning a `nextOffset` for resumption) if collections are expected to grow large:
```ts
for (;;) {
  const rows = await db.select()... // as-is
  if (rows.length === 0) break;
  // ...
  logger.info({ collection, offset, updated, skipped }, "Re-embed page processed");
  offset += PAGE_SIZE;
}
```

### WR-04: `runner.ts` dimension-mismatch query has no defensive handling for zero rows or missing `knowledge_chunks` relation

**File:** `packages/core/src/runner/runner.ts:155-173`
**Issue:** The destructured `const [{ dimensions: columnDim }] = await this.sql<...>...` assumes the query against `pg_attribute` always returns exactly one row. If `knowledgeChunks` doesn't exist yet at this point for any reason (e.g., migrations partially failed without throwing, or a future refactor changes migration ordering so `_compileGraph`/dimension-check runs before the RAG migration), `'knowledge_chunks'::regclass` will throw a Postgres error ("relation does not exist") rather than the intended, clearly-labeled "EMBEDDING_DIMENSIONS mismatch" error — and if the query legitimately returns zero rows (e.g., column renamed), the destructuring `const [{ dimensions: columnDim }] = []` throws a raw `TypeError: Cannot destructure property 'dimensions' of 'undefined'` instead of a clean fail-fast message. Given this code path runs unconditionally on every `init()` (right after `runMigrations()`), a raw destructuring crash here would produce a confusing stack trace instead of the deliberately-crafted operator-facing error message the rest of this block is designed to produce.
**Fix:** Guard the query result explicitly before destructuring:
```ts
const rows = await this.sql<{ dimensions: number }[]>`
  SELECT atttypmod AS dimensions
  FROM pg_attribute
  WHERE attrelid = 'knowledge_chunks'::regclass
    AND attname = 'embedding'
    AND attnum > 0
`;
if (rows.length === 0) {
  this.logger.error({ brainId: this.brain.id }, "knowledge_chunks.embedding column not found — migrations may not have completed");
  process.exit(1);
}
const columnDim = rows[0].dimensions;
```

## Info

### IN-01: `atttypmod` for `vector(N)` is not guaranteed to equal `N` directly across all Postgres/pgvector versions

**File:** `packages/core/src/runner/runner.ts:155-161`
**Issue:** The dimension check reads `atttypmod` directly and compares it to `this.embeddingProvider.dimensions`. For pgvector's `vector(N)` type, `atttypmod` is documented to store `N` directly (not `N + 4` as with some other parameterized types like `varchar`), so this is very likely correct for current pgvector versions — but it's an implementation detail of pgvector's type modifier encoding, not part of the stable public API. If pgvector ever changes this encoding in a major version bump, this check would silently produce wrong comparisons (either false mismatches blocking startup, or false matches missing a real mismatch).
**Fix:** Add a code comment noting the assumption and the pgvector version this was verified against, so a future upgrade investigates this code path:
```ts
// NOTE: pgvector encodes vector(N) type modifier as atttypmod = N directly (verified against
// pgvector 0.8.x). If this changes in a future major pgvector version, this check must be updated.
```

### IN-02: `formatResults` in `search-knowledge.ts` does not escape or truncate chunk content, allowing arbitrarily large tool outputs

**File:** `packages/core/src/tools/search-knowledge.ts:26-33`
**Issue:** `formatResults` concatenates raw `r.content` for up to 5 chunks (per `search.ts`'s `topK = 5` default) with no length cap. Since `content` originates from `ingest.ts`'s chunker (max 1MB total text, chunked), a single chunk could still be large depending on `splitText`'s chunk size, and 5 chunks concatenated could produce a very large tool result fed back into the LLM context window. This is a quality/cost concern rather than a security bug (content is the operator's own ingested knowledge base, not user-controlled), but it could cause unexpectedly large token usage per `search_knowledge` call with no visibility until it happens.
**Fix:** Consider logging or capping total formatted-result length as a defensive measure, particularly since `CONTEXT_WINDOW_MESSAGES` config elsewhere in the codebase (`brain.ts:164-167`) shows the team already cares about context budget.

### IN-03: `EMBEDDING_DIMENSIONS` validation range documented in `tables.ts` (128–4096) is not cross-checked against Gemini's fixed 3072 or OpenAI's configurable range at the embeddings-package level

**File:** `packages/embeddings/src/openai-provider.ts:13`, `packages/embeddings/src/gemini-provider.ts:22`
**Issue:** Both providers read `EMBEDDING_DIMENSIONS` from env independently with their own defaults (1536, 3072) and no shared validation. `packages/database/src/schema/tables.ts` (not in this review's file list, but referenced by grep) validates the range 128–4096 at the database-schema level, but the embeddings package itself performs no validation — e.g., `EMBEDDING_DIMENSIONS=99999` would be silently accepted by `OpenAIEmbeddingProvider`/`GeminiEmbeddingProvider` construction and only fail later, either at the OpenAI/Gemini API call (unclear error) or never (if `dimensions` isn't actually enforced downstream for a given provider config). This is a minor robustness gap given validation exists elsewhere, but the duplication/inconsistency across layers is worth flagging.
**Fix:** Consider validating `EMBEDDING_DIMENSIONS` once in `packages/embeddings/src/factory.ts::createEmbeddingProvider()` and throwing `ConfigurationError` for out-of-range values, matching the pattern already used for unknown provider names.

### IN-04: `_compileGraph()` reads `process.env.DATABASE_URL` and calls `process.exit(1)` deep inside a private method, duplicating the same check already performed in `apps/brain-sdr/src/index.ts`

**File:** `packages/core/src/runner/runner.ts:492-496`
**Issue:** `index.ts:44-47` already validates `DATABASE_URL` and calls `process.exit(1)` with a clear message before constructing `BrainRunner`. `_compileGraph()` re-checks the same env var and exits again. This isn't wrong, but it's dead code from the app's perspective (the app-level check should make this unreachable in `brain-sdr`) and adds a second `process.exit(1)` call path that a future test or refactor might miss covering; it also means `packages/core` (SDK-level, reusable across all Brains) enforces a validation the app already enforces, which is defensible as defense-in-depth for other Brains that might skip the app-level check, but the duplication isn't documented as intentional anywhere.
**Fix:** Add a short comment in `_compileGraph()` clarifying this is intentional defense-in-depth for Brains that don't replicate the app-level check (as `brain-sdr`'s `index.ts` does), so future readers don't assume it's leftover/dead code.

---

_Reviewed: 2026-07-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
