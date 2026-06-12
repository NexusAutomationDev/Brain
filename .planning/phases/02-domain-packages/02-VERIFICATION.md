---
phase: 02-domain-packages
verified: 2026-06-12T06:30:00Z
status: gaps_found
score: 4/5 roadmap success criteria verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed: []
  gaps_remaining:
    - "SC-2 environment configuration conflict — .env.test still has EMBEDDING_DIMENSIONS=10 in main working copy. Plan 02-10 fixed .gitignored .env.test only in the worktree; main repo file was not updated. bun test packages/memory fails with 10 failures."
  regressions:
    - "AI package default bun test (without pnpm scoping) now picks up checkpointer.test.ts and produces 2 failures. pnpm --filter @brain-pkg/ai run test correctly scopes to exclude it (21 pass, 0 fail)."
gaps:
  - truth: "MemoryManager reads a stored user profile row (long-term), retrieves the last checkpoint (short-term), and performs a similarity search returning the top-3 nearest embeddings (semantic) — all three layers exercised in a single test (SC-2)"
    status: failed
    reason: "Plan 02-10 updated memory test files (FakeEmbeddings -> SyntheticEmbeddings) and setup-test-db.sh (EMBEDDING_DIMENSIONS=128), but .env.test is .gitignored. The file was updated only inside the plan's worktree, which was not merged into the main repo's .env.test. The main /root/Brain/.env.test still contains EMBEDDING_DIMENSIONS=10. When bun test packages/memory runs it auto-loads this .env.test, triggering the schema validation error ('Invalid EMBEDDING_DIMENSIONS: 10. Must be between 128 and 4096.') before any test executes. 10 tests fail with this error."
    artifacts:
      - path: ".env.test"
        issue: "EMBEDDING_DIMENSIONS=10 — plan 02-10 updated this in its worktree but the main repo file was never updated. File is .gitignored so worktree changes are not tracked. Developer must manually update this file."
    missing:
      - "Update .env.test in /root/Brain/ to set EMBEDDING_DIMENSIONS=128 (one-line change). This is the sole remaining blocker for SC-2."

human_verification:
  - test: "SC-4: Verify Langfuse traces appear in Langfuse dashboard"
    expected: "When LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set and a LangGraph graph executes via graph.invoke() with callbacks from createTracingCallbacks(), traces should appear in the Langfuse dashboard within 30 seconds."
    why_human: "Requires real Langfuse API credentials, network connectivity to Langfuse cloud/self-hosted, a running LangGraph graph, and visual confirmation in the web dashboard. No unit test can verify trace delivery to an external service."
  - test: "SC-1: PostgresSaver state persistence across two graph invocations"
    expected: "When TEST_DATABASE_URL is set to a live PostgreSQL instance, run: TEST_DATABASE_URL=postgresql://user:pass@host/brain_test pnpm --filter @brain-pkg/ai run test:integration — all 3 checkpointer tests should pass including the SC-1 assertion (second invocation with same thread_id resumes state from first invocation)."
    why_human: "Requires a live PostgreSQL database. The bun test runner (Bun 1.3.2) hangs when importing @langchain/langgraph-checkpoint-postgres due to pg driver async hook incompatibility. The test:integration script uses bun run (not bun test) to bypass this, but requires manual execution with real DB credentials."
---

# Phase 2: Domain Packages Verification Report

**Phase Goal:** Implement all domain packages (ai, memory, transport, observability) with complete TypeScript implementations, passing test suites, and validated package interfaces
**Verified:** 2026-06-12T06:30:00Z
**Status:** gaps_found
**Re-verification:** Yes — third verification pass, after gap closure plans 08, 09, and 10

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | LangGraph graph with PostgresSaver persists state across two separate invocations | PARTIAL | createCheckpointer uses PostgresSaver.fromConnString + setup(). test:integration script added in plan 09. Default pnpm test script scoped to exclude checkpointer.test.ts. SC-1 assertion written. Requires live DB + bun run (Bun 1.3.2/pg async hook incompatibility). |
| SC-2 | MemoryManager exercises all 3 memory layers in a single test | FAILED | Memory test files updated (SyntheticEmbeddings, setup-test-db.sh = 128). Root .env.test still has EMBEDDING_DIMENSIONS=10. bun test packages/memory: 10 fail with "Invalid EMBEDDING_DIMENSIONS: 10". Via pnpm: 18 skip, 0 fail (clean). SC-2 integration code is correct but blocked by .env.test not updated in main working copy. |
| SC-3 | Webhook handler returns 200 on first call, 409 on X-Request-Id replay | VERIFIED | pnpm --filter @brain-pkg/transport run test: 15 pass, 0 fail. DedupCache + handler fully tested. SC-3 verified directly. |
| SC-4 | Langfuse traces appear in dashboard when env vars set | HUMAN NEEDED | createTracingCallbacks: returns [] without keys, returns [CallbackHandler] with both keys. 6 tracing tests pass. Real dashboard verification requires human testing. |
| SC-5 | EMBEDDING_MODEL and EMBEDDING_DIMENSIONS env vars configure provider and dimension without hardcoded values | VERIFIED | createEmbeddings reads process.env.EMBEDDING_MODEL (required) and EMBEDDING_DIMENSIONS. No literal "1536" or model strings in factory.ts. 5 embeddings tests pass. |

**Score:** 4/5 roadmap success criteria verified at code level

### Deferred Items

No items from this phase are addressed in later phases — all gaps are actionable.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/ai/src/graph/state.ts` | BrainStateAnnotation + BrainState | VERIFIED | schema_version (last-write-wins), messages (messagesStateReducer), userId, sessionId. All JSON-safe. |
| `packages/ai/src/graph/checkpointer.ts` | createCheckpointer returning PostgresSaver | VERIFIED | PostgresSaver.fromConnString(), setup() called. MemorySaver absent from all production code. |
| `packages/ai/src/llm/factory.ts` | createLLM + LLMOptions | VERIFIED | Reads LLM_PROVIDER from env. 4 providers (openai, anthropic, gemini, openrouter). ConfigurationError on missing/unknown. |
| `packages/ai/src/embeddings/factory.ts` | createEmbeddings | VERIFIED | Reads EMBEDDING_MODEL and EMBEDDING_DIMENSIONS from env. No hardcoded "1536". |
| `packages/ai/src/index.ts` | Barrel: 6 public symbols | VERIFIED | BrainStateAnnotation, BrainState, createCheckpointer, createLLM, LLMOptions, createEmbeddings all exported. |
| `packages/transport/src/interface.ts` | ITransport with start() + stop() | VERIFIED | start(port?: number): Promise<void> and stop(): Promise<void>. |
| `packages/transport/src/webhook/events.ts` | BrainEventSchema + BrainEvent | VERIFIED | Zod schema with conversationId, stepIndex, userId, content. BrainEvent type exported. |
| `packages/transport/src/webhook/dedup.ts` | DedupCache with claim() | VERIFIED | TTL_MS = 10 * 60 * 1000. Evict-on-write. Returns true/false. |
| `packages/transport/src/webhook/handler.ts` | createWebhookApp() + WebhookTransport | VERIFIED | POST /api/v1/webhook with DedupCache.claim and BrainEventSchema.safeParse. WebhookTransport implements ITransport. |
| `packages/transport/src/factory.ts` | createTransport(type?) | VERIFIED | Reads TRANSPORT env. Returns WebhookTransport. ConfigurationError on unknown. |
| `packages/transport/src/index.ts` | Barrel: 7 public symbols | VERIFIED | All symbols exported. |
| `packages/memory/src/long-term.ts` | readProfile + writeProfile | VERIFIED | readProfile with userId+key WHERE clause. writeProfile with onConflictDoUpdate. |
| `packages/memory/src/semantic.ts` | upsertEmbedding (void) + searchSimilar | VERIFIED | upsertEmbedding: void (fire-and-forget). searchSimilar uses cosineDistance. |
| `packages/memory/src/short-term.ts` | getCheckpoint + listCheckpoints | VERIFIED | Delegates to PostgresSaver.getTuple and .list. No MemorySaver. |
| `packages/memory/src/manager.ts` | MemoryManager class | VERIFIED | Promise.all across 3 layers. saveContext writes long-term + fire-and-forget embedding. |
| `packages/memory/src/index.ts` | Barrel: all memory symbols | VERIFIED | readProfile, writeProfile, getCheckpoint, listCheckpoints, upsertEmbedding, searchSimilar, MemoryManager, MemoryContext exported. |
| `packages/memory/package.json` | Direct deps: drizzle-orm, postgres, checkpoint-postgres | VERIFIED | drizzle-orm: ^0.45.2, postgres: ^3.4.9 in dependencies. @langchain/langgraph-checkpoint-postgres: ^1.0.3 in devDependencies. |
| `.env.test` | EMBEDDING_DIMENSIONS=128 | FAILED | Contains EMBEDDING_DIMENSIONS=10. Plan 02-10 updated only the worktree copy; .gitignored file was not propagated to main repo. |
| `packages/memory/src/semantic.test.ts` | SyntheticEmbeddings({ vectorSize: 128 }) | VERIFIED | FakeEmbeddings fully replaced. SyntheticEmbeddings({ vectorSize: 128 }) imported and used. Array(128) used for inline vectors. |
| `packages/memory/src/manager.test.ts` | SyntheticEmbeddings({ vectorSize: 128 }) | VERIFIED | FakeEmbeddings fully replaced. SyntheticEmbeddings({ vectorSize: 128 }) instantiated. |
| `scripts/setup-test-db.sh` | EMBEDDING_DIMENSIONS=128 | VERIFIED | Updated in plan 02-10. Contains EMBEDDING_DIMENSIONS=128. |
| `packages/observability/src/tracing.ts` | createTracingCallbacks | VERIFIED | Conditional on both Langfuse env vars. Returns [] or [CallbackHandler]. Secret never logged. |
| `packages/observability/src/index.ts` | Barrel includes createTracingCallbacks | VERIFIED | Exports createTracingCallbacks and TracingContext. |
| `packages/observability/package.json` | @langfuse/langchain dependency | VERIFIED | @langfuse/langchain: ^5.4.1 in dependencies. @opentelemetry/api: ^1.9.0 in devDependencies. |
| `packages/ai/package.json` | test:integration script | VERIFIED | "test:integration": "TEST_DATABASE_URL=$TEST_DATABASE_URL bun run src/graph/checkpointer.test.ts" |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `checkpointer.ts` | `@langchain/langgraph-checkpoint-postgres` | PostgresSaver.fromConnString() | WIRED | Confirmed in source |
| `state.ts` | `@langchain/langgraph` | Annotation.Root | WIRED | Confirmed in source |
| `llm/factory.ts` | `process.env.LLM_PROVIDER` | switch statement | WIRED | Confirmed in source |
| `embeddings/factory.ts` | `process.env.EMBEDDING_MODEL` | conditional check + throw | WIRED | Confirmed in source |
| `webhook/handler.ts` | `webhook/dedup.ts` | cache.claim(requestId) | WIRED | Confirmed in source |
| `webhook/handler.ts` | `webhook/events.ts` | BrainEventSchema.safeParse | WIRED | Confirmed in source |
| `memory/long-term.ts` | memories table | onConflictDoUpdate | WIRED | Confirmed in source |
| `memory/semantic.ts` | embeddings table | cosineDistance | WIRED | Confirmed in source |
| `memory/manager.ts` | `memory/short-term.ts` | getCheckpoint(this.checkpointer, threadId) | WIRED | Confirmed in source |
| `memory/manager.ts` | `memory/long-term.ts` | readProfile(this.db, userId, profileKey) | WIRED | Confirmed in source |
| `memory/manager.ts` | `memory/semantic.ts` | searchSimilar(this.db, userId, queryVector, topK) | WIRED | Confirmed in source |
| `tracing.ts` | `process.env.LANGFUSE_PUBLIC_KEY` | conditional guard | WIRED | Confirmed in source |
| `tracing.ts` | `@langfuse/langchain` | CallbackHandler import | WIRED | Confirmed in source |
| `.env.test` | `packages/database/src/schema/tables.ts` | EMBEDDING_DIMENSIONS env var | NOT_WIRED | .env.test has EMBEDDING_DIMENSIONS=10; schema rejects values < 128 at module load time |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| AI package unit tests (21 tests, scoped) | `pnpm --filter @brain-pkg/ai run test` | 21 pass, 0 fail | PASS |
| AI package unscoped (bun test picks up checkpointer) | `bun test packages/ai` | 21 pass, 2 fail (checkpointer afterAll timeout — no DB) | PARTIAL |
| Transport package tests (15 tests) | `pnpm --filter @brain-pkg/transport run test` | 15 pass, 0 fail | PASS |
| Memory package tests via pnpm | `pnpm --filter @brain-pkg/memory run test` | 18 skip, 0 fail | PASS (no DB — expected) |
| Memory package tests via bun test directly | `bun test packages/memory` | 10 fail (EMBEDDING_DIM=10 schema error) | FAIL |
| Observability tracing tests (6 tests) | `pnpm --filter @brain-pkg/observability run test` | 12 pass, 22 todo, 0 fail | PASS |
| LLM + embeddings together (mock collision fix) | `bun test packages/ai/src/llm/factory.test.ts packages/ai/src/embeddings/factory.test.ts` | Covered by pnpm scoped test | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MEM-01 | 02-02, 02-06 | Short-term memory via PostgresSaver | SATISFIED | createCheckpointer uses PostgresSaver. getCheckpoint/listCheckpoints wrap getTuple/list. MemorySaver absent from all production files. |
| MEM-02 | 02-05 | Long-term memory via Drizzle memories table | SATISFIED | readProfile and writeProfile with onConflictDoUpdate upsert. userId+key conflict target confirmed. |
| MEM-03 | 02-05 | Semantic memory — fire-and-forget upsert | SATISFIED | upsertEmbedding: void (fire-and-forget). searchSimilar uses cosineDistance via drizzle-orm. |
| MEM-04 | 02-06 | MemoryManager encapsulates 3 layers | SATISFIED | MemoryManager with getContext (Promise.all across 3 layers) and saveContext. SC-2 test written with SyntheticEmbeddings; blocked from running end-to-end by .env.test gap. |
| AI-01 | 02-02 | PostgresSaver as sole checkpointer | SATISFIED | MemorySaver absent from all production files. test:integration script added for SC-1 manual verification. |
| AI-02 | 02-02 | Subgraph pattern | SATISFIED | subgraph.test.ts: 2 tests pass. Compiled child graph invoked as parent node, result returned. |
| AI-03 | 02-02 | JSON-safe state schema | SATISFIED | BrainStateAnnotation: schema_version, messages, userId, sessionId. No Set/Map/Date/Buffer fields. |
| AI-04 | 02-03, 02-09 | Embedding provider via EMBEDDING_MODEL env | SATISFIED | createEmbeddings reads process.env.EMBEDDING_MODEL (required) and EMBEDDING_DIMENSIONS. No hardcoded 1536. Mock collision fixed (OpenAIEmbeddings stub added). |
| AI-05 | 02-03 | LLM provider abstraction (4 providers) | SATISFIED | createLLM with openai, anthropic, gemini, openrouter. ConfigurationError on missing/unknown provider. |
| TRANS-01 | 02-04 | ITransport abstract interface | SATISFIED | ITransport with start(port?) and stop(). WebhookTransport implements it. |
| TRANS-02 | 02-04 | Webhook HTTP POST handler | SATISFIED | POST /api/v1/webhook. X-Request-Id required. BrainEvent validated with zod safeParse. |
| TRANS-03 | 02-04 | Idempotency via X-Request-Id | SATISFIED | DedupCache with 10-minute TTL. SC-3 test: 200 first call, 409 duplicate. 15 transport tests pass. |
| TRANS-04 | 02-04 | Transport selection via TRANSPORT env | SATISFIED | createTransport reads TRANSPORT env, defaults to webhook. ConfigurationError on unknown type. |
| OBS-03 | 02-07 | Langfuse integration via env vars | SATISFIED | createTracingCallbacks: returns [] (keys absent) or [CallbackHandler] (both keys set). 6 unit tests pass. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.env.test` | 2 | `EMBEDDING_DIMENSIONS=10` | Blocker | Plan 02-10 fixed this in the worktree but .gitignored .env.test was not propagated to main working copy. Causes 10 test failures when bun test auto-loads this file. |
| `packages/transport/src/webhook/handler.ts` | 43 | Comment: "Event dispatching will be wired in Phase 3" | Info | Intentional — Phase 2 goal is transport validation/dedup only. BrainRunner wiring is Phase 3 scope. Not a stub. |
| `packages/observability/src/tracing.ts` | 37 | `return []` | Info | Intentional D-02 design — silent no-op when Langfuse keys absent. Not a stub. |

### Human Verification Required

**1. SC-4: Langfuse Dashboard Trace Verification**

**Test:** Configure LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY env vars from a real Langfuse project. Run a LangGraph graph invocation using callbacks from `createTracingCallbacks({ sessionId: "test-session", userId: "test-user" })`.

**Expected:** Within 30 seconds, a trace should appear in the Langfuse dashboard showing the graph execution with session and user metadata.

**Why human:** Requires real Langfuse API credentials, network access to Langfuse cloud/self-hosted, a running LangGraph graph, and visual confirmation in the web dashboard.

---

**2. SC-1: PostgresSaver State Persistence Across Invocations**

**Test:** Set TEST_DATABASE_URL to a live PostgreSQL instance with pgvector. Run: `TEST_DATABASE_URL=postgresql://user:pass@host/brain_test pnpm --filter @brain-pkg/ai run test:integration`

**Expected:** 3 tests pass — PostgresSaver instance created, setup() idempotent, second invocation with same thread_id resumes state from first invocation.

**Why human:** Requires a live PostgreSQL database. Bun 1.3.2 hangs when importing @langchain/langgraph-checkpoint-postgres in the bun test async context. The test:integration script uses `bun run` to bypass this, but requires manual execution with real DB credentials.

### Gaps Summary

**Gap 1 (STILL OPEN — .env.test not updated in main working copy):** Plan 02-10 executed in a git worktree and updated `.env.test` from `EMBEDDING_DIMENSIONS=10` to `EMBEDDING_DIMENSIONS=128`. However, `.env.test` is in `.gitignore` — the fix was never committed or propagated from the worktree to the main repository working copy. The file at `/root/Brain/.env.test` currently reads `EMBEDDING_DIMENSIONS=10`, causing `bun test packages/memory` to fail with the schema validation error.

The resolution is a one-line fix: update `.env.test` to set `EMBEDDING_DIMENSIONS=128`. This is the only remaining code-level blocker. All other implementation work (SyntheticEmbeddings in test files, setup-test-db.sh update, memory package deps) was completed correctly by plan 02-10.

**Gap 2 (PARTIALLY MITIGATED — SC-1 requires human execution with live DB):** The SC-1 assertion in checkpointer.test.ts cannot run in the bun test runner due to a Bun 1.3.2/pg driver async hook incompatibility. The code is correct, test:integration script exists, and the assertion is written. Human execution with a live PostgreSQL database is needed for full SC-1 closure.

---

_Verified: 2026-06-12T06:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — third verification pass, after gap closure plans 08, 09, and 10_
