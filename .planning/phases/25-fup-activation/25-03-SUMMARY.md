---
phase: 25-fup-activation
plan: "03"
subsystem: core/runner
tags: [fup, brainType, lead-service, runner, pipeline]
dependency_graph:
  requires: [25-02]
  provides: [FUP activation end-to-end pipeline]
  affects: [packages/core/src/runner/runner.ts]
tech_stack:
  added: []
  patterns: [brainType injection via fourth parameter to upsertLead()]
key_files:
  modified:
    - packages/core/src/runner/runner.ts
decisions:
  - "Pass this.brain.brainType as fourth parameter to upsertLead() — backward compatible (optional param)"
metrics:
  duration: "5 minutes"
  completed_date: "2026-06-25"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 25 Plan 03: BrainRunner brainType Injection Summary

**One-liner:** BrainRunner.run() now passes brainType to upsertLead(), completing the FUP activation pipeline from Brain → LeadService → fup_config → auto-enabled FUP.

## Objective

Wire BrainRunner.run() to pass brainType to LeadService.upsertLead() — completing the FUP activation pipeline from Brain → LeadService → fup_config → auto-enabled FUP (D-08).

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Pass this.brain.brainType to leadService.upsertLead() in BrainRunner.run() | fe3707f | packages/core/src/runner/runner.ts |

## Implementation Details

### Task 1: brainType Injection

Modified `BrainRunner.run()` at line 248 in `packages/core/src/runner/runner.ts`:

**Before:**
```typescript
const lead: Lead = await this.leadService.upsertLead(
  event.Numero,
  event.IDLead,
  event.Name
);
```

**After:**
```typescript
// Phase 25: brainType permite ativação automática de fup_enabled quando fup_config existe
const lead: Lead = await this.leadService.upsertLead(
  event.Numero,
  event.IDLead,
  event.Name,
  this.brain.brainType // ← NOVO: quarto parâmetro para ativação automática de FUP (Phase 25)
);
```

**Why this works:**
- `this.brain` is IBrain instance (available in BrainRunner)
- `IBrain.brainType` is a string field (confirmed in interface.ts line 42)
- `upsertLead()` accepts optional brainType as fourth parameter (Wave 1, Plan 02 implementation)
- Backward compatible: existing test mocks that expect 3 parameters still work (parameter is optional)

## Verification

BrainRunner test suite (26 tests):
```
bun test packages/core/src/runner/__tests__/brain-runner.test.ts
26 pass, 0 fail
```

Full core package test suite:
```
bun test packages/core
184 pass, 5 skip, 2 fail (pre-existing failures in lead-service-fup.test.ts — mock interference when running full suite; tests pass when run individually)
```

The 2 failures in the full suite are pre-existing mock interference issues (verified in main repo: same 2 tests fail there too). They are not caused by this change.

## Deviations from Plan

None — plan executed exactly as written. Single-line addition with inline comment as specified.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- [x] `packages/core/src/runner/runner.ts` modified — FOUND
- [x] Commit fe3707f — FOUND (`git log --oneline -1` confirms)
- [x] BrainRunner test suite: 26/26 pass
- [x] `this.brain.brainType` present as fourth parameter to `upsertLead()`
- [x] Inline comment documents Phase 25 change
