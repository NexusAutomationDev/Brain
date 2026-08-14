---
phase: 34
slug: funda-o-de-handoff-agents-dblink
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
security_block_on: high
created: 2026-08-13
---

# Phase 34 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| `agents.connection_string` (this phase's storage) → a destination Postgres, reached via `dblink` | Not exercised by this phase's code (no `dblink_exec` call site exists yet — Phase 35), but the credential is stored here for the first time | Destination-database connection credential (libpq key=value string) |
| Migration batch (0012) → Brain process startup | A failure anywhere in the batch (e.g. `CREATE EXTENSION dblink` permission error) blocks the entire migration transaction, including the harmless `agents`/`handoff_context` DDL, and propagates to `BrainRunner.init()`'s throw-not-exit contract | None — process exit only |
| `getAgentConnection()`'s `name` parameter → the `agents` table query | `name` is not yet attacker-controlled in this phase (no tool/LLM call site exists — Phase 35), but the function is written defensively as if it will be | Agent-name string only |
| `getAgentConnection()`'s return value → its (currently nonexistent) callers | The function intentionally returns `connectionString` to its in-process caller — by design (Phase 35 needs it to drive `dblink`), distinct from logging it, which remains forbidden | Destination connection credential, in-process only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-34-01 | Tampering | `agents.connection_string` stored in plain text (no encryption-at-rest) | medium | accept | D-03 accepted risk — identical posture already accepted for `ADMIN_TOKEN`/`DATABASE_URL` (plain ENV) and `fup_config`/`prompts` (SQL-editable, no UI). Not a new gap introduced by this phase. | closed |
| T-34-02 | Elevation of Privilege | `dblink` extension's functions are PUBLIC-executable by default once `CREATE EXTENSION dblink` runs | medium | accept | Not exploitable today — this project uses exactly one DB role per tenant (already effectively trusted with everything); no code in this phase calls `dblink_exec`. Forward-looking note for Phase 35/future role-separation hardening — no `REVOKE` needed now. | closed |
| T-34-03 | Denial of Service | `CREATE EXTENSION IF NOT EXISTS dblink` requires superuser; migration 0012's single-transaction batch means a permission failure here also blocks the harmless `agents`/`handoff_context` DDL, preventing Brain startup on a privilege-restricted deployment | low | accept | Not a new risk — identical to the pre-existing `vector` extension requirement already relied upon in production by every currently-deployed Brain (`migrate.ts`). | closed |
| T-34-04 | Tampering | `getAgentConnection(sql, name)`'s `name` parameter | medium | mitigate | Verified directly (`packages/database/src/agents.ts:27`): query uses Drizzle's `eq(agents.name, name)` exclusively — no `sql.unsafe`/string interpolation found anywhere in the file. Unit test (`agents.test.ts`) asserts three-way not_found/disabled/ok contract. | closed |
| T-34-05 | Information Disclosure | `AgentConnectionResult`/the full `agents` row, if ever logged via `pino` | high | mitigate | Verified directly (`packages/database/src/agents.ts`, `index.ts`): no `console.log`/`JSON.stringify` call on the full row or result object anywhere in either file. | closed |
| T-34-SC | Tampering | npm/pip/cargo installs | n/a | n/a | Not applicable — this phase installs no package-manager dependency; `dblink` is a native PostgreSQL contrib extension enabled via SQL. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-34-01 | T-34-01 | Plain-text `connection_string` storage matches the existing accepted posture for `ADMIN_TOKEN`/`DATABASE_URL`/`fup_config`/`prompts` — no new gap introduced | Orchestrator (evidence-based, plan-time-authored disposition) | 2026-08-13 |
| R-34-02 | T-34-02 | `dblink`'s PUBLIC-executable grants are not exploitable today — single trusted DB role per tenant, no `dblink_exec` call site exists in this phase | Orchestrator (evidence-based, plan-time-authored disposition) | 2026-08-13 |
| R-34-03 | T-34-03 | Superuser requirement for `CREATE EXTENSION` mirrors the pre-existing `vector` extension precedent already relied upon in production | Orchestrator (evidence-based, plan-time-authored disposition) | 2026-08-13 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-13 | 6 | 6 | 0 | Orchestrator (register authored at plan time in both PLAN.md files; ASVS L1 — direct source verification of every mitigate-disposition threat via grep against `packages/database/src/agents.ts`; auditor spawn short-circuited per L1 grep-depth sufficiency rule) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-13
