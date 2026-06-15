---
phase: 12
slug: brain-sdr-integration
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-15
audited: 2026-06-15
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.x) |
| **Config file** | Nenhum — `bun test` não requer config |
| **Quick run command** | `bun test apps/brain-sdr/src/__tests__/unit` |
| **Full suite command** | `bun test` (todos os workspaces) |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test apps/brain-sdr/src/__tests__/unit`
- **After every plan wave:** Run `bun test` (workspace completo)
- **Before `/gsd-verify-work`:** `turbo run build && turbo run lint && bun test` — todos verdes
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | PARSER-03 | — | brainOutput.fullResponse e responseMode: "text" setados no estado do grafo | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ | ✅ green |
| 12-01-02 | 01 | 1 | TOOLS-STD-03 | — | thread_id de RunnableConfig, nunca do LLM | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ | ✅ green |
| 12-01-03 | 02 | 1 | PARSER-03 | — | webhook retorna fullResponse + responseMode, campo reply removido | unit | `bun test packages/transport/src/webhook/handler.test.ts` | ✅ | ✅ green |
| 12-01-04 | 01 | 1 | TOOLS-STD-03 | — | pause_session e finish_conversation registradas no ToolsRegistry para brainType "sdr" | unit | `bun test apps/brain-sdr/src/__tests__/unit/toolsregistry-sdr.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — atualizado com 3 tools + brainOutput graph invocation test
- `packages/transport/src/webhook/handler.test.ts` — atualizado com assertions body.fullResponse, body.responseMode, body.reply undefined
- `apps/brain-sdr/src/__tests__/unit/toolsregistry-sdr.test.ts` — criado na auditoria Nyquist para cobrir gap TOOLS-STD-03

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ nyquist_compliant

---

## Validation Audit 2026-06-15

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |

### Gap Details

| Gap ID | Task | Requirement | Type | Resolution |
|--------|------|-------------|------|------------|
| G1 | 12-01-01 | PARSER-03 | PARTIAL | Adicionado teste que compila o grafo e invoca com AIMessage mock — verifica `brainOutput.fullResponse` e `brainOutput.responseMode` no estado resultante |
| G2 | 12-01-04 | TOOLS-STD-03 | MISSING | Criado `toolsregistry-sdr.test.ts` — verifica que ToolsRegistry configurado como index.ts configura retorna as 3 tools; testa também não-lançamento de ConfigurationError e lançamento correto sem registro |
