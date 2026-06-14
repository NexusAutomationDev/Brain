---
phase: 09
slug: brain-sdr
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-14
---

# Phase 09 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| test files → production modules | Wave 0 test stubs import modules that don't exist yet — RED expected | None (test-only) |
| migration SQL → PostgreSQL | Prompt content inserted via runMigrations() | System prompts (non-secret) |
| ToolNode → boundQualifyTool | LLM decides when to call; parameters come from LLM, not external payload directly | description (string), session_id (string) |
| boundQualifyTool → runQualificationAgent | ctx.prompts["qualification"] (from DB) passed as closure — not hardcoded | Qualification prompt |
| qualify_lead → PostgresSaver | session_id used as thread_id to fetch checkpoint — prepared statements used internally | Conversation history |
| sub-agent → LLM provider | Full conversation history sent to LLM for analysis | Message content (sensitive per contract) |
| JSON parse → result | Raw LLM content parsed — extractJSON() + validation | Qualification JSON response |
| ENV → TenantPoolManager | DATABASE_HOST/PORT/USER/PASSWORD/NAME from Docker environment | DB credentials |
| TenantPoolManager → PostgreSQL | Authenticated connection pool for client's database | All DB traffic |
| Hono → BrainRunner | Webhook/RabbitMQ payload traverses transport layer | Lead messages |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-09-00-01 | Tampering | test stubs | accept | Test files not production code; no security risk | closed |
| T-09-00-02 | Information Disclosure | integration/qualify.test.ts | accept | No real credentials hardcoded; DATABASE_URL via ENV only | closed |
| T-09-01-01 | Tampering | prompts table seed | mitigate | `ON CONFLICT (brain_type, key) DO NOTHING` prevents overwriting client-customized prompts | closed |
| T-09-01-02 | Information Disclosure | prompt content | accept | Prompts are system instructions, not secrets; no credentials or user data | closed |
| T-09-01-03 | Denial of Service | migration idempotency | mitigate | `ON CONFLICT DO NOTHING` on both INSERTs prevents constraint violations under concurrent `init()` | closed |
| T-09-02-01 | Tampering | qualify_lead schema | mitigate | Zod `z.object({ description: z.string(), session_id: z.string() })` validates types; PostgresSaver uses prepared statements | closed |
| T-09-02-02 | Information Disclosure | sub-agent → LLM provider | accept | Intentional system behavior; client contract includes consent for LLM processing | closed |
| T-09-02-03 | Spoofing | session_id in tool call | mitigate | `session_id` is a typed function parameter derived from `lead.uniqueId` (DB); passed to `getTuple()` — not sourced from external payload | closed |
| T-09-02-04 | Elevation of Privilege | JSON parse of LLM output | mitigate | `extractJSON()` strips code fences; `JSON.parse` in try/catch; `typeof` checks on `qualificado`, `motivo`, `proximo_passo`; safe fallback on failure | closed |
| T-09-02-05 | Denial of Service | sub-agent timeout | mitigate | Outer `catch` in `runQualificationAgent` returns `fallback` object — sub-agent failure does not crash main conversation | closed |
| T-09-02-06 | Repudiation | tool calls without logging | mitigate | `logger.info({ session_id })` at tool entry; `logger.debug()` with message counts; `logger.error({ err, sessionId })` on failure | closed |
| T-09-03-01 | Spoofing | DATABASE_NAME via ENV | accept | DATABASE_NAME immutable per Docker instance at deploy time (D-11); no dynamic tenant routing in v1.1 | closed |
| T-09-03-02 | Tampering | TenantPoolManager credentials | mitigate | All 5 DB credential ENVs validated at startup; `process.exit(1)` if absent; no hardcoded values anywhere | closed |
| T-09-03-03 | Denial of Service | pool max connections | mitigate | `TenantPoolManager({ max: 10, idle_timeout: 300 })` limits connections per instance; LRU cache prevents pool explosion | closed |
| T-09-03-04 | Elevation of Privilege | USER bun in Dockerfile | mitigate | `USER bun` directive in runner stage — process runs as non-root (ASVS L1 V10.2.1) | closed |
| T-09-03-05 | Information Disclosure | startup log | mitigate | `logger.error({}, "Missing required...")` — empty first arg `{}`; `DATABASE_PASSWORD` value never passed to any logger call | closed |
| T-09-03-06 | Repudiation | BrainRunner.init() silent | mitigate | `logger.info({}, "BrainRunner initialized")` + `logger.info({ port }, "brain-sdr server listening")` in index.ts | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-09-01 | T-09-00-01 | Test files are not production code; tampering risk is limited to CI/CD integrity, not runtime security | team | 2026-06-14 |
| AR-09-02 | T-09-00-02 | Integration test stubs use only ENV references; no credentials in repository | team | 2026-06-14 |
| AR-09-03 | T-09-01-02 | Prompt content is operational configuration, not a secret; exposure risks are limited to prompt engineering attacks, not data breaches | team | 2026-06-14 |
| AR-09-04 | T-09-02-02 | Sending conversation history to LLM provider is core product behavior; client contract explicitly includes this use; data minimization enforced by context window size (max 40 messages) | team | 2026-06-14 |
| AR-09-05 | T-09-03-01 | DATABASE_NAME is fixed at Docker deploy time per instance; no multi-tenant routing in v1.1; risk of wrong DB name is an ops concern, not a runtime attack vector | team | 2026-06-14 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-14 | 17 | 17 | 0 | gsd-security-auditor (agent ad82a607) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-14
