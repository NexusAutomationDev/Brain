---
phase: 11-tool-contracts-sdk
audited: 2026-06-15
asvs_level: 1
auditor: gsd-security-auditor
threats_total: 7
threats_closed: 7
threats_open: 0
result: SECURED
---

# Security Audit — Phase 11: Tool Contracts SDK

## Summary

All 7 registered threats verified as CLOSED. No open threats. No unregistered threat flags.

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-11-01 | Tampering | accept | CLOSED | `registry.ts:26-34` — `BRAIN_TOOLS` parsed at construction from `process.env`, not from any user-supplied input; `.trim()` applied per token. Accept rationale confirmed: operator-controlled ENV. |
| T-11-02 | Spoofing | mitigate | CLOSED | `pause-session.ts:27`, `finish-conversation.ts:28` — `thread_id` read exclusively from `config?.configurable?.thread_id` (RunnableConfig). Schema is `z.object({})` on both tools (pause-session.ts:41, finish-conversation.ts:44) — LLM has no parameter to inject a lead identifier. |
| T-11-03 | Elevation of Privilege | mitigate | CLOSED | `registry.ts:60-61` — guard `if (this.envWhitelist !== null && !this.envWhitelist.has(toolName)) { return; }` executes before `registry.get(brainType)!.add(toolName)`. Tool never enters the allowed Set if not in whitelist. Silent return (no log, no error) prevents enumeration. |
| T-11-04 | Spoofing | mitigate | CLOSED | `finish-conversation.ts:29-31` — `if (!threadId) { return "Erro: thread_id não disponível na configuração"; }` is the first branch after extracting `threadId`, before the Drizzle `.update()` call at line 34. No DB operation possible without a valid `threadId`. |
| T-11-05 | Tampering | mitigate | CLOSED | `finish-conversation.ts:36` — single `.set({ iaAtivada: false, fullpp: false, updatedAt: new Date() })` within one `.update()` chain. Both fields are mutated atomically by a single SQL UPDATE statement. |
| T-11-06 | Repudiation | accept | CLOSED | Neither `pause-session.ts` nor `finish-conversation.ts` contains explicit tool-level logging (confirmed by inspection). Graph-level tracing via `createTracingCallbacks()` at `runner.ts:198` covers invocation audit for LangSmith. Accept rationale confirmed for v1.2. |
| T-11-07 | Information Disclosure | accept | CLOSED | `pause-session.ts:23`, `finish-conversation.ts:24` — each factory creates its own `db = drizzle(sql)` closure over the `sql` parameter received from `BrainBuildContext`. The `sql` field is injected per-instance at `runner.ts:287` (`sql: this.sql`). No global `sql` reference exists in either factory. Accept rationale confirmed. |

---

## Accepted Risks Log

| Threat ID | Category | Accepted Rationale | Accepted By |
|-----------|----------|--------------------|-------------|
| T-11-01 | Tampering | `BRAIN_TOOLS` ENV is set by the container operator (not exposed to end users). `.trim()` prevents accidental-space misparse. No user-facing input path reaches this variable. Risk accepted for v1.2. | Phase 11 threat model |
| T-11-06 | Repudiation | LangSmith traces cover graph execution at node and tool invocation level. Explicit per-tool logging would be duplicate noise for v1.2 operational volume. Risk accepted; re-evaluate at v2 if audit requirements change. | Phase 11 threat model |
| T-11-07 | Information Disclosure | `sql` is scoped to the factory closure — no global state. Each Brain instance has an isolated `sql` instance injected by `BrainRunner`. No cross-tenant leakage path exists in the current single-tenant deployment model. Risk accepted for v1.2. | Phase 11 threat model |

---

## Unregistered Threat Flags

None. Both `11-01-SUMMARY.md` and `11-02-SUMMARY.md` `## Threat Flags` sections declare no new attack surface beyond the registered threat model.

---

## Files Audited

| File | Role |
|------|------|
| `packages/core/src/tools/registry.ts` | T-11-01, T-11-03 |
| `packages/core/src/tools/pause-session.ts` | T-11-02, T-11-07 |
| `packages/core/src/tools/finish-conversation.ts` | T-11-02, T-11-04, T-11-05, T-11-07 |
| `packages/core/src/runner/runner.ts` | T-11-02 (thread_id set at invoke), T-11-06, T-11-07 |
| `packages/core/src/brain/interface.ts` | T-11-07 (BrainBuildContext.sql? field) |
