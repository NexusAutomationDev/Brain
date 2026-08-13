---
phase: 33
slug: seed-por-tipo-de-brain
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
security_block_on: high
created: 2026-08-13
---

# Phase 33 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Docker build → runtime filesystem | Seed SQL content (`packages/database/src/seeds/<type>/0001_fup_defaults.sql`) is baked into each Brain's image at build time via `COPY`, never fetched or interpolated from a runtime/request source | Prompt content + FUP config defaults (no secrets, no PII) |
| `BrainRunner.init()` → process lifecycle | A seed failure escalates to `process.exit(1)`, same trust tier as the existing `MIGRATIONS_FOLDER`/`promptKeys` fail-fast checks | None — process exit only |
| `FupScheduler` (background timer) → LangGraph checkpoint | First write path `FupScheduler` has ever had into checkpoint state — previously read-only via `checkpointer.getTuple()` | Already-sent FUP message text (same content already delivered via webhook) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-33-01 | Denial of Service | `BrainRunner.init()` `SEEDS_FOLDER`/`runBrainSeed()` fail-fast checks | medium | mitigate | Seed SQL baked into the image at build time, not fetched at runtime; thrown `Error` names the exact `brainType` + missing entity for diagnosis; `process.exit` spy test (`seed.test.ts`) confirms `runBrainSeed()` itself never calls `process.exit` — only `BrainRunner.init()` decides to exit, mirroring the existing `promptKeys` precedent | closed |
| T-33-02 | Information Disclosure | Error log emitted by `runBrainSeed()`/`BrainRunner.init()` on validation failure | low | accept | Verified directly (`packages/database/src/seed.ts:75-100`): thrown messages contain only `brainType` and a diagnostic folder hint — never `DATABASE_URL`, prompt content, or lead PII | closed |
| T-33-03 | Tampering | `runBrainSeed()` executes seed file contents via `tx.unsafe()` (simple query protocol) | medium | mitigate | Verified directly (`seed.ts:64-67`): `content` passed to `tx.unsafe()` is exclusively the literal, developer-authored, code-reviewed `.sql` file content baked into the image at build time — zero runtime/user-supplied interpolation into the executed string | closed |
| T-33-04 | Information Disclosure | `FupScheduler._processFupForLead()`'s `opts.injectMessage(uniqueId, message)` call site (D-10) | low | accept | Verified directly (`fup-scheduler.ts:181-186`): the log statement on failure logs only `{ err, uniqueId }` — never `message` content; matches the existing "never log content" discipline at `BrainRunner.injectMessage()` | closed |
| T-33-05 | Tampering | `apps/brain-{sdr,support,echo}/Dockerfile` `COPY` instructions for the `seeds/` tree | high | mitigate | Each Dockerfile `COPY`s only its own `packages/database/src/seeds/<own-type>` subfolder (grep-confirmed, no cross-type references); `seed-cross-brain-isolation.test.ts` (16/16 pass) independently proves no brain type's seed SQL or Dockerfile path ever references another type's `brain_type` literal | closed |
| T-33-06 | Denial of Service | `opts.injectMessage()` could throw and abort an otherwise-successful FUP send if not isolated | medium | mitigate | Verified directly (`fup-scheduler.ts:181`): the call is wrapped in its own `.catch()` (fire-and-forget-with-warn) — a checkpoint-write failure never blocks the `fup_step`/`fup_next_at` UPDATE that already reflects a successfully delivered webhook message; covered by `fup-scheduler.test.ts`'s D-10 failure-isolation test case | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-33-01 | T-33-02 | Diagnostic error message includes `brainType` and a folder hint only; no secrets/PII possible given the log call sites verified in source | Orchestrator (evidence-based, plan-time-authored disposition) | 2026-08-13 |
| R-33-02 | T-33-04 | FUP message content is already delivered via webhook before this call site executes; the log statement was verified to log only `uniqueId` | Orchestrator (evidence-based, plan-time-authored disposition) | 2026-08-13 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-13 | 6 | 6 | 0 | Orchestrator (register authored at plan time in all 3 PLAN.md files; ASVS L1 — direct source verification of every mitigation, auditor spawn short-circuited per L1 grep-depth sufficiency rule) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-13
