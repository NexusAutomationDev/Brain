---
phase: 27-tech-debt-fixes
type: security-audit
asvs_level: 1
auditor: gsd-secure-phase
date: 2026-06-30
threats_total: 10
threats_closed: 10
threats_open: 0
block_on: critical
status: SECURED
---

# Security Audit — Phase 27 Tech Debt Fixes

**Phase:** 27 — tech-debt-fixes  
**ASVS Level:** 1  
**Threats Closed:** 10/10  
**Threats Open:** 0/10  
**Result:** SECURED

---

## Threat Verification

### Plan 27-01: BRAIN_TOOLS enabledTools

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-27-01-01 | Tampering | mitigate | CLOSED | `packages/core/src/tools/registry.ts:29` — `raw.split(",").map((s) => s.trim()).filter(Boolean)` removes empty strings and normalizes spaces; `registry.ts:31` — `parsed.length > 0 ? new Set(parsed) : null` sets `envWhitelist=null` when `BRAIN_TOOLS=""` |
| T-27-01-02 | Elevation of Privilege | mitigate | CLOSED | `apps/brain-sdr/src/brain.ts:110-116` — `const allTools = [...nativeTools, ...ctx.mcpTools]` then `filteredAllTools = ctx.enabledTools ? allTools.filter(t => ctx.enabledTools!.has(t.name)) : allTools`; `brain.ts:219-221` — `new ToolNode(filteredAllTools, ...)` uses same filtered list; LLM and executor are synchronized |
| T-27-01-03 | Denial of Service | accept | CLOSED | Accepted — intentional operator behavior; BrainRunner does not throw when all tools are filtered; documented as business risk not a security gap |

### Plan 27-02: FupScheduler E2E Test

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-27-02-01 | Tampering | mitigate | CLOSED | `packages/core/src/__tests__/integration/fup-e2e.test.ts:35-36` — `BRAIN_TYPE = "sdr-fup-e2e"` and `LEAD_UNIQUE_ID = "fup-e2e-lead-1"` use unique suffixes; `fup-e2e.test.ts:166-168` — `afterAll` deletes all three test record sets (leads, fup_config, prompts) |
| T-27-02-02 | Denial of Service | mitigate | CLOSED | `fup-e2e.test.ts:27` — `const RUN_FUP = !!DATABASE_URL`; `fup-e2e.test.ts:67` — `beforeAll` returns immediately when `!RUN_FUP`; `fup-e2e.test.ts:174,208,246` — all three tests use `test.skipIf(!RUN_FUP)` |
| T-27-02-03 | Information Disclosure | accept | CLOSED | Accepted — DATABASE_URL may appear in stack traces on connection failure; acceptable in test/CI environments (not production runtime); documented |

### Plan 27-03: /health transport status

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-27-03-01 | Information Disclosure | mitigate | CLOSED | `packages/observability/src/health.ts:9-12` — `TransportStatus` interface contains only `type: 'webhook' \| 'rabbitmq'` and `connected: boolean`; `health.ts:83-98` — `performHealthCheck` spreads only `transportStatus` (type+connected) into response; no RABBITMQ_URL, credentials, or stack traces present; `server.ts:13-14` — JSDoc explicitly references T-27-03-01 confirming intentional constraint |
| T-27-03-02 | Denial of Service | accept | CLOSED | Accepted — HTTP 503 when transport disconnected is the correct operational behavior; signals unhealthy to load balancer/k8s; auto-reconnect via rabbitmq-client resolves without intervention; documented |
| T-27-03-03 | Spoofing | mitigate | CLOSED | `packages/transport/src/rabbitmq/consumer.ts:44` — `private connected = false` (initialized false); `consumer.ts:73-75` — `this.connected = true` set only inside `this.rabbit.on("connection", ...)` event handler (not configurable via ENV); `consumer.ts:160` — `this.connected = false` in `stop()` before connection teardown; state is derived from real broker events only |
| T-27-03-04 | Tampering | mitigate | CLOSED | `packages/observability/src/health.ts:81` — `performHealthCheck(sql: Sql, transport?: ITransportLike)` — transport is optional; `packages/observability/src/server.ts:22` — `createHealthApp(sql: Sql, transport?: ITransportLike)` — optional parameter; callers without transport argument continue working with unchanged response shape (no `transport` field emitted) |

---

## Accepted Risks Log

| Threat ID | Category | Rationale |
|-----------|----------|-----------|
| T-27-01-03 | Denial of Service | Operator-controlled behavior — filtering all tools via `BRAIN_TOOLS` is intentional; Brain silently returns no tool responses; this is a configuration/business risk, not an exploitable security gap |
| T-27-02-03 | Information Disclosure | Scoped to test/CI environments only; DATABASE_URL in stack traces on connection error is standard behavior in development tooling; production runtime is unaffected |
| T-27-03-02 | Denial of Service | 503 on transport disconnect is correct and desired load balancer signaling; RabbitMQ client auto-reconnects; no manual intervention required |

---

## Unregistered Flags

None — neither 27-01-SUMMARY.md, 27-02-SUMMARY.md, nor 27-03-SUMMARY.md raised threat flags without an existing threat ID mapping. All threat surface observations in the SUMMARY files map directly to T-27-01-01 through T-27-03-04.

---

## Audit Notes

**Key implementation deviation (27-03):** The observability package defines `ITransportLike` and a local mirror of `TransportStatus` instead of importing from `@brain-pkg/transport`. This was required to avoid a circular dependency (`transport` depends on `observability` for `createLogger`; importing `transport` into `observability` would close the cycle). The duck-typed local interface is structurally identical and does not weaken the security guarantee — `TransportStatus` still exposes only `type` and `connected`.

**ASVS Level 1 coverage:** All threats verified at ASVS L1 (input validation, output encoding, access control primitives). No L2/L3 controls (runtime RASP, hardware-backed secrets) are in scope for this phase.
