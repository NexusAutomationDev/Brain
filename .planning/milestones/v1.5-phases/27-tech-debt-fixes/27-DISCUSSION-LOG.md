# Phase 27: Tech Debt Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 27-tech-debt-fixes
**Areas discussed:** TECH-01 (BRAIN_TOOLS buildGraph), TECH-02 (FUP E2E test), TECH-03 (transport status no /health)

---

## TECH-01: Como filtrar tools do buildGraph()

| Option | Description | Selected |
|--------|-------------|----------|
| ctx.enabledTools: Set<string> | BrainBuildContext ganha enabledTools — Brain verifica o nome da tool antes de incluir no bindTools(). API simples, sem dependência extra. | ✓ |
| ctx.filterTools(tools[]) | Helper que recebe array de StructuredTool e retorna só os habilitados. Encapsula o .filter(). | |
| ToolsRegistry.isEnabled(brainType, toolName) | ToolsRegistry ganha método e é injetado em ctx. Mais verbose. | |

**User's choice:** ctx.enabledTools: Set<string>
**Notes:** Implementação mais simples. Brain mantém controle explícito sobre sua lógica de filtragem.

---

## TECH-01 (follow-up): Filtrar ctx.mcpTools também?

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, filtrar ctx.mcpTools também | BRAIN_TOOLS como whitelist global — nativas + MCP filtradas. Comportamento consistente. | ✓ |
| Não, MCP fora do filtro | MCP configurado via ENV separado — tratar como capacidade externa. | |

**User's choice:** Sim, filtrar ctx.mcpTools também
**Notes:** BRAIN_TOOLS é whitelist global para o LLM, independente da origem da tool.

---

## TECH-02: O que o teste E2E do FUP deve cobrir?

| Option | Description | Selected |
|--------|-------------|----------|
| Scheduler lifecycle + DB state | FupScheduler.tick() + verificação de fup_step/fup_next_at no banco real. LLM mockado. | ✓ |
| Somente writes/reads do LeadService | Apenas getNextValidSlot() + upsertLead() contra banco. Não cobre o tick do scheduler. | |
| FUP completo com LLM real | Scheduler + LLM real. Custo de API + dependência de rede. | |

**User's choice:** Scheduler lifecycle + DB state
**Notes:** Cobre FUP-02 sem custo de API. LLM mockado é suficiente para verificar comportamento do scheduler.

---

## TECH-02 (follow-up): Quantos FUP steps o teste deve cobrir?

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-step: até ia_ativada=false | Ticks até último step, verificar fup_enabled=false + ia_ativada=false (FUP-05). | ✓ |
| Single step: só o primeiro tick | fup_step=1 + fup_next_at correto. Mais simples mas não cobre o fluxo completo. | |

**User's choice:** Multi-step: até ia_ativada=false
**Notes:** Um único teste cobre FUP-02 e FUP-05 — eficiente.

---

## TECH-03: Como o transport reporta status ao health endpoint?

| Option | Description | Selected |
|--------|-------------|----------|
| ITransport ganha getStatus() | Adiciona getStatus(): TransportStatus à interface. createHealthApp() aceita ITransport opcional. | ✓ |
| StatusProvider via callback | createHealthApp() recebe getTransportStatus?: () => TransportStatus. Menor acoplamento. | |

**User's choice:** ITransport ganha getStatus()
**Notes:** Mais idiomático — transport é um objeto com comportamento, getStatus() é comportamento do transport.

---

## TECH-03 (follow-up): HTTP status quando transport desconectado?

| Option | Description | Selected |
|--------|-------------|----------|
| 503 (degraded = service unavailable) | Transport desconectado = Brain não processa mensagens. Sinaliza para LB tirar da rotação. | ✓ |
| 200 com status=degraded | RabbitMQ tem auto-reconnect — pode ser transitório. Evita restart desnecessário. | |

**User's choice:** 503
**Notes:** Transport é crítico para o funcionamento do Brain. 503 é o comportamento correto.

---

## Claude's Discretion

- Nomenclatura exata do tipo TransportStatus e local de exportação
- Estratégia de limpeza do banco no teardown do teste E2E
- Como RabbitMQTransport rastreia estado de conexão internamente

## Deferred Ideas

Nenhuma.
