# Deferred Items — Phase 28 Embedding SDK

## Plan 28-05

- **Pre-existing test failures in `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts`**
  (14 failures, "FUP-02/Phase26" suite) when run as part of the full `bun test` suite in
  `packages/core`. Confirmed pre-existing and unrelated to plan 28-05's changes: the same
  14 failures occur with 28-05's changes fully stashed (verified via `git stash`). The test
  file passes in isolation (`bun test src/__tests__/unit/fup/lead-service-fup.test.ts` → 7/7
  green), indicating cross-file `mock.module` pollution when running the full suite rather
  than a logic bug in `reembed.ts`. Out of scope per deviation rules (SCOPE BOUNDARY) — not
  fixed here.
