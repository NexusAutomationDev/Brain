# Deferred Items — Phase 33 Plan 01

## Pre-existing full-suite `mock.module()` pollution (out of scope)

**Found during:** Task 2 (running `packages/core`'s full `bun test` suite to double-check for
regressions after adding `runBrainSeed`/`SEEDS_FOLDER` mocks to the three runner test files).

**Symptom:** `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` fails when the
*entire* `packages/core` suite runs together (`bun test` with no path filter), but passes 12/12
in isolation (`bun test src/__tests__/unit/fup/lead-service-fup.test.ts`).

**Root cause (pre-existing, not introduced by this plan):** `bun test`'s `mock.module()` is
process-global — a mock registered in one test file leaks into unrelated test files sharing the
same `bun test` worker process. This exact file is already named as a known instance in
`STATE.md`'s "Known Pitfalls"/"Pending Todos" sections and tracked at
`.planning/todos/pending/2026-07-02-fix-cross-test-mock-module-pollution-in-full-suite-runs.md`
(dated 2026-07-02, well before this phase).

**Verification this is not caused by Plan 33-01:** stashed the three edited runner test files
(`brain-runner.test.ts`, `runner-fup.test.ts`, `runner-wr.test.ts`) and the new `seed.test.ts`,
re-ran the full `packages/core` suite against the Task-1-only baseline — the full-suite run is
already fragile/crashes without reaching a summary line at that baseline too, consistent with
the pre-existing, already-documented pollution class of bug, not a regression from this plan's
changes. The plan's own `<verify>` block only requires the three named runner test files plus
`seed.test.ts` to pass (individually/together) — verified passing (49 + 15 tests, 0 failures).

**Action:** Not fixed here — out of scope (pre-existing, unrelated file, already tracked
elsewhere per the pending-todo above). No action taken beyond this record.
