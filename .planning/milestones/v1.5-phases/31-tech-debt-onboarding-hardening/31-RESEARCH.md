# Phase 31: Pre-Client Onboarding Hardening - Research

**Researched:** 2026-07-01
**Domain:** Tech debt closure (CI shell hygiene, tool misconfiguration protection, documentation gaps)
**Confidence:** HIGH

## Summary

Phase 31 closes actionable tech debt items from the v1.5 milestone audit (`.planning/v1.5-MILESTONE-AUDIT.md`) marked "worth a follow-up before onboarding a real client": CI shell hygiene bugs in DockGate publish workflows, the `respond` tool's missing misconfiguration guard, and two documentation gaps (`.env.example` embedding ENVs, migration inline warning about hardcoded dimensions).

This is a well-scoped hardening phase with concrete, previously-identified defects. All fixes have established patterns to follow: `apps/brain-support/src/brain.ts` already demonstrates the append-after-filter protection for `search_knowledge` that `respond` must mirror; both workflow files are structurally identical and need the same shell-hygiene fixes; the embedding ENV documentation already exists in `brain-support`'s `.env.example` and just needs to be copied to `brain-sdr`'s.

**Primary recommendation:** Follow existing patterns exactly. This is not an exploration phase — every change has a reference implementation or explicit user decision in `31-CONTEXT.md`.

<user_constraints>
## User Constraints (from 31-CONTEXT.md)

### Locked Decisions

**respond tool protection (apps/brain-sdr/src/brain.ts, apps/brain-support/src/brain.ts)**
- **D-01:** Mirror the existing `search_knowledge` pattern exactly. Move `respondTool` out of `nativeTools`/the enabledTools-filtered set and append it AFTER the `ctx.enabledTools` filter runs, by direct variable reference (not name lookup) — same technique already used for `boundSearchKnowledgeTool` in `apps/brain-support/src/brain.ts` (see `filteredExceptSearch` → `filteredAllTools` pattern there). `BRAIN_TOOLS` must become structurally incapable of excluding `respond`, in both `apps/brain-sdr/src/brain.ts` and `apps/brain-support/src/brain.ts`.
- Apply the identical fix to both apps — this is the same class of bug in both, not brain-support-specific.
- No change to `pause_session`, `finish_conversation`, or MCP-loaded tools — those remain correctly filterable by `BRAIN_TOOLS`.

**CI shell hygiene (.github/workflows/publish-brain-support.yml, .github/workflows/publish-brain-sdr.yml)**
- **D-02:** Fix BOTH workflow files in this phase, not just the one the audit flagged (`publish-brain-support.yml`) — `publish-brain-sdr.yml` is the original file brain-support's was copied from and has the identical bug (unquoted `$RESPONSE` in the `jq` pipe, no validation before use).
- **D-03:** Quote `$RESPONSE` in the `echo $RESPONSE | jq -r .url` line.
- **D-04:** After extracting `URL`, validate it's non-empty and not the literal string `"null"`. If invalid: print the raw DockGate response for debugging and `exit 1` — hard-fail the job rather than letting the pipeline continue with a broken URL that fails later with a confusing curl error.

**Migration inline warning (packages/database/src/migrations/0009_embedding_dimensions_fix.sql)**
- **D-05:** Add a short (1-2 line) SQL comment at the top of the file: the hardcoded `vector(1536)` is OpenAI-specific, and regenerating this migration for a different `EMBEDDING_DIMENSIONS` requires manually re-adding the `TRUNCATE` statement. Point to `.planning/phases/28-embedding-sdk/28-VERIFICATION.md` for the full accepted-override rationale. Not a full checklist — just enough to stop a future developer from being surprised.

**.env.example (apps/brain-sdr/.env.example)**
- **D-06:** Add `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` documentation, mirroring what already exists in `apps/brain-support/.env.example` (lines 28-34: comment explaining fallback to `LLM_PROVIDER` when `EMBEDDING_PROVIDER` is absent, then the three ENV var lines with `openai` / `text-embedding-3-small` / `1536` as example values).

### Claude's Discretion
- Exact wording/formatting of the CI failure error message.
- Whether the `respond`-append fix in `apps/brain-sdr/src/brain.ts` needs a `RESERVED_TOOL_NAMES`-style MCP-collision guard like brain-support already has (brain-sdr currently has no MCP-collision guard at all for any native tool) — planner/researcher should check current brain-sdr code and decide if this is in-scope or a separate concern.

### Deferred Ideas (OUT OF SCOPE)
- Whether `apps/brain-sdr` should get a `RESERVED_TOOL_NAMES`-style MCP-collision guard for ALL native tools (not just as a side-effect of the respond fix) — noted as Claude's Discretion above, may become its own follow-up if it turns out to be a bigger change than expected
- All remaining warning/info-level tech debt items (WR-02/03, IN-01/02/03 across phases 27-30, SUMMARY frontmatter backfill, test ordering/isolation issues) — explicitly out of scope for Phase 31, assigned to Phase 32 (Code Quality Cleanup) per the gap-closure plan
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TECH-04 | Workflows de CI (`publish-brain-sdr.yml`, `publish-brain-support.yml`) fazem quote de `$RESPONSE` e `exit 1` se `jq -r .url` retornar vazio/nulo | D-03/D-04 decisions; bash shell quoting best practices + curl/jq validation patterns researched |
| TECH-05 | Tool `respond` tem proteção de append-after-filter equivalente a `search_knowledge`; `.env.example` do brain-sdr documenta ENVs de embedding; migration 0009 tem aviso inline sobre `vector(1536)` hardcoded | D-01 (respond fix), D-06 (.env.example), D-05 (migration comment); reference implementation in `apps/brain-support/src/brain.ts` already exists |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

### Git Commit Guidelines
All commits MUST follow Conventional Commits with emojis. Relevant types for this phase:
- `🐛 fix` — Bug fixes (CI shell hygiene, respond tool protection)
- `📝 docs` — Documentation changes (`.env.example`, migration inline comment)

Title max 72 chars, imperative mood, no period. Body optional for explaining "what" and "why". English for title, body can be Portuguese for internal commits. NEVER include Claude Code attribution lines.

### Architecture Constraints
**packages/ vs apps/:** This phase touches both:
- `apps/brain-sdr/` and `apps/brain-support/` — brain-specific code (tool filtering logic, .env.example)
- `packages/database/` — shared migration file
- `.github/workflows/` — CI infrastructure

All changes are bug fixes or documentation — no new shared code needed in `packages/`.

### Stack Constraints
- **Testing:** `bun test` (built-in, Jest-compatible API, no config needed)
- **Monorepo:** Bun workspaces (native)
- **Runtime:** Bun 1.3.2 (confirmed via `bun --version`)

## Standard Stack

This phase involves shell scripting (bash in GitHub Actions), TypeScript (tool protection logic), and SQL (inline comments). No external libraries needed — all fixes use language/framework built-ins.

### Core Technologies

| Technology | Version | Purpose | Why Standard |
|------------|---------|---------|--------------|
| Bash (GitHub Actions) | Ubuntu 22.04 default (5.1+) | CI workflow scripts | Standard GitHub Actions runner environment |
| jq | 1.6+ (pre-installed on ubuntu-latest) | JSON parsing in CI | Universal JSON CLI tool, pre-installed on all GitHub runners [VERIFIED: GitHub Actions docs] |
| TypeScript | 5.9.3 (project-wide) | Type-safe tool filtering | Project constraint [VERIFIED: package.json] |
| Bun | 1.3.2 | Runtime + test framework | Project constraint [VERIFIED: bun --version] |

### Supporting Tools

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `curl` | 7.81+ (pre-installed) | HTTP requests in CI | API calls to DockGate registry |
| `echo` / `[[ ]]` | Bash built-ins | Variable validation | URL null/empty checks |

### No New Dependencies

This phase requires zero new npm packages or external tools. All changes use:
- Existing TypeScript patterns (`apps/brain-support/src/brain.ts` as reference)
- Standard bash utilities (already in GitHub Actions runners)
- SQL comments (native PostgreSQL syntax)

## Architecture Patterns

### Pattern 1: Append-After-Filter for Critical Tools

**What:** Reserve tools (like `respond`, `search_knowledge`) that must ALWAYS be available by appending them AFTER the `enabledTools` filter runs, not including them in the filtered set.

**When to use:** Any tool whose absence would silently degrade the Brain's core functionality (not a loud failure, but a bad fallback behavior).

**Reference implementation:** `apps/brain-support/src/brain.ts` lines 84-147

**Example:**
```typescript
// Source: apps/brain-support/src/brain.ts (brain-support, already implemented)
const RESERVED_TOOL_NAMES = new Set([
  "search_knowledge",
  "pause_session",
  "finish_conversation",
  "respond",  // D-01: added in Phase 31
]);

// Inside buildGraph():
const nativeTools = [
  boundPauseSessionTool,
  boundFinishConversationTool,
  // respondTool deliberately EXCLUDED from nativeTools — appended later
];

// MCP tools filtered to remove any that collide with reserved names
const safeMcpTools = ctx.mcpTools.filter((t) => {
  const collides = RESERVED_TOOL_NAMES.has(t.name);
  if (collides) {
    logger.warn({ toolName: t.name }, "MCP tool collides with native reserved tool — dropped");
  }
  return !collides;
});

const allToolsExceptSearch = [...nativeTools, ...safeMcpTools];
const filteredExceptSearch = ctx.enabledTools
  ? allToolsExceptSearch.filter((t) => ctx.enabledTools!.has(t.name))
  : allToolsExceptSearch;

// search_knowledge AND respond appended AFTER the filter — never excludable by BRAIN_TOOLS
const filteredAllTools = [...filteredExceptSearch, boundSearchKnowledgeTool, respondTool];

const llmWithTools = ctx.llm.bindTools(filteredAllTools);
```

**brain-sdr current state:** `apps/brain-sdr/src/brain.ts` lines 144-161 includes `respondTool` in `nativeTools` array, making it filterable. Phase 31 must change this to mirror brain-support's pattern [VERIFIED: code read].

### Pattern 2: Shell Variable Quoting + Validation in CI

**What:** Quote all variables containing API responses before piping to `jq`, and validate extracted values are non-empty/non-null before use.

**When to use:** Any GitHub Actions step that parses API JSON responses with `jq` and uses extracted values in subsequent steps.

**Best practices (2026):**
1. Always quote variables in `echo "$VAR"` to prevent word splitting [CITED: oneuptime.com bash best practices 2026]
2. Use `jq -r` for raw string output (no quotes)
3. Validate extracted value with `[[ -n "$VAR" && "$VAR" != "null" ]]` before use
4. Use `curl -sf` (silent + fail-on-http-error) to catch API errors early [CITED: developnsolve.com jq guide]
5. Print raw response on validation failure for debugging

**Example:**
```bash
# Source: Best practices synthesis (not yet in codebase — Phase 31 implements)
- name: Request upload URL from DockGate
  id: upload_url
  env:
    DOCKGATE_URL: ${{ secrets.DOCKGATE_URL }}
    DOCKGATE_UPLOAD_TOKEN: ${{ secrets.DOCKGATE_UPLOAD_TOKEN }}
  run: |
    RESPONSE=$(curl -sf -X POST \
      -H "Authorization: Bearer $DOCKGATE_UPLOAD_TOKEN" \
      "$DOCKGATE_URL/apps/$APP_NAME/upload?version=${{ steps.version.outputs.VERSION }}")

    # D-03: Quote $RESPONSE to prevent word splitting if jq is fed shell-expanded garbage
    URL=$(echo "$RESPONSE" | jq -r .url)

    # D-04: Validate URL is non-empty and not literal "null" (jq returns "null" for missing fields)
    if [[ -z "$URL" || "$URL" == "null" ]]; then
      echo "ERROR: DockGate returned invalid URL."
      echo "Raw response: $RESPONSE"
      exit 1
    fi

    echo "URL=$URL" >> $GITHUB_OUTPUT
```

**Current state:** Both `publish-brain-sdr.yml` and `publish-brain-support.yml` (lines 59-63) use unquoted `$RESPONSE` and no validation [VERIFIED: workflow files read].

### Pattern 3: SQL Migration Inline Comments

**What:** Use `--` single-line comments at the top of migration files to document non-obvious design decisions, especially when the committed migration differs from the "ideal" repeatable pattern.

**When to use:** Any migration with hardcoded values (dimensions, schema names) that a future developer might need to regenerate with different parameters.

**PostgreSQL comment syntax:**
```sql
-- Single-line comment (standard ANSI SQL)
-- Multiple consecutive lines are fine
```

**Example (Phase 31 adds):**
```sql
-- EMBEDDING_DIMENSIONS hardcoded to 1536 (OpenAI text-embedding-3-small default).
-- Regenerating for a different dimension (e.g., Gemini's 3072) requires manually re-adding the TRUNCATE statements.
-- See .planning/phases/28-embedding-sdk/28-VERIFICATION.md for accepted override rationale (EMBD-03).
TRUNCATE TABLE "embeddings", "knowledge_chunks";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(1536);
```

**Source:** [CITED: PostgreSQL documentation — single-line comments with `--`], cross-referenced with [techonthenet.com PostgreSQL comments guide]

### Anti-Patterns to Avoid

**Anti-pattern: Including critical tools in filtered set**
- **Why bad:** Operator misconfiguration (`BRAIN_TOOLS` set without `respond`) silently degrades every response to fallback mode — no error, just poor UX
- **Fix:** Append critical tools AFTER filter runs (Pattern 1)

**Anti-pattern: Using unquoted variables with `jq` in shell scripts**
- **Why bad:** Shell word splitting can cause `jq` parse errors; no validation means broken values propagate to later steps with confusing failures
- **Fix:** Quote variables, validate extracted values (Pattern 2)

**Anti-pattern: Hardcoding values in migrations with no explanation**
- **Why bad:** Future developers regenerate the migration unaware of manual steps (TRUNCATE), causing data loss or production errors
- **Fix:** Add inline comment documenting the hardcoded value and regeneration procedure (Pattern 3)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parsing in bash | Custom `sed`/`awk` regex extraction | `jq` | Pre-installed on all GitHub runners, handles nested JSON, proper null handling [VERIFIED: GitHub Actions standard tools] |
| Tool filtering logic | Custom string matching, allow-list in config file | TypeScript closure + direct variable reference append | Type-safe, compile-time checked, impossible to bypass with string manipulation |
| SQL comments | External documentation file, README-only warnings | Inline `--` comments in migration file | Migration and its documentation travel together, visible in every `git show` of the file |

**Key insight:** All three problems in this phase already have established solutions — CI JSON parsing is a solved problem (jq), tool protection has a reference implementation in the codebase (`apps/brain-support/src/brain.ts`), and SQL inline comments are ANSI standard. No custom tooling needed.

## Runtime State Inventory

> Phase 31 is a bug-fix/documentation phase with no rename/refactor/migration components. This section is omitted per research protocol (only required for phases involving string replacement or runtime system changes).

## Common Pitfalls

### Pitfall 1: `jq -r .url` returns literal string "null" (not empty) when field is missing

**What goes wrong:** Bash test `[[ -z "$URL" ]]` (empty string check) passes when `URL="null"` (4-character string). Subsequent `curl` step uses `"null"` as a URL, fails with "Could not resolve host: null" instead of a clear "DockGate API returned no URL" error.

**Why it happens:** `jq -r` outputs the raw value — for missing/null JSON fields, this is the literal 4-character string `"null"`, not an empty string or shell null.

**How to avoid:** Validate with `[[ -z "$URL" || "$URL" == "null" ]]` — checks both empty AND the literal "null" string. Always print raw JSON response before exit 1 for debugging [CITED: developnsolve.com jq guide].

**Warning signs:** CI step "Upload image to MinIO" fails with "Could not resolve host" error instead of "Request upload URL" step failing first.

### Pitfall 2: Including `respondTool` in `nativeTools` array makes it filterable by `BRAIN_TOOLS`

**What goes wrong:** Operator sets `BRAIN_TOOLS=qualify_lead,pause_session,search_knowledge` (omits `respond` accidentally or deliberately). LLM never sees `respond` in `bindTools()`, can't call it, falls back to plain `AIMessage` text — every response is degraded, but no error thrown. Silent failure.

**Why it happens:** `respondTool` is included in `nativeTools` array before the `ctx.enabledTools` filter runs (lines 148-154 in `apps/brain-sdr/src/brain.ts`). Filter removes it if not in whitelist. LangGraph's routing logic (`routeAfterLlm`) checks for `tool_calls[0].name === "respond"` — if the tool was filtered out, LLM can't call it, routing never hits the `respond` node.

**How to avoid:** Follow `apps/brain-support/src/brain.ts` pattern (lines 122-147) — exclude `respondTool` from `nativeTools`, append it AFTER the filter via direct variable reference: `const filteredAllTools = [...filteredExceptRespond, respondTool]` [VERIFIED: brain-support reference implementation].

**Warning signs:** Brain works fine with default config (`BRAIN_TOOLS` unset), breaks silently when operator adds `BRAIN_TOOLS` ENV for the first time. No error logs, just low-quality responses.

### Pitfall 3: Forgetting to quote `$RESPONSE` in `echo $RESPONSE | jq` when response contains spaces

**What goes wrong:** If DockGate returns an error message with spaces (e.g., `{"error": "invalid version format"}`), unquoted `$RESPONSE` undergoes shell word splitting — `jq` receives multiple arguments instead of a single JSON string, fails with "parse error" instead of extracting the `.error` field.

**Why it happens:** Bash word splitting is default behavior for unquoted variables. `echo $RESPONSE` expands to multiple words if `$RESPONSE` contains spaces, `jq` interprets them as separate JSON inputs [CITED: oneuptime.com bash best practices 2026].

**How to avoid:** Always quote: `echo "$RESPONSE" | jq`. Even if the current DockGate API never returns spaces, defensive quoting prevents future API changes from breaking the workflow.

**Warning signs:** CI step fails with `jq: parse error: Invalid numeric literal at line 1, column 10` instead of extracting the error field from a valid JSON error response.

### Pitfall 4: Migration inline comment uses `/* */` block comment (PostgreSQL extension, not portable)

**What goes wrong:** `drizzle-kit generate` may strip or misplace block comments during schema diffs. Single-line `--` comments are preserved by all migration tools [ASSUMED — based on ANSI SQL standard, not tool-specific verification].

**Why it happens:** `/* */` is a PostgreSQL extension to ANSI SQL. Drizzle's schema differ operates at the SQL AST level and may not preserve comment placement exactly.

**How to avoid:** Use `--` single-line comments at the top of the migration file, before the first SQL statement. These are preserved by `git`, visible in `cat`/`less`, and never interfere with `psql` execution [CITED: PostgreSQL documentation].

**Warning signs:** Comment disappears after running `drizzle-kit generate` on a different machine, or appears in a different location in the file.

## Code Examples

Verified patterns for this phase:

### Append-After-Filter for `respond` Tool (brain-support reference)

```typescript
// Source: apps/brain-support/src/brain.ts lines 84-147 (Phase 29, already implemented)
const RESERVED_TOOL_NAMES = new Set([
  "search_knowledge",
  "pause_session",
  "finish_conversation",
  "respond",
]);

export const supportBrain: IBrain = {
  // ...
  buildGraph(ctx: BrainBuildContext): any {
    const boundPauseSessionTool = createPauseSessionTool(ctx.sql!);
    const boundFinishConversationTool = createFinishConversationTool(ctx.sql!);
    const boundSearchKnowledgeTool = createSearchKnowledgeTool(ctx.sql!, lazyEmbeddingProvider());
    const respondTool = createRespondTool();

    // respondTool deliberately excluded from nativeTools
    const nativeTools = [
      boundPauseSessionTool,
      boundFinishConversationTool,
      // NOT respondTool — appended after filter
    ];

    // Drop MCP tools that collide with reserved native tool names
    const safeMcpTools = ctx.mcpTools.filter((t) => {
      const collides = RESERVED_TOOL_NAMES.has(t.name);
      if (collides) {
        logger.warn({ toolName: t.name }, "MCP tool collides with native reserved tool");
      }
      return !collides;
    });

    const allToolsExceptSearch = [...nativeTools, ...safeMcpTools];
    const filteredExceptSearch = ctx.enabledTools
      ? allToolsExceptSearch.filter((t) => ctx.enabledTools!.has(t.name))
      : allToolsExceptSearch;

    // Append search_knowledge AND respond AFTER filter — never excludable
    const filteredAllTools = [...filteredExceptSearch, boundSearchKnowledgeTool, respondTool];

    const llmWithTools = ctx.llm.bindTools(filteredAllTools);
    // ... rest of graph definition
  }
};
```

### CI Shell Validation Pattern (new — Phase 31 implements)

```bash
# Source: Best practices synthesis (GitHub Actions + bash 2026 standards)
- name: Request upload URL from DockGate
  id: upload_url
  env:
    DOCKGATE_URL: ${{ secrets.DOCKGATE_URL }}
    DOCKGATE_UPLOAD_TOKEN: ${{ secrets.DOCKGATE_UPLOAD_TOKEN }}
  run: |
    # D-03: curl already uses -sf (silent + fail-on-http-error) — no change needed there
    RESPONSE=$(curl -sf -X POST \
      -H "Authorization: Bearer $DOCKGATE_UPLOAD_TOKEN" \
      "$DOCKGATE_URL/apps/$APP_NAME/upload?version=${{ steps.version.outputs.VERSION }}")

    # D-03: Quote $RESPONSE to prevent word splitting
    URL=$(echo "$RESPONSE" | jq -r .url)

    # D-04: Validate URL is non-empty and not literal "null"
    if [[ -z "$URL" || "$URL" == "null" ]]; then
      echo "ERROR: DockGate upload URL request returned invalid response"
      echo "Raw DockGate response: $RESPONSE"
      exit 1
    fi

    echo "URL=$URL" >> $GITHUB_OUTPUT
```

### SQL Migration Inline Comment (new — Phase 31 adds)

```sql
-- Source: D-05 decision + PostgreSQL comment syntax (ANSI SQL standard)
-- EMBEDDING_DIMENSIONS hardcoded to 1536 (OpenAI text-embedding-3-small default).
-- Regenerating for a different dimension (e.g., Gemini's 3072) requires manually re-adding the TRUNCATE statements.
-- See .planning/phases/28-embedding-sdk/28-VERIFICATION.md for accepted override rationale (EMBD-03).
TRUNCATE TABLE "embeddings", "knowledge_chunks";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(1536);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(1536);
```

### .env.example Embedding Documentation (brain-support reference)

```bash
# Source: apps/brain-support/.env.example lines 28-34 (Phase 29, already implemented)
# EMBEDDING_PROVIDER ausente = fallback para LLM_PROVIDER (se capaz de gerar embeddings:
# openai/openrouter/gemini) ou "openai" como último fallback.
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
# EMBEDDING_DIMENSIONS deve bater com a coluna vector(N) migrada no banco deste Brain
# (migration 0009). Mudar este valor exige re-rodar a migration para a nova dimensão.
EMBEDDING_DIMENSIONS=1536
```

## State of the Art

No breaking changes or deprecated patterns in this phase. All changes are bug fixes and documentation improvements using current 2026 best practices.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Including all native tools in filtered set | Append critical tools AFTER filter | Phase 29 (for `search_knowledge` in brain-support), Phase 31 (for `respond` in both apps) | Misconfigured `BRAIN_TOOLS` can no longer silently degrade responses |
| Unquoted variables in shell + no validation | Quoted variables + explicit null checks | Phase 31 (CI workflows) | Failed API calls surface immediately with clear errors instead of confusing downstream curl failures |
| Hardcoded migration values with no inline docs | Inline comments documenting regeneration steps | Phase 31 | Future developers regenerating migrations won't lose TRUNCATE statements accidentally |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `drizzle-kit generate` preserves `--` single-line comments at the top of migration files (not verified tool-specific, based on ANSI SQL standard) | Common Pitfalls #4 | Comment might be stripped or moved during regeneration — low risk since comment is documentation-only, not executable |
| A2 | `jq` version 1.6+ pre-installed on GitHub Actions `ubuntu-latest` runners (stated in docs but not empirically verified in this research session) | Standard Stack | Workflow would fail immediately with "command not found" if missing — low risk, easily detected |
| A3 | brain-sdr does NOT need a full `RESERVED_TOOL_NAMES` collision guard for ALL native tools (qualify, pause_session, finish_conversation) as a side-effect of the `respond` fix — only `respond` needs append-after-filter protection per D-01 | User Constraints (Claude's Discretion) | If wrong: brain-sdr could have MCP-spoofing vulnerability for other native tools — marked as Claude's Discretion, planner decides scope |

## Open Questions

1. **Should brain-sdr get a full `RESERVED_TOOL_NAMES` MCP-collision guard like brain-support has?**
   - What we know: brain-support (Phase 29) has `RESERVED_TOOL_NAMES` set + MCP filter to prevent shadowing. brain-sdr currently has no such guard — MCP tools can theoretically shadow any native tool by name.
   - What's unclear: Is this a real risk for brain-sdr (which has `qualify_lead` as a critical native tool), or is it a theoretical concern? User marked this as "Claude's Discretion" in `31-CONTEXT.md`.
   - Recommendation: Planner should evaluate whether adding the guard is a small incremental change (copy 8 lines from brain-support) or opens a larger scope (test coverage, verification). If small, include in Phase 31. If large, defer to Phase 32 or a separate follow-up.

## Environment Availability

> Phase 31 has no external dependencies beyond what's already verified in the project (Bun 1.3.2 for tests, GitHub Actions standard tools for CI). This section documents what's confirmed available.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Test execution (`bun test`) | ✓ | 1.3.2 | — |
| jq | CI workflow JSON parsing | ✓ (assumed) | 1.6+ (GitHub Actions pre-installed) | — |
| curl | CI workflow API calls | ✓ (assumed) | 7.81+ (GitHub Actions pre-installed) | — |
| bash | CI workflow scripts | ✓ | 5.1+ (ubuntu-latest default) | — |

**Missing dependencies with no fallback:** None — all tools are either project-installed (Bun) or GitHub Actions runner built-ins (jq, curl, bash).

**Missing dependencies with fallback:** None applicable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, Jest-compatible API, Bun 1.3.2) |
| Config file | None — native Bun test runner, no config needed |
| Quick run command | `bun test <file>` |
| Full suite command | `bun test` (root) or `turbo run test` (monorepo-wide) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TECH-04 | CI workflows quote `$RESPONSE` and validate URL before use | manual (GitHub Actions execution) | N/A — CI-only, verify via workflow run logs | N/A — shell script validation |
| TECH-05 (respond) | `respond` tool appended after filter, not filterable by `BRAIN_TOOLS` | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts -x` | ✅ |
| TECH-05 (respond) | Same for `apps/brain-support` | unit | `bun test apps/brain-support/src/__tests__/unit/brain.test.ts -x` | ✅ |
| TECH-05 (.env) | `apps/brain-sdr/.env.example` documents `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | manual (grep verification) | `grep -E "EMBEDDING_(PROVIDER\|MODEL\|DIMENSIONS)" apps/brain-sdr/.env.example` | ❌ Wave 0 (file exists, missing lines) |
| TECH-05 (migration) | `0009_embedding_dimensions_fix.sql` has inline comment about hardcoded `vector(1536)` | manual (grep verification) | `grep -i "hardcoded\|1536\|OpenAI" packages/database/src/migrations/0009_embedding_dimensions_fix.sql` | ❌ Wave 0 (file exists, missing comment) |

### Sampling Rate
- **Per task commit:** `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts apps/brain-support/src/__tests__/unit/brain.test.ts` (unit tests for tool filtering)
- **Per wave merge:** Full suite via `turbo run test` (monorepo-wide, includes all packages + apps)
- **Phase gate:** Full suite green + manual grep verification of `.env.example` and migration comment before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] Expand existing `apps/brain-sdr/src/__tests__/unit/brain.test.ts` and `apps/brain-support/src/__tests__/unit/brain.test.ts` to cover `respond` tool append-after-filter behavior (test that `BRAIN_TOOLS` whitelist without `respond` still includes `respond` in final `bindTools()` call)
- [ ] No new test files needed — manual verification sufficient for `.env.example` and migration comment changes

**CI workflow validation:** No automated tests for shell script fixes (TECH-04) — validation happens via GitHub Actions execution logs when workflows run on tag push. Consider a dry-run test with a mock DockGate response returning `{"url": null}` to verify the validation logic triggers `exit 1`.

## Security Domain

> Phase 31 has security implications (CI shell hygiene prevents command injection via unquoted variables), but no changes to ASVS-relevant categories (auth, session, access control, input validation, crypto). This section documents applicability.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No changes to auth logic |
| V3 Session Management | no | No changes to session handling |
| V4 Access Control | no | No changes to access control |
| V5 Input Validation | yes (CI only) | Quote shell variables to prevent injection; validate API response shape |
| V6 Cryptography | no | No crypto changes |

### Known Threat Patterns for CI Shell Scripts

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via unquoted variables | Tampering | Quote all variables: `"$VAR"` instead of `$VAR` |
| Trusting API responses without validation | Information Disclosure (failed jobs leak sensitive data in logs) | Validate extracted values non-empty and non-null before use |
| Secrets in logs | Information Disclosure | Never `echo` secrets; GitHub Actions masks `secrets.*` automatically |

**Phase 31 mitigations:**
- **D-03:** Quote `$RESPONSE` prevents command injection if DockGate response contains shell metacharacters
- **D-04:** Validate `URL` is non-empty and non-null prevents `curl` from leaking internal URLs in error messages when DockGate API fails

## Sources

### Primary (HIGH confidence)
- `apps/brain-support/src/brain.ts` (lines 84-147) — reference implementation for append-after-filter pattern [VERIFIED: code read]
- `apps/brain-sdr/src/brain.ts` (lines 144-161) — current (unprotected) tool-filtering logic [VERIFIED: code read]
- `.github/workflows/publish-brain-support.yml` (lines 59-63) — unquoted `$RESPONSE` bug [VERIFIED: workflow file read]
- `.github/workflows/publish-brain-sdr.yml` (lines 59-63) — identical bug [VERIFIED: workflow file read]
- `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` — hardcoded `vector(1536)` [VERIFIED: migration file read]
- `apps/brain-support/.env.example` (lines 28-34) — embedding ENV documentation reference [VERIFIED: .env.example read]
- `.planning/phases/28-embedding-sdk/28-VERIFICATION.md` — EMBD-03 accepted override context [VERIFIED: verification report read]

### Secondary (MEDIUM confidence)
- [Bash Scripting Best Practices for Reliable Automation](https://oneuptime.com/blog/post/2026-02-13-bash-best-practices/view) — quote variables, validate before use (2026)
- [Curl Response Parsing Using jq: A Practical Guide](https://www.developnsolve.com/post/curl-response-parsing-using-jq) — `jq -r .field` returns "null" string for missing fields
- [Shell Script API Calls: Use curl in Scripts for Automation](https://www.commandinline.com/shell-script-api-calls/) — `curl -sf` for fail-fast HTTP errors
- [PostgreSQL Comments](https://www.techonthenet.com/postgresql/comments.php) — `--` single-line comment syntax (ANSI SQL standard)
- [Debugging Failed GitHub Actions Workflows](https://medium.com/@sharathkumarlokesh/debugging-failed-github-actions-workflows-like-a-pro-7fe656221226) — enable debug logging, check first error
- [How to Handle Step and Job Errors in GitHub Actions](https://www.kenmuse.com/blog/how-to-handle-step-and-job-errors-in-github-actions/) — `continue-on-error` and `steps.*.outcome`

### Tertiary (LOW confidence)
- LangGraph TypeScript tool calling patterns — general web search, no specific 2026 guidance on append-after-filter protection for reserved tools (this is a project-specific pattern, not a framework built-in)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Bun 1.3.2 verified, GitHub Actions tools (jq, curl, bash) are documented pre-installed
- Architecture: HIGH — Reference implementations exist in codebase for all three fix categories
- Pitfalls: HIGH — All four pitfalls are directly observable from current code or derived from official bash/jq documentation
- Security: MEDIUM — Shell injection risk is well-documented, but CI-specific threat modeling is general best practices (not Brain-specific verification)

**Research date:** 2026-07-01
**Valid until:** 2026-08-01 (30 days — stable tech debt closure, no fast-moving dependencies)
