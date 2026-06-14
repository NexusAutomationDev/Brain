---
phase: 09-brain-sdr
asvs_level: L1
audited_at: 2026-06-14
threats_total: 17
threats_closed: 17
threats_open: 0
---

# Security Audit — Phase 09: Brain SDR

## Result: SECURED

**Threats Closed:** 17/17
**ASVS Level:** L1
**block_on:** HIGH

---

## Threat Verification

### Accepted Risks (pre-cleared — no implementation verification required)

| Threat ID | Category | Component | Disposition | Basis |
|-----------|----------|-----------|-------------|-------|
| T-09-00-01 | Tampering | test stubs | accept | Test files are not production code; no direct security risk |
| T-09-00-02 | Information Disclosure | integration/qualify.test.ts | accept | No real credentials hardcoded in stubs; DATABASE_URL via ENV only |
| T-09-01-02 | Information Disclosure | prompt content | accept | Prompts are system instructions, not secrets; contain no credentials or user data |
| T-09-02-02 | Information Disclosure | sub-agent → LLM provider | accept | Conversation history sent to LLM provider is intentional system behavior; client contract covers AI usage consent |
| T-09-03-01 | Spoofing | DATABASE_NAME via ENV | accept | DATABASE_NAME is immutable per Docker instance at deploy time (D-11); no dynamic tenant routing in v1.1 |

### Mitigated Threats (implementation verified)

| Threat ID | Category | Disposition | Evidence | Status |
|-----------|----------|-------------|----------|--------|
| T-09-01-01 | Tampering | mitigate | `packages/database/src/migrations/0005_brain_sdr_prompts.sql` lines 13 and 21: exactly 2 `ON CONFLICT (brain_type, key) DO NOTHING` clauses present (grep count = 2) | CLOSED |
| T-09-01-03 | Denial of Service | mitigate | Same 2 `ON CONFLICT (brain_type, key) DO NOTHING` clauses in `0005_brain_sdr_prompts.sql` prevent constraint violations when multiple instances run `init()` simultaneously | CLOSED |
| T-09-02-01 | Tampering | mitigate | `apps/brain-sdr/src/qualifier.ts` lines 235–247: `z.object({ description: z.string()..., session_id: z.string()... })` Zod schema present in `qualifyLeadTool` definition | CLOSED |
| T-09-02-03 | Spoofing | mitigate | `apps/brain-sdr/src/qualifier.ts` line 146–148: `runQualificationAgent(description: string, sessionId: string, ...)` receives `sessionId` as a typed parameter derived from `lead.uniqueId` in runner context; line 175: passed directly to `getTuple({ configurable: { thread_id: sessionId } })` — not taken from external request payload | CLOSED |
| T-09-02-04 | Elevation of Privilege | mitigate | `apps/brain-sdr/src/qualifier.ts` line 56: `extractJSON()` function strips code fences; line 110: `JSON.parse(jsonStr)` wrapped in try/catch (line 117); lines 113–116: `typeof parsed.qualificado === "boolean"`, `typeof parsed.motivo === "string"`, `typeof parsed.proximo_passo === "string"` typeof checks on all three fields before assignment | CLOSED |
| T-09-02-05 | Denial of Service | mitigate | `apps/brain-sdr/src/qualifier.ts` lines 151–155: `fallback` object defined; line 203–205: outer `catch(err)` in `runQualificationAgent` returns `fallback` — sub-agent error does not propagate to main conversation | CLOSED |
| T-09-02-06 | Repudiation | mitigate | `apps/brain-sdr/src/brain.ts` line 35: `logger.info({ session_id }, "qualify_lead tool called (boundQualifyTool)")` at start of bound tool; `apps/brain-sdr/src/qualifier.ts` line 186–189: `logger.debug({ sessionId, aiCount, humanCount }, "Qualification agent: history fetched")`; line 204: `logger.error({ err, sessionId }, ...)` | CLOSED |
| T-09-03-02 | Tampering | mitigate | `apps/brain-sdr/src/index.ts` lines 25–38: all 5 TenantPoolManager credentials (`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`) validated at startup; `process.exit(1)` on line 38 if any absent; no hardcoded credential values present | CLOSED |
| T-09-03-03 | Denial of Service | mitigate | `apps/brain-sdr/src/index.ts` lines 55–56: `TenantPoolManager` constructed with `max: 10, idle_timeout: 300`; LRU cache in TenantPoolManager (inherited from package) prevents pool explosion | CLOSED |
| T-09-03-04 | Elevation of Privilege | mitigate | `apps/brain-sdr/Dockerfile` line 102: `USER bun` directive present in runner stage (`FROM oven/bun:1 AS runner`, line 49) — process runs as non-root (ASVS L1 V10.2.1) | CLOSED |
| T-09-03-05 | Information Disclosure | mitigate | `apps/brain-sdr/src/index.ts` lines 34–38: `logger.error({}, "Missing required DATABASE_* env vars...")` logs ENV names only in the message string; first argument `{}` contains no values; `DATABASE_PASSWORD` value is never passed to any logger call | CLOSED |
| T-09-03-06 | Repudiation | mitigate | `apps/brain-sdr/src/index.ts` line 69: `logger.info({}, "BrainRunner initialized")`; line 75: `logger.info({ port }, "brain-sdr server listening")` — startup sequence is fully logged | CLOSED |

---

## Threat Flags from SUMMARY.md

All four SUMMARY.md files (`09-00`, `09-01`, `09-02`, `09-03`) report no new threat flags:

- `09-00-SUMMARY.md`: "Nenhuma superfície de segurança nova introduzida"
- `09-01-SUMMARY.md`: "None — nenhuma superfície de segurança nova além do que foi documentado no threat model do plano"
- `09-02-SUMMARY.md`: "Nenhuma superfície nova além do que está documentado no threat model do plano. As mitigações T-09-02-01 a T-09-02-06 foram implementadas"
- `09-03-SUMMARY.md`: No threat flags section; implementation confirmed all security controls via automated checkpoint

**Unregistered Flags:** None

---

## Accepted Risks Log

| Threat ID | Category | Rationale | Accepted By |
|-----------|----------|-----------|-------------|
| T-09-00-01 | Tampering | Test files are not deployed to production; no executable attack surface | PLAN.md disposition |
| T-09-00-02 | Information Disclosure | Integration test stubs reference DATABASE_URL by name only; no actual credentials present in file | PLAN.md disposition |
| T-09-01-02 | Information Disclosure | SDR prompt content is operational instructions (not secrets); visible to operators who manage the database; no PII or credentials | PLAN.md disposition |
| T-09-02-02 | Information Disclosure | Sending conversation history to the LLM provider is the core function of the qualification sub-agent; client agreement covers AI processing | PLAN.md disposition |
| T-09-03-01 | Spoofing | DATABASE_NAME is set as an immutable Docker environment variable at deploy time by the operator; cannot be modified at runtime | PLAN.md disposition |
