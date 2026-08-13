# Phase 34: Fundação de Handoff (Agents + DBLink) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-13
**Phase:** 34-Fundação de Handoff (Agents + DBLink)
**Mode:** `--auto` (fully autonomous, single pass, no user interaction — auto-selected via project's `mode: yolo` config, chained from Phase 33's transition)
**Areas discussed:** Agents table shape, migration location, agent lookup function scope, HANDOFF-10 scope, connection-string storage, DBLink-vs-HTTP architecture carry-forward

---

## Agents table shape (HANDOFF-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse ARCHITECTURE.md's HTTP-era sketch (`base_url` + `admin_token`) | Matches the research doc's own agents table sketch verbatim | |
| DBLink-native shape (`connection_string`, no `base_url`/`admin_token`) | Reflects the user's already-confirmed DBLink architecture decision instead of the research doc's HTTP recommendation | ✓ |

**Selected:** DBLink-native shape — `name` (PK) / `brain_type` / `connection_string` / `enabled` / timestamps.
**Notes:** [auto] Auto-selected per the recommended default. ARCHITECTURE.md's own agents table sketch predates the user's DBLink override and is HTTP-specific — following it verbatim would build the wrong columns.

---

## Migration location (HANDOFF-01, HANDOFF-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 33's per-brain-type seed mechanism (`runBrainSeed()`) | Reuse the just-built seed infra | |
| New shared migration in `packages/database/src/migrations/` (Drizzle-tracked) | `agents`/`dblink`/`handoff_context` are genuinely uniform across all brain types, not brain-type-scoped content | ✓ |

**Selected:** New shared migration (next tag `0012_...`), applied via the existing Drizzle migrator.
**Notes:** [auto] Auto-selected. Per ARCHITECTURE.md's own reasoning: "unlike Part A's seeds, this is genuinely shared schema since any Brain could be a source or a destination."

---

## Agent lookup function scope (HANDOFF-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Wire lookup directly into a `transfer_lead` tool now | Ships faster but violates the phase's stated goal of "validável isoladamente... antes de qualquer tool ser construído" | |
| Standalone, unit-tested lookup function, no tool wiring | Matches the phase goal literally; Phase 35 consumes it later | ✓ |

**Selected:** Standalone `getAgentConnection(sql, name)`-shaped function, tested for unknown-name / disabled-name / valid-enabled cases.
**Notes:** [auto] Auto-selected per the literal wording of the ROADMAP.md goal.

---

## HANDOFF-10 scope in Phase 34

| Option | Description | Selected |
|--------|-------------|----------|
| Write placeholder tool code just to "satisfy" the requirement now | Premature — no real tool exists yet in this phase | |
| Document as a locked constraint for Phase 35 to implement; N/A in Phase 34 code | Honest about what this phase actually builds | ✓ |

**Selected:** Documented constraint, not code, in Phase 34.
**Notes:** [auto] Auto-selected. Phase 34 has zero thread_id-consuming code — inventing a stub tool just to tick a checkbox would be scope creep in the wrong direction.

---

## Connection-string storage (security posture)

| Option | Description | Selected |
|--------|-------------|----------|
| Encrypt at rest / secret-manager integration | Stronger security posture, but no existing precedent in this codebase | |
| Cleartext `text` column | Consistent with existing project posture (`ADMIN_TOKEN`/`DATABASE_URL` are plaintext ENV vars) | ✓ |

**Selected:** Cleartext, documented as an accepted risk for this phase's security review.
**Notes:** [auto] Auto-selected. ARCHITECTURE.md's own Open Questions flagged this exact tension and found no existing secret-at-rest precedent to build on.

---

## DBLink-vs-HTTP architecture (carry-forward, not re-discussed)

This was **not** re-litigated — it's a decision the user already confirmed and locked (recorded in `STATE.md`'s "Architecture note"), which explicitly overrides `ARCHITECTURE.md` §Part B's own HTTP-endpoint recommendation. This session's only job was to carry that decision forward accurately into Phase 34's CONTEXT.md and flag that `PITFALLS.md` Pitfalls 5-11's mitigation guidance (written assuming the HTTP approach) will need re-deriving for DBLink by whoever plans Phase 35.

---

## Claude's Discretion

- Exact migration filename and lookup-module filename.
- Whether `leads.handoff_context` and the `agents` table land in one migration file or two (drizzle-kit generate detail).
- Exact TypeScript return shape of the lookup function (discriminated union vs. throw) — deferred to whichever idiom Phase 35's actual call site ends up needing.

## Deferred Ideas

None new. HANDOFF-11 through HANDOFF-14 (HTTP endpoint, bidirectional handoff, hop limits, admin UI) were already documented as v2/out-of-scope in REQUIREMENTS.md before this session.
