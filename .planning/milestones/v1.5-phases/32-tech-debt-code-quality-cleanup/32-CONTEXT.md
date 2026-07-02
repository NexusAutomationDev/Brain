# Phase 32: Code Quality Cleanup — Accumulated Warnings & Test/Doc Hygiene - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Resolve the remaining warning/info-level code-review findings accumulated across Phases 27-30 (`.planning/v1.5-MILESTONE-AUDIT.md` `tech_debt` block), plus the test/doc hygiene gaps (SUMMARY.md frontmatter backfill, `fup-e2e.test.ts` ordering, `mock.module` cross-pollution root cause). This zeroes the v1.5 tech-debt ledger. Phase 31 already closed the "worth a follow-up before onboarding a client" subset (respond-tool guard, CI shell hygiene, `.env.example`, migration comment) — those are NOT in scope here.

**Scope corrections found during codebase scouting (before discussion):**
- **Phase 27 WR-01 ("dead branch always maps 503, never 500")** does not reproduce. `packages/observability/src/health.ts`'s `performHealthCheck()` correctly maps DB failure → 503 and transport-disconnected → 503 per the already-implemented D-16 decision (27-CONTEXT.md). No dead branch exists. **Planner should verify this during research and, if confirmed, document as already-resolved rather than create a fix task.**
- **Phase 27 IN-01 ("`as any` used for RunnableConfig")** does not reproduce. No `as any` pattern for `RunnableConfig` was found anywhere in the codebase (`pause-session.ts` and other config consumers are already properly typed). **Planner should verify and document as already-resolved if confirmed, rather than search for a fix that isn't needed.**

These two items should NOT block Phase 32 completion — they represent audit findings that no longer describe the current codebase, not open defects.

</domain>

<decisions>
## Implementation Decisions

### Runtime lifecycle hardening (Phase 27 items)

- **D-01 (SIGTERM leak, `packages/core/src/runner/runner.ts`):** `init()` must be made idempotent regardless of caller behavior — before registering the new SIGTERM handler, check for and remove any existing stored `_sigtermHandler` via `process.off('SIGTERM', ...)`. Do not add a fail-fast throw or rely on documentation alone.
- **D-02 (RabbitMQ retry map collision, `packages/transport/src/rabbitmq/consumer.ts`):** Fix the key collision by appending channel/message-type to the existing `IDLead:Numero` key (e.g. `IDLead:Numero:channel`) rather than hashing full message content. Keeps keys human-readable/debuggable in logs.
- **D-03 (WebhookTransport.getStatus() after stop, `packages/transport/src/webhook/handler.ts`):** Add a `stopped` flag tracked internally; `getStatus()` returns `connected: false` once `.stop()` has been called. This is a behavior change from the current always-`connected: true` design — intentional, matches the finding's described fix.

### Embedding provider lifecycle & reembed safety (Phase 28 items)

- **D-04 (LazyEmbeddingProvider placeholders, `apps/brain-support/src/brain.ts`):** **Deviation from literal roadmap SC wording** ("sem valores placeholder antes da resolução"). Do NOT change `dimensions`/`providerName` to async getters — that would be a breaking interface change to `IEmbeddingProvider`, which other Brains implement against. Instead, document the placeholder behavior inline (dimensions:0, providerName:"unresolved" until first `embed()`/`embedQuery()` call resolves it) so callers know not to read these before first use. This satisfies the underlying concern (undocumented surprise) without the breaking change.
- **D-05 (`getEmbeddingProvider()` invalidation, `apps/brain-support/src/brain.ts`):** Leave as a process-lifetime singleton — no invalidation mechanism needed. Rationale: `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` are set via ENV at container start and never change at runtime, matching the project's per-client Docker image deployment model (CLAUDE.md). No config-reload use case exists today. Document this rationale in code/CONTEXT rather than build unused infrastructure.
- **D-06 (`reembed.ts` unbounded pages, `packages/core/src/rag/reembed.ts`):** Add a `MAX_PAGES` cap (e.g. `MAX_PAGES=500` at `PAGE_SIZE=200` → 100k row ceiling) to prevent a runaway re-embed job. Keep the existing per-row `UPDATE` — do NOT batch UPDATEs into `WHERE id IN (...)` in this phase; that's a larger change than a tech-debt cap warrants.
- **D-07 (`runner.ts` dimension-mismatch query, no discussion needed — mechanical):** Add defensive handling for zero-row/missing-relation results before destructuring the `atttypmod` query result; throw a clear error instead of crashing on array destructure.

### Shared code extraction (Phase 29 items)

- **D-08 (AI-message type-guard unification, IN-03):** Extract the duplicated inline type-guard (checking `tool_calls` for a specific tool name, used in both `apps/brain-sdr` and `apps/brain-support`'s `routeAfterLlm`) into `packages/core/src/brain/type-guards.ts`. Both apps already import shared brain-lifecycle code from `packages/core` — keep it there rather than `packages/shared` (which holds pure types, not runtime helpers).
- **D-09 (RESERVED_TOOL_NAMES derivation, IN-01):** Matches literal roadmap SC wording — derive the deny-list Set from the actual native tool instances created in `buildGraph()` (`search_knowledge`, `pause_session`, `finish_conversation`, `respond`) instead of the current hardcoded Set literal in each app. Derivation happens server-side at `buildGraph()` time, before any LLM/user input is processed, so it is not attacker-influenced — the DRY win outweighs the staleness risk of a manually maintained literal.
- **D-10 (`getEmbeddingProvider()` invalidation):** See D-05 above (same decision, cross-referenced from Phase 29's IN-02 finding).

### SUP-08 naming alignment

- **D-11:** Update `REQUIREMENTS.md`'s SUP-08 text to match the code (`toolsRegistry.enableTool(...)`), not the other way around. `enableTool()` is the established, tested API used since Phase 27 across both Brains — renaming production code for a cosmetic requirement-text mismatch is out of proportion to the fix.

### Test hygiene

- **D-12 (`fup-e2e.test.ts` ordering, `packages/core/src/__tests__/integration/fup-e2e.test.ts`):** Refactor into independent tests, each with its own setup (own lead/fup_config), so tests can run in any order or isolation — matching `bun test`'s per-test independence expectations. Do not keep the sequential-steps-as-separate-tests structure.
- **D-13 (`mock.module` cross-pollution, `brain-runner.test.ts` / `packages/embeddings/src/__tests__/unit/factory.test.ts`):** **Verify before fixing.** Scouting found `factory.test.ts` already mocks the underlying LangChain SDKs directly (not sibling `@brain-pkg/embeddings` modules) — the safe pattern the codebase is supposed to follow, per an existing warning comment in that file. Before making any code change: actually run both test files together in the same process and confirm the described 3-failures-when-combined scenario still reproduces. If it does NOT reproduce, document the root cause and current-state resolution instead of changing code that isn't broken. If it DOES reproduce, fix `brain-runner.test.ts`'s embedding mocks to follow the same safe pattern (mock LangChain SDKs, not `@brain-pkg/embeddings` directly).
- **D-14 (SUMMARY.md frontmatter backfill, mechanical — no discussion needed):** Add `requirements-completed` frontmatter field to `27-02-SUMMARY.md`, `27-03-SUMMARY.md`, `29-01-SUMMARY.md`, `29-02-SUMMARY.md`, listing the requirement IDs each plan satisfied (cross-reference `.planning/v1.5-MILESTONE-AUDIT.md`'s requirements coverage table for the correct IDs per plan).

### Claude's Discretion

- Exact `MAX_PAGES` constant value in `reembed.ts` (D-06) — 500 is a suggested starting point, adjust based on realistic knowledge-base sizes.
- Exact wording of the inline documentation comments for D-01, D-03, D-04, D-05.
- Whether the `ingest.ts` comment fix (WR-01/28, mechanical), `atttypmod` cross-version documentation, `search-knowledge.ts` content escaping/truncation, `EMBEDDING_DIMENSIONS` vs Gemini-3072 cross-check, and duplicate `DATABASE_URL` check removal in `_compileGraph()` need any design choice beyond a direct fix — scouting found these are straightforward, single-path fixes with no real ambiguity.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tech debt source (primary)
- `.planning/v1.5-MILESTONE-AUDIT.md` — full `tech_debt` frontmatter block (all WR-01..04/IN-01..04 items across phases 27-30) this phase closes; requirements coverage table used to backfill SUMMARY frontmatter (D-14)

### Established patterns / precedent this phase must follow
- `.planning/phases/27-tech-debt-fixes/27-CONTEXT.md` — D-16 (transport-down → 503 semantics, relevant to confirming the WR-01 scope correction); established `BRAIN_TOOLS`/`enabledTools` filtering pattern
- `.planning/phases/29-brain-suporte-core/29-CONTEXT.md` — D-01/D-02 precedent for reinterpreting/documenting a deviation from literal requirement/SC wording when justified (used as the template for D-04's deviation note)
- `.planning/phases/31-tech-debt-onboarding-hardening/31-CONTEXT.md` — sibling gap-closure phase; establishes the `RESERVED_TOOL_NAMES` + append-after-filter pattern in `apps/brain-support/src/brain.ts` (lines 84-147) that D-09's derivation logic must not break

### Reference implementations for this phase's fixes
- `apps/brain-support/src/brain.ts` — `RESERVED_TOOL_NAMES` (lines 84-89), `LazyEmbeddingProvider` (lines 36-56), `getEmbeddingProvider()` (lines 28-34), `routeAfterLlm` type-guard usage (~line 203)
- `apps/brain-sdr/src/brain.ts` — `RESERVED_TOOL_NAMES` (lines 86-90), `routeAfterLlm` type-guard usage (~line 257)
- `packages/core/src/runner/runner.ts` — SIGTERM handler (`_sigtermHandler`, line 98; registration line 236), `close()` cleanup method (~line 548), dimension-mismatch query (lines 155-161), duplicate `DATABASE_URL` check in `_compileGraph()` (~line 537+)
- `packages/transport/src/rabbitmq/consumer.ts` — retry map key construction (lines 41, 112)
- `packages/transport/src/webhook/handler.ts` — `getStatus()` (lines 155-160)
- `packages/core/src/rag/reembed.ts` — pagination loop (lines 66-102)
- `packages/core/src/rag/ingest.ts` — misleading comment (lines 74-77)
- `packages/core/src/tools/registry.ts` — `registerBrainType()` (line 50) vs `enableTool()` (line 60)
- `packages/core/src/runner/__tests__/brain-runner.test.ts` (lines 16-19, 100-102) and `packages/embeddings/src/__tests__/unit/factory.test.ts` (lines 1-28) — mock.module isolation investigation (D-13)
- `packages/core/src/__tests__/integration/fup-e2e.test.ts` — ordering refactor target (D-12)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/brain-support/src/brain.ts`'s existing `RESERVED_TOOL_NAMES` + append-after-filter pattern (Phase 31) — template for D-09's derivation logic to build on top of, not replace
- Established `__tests__/integration/` convention (fup-e2e.test.ts already lives there) for D-12's refactor

### Established Patterns
- Fail-fast on configuration errors (`exit(1)` in `init()`) — precedent from Phases 27-31, relevant to D-01's idempotent-init approach and D-07's defensive query handling
- Duck-typing interfaces to avoid circular dependencies (`IBrainRunnerLike`, `BrainOutput` in `packages/shared`) — relevant to where D-08's type-guard should live (packages/core, not packages/shared, since it's a runtime helper not a pure type)
- Native tools built as closures over `ctx.sql`/`ctx.llm` in `buildGraph()`, filtered by `ctx.enabledTools` — D-09's derivation must happen after these closures exist but is otherwise independent of this filtering mechanism

### Integration Points
- `apps/brain-sdr/src/brain.ts` and `apps/brain-support/src/brain.ts` both need D-09 (RESERVED_TOOL_NAMES derivation) and D-08 (type-guard extraction) applied independently — no shared brain.ts to change once
- `packages/core/src/brain/type-guards.ts` is a new file (D-08) that both apps will import from

</code_context>

<specifics>
## Specific Ideas

No additional specifics beyond the decisions above — this is an exhaustive, previously-enumerated tech-debt checklist rather than a new-capability phase. Scope is fixed by `.planning/v1.5-MILESTONE-AUDIT.md`'s `tech_debt` block and ROADMAP.md's Phase 32 success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. All items raised were already part of the roadmap's Phase 32 success criteria; no new capabilities were proposed.

### Reviewed Todos (not folded)
None — `todo match-phase 32` returned 0 matches.

</deferred>

---

*Phase: 32-tech-debt-code-quality-cleanup*
*Context gathered: 2026-07-02*
