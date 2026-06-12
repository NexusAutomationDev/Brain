---
plan: "02-05"
phase: "02-domain-packages"
subsystem: memory
tags: [memory, drizzle, pgvector, cosine-search, long-term, semantic, embeddings, mem-02, mem-03]
dependency_graph:
  requires: ["02-01"]
  provides: [readProfile, writeProfile, upsertEmbedding, searchSimilar, EmbeddingInput]
  affects: ["02-07"]
tech_stack:
  added: []
  patterns:
    - "onConflictDoUpdate with [userId, key] conflict target for atomic upsert (MEM-02)"
    - "Fire-and-forget void function with .catch() logging for non-blocking embedding writes (MEM-03)"
    - "cosineDistance from drizzle-orm for type-safe HNSW vector similarity search (MEM-03)"
    - "describeIfDb pattern: skip integration tests when TEST_DATABASE_URL absent"
    - "userId isolation in WHERE clause for both long-term and semantic memory queries"
key_files:
  created:
    - packages/memory/src/long-term.ts
    - packages/memory/src/semantic.ts
  modified:
    - packages/memory/src/long-term.test.ts
    - packages/memory/src/semantic.test.ts
decisions:
  - "userId WHERE clause added to searchSimilar — mitigates T-2-05-03 (cross-user result leakage)"
  - "upsertEmbedding returns void (not Promise<void>) — fire-and-forget contract enforced at type level"
  - "brain_test embeddings table recreated with vector(10) — matches FakeEmbeddings default dimension"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-11"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 2 Plan 05: Memory Layers (Long-Term + Semantic) Summary

**One-liner:** Long-term key/value memory (Drizzle upsert against memories table) and semantic memory (fire-and-forget pgvector insert + cosine similarity search) implemented with full userId isolation and integration tests using FakeEmbeddings.

## What Was Built

### packages/memory/src/long-term.ts (MEM-02)

Two exported functions implementing structured user profile storage via Drizzle:

- **`readProfile(db, userId, key)`** — `SELECT value FROM memories WHERE user_id = $1 AND key = $2 LIMIT 1`. Returns the stored JSON value or `null` if not found.
- **`writeProfile(db, userId, key, value)`** — `INSERT ... ON CONFLICT (user_id, key) DO UPDATE SET value = $1, updated_at = now()`. Atomic upsert using Drizzle's `onConflictDoUpdate` with `[memories.userId, memories.key]` as conflict target.

Security: Both functions enforce userId isolation via explicit Drizzle `eq()` conditions — parameterized queries, no string interpolation (mitigates T-2-05-01).

### packages/memory/src/semantic.ts (MEM-03)

Two exported functions implementing vector-based semantic memory:

- **`upsertEmbedding(db, input)`** — `void` (fire-and-forget). Inserts row into `embeddings` table. DB write runs asynchronously; errors caught and logged via `createLogger` but never propagated to caller. Prevents embedding failures from blocking agent turn processing.
- **`searchSimilar(db, userId, queryVector, topK, threshold)`** — Top-K cosine similarity search using `cosineDistance` from `drizzle-orm`. Uses HNSW index path. Filters by `userId` (T-2-05-03 mitigation) and similarity threshold. Returns `Array<{ id, content, similarity }>`.

### Integration Tests

Both test files updated from Nyquist stubs (Wave 0) to full integration tests:

- **long-term.test.ts**: 5 tests — null-return for missing key, insert, read-after-write, upsert (double-write), userId isolation (cross-user returns null)
- **semantic.test.ts**: 4 tests — fire-and-forget insert, search returns inserted vector, topK=1 limit, void return type assertion

Tests use `describeIfDb` pattern — automatically skipped when `TEST_DATABASE_URL` is absent (CI-safe).
FakeEmbeddings from `@langchain/core/utils/testing` generates deterministic 10-dimensional vectors.
`brain_test` database uses `vector(10)` for `embeddings.embedding` column (recreated from 1536 to match FakeEmbeddings default dimension).

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Implement long-term memory layer (MEM-02) | eef8eec | long-term.ts (created), long-term.test.ts (updated) |
| 2 | Implement semantic memory layer (MEM-03) | 2020a1c | semantic.ts (created), semantic.test.ts (updated) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Added userId WHERE clause to searchSimilar**

- **Found during:** Task 2 implementation (threat model review)
- **Issue:** Plan's code template for `searchSimilar` only filtered by `gt(similarity, threshold)` — no userId filter. Threat model T-2-05-03 explicitly requires this mitigation: "add userId WHERE clause in implementation to ensure per-user isolation."
- **Fix:** Added `and(eq(embeddings.userId, userId), gt(similarity, threshold))` to the WHERE clause. `eq` and `and` added to drizzle-orm imports.
- **Files modified:** packages/memory/src/semantic.ts
- **Commit:** 2020a1c (included in semantic implementation commit)

**2. [Rule 3 - Blocking] Recreated brain_test embeddings table with vector(10)**

- **Found during:** Task 2 setup verification
- **Issue:** `brain_test` database had `embeddings.embedding vector(1536)` (migration generated before EMBEDDING_DIMENSIONS was set to 10). FakeEmbeddings generates 10-dimensional vectors — inserting would fail with pgvector dimension mismatch.
- **Fix:** Dropped and recreated `embeddings` table with `vector(10)` and rebuilt HNSW index. `memories` table unaffected.
- **Files modified:** None (database fix only)
- **Command:** `ALTER TABLE DROP; CREATE TABLE ... vector(10)` executed via docker exec

## Known Stubs

None — both `long-term.ts` and `semantic.ts` are fully implemented. Tests are complete (no `it.todo` remaining in these files). The `packages/memory/src/index.ts` still has `export {}` placeholder — will be wired in plan 02-07 (MemoryManager).

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced. All DB access uses Drizzle parameterized queries. userId isolation enforced in all query WHERE clauses per threat model.

## Self-Check: PASSED
