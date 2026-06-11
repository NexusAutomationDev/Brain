# Domain Pitfalls

**Domain:** TypeScript AI Agent Platform (LangGraph + PostgreSQL/PGVector + Bun + Drizzle ORM, multi-tenant)
**Researched:** 2026-06-11
**Overall confidence:** HIGH — all pitfalls verified against official docs, GitHub issues, or multiple production reports

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or production outages.

---

### Pitfall 1: LangGraph State Serialization Failures

**What goes wrong:** Graph state containing non-JSON-serializable TypeScript/JavaScript types (`Set`, `Buffer`, `Date`, `Uint8Array`, custom class instances) throws at runtime during checkpointing, LangSmith tracing, or remote execution. The error is opaque — `TypeError: Object of type set is not JSON serializable` — and only surfaces when the checkpointer actually tries to persist.

**Why it happens:** LangGraph checkpoints serialize the entire state object to JSON for persistence, tracing, and resumability. JavaScript `Set` is the most common culprit — developers use it for deduplication (visited URLs, processed IDs) without realizing it's not JSON-serializable.

**Consequences:** Entire workflow crashes mid-execution. In production with a PostgresSaver, the thread is left in a broken state with no clean recovery path.

**Prevention:**
- Define state schemas with only JSON-safe primitives: use `string[]` instead of `Set<string>`, `Record<string, unknown>` instead of `Map`, ISO strings instead of `Date` objects
- Add a CI test that constructs every state type and calls `JSON.stringify()` — fail the build if it throws
- For types that must use Set/Map internally (e.g., for performance), convert to array/object at the reducer boundary before returning from the node

**Detection:** The error fires on first checkpoint write. Run a smoke test that executes one full graph cycle with all state fields populated — this will catch it before users do.

**Phase:** Address in Phase 1 (core infrastructure) when defining state schemas. Never retrofit.

---

### Pitfall 2: MemorySaver in Any Non-Local Environment

**What goes wrong:** `MemorySaver` stores all checkpoint state in process memory. Container restarts, deployments, load balancer failovers, and crashes wipe all in-flight conversations. Users lose context silently — the agent appears to "forget" everything.

**Why it happens:** MemorySaver is the default in LangGraph examples. It works perfectly in notebooks and local demos, creating a false sense that checkpointing is "done."

**Consequences:** Complete conversation state loss on any deployment event. In a multi-instance (horizontal scale) deployment, two requests for the same thread can hit different instances and get different state.

**Prevention:** Use `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`) from the beginning. Never use `MemorySaver` outside of unit tests. The connection pattern: PostgresSaver holds a connection for the entire run duration — use a dedicated connection pool for checkpointing, separate from the application query pool.

**Detection:** Deploy to staging, restart the container mid-conversation, and verify the agent resumes correctly.

**Phase:** Phase 1. `PostgresSaver` must be the only checkpointer used in any environment that is not a unit test.

---

### Pitfall 3: LangGraph Checkpoint Table Unbounded Growth

**What goes wrong:** Every node execution creates approximately 100 rows across LangGraph's 3 checkpoint tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`). Without TTL or pruning, a moderately active deployment creates millions of rows within weeks.

**Why it happens:** LangGraph stores every intermediate state for time-travel debugging and human-in-the-loop resumption. There is no automatic expiry — as of LangGraph JS 1.x, there is no built-in TTL configuration.

**Consequences:** Database storage bloat, degraded query performance on the checkpoint tables, and full table scans during thread lookups.

**Prevention:**
- Schedule a PostgreSQL cron job (or pg_cron extension) to delete checkpoint rows older than N days: `DELETE FROM checkpoints WHERE created_at < NOW() - INTERVAL '30 days'`
- Keep `thread_id` scoped to conversation sessions, not global IDs, so old threads can be pruned by age
- Monitor table sizes with `pg_relation_size()` from day one

**Detection:** Watch `checkpoints` table row count. If it exceeds 1M rows in the first month, pruning is not running.

**Phase:** Phase 1 (schema design) for table structure; Phase 2 (observability) for monitoring; Phase 3 for scheduled pruning implementation.

---

### Pitfall 4: LangGraph Schema Evolution Breaking Existing Threads

**What goes wrong:** Renaming a state field, adding a required field without a default value, or changing a field's type in a LangGraph state definition corrupts or breaks any thread that was checkpointed under the old schema. LangGraph does not validate schema compatibility on load — it silently deserializes the old shape into the new schema, producing `undefined` values where the renamed field used to be.

**Why it happens:** The checkpoint blob is stored as raw JSON. On resume, LangGraph deserializes the JSON into the current TypedDict/annotation shape with no migration layer.

**Consequences:** Production agents silently operate on partial/corrupted state after deployments. Bugs only appear mid-conversation, not at startup.

**Prevention:**
- Add a `schema_version: number` field to every state definition from the start
- Treat state schema changes as database migrations: write an explicit migration function that transforms old checkpoint data before the new code goes live
- Always add new fields with a default value (never required without default)
- Never rename fields — add the new name and deprecate the old with a reducer that reads both

**Detection:** After any state schema change, query the checkpoint table for threads that have the old shape and verify they resume without errors.

**Phase:** Phase 1 (state design). The migration pattern must be established before any real users create threads.

---

### Pitfall 5: PGVector Embedding Dimension Lock-in and Mismatch

**What goes wrong:** The embedding dimension is baked into the column definition (`vector(1536)`). Switching embedding providers (e.g., from OpenAI `text-embedding-3-small` at 1536 dims to a 384-dim local model, or to Gemini at 768 dims) requires dropping and recreating the column and re-embedding all stored data. Silent failures also occur: if the configured provider changes via environment variable but the table still expects the old dimension, writes fail with a hard PostgreSQL error — and in some ORM configurations, this error is swallowed.

**Why it happens:** pgvector enforces dimension count strictly at write time. There is no implicit truncation or padding. Changing providers mid-deployment without a schema migration causes write failures.

**Consequences:** Complete memory system failure after an embedding provider change. Re-embedding large knowledge bases is expensive and time-consuming.

**Prevention:**
- Decide on a single embedding provider and dimension before writing any schema migrations — this is a one-way door
- Use `text-embedding-3-small` (1536 dims) or a 384-dim model (3x faster) — document the chosen dimension in the schema file as a constant
- Add a startup assertion: query the column dimension from `pg_attribute` and compare against `EMBEDDING_DIM` env var — crash loudly if they differ
- Never use the unconstrained `vector` type for the main embeddings column (loses index performance)

**Detection:** Write a startup health check that inserts and retrieves a test embedding and verifies the dimension round-trips correctly.

**Phase:** Phase 1 (schema design). The dimension choice is irreversible without a full data migration.

---

### Pitfall 6: IVFFlat Index Created Before Data is Loaded

**What goes wrong:** Creating an IVFFlat index on an empty (or near-empty) table computes k-means centroids against meaningless data. Queries then search against a broken index and return incorrect results — wrong neighbors, degraded recall — with no error messages.

**Why it happens:** IVFFlat is sometimes included in initial schema migration scripts because it looks like a standard index. Developers don't realize the index must be built after the data is populated.

**Consequences:** Semantic search returns nonsensical results silently. This is one of the hardest production bugs to detect because the queries succeed — they just return wrong data.

**Prevention:**
- Use HNSW as the default index type for new deployments — it does not require data to exist at creation time and has higher recall for typical RAG workloads
- If IVFFlat is used for a large static dataset, add it as a post-data-load script, never a schema migration
- Set reasonable defaults: `m = 16, ef_construction = 200` for HNSW (increase only if recall benchmarks show deficiency)
- Set `probes` at query time: the default `1` gives terrible recall — use `SET ivfflat.probes = 10` minimum

**Detection:** Benchmark recall after index creation using known query/result pairs. If recall is below 90%, the index may have been created on empty data.

**Phase:** Phase 1 (schema design). The index type decision should be made explicitly, not by default.

---

### Pitfall 7: Per-Tenant Connection Pool Explosion

**What goes wrong:** Brain Core uses a 1-database-per-tenant model. A naive implementation creates a new Drizzle/`pg` connection pool for each incoming request, or maintains a pool per tenant with no cap on total pools. At 50 concurrent tenants, this opens 50 × pool_size connections to PostgreSQL, which has a hard limit (typically 100 default, configurable to several hundred).

**Why it happens:** The pattern "get tenant DB name from request → create DB connection → run query" is straightforward and works in development with one tenant. In production with many tenants, the resource math breaks immediately.

**Consequences:** PostgreSQL connection exhaustion (`FATAL: remaining connection slots are reserved for non-replication superuser connections`), cascading query failures across all tenants.

**Prevention:**
- Use a connection cache: maintain a `Map<tenantId, Pool>` keyed by tenant, with a maximum cap (e.g., 20 pools) and LRU eviction for idle tenants
- Size each per-tenant pool small (2-5 connections) rather than using defaults
- Add a global connection count metric — alert if total connections exceed 70% of `max_connections`
- Consider PgBouncer in transaction-pooling mode in front of PostgreSQL for deployments with >20 tenants

**Detection:** Load test with 10+ simulated tenants making simultaneous requests and watch `pg_stat_activity` connection counts.

**Phase:** Phase 1 (multi-tenancy foundation). The connection architecture must be designed before the first request handler is written.

---

### Pitfall 8: Drizzle Client Recreation Per Request (Multi-Tenant)

**What goes wrong:** A common multi-tenant pattern is to call `drizzle(new Pool({ database: tenantDbName }))` inside the request handler. Each call creates a new pool object, which does not get reused, and the previous pool is never cleanly closed. This leaks connections and adds ~10-50ms overhead per request for pool initialization.

**Why it happens:** Drizzle's `drizzle()` constructor accepts a fresh pool instance, making per-request client creation syntactically easy. There's no warning when you do this — it works, it's just expensive.

**Consequences:** Connection leak, memory growth, and latency degradation over time.

**Prevention:**
- Cache Drizzle instances in a `Map<tenantId, DrizzleDB>` at the module level, created once and reused
- Use a lazy initialization pattern: create the pool on first request for that tenant, cache it, reuse on subsequent requests
- Add a `closeAll()` function for graceful shutdown that drains all cached pools

**Detection:** Log pool creation events. If the same tenant triggers pool creation more than once per process lifetime, the cache is not working.

**Phase:** Phase 1 (database layer). Establish the pattern in `packages/database` before any Brain uses it.

---

## Moderate Pitfalls

---

### Pitfall 9: LangGraph Recursion Limit Too Low for Complex Agents

**What goes wrong:** LangGraph's default `recursionLimit` is 25 (counting each node visit as one step). A Brain with a qualification sub-agent (the SDR pattern: main agent → qualifies lead → returns to main) can exhaust 25 steps in a single conversation turn with tool calls.

**Prevention:**
- Set `recursionLimit` explicitly in `graph.compile()` config: 50 for simple agents, 100 for agents with subgraphs
- The default 25 was chosen to catch infinite loops, not as a reasonable workflow limit — treat it as a minimum floor, not a production setting
- Implement explicit termination conditions in subgraphs rather than relying on the limit as a circuit breaker

**Phase:** Phase 2 (agent orchestration). Test with realistic multi-turn conversations before declaring an agent "done."

---

### Pitfall 10: LangGraph Parallel Node State Reducer Conflicts

**What goes wrong:** When two nodes execute in parallel and both write to the same state key without a reducer, LangGraph throws `InvalidUpdateError`. This is not caught at graph compile time — it only fires at runtime when the parallel branch actually executes.

**Prevention:**
- Define explicit reducers for every state key that could be written by parallel nodes: `Annotated<T, (a: T, b: T) => T>`
- For lists that accumulate results (e.g., tool outputs), use `(existing, update) => [...existing, ...update]`
- Add a capped reducer for lists to prevent unbounded growth: `(existing, update) => [...existing, ...update].slice(-N)`

**Phase:** Phase 2 (agent graph design). Any graph with a fan-out pattern must define reducers before the first run.

---

### Pitfall 11: Bun `node:async_hooks` Gaps Break APM and Some LangChain Internals

**What goes wrong:** Bun's `node:async_hooks` implementation is missing V8 promise hooks. Libraries that depend on `AsyncLocalStorage` for context propagation (LangChain's callback handlers, some APM agents like `dd-trace`, OpenTelemetry SDK) may fail silently or produce broken traces.

**Prevention:**
- Test LangChain's callback propagation (LangSmith tracing) explicitly with Bun before relying on it in production
- Avoid `dd-trace` with Bun — use OpenTelemetry with the `@opentelemetry/sdk-node` package, which has better Bun compatibility
- If a library requires native modules (`node-gyp`), find a pure-JS alternative (`bcryptjs` instead of `bcrypt`)

**Detection:** Run the LangSmith tracing integration test on Bun. If traces appear incomplete or missing, `async_hooks` is the culprit.

**Phase:** Phase 1 (observability setup). Validate the tracing stack on Bun before integrating it into the core.

---

### Pitfall 12: Bun Monorepo Workspace Install Performance Regression

**What goes wrong:** Bun workspaces can be 70x slower than pnpm for dependency resolution in monorepos where packages are already installed (the "no-op install" case). Reported as a Bun regression in January 2026. This makes CI pipelines and local development unnecessarily slow.

**Prevention:**
- Use `pnpm` as the workspace/package manager for the monorepo, even though `bun` is the runtime
- In Docker builds and CI, use `pnpm install --frozen-lockfile` for package installation
- Use `bun run` (or explicit `bun <script>`) only for script execution and the runtime — not for package management

**Detection:** Time `bun install` on a warm cache vs. `pnpm install`. If Bun is significantly slower, switch package management to pnpm.

**Phase:** Phase 1 (monorepo scaffolding). The package manager decision is hardest to change later.

---

### Pitfall 13: TypeScript Path Aliases Not Resolved at Runtime by Bun

**What goes wrong:** TypeScript `paths` in `tsconfig.json` (e.g., `@brain/core` → `../../packages/core/src`) are a TypeScript compiler feature — they are not understood by Node.js or Bun at runtime. Running `bun src/index.ts` directly will fail with `Module not found: @brain/core` even if tsc compiles successfully.

**Why it happens:** Developers configure paths for IDE autocompletion and tsc type checking. They assume the runtime handles them the same way. It does not — path aliases require either a bundler (esbuild, tsup) or Bun's `bunfig.toml` alias configuration to work at runtime.

**Prevention:**
- For Bun runtime: define aliases in `bunfig.toml` under `[alias]` section to mirror the tsconfig paths
- Alternatively, use Node.js subpath imports (`imports` field in `package.json`) which are natively supported by both tsc and Bun
- Never rely on tsc compilation for runtime alias resolution — use a bundler or runtime-native alias mechanism

**Detection:** After adding a new path alias to tsconfig, run `bun src/index.ts` directly (not through a bundler) and verify it resolves. If not, the alias is only a type-level alias.

**Phase:** Phase 1 (monorepo TypeScript config). Establish the alias resolution pattern before it proliferates across packages.

---

### Pitfall 14: LangGraph/LangChain Peer Dependency Version Drift

**What goes wrong:** `@langchain/core`, `@langchain/langgraph`, and `langchain` share peer dependencies but are versioned independently. Installing `@langchain/langgraph@1.3.x` with an incompatible `@langchain/core@0.x` causes silent type errors, runtime failures in message serialization, and "duck-typed" incompatibilities that are extremely hard to trace.

**Why it happens:** LangChain's npm packages version independently. Package managers can resolve incompatible combinations when version constraints are loose.

**Prevention:**
- Pin exact versions for all `@langchain/*` packages in `package.json` — do not use caret (`^`) ranges
- Use pnpm's `peerDependencyRules` to enforce consistent peer resolution
- Create a single source of truth: define all `@langchain/*` versions in the root `package.json` and use `workspace:*` in packages that consume them
- Update all `@langchain/*` packages together in a single commit, never independently

**Detection:** Run `pnpm why @langchain/core` and verify only one version appears in the resolution tree.

**Phase:** Phase 1 (monorepo package setup). Lock versions before writing any LangGraph code.

---

### Pitfall 15: Tool Call Infinite Loop Under Rate Limiting

**What goes wrong:** LLM API rate limits cause tool calls to fail with transient errors. Naive retry logic retries the same tool call indefinitely, which — combined with LangGraph's loop structure — creates a feedback loop that burns through the recursion limit, generates enormous token usage, and may trigger secondary rate limits.

**Why it happens:** Retry logic and agent loops are implemented independently. The retry handler doesn't know it's inside an agent loop that is also retrying. The result is exponential blast — M retries × N agent iterations.

**Prevention:**
- Implement tool-level retry with exponential backoff and a hard cap (max 3 retries per tool call)
- Return a structured error result from the tool instead of throwing — let the LLM decide how to handle it rather than having the infrastructure retry blindly
- Set `maxExecutionTime` on the graph invoke call as a hard wall-clock timeout
- Track tool call counts in state — if any single tool has been called more than 5 times in one graph run, trigger a graceful abort

**Detection:** Inject a failing tool in staging and observe agent behavior — it should fail gracefully within seconds, not spin for minutes.

**Phase:** Phase 2 (tools registry). Tool error handling patterns must be established when the first real tool is implemented.

---

### Pitfall 16: Memory Layer Mixing — Embedding All Messages Into Vector Store

**What goes wrong:** Storing every conversation message in the vector store (PGVector) as an embedding is the most common memory architecture mistake. It creates retrieval noise (small talk, filler phrases, acknowledgements returning as "relevant" context), inflates storage, and makes semantic search progressively less useful as volume grows.

**Why it happens:** "Semantic memory" sounds like it should contain everything. The distinction between working memory (current context window), episodic memory (conversation history), and semantic memory (distilled knowledge) is not obvious.

**Prevention:**
- Only embed semantically rich content: user-stated facts, preferences, goals, documents, and knowledge base entries
- Keep conversation history as structured records in PostgreSQL (not PGVector) — retrieve it with time-based queries, not similarity search
- Run a summarization/extraction step that distills conversation turns into facts before embedding them
- Separate tables: `memories` (structured facts) vs. `embeddings` (vector index) vs. `agent_state` (LangGraph checkpoints)

**Detection:** After 100 conversation turns, query PGVector for "hello" — if it returns conversation turns from 3 weeks ago, your embedding strategy needs filtering.

**Phase:** Phase 2 (memory architecture). The 3-layer memory design (short-term, long-term, semantic) must be implemented as distinct components with explicit boundaries.

---

## Minor Pitfalls

---

### Pitfall 17: PGVector HNSW Index Memory Usage Surprise

**What goes wrong:** HNSW indexes consume 2-5x more memory than IVFFlat because the graph stores neighbor connections at every layer. At `m = 64, ef_construction = 500` (common "high quality" settings found in blog posts), memory usage can exceed available RAM on modest servers, causing the index to be paged to disk and destroying query performance.

**Prevention:** Start with `m = 16, ef_construction = 200`. These are the conservative defaults that work well up to millions of vectors. Increase only if recall benchmarks show deficiency. Index building happens in memory — ensure the Postgres server has at least `(vectors × dimensions × 4 bytes × 2)` free RAM before building.

**Phase:** Phase 1 (schema) and Phase 3 (performance tuning).

---

### Pitfall 18: LangGraph `interrupt_before` vs `interrupt_after` Confusion

**What goes wrong:** Human-in-the-loop flows use `interrupt_before` or `interrupt_after` to pause execution. Using `interrupt_after` means the node's action has already executed before the pause — the user is reviewing a fait accompli, not approving a pending action. This is the most frequently reported human-in-the-loop mistake.

**Prevention:** For approval flows, always use `interrupt_before`. Reserve `interrupt_after` for "review what happened" use cases, not "approve before proceeding."

**Phase:** Phase 3 (human-in-the-loop features, if applicable).

---

### Pitfall 19: Missing Subgraph Checkpointer Inheritance

**What goes wrong:** In Brain Core's SDR pattern (main Brain → qualification sub-agent), the parent graph's checkpointer is not automatically inherited by compiled subgraphs. If the subgraph is compiled independently (`subgraph.compile()` with no checkpointer), its internal state is not persisted and cannot be inspected or resumed.

**Prevention:** Pass the parent's checkpointer to the subgraph via `subgraph.compile({ checkpointer: parentCheckpointer })`, or use the subgraph as an uncompiled node (adding it directly as a node rather than calling `.compile()` on it separately).

**Phase:** Phase 2 (agent orchestration, when the qualification sub-agent is built).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: State schema design | Serialization failures, schema lock-in, dimension lock-in | Use JSON-safe types, add `schema_version`, fix embedding provider early |
| Phase 1: Database layer | Connection pool explosion, Drizzle client leaks | Implement tenant pool cache with LRU cap before first request handler |
| Phase 1: Monorepo TS config | Path aliases broken at runtime | Use Bun alias config or subpath imports, not just tsconfig paths |
| Phase 1: LangChain packages | Version drift across @langchain/* packages | Pin exact versions, lock all @langchain/* together |
| Phase 1: Checkpointing | MemorySaver in non-local env | Enforce PostgresSaver in all non-test environments from day one |
| Phase 2: Agent graph | Recursion limit too low, parallel reducer conflicts | Set explicit recursionLimit, define reducers for all shared keys |
| Phase 2: Tool registry | Infinite loop under rate limiting | Implement tool retry caps and structured error returns |
| Phase 2: Memory architecture | Embedding all messages | Separate embedding strategy: only embed distilled facts, not raw messages |
| Phase 3: Performance | HNSW memory surprise | Use conservative m=16 defaults, benchmark before increasing |
| Phase 3: Checkpoint growth | Unbounded checkpoint table | Implement pruning job, monitor table sizes |

---

## Sources

- LangGraph serialization: [Fix LangGraph JSON Serialization Error](https://markaicode.com/errors/langgraph-json-parse-error-fix/)
- LangGraph state management undocumented issues: [LangGraph State Management Guide](https://altersquare.io/langgraph-state-management-undocumented-issues-after-commit/)
- LangGraph checkpointing best practices: [Mastering LangGraph Checkpointing 2025](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025/)
- LangGraph checkpoint growth: [How to keep checkpoint data from growing unbounded](https://github.com/langchain-ai/langgraphjs/issues/1138)
- LangGraph PostgresSaver: [@langchain/langgraph-checkpoint-postgres npm](https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres)
- LangGraph recursion limit: [GRAPH_RECURSION_LIMIT docs](https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT)
- LangGraph infinite loop bug: [Agent infinite looping issue #6731](https://github.com/langchain-ai/langgraph/issues/6731)
- LangGraph subgraph state: [Subgraph state communication forum](https://forum.langchain.com/t/how-does-state-work-in-langgraph-subgraphs/1755)
- Multi-agent pitfalls: [Architecting Multi-Agent Systems with LangGraph](https://medium.com/@timarkanta.sharma/architecting-multi-agent-systems-with-langgraph-patterns-trade-offs-and-real-world-design-ba8c535c6b35)
- LangChain versioning: [LangChain and LangGraph 1.0 milestone](https://blog.langchain.com/langchain-langgraph-1dot0/)
- LangGraph prebuilt breaking change: [Issue #6363 version constraints](https://github.com/langchain-ai/langgraph/issues/6363)
- PGVector HNSW vs IVFFlat: [IVFFlat vs HNSW in pgvector](https://dev.to/philip_mcclarence_2ef9475/ivfflat-vs-hnsw-in-pgvector-which-index-should-you-use-305p)
- PGVector performance: [pgvector performance benchmark](https://www.instaclustr.com/education/vector-database/pgvector-performance-benchmark-results-and-5-ways-to-boost-performance/)
- PGVector dimension mismatch: [pgvector Dimension Mismatch 2026](https://dbadataverse.com/tech/postgresql/2026/05/pgvector-gotchas-dimension-mismatch-casting-errors-and-alter-table-solved-2026)
- AI agent memory architecture: [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- Tool call reliability: [LLM Tool-Calling in Production](https://medium.com/@komalbaparmar007/llm-tool-calling-in-production-rate-limits-retries-and-the-infinite-loop-failure-mode-you-must-2a1e2a1e84c8)
- Multi-tenant connection pooling: [How to Implement Multi-Tenancy in Node.js](https://oneuptime.com/blog/post/2026-01-27-nodejs-multi-tenancy/view)
- Bun Node.js compatibility: [Bun Node.js Compatibility Docs](https://bun.com/docs/runtime/nodejs-compat)
- Bun monorepo issues: [Bun workspace performance issue #25799](https://github.com/oven-sh/bun/issues/25799)
- Bun production evaluation: [Bun in 2025: Critical Evaluation](https://angelo-lima.fr/en/bun-2025-critical-evaluation-javascript-runtime-alternative/)
- TypeScript monorepo path aliases: [TypeScript Path Aliases in Turborepo](https://www.xjavascript.com/blog/how-to-configure-module-aliases-in-a-monorepo-bootstrapped-with-turborepo/)
- Drizzle multi-tenant: [Drizzle ORM multi-tenancy discussion](https://github.com/mateusflorez/drizzle-multitenant)
