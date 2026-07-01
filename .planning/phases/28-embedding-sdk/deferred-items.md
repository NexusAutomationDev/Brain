# Deferred Items — Phase 28

## Plan 28-04

- **File:** `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts`
  **Issue:** 14 pre-existing test failures (`resetFup()`, `upsertLead()` — fupNextAt in INSERT) unrelated to EMBD-05 wiring. Verified pre-existing by stashing all 28-04 changes and re-running the full `bun test` suite — same 14 failures occur on the unmodified base branch (commit `7cd742a`).
  **Scope:** Out of scope for plan 28-04 (LeadService, not BrainRunner/embeddings). Not fixed per deviation rules scope boundary.
