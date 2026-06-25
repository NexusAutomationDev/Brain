---
phase: 25-fup-activation
reviewed: 2026-06-25T01:31:30Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - packages/core/src/leads/__tests__/lead-service.test.ts
  - packages/core/src/leads/lead-service.ts
  - packages/core/src/runner/runner.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 25: Code Review Report

**Reviewed:** 2026-06-25T01:31:30Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the FUP activation implementation across `LeadService` and `BrainRunner`. The core logic is well-structured: FUP is activated only on INSERT with a matching `fup_config`, `uniqueId` is never overwritten, and `fupEnabled` is excluded from the UPDATE `set` (preserving existing values). The test suite covers the main decision paths (D-02, D-03, D-04).

Two issues stand out as meaningful correctness risks: a TOCTOU race condition in `upsertLead` that can silently skip FUP activation for genuinely new leads under concurrent load, and the unconditional `resetFup` call in `runner.ts` which resets the FUP schedule on every message regardless of whether a FUP cycle was in progress. The remaining findings are lower-severity code quality issues.

## Warnings

### WR-01: TOCTOU race — FUP activation can silently fail for new leads under concurrent load

**File:** `packages/core/src/leads/lead-service.ts:40-88`

**Issue:** `upsertLead` checks whether a lead exists with a `SELECT` (lines 40-44), queries `fup_config` only when `isInsert=true` (line 50), then executes the `INSERT … onConflictDoUpdate` (lines 65-82). Between the SELECT and the INSERT, a concurrent request for the same `numero` (realistic when multiple Brain instances share one DB, as documented in the architecture) can INSERT the lead first. The executing request then takes the conflict/UPDATE path, but `fupEnabled` is absent from the `set` object (by design, D-03). The result: the lead is created with the database default `fupEnabled=false` — the `fup_config` lookup was skipped because `isInsert` was stale.

This is not a data-corruption risk (existing leads are never incorrectly activated), but a silent correctness loss: the very first message from a new lead, under concurrent load, may leave FUP permanently disabled until a manual fix.

**Fix:** Eliminate the pre-check SELECT. Pass `fupEnabled` as an expression derived from `fup_config` in a single atomic statement, or use a two-step approach that does not rely on the pre-check for correctness:

Option A — Remove the pre-check, always look up `fup_config` when `brainType` is provided, and include `fupEnabled` in the INSERT values only (the conflict path already excludes it by design). Whether or not the lead is new, the worst outcome is a redundant `fup_config` query on updates, which is acceptable:

```typescript
async upsertLead(numero: string, uniqueId: string, nome?: string, brainType?: string): Promise<Lead> {
  // Query fup_config unconditionally when brainType provided.
  // On UPDATE (conflict path), fupEnabled is not in `set`, so this value is ignored for existing leads.
  let fupEnabled = false;
  if (brainType) {
    const configRows = await this.db
      .select({ enabled: fupConfig.enabled })
      .from(fupConfig)
      .where(eq(fupConfig.brainType, brainType))
      .limit(1);
    if (configRows[0]?.enabled === true) {
      fupEnabled = true;
    }
  }

  const rows = await this.db
    .insert(leads)
    .values({ numero, uniqueId, nome: nome ?? null, fupEnabled })
    .onConflictDoUpdate({
      target: leads.numero,
      set: { nome: nome ?? null, updatedAt: new Date() },
    })
    .returning();

  if (!rows[0]) {
    throw new Error(`upsertLead returned no rows for numero=${numero}`);
  }
  return rows[0];
}
```

Option B — Keep the pre-check but treat `isInsert` as a hint only, and always pass `fupEnabled` in `.values()` (still not included in `set`). The behavior is identical on a true INSERT; on a conflict the value is ignored. This is semantically equivalent to Option A and avoids the extra query on updates.

### WR-02: `resetFup` called unconditionally — resets FUP state on every message, including when no FUP is in progress

**File:** `packages/core/src/runner/runner.ts:263`

**Issue:** `this.leadService.resetFup(lead.uniqueId)` is called on every invocation of `run()`, regardless of whether the lead has an active FUP cycle (`fup_next_at IS NOT NULL`). When `fupEnabled=false` or `fup_next_at` is already NULL, the UPDATE is a no-op at the DB level but executes a write round-trip per message. More importantly, if the FUP scheduler sets `fup_next_at` between `upsertLead` and `resetFup` (both are async, non-atomic), the scheduler's write is silently overwritten.

The documented intent (FUP-06/D-19: "cancel pending FUPs when lead replies") implies this should only fire when a FUP is actually in progress. The unconditional call also means `fup_step` is reset to 0 on every human message even when no FUP cycle was scheduled.

**Fix:** Guard the call to avoid unnecessary writes. If the FUP state is already clean, skip:

```typescript
// FUP-06 / D-19: Reset FUP only when an active FUP cycle exists.
// lead.fupNextAt is set by FupScheduler — if null, nothing to cancel.
if (lead.fupNextAt !== null) {
  await this.leadService.resetFup(lead.uniqueId);
}
```

Alternatively, add the guard inside `resetFup` itself with a conditional WHERE clause:

```sql
-- Only update when fup_next_at is not null (active cycle)
UPDATE leads SET fup_next_at = NULL, fup_step = 0, updated_at = NOW()
WHERE unique_id = $1 AND fup_next_at IS NOT NULL
```

### WR-03: `resetFup` test coverage missing from test suite

**File:** `packages/core/src/leads/__tests__/lead-service.test.ts`

**Issue:** `LeadService.resetFup()` (introduced in this phase, `lead-service.ts:162-169`) has zero test coverage in the test file. The method is called by `BrainRunner.run()` on every message turn. There are no assertions verifying:
- That `resetFup` calls `db.update` with `{ fupNextAt: null, fupStep: 0, updatedAt: <Date> }`
- That it filters by `eq(leads.uniqueId, uniqueId)` (not `leads.numero`)
- That `fupEnabled` is NOT included in the set (analogous to the existing D-19 check documented in the comment)

Without tests, the `updatedAt: new Date()` comment `// WR-02: updatedAt incluído para consistência` at line 165 is untested and could silently regress.

**Fix:** Add a `describe` block mirroring the `touchLastMessage` suite:

```typescript
describe("LeadService — resetFup (FUP-06/D-19)", () => {
  // ... setup update chain mock ...

  it("resetFup() chama db.update com { fupNextAt: null, fupStep: 0, updatedAt } onde eq(leads.uniqueId)", async () => {
    await service.resetFup("lead-abc");
    const setArg = mockSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toHaveProperty("fupNextAt", null);
    expect(setArg).toHaveProperty("fupStep", 0);
    expect(setArg).toHaveProperty("updatedAt");
  });

  it("resetFup() NÃO inclui fupEnabled no set (D-19: lead permanece elegível)", async () => {
    await service.resetFup("lead-abc");
    const setArg = mockSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("fupEnabled");
  });
});
```

### WR-04: `_compileGraph` failures propagate uncaught from `init()` — inconsistent with fail-fast pattern

**File:** `packages/core/src/runner/runner.ts:152`

**Issue:** `runMigrations` failures are caught and routed to `process.exit(1)` explicitly (lines 132-135). `_compileGraph()` failures (e.g., `createCheckpointer` throws when Postgres is unreachable) propagate as unhandled rejections to the `init()` caller. The two startup paths have inconsistent failure modes: one produces a clean `process.exit(1)` with a structured log entry; the other produces an unhandled exception that may crash without a log entry, depending on the top-level error handler.

**Fix:** Wrap `_compileGraph()` in the same fail-fast pattern used for migrations:

```typescript
await this._compileGraph().catch((err: unknown) => {
  this.logger.error({ brainId: this.brain.id, err }, 'Graph compilation failed — aborting init');
  process.exit(1);
});
```

## Info

### IN-01: Dead mock declarations — `mockSelect4` never wired into `mockDb`

**File:** `packages/core/src/leads/__tests__/lead-service.test.ts:33-36`

**Issue:** `mockSelect4`, `mockFrom4`, `mockWhere4`, `mockLimit4` are declared at the top level (lines 33-36) and cleared in `beforeEach` (lines 206-209). However, `mockSelect4` is never assigned to `mockDb.select`. In the FUP activation tests, `mockSelect` (which IS `mockDb.select`) is overridden via `mockImplementation` to return `{ from: mockFrom4 }` on the second call. `mockSelect4` is never invoked directly — it is dead code. The `mockClear()` calls on `mockSelect4` in `beforeEach` (line 209) are no-ops.

**Fix:** Remove `mockSelect4` from the top-level declarations and from the `beforeEach` clear block. Keep only `mockFrom4`, `mockWhere4`, `mockLimit4` (which are used as the chain target for the second SELECT):

```typescript
// Remove these lines:
// const mockSelect4 = mock(() => ({ from: mockFrom4 }));
// and from beforeEach: mockSelect4.mockClear();
```

### IN-02: Unnecessary `!` definite assignment assertion on `leadService` field

**File:** `packages/core/src/runner/runner.ts:84`

**Issue:** `private leadService!: LeadService` uses the non-null assertion operator (`!`). The field is unconditionally initialized in the constructor at line 101 (`this.leadService = new LeadService(options.sql)`). TypeScript can statically verify this initialization — the `!` suppresses a type check that is already satisfied, making it misleading (it implies the field could be uninitialized at some point).

**Fix:** Remove the `!`:

```typescript
private leadService: LeadService;
```

TypeScript will confirm the constructor assignment satisfies the definite assignment requirement.

---

_Reviewed: 2026-06-25T01:31:30Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
