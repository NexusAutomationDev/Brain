---
phase: 31-tech-debt-onboarding-hardening
verified: 2026-07-02T01:06:45Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 31: Pre-Client Onboarding Hardening — Verification Report

**Phase Goal:** Os itens de tech debt marcados pela auditoria v1.5 como "worth a follow-up before onboarding a real client" estão fechados

**Verified:** 2026-07-02T01:06:45Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CI workflows fail immediately with clear error message when DockGate returns invalid URL (empty or 'null') | ✓ VERIFIED | Both `publish-brain-sdr.yml` and `publish-brain-support.yml` contain `if [[ -z "$URL" \|\| "$URL" == "null" ]]; then` validation block with `echo "Raw DockGate response: $RESPONSE"` and `exit 1` |
| 2 | Respond tool cannot be excluded by BRAIN_TOOLS ENV in brain-sdr or brain-support | ✓ VERIFIED | Both apps implement append-after-filter pattern: `const filteredAllTools = [...filteredExceptSearchAndRespond, boundSearchKnowledgeTool, respondTool]`. Tests confirm respond present in bindTools even when enabledTools Set omits it. 28/28 tests pass. |
| 3 | Brain-sdr .env.example documents embedding ENVs matching brain-support's pattern | ✓ VERIFIED | `apps/brain-sdr/.env.example` contains `EMBEDDING_PROVIDER=openai`, `EMBEDDING_MODEL=text-embedding-3-small`, `EMBEDDING_DIMENSIONS=1536` with explanatory comments matching brain-support pattern |
| 4 | Migration 0009 warns developers about hardcoded vector(1536) before they regenerate | ✓ VERIFIED | `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` contains 4-line SQL comment at top documenting hardcoded 1536 dimensions, manual TRUNCATE re-add requirement, and reference to 28-VERIFICATION.md |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.github/workflows/publish-brain-sdr.yml` | Quoted $RESPONSE + URL validation in DockGate upload step | ✓ VERIFIED | Line 62: `URL=$(echo "$RESPONSE" \| jq -r .url)` (quoted). Lines 63-67: validation block with empty/null check, error message, raw response printing, exit 1 |
| `.github/workflows/publish-brain-support.yml` | Quoted $RESPONSE + URL validation in DockGate upload step | ✓ VERIFIED | Line 63: `URL=$(echo "$RESPONSE" \| jq -r .url)` (quoted). Lines 64-68: validation block matching brain-sdr |
| `apps/brain-sdr/src/brain.ts` | respondTool appended after enabledTools filter | ✓ VERIFIED | Lines 86-92: `RESERVED_TOOL_NAMES` constant. Lines 165-170: respondTool removed from nativeTools array. Lines 175-184: safeMcpTools filter. Line 191: append pattern `[...filteredExceptSearchAndRespond, boundSearchKnowledgeTool, respondTool]` |
| `apps/brain-support/src/brain.ts` | respondTool appended after enabledTools filter (already correct, verify only) | ✓ VERIFIED | Line 84: `RESERVED_TOOL_NAMES` exists. Line 147: append pattern verified. No code change needed — pattern already present from Phase 29 |
| `apps/brain-sdr/.env.example` | EMBEDDING_PROVIDER, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS documentation | ✓ VERIFIED | Contains all three ENVs with explanatory comments about fallback behavior and vector(N) matching requirement |
| `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` | Inline comment warning about hardcoded 1536 dimensions | ✓ VERIFIED | Lines 1-4: SQL comment using `--` syntax, documents hardcoded value, regeneration requirement, and verification override reference |
| `apps/brain-sdr/src/__tests__/unit/brain.test.ts` | Test for respond tool protection | ✓ VERIFIED | Line 220: `describe("BrainSDR — respond tool sempre ativa (TECH-05, D-01)")` test exists and passes |
| `apps/brain-support/src/__tests__/unit/brain.test.ts` | Test for respond tool protection | ✓ VERIFIED | Line 30: `describe("BrainSupport — respond tool sempre ativa (TECH-05, D-01)")` test exists and passes |

**Artifact Summary:** 8/8 artifacts verified (exist, substantive, wired)

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `.github/workflows/publish-brain-sdr.yml` | DockGate /apps/{app}/upload API | curl POST with validation | ✓ WIRED | Line 59-68: curl extracts URL, validation checks `[[ -z "$URL" \|\| "$URL" == "null" ]]`, prints raw response on failure, writes to GITHUB_OUTPUT only on success |
| `.github/workflows/publish-brain-support.yml` | DockGate /apps/{app}/upload API | curl POST with validation | ✓ WIRED | Line 60-69: identical validation pattern to brain-sdr |
| `apps/brain-sdr/src/brain.ts` | respondTool variable reference | direct append after filter | ✓ WIRED | Line 191: `[...filteredExceptSearchAndRespond, respondTool]` — respondTool variable used directly after filter, passed to bindTools on line 193 |
| `apps/brain-support/src/brain.ts` | respondTool variable reference | direct append after filter | ✓ WIRED | Line 147: identical pattern, respondTool appended after filter |
| `apps/brain-sdr/.env.example` | packages/embeddings createEmbeddingProvider() | ENV documentation matching brain-support's | ✓ WIRED | ENV names match createEmbeddingProvider() parameters in embeddings package. Comments document fallback behavior and dimension matching requirement |

**Link Summary:** 5/5 key links verified

### Data-Flow Trace (Level 4)

Level 4 verification not applicable — this phase modified CI workflows, tool wiring logic, and documentation. No dynamic data rendering components introduced.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Brain-sdr contains RESERVED_TOOL_NAMES and append pattern | node -e verification script | `{"hasReserved":true,"hasAppend":true}` | ✓ PASS |
| Unit tests for respond tool protection pass | `bun test apps/brain-{sdr,support}/src/__tests__/unit/brain.test.ts` | 28 pass / 0 fail | ✓ PASS |

**Spot-check Summary:** 2/2 checks passed

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TECH-04 | 31-01-PLAN.md | Workflows de CI (`publish-brain-sdr.yml`, `publish-brain-support.yml`) fazem quote de `$RESPONSE` e `exit 1` se `jq -r .url` retornar vazio/nulo | ✓ SATISFIED | Both workflow files contain quoted `echo "$RESPONSE" \| jq -r .url` and validation block `if [[ -z "$URL" \|\| "$URL" == "null" ]]` with error message and exit 1. Truth #1 verified. |
| TECH-05 | 31-01-PLAN.md | Tool `respond` tem proteção de append-after-filter equivalente a `search_knowledge`; `.env.example` do brain-sdr documenta ENVs de embedding; migration 0009 tem aviso inline sobre `vector(1536)` hardcoded | ✓ SATISFIED | All three components verified: (1) respond tool append-after-filter in both apps with RESERVED_TOOL_NAMES guard and tests (Truth #2), (2) brain-sdr .env.example embedding ENVs (Truth #3), (3) migration 0009 inline comment (Truth #4) |

**Requirements Summary:** 2/2 requirements satisfied

### Anti-Patterns Found

No anti-patterns detected. Scan checked for TODO/FIXME/PLACEHOLDER comments, empty implementations, hardcoded empty data — all modified files clean.

### Human Verification Required

None. All must-haves are programmatically verifiable through code inspection and automated tests.

---

## Verification Summary

**All must-haves verified.** Phase 31 goal achieved.

### What Was Verified

1. **CI Shell Hygiene (TECH-04):** Both `publish-brain-sdr.yml` and `publish-brain-support.yml` quote `$RESPONSE` variable to prevent shell word-splitting and validate extracted URL is non-empty and not literal "null" string before use. Validation block prints raw DockGate response and exits with code 1 on failure, ensuring clear error messages instead of confusing downstream curl failures.

2. **Respond Tool Protection (TECH-05 — part 1):** Both `apps/brain-sdr/src/brain.ts` and `apps/brain-support/src/brain.ts` implement append-after-filter pattern for `respondTool`. Tool removed from `nativeTools` array and appended AFTER `enabledTools` filter via direct variable reference, matching existing `search_knowledge` protection. `RESERVED_TOOL_NAMES` constant documents all structurally-protected tools. MCP collision guard prevents MCP tools from shadowing reserved native tools. Tests confirm respond tool present in bindTools even when `enabledTools` Set omits it — operator misconfiguration cannot silently degrade responses.

3. **Documentation Gaps (TECH-05 — part 2):** `apps/brain-sdr/.env.example` documents `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, and `EMBEDDING_DIMENSIONS` ENVs with explanatory comments matching `apps/brain-support/.env.example` pattern. Comments explain fallback behavior to `LLM_PROVIDER` and requirement to match `vector(N)` column in migration 0009.

4. **Migration Warning (TECH-05 — part 3):** `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` contains 4-line SQL inline comment at top (using `--` syntax) documenting hardcoded `vector(1536)` dimensions for OpenAI text-embedding-3-small, manual TRUNCATE re-add requirement when regenerating for different dimensions, and reference to 28-VERIFICATION.md for accepted override rationale.

### Test Results

- **Unit tests:** 28 pass / 0 fail
- **New tests added:** 2 (respond tool protection test in brain-sdr and brain-support)
- **Behavioral spot-checks:** 2/2 passed
- **No regressions:** All existing tests still pass

### Code Quality

- **Anti-patterns:** None found
- **TODOs/FIXMEs:** None found
- **Stub implementations:** None found
- **Shell hygiene:** Fixed (quoted variables, validated API responses)
- **Tool wiring:** Robust (structural protection from misconfiguration)

### Deviations

None. Plan executed exactly as specified. All tasks completed successfully without scope modifications.

---

_Verified: 2026-07-02T01:06:45Z_
_Verifier: Claude (gsd-verifier)_
