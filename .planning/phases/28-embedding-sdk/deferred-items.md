# Deferred Items — Phase 28

## Plan 28-04

- **File:** `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts`
  **Issue:** 14 pre-existing test failures (`resetFup()`, `upsertLead()` — fupNextAt in INSERT) unrelated to EMBD-05 wiring. Verified pre-existing by stashing all 28-04 changes and re-running the full `bun test` suite — same 14 failures occur on the unmodified base branch (commit `7cd742a`).
  **Scope:** Out of scope for plan 28-04 (LeadService, not BrainRunner/embeddings). Not fixed per deviation rules scope boundary.

- **File:** `packages/core/src/events/event-publisher.ts`, `packages/core/src/runner/runner.ts` (line 529, pre-existing MCP close catch)
  **Issue:** `bun run lint` reports 3 pre-existing errors (`no-empty-function`) and several pre-existing `no-non-null-assertion` warnings — confirmed identical output on the unmodified base branch (commit `7cd742a`).
  **Scope:** Out of scope for plan 28-04. The two NEW non-null-assertion warnings introduced at `runner.ts:335` and `runner.ts:435` (`this.embeddingProvider!`) are explicitly specified by the plan's `<action>` block (Task 2, step 2, "Note" paragraph) and mirror the existing pattern used elsewhere in this same file (`event-publisher.ts`, `registry.ts`) — not a regression.
