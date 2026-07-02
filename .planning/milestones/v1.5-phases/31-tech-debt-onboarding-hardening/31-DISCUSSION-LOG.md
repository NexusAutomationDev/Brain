# Phase 31: Pre-Client Onboarding Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 31-tech-debt-onboarding-hardening
**Areas discussed:** respond tool protection mechanism, CI shell hygiene fix strictness, Scope of CI fix — one workflow or both, Migration warning comment wording

---

## Scope correction (pre-discussion finding)

During codebase scouting (before gray-area discussion), found that `apps/brain-support/docker-compose.yml`'s port fix (3002→3003), which the v1.5 audit reported as "staged but not committed", was already committed in `3abf253` — before the audit report commit (`9768107`) itself. This item was removed from Phase 31's scope before discussion began; not re-litigated with the user as a gray area.

---

## respond tool protection mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror search_knowledge | Move respond out of the enabledTools-filtered set, append after filter by direct variable reference — structurally impossible to exclude via BRAIN_TOOLS | ✓ |
| Keep filterable, fail fast at startup | Leave respond filterable; add a BrainRunner.init() check that exits if BRAIN_TOOLS excludes it | |
| Keep filterable, warn only | Log a warning at graph-build time if BRAIN_TOOLS excludes respond; no structural change | |

**User's choice:** Mirror search_knowledge (Recommended)
**Notes:** Apply to both `apps/brain-sdr/src/brain.ts` and `apps/brain-support/src/brain.ts` — same bug class in both.

---

## CI shell hygiene fix strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-fail the job | Validate URL is non-empty and not "null"; print raw response and exit 1 if invalid | ✓ |
| Warn and continue | Log a warning but let the pipeline continue to the next step | |

**User's choice:** Hard-fail the job (Recommended)

---

## Scope of CI fix — one workflow or both

| Option | Description | Selected |
|--------|-------------|----------|
| Fix both now | Apply the same fix to publish-brain-sdr.yml (the file brain-support's was copied from, same bug) | ✓ |
| Only fix brain-support now | Scope strictly to what the audit flagged, defer brain-sdr's copy | |

**User's choice:** Fix both now (Recommended)

---

## Migration warning comment wording

| Option | Description | Selected |
|--------|-------------|----------|
| Short warning only | 1-2 line SQL comment: vector(1536) is OpenAI-specific, TRUNCATE must be manually re-added on regenerate, points to 28-VERIFICATION.md | ✓ |
| Full checklist | Longer comment block with exact regeneration steps | |

**User's choice:** Short warning only (Recommended)

---

## Claude's Discretion

- Exact wording/formatting of the CI failure error message
- Whether apps/brain-sdr needs a RESERVED_TOOL_NAMES-style MCP-collision guard as a side effect of the respond fix (brain-sdr currently has none for any native tool) — flagged for planner/researcher to assess scope

## Deferred Ideas

- Full RESERVED_TOOL_NAMES-style guard for all of brain-sdr's native tools (beyond what's needed for the respond fix) — may become its own follow-up if larger than expected
- All remaining warning/info-level tech debt items (WR-02/03, IN-01/02/03 across phases 27-30, SUMMARY frontmatter backfill, test isolation) — assigned to Phase 32
