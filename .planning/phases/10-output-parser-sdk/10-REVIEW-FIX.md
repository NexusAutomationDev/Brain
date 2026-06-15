---
phase: 10-output-parser-sdk
fixed_at: 2026-06-15T05:10:00Z
review_path: .planning/phases/10-output-parser-sdk/10-REVIEW.md
iteration: 1
fix_scope: critical_warning
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-06-15T05:10:00Z
**Source review:** .planning/phases/10-output-parser-sdk/10-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: Remove dead `contextWindowSize` IIFE from `runner.ts`

**Files modified:** `packages/core/src/runner/runner.ts`
**Commit:** `01b45cd`
**Applied fix:** Removed the IIFE that parsed `CONTEXT_WINDOW_MESSAGES` ENV and computed `contextWindowSize`, along with the `contextWindow` and `willTruncate` fields from the debug log. Replaced with a simpler `logger.debug` call that only logs `historicalCount`. Added comment clarifying that slicing is performed inside the graph node.

---

### WR-02: Differentiate `BrainOutputValidationError` in `handler.ts`

**Files modified:** `packages/transport/src/webhook/handler.ts`
**Commit:** `1c64acd`
**Applied fix:** Added `BrainOutputValidationError` to the import from `@brain-pkg/shared`. Inside the runner catch block, added an `instanceof` check for `BrainOutputValidationError` that logs a specific contract violation message and returns `502 Bad Gateway` instead of the generic `500 Internal error` path.

---

### WR-03: Strengthen D-14 test assertions with specific error class

**Files modified:** `packages/core/src/runner/__tests__/brain-runner.test.ts`
**Commit:** `520f6ea`
**Applied fix:** Changed both `.rejects.toThrow()` calls (lines 387 and 406) to `.rejects.toThrow("BrainOutput")`. Used string-based assertion instead of class import to avoid the zod v4 "cached value already set" panic in bun 1.3.2 documented in the test file header. Added inline comment explaining the string-check rationale.

---

_Fixed: 2026-06-15T05:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
