---
phase: 01
slug: foundation
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-11
updated: 2026-06-11
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Jest-compatible API) |
| **Config file** | None — native TypeScript support, no config needed |
| **Quick run command** | `bun test` |
| **Full suite command** | `pnpm test` (Turborepo orchestrates all packages) |
| **Estimated runtime** | ~2 seconds (unit tests), ~5 seconds (full suite with integration) |

---

## Sampling Rate

- **After every task commit:** Run `bun test` in modified package (< 1 second for unit tests)
- **After every plan wave:** Run `pnpm test` (full suite, all packages)
- **Before `/gsd-verify-work`:** Full suite green + `pnpm typecheck` + `pnpm build`
- **Max feedback latency:** 2 seconds (unit), 5 seconds (full suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-00-01 | 00 (Wave 0) | 0 | DB-01, DB-02 | — | N/A | unit | `bun test packages/database/src/schema/*.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-00-02 | 00 (Wave 0) | 0 | DB-03, DB-04 | — | N/A | unit | `bun test packages/database/src/pool-manager.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-00-03 | 00 (Wave 0) | 0 | DB-05 | — | N/A | integration | `bun test packages/database/src/migrate.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-00-04 | 00 (Wave 0) | 0 | OBS-01 | — | N/A | unit | `bun test packages/observability/src/logger.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-00-05 | 00 (Wave 0) | 0 | OBS-02 | — | N/A | integration | `bun test packages/observability/src/health.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-01 | 01 | 1 | INFRA-01, INFRA-02 | — | N/A | integration | `pnpm typecheck` | ✅ Turborepo | ⬜ pending |
| 01-01-02 | 01 | 1 | INFRA-04 | — | N/A | integration | `pnpm build` | ✅ Turborepo | ⬜ pending |
| 01-02-01 | 02 | 2 | DB-01, DB-02 | T-02-01, T-02-02 | Env vars contain no secrets in logs; vector dimensions validated | unit | `bun test packages/database/src/schema/*.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | DB-06 | T-02-03 | Schema uses type-safe builders, no raw SQL | unit | `pnpm --filter @brain-pkg/database typecheck` | ✅ TypeScript | ⬜ pending |
| 01-02b-01 | 02b | 3 | DB-03, DB-04 | T-02b-02, T-02b-03 | Pool routes to correct DB; tenant isolation enforced | integration | `bun test packages/database/src/pool-manager.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-02b-02 | 02b | 3 | DB-05 | T-02b-04 | Migration exits 1 on failure | integration | `bun test packages/database/src/migrate.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | OBS-01 | T-03-01, T-03-04 | Logger redacts credentials; context injection works | unit | `bun test packages/observability/src/logger.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 2 | OBS-02 | T-03-02, T-03-03 | Health check returns status JSON; no credentials leaked | integration | `bun test packages/observability/src/health.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/database/src/schema/*.test.ts` — covers DB-01, DB-02 (Drizzle schema correctness, PGVector dimension from env)
- [ ] `packages/database/src/pool-manager.test.ts` — covers DB-03, DB-04 (multi-tenant routing, LRU eviction)
- [ ] `packages/database/src/migrate.test.ts` — covers DB-05 (migration exit codes, PGVector extension creation)
- [ ] `packages/observability/src/logger.test.ts` — covers OBS-01 (structured JSON output, context injection)
- [ ] `packages/observability/src/health.test.ts` — covers OBS-02 (health check status codes, DB validation)

**Framework install:** `bun` (built-in test runner) — no additional install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *None* | — | — | All phase behaviors have automated verification |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Pending Wave 0 plan creation and execution (01-00-PLAN.md)
