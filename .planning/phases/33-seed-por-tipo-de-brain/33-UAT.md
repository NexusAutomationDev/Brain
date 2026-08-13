---
status: testing
phase: 33-seed-por-tipo-de-brain
source: [33-VERIFICATION.md]
started: 2026-08-13T17:10:00.000Z
updated: 2026-08-13T17:10:00.000Z
---

## Current Test

number: 1
name: Live-database confirmation of SEED-04 idempotency
expected: |
  Run `TEST_DATABASE_URL=postgres://... bun test packages/database/src/__tests__/integration/seed-idempotency.test.ts` (from `packages/database`) against a real, schema-migrated PostgreSQL instance (`fup_config`, `prompts`, `_schema_lock` tables must already exist).
  All test cases execute (no skips); for each of sdr/support/echo, two consecutive `runBrainSeed()` calls against synthetic `seed-idem-<type>` fixtures never throw, and a `COUNT` on `fup_config`/`prompts` for that synthetic brain_type returns exactly 1 row each time — proving `ON CONFLICT DO NOTHING` actually suppresses duplicate rows at the database level, not just that a mocked call resolves twice.
awaiting: user response

## Tests

### 1. Live-database confirmation of SEED-04 idempotency
expected: All 3 describe blocks (sdr/support/echo) pass with no skips; two consecutive `runBrainSeed()` calls per type produce exactly 1 `fup_config` row and exactly 1 `prompts(key='fup')` row each.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
