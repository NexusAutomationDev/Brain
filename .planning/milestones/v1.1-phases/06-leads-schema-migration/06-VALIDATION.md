---
phase: 06
slug: leads-schema-migration
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-14
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none — built-in |
| **Quick run command** | `bun test packages/database/src/schema/tables.test.ts packages/database/src/migrate.test.ts packages/core/src/runner/__tests__/brain-runner.test.ts` |
| **Full suite command** | `bun test packages/` |
| **Estimated runtime** | ~1s |

---

## Sampling Rate

- **After every task commit:** Run quick command above
- **After every plan wave:** Run `bun test packages/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | LEAD-01 (leadsTable D-01 to D-07) | T-06-01 | Schema é código versionado em git | unit | `bun test packages/database/src/schema/tables.test.ts` | ✅ | ✅ green |
| 06-01-02 | 01 | 1 | LEAD-04 (pg_advisory_lock em runMigrations) | T-06-02 | lock blocking intencional — advisory por database | unit | `bun test packages/database/src/migrate.test.ts` | ✅ | ✅ green |
| 06-02-01 | 02 | 2 | LEAD-01 (migration SQL 0004_even_rick_jones.sql) | T-06-05 | SQL revisado via git diff antes de commit | manual | — | ✅ | ✅ manual |
| 06-02-02 | 02 | 2 | LEAD-04 (BrainRunner.init() auto-migrate + MIGRATIONS_FOLDER guard) | T-06-07 | process.exit(1) se MIGRATIONS_FOLDER ausente | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration SQL file gerado pelo drizzle-kit contém CREATE TABLE leads com todos os campos e UNIQUE index em numero | LEAD-01 (Plan 02 Task 1) | Artefato gerado — nome do arquivo é hash-based (0004_even_rick_jones.sql); teste de existência seria frágil e sem valor comportamental adicional ao que os testes de schema cobrem | 1. `ls packages/database/src/migrations/0004_even_rick_jones.sql` 2. `grep "CREATE TABLE" packages/database/src/migrations/0004_even_rick_jones.sql` 3. `grep "leads_numero_unique" packages/database/src/migrations/0004_even_rick_jones.sql` 4. `grep '"idx": 4' packages/database/src/migrations/meta/_journal.json` |

---

## Validation Sign-Off

- [x] All tasks have automated verify or manual-only justification
- [x] Sampling continuity: all 4 tasks covered
- [x] Wave 0: not needed — existing framework covers all requirements
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-14

---

## Validation Audit 2026-06-14

| Metric | Count |
|--------|-------|
| Gaps found | 4 |
| Resolved (automated) | 3 |
| Escalated to manual-only | 1 |
