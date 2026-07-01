# Phase 31: Commit Staged Fix + Pre-Client Onboarding Hardening - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the remaining actionable tech-debt items from the v1.5 milestone audit (`.planning/v1.5-MILESTONE-AUDIT.md`) that the audit marked as "worth a follow-up before onboarding a real client": the `respond` tool's missing misconfiguration guard, CI shell-hygiene bugs in the DockGate publish workflows, and two documentation gaps (`.env.example`, migration inline warning).

**Scope correction (found during codebase scouting, before discussion):** The `apps/brain-support/docker-compose.yml` port fix (3002→3003) that the audit reported as "staged but not committed" was **already committed** in `3abf253` — before the audit report itself was committed (`9768107`). This item is stale and is REMOVED from Phase 31's scope. The planner should not create a task for it; ROADMAP.md's Phase 31 success criteria should drop this item.

</domain>

<decisions>
## Implementation Decisions

### respond tool protection (apps/brain-sdr/src/brain.ts, apps/brain-support/src/brain.ts)
- **D-01:** Mirror the existing `search_knowledge` pattern exactly. Move `respondTool` out of `nativeTools`/the enabledTools-filtered set and append it AFTER the `ctx.enabledTools` filter runs, by direct variable reference (not name lookup) — same technique already used for `boundSearchKnowledgeTool` in `apps/brain-support/src/brain.ts` (see `filteredExceptSearch` → `filteredAllTools` pattern there). `BRAIN_TOOLS` must become structurally incapable of excluding `respond`, in both `apps/brain-sdr/src/brain.ts` and `apps/brain-support/src/brain.ts`.
- Apply the identical fix to both apps — this is the same class of bug in both, not brain-support-specific.
- No change to `pause_session`, `finish_conversation`, or MCP-loaded tools — those remain correctly filterable by `BRAIN_TOOLS`.

### CI shell hygiene (.github/workflows/publish-brain-support.yml, .github/workflows/publish-brain-sdr.yml)
- **D-02:** Fix BOTH workflow files in this phase, not just the one the audit flagged (`publish-brain-support.yml`) — `publish-brain-sdr.yml` is the original file brain-support's was copied from and has the identical bug (unquoted `$RESPONSE` in the `jq` pipe, no validation before use).
- **D-03:** Quote `$RESPONSE` in the `echo $RESPONSE | jq -r .url` line.
- **D-04:** After extracting `URL`, validate it's non-empty and not the literal string `"null"`. If invalid: print the raw DockGate response for debugging and `exit 1` — hard-fail the job rather than letting the pipeline continue with a broken URL that fails later with a confusing curl error.

### Migration inline warning (packages/database/src/migrations/0009_embedding_dimensions_fix.sql)
- **D-05:** Add a short (1-2 line) SQL comment at the top of the file: the hardcoded `vector(1536)` is OpenAI-specific, and regenerating this migration for a different `EMBEDDING_DIMENSIONS` requires manually re-adding the `TRUNCATE` statement. Point to `.planning/phases/28-embedding-sdk/28-VERIFICATION.md` for the full accepted-override rationale. Not a full checklist — just enough to stop a future developer from being surprised.

### .env.example (apps/brain-sdr/.env.example)
- **D-06:** Add `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` documentation, mirroring what already exists in `apps/brain-support/.env.example` (lines 28-34: comment explaining fallback to `LLM_PROVIDER` when `EMBEDDING_PROVIDER` is absent, then the three ENV var lines with `openai` / `text-embedding-3-small` / `1536` as example values).

### Claude's Discretion
- Exact wording/formatting of the CI failure error message.
- Whether the `respond`-append fix in `apps/brain-sdr/src/brain.ts` needs a `RESERVED_TOOL_NAMES`-style MCP-collision guard like brain-support already has (brain-sdr currently has no MCP-collision guard at all for any native tool) — planner/researcher should check current brain-sdr code and decide if this is in-scope or a separate concern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tech debt source
- `.planning/v1.5-MILESTONE-AUDIT.md` — full tech_debt block this phase closes (WR-01 for phase 29 = respond tool; integration finding + tech debt highlights for CI/docs items)

### Reference implementation for the respond-tool fix
- `apps/brain-support/src/brain.ts` (lines 84-147) — existing `RESERVED_TOOL_NAMES` set + `filteredExceptSearch` → append-after-filter pattern for `search_knowledge` that `respond` must mirror
- `apps/brain-sdr/src/brain.ts` (lines 144-161) — current (unprotected) tool-filtering logic that needs the same fix

### Accepted override this phase must not reopen
- `.planning/phases/28-embedding-sdk/28-VERIFICATION.md` — EMBD-03 accepted override (hardcoded `vector(1536)`, manual TRUNCATE) that the migration comment (D-05) documents but does not change

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/brain-support/src/brain.ts`'s `RESERVED_TOOL_NAMES` + append-after-filter pattern for `search_knowledge` — directly reusable as the template for the `respond` fix in both apps

### Established Patterns
- Native tools are built as closures over `ctx.sql`/`ctx.llm` inside `buildGraph()`, then filtered by `ctx.enabledTools` (from `BRAIN_TOOLS` ENV) before `bindTools()`/`ToolNode` — established since Phase 27 (TECH-01)
- CI publish workflows (`publish-brain-sdr.yml`, `publish-brain-support.yml`) follow an identical structure: build → export tar → checksum → request upload URL from DockGate → upload to MinIO → publish version. Fixes to one should be mirrored in the other.

### Integration Points
- `apps/brain-sdr/src/brain.ts` and `apps/brain-support/src/brain.ts` — both need the respond-tool fix independently (no shared code to change once, since tool-filtering logic is per-Brain per project architecture)
- `.github/workflows/publish-brain-sdr.yml` and `publish-brain-support.yml` — independent CI files, both need the jq fix

</code_context>

<specifics>
## Specific Ideas

No additional specifics beyond the decisions above — this is a well-scoped bug-fix/hardening phase with concrete, previously-identified defects from the audit.

</specifics>

<deferred>
## Deferred Ideas

- Whether `apps/brain-sdr` should get a `RESERVED_TOOL_NAMES`-style MCP-collision guard for ALL native tools (not just as a side-effect of the respond fix) — noted as Claude's Discretion above, may become its own follow-up if it turns out to be a bigger change than expected
- All remaining warning/info-level tech debt items (WR-02/03, IN-01/02/03 across phases 27-30, SUMMARY frontmatter backfill, test ordering/isolation issues) — explicitly out of scope for Phase 31, assigned to Phase 32 (Code Quality Cleanup) per the gap-closure plan

### Reviewed Todos (not folded)
None — no pending todos matched this phase (`todo match-phase 31` returned 0 matches).

</deferred>

---

*Phase: 31-tech-debt-onboarding-hardening*
*Context gathered: 2026-07-01*
