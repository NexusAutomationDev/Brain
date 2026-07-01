# Deferred Items — Phase 28 Embedding SDK

## Plan 28-04

- **File:** `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts`
  **Issue:** 14 pre-existing test failures (`resetFup()`, `upsertLead()` — fupNextAt in INSERT) unrelated to EMBD-05 wiring. Verified pre-existing by stashing all 28-04 changes and re-running the full `bun test` suite — same 14 failures occur on the unmodified base branch (commit `7cd742a`).
  **Scope:** Out of scope for plan 28-04 (LeadService, not BrainRunner/embeddings). Not fixed per deviation rules scope boundary.

- **File:** `packages/core/src/events/event-publisher.ts`, `packages/core/src/runner/runner.ts` (line 529, pre-existing MCP close catch)
  **Issue:** `bun run lint` reports 3 pre-existing errors (`no-empty-function`) and several pre-existing `no-non-null-assertion` warnings — confirmed identical output on the unmodified base branch (commit `7cd742a`).
  **Scope:** Out of scope for plan 28-04. The two NEW non-null-assertion warnings introduced at `runner.ts:335` and `runner.ts:435` (`this.embeddingProvider!`) are explicitly specified by the plan's `<action>` block (Task 2, step 2, "Note" paragraph) and mirror the existing pattern used elsewhere in this same file (`event-publisher.ts`, `registry.ts`) — not a regression.

## Plan 28-05

- **Pre-existing test failures in `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts`**
  (14 failures, "FUP-02/Phase26" suite) when run as part of the full `bun test` suite in
  `packages/core`. Confirmed pre-existing and unrelated to plan 28-05's changes: the same
  14 failures occur with 28-05's changes fully stashed (verified via `git stash`). The test
  file passes in isolation (`bun test src/__tests__/unit/fup/lead-service-fup.test.ts` → 7/7
  green), indicating cross-file `mock.module` pollution when running the full suite rather
  than a logic bug in `reembed.ts`. Out of scope per deviation rules (SCOPE BOUNDARY) — not
  fixed here.
