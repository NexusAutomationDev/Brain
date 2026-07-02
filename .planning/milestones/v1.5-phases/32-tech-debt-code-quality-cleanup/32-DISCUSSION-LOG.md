# Phase 32: Code Quality Cleanup — Accumulated Warnings & Test/Doc Hygiene - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 32-tech-debt-code-quality-cleanup
**Areas discussed:** Runtime lifecycle hardening, Embedding provider lifecycle & reembed safety, Shared code extraction, Test hygiene refactor scope, RESERVED_TOOL_NAMES derivation (follow-up)

---

## Runtime lifecycle hardening

### SIGTERM handler leak on repeat init()

| Option | Description | Selected |
|--------|-------------|----------|
| Remove old handler before re-registering | init() checks for existing `_sigtermHandler` and calls `process.off()` before registering new one | ✓ |
| Fail-fast if init() called twice | Throw explicit error on repeat init() | |
| Document as caller responsibility | No runtime change, just documentation | |

**User's choice:** Remove old handler before re-registering (recommended default)

### WebhookTransport.getStatus() after stop()

| Option | Description | Selected |
|--------|-------------|----------|
| Track stopped flag, return connected:false after stop() | Matches finding's described fix | ✓ |
| Keep stateless, document as intentional | Accept current always-connected:true behavior | |

**User's choice:** Track stopped flag (recommended default)

### RabbitMQ retry map key collision

| Option | Description | Selected |
|--------|-------------|----------|
| Append channel/message-type to key | e.g. `IDLead:Numero:channel` | ✓ |
| Hash full message content into key | Handles any future shape, less debuggable | |

**User's choice:** Append channel/message-type to key (recommended default)

---

## Embedding provider lifecycle & reembed safety

### LazyEmbeddingProvider placeholder values

| Option | Description | Selected |
|--------|-------------|----------|
| Accept and document the behavior | No API change, add doc note | ✓ |
| Make dimensions/providerName async getters | Breaking interface change | |

**User's choice:** Accept and document (recommended default)
**Notes:** This is a deviation from the literal roadmap SC wording ("sem valores placeholder antes da resolução") — captured explicitly in CONTEXT.md D-04.

### getEmbeddingProvider() invalidation

| Option | Description | Selected |
|--------|-------------|----------|
| Leave as process-lifetime singleton | ENV set once at container start, no reload use case | ✓ |
| Add explicit resetEmbeddingProvider() | Manual invalidation hook for future use | |

**User's choice:** Leave as-is (recommended default)

### reembed.ts pagination/batching

| Option | Description | Selected |
|--------|-------------|----------|
| Add MAX_PAGES cap, keep per-row UPDATE | Simplest fix, caps runaway job | ✓ |
| Add MAX_PAGES cap AND batch UPDATEs | More DB-efficient, larger change surface | |

**User's choice:** MAX_PAGES cap only (recommended default)

---

## Shared code extraction

### Type-guard unification location

| Option | Description | Selected |
|--------|-------------|----------|
| packages/core/src/brain/type-guards.ts | Alongside existing cross-Brain runtime utilities | ✓ |
| packages/shared | Alongside pure-type helpers like BrainOutput | |

**User's choice:** packages/core (recommended default)

### SUP-08 naming alignment direction

| Option | Description | Selected |
|--------|-------------|----------|
| Update REQUIREMENTS.md text to match code | enableTool() is established/tested, avoid touching production code for cosmetic fix | ✓ |
| Rename code to registerBrainType() | Makes requirement text literally true, more surface area changed | |

**User's choice:** Update requirement text (recommended default)

---

## Test hygiene refactor scope

### fup-e2e.test.ts ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Refactor into independent tests | Own setup per test, any-order execution | ✓ |
| Document as one sequential scenario | Keep structure, rename to reflect intent | |

**User's choice:** Refactor into independent tests (recommended default)

### mock.module cross-pollution fix approach

| Option | Description | Selected |
|--------|-------------|----------|
| Verify by running both test files together; fix only if it still reproduces | Scouting suggests factory.test.ts already follows the safe pattern | ✓ |
| Proactively rewrite brain-runner.test.ts mocks regardless | Skip verification, assume leak still exists | |

**User's choice:** Verify first (recommended default)

---

## RESERVED_TOOL_NAMES derivation (follow-up — initially missed in area selection)

| Option | Description | Selected |
|--------|-------------|----------|
| Derive from instances at buildGraph() time | Matches literal roadmap SC wording; derivation happens server-side, not attacker-influenced | ✓ |
| Keep hardcoded, document as deviation | Treat fixed deny-list as deliberate security boundary | |

**User's choice:** Derive from instances (recommended default, matches roadmap SC)

---

## Claude's Discretion

- Exact `MAX_PAGES` constant value in reembed.ts
- Exact wording of inline documentation comments for the SIGTERM, WebhookTransport, LazyEmbeddingProvider, and getEmbeddingProvider() decisions
- Whether mechanical fixes (ingest.ts comment, atttypmod docs, search-knowledge.ts escaping, EMBEDDING_DIMENSIONS/Gemini cross-check, duplicate DATABASE_URL check removal) need any design choice beyond a direct fix

## Deferred Ideas

None — discussion stayed within phase scope.

## Scope Corrections Found During Scouting

- Phase 27 WR-01 ("dead branch always maps 503, never 500") does not reproduce in current code — already correctly implemented per Phase 27's D-16 decision.
- Phase 27 IN-01 ("`as any` used for RunnableConfig") does not reproduce — no such pattern found anywhere in the codebase.

Both are documented in CONTEXT.md's `<domain>` section for the planner/researcher to verify and mark as already-resolved rather than search for non-existent fixes.
