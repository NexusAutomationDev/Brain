---
phase: 31
slug: tech-debt-onboarding-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 31 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in) |
| **Config file** | none — built into Bun |
| **Quick run command** | `bun test --timeout 10000` |
| **Full suite command** | `bun test --timeout 10000` |
| **Estimated runtime** | ~2-3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test --timeout 10000`
- **After every plan wave:** Run `bun test --timeout 10000`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 31-01-01 | 01 | 1 | TECH-04 | — | CI fails with clear error on invalid DockGate response | integration | `grep -q 'Invalid URL' .github/workflows/publish-brain-sdr.yml` | ❌ W0 | ⬜ pending |
| 31-01-02 | 01 | 1 | TECH-04 | — | CI fails with clear error on invalid DockGate response | integration | `grep -q 'Invalid URL' .github/workflows/publish-brain-support.yml` | ❌ W0 | ⬜ pending |
| 31-02-01 | 02 | 1 | TECH-05 | — | `respond` tool not excludable via BRAIN_TOOLS in brain-sdr | unit | `grep -A5 'respondTool' apps/brain-sdr/src/brain.ts \| grep -q 'filteredAllTools'` | ❌ W0 | ⬜ pending |
| 31-02-02 | 02 | 1 | TECH-05 | — | `respond` tool not excludable via BRAIN_TOOLS in brain-support | unit | `grep -A5 'respondTool' apps/brain-support/src/brain.ts \| grep -q 'filteredAllTools'` | ❌ W0 | ⬜ pending |
| 31-03-01 | 03 | 1 | TECH-05 | — | .env.example documents embedding ENVs | integration | `grep -q 'EMBEDDING_PROVIDER' apps/brain-sdr/.env.example` | ❌ W0 | ⬜ pending |
| 31-04-01 | 04 | 1 | TECH-05 | — | Migration has inline warning comment | integration | `grep -q 'vector(1536)' packages/database/src/migrations/0009_embedding_dimensions_fix.sql` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — these are code pattern verifications using grep, not runtime tests.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CI workflow fails gracefully on DockGate errors | TECH-04 | Requires triggering actual GitHub Actions workflow with invalid DockGate API response | 1. Create test PR with dummy commit<br>2. Verify workflow fails with clear error message when DockGate returns invalid response<br>3. Check job logs contain raw DockGate response for debugging |
| BRAIN_TOOLS misconfiguration doesn't break respond tool | TECH-05 | Requires running brain with BRAIN_TOOLS that excludes respond, then verifying responses still work | 1. Start brain-sdr with `BRAIN_TOOLS=qualify_lead,search_knowledge` (excluding respond)<br>2. Send test message via webhook<br>3. Verify response is still generated and returned correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
