---
phase: 34-funda-o-de-handoff-agents-dblink
reviewed: 2026-08-14T01:34:49Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/database/src/__tests__/integration/agents.integration.test.ts
  - packages/database/src/__tests__/integration/migration-0012.test.ts
  - packages/database/src/__tests__/unit/agents.test.ts
  - packages/database/src/agents.ts
  - packages/database/src/index.ts
  - packages/database/src/migrations/0012_agents_dblink_handoff_context.sql
  - packages/database/src/migrations/meta/0012_snapshot.json
  - packages/database/src/migrations/meta/_journal.json
  - packages/database/src/schema/tables.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 34: Code Review Report

**Reviewed:** 2026-08-14T01:34:49Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase is a narrow, purely-additive schema change: a new `agents` destination-registry
table, a `dblink` extension bootstrap, a nullable `leads.handoff_context` column, and a
`getAgentConnection()` lookup function. No tool/LLM call sites exist yet — verified by grepping
the rest of the monorepo (`packages/core`, `apps/*`) for any import of `getAgentConnection`,
`agents.js`, or the `agents` table outside this phase's own files; none exist.

Verified specifically at the reviewer's request:

- **SQL injection safety:** `getAgentConnection()` (`packages/database/src/agents.ts:27`) builds
  its query with `db.select().from(agents).where(eq(agents.name, name)).limit(1)` — Drizzle's
  `eq()` parameterizes the value, never string-interpolated. No injection vector.
- **Logging/leakage:** Grepped `agents.ts`/`index.ts` for `console.`/`JSON.stringify`/`logger.` —
  none present. `connectionString` is never logged, serialized, or included in any error message;
  only `name`/`brainType`/`enabled` ever get read, matching the file's own header comment.
- **Migration statement order:** `0012_agents_dblink_handoff_context.sql` orders
  `CREATE EXTENSION IF NOT EXISTS dblink` → `CREATE TABLE "agents"` →
  `ALTER TABLE "leads" ADD COLUMN "handoff_context"`. Confirmed intentional (not accidental) per
  `34-RESEARCH.md` §Pattern 1 / §Common Pitfalls: `drizzle-orm`'s postgres-js migrator batches all
  pending migration files into a single transaction, so `CREATE EXTENSION` has no strict
  ordering dependency on this migration's own DDL (dblink exposes functions only, consumed by
  Phase 35 at runtime) — placing it first is a documented, deliberate readability/precedent
  choice, not a defect.
- **Snapshot/journal consistency:** `0012_snapshot.json`'s `prevId` matches `0011_snapshot.json`'s
  `id`; `_journal.json`'s new `idx: 12` entry is well-formed; a structural diff of the two
  snapshots shows the change is purely additive (new `agents` table + `handoff_context` column,
  nothing else touched).
- **Build/lint/typecheck:** `bun run typecheck`, `bun run lint`, and `bun test` for the affected
  unit + scaffold-integration test files all pass cleanly (8/8 tests, 20 assertions).

No critical defects found. One warning concerns test coverage rigor for the exact behavior this
phase was asked to scrutinize (query correctness against SQL injection/wrong-column risk); a
few forward-looking info notes are included for Phase 35's benefit.

## Warnings

### WR-01: Unit test mock never exercises the `where()` predicate — filtering-by-name is unverified without a live DB

**File:** `packages/database/src/__tests__/unit/agents.test.ts:9-20`
**Issue:** The mock for `drizzle-orm/postgres-js` stubs the entire chain unconditionally:

```ts
mock.module('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResult,
        }),
      }),
    }),
  }),
}));
```

`where()` discards whatever `eq(agents.name, name)` expression is passed to it and always
returns the fixture `selectResult`, regardless of the `name` argument passed into
`getAgentConnection()`. This means the unit suite would stay green even if the implementation
were changed to filter on the wrong column (e.g. `eq(agents.brainType, name)`), swapped the
argument order, or dropped `.where()` entirely — it only proves the three-way
not_found/disabled/ok branching logic, never that the query actually filters by the given name.

The only test that exercises the real Drizzle query against a real table is
`agents.integration.test.ts`, which is gated behind `POSTGRES_URL`/`TEST_DATABASE_URL` and skips
silently when unset (`describeOrSkip`). No CI workflow in `.github/workflows/` sets either
variable, and there is no test-running CI workflow at all in this repo (only two `publish-brain-*`
workflows) — so in the repo's current automated pipeline, the integration test never runs, and
this specific correctness property (does `getAgentConnection` actually filter by `name`?) is
unverified by anything that runs automatically.

This is a pre-existing convention shared by other `__tests__/unit/*.test.ts` files in this
package (e.g. `seed.test.ts`), not something newly introduced by this phase alone, but it is
worth flagging here because it directly undermines confidence in the exact property the reviewer
was asked to verify (query correctness / injection-safety at the call-construction level).

**Fix:** Make the mock name-aware so an assertion can fail if the wrong predicate is used, e.g.:

```ts
let lastWhereArg: unknown;
mock.module('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          lastWhereArg = cond;
          return { limit: async () => selectResult };
        },
      }),
    }),
  }),
}));
// then in a test: expect(lastWhereArg).toMatchObject({ ... }) or assert on drizzle's eq() shape
```

Alternatively (simpler and more valuable), wire `TEST_DATABASE_URL`/`POSTGRES_URL` into a CI job
so `agents.integration.test.ts` actually runs automatically instead of relying on a developer's
local environment.

## Info

### IN-01: No test exercises `getAgentConnection()` with a SQL-metacharacter-laden `name`

**File:** `packages/database/src/__tests__/unit/agents.test.ts`, `packages/database/src/__tests__/integration/agents.integration.test.ts`
**Issue:** All three unit tests and all three integration tests use benign kebab-case fixture
names (`unknown-agent`, `support`, `test-agent-enabled`, `test-agent-disabled`). None passes a
value like `"'; DROP TABLE agents; --"` or `"x' OR '1'='1"` to explicitly document/prove that
`eq()` parameterization neutralizes it (returning `not_found` rather than throwing or matching
unexpected rows). The current code is safe (parameterized query, confirmed by direct read), but
the test suite doesn't encode that guarantee as a regression test.
**Fix:** Add one integration (or unit, with a name-aware mock per WR-01) test case asserting that
a name containing SQL metacharacters returns `{ ok: false, reason: 'not_found' }` rather than an
error or an unexpected match.

### IN-02: Three-way `not_found`/`disabled` distinction will need re-evaluation once wired to an LLM tool (Phase 35)

**File:** `packages/database/src/agents.ts:17-19`
**Issue:** Not a defect in this phase (D-06 in `34-RESEARCH.md` explicitly requires this
discriminated three-way contract, and no tool/LLM call site exists yet). Flagging for Phase 35's
awareness only: once `getAgentConnection()`'s result is surfaced to an LLM-driven tool (e.g. a
`transfer_lead` tool), returning a distinct `disabled` vs. `not_found` reason lets a
model/attacker-controlled input enumerate which destination-agent names exist in the registry
even when disabled. Worth a conscious decision in Phase 35 about whether the tool-facing error
message should collapse both reasons into one generic rejection before it reaches the LLM/user,
versus keeping the distinction for internal logging only.
**Fix:** No action required in this phase. Carry forward as a note for Phase 35's tool-boundary design.

### IN-03: `getAgentConnection()` instantiates a fresh `drizzle(sql)` wrapper on every call

**File:** `packages/database/src/agents.ts:26`
**Issue:** Every invocation calls `drizzle(sql)` again, unlike `LeadService`
(`packages/core/src/leads/lead-service.ts:22-26`), which caches the wrapper once in the
constructor. This is not a correctness bug (drizzle's wrapper is a stateless, cheap query
builder over the injected `sql`), and performance is explicitly out of scope for this review, but
it's a minor inconsistency in idiom versus the class-based service in `packages/core`. Given
`getAgentConnection()` deliberately follows `seed.ts`'s "plain function, no class" shape per
`34-RESEARCH.md`, this is likely an accepted tradeoff rather than an oversight.
**Fix:** No action required; noting only for consistency awareness if this module grows more
functions that would benefit from a shared `db` instance.

---

_Reviewed: 2026-08-14T01:34:49Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
