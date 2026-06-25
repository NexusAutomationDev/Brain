---
phase: 23
slug: rag-wiring-fix
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-24
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Jest-compatible) |
| **Config file** | `package.json` workspaces — no separate config needed |
| **Quick run command** | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` |
| **Full suite command** | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts apps/brain-sdr/src/__tests__/integration/rag-e2e.test.ts packages/core/src/rag/__tests__/search.test.ts` |
| **Estimated runtime** | ~6 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts`
- **After every plan wave:** Run full suite command above
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~6 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 23-01-01 | 01 | 1 | RAG-02 | T-23-01, T-23-04 | `bindTools` recebe `search_knowledge`; Zod schema valida collections não-vazias | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ | ✅ green |
| 23-01-02 | 01 | 1 | RAG-02, RAG-03 | T-23-01, T-23-02 | Factory instancia sem erro; tool.name correto; busca retorna chunks via vetor | integration | `bun test apps/brain-sdr/src/__tests__/integration/rag-e2e.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement Coverage Detail

| Requirement | Description | Test Files | Test Count | Status |
|-------------|-------------|------------|------------|--------|
| RAG-02 | LLM pode buscar contexto chamando `search_knowledge(query, collections[])` via bindTools/ToolNode | `brain.test.ts`, `rag-e2e.test.ts` | 17 + 4 = 21 testes | COVERED |
| RAG-03 | `search_knowledge` aceita array de coleções e busca em múltiplas simultaneamente | `search.test.ts` (core), `rag-e2e.test.ts` | 8 + 4 = 12 testes | COVERED |

### RAG-02 Evidence
- `brain.test.ts:83-107` — `bindTools` recebe 5 tools incluindo `search_knowledge` (zero MCP)
- `brain.test.ts:156-184` — `bindTools` recebe 6 tools com 1 MCP + `search_knowledge`
- `brain.test.ts:20-26` — `sdrBrain.tools` tem 2 entries: `qualify_lead` e `search_knowledge`
- `rag-e2e.test.ts:152-157` — smoke test: factory instancia sem lançar exceção, `tool.name === "search_knowledge"`

### RAG-03 Evidence
- `search.test.ts:75-83` — `searchKnowledge` aceita `["faq", "manual", "produtos"]` (3 coleções)
- `search.test.ts:67-73` — `inArray` chamado com array de coleções múltiplas
- `rag-e2e.test.ts:103-138` — invocação da tool com `collections: [TEST_COLLECTION]` retorna chunks formatados

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files were required for Wave 0 — infrastructure already in place via `bun test` and existing test directories.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: both tasks covered without gaps
- [x] No Wave 0 MISSING references (infrastructure existed)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

*All requirements (RAG-02, RAG-03) had passing automated tests at audit time. No new tests generated.*
*Audited retroactively from State B (SUMMARY.md existed, no VALIDATION.md).*
