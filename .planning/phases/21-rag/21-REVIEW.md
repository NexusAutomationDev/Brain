---
phase: 21-rag
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - apps/brain-sdr/src/index.ts
  - apps/brain-sdr/src/server.ts
  - packages/ai/src/embeddings/__tests__/factory.test.ts
  - packages/ai/src/embeddings/factory.ts
  - packages/core/src/index.ts
  - packages/core/src/rag/__tests__/chunker.test.ts
  - packages/core/src/rag/__tests__/ingest.test.ts
  - packages/core/src/rag/__tests__/search.test.ts
  - packages/core/src/rag/chunker.ts
  - packages/core/src/rag/index.ts
  - packages/core/src/rag/ingest.ts
  - packages/core/src/rag/search.ts
  - packages/core/src/tools/__tests__/search-knowledge.test.ts
  - packages/core/src/tools/search-knowledge.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 21: Code Review Report

**Reviewed:** 2026-06-24
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

This review covers the Phase 21 RAG implementation: chunker, ingest endpoint, cosine similarity search, the `search_knowledge` LangChain tool, the embeddings factory, and their test suites.

Overall the implementation is well-structured. Security boundaries are respected (INGEST_TOKEN fail-closed, no secret logging, payload size limit). The separation of concerns between `ingest.ts`, `search.ts`, and `search-knowledge.ts` is clean.

One critical issue was found: the 1MB payload limit check in `ingest.ts` runs **after** the JSON body has already been fully parsed into memory, defeating its own DoS protection goal. Four warnings were found covering a logic bug in the chunker, a missing `await`-less error surface, a misaligned test assertion, and a silent failure path. Three info items cover code duplication and a minor test-coverage gap.

---

## Critical Issues

### CR-01: Payload size limit checked after full JSON parse (DoS bypass)

**File:** `packages/core/src/rag/ingest.ts:52-64`

**Issue:** `c.req.json()` fully deserialises the request body into memory before the `Buffer.byteLength` check at line 61 runs. An attacker can send a multi-megabyte payload that Hono's default body reader will buffer entirely before the guard ever fires. The `MAX_TEXT_BYTES` limit provides zero protection as currently placed.

**Fix:** Check `Content-Length` before parsing, or switch to streaming/size-limited parsing. The simplest correct approach for Hono + Bun is to reject early via the `Content-Length` header and also keep the post-parse check as a defence-in-depth:

```typescript
// Before c.req.json() call, at the top of the handler body (after token auth):
const contentLength = parseInt(c.req.header("content-length") ?? "0", 10);
if (contentLength > MAX_TEXT_BYTES) {
  return c.json({ error: "Payload Too Large — text exceeds 1MB limit" }, 413);
}

// Keep the Buffer.byteLength check below as defence-in-depth.
```

Note: `Content-Length` can be spoofed by clients that don't send it, so both checks are necessary. Alternatively, Hono's `bodyLimit` middleware (`hono/body-limit`) can be applied at the route level to reject oversized requests before any body reading occurs — this is the cleanest solution.

---

## Warnings

### WR-01: Chunker logic bug — overlap text can exceed CHUNK_SIZE before recursion check

**File:** `packages/core/src/rag/chunker.ts:70-81`

**Issue:** At line 70, when building the next `current` after saving a chunk, the code concatenates `overlapText + sep + part`. This candidate is checked against `CHUNK_SIZE` at line 73 only when it already exceeds the limit. However, if `overlapText` alone is close to `CHUNK_SIZE` (e.g., 990 chars) and `part` adds a few more, the resulting `current` can be up to `CHUNK_SIZE + sep.length + part_fragment_size` before the recursion guard fires. In the `sep = "\n\n"` case this is a minor overshoot, but for the `sep = " "` case where parts can still be long, this can produce a chunk passed to recursion that is only marginally oversized, causing an unnecessary extra recursive call that may produce a very small trailing chunk rather than folding it back into the next iteration properly. This is a logic correctness issue, not just a style concern.

**Fix:** After computing the new `current`, check immediately whether it exceeds `CHUNK_SIZE` before the `if (current.length > CHUNK_SIZE && rest.length > 0)` guard — the guard already handles it, but the comment and the condition can be tightened to make the invariant explicit:

```typescript
// After line 70:
const candidate = overlapText ? overlapText + sep + part : part;
current = candidate;
// Existing recursion guard at line 73 already handles the oversized case correctly.
// No logic change needed, but add an assertion/comment that `current` may briefly exceed CHUNK_SIZE here.
```

More importantly: the current code at line 71 assigns `current = overlapText ? overlapText + sep + part : part` **unconditionally**, then checks length. If `rest.length === 0` at line 73 and `current > CHUNK_SIZE`, the code falls through the loop without splitting the oversized `current`. That oversized string is pushed to `chunks` at line 100 unchecked.

**Fix for the real bug (no split when `rest` exhausted mid-loop):**

```typescript
if (current.length > CHUNK_SIZE) {
  if (rest.length > 0) {
    const subChunks = recursiveSplit(current, rest);
    if (subChunks.length > 1) {
      chunks.push(...subChunks.slice(0, -1));
      current = subChunks[subChunks.length - 1]!;
    } else if (subChunks.length === 1) {
      current = subChunks[0]!;
    }
  } else {
    // No more separators — force brute split
    let start = 0;
    while (start < current.length) {
      chunks.push(current.slice(start, start + CHUNK_SIZE));
      start += CHUNK_SIZE - CHUNK_OVERLAP;
    }
    current = "";
  }
}
```

### WR-02: `createEmbeddings()` called on every tool invocation — no memoisation, silent cost

**File:** `packages/core/src/tools/search-knowledge.ts:74`

**Issue:** `createEmbeddings()` is called inside the tool's async handler on every invocation. Each call dynamically imports the provider module and constructs a new embeddings client. For high-traffic deployments this creates unnecessary object churn. More critically, if `API_KEY` is missing, the OpenAI client will be constructed without a key and will fail only at runtime during `embedQuery()`, producing an opaque HTTP 401 from OpenAI rather than a clear startup error. The fail path is silent at construction time.

**Fix:** Construct the embedder once in the factory closure and reuse it across invocations:

```typescript
export async function createSearchKnowledgeTool(sql: Sql) {
  const db = drizzle(sql);
  const embedder = await createEmbeddings(); // constructed once, reused
  return tool(
    async (args: { query: string; collections: string[] }) => {
      // ...
      const queryVector = await embedder.embedQuery(args.query);
      // ...
    },
    // ...
  );
}
```

Note: this changes the factory signature to `async`, which callers (BrainRunner) would need to `await`. Verify compatibility with how `createSearchKnowledgeTool` is called in `buildGraph()`.

### WR-03: Test assertion checks `invocationCallOrder` — not a standard Bun mock API property

**File:** `packages/core/src/rag/__tests__/ingest.test.ts:247`

**Issue:** Line 247 accesses `mockDb.delete.mock.invocationCallOrder[0]` and line 248 accesses `mockDb.insert.mock.invocationCallOrder[0]`. The `invocationCallOrder` property is a Jest/Vitest-specific API. Bun's `mock` object exposes `calls`, `results`, and `instances`, but does NOT document `invocationCallOrder`. This test will silently pass even if DELETE is called after INSERT (both values would be `undefined`, and `undefined < undefined` evaluates to `false` but the test may still pass due to falsy comparison behaviour). The ordering guarantee the test aims to verify is not actually being verified.

**Fix:** Use call count order by tracking the sequence explicitly:

```typescript
it("DELETE é chamado antes do INSERT (re-ingestão)", async () => {
  const callLog: string[] = [];
  mockDb.delete.mockImplementation(() => {
    callLog.push("delete");
    return { where: mockDeleteWhere };
  });
  mockDb.insert.mockImplementation(() => {
    callLog.push("insert");
    return { values: mockInsertValues };
  });

  const app = createIngestApp({} as never);
  await app.fetch(makeRequest(
    { text: "Texto para re-ingestão.", collection: "faq" },
    { Authorization: "Bearer secret-ingest-token" }
  ));

  expect(callLog[0]).toBe("delete");
  expect(callLog[1]).toBe("insert");
});
```

### WR-04: `resolveEmbeddingModel()` duplicated across `search.ts` and `search-knowledge.ts`

**File:** `packages/core/src/tools/search-knowledge.ts:27-36` and `packages/core/src/rag/search.ts:23-32`

**Issue:** The function `resolveEmbeddingModel()` is copy-pasted verbatim in both files. The comment in `search-knowledge.ts` (line 24) acknowledges the duplication and explains it as a workaround for test mocking: the test mocks `../../rag/search.js` completely, so importing `resolveEmbeddingModel` from `search.ts` would make it unavailable when the mock is active. This is a valid test isolation concern, but the duplication creates a maintenance hazard — any future change (e.g., adding a new provider) must be applied in two places.

This is borderline warning/info. It is rated Warning because the drift risk is concrete: if a new provider is added to `DEFAULT_MODELS` in `factory.ts` but only one copy of `resolveEmbeddingModel` is updated, searches for that provider's chunks will silently fall back to `text-embedding-3-small`, returning zero results.

**Fix:** Extract `resolveEmbeddingModel` into a dedicated module (e.g., `packages/core/src/rag/resolve-model.ts`) that `search.ts` re-exports and that the test does not need to mock. Update the test mock of `../../rag/search.js` to still pass through `resolveEmbeddingModel` from the real module, or mock it separately.

---

## Info

### IN-01: Magic number `0.5` threshold and `5` top-K hardcoded without named constants

**File:** `packages/core/src/rag/search.ts:59`

**Issue:** The default values `topK = 5` and `threshold = 0.5` are meaningful business parameters documented in comments (D-07, D-08) but are not extracted as named constants. They are referenced in comments across multiple files (`search.ts`, `search-knowledge.ts`, test files). If the defaults change, only the function signature is updated — the comments and tests remain stale.

**Fix:**

```typescript
// At the top of search.ts
const DEFAULT_TOP_K = 5;      // D-07
const DEFAULT_THRESHOLD = 0.5; // D-08

export async function searchKnowledge(
  db: PostgresJsDatabase,
  queryVector: number[],
  collections: string[],
  embeddingModel: string,
  topK = DEFAULT_TOP_K,
  threshold = DEFAULT_THRESHOLD
): Promise<ChunkResult[]> {
```

### IN-02: `createEmbeddings` — `dimensions` not passed to Gemini embeddings

**File:** `packages/ai/src/embeddings/factory.ts:43`

**Issue:** For the `gemini` provider, `new GoogleGenerativeAIEmbeddings({ model, apiKey })` does not pass the `dimensions` parameter (derived from `EMBEDDING_DIMENSIONS`). For OpenAI this is passed at line 48. If an operator sets `EMBEDDING_DIMENSIONS` to a non-default value and uses Gemini, the factory silently ignores the configured dimension, risking a vector dimension mismatch against the `knowledge_chunks.embedding` column defined with `EMBEDDING_DIM` from the same ENV.

**Fix:**

```typescript
case "gemini": {
  const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
  // Pass dimensions if set — matches the column dimension configured via EMBEDDING_DIMENSIONS
  return new GoogleGenerativeAIEmbeddings({ model, apiKey, ...(dimensions ? { dimensions } : {}) });
}
```

Note: verify that `GoogleGenerativeAIEmbeddings` accepts a `dimensions` config field in the installed version of `@langchain/google-genai` before applying.

### IN-03: `chunker.test.ts` overlap test is weak — "any word in common" is trivially true for repeated text

**File:** `packages/core/src/rag/__tests__/chunker.test.ts:62-73`

**Issue:** The overlap test at lines 62-73 uses `longText = "palavra ".repeat(200)` — every chunk consists of the same word repeated, so the overlap check `firstWords.some((w) => secondContent.includes(w))` will always pass even if overlap is zero, because the word `"palavra"` appears everywhere. This test provides no real signal about whether the chunker is actually producing overlapping content.

**Fix:** Use a test text where each "segment" is unique (e.g., sequential numbered tokens), then assert that the last N characters of chunk 0 appear at the start of chunk 1:

```typescript
// Generate text with unique numbered tokens: "word0001 word0002 ..."
const longText = Array.from({ length: 300 }, (_, i) =>
  `word${String(i).padStart(4, "0")}`
).join(" ");

it("há sobreposição de conteúdo entre chunks consecutivos (overlap ~200 chars)", async () => {
  const result = await splitText(longText);
  if (result.length >= 2) {
    const endOfFirst = result[0].slice(-200);
    // At least one token from the end of chunk 0 must appear at the start of chunk 1
    expect(result[1].startsWith(endOfFirst.trimStart().split(" ")[0]!)).toBe(true);
  }
});
```

---

_Reviewed: 2026-06-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
