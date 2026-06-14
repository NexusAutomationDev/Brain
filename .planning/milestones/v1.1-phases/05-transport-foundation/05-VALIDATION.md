---
phase: "05"
slug: transport-foundation
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-14
---

# Phase 05 — Validation Strategy

> Per-phase validation contract: transport BrainEvent schema migration, runner injection, DedupCache removal, and lint pipeline activation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Jest-compatible API) |
| **Config file** | none — auto-discovery by Bun |
| **Quick run command** | `cd /root/Brain && bun test packages/transport` |
| **Full suite command** | `cd /root/Brain && bun test packages/transport packages/core/src/runner/__tests__/brain-runner.test.ts` |
| **Lint verification** | `cd /root/Brain && bunx turbo run lint` |
| **Estimated runtime** | ~2s (unit) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/transport`
- **After every plan wave:** Run full suite + `bunx turbo run lint`
- **Before `/gsd-verify-work`:** Full suite must be green + lint 7/7 successful
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-T1 | 01 | 1 | TRP-02 | T-05-01 | POST {Name,Message,Numero,IDLead} → 200 `{status:'ok',reply}` com runner; payload antigo → 400; sem X-Request-Id → 200 | unit | `bun test packages/transport/src/webhook/handler.test.ts` | ✅ | ✅ green |
| 05-01-T1b | 01 | 1 | TRP-02-R5 | T-05-01 | dedup.ts e dedup.test.ts não existem no repo (guard de regressão D-02, D-16) | unit | `bun test packages/transport/src/__tests__/unit/dedup-removal.test.ts` | ✅ | ✅ green |
| 05-01-T2 | 01 | 1 | TRP-02 | T-05-02 | `WebhookTransport.start()` sem runner lança `ConfigurationError`; factory passa runner ao constructor | unit | `bun test packages/transport/src/factory.test.ts` | ✅ | ✅ green |
| 05-01-T3 | 01 | 1 | TRP-02 | — | runner.ts usa event.Message, event.IDLead, event.Numero — sem campos antigos | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |
| 05-02-T1 | 02 | 1 | INFRA-02 | T-05-06 | `@typescript-eslint` declarado em root package.json; 7 pacotes com script lint; sem .eslintrc.js por pacote | config | `grep "@typescript-eslint" /root/Brain/package.json && grep -r '"lint"' /root/Brain/packages/*/package.json \| wc -l` | N/A | ✅ green |
| 05-02-T2 | 02 | 1 | INFRA-02 | T-05-07 | `turbo run lint` → Tasks: 7 successful, 0 errors em src/ de todos os pacotes | lint | `cd /root/Brain && bunx turbo run lint 2>&1 \| tail -5` | N/A | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — bun test auto-discovers .test.ts files, no Wave 0 setup needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Audit 2026-06-14

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved (automated) | 2 |
| Escalated to manual | 0 |

**Gap 1 — TRP-02-R5 (MISSING → FILLED)**
- Created: `packages/transport/src/__tests__/unit/dedup-removal.test.ts`
- Asserts: `dedup.ts` não existe, `dedup.test.ts` não existe, `DedupCache` não é exportado pelo index.ts
- Result: 3 pass, 0 fail

**Gap 2 — INFRA-02-R1/R2 (PARTIAL → FILLED)**
- Fixed: `packages/core/src/runner/runner.ts:16` — removed unused `AIMessage` import (dead code; code uses `m._getType() === "ai"` instead of `instanceof AIMessage`)
- Result: `bunx turbo run lint` → Tasks: 7 successful, 7 total

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 not required — existing infrastructure sufficient
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-14
