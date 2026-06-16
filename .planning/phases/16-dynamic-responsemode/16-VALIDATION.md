---
phase: 16
slug: dynamic-responsemode
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-16
audited: 2026-06-16
last_verified: 2026-06-16
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in, Jest-compatible API) |
| **Config file** | none — bun test runs without config |
| **Quick run command** | `bun test packages/core/src/tools/__tests__/respond.test.ts` |
| **Full suite command** | `bun test packages/core/ apps/brain-sdr/ apps/brain-echo/` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | RESP-01 / D-06 / D-07 | T-16-03 | ResponseModeSchema rejeita valores fora do enum com ZodError | unit | `bun test packages/core/src/__tests__/unit/output/schema.test.ts` | ✅ | ✅ green |
| 16-01-02 | 01 | 1 | RESP-01 / RESP-02 | T-16-01 / T-16-03 | createRespondTool schema Zod v4 com superRefine — mediaType sem mediaUrl lança ZodError | unit | `bun test packages/core/src/tools/__tests__/respond.test.ts` | ✅ | ✅ green |
| 16-02-01 | 02 | 2 | RESP-01 / RESP-02 / RESP-03 | T-16-08 / T-16-10 | fallback D-10: responseMode "undefined" + warn PITFALL-6; bindTools conta 4 tools nativas | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ | ✅ green |
| 16-02-02 | 02 | 2 | RESP-01 / RESP-02 / RESP-03 | T-16-10 | brain-echo guarda hasMcpTools — ToolNode vazio nunca atingido; routeAfterLlm 3 destinos | unit | `bun test apps/brain-echo/src/__tests__/unit/brain.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — bun test runner já instalado, sem stubs necessários.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LLM real invoca respond tool em produção (end-to-end com provider OpenAI/Anthropic) | RESP-03 | Requer LLM real e variáveis de ambiente de produção | Enviar mensagem via webhook, verificar nos logs que respond tool_call aparece no trace LangSmith |
| docs/guides/response-format-prompt.md conteúdo legível | D-12 | Validação de conteúdo de documentação | Ler o arquivo e verificar seções: schema, fluxo, fallback D-10, guarda hasMcpTools |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 3s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-16

---

## Validation Audit 2026-06-16

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated (manual-only) | 0 |

**Gap resolvido:** `apps/brain-sdr/src/brain.ts:172` — fallback D-10 retornava `responseMode: "text"` em vez de `"undefined"` (discrepância entre SUMMARY self-check e código real). Corrigido via edição direta; 16 testes passando após fix.

---

## Validation Audit 2026-06-16 (re-audit)

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated (manual-only) | 0 |

**Resultado:** 54 testes executados, 0 falhas. Todos os 4 arquivos de teste confirmados verdes. VALIDATION.md consistente com o estado real do código.
