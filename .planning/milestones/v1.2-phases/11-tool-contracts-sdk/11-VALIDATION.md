---
phase: 11
slug: tool-contracts-sdk
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-15
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Jest-compatible, native) |
| **Config file** | none — native bun test runner |
| **Quick run command** | `bun test packages/core/src/tools/__tests__/ packages/core/src/leads/__tests__/` |
| **Full suite command** | `bun test packages/core/` |
| **Estimated runtime** | ~1.2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/tools/__tests__/ packages/core/src/leads/__tests__/`
- **After every plan wave:** Run `bun test packages/core/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~1.2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 0 | TOOLS-ENV-01 | T-11-01, T-11-03 | `enableTool()` ignora tools fora da whitelist `BRAIN_TOOLS`; silêncio previne enumeração | unit | `bun test packages/core/src/tools/__tests__/tools-registry.test.ts` | ✅ | ✅ green |
| 11-01-02 | 01 | 0 | TOOLS-ENV-02 | T-11-01 | `BRAIN_TOOLS` ausente = comportamento inalterado; nenhuma tool bloqueada | unit | `bun test packages/core/src/tools/__tests__/tools-registry.test.ts` | ✅ | ✅ green |
| 11-01-03 | 01 | 0 | TOOLS-STD-01 scaffold | — | `pause-session.test.ts` existe com 4 casos RED antes da implementação | unit (scaffold) | `bun test packages/core/src/tools/__tests__/pause-session.test.ts` | ✅ | ✅ green |
| 11-01-04 | 01 | 0 | TOOLS-STD-02 scaffold | — | `finish-conversation.test.ts` existe com 4 casos RED antes da implementação | unit (scaffold) | `bun test packages/core/src/tools/__tests__/finish-conversation.test.ts` | ✅ | ✅ green |
| 11-01-05 | 01 | 0 | LeadService setFullpp | T-11-02 | `setFullpp(uniqueId, value)` faz UPDATE atômico em `leads.fullpp` | unit | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | ✅ | ✅ green |
| 11-01-06 | 01 | 0 | LeadService setIaAtivada | T-11-02 | `setIaAtivada(uniqueId, value)` faz UPDATE atômico em `leads.ia_ativada` | unit | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | ✅ | ✅ green |
| 11-02-01 | 02 | 2 | TOOLS-STD-01 | T-11-02, T-11-04 | `pause_session` faz `UPDATE leads.fullpp=false` via `thread_id` do RunnableConfig; retorna erro se `thread_id` ausente | unit | `bun test packages/core/src/tools/__tests__/pause-session.test.ts` | ✅ | ✅ green |
| 11-02-02 | 02 | 2 | TOOLS-STD-02 | T-11-02, T-11-04, T-11-05 | `finish_conversation` faz UPDATE atômico `iaAtivada=false + fullpp=false` em único `.set()`; retorna erro se `thread_id` ausente | unit | `bun test packages/core/src/tools/__tests__/finish-conversation.test.ts` | ✅ | ✅ green |
| 11-02-03 | 02 | 2 | D-03: ctx.sql injection | T-11-07 | `BrainRunner._compileGraph()` passa `sql: this.sql` ao `BrainBuildContext` (arg de `buildGraph`) | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- `packages/core/src/tools/__tests__/pause-session.test.ts` — scaffold criado em Wave 0 (Plan 01), implementação verde em Wave 2 (Plan 02)
- `packages/core/src/tools/__tests__/finish-conversation.test.ts` — idem
- `packages/core/src/tools/__tests__/tools-registry.test.ts` — expandido com 4 novos casos BRAIN_TOOLS em Wave 0
- `packages/core/src/leads/__tests__/lead-service.test.ts` — expandido com 2 novos casos em Wave 0

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| barrel export visível a consumers externos | SDK-07 | Verificação em compile-time — `tsc` no `packages/core` confirma; nenhum teste unitário necessário | `cd packages/core && bun run build` — deve compilar sem erros e `dist/index.js` deve exportar ambas as factories |
| `ctx.sql!` disponível em `buildGraph()` de um Brain real | D-02 | Integração end-to-end requer DB real; testado via `brain-runner.integration.test.ts` quando `POSTGRES_URL` configurado | `POSTGRES_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts` |

---

## Validation Audit Trail

| Audit Date | Gaps Found | Resolved | Escalated | Run By |
|------------|------------|----------|-----------|--------|
| 2026-06-15 | 1 | 1 | 0 | gsd-nyquist-auditor (gsd-validate-phase 11) |

**Gap resolved:** Adicionado teste `"buildGraph receives ctx with sql equal to the sql instance passed to BrainRunner"` em `brain-runner.test.ts` (commit `07b090a`) — asserta identidade referencial de `ctx.sql` com sentinela.

---

## Sign-Off

- [x] All requirements have automated verification commands
- [x] All Wave 0 scaffolds exist and are green
- [x] Full suite runs in < 2 seconds
- [x] `nyquist_compliant: true` — no MISSING gaps remain
- [x] Manual-only items documented with test instructions

**Approval:** verified 2026-06-15
