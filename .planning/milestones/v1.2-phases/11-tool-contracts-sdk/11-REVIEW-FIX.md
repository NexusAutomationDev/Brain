---
phase: 11-tool-contracts-sdk
fixed_at: 2026-06-15T00:00:00Z
review_path: .planning/phases/11-tool-contracts-sdk/11-REVIEW.md
iteration: 1
fix_scope: critical_warning
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-06-15
**Source review:** `.planning/phases/11-tool-contracts-sdk/11-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: BRAIN_TOOLS filtering all tools for a brainType causes ConfigurationError instead of returning []

**Files modified:** `packages/core/src/tools/registry.ts`
**Commit:** `97ca3ec`
**Applied fix:** Moved the `if (!this.registry.has(brainType))` registration block to the top of `enableTool()`, before the env whitelist check. The brainType entry is now always created regardless of whether the tool passes the filter, so `getTools()` returns `[]` instead of throwing `ConfigurationError` when all tools for a brainType are filtered out.

### WR-02: `BRAIN_TOOLS=""` (empty string) silently blocks all tools

**Files modified:** `packages/core/src/tools/registry.ts`
**Commit:** `97ca3ec`
**Applied fix:** Added `.filter(Boolean)` after `.map(s => s.trim())` to remove empty strings from the parsed CSV. Added `parsed.length > 0` guard so that `BRAIN_TOOLS=""` (which produces an empty array after filtering) is treated as `null` (no filter), consistent with documented TOOLS-ENV-02 behavior.

### WR-03: `BRAIN_TOOLS` env var re-read on every `enableTool()` call — inconsistency risk

**Files modified:** `packages/core/src/tools/registry.ts`
**Commit:** `97ca3ec`
**Applied fix:** Extracted env var parsing into the class constructor. Added `private readonly envWhitelist: Set<string> | null` field — `null` when BRAIN_TOOLS is unset or empty (no filter), `Set<string>` otherwise. `enableTool()` now uses `this.envWhitelist` instead of re-reading `process.env.BRAIN_TOOLS` on each call. Also changed `private registry` to `private readonly registry` since the Map reference is never reassigned.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-06-15_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
