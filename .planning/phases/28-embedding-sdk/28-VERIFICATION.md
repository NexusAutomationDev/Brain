---
phase: 28-embedding-sdk
verified: 2026-07-01T16:07:34Z
status: passed
score: 5/5 must-haves verified (roadmap success criteria, includes 1 override)
overrides_applied: 1
overrides:
  - must_have: "Migration cria coluna vector(N) onde N vem de EMBEDDING_DIMENSIONS ENV — mudar ENV e re-migrar gera coluna com nova dimensão sem erro"
    reason: "Generation-time ENV-driven mechanism is empirically verified working (drizzle-kit generate with EMBEDDING_DIMENSIONS=768 correctly produced vector(768) ALTER statements). The TRUNCATE-must-be-manually-re-added step and the hardcoded vector(1536) in the committed migration are accepted pre-production tradeoffs per 28-02-PLAN.md's own D-05/D-19 design notes — no real production clients exist yet. Follow-up: add a warning comment to 0009_embedding_dimensions_fix.sql, document the manual TRUNCATE step in packages/database/.env.example, and add EMBEDDING_PROVIDER/EMBEDDING_MODEL/EMBEDDING_DIMENSIONS to apps/brain-sdr/.env.example before onboarding a real Gemini-configured customer."
    accepted_by: "biellil"
    accepted_at: "2026-07-01T16:11:14Z"
gaps:
  - truth: "Migration cria coluna vector(N) onde N vem de EMBEDDING_DIMENSIONS ENV — mudar ENV e re-migrar gera coluna com nova dimensão sem erro"
    status: partial
    reason: >
      The generate-time mechanism genuinely works — empirically re-verified in this
      verification pass by setting EMBEDDING_DIMENSIONS=768 and running `drizzle-kit
      generate` against the current schema/snapshot chain, which correctly produced
      `ALTER COLUMN "embedding" SET DATA TYPE vector(768)` for both `embeddings` and
      `knowledge_chunks`. However, "sem erro" (without error) only holds if the operator
      also manually re-adds a TRUNCATE statement before the ALTER COLUMN statements —
      drizzle-kit does NOT auto-generate the TRUNCATE, and `ALTER COLUMN TYPE vector(N)`
      throws `ERROR: expected N dimensions, not M` on any non-empty table with a different
      existing dimension (confirmed in 28-RESEARCH.md Pitfall 1). This manual step is
      documented in the 28-02-PLAN.md task instructions but is NOT documented in
      packages/database/.env.example (which only says "generating a NEW migration" without
      mentioning the required TRUNCATE) or in any operator-facing runbook. Migration 0009 as
      committed also hardcodes vector(1536) with no inline warning about this being
      OpenAI-specific (Gemini defaults to 3072) — matches 28-REVIEW.md CR-01 exactly.
    artifacts:
      - path: "packages/database/src/migrations/0009_embedding_dimensions_fix.sql"
        issue: "Hardcoded vector(1536), no comment documenting this is OpenAI-specific or that regeneration requires manually re-adding TRUNCATE"
      - path: "packages/database/.env.example"
        issue: "Documents that changing EMBEDDING_DIMENSIONS requires a new generated migration, but omits that the TRUNCATE step must be added manually and that this is destructive/irreversible against non-empty tables"
    missing:
      - "Inline warning comment in 0009_embedding_dimensions_fix.sql documenting the dimension is OpenAI-specific and that regeneration requires re-adding TRUNCATE manually (per 28-REVIEW.md CR-01 suggested fix)"
      - "Operator-facing documentation (or a generation script) making the TRUNCATE-and-regenerate procedure safe/repeatable rather than a manually-remembered step"
deferred: []
human_verification: []
---

# Phase 28: Embedding SDK Verification Report

**Phase Goal:** `packages/embeddings` existe como abstração completa de provider — qualquer Brain configura modelo e dimensões via ENV sem tocar TypeScript
**Verified:** 2026-07-01T16:07:34Z
**Status:** passed (1 override — see frontmatter)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Developer implementa `IEmbeddingProvider` com `embed()`, `dimensions`, `providerName` e o Brain aceita sem modificação no core | VERIFIED | `packages/embeddings/src/provider.interface.ts:10-19` defines the exact contract. `OpenAIEmbeddingProvider` and `GeminiEmbeddingProvider` both implement it independently; `createEmbeddingProvider()` in `factory.ts` resolves either via ENV with zero core-package changes required. `runner.ts`, `ingest.ts`, `search-knowledge.ts` all consume the interface type only, never a concrete class. |
| 2 | `OpenAIEmbeddingProvider` em `packages/embeddings` embeda textos via API OpenAI com modelo e dimensões configuráveis | VERIFIED | `packages/embeddings/src/openai-provider.ts:11-16` reads `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS`/`API_KEY` from ENV or constructor options; `embed()`/`embedQuery()` delegate to `@langchain/openai`'s `OpenAIEmbeddings.embedDocuments/embedQuery`. Unit tests (`openai-provider.test.ts`) pass in isolation (part of 22/22 passing `packages/embeddings` suite). |
| 3 | Migration cria coluna `vector(N)` onde N vem de `EMBEDDING_DIMENSIONS` ENV — mudar ENV e re-migrar gera coluna com nova dimensão sem erro | **PASSED (override)** | Empirically re-verified the generate-time mechanism: setting `EMBEDDING_DIMENSIONS=768` and running `drizzle-kit generate` against the current schema/snapshot chain correctly produced `vector(768)` ALTER statements for both tables — confirming the core ENV→schema derivation genuinely works, refuting the concern that N is unconditionally frozen at 1536. The remaining gap (TRUNCATE must be manually re-added on regeneration; committed migration hardcodes vector(1536) with no inline warning — matches 28-REVIEW.md CR-01) is accepted as a pre-production tradeoff per override in frontmatter, accepted by biellil on 2026-07-01. Follow-up documentation items tracked in the override reason. |
| 4 | BrainRunner chama `createEmbeddings()` via `IEmbeddingProvider` ao processar mensagem — escrita semântica deixa de ser dead code | VERIFIED | `packages/core/src/runner/runner.ts:149-151` resolves `embeddingProvider` in `init()`; `runner.ts:335` calls `embeddingProvider.embedQuery(event.Message)` before `getContext()`; `runner.ts:435` calls `embeddingProvider.embed([profileText])` before `saveContext()`. `packages/memory/src/manager.ts:84-85` confirms `saveContext()` calls `upsertEmbedding()` when `input.embedding` is present — the previously dead write path is now genuinely reachable. Both call sites wrapped in try/catch with graceful fallback (D-10), never crashing the turn. |

**Score:** 4/4 roadmap truths (#3 via override — mechanism verified working, remaining doc/safety gap accepted as pre-production tradeoff)

### Requirement-Level Must-Haves (from PLAN frontmatter, cross-checked against REQUIREMENTS.md)

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| EMBD-01 | `IEmbeddingProvider` interface implementable by any provider | SATISFIED | `provider.interface.ts` + two independent implementations |
| EMBD-02 | `OpenAIEmbeddingProvider` disponível como adapter padrão em `packages/embeddings` | SATISFIED | `openai-provider.ts`, exported from `index.ts` |
| EMBD-03 | Migration cria `vector(N)` com N lido da ENV `EMBEDDING_DIMENSIONS` em runtime | SATISFIED (override) | See truth #3 above — generation-time (not runtime) mechanism, requires manual TRUNCATE re-add on regeneration; accepted as pre-production tradeoff |
| EMBD-04 | Brain configura provider, modelo e dimensões via ENV sem alterar código TypeScript | SATISFIED (with doc gap) | `resolveEmbeddingProviderName()` + both providers read ENV exclusively; functionally zero-TypeScript-change. Gap: `apps/brain-sdr/.env.example` does not list `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` at all (only `packages/database/.env.example` documents `EMBEDDING_DIMENSIONS`) — a developer configuring brain-sdr would not discover these vars from the app's own `.env.example`. |
| EMBD-05 | `BrainRunner` conecta semantic write path (`createEmbeddings`) ao `IEmbeddingProvider` | SATISFIED | See truth #4 above |

All 5 requirement IDs (EMBD-01 through EMBD-05) declared in REQUIREMENTS.md for Phase 28 are claimed by at least one plan's frontmatter. No orphaned requirements found.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/embeddings/src/provider.interface.ts` | `IEmbeddingProvider` interface | VERIFIED | Exact shape: `embed`, `embedQuery`, `dimensions`, `providerName` |
| `packages/embeddings/src/openai-provider.ts` | `OpenAIEmbeddingProvider` class | VERIFIED | Implements interface, ENV-configurable |
| `packages/embeddings/src/gemini-provider.ts` | `GeminiEmbeddingProvider` class, non-deprecated model | VERIFIED | Uses `gemini-embedding-001`, not deprecated `text-embedding-004` |
| `packages/embeddings/src/factory.ts` | `createEmbeddingProvider()` | VERIFIED | ENV-driven resolution, independent of `LLM_PROVIDER` per D-11/D-13 |
| `packages/embeddings/src/index.ts` | Package barrel export | VERIFIED | Exports all 4 required symbols |
| `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` | TRUNCATE + ALTER COLUMN TYPE vector(N) | VERIFIED (as committed) / WEAK (as a repeatable mechanism) | Both `ALTER COLUMN` statements present, TRUNCATE precedes them. Hardcodes 1536 — correct for the phase's stated intent (prove mechanism, not change default) but this is the exact committed artifact CR-01 flags as risky for future dimension changes |
| `packages/core/src/runner/runner.ts` | `embeddingProvider` resolved + used at query/save time + dimension fail-fast | VERIFIED | All three concerns present and wired |
| `packages/core/src/tools/search-knowledge.ts` | Uses `IEmbeddingProvider.embedQuery`, not `createEmbeddings()` | VERIFIED | `embeddingProvider.embedQuery(args.query)` at line 60 |
| `packages/core/src/rag/ingest.ts` | Uses `IEmbeddingProvider.embed`, not `createEmbeddings()` | VERIFIED | `embeddingProvider.embed(chunks)` at line 79 |
| `packages/core/src/rag/reembed.ts` | `createReembedApp(sql, embeddingProvider)` | VERIFIED | Mounted in `apps/brain-sdr/src/server.ts:40`, reuses `INGEST_TOKEN` fail-closed auth |
| `packages/ai/src/index.ts` | No longer exports any embedding factory | VERIFIED | Barrel only exports `BrainStateAnnotation`, `createCheckpointer`, `createLLM`, `extractTokenUsage`. `packages/ai/src/embeddings/` removed in commit `b4edbe3` (only stale `dist/` build artifacts remain, not source) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `factory.ts` | `openai-provider.ts` | dynamic import + switch | WIRED | Confirmed |
| `factory.ts` | `gemini-provider.ts` | dynamic import + switch | WIRED | Confirmed |
| `tsconfig.base.json` | `packages/embeddings/src` | paths mapping | WIRED | `@brain-pkg/embeddings` resolves correctly (used across `packages/core`, `apps/brain-sdr`) |
| `runner.ts` | `packages/embeddings` | `BrainRunnerOptions.embeddingProvider` + ENV fallback | WIRED | Mirrors `eventPublisher` injection pattern |
| `runner.ts` | `memory/manager.ts getContext()` | `queryVector` via `embedQuery()` before call | WIRED | `runner.ts:335,344` |
| `runner.ts` | `memory/manager.ts saveContext()` | `embedding` field via `embed()` before call | WIRED | `runner.ts:435,449-454`; confirmed `manager.ts:84-85` calls `upsertEmbedding()` when field present |
| `runner.ts init()` | `pg_attribute.atttypmod` | D-15 dimension fail-fast | WIRED | `runner.ts:155-173`, `process.exit(1)` on mismatch |
| `search-knowledge.ts` | `packages/embeddings` | injected provider, `embedQuery()` at search-time | WIRED | Confirmed |
| `ingest.ts` | `packages/embeddings` | injected provider, `embed()` at ingest-time | WIRED | Confirmed |
| `0009_embedding_dimensions_fix.sql` | `tables.ts` `EMBEDDING_DIM` | vector(N) must equal generation-time ENV value | WIRED, but MANUAL | Empirically confirmed via a live `drizzle-kit generate` re-run with `EMBEDDING_DIMENSIONS=768` in this verification pass — produces correct `vector(768)`. Gap: TRUNCATE must be manually re-added per regeneration (see gap above) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `runner.ts` `queryVector` | `embeddingProvider.embedQuery(event.Message)` | Real OpenAI/Gemini API call via LangChain wrapper | Yes (network-dependent, not a stub) | FLOWING |
| `runner.ts` `embeddingField` | `embeddingProvider.embed([profileText])` | Real OpenAI/Gemini API call | Yes | FLOWING |
| `memory/manager.ts saveContext()` | `input.embedding` → `upsertEmbedding(this.db, input.embedding)` | Passed through from `runner.ts`, not synthesized/hardcoded | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Changing `EMBEDDING_DIMENSIONS` and regenerating produces new `vector(N)` | `EMBEDDING_DIMENSIONS=768 drizzle-kit generate` against live schema/snapshot chain (scratch output dir, cleaned up after) | Produced `ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(768);` and same for `knowledge_chunks` | PASS (mechanism works) — but see gap: no auto-TRUNCATE |
| `packages/embeddings` unit tests pass in isolation | `bun test packages/embeddings` | 22 pass, 0 fail | PASS |
| `packages/core/src/runner` unit tests pass in isolation | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | 36 pass, 0 fail | PASS |
| Full-repo test suite (embeddings + runner run together) | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts packages/embeddings/src/__tests__/unit/factory.test.ts` | 44 pass, 3 fail | FAIL — see anti-patterns below |
| `packages/ai` no longer exposes embedding factory | `grep` on `packages/ai/src/index.ts` | Only LLM/graph exports present | PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/runner/__tests__/brain-runner.test.ts` | 106-108 | `mock.module("@brain-pkg/embeddings", ...)` at module scope, never restored | ⚠️ Warning | Globally patches the `@brain-pkg/embeddings` module registry for the entire bun test process. When `packages/embeddings/src/__tests__/unit/factory.test.ts` runs in the same process (e.g. full `bun test` from repo root), 3 of its tests fail because the mocked `createEmbeddingProvider` (fixed to return `providerName: "openai"`) wins over the real ENV-driven resolution logic under test. Verified: both test files pass 100% in isolation; combining them reproduces the failure deterministically. This is a pre-existing codebase pattern (same `mock.module`-without-restore convention used for `@brain-pkg/ai`, `@brain-pkg/memory`, etc., predating phase 28), but phase 28 added a new test file (`factory.test.ts`) that is newly exposed to this contamination. The 28-05-SUMMARY.md and deferred-items.md already document the same class of issue for `lead-service-fup.test.ts`/`reembed.ts`, confirming this is a known, systemic, project-wide test-isolation gap rather than a phase-28-specific logic bug. |
| `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` | 1-5 | Hardcoded `vector(1536)`, no inline comment on OpenAI-specificity or regeneration procedure | 🛑 Blocker (for SC#3 as literally phrased) | See gap above — matches 28-REVIEW.md CR-01 |
| `apps/brain-sdr/.env.example` | — | Missing `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` entries | ⚠️ Warning | EMBD-04 is functionally satisfied (code reads ENV correctly) but the app-level `.env.example` a developer would consult when configuring a Brain doesn't mention these vars at all — only `packages/database/.env.example` documents `EMBEDDING_DIMENSIONS` (from a DB-migration angle, not a Brain-configuration angle) |

### Human Verification Required

None. All checks in this verification were completable via static analysis, unit test execution, and a live `drizzle-kit generate` dry-run.

### Gaps Summary

The core embedding abstraction (EMBD-01, EMBD-02, EMBD-05) is genuinely and solidly implemented: `IEmbeddingProvider` is a clean, provider-agnostic contract; `OpenAIEmbeddingProvider`/`GeminiEmbeddingProvider` both work; `BrainRunner` now calls `embedQuery()`/`embed()` at both read and write points in the conversation turn, activating what was previously dead code (`upsertEmbedding()`); there is exactly one embedding code path left in the codebase (`packages/ai`'s old factory was removed).

The one substantive gap is **success criterion #3**, which directly corresponds to 28-REVIEW.md's CR-01 finding. This verification empirically re-confirmed CR-01's core claim: the ENV → `vector(N)` derivation mechanism genuinely works (re-tested live in this pass with `EMBEDDING_DIMENSIONS=768`, producing correct SQL), refuting any suspicion that the mechanism is entirely broken or fictional. However, the criterion's exact wording — "mudar ENV e re-migrar gera coluna com nova dimensão **sem erro**" — is not unconditionally true as committed:

1. `drizzle-kit generate` does NOT automatically add the `TRUNCATE` statement that makes the migration safe against non-empty tables; an operator must manually re-add it every time, following a procedure documented only in the 28-02-PLAN.md task instructions (not in any user-facing runbook or `.env.example`).
2. Migration 0009 as shipped hardcodes `vector(1536)`, correct for the phase's explicit intent (prove the mechanism, not change the default) but offers no inline warning that this value is OpenAI-specific and unsuitable for a Gemini-configured Brain (which needs 3072) — exactly as CR-01 describes.

A secondary, lower-severity gap is that `apps/brain-sdr/.env.example` was never updated to document the new `EMBEDDING_*` ENV vars, and a test-isolation issue (pre-existing project-wide pattern) causes 3 of `factory.test.ts`'s tests to fail when run in combination with `packages/core`'s runner tests in the same process — this does not indicate a logic defect in the embeddings package itself (confirmed passing 22/22 in isolation) but is a CI-reliability risk worth closing.

**This looks like a case for either an override or a small closure plan** — the design intent (documented explicitly in 28-02-PLAN.md and 28-02-SUMMARY.md as "proving the mechanism, not changing the default," with T-28-04/D-05 accepting the TRUNCATE tradeoff since no production clients exist yet) suggests these gaps were consciously deferred rather than missed. If the project owner considers "manually re-add TRUNCATE, documented in the plan file" sufficient given pre-production status, an override for SC#3 would be appropriate. Otherwise, a small closure plan should: (a) add the CR-01-suggested warning comment to `0009_embedding_dimensions_fix.sql`, (b) document the TRUNCATE-must-be-manually-added caveat in `packages/database/.env.example`, and (c) add `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` to `apps/brain-sdr/.env.example`.

**This looks intentional.** To accept this deviation, add to VERIFICATION.md frontmatter:

```yaml
overrides:
  - must_have: "Migration cria coluna vector(N) onde N vem de EMBEDDING_DIMENSIONS ENV — mudar ENV e re-migrar gera coluna com nova dimensão sem erro"
    reason: "Generation-time ENV-driven mechanism is empirically verified working; TRUNCATE-must-be-manual and hardcoded-1536-in-committed-migration are accepted pre-production tradeoffs per D-05/D-19 (no real production clients exist yet)"
    accepted_by: "{name}"
    accepted_at: "{ISO timestamp}"
```

---

_Verified: 2026-07-01T16:07:34Z_
_Verifier: Claude (gsd-verifier)_
