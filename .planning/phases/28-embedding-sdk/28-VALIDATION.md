---
phase: 28
slug: embedding-sdk
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-30
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun 1.x built-in, Jest-compatible API) |
| **Config file** | none — Bun test needs no config file |
| **Quick run command** | `bun test src/__tests__/unit` (per-package) |
| **Full suite command** | `bun test` (per-package) or `turbo run test` (monorepo-wide) |
| **Estimated runtime** | ~10-20 seconds per package (unit-only, no live-network calls) |

---

## Sampling Rate

- **After every task commit:** Run `bun test src/__tests__/unit` in the touched package
- **After every plan wave:** Run full `bun test` per touched package (`packages/embeddings`, `packages/core`, `packages/database`, `packages/ai` after cleanup)
- **Before `/gsd-verify-work`:** `turbo run test` (monorepo-wide) must be green
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 28-01-xx | 01 | 0 | EMBD-01 | — | `IEmbeddingProvider` implementable, exported from `packages/embeddings` | unit | `bun test packages/embeddings/src/__tests__/unit -x` | ❌ Wave 0 | ⬜ pending |
| 28-01-xx | 01 | 0 | EMBD-02 | V6 (never log apiKey) | `OpenAIEmbeddingProvider` embeds with configurable model/dimensions | unit (mocked `@langchain/openai`) | `bun test packages/embeddings/src/__tests__/unit/openai-provider.test.ts -x` | ❌ Wave 0 | ⬜ pending |
| 28-01-xx | 01 | 0 | EMBD-01/D-03 | V6 (never log apiKey) | `GeminiEmbeddingProvider` embeds using `gemini-embedding-001` (D-18) | unit (mocked `@langchain/google-genai`) | `bun test packages/embeddings/src/__tests__/unit/gemini-provider.test.ts -x` | ❌ Wave 0 | ⬜ pending |
| 28-01-xx | 01 | 0 | EMBD-04 | V5 (range validation) | `createEmbeddingProvider()` resolves correct class per `EMBEDDING_PROVIDER`/`LLM_PROVIDER` combination | unit | `bun test packages/embeddings/src/__tests__/unit/factory.test.ts -x` | ❌ Wave 0 | ⬜ pending |
| 28-02-xx | 02 | 1 | EMBD-03 | — | Migration 0009 truncates then alters `vector(N)` columns cleanly on empty tables (D-19) | integration (real Postgres, disposable test DB) | manual `psql` verification + `bun run src/migrate.ts` against disposable test DB | ❌ Wave 0 — no migration-behavior test file exists yet | ⬜ pending |
| 28-03-xx | 03 | 1 | EMBD-05 | — | `BrainRunner` injects/resolves `IEmbeddingProvider`, embeds at query-time (blocking, D-09) and save-time (D-08), graceful fallback on failure (D-10) | unit (mirrors `IEventPublisher` injection tests) | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts -x` | ⚠️ file exists, needs new cases | ⬜ pending |
| 28-03-xx | 03 | 1 | EMBD-05/D-15 | — | `BrainRunner.init()` fails fast (`process.exit(1)`) on dimension mismatch between provider and live `vector(N)` column | unit + integration (real Postgres) | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts -x` | ⚠️ file exists, needs new cases | ⬜ pending |
| 28-04-xx | 04 | 2 | D-16/D-17 | V4 (DoS via unthrottled endpoint) | Batch re-embed tool paginates `knowledge_chunks`, skips empty-vector results (Pitfall 3), tags rows with current `embeddingModel` | unit (mocked provider) + manual verification against disposable test DB | `bun test packages/core/src/__tests__/unit -x` (path TBD per Claude's Discretion on tool location) | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/embeddings/` — entire package scaffold (`package.json`, `tsconfig.json`, `src/`, `src/__tests__/unit/`) does not exist yet
- [ ] `packages/embeddings/src/__tests__/unit/openai-provider.test.ts` — stub for EMBD-02
- [ ] `packages/embeddings/src/__tests__/unit/gemini-provider.test.ts` — stub for EMBD-01/D-03/D-18
- [ ] `packages/embeddings/src/__tests__/unit/factory.test.ts` — stub for EMBD-04
- [ ] `packages/database/src/migrations/0009_*.sql` — migration file does not exist yet; `meta/_journal.json` must be updated in the same wave

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Migration 0009 applies cleanly against a real Postgres/pgvector instance and `ALTER COLUMN TYPE` succeeds after `TRUNCATE` | EMBD-03 | Drizzle migrations are not covered by the existing unit-test style (mocks only); this repo has no live-Postgres migration test harness | Spin up a disposable Postgres (or reuse dev DB), set `EMBEDDING_DIMENSIONS` to a new value, run `bun run src/migrate.ts` (or equivalent `runMigrations()` entrypoint), then `psql` verify `SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid='knowledge_chunks'::regclass AND attname='embedding'` returns the new `vector(N)` |
| `BrainRunner.init()` dimension-mismatch fail-fast produces a clear log message and `process.exit(1)`, not an obscure Postgres error | EMBD-05/D-15 | Requires a real Postgres connection with a `vector(N)` column already migrated to a *different* N than the configured provider — not practical to fully mock without losing the exact failure-mode signal | Point a `BrainRunner` instance at a test DB with `vector(768)` while `EMBEDDING_DIMENSIONS=1536`, run `init()`, confirm process exits with the mismatch log line before accepting any message |
| Gemini provider actually reaches `gemini-embedding-001` and returns 3072-dim vectors | D-18 | Requires a live `GOOGLE`/`API_KEY` credential — out of scope for unit mocks | With a valid API key configured, call `GeminiEmbeddingProvider.embed(["test"])` manually (e.g. via a scratch script) and confirm the returned vector has length 3072 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
