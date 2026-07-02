---
phase: 31-tech-debt-onboarding-hardening
reviewed: 2026-07-01T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - .github/workflows/publish-brain-sdr.yml
  - .github/workflows/publish-brain-support.yml
  - apps/brain-sdr/.env.example
  - apps/brain-sdr/src/__tests__/unit/brain.test.ts
  - apps/brain-sdr/src/brain.ts
  - apps/brain-support/src/__tests__/unit/brain.test.ts
  - apps/brain-support/src/brain.ts
  - packages/database/src/migrations/0009_embedding_dimensions_fix.sql
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 31: Code Review Report

**Reviewed:** 2026-07-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed 8 files across CI workflows, environment configuration, Brain implementations, test suites, and a database migration. The codebase shows good overall quality with strong security practices (fail-closed defaults, proper token validation). However, several warnings were identified related to error handling, shell script robustness, and code maintainability. No critical security vulnerabilities or data loss risks were found.

Key concerns:
- Missing error handling for critical external service calls (DockGate API) in CI workflows
- Potential shell script failures due to unquoted variables in CI workflows
- Dead/unreachable code in test files that could cause confusion
- Hardcoded embedding dimensions in migration without runtime validation

## Warnings

### WR-01: Missing error handling for DockGate upload URL request

**File:** `.github/workflows/publish-brain-sdr.yml:53-68`
**Issue:** The curl command uses `-sf` flags which silently fail on HTTP errors (4xx/5xx), but the subsequent `jq` parsing and validation only checks for null URL, not for complete curl failure. If DockGate returns a 500 error with no body, or if the network request times out, the RESPONSE variable will be empty, and the error message will be misleading ("invalid response" instead of "request failed").

**Fix:**
```yaml
- name: Request upload URL from DockGate
  id: upload_url
  env:
    DOCKGATE_URL: ${{ secrets.DOCKGATE_URL }}
    DOCKGATE_UPLOAD_TOKEN: ${{ secrets.DOCKGATE_UPLOAD_TOKEN }}
  run: |
    HTTP_CODE=$(curl -s -o /tmp/response.json -w "%{http_code}" -X POST \
      -H "Authorization: Bearer $DOCKGATE_UPLOAD_TOKEN" \
      "$DOCKGATE_URL/apps/$APP_NAME/upload?version=${{ steps.version.outputs.VERSION }}")

    if [[ "$HTTP_CODE" != "200" ]]; then
      echo "ERROR: DockGate API returned HTTP $HTTP_CODE"
      cat /tmp/response.json
      exit 1
    fi

    URL=$(jq -r .url /tmp/response.json)
    if [[ -z "$URL" || "$URL" == "null" ]]; then
      echo "ERROR: DockGate upload URL missing in response"
      cat /tmp/response.json
      exit 1
    fi
    echo "URL=$URL" >> $GITHUB_OUTPUT
```

**Applies to:** Both `.github/workflows/publish-brain-sdr.yml:53-68` and `.github/workflows/publish-brain-support.yml:54-69`

---

### WR-02: Shell variable not quoted in GitHub Actions workflow

**File:** `.github/workflows/publish-brain-sdr.yml:45`
**Issue:** The environment variable `$IMAGE_NAME` is used unquoted in a shell command. If `IMAGE_NAME` contains spaces or special characters (unlikely but possible via malicious tag injection), this could cause command injection or unexpected behavior. GitHub Actions are generally safe from this, but defense-in-depth requires quoting all variable expansions.

**Fix:**
```yaml
- name: Export image to tar
  run: docker save "$IMAGE_NAME:${{ steps.version.outputs.VERSION }}" -o image.tar
```

**Applies to:** Both `.github/workflows/publish-brain-sdr.yml:45` and `.github/workflows/publish-brain-support.yml:45`

---

### WR-03: Test contains unreachable code after dynamic import

**File:** `apps/brain-sdr/src/__tests__/unit/brain.test.ts:83-118`
**Issue:** The test at lines 83-107 ("buildGraph(ctx) com ctx.sql mock chama bindTools com 5 tools") re-imports the module with `await import("../../brain.js")` claiming it's to "garantir estado limpo", but Bun test runner already isolates module state between test files. More critically, the test at lines 109-118 duplicates the exact same assertion as line 20-26, making it dead code that adds no test value.

The comment at line 84 ("Re-importar para garantir estado limpo (Bun test pode cachear módulos)") is misleading — Bun test does cache modules within a single test file run (that's the point of module caching), and the re-import doesn't actually clear the cache. Tests should be designed to be order-independent without relying on module cache clearing.

**Fix:**
Remove the duplicate test at lines 109-118 (it's identical to lines 20-26). If module state isolation is genuinely needed, use `beforeEach` with explicit state reset rather than misleading re-imports:

```typescript
// Remove lines 109-118 entirely — they duplicate lines 20-26

// If actual module state reset is needed (unlikely for this Brain), use:
beforeEach(() => {
  // Reset module-level state if any exists
  // (Currently none in brain.ts, so this is not needed)
});
```

## Info

### IN-01: Hardcoded embedding dimensions in migration without ENV validation

**File:** `packages/database/src/migrations/0009_embedding_dimensions_fix.sql:1-9`
**Issue:** The migration hardcodes `vector(1536)` to match OpenAI's `text-embedding-3-small`, but the `.env.example` files set `EMBEDDING_DIMENSIONS=1536` as a configurable value. If an operator changes `EMBEDDING_DIMENSIONS` to 3072 (for Gemini) without re-generating this migration, the Brain will fail at runtime with dimension mismatch errors. The comment acknowledges this but provides no automated safeguard.

**Recommendation:** Add a runtime check in the Brain startup code (in `BrainRunner.init()` or `createEmbeddingProvider()`) to validate that `process.env.EMBEDDING_DIMENSIONS` matches the actual vector column dimension in the database. This can be done with a simple query:

```typescript
// In BrainRunner.init() or migration runner, after CREATE EXTENSION vector
const result = await sql`
  SELECT atttypmod
  FROM pg_attribute
  WHERE attrelid = 'knowledge_chunks'::regclass
  AND attname = 'embedding'
`;
const dbDimensions = result[0]?.atttypmod - 4; // pgvector stores as typmod + 4
const envDimensions = parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1536", 10);
if (dbDimensions !== envDimensions) {
  logger.error({ dbDimensions, envDimensions },
    "EMBEDDING_DIMENSIONS mismatch — regenerate migration 0009 with correct dimension");
  process.exit(1);
}
```

---

### IN-02: .env.example contains placeholder tokens that should be regenerated

**File:** `apps/brain-sdr/.env.example:9,36,41,72`
**Issue:** Several sensitive tokens use `change-me-in-production` as placeholder values (lines 9, 36, 41, 72). While this is acceptable for a `.env.example` file, the comments don't emphasize strongly enough that these values should NEVER be committed in a real `.env` file. Additionally, the file doesn't warn about the risk of accidentally committing `.env` if `.gitignore` is misconfigured.

**Recommendation:** Add a prominent header comment to `.env.example`:

```bash
# =============================================================================
# ⚠️  SECURITY WARNING — READ BEFORE COPYING
# =============================================================================
# 1. Copy this file to .env: cp .env.example .env
# 2. Replace ALL "change-me-in-production" placeholders with secure random tokens
#    Generate tokens with: openssl rand -hex 32
# 3. NEVER commit .env to version control — verify .gitignore includes .env
# 4. Rotate tokens immediately if accidentally exposed in git history
# =============================================================================
```

---

### IN-03: Test mocks don't validate tool schema structure

**File:** `apps/brain-sdr/src/__tests__/unit/brain.test.ts:156-185`, `apps/brain-support/src/__tests__/unit/brain.test.ts:98-151`
**Issue:** The MCP collision tests (e.g., lines 156-185 in brain-sdr) create mock tools with `tool()` helper but don't validate that the actual tool schemas in `boundQualifyTool`, `boundSearchKnowledgeTool`, etc. match their expected structures. If someone refactors `createSearchKnowledgeTool()` to change the schema shape, these tests would still pass but the LLM integration would break at runtime.

**Recommendation:** Add schema validation assertions to verify tool structure:

```typescript
test("boundSearchKnowledgeTool has correct schema shape", async () => {
  const mod = await import("../../brain.js");
  const ctx = { /* minimal mock context */ };
  const graph = mod.sdrBrain.buildGraph(ctx as any);

  // Extract boundSearchKnowledgeTool from bindTools call
  const bindToolsCall = (bindToolsMock as any).mock.calls[0][0];
  const searchTool = bindToolsCall.find((t: any) => t.name === "search_knowledge");

  expect(searchTool.schema.shape).toHaveProperty("query");
  expect(searchTool.schema.shape).toHaveProperty("collections");
  expect(searchTool.schema.shape.collections._def.type._def.typeName).toBe("ZodArray");
});
```

This would catch schema regressions before they reach production.

---

_Reviewed: 2026-07-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
