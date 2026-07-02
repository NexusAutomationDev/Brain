---
phase: 31-tech-debt-onboarding-hardening
plan: 01
subsystem: ci-infra, brain-sdr, brain-support, database
tags: [tech-debt, shell-hygiene, tool-protection, documentation]
dependency_graph:
  requires: []
  provides: [TECH-04, TECH-05]
  affects: [ci-workflows, tool-filtering, env-documentation]
tech_stack:
  added: []
  patterns: [append-after-filter, shell-quoting, sql-inline-comments]
key_files:
  created: []
  modified:
    - .github/workflows/publish-brain-sdr.yml
    - .github/workflows/publish-brain-support.yml
    - apps/brain-sdr/src/brain.ts
    - apps/brain-support/src/brain.ts
    - apps/brain-sdr/src/__tests__/unit/brain.test.ts
    - apps/brain-support/src/__tests__/unit/brain.test.ts
    - apps/brain-sdr/.env.example
    - packages/database/src/migrations/0009_embedding_dimensions_fix.sql
decisions:
  - "D-03: Quote $RESPONSE in CI workflows to prevent shell word-splitting if DockGate returns error messages with spaces"
  - "D-04: Validate extracted URL is non-empty and not literal 'null' string before use — print raw response and exit 1 on validation failure"
  - "D-01: Append respondTool AFTER enabledTools filter in both brain-sdr and brain-support — structural protection from BRAIN_TOOLS misconfiguration"
  - "D-05: Add SQL inline comment to migration 0009 documenting hardcoded vector(1536) and manual TRUNCATE re-add requirement"
  - "D-06: Document EMBEDDING_PROVIDER/MODEL/DIMENSIONS in brain-sdr .env.example mirroring brain-support's pattern"
metrics:
  duration_seconds: 261
  tasks_completed: 3
  files_modified: 8
  tests_added: 2
  tests_passing: 28
  commits: 4
  completed_date: "2026-07-01T23:10:32Z"
---

# Phase 31 Plan 01: Tech Debt Closure - CI Shell Hygiene, Respond Tool Protection, Documentation Gaps

**One-liner:** Quote shell variables in CI workflows, protect `respond` tool from BRAIN_TOOLS exclusion via append-after-filter, document embedding ENVs in brain-sdr .env.example, and add migration inline warning about hardcoded vector dimensions.

## What Was Built

Closed 4 actionable tech-debt items from v1.5 milestone audit before client onboarding:

1. **CI Shell Hygiene (TECH-04):** Both `publish-brain-sdr.yml` and `publish-brain-support.yml` now quote `$RESPONSE` in jq pipes and validate extracted URL is non-empty/non-null before use. Failed DockGate API calls surface immediately with clear error messages instead of confusing downstream curl failures.

2. **Respond Tool Protection (TECH-05):** `respond` tool structurally protected from BRAIN_TOOLS misconfiguration in both brain-sdr and brain-support via append-after-filter pattern. Tool removed from `nativeTools` array and appended AFTER `enabledTools` filter via direct variable reference, mirroring existing `search_knowledge` protection in brain-support. Added `RESERVED_TOOL_NAMES` constant + MCP collision guard to brain-sdr (matching brain-support's WR-01 fix).

3. **Documentation Gaps (TECH-05):** Brain-sdr `.env.example` now documents `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` matching brain-support's pattern. Migration `0009_embedding_dimensions_fix.sql` has inline SQL comment warning developers about hardcoded `vector(1536)` and manual TRUNCATE re-add requirement when regenerating for different dimensions.

## Implementation Notes

### Task 1: CI Shell Hygiene

Applied identical fix to both workflow files (brain-sdr and brain-support were copied during Phase 30, both had same bug):

- Changed `echo $RESPONSE | jq -r .url` to `URL=$(echo "$RESPONSE" | jq -r .url)` — quotes prevent shell word-splitting if DockGate returns error message with spaces
- Added validation block: `if [[ -z "$URL" || "$URL" == "null" ]]; then echo "ERROR: DockGate upload URL request returned invalid response"; echo "Raw DockGate response: $RESPONSE"; exit 1; fi`
- Moved `echo "URL=$URL" >> $GITHUB_OUTPUT` AFTER validation passes

**Why:** `jq -r .url` returns literal 4-character string "null" (not empty) when field is missing. Bash test `[[ -z "$URL" ]]` passes when `URL="null"`, allowing broken URL to propagate to curl step with "Could not resolve host: null" error instead of failing at API step with clear message.

### Task 2: Respond Tool Protection (TDD)

Followed TDD workflow per plan requirement:

**RED phase (commit 2b53317):** Added failing test to both brain-sdr and brain-support verifying `respond` tool is present in bindTools even when `enabledTools` Set omits it. Both tests failed initially (respond was in `nativeTools` array and got filtered).

**GREEN phase (commit 7d306ce):** Implemented fix in both apps:

1. Added `RESERVED_TOOL_NAMES` constant to brain-sdr (brain-support already had it from Phase 29)
2. Removed `respondTool` from `nativeTools` array in both apps
3. Added `safeMcpTools` filter to drop MCP tools whose names collide with reserved native tools (WR-01/TECH-05)
4. Renamed variables: `allToolsExceptSearch` → `allToolsExceptSearchAndRespond`, `filteredExceptSearch` → `filteredExceptSearchAndRespond`
5. Appended both `boundSearchKnowledgeTool` and `respondTool` AFTER filter: `const filteredAllTools = [...filteredExceptSearchAndRespond, boundSearchKnowledgeTool, respondTool]`

**Result:** Both tests pass. Operator setting `BRAIN_TOOLS=qualify_lead,pause_session` (accidentally omitting `respond`) no longer silently degrades every response to fallback mode. LLM always sees `respond` in bindTools, can call it, routing works correctly.

**Pattern validation:** Brain-support already had `search_knowledge` append-after-filter protection (Phase 29, D-04/SUP-02). This task extended same pattern to `respond` in both apps. `RESERVED_TOOL_NAMES` set now documents all structurally-protected tools.

### Task 3: Documentation Updates

**Brain-sdr .env.example (D-06):** Inserted embedding ENV block after `LLM_MODEL` line, before `# --- Transport ---` section. Mirrored brain-support's pattern exactly (lines 26-34 from brain-support) but removed `(SUP-04)` reference since brain-sdr doesn't use that requirement ID. Documentation explains fallback to `LLM_PROVIDER` when `EMBEDDING_PROVIDER` absent, requirement to match `vector(N)` column in migration 0009, and warning that changing dimensions requires re-running migration.

**Migration 0009 inline comment (D-05):** Added 4-line SQL comment at top of file (before TRUNCATE statement):
```sql
-- EMBEDDING_DIMENSIONS hardcoded to 1536 (OpenAI text-embedding-3-small default).
-- Regenerating this migration for a different dimension (e.g., Gemini's 3072) requires
-- manually re-adding the TRUNCATE statements below — drizzle-kit generate will omit them.
-- See .planning/phases/28-embedding-sdk/28-VERIFICATION.md for accepted override rationale (EMBD-03).
```

Used `--` single-line comment syntax (ANSI SQL standard) not `/* */` block comments (PostgreSQL extension, may not be preserved by drizzle-kit). Comment concise (1-3 lines per D-05) — just enough to stop future developer from being surprised when regenerating migration for different dimensions.

## Deviations from Plan

None — plan executed exactly as written. All tasks completed successfully without modifications to scope or approach.

## Verification Results

**Automated tests:**
- `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts apps/brain-support/src/__tests__/unit/brain.test.ts` → 28 pass / 0 fail
- New tests: "respond tool sempre ativa (TECH-05, D-01)" in both brain-sdr and brain-support
- Existing tests: All 26 other tests still pass (no regressions)

**Manual verification (grep patterns from plan):**
```bash
# CI workflow fixes
grep -E 'echo "\$RESPONSE".*jq' .github/workflows/publish-brain-sdr.yml .github/workflows/publish-brain-support.yml
# ✓ Both contain: URL=$(echo "$RESPONSE" | jq -r .url)

grep -E 'if.*-z.*URL.*null' .github/workflows/publish-brain-sdr.yml .github/workflows/publish-brain-support.yml
# ✓ Both contain: if [[ -z "$URL" || "$URL" == "null" ]]; then

# Respond tool protection
grep 'RESERVED_TOOL_NAMES' apps/brain-sdr/src/brain.ts
# ✓ Contains: const RESERVED_TOOL_NAMES = new Set([

grep 'filteredAllTools.*respondTool' apps/brain-sdr/src/brain.ts
# ✓ Contains: const filteredAllTools = [...filteredExceptSearchAndRespond, boundSearchKnowledgeTool, respondTool];

# Documentation gaps
grep 'EMBEDDING_PROVIDER=' apps/brain-sdr/.env.example
# ✓ Contains: EMBEDDING_PROVIDER=openai

grep -i 'EMBEDDING_DIMENSIONS hardcoded' packages/database/src/migrations/0009_embedding_dimensions_fix.sql
# ✓ Contains: -- EMBEDDING_DIMENSIONS hardcoded to 1536 (OpenAI text-embedding-3-small default).
```

**Success criteria satisfied:**
- [x] Both CI workflow files quote `$RESPONSE` in jq pipe and validate URL before use (TECH-04)
- [x] Respond tool protected from BRAIN_TOOLS exclusion in brain-sdr via append-after-filter (TECH-05)
- [x] Brain-support respond protection verified working (no code change needed — fixed during GREEN phase)
- [x] Brain-sdr .env.example documents EMBEDDING_PROVIDER/MODEL/DIMENSIONS matching brain-support (TECH-05)
- [x] Migration 0009 has inline SQL comment warning about hardcoded vector(1536) (TECH-05)
- [x] All unit tests pass (bun test exits 0)
- [x] Verification greps confirm all expected patterns present

## Known Issues / Limitations

None discovered. All tech debt items closed cleanly.

## Next Steps

No follow-up work needed for Phase 31 Plan 01. All actionable tech debt from v1.5 milestone audit marked "worth a follow-up before onboarding a real client" has been resolved.

Remaining warning/info-level tech debt items (WR-02/03, IN-01/02/03 across phases 27-30, SUMMARY frontmatter backfill, test ordering/isolation issues) are explicitly out of scope for Phase 31 per user constraint (assigned to Phase 32: Code Quality Cleanup in gap-closure plan).

## Commits

| Hash    | Type | Description |
|---------|------|-------------|
| ac75c66 | fix  | Quote shell variables and validate DockGate URL in CI workflows |
| 2b53317 | test | Add failing test for respond tool protection (TDD RED phase) |
| 7d306ce | fix  | Protect respond tool from BRAIN_TOOLS misconfiguration (TDD GREEN phase) |
| 385f5eb | docs | Document embedding ENVs and migration warning |

## Self-Check: PASSED

**Files created (expected: 0):** NONE — all changes were modifications to existing files ✓

**Files modified (expected: 8):**
- [x] `.github/workflows/publish-brain-sdr.yml` exists and contains quoted `$RESPONSE` + URL validation
- [x] `.github/workflows/publish-brain-support.yml` exists and contains quoted `$RESPONSE` + URL validation
- [x] `apps/brain-sdr/src/brain.ts` exists and contains `RESERVED_TOOL_NAMES` + append-after-filter
- [x] `apps/brain-support/src/brain.ts` exists and contains updated append-after-filter for respond
- [x] `apps/brain-sdr/src/__tests__/unit/brain.test.ts` exists and contains new respond test
- [x] `apps/brain-support/src/__tests__/unit/brain.test.ts` exists and contains new respond test
- [x] `apps/brain-sdr/.env.example` exists and contains EMBEDDING_PROVIDER/MODEL/DIMENSIONS
- [x] `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` exists and contains inline comment

**Commits (expected: 4):**
```bash
$ git log --oneline --all | grep -E "(ac75c66|2b53317|7d306ce|385f5eb)"
385f5eb docs(31-01): document embedding ENVs and migration warning
7d306ce fix(31-01): protect respond tool from BRAIN_TOOLS misconfiguration
2b53317 test(31-01): add failing test for respond tool protection
ac75c66 fix(ci): quote shell variables and validate DockGate URL
```
✓ All 4 commits exist

**Tests (expected: 28 pass):**
```bash
$ bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts apps/brain-support/src/__tests__/unit/brain.test.ts
28 pass / 0 fail
```
✓ All tests passing

**Self-check result:** PASSED — All claimed artifacts exist, all tests pass, no missing items.
