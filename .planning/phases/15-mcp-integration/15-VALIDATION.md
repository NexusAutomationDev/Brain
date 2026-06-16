---
phase: 15
slug: mcp-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-16
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in) |
| **Config file** | none — built-in Bun test runner |
| **Quick run command** | `bun test packages/core/src/__tests__/unit/` |
| **Full suite command** | `bun test packages/core/src/__tests__/ && bun test apps/brain-sdr/src/__tests__/` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/__tests__/unit/`
- **After every plan wave:** Run `bun test packages/core/src/__tests__/ && bun test apps/brain-sdr/src/__tests__/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | MCP-01 | — | mcpTools array vazio quando MCP_URL ausente | unit | `bun test packages/core/src/__tests__/unit/mcp-init.test.ts` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 1 | MCP-02 | — | MCP server inacessível → warn log + tools nativas intactas | unit | `bun test packages/core/src/__tests__/unit/mcp-init.test.ts` | ❌ W0 | ⬜ pending |
| 15-01-03 | 01 | 1 | MCP-03 | — | ToolNode handleToolErrors captura erro MCP sem corromper thread | unit | `bun test packages/core/src/__tests__/unit/mcp-tool-error.test.ts` | ❌ W0 | ⬜ pending |
| 15-01-04 | 01 | 2 | MCP-05 | — | SIGTERM → close() → process.exit(0) sem hang | manual | veja Manual-Only | — | ⬜ pending |
| 15-01-05 | 01 | 2 | MCP-01 | — | MCP_TOOLS CSV filtra tools por nome exato | unit | `bun test packages/core/src/__tests__/unit/mcp-init.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/__tests__/unit/mcp-init.test.ts` — stubs para MCP-01, MCP-02, MCP-05
- [ ] `packages/core/src/__tests__/unit/mcp-tool-error.test.ts` — stub para MCP-03
- [ ] Instalar `@langchain/mcp-adapters` em packages/core (se não instalado)

*Wave 0 cobre todos os testes marcados como ❌ W0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SIGTERM encerra sem hang | MCP-04 | Requer sinal de OS ao processo Bun em runtime | 1. Iniciar brain-sdr com MCP_URL configurado. 2. Enviar `kill -SIGTERM <pid>`. 3. Verificar que processo encerra em <3s sem hang. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
