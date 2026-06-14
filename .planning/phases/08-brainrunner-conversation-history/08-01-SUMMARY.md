---
phase: 08-brainrunner-conversation-history
plan: "01"
subsystem: core/runner
tags: [integration-test, hist-01, hist-02, conversation-history, langgraph]
dependency_graph:
  requires: []
  provides: [HIST-01-test, HIST-02-test]
  affects: [packages/core/src/runner/__tests__/brain-runner.integration.test.ts]
tech_stack:
  added: []
  patterns:
    - historyAwareBrain encodes state.messages.length in reply to verify checkpoint accumulation without accessing private compiledGraph
key_files:
  modified:
    - packages/core/src/runner/__tests__/brain-runner.integration.test.ts
decisions:
  - Use reply-encoding pattern (msgCount in reply string) to verify PostgresSaver state without exposing compiledGraph (private field — Pitfall 5)
  - Added inArray import from drizzle-orm for multi-value leads cleanup in afterAll
  - Kept historyAwareBrain in describeOrSkip scope (not file scope) to avoid instantiation when DB skipped
metrics:
  duration_minutes: 15
  completed_date: "2026-06-14T17:26:48Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
  files_created: 0
---

# Phase 08 Plan 01: Integration Test HIST-01 + HIST-02 Summary

**One-liner:** Integration tests assert that `thread_id = lead.uniqueId` (IDLead) and that PostgresSaver accumulates conversation history across successive `runner.run()` calls.

## What Was Implemented

Updated `brain-runner.integration.test.ts` with two new integration tests verifying Phase 8 requirements HIST-01 and HIST-02:

### HIST-00 (renamed from original test)
The original `"BrainRunner end-to-end with PostgreSQL real"` test was renamed to `"HIST-00: BrainRunner basic end-to-end with PostgreSQL"` and kept unchanged as a regression smoke test.

### historyAwareBrain (new test fixture)
A new `IBrain` implementation added at `describeOrSkip` scope that encodes `state.messages.length` in the AI reply as `reply:msgCount=N`. This enables indirect verification of checkpoint state without accessing `BrainRunner.compiledGraph` (which is `private`).

```typescript
buildGraph: (_context) => {
  const graph = new StateGraph(BrainStateAnnotation);
  graph.addNode("respond", async (state: any) => {
    const msgCount = (state.messages ?? []).length;
    return { messages: [{ role: "ai", content: `reply:msgCount=${msgCount}` }] };
  });
  graph.setEntryPoint("respond");
  return graph;
},
```

### HIST-01 Test
Verifies that two events with the **same IDLead but different Numero** share the same conversation thread. If `thread_id` were derived from `Numero`, the second event would start with an empty checkpoint. The test asserts `msgCount2 > 1`, which only holds if the checkpoint from `event1` (Numero: `5511111111111`) was loaded for `event2` (Numero: `5519999999999`).

### HIST-02 Test
Verifies that conversation history accumulates between successive calls to the same IDLead. Asserts `msgCount2 > msgCount1`, proving the PostgresSaver checkpoint grows between turns.

### Legacy Comment Removed
The comment `// mesmo Numero = mesmo thread (Phase 8: substituir por lead.unique_id)` was removed from the original test (D-07). The second event in HIST-00 kept a simple repeat with same Numero/IDLead — no assertion on memory accumulation, just a smoke check.

### Cleanup Enhancement
`afterAll` now deletes test leads by `numero` using `inArray` for HIST-01 and HIST-02 fixture phone numbers (`5511111111111`, `5519999999999`, `5511222222222`), in addition to the existing prompt cleanup.

## Pattern Used

**Reply-encoding pattern for private state verification:** Since `compiledGraph` is `private` on `BrainRunner`, the test cannot directly call `compiledGraph.getState()`. Instead, the `historyAwareBrain.buildGraph` node encodes `state.messages.length` in the AI reply string. The test parses this value with `parseInt(result.reply.split("msgCount=")[1] ?? "0", 10)` and asserts on the count — making checkpoint state observable through the public `run()` API.

## Deviations from Plan

None — plan executed exactly as written.

The plan specified using `inArray` for the leads cleanup (implied by the multi-value delete requirement). This was the correct approach and required adding `inArray` to the `drizzle-orm` import (replacing the unused `and` import that was in the original file).

## Known Stubs

None. The test file does not contain placeholder data or stub values. The `historyAwareBrain` produces meaningful output that drives the assertions.

## Threat Flags

None. This plan only modifies a test file — no new network endpoints, auth paths, file access patterns, or schema changes were introduced.

## Self-Check: PASSED

Files exist:
- FOUND: packages/core/src/runner/__tests__/brain-runner.integration.test.ts

Commits exist:
- FOUND: 4452bd5 — ✅ test(08-01): add HIST-01 and HIST-02 integration tests
