---
phase: 29-brain-suporte-core
verified: 2026-07-01T21:05:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 6/7
  gaps_closed:
    - "search_knowledge tool sempre ativa no grafo — nenhuma ENV ou flag pode desativá-la (SUP-02/D-04): ctx.mcpTools collision path now filtered"
  gaps_remaining: []
  regressions: []
---

# Phase 29: Brain Suporte Core Verification Report

**Phase Goal:** `apps/brain-support` processa mensagens de suporte end-to-end — RAG estruturalmente sempre ativo, `pause_session`/`finish_conversation` nativas em `buildGraph()` (D-02), histórico persistente e saída estruturada validada pelo SDK
**Verified:** 2026-07-01T21:05:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (plan 29-03)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Brain Suporte recebe mensagem via webhook e via RabbitMQ, produz resposta sem alterar código | ✓ VERIFIED | (Regression check) `createTransport(runner)` reused unchanged from `@brain-pkg/transport` in `index.ts`; `createServer()` mounts `createWebhookApp(runner)` identically to brain-sdr; `server.test.ts` confirms `/api/v1/webhook` route exists. No change since prior verification. |
| 2 | Grafo sempre inclui `search_knowledge` no `ToolNode` — nenhuma ENV ou flag pode desativá-la | ✓ VERIFIED (gap closed) | `BRAIN_TOOLS`/`ctx.enabledTools` bypass unchanged and still tested (`brain.test.ts` lines 30-75). **Previously partial gap now closed:** `apps/brain-support/src/brain.ts` lines 84-89 define `RESERVED_TOOL_NAMES = new Set(["search_knowledge", "pause_session", "finish_conversation", "respond"])`; line 131-140 filters `ctx.mcpTools` against this set (`safeMcpTools`) BEFORE concatenation into `allToolsExceptSearch` (line 141). `ctx.mcpTools` is referenced only inside the `safeMcpTools` filter definition — confirmed via `grep -n "ctx.mcpTools" apps/brain-support/src/brain.ts` (single occurrence, inside `.filter()`). Two new regression tests (`brain.test.ts` lines 77-130) prove a mock MCP tool named `search_knowledge` and one named `pause_session` are both dropped — `bindTools()` call args stay at length 4 (not 5) and the surviving tool's description matches the native tool, not the malicious MCP mock. Ran directly: `bun test apps/brain-support/src/__tests__/unit/brain.test.ts` → 9 pass, 0 fail. |
| 3 | `pause_session`/`finish_conversation` são closures nativas em `buildGraph()`, sem equivalente `qualify_lead`; MCP dinâmico genérico continua disponível (D-01/D-02/D-03) | ✓ VERIFIED | `brain.ts:103-104` creates `createPauseSessionTool(ctx.sql!)` / `createFinishConversationTool(ctx.sql!)` as native closures inside `buildGraph()`. `grep -rn "qualify_lead" apps/brain-support/` matches only test negative-assertions, never production code. No change since prior verification. |
| 4 | Brain Suporte usa `IEmbeddingProvider` com modelo/dimensões independentes do SDR | ✓ VERIFIED | `lazyEmbeddingProvider()`/`createEmbeddingProvider()` resolved per-process from ENV, `.env.example` documents brain-support-specific defaults and distinct `DATABASE_NAME=brain_suporte`. No change since prior verification. |
| 5 | Resposta é `BrainOutput` válido (`fullResponse`, `responseMode`); `BrainOutputValidationError` lançado para saídas inválidas | ✓ VERIFIED | `respond` node in `brain.ts:255-287` constructs `brainOutput` identically to brain-sdr's contract. Validation lives in Brain-agnostic `BrainRunner`. Unit test (`brain.test.ts:132-156`) proves D-10 fallback path works end-to-end through a compiled graph invoke. No change since prior verification. |
| 6 | Gate `ia_ativada` bloqueia processamento silenciosamente; histórico por lead via PostgresSaver (`thread_id = lead.uniqueId`) | ✓ VERIFIED | Both mechanisms live entirely in `packages/core/src/runner/runner.ts`, used unchanged by every Brain including brain-support. No change since prior verification. |
| 7 | `ToolsRegistry.registerBrainType("support", ...)` existe — habilitar tools por tipo funciona | ✓ VERIFIED | `index.ts` calls `toolsRegistry.enableTool("support", "pause_session")`, `enableTool("support", "finish_conversation")`, `enableTool("support", "search_knowledge")`. 4 unit tests in `toolsregistry-support.test.ts` confirm correct wiring. No change since prior verification. |

**Score:** 7/7 truths fully verified (previous partial on truth #2 now closed by plan 29-03)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/brain-support/src/brain.ts` | `supportBrain: IBrain` with buildGraph implementing D-01/D-02/D-04 + MCP-collision filter | ✓ VERIFIED | Exists, substantive (294 lines), wired (imported by `index.ts`). Now includes `RESERVED_TOOL_NAMES` + `safeMcpTools` filter closing the SUP-02 gap. |
| `apps/brain-support/src/__tests__/unit/brain.test.ts` | Regression test proving MCP tool named `search_knowledge` is filtered, no bindTools() collision | ✓ VERIFIED | Contains `describe("BrainSupport — MCP tool colidindo com nome reservado é descartada (WR-01, SUP-02)")` with 2 tests, both passing. Contains string "colidindo" (matches required "collide"/"colid" pattern). |
| `apps/brain-support/src/index.ts` | Entrypoint — TenantPoolManager, ToolsRegistry, BrainRunner, createTransport, Bun.serve | ✓ VERIFIED | Unchanged since prior verification, still substantive and wired. |
| `apps/brain-support/src/server.ts` | Hono app — mounts health/webhook/core/ingest/reembed | ✓ VERIFIED | Unchanged since prior verification. |
| `apps/brain-support/package.json` | Workspace app manifest `@brain-app/support` | ✓ VERIFIED | Unchanged since prior verification. |
| `packages/database/src/migrations/0010_brain_support_prompts.sql` | Seed INSERT for `prompts(brain_type='support', key='system')` | ✓ VERIFIED | Unchanged, idempotent, `brain_type='support'` matches `supportBrain.brainType`. |
| `packages/database/src/migrations/meta/_journal.json` | Journal entry for migration 0010 | ✓ VERIFIED | Valid JSON confirmed via `node -e "JSON.parse(...)"`. |
| `apps/brain-support/.env.example` | Documented ENV surface, closes Phase 28 EMBEDDING_* gap | ✓ VERIFIED | Unchanged since prior verification. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `apps/brain-support/src/index.ts` | `apps/brain-support/src/brain.ts` | `BrainRunner({ brain: supportBrain, ... })` | ✓ WIRED | Confirmed by grep and clean `tsc --noEmit` typecheck. |
| `apps/brain-support/src/brain.ts` | `packages/core/src/tools/search-knowledge.ts` | `createSearchKnowledgeTool(...)` bound unconditionally, excluded from `enabledTools` filter, now also excluded from MCP-collision path | ✓ WIRED (gap closed) | Both bypass paths (`BRAIN_TOOLS` and MCP-name-collision) now implemented and tested. |
| `apps/brain-support/src/brain.ts` | `ctx.mcpTools` | `safeMcpTools = ctx.mcpTools.filter((t) => !RESERVED_TOOL_NAMES.has(t.name))` | ✓ WIRED | Confirmed present at brain.ts:131, exact pattern from plan's key_links spec. |
| `apps/brain-support/src/index.ts` | `packages/core/src/tools/registry.ts` | `toolsRegistry.enableTool("support", ...)` | ✓ WIRED | Confirmed by 4 passing unit tests plus source inspection. |
| `packages/database/src/migrations/0010_brain_support_prompts.sql` | `apps/brain-support/src/brain.ts` | `brain_type` column value equals `supportBrain.brainType` | ✓ WIRED | Both use literal string `"support"`. |
| `apps/brain-support/.env.example` | `packages/embeddings/src/factory.ts` | `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` | ✓ WIRED | ENV names match factory.ts exactly. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `respond` node | `brainOutput` | `respondCall.args` from real `AIMessage.tool_calls` (LLM output) | Yes | ✓ FLOWING |
| `llmWithTools.invoke()` | `filteredAllTools` | Constructed from real closures + `safeMcpTools` filter, not empty arrays | Yes | ✓ FLOWING |
| `boundSearchKnowledgeTool` | RAG search results | `createSearchKnowledgeTool(ctx.sql!, lazyEmbeddingProvider())` — real SQL + embedding provider | Yes | ✓ FLOWING |
| `safeMcpTools` | Filtered MCP tool list | `ctx.mcpTools.filter((t) => !RESERVED_TOOL_NAMES.has(t.name))` — real filter over real array, tested with real `tool()`-constructed mocks | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full brain-support unit test suite passes | `bun test apps/brain-support/src/__tests__/unit` | 17 pass, 0 fail, 37 expect() calls across 3 files | ✓ PASS |
| brain.test.ts specifically (includes new gap-closure tests) | `bun test apps/brain-support/src/__tests__/unit/brain.test.ts` | 9 pass, 0 fail, 24 expect() calls | ✓ PASS |
| Typecheck passes | `pnpm --filter @brain-app/support typecheck` | Exits 0, no errors | ✓ PASS |
| `ctx.mcpTools` referenced only inside filter, not direct concatenation | `grep -n "ctx.mcpTools" apps/brain-support/src/brain.ts` | Single match at line 131 inside `.filter()` — matches plan's exact acceptance criterion | ✓ PASS |
| `RESERVED_TOOL_NAMES` present and used | `grep -c "RESERVED_TOOL_NAMES.has" apps/brain-support/src/brain.ts` | 1 (at line 132) | ✓ PASS |
| No `qualify_lead` in production code | `grep -rn "qualify_lead" apps/brain-support/` | Only matches in test files as negative assertions | ✓ PASS |
| Migration journal is valid JSON | `node -e "JSON.parse(...)"` | Valid | ✓ PASS |
| Gap-closure commit present in history | `git log --oneline -- apps/brain-support/src/brain.ts` | `c538bff security(brain-support): filter MCP tools colliding with reserved names` present after scaffold commit | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SUP-01 | 29-01, 29-02 | Recebe mensagens via webhook e RabbitMQ configurável por ENV | ✓ SATISFIED | Unchanged since prior verification — `createTransport(runner)` reused unchanged. |
| SUP-02 | 29-01, 29-03 | `search_knowledge` sempre ativa no grafo — sem flag/ENV | ✓ SATISFIED | Both bypass paths now closed: `BRAIN_TOOLS` (Plan 01, D-04) and MCP-name-collision (Plan 03, this verification's focus). 2 new regression tests confirm the MCP path; all 9 `brain.test.ts` tests pass. |
| SUP-03 | 29-01 | Tools do grafo carregadas via MCP dinâmico, sem hardcode (reinterpreted per D-01/D-02: `pause_session`/`finish_conversation` are hardcoded native closures — user-confirmed deviation) | ✓ SATISFIED (per D-01/D-02 override) | `29-CONTEXT.md` D-02 explicitly documents this reinterpretation, reflected in ROADMAP.md's phase goal/success-criteria text. Implementation matches D-01/D-02 exactly. |
| SUP-04 | 29-01, 29-02 | `IEmbeddingProvider` com provider/modelo/dimensões independentes do SDR | ✓ SATISFIED | Unchanged since prior verification. |
| SUP-05 | 29-01, 29-02 | `BrainOutput` estruturado validado pelo SDK | ✓ SATISFIED | Unchanged since prior verification. |
| SUP-07 | 29-01, 29-02 | Gate `ia_ativada` + histórico persistente via PostgresSaver (`thread_id = lead.uniqueId`) | ✓ SATISFIED | Unchanged since prior verification. |
| SUP-08 | 29-01, 29-02 | Registrado no `ToolsRegistry` com tipo `"support"` | ✓ SATISFIED | Unchanged since prior verification. |

No orphaned requirements — all 7 IDs mapped to Phase 29 in `REQUIREMENTS.md` (SUP-01 through SUP-05, SUP-07, SUP-08) are declared across the three plans' frontmatter (29-01, 29-02, 29-03). SUP-06 (Dockerfile) is correctly out of scope for this phase (Phase 30).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/brain-support/src/brain.ts` | 109-147 | `respondTool` is included in `nativeTools`, subject to `ctx.enabledTools` (`BRAIN_TOOLS`) filter — unlike `search_knowledge`, `respond` has no "append after filter" protection. If an operator sets `BRAIN_TOOLS` without `"respond"`, every response silently degrades to the D-10/PITFALL-6 fallback (`responseMode: "undefined"`) instead of the normal path. | ⚠️ Warning | New finding from latest `29-REVIEW.md` (WR-01, post-gap-closure review). **Not a regression from this phase's must-haves** — no roadmap Success Criterion or plan `must_haves` requires `respond` to bypass `BRAIN_TOOLS` (SUP-02 and all must_haves reference `search_knowledge` specifically). Inherited unchanged from `brain-sdr`'s identical pattern, pre-existing before Phase 29. Requires operator misconfiguration (a `BRAIN_TOOLS` value omitting `respond`) to trigger — not exploitable by end-user/LLM input. Does not block this phase's goal achievement; recommend a follow-up gap/plan covering both `brain-support` and `brain-sdr`. |
| `apps/brain-support/src/brain.ts` | 84-89 | `RESERVED_TOOL_NAMES` is a hardcoded literal set, not derived from the actual tool instances (`nativeTools.map(t => t.name)` + `boundSearchKnowledgeTool.name`) | ℹ️ Info | If a future `packages/core` refactor renames one of the reserved tools, this set goes stale silently. Documented as IN-01 in `29-REVIEW.md`. Cosmetic/maintainability risk only, not a functional gap today. |
| `apps/brain-support/src/brain.ts` | 260 | `msg.getType?.() === "ai" || (msg as any)._getType?.() === "ai"` — inconsistent accessor names vs rest of file | ℹ️ Info | Inherited unchanged from brain-sdr (IN-03 in review), not introduced by this phase. |
| `apps/brain-support/.env.example` | 32-34 | Comment references "migration 0009" by number, will go stale as migrations evolve | ℹ️ Info | Inherited pattern (documented in review), cosmetic only. |

No blocker-level anti-patterns found. The gap that previously blocked a clean pass (MCP-tool-name collision on `search_knowledge`) is now closed and verified with passing regression tests.

### Human Verification Required

None. All observable truths for this phase are verifiable via static analysis, unit tests, and typecheck — no UI, no real-time behavior, and no external service integration requiring manual testing was introduced by the gap-closure plan (29-03) or remains outstanding from the original phase scope.

### Gaps Summary

No gaps remain against this phase's established must-haves. The single gap identified in the initial verification (`29-VERIFICATION.md`, `gaps_found`, score 6/7) — an MCP tool named `search_knowledge` (or another reserved name) could collide with the native tool at `bindTools()`/`ToolNode` time due to unfiltered `ctx.mcpTools` concatenation — has been closed by plan `29-03`:

- `apps/brain-support/src/brain.ts` now defines `RESERVED_TOOL_NAMES` and filters `ctx.mcpTools` into `safeMcpTools` before concatenation (lines 84-89, 131-141).
- Two new regression tests in `brain.test.ts` prove the fix: injecting a mock MCP tool named `search_knowledge` or `pause_session` results in exactly one tool of that name reaching `bindTools()`, and it is the native tool (verified by description content), not the MCP impostor.
- All 9 tests in `brain.test.ts` (7 original + 2 new) and all 17 tests in the full `apps/brain-support` unit suite pass. Typecheck is clean.
- No regressions found in any of the other 6 previously-verified truths, 8 artifacts, or 6 key links.

A new, separate finding was surfaced in the latest code review (`29-REVIEW.md` WR-01, post-gap-closure): `respond` — unlike `search_knowledge` — has no protection against exclusion via `BRAIN_TOOLS`, which could silently degrade every response to the fallback path if an operator misconfigures that ENV var. This is **not** a gap against this phase's must-haves (SUP-02 and all plan `must_haves` are scoped specifically to `search_knowledge`), is inherited unchanged from `brain-sdr`'s pre-existing pattern, and requires operator misconfiguration to trigger. It is recorded here as a Warning-level anti-pattern for future follow-up, not as a blocking gap for Phase 29 closure.

---

_Verified: 2026-07-01T21:05:00Z_
_Verifier: Claude (gsd-verifier)_
