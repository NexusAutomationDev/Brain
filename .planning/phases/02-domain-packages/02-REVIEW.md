---
phase: 02-domain-packages
reviewed: 2026-06-11T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - packages/ai/src/embeddings/factory.ts
  - packages/ai/src/embeddings/factory.test.ts
  - packages/ai/src/graph/checkpointer.ts
  - packages/ai/src/graph/state.ts
  - packages/ai/src/llm/factory.ts
  - packages/ai/src/llm/factory.test.ts
  - packages/ai/src/index.ts
  - packages/memory/src/long-term.ts
  - packages/memory/src/long-term.test.ts
  - packages/memory/src/semantic.ts
  - packages/memory/src/semantic.test.ts
  - packages/memory/src/short-term.ts
  - packages/memory/src/manager.ts
  - packages/memory/src/manager.test.ts
  - packages/memory/src/index.ts
  - packages/transport/src/interface.ts
  - packages/transport/src/webhook/events.ts
  - packages/transport/src/webhook/dedup.ts
  - packages/transport/src/webhook/handler.ts
  - packages/transport/src/factory.ts
  - packages/transport/src/index.ts
  - packages/transport/src/factory.test.ts
  - packages/transport/src/webhook/dedup.test.ts
  - packages/transport/src/webhook/handler.test.ts
  - packages/observability/src/tracing.ts
  - packages/observability/src/tracing.test.ts
  - packages/observability/src/index.ts
  - scripts/setup-test-db.sh
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

All four domain packages (`ai`, `memory`, `transport`, `observability`) and the setup script were reviewed. The overall architecture is sound: factory pattern, env-based configuration, Zod validation on inputs, proper per-user data isolation, and documented fire-and-forget semantics in the semantic memory layer.

One critical shell injection vulnerability was found in the test-db setup script. Three warnings cover an unawaited async call in the transport lifecycle, an unsafe type cast in the memory layer, and a Drizzle ORM expression-vs-column misuse that may silently produce wrong query plans. Four informational items cover minor type precision, incomplete scaffolding, a test teardown gap, and a stack-documentation discrepancy.

---

## Critical Issues

### CR-01: Shell credential injection in `setup-test-db.sh` `bun -e` inline script

**File:** `scripts/setup-test-db.sh:22-29` and `:36-43`

**Issue:** When `createdb` / `psql` are not installed, the script falls back to inline `bun -e "..."` code. Inside the double-quoted shell string the variables `${PGUSER}`, `${PGPASSWORD}`, `${PGHOST}`, and `${PGPORT}` are expanded by bash _before_ being handed to `bun`. A `PGPASSWORD` value containing a single quote, semicolons, or backtick characters (e.g. `pass'word`) would break out of the template literal in the JavaScript and execute arbitrary code in the `bun` process context. Because `PGPASSWORD` can be set by a CI secret or `.env` file with no restriction on its characters, this is an injection path.

**Fix:** Either restrict the fallback to always use `psql`/`createdb` (which handle credentials safely via environment), or pass the connection details as a separate environment variable rather than interpolating them into source code:

```bash
# Instead of interpolating into bun -e source, pass as env vars:
TEST_DB_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/postgres" \
bun -e "
const {default: pg} = await import('postgres');
const sql = pg(process.env.TEST_DB_URL);
// ...
await sql.end();
"
```

This keeps the credentials out of the JavaScript source string entirely and removes the injection surface.

---

## Warnings

### WR-01: Unawaited `server.stop()` in `WebhookTransport.stop()`

**File:** `packages/transport/src/webhook/handler.ts:66-70`

**Issue:** `Bun.serve().stop()` returns a `Promise<void>` that resolves when all active connections are drained. The current implementation calls `this.server.stop()` without `await`, so `stop()` returns before the server has actually halted. Any caller that `await`s `transport.stop()` will proceed while the port may still be bound and requests may still be in flight. This can cause port-already-in-use errors in tests that restart the server, and violates the `ITransport` contract which callers reasonably expect to be fully complete on `await`.

**Fix:**
```typescript
async stop(): Promise<void> {
  if (this.server) {
    await this.server.stop(); // await the drain promise
    this.server = undefined;
  }
}
```

### WR-02: Unsafe `unknown` cast to `Record<string, unknown>` in `writeProfile`

**File:** `packages/memory/src/long-term.ts:56` and `:62`

**Issue:** `value` is typed as `unknown` at the function boundary (correct), but is immediately cast to `Record<string, unknown>` before passing to Drizzle. TypeScript accepts this without complaint, but at runtime a caller passing a primitive value (`writeProfile(db, uid, "count", 42)`) or an array will send the wrong type to the database column. The cast suppresses the type error instead of enforcing it.

**Fix:** Either restrict the parameter type to `Record<string, unknown>` (simplest, and consistent with how the `memories.value` column is likely typed in the schema), or add a runtime guard:
```typescript
export async function writeProfile(
  db: PostgresJsDatabase,
  userId: string,
  key: string,
  value: Record<string, unknown> // tighten the signature
): Promise<void> {
```

### WR-03: Drizzle `gt(similarity, threshold)` with SQL expression may not behave as expected

**File:** `packages/memory/src/semantic.ts:78-80`

**Issue:** `similarity` is defined as `sql<number>\`1 - (${cosineDistance(...)})\`` — a raw SQL expression alias, not a column reference. Passing it to `gt()` (which wraps the operand in a parameterized binding) may produce SQL that places the entire expression as a prepared-statement parameter rather than inline SQL, which can cause a query error or silently bypass the HNSW index. The safe pattern with Drizzle for filtering on a computed expression is to use a `sql` tagged template directly in the `where` clause:

```typescript
.where(
  and(
    eq(embeddings.userId, userId),
    sql`1 - (${cosineDistance(embeddings.embedding, queryVector)}) > ${threshold}`
  )
)
```

This guarantees the expression is rendered correctly and the index can be used.

---

## Info

### IN-01: `MemoryContext.profile` typed as `unknown | null` — `null` is redundant

**File:** `packages/memory/src/manager.ts:15`

**Issue:** `unknown | null` simplifies to `unknown` because `unknown` already includes all values including `null`. The union is harmless but adds noise and suggests the intent was `Record<string, unknown> | null` (a nullable structured object), which is what `readProfile` actually returns.

**Fix:**
```typescript
profile: Record<string, unknown> | null;
```

### IN-02: `_event` is validated but never used in webhook handler

**File:** `packages/transport/src/webhook/handler.ts:42`

**Issue:** The `_event: BrainEvent` variable is declared to satisfy the type system but immediately discarded. This is scaffolding for Phase 3 (BrainRunner wiring). The `_` prefix correctly signals intent, but the TODO context is not captured in a comment.

**Fix:** Add a comment making the Phase 3 dependency explicit so future readers don't mistake it for dead code:
```typescript
const _event: BrainEvent = parsed.data;
// TODO(Phase-3): dispatch _event to BrainRunner once wired
```

### IN-03: `Date.now` monkey-patch in `dedup.test.ts` lacks teardown guard

**File:** `packages/transport/src/webhook/dedup.test.ts:26-40`

**Issue:** `Date.now` is replaced with a custom function and restored in a manual `Date.now = originalNow` line at the end of the test body. If the `expect(result).toBe(true)` assertion on line 37 fails, execution jumps out of the `it` block before the restore line runs. All subsequent tests in the suite will run with a frozen `Date.now`, producing false failures or false passes.

**Fix:** Use a `try/finally` to guarantee restoration:
```typescript
it("expired entry after TTL is treated as new (returns true again)", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => baseTime;
    cache.claim("req-005");
    Date.now = () => baseTime + 10 * 60 * 1000 + 1;
    const result = cache.claim("req-005");
    expect(result).toBe(true);
  } finally {
    Date.now = originalNow;
  }
});
```

### IN-04: Observability package uses Langfuse but stack documentation specifies LangSmith

**File:** `packages/observability/src/tracing.ts:1`

**Issue:** The implementation imports from `@langfuse/langchain` (Langfuse). The project's `CLAUDE.md` technology stack table lists LangSmith as the observability tool with the rationale "first-class LangGraph integration; automatic trace nesting; no instrumentation code needed in nodes." This discrepancy should either be resolved by switching to LangSmith, or by updating `CLAUDE.md` to reflect that Langfuse was chosen instead and documenting the rationale.

**Fix:** Document the decision in `CLAUDE.md` under the Alternatives Considered section, or migrate to `@langchain/langsmith` / `langsmith` as the stack prescribes. Either outcome is valid — the gap is the undocumented deviation.

---

_Reviewed: 2026-06-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
