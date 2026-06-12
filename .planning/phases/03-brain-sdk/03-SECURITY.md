---
phase: 03
slug: brain-sdk
status: verified
threats_open: 0
asvs_level: L1
created: 2026-06-12
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| DB → Prompt Loader | `loadPrompts()` queries the `prompts` table filtered by `brainType` | Prompt content (system prompts) — isolated per brainType |
| HTTP → Transport Handler | Webhook receives `BrainEvent` JSON from external callers | User message content, session IDs |
| HTTP → Admin Endpoint | `/reload-prompts` receives admin commands from internal operators | Admin token, trigger signal only |
| BrainRunner → LangGraph | Runner submits messages to compiled LangGraph and receives reply | Internal agent state, conversation history |
| Runner → Logger | Structured logs emitted via Pino | brainId, brainType, key names — never secrets or prompt content |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-3-00-01 | Schema integrity | packages/database/src/schema/tables.ts | mitigate | `uniqueIndex('prompts_brain_type_key_idx').on(table.brainType, table.key)` enforces uniqueness | closed |
| T-3-00-02 | TypeScript config | packages/core/tsconfig.json | mitigate | All 6 project references declared (shared, ai, memory, database, transport, observability) | closed |
| T-3-01-01 | Spoofing (BrainType) | packages/core/src/runner/runner.ts | mitigate | `this.brain.brainType` used exclusively — `event` fields never used as brainType source | closed |
| T-3-01-02 | Config masking | packages/core/src/tools/registry.ts | mitigate | `getTools()` throws `ConfigurationError` when brainType not registered — no silent empty return | closed |
| T-3-01-03 | Elevation (MemorySaver in buildGraph) | packages/core/src/brain/interface.ts | mitigate | Interface returns uncompiled `StateGraph` — no MemorySaver import in interface or runner | closed |
| T-3-02-01 | Prompt injection via DB | packages/core/src/prompts/loader.ts | accept | UNIQUE constraint limits surface; reload gated by authenticated endpoint. See Accepted Risks | closed |
| T-3-02-02 | Information disclosure (cross-brainType) | packages/core/src/prompts/loader.ts | mitigate | `and(eq(prompts.brainType, brainType), inArray(prompts.key, keys))` — double-filter enforces isolation | closed |
| T-3-02-03 | SQL injection via migration edit | packages/db/migrations | accept | Convention: never manually edit drizzle-kit generated SQL. See Accepted Risks | closed |
| T-3-02-04 | Incorrect migration from offline drizzle-kit | packages/db | accept | `drizzle-kit generate` analyzes TypeScript schema only — inherently deterministic without DB | closed |
| T-3-03-01 | Persistence bypass (MemorySaver in prod) | packages/core/src/runner/runner.ts | mitigate | `createCheckpointer()` returns `PostgresSaver` exclusively — zero MemorySaver references in runner.ts | closed |
| T-3-03-02 | Information disclosure (LangGraph state leak) | packages/core/src/runner/runner.ts | mitigate | `run()` returns `{ reply: string }` only — internal graph state never exposed | closed |
| T-3-03-03 | Uninitialized execution | packages/core/src/runner/runner.ts | mitigate | `run()` checks `!this.compiledGraph \|\| !this.memoryManager` and throws `ConfigurationError` | closed |
| T-3-03-04 | Secret exposure in logs | packages/core/src/runner/runner.ts | mitigate | Logger fields: `{ brainId, brainType, missingKey }` only — DATABASE_URL, API keys, prompt content absent | closed |
| T-3-03-05 | Prompt injection via BrainEvent | packages/transport/src/webhook/handler.ts | mitigate | `BrainEventSchema.safeParse(body)` validates before dispatch — prompts loaded from DB via `loadPrompts()`, never from event | closed |
| T-3-03-06 | refreshPrompts() silent missing key | packages/core/src/runner/runner.ts | accept | Container continues with prior prompts on refresh failure. Acceptable for v1. See Accepted Risks | closed |
| T-3-04-01 | Unauthenticated admin endpoint | packages/core/src/server.ts | mitigate | `X-Admin-Token` vs `ADMIN_TOKEN` env — 401 returned without distinguishing absent vs incorrect token | closed |
| T-3-04-02 | Admin endpoint open without ADMIN_TOKEN | packages/core/src/server.ts | mitigate | `if (!adminToken)` returns 503 fail-closed — endpoint inaccessible without token configured | closed |
| T-3-04-03 | Circular dependency core/transport | packages/transport/src/webhook/handler.ts | mitigate | Local `IBrainRunnerLike` duck-type interface — no `@brain-pkg/core` import in transport | closed |
| T-3-04-04 | Barrel export leaking internals | packages/core/src/index.ts | mitigate | Explicit named exports only — no `export *` anywhere in file | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-3-02-01 | Prompt injection via DB requires direct DB access — attack surface limited to users with DB credentials. `/reload-prompts` endpoint is authenticated. This is a deployment-time concern (DB ACLs), not a code-level gap. Accepted for v1; revisit with row-level security in v2. | gsd-security-auditor | 2026-06-12 |
| AR-03-02 | T-3-02-03 | Manual migration edits are a process risk, not a code flaw. Drizzle-kit generates SQL from TypeScript schema — the convention "never edit generated SQL" is documented. Accepted as organizational process control for v1. | gsd-security-auditor | 2026-06-12 |
| AR-03-03 | T-3-02-04 | `drizzle-kit generate` is a local, schema-only operation with no DB dependency. No code-level mitigation possible or necessary. Accepted as inherent tool behavior. | gsd-security-auditor | 2026-06-12 |
| AR-03-04 | T-3-03-06 | `refreshPrompts()` failure keeps container alive with previous prompts — a safe degradation mode for v1. Logging the failure is sufficient. Revisit in v2 with health-check integration and stale-prompt detection. | gsd-security-auditor | 2026-06-12 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-12 | 19 | 19 | 0 | gsd-security-auditor (Phase 03 initial audit) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-12
