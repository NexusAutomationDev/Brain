# Phase 11: Tool Contracts SDK - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 11-tool-contracts-sdk
**Areas discussed:** DB injection nas standard tools, Lead identification dentro da tool, BRAIN_TOOLS ENV — ponto de integração, Quem registra as standard tools

---

## DB injection nas standard tools

| Option | Description | Selected |
|--------|-------------|----------|
| Factory functions no SDK | SDK exporta `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` — quem monta o Brain chama as factories passando o sql | |
| Via BrainBuildContext | BrainBuildContext ganha campo `sql: Sql` — buildGraph() recebe sql, cria tools bound com closure, mesmo padrão de boundQualifyTool | ✓ |
| BrainRunner injeta diretamente | BrainRunner cria as standard tools em _compileGraph() com seu sql e adiciona ao ctx.tools antes de buildGraph() | |

**User's choice:** Via BrainBuildContext

---

| Option | Description | Selected |
|--------|-------------|----------|
| sql opcional no contexto | `BrainBuildContext` ganha `sql?: Sql` — campo opcional, brain-echo não quebra | ✓ |
| sql obrigatório no contexto | `sql: Sql` sempre presente, todos os builds mudam de assinatura | |
| Context separado para tools de DB | `ToolBuildContext` separado como segundo argumento | |

**User's choice:** sql opcional (`sql?: Sql`)

---

## Lead identification dentro da tool

| Option | Description | Selected |
|--------|-------------|----------|
| thread_id via RunnableConfig | LangGraph passa RunnableConfig para cada tool; thread_id = lead.uniqueId; tool lê config.configurable.thread_id | ✓ |
| lead_id como parâmetro da tool | LLM fornece lead_id no tool call — risco de alucinação | |
| BrainStateAnnotation ganha leadId | Adicionar campo ao state do grafo, BrainRunner injeta no invoke() | |

**User's choice:** thread_id via RunnableConfig

---

| Option | Description | Selected |
|--------|-------------|----------|
| `tool(async (args, config) => {...})` | Segundo argumento é RunnableConfig com configurable.thread_id | ✓ |
| Claude decide o padrão exato | Desde que use RunnableConfig e não dependa de parâmetro do LLM | |

**User's choice:** `tool(async (args, config) => {...})` — padrão explícito com segundo argumento

---

## BRAIN_TOOLS ENV — ponto de integração

| Option | Description | Selected |
|--------|-------------|----------|
| enableTool() ignora silenciosamente | ToolsRegistry.enableTool() lê BRAIN_TOOLS no momento da chamada; ignora silenciosamente se não está na whitelist | ✓ |
| getTools() aplica o filtro | Filtro tardio na compilação do grafo; enableTool() aceita tudo | |
| BrainRunner lê BRAIN_TOOLS e decide quais enableTool() chamar | Centraliza no runner, muda responsabilidade do Brain para o runner | |

**User's choice:** enableTool() ignora silenciosamente

---

| Option | Description | Selected |
|--------|-------------|----------|
| BRAIN_TOOLS ausente = whitelist desabilitada | enableTool() só aplica filtro se BRAIN_TOOLS está definido; comportamento atual mantido quando ausente | ✓ |
| BRAIN_TOOLS deve ter um default | Lista padrão definida no SDK quando BRAIN_TOOLS ausente | |

**User's choice:** BRAIN_TOOLS ausente = whitelist desabilitada (zero impacto em Brains existentes)

---

## Quem registra as standard tools

| Option | Description | Selected |
|--------|-------------|----------|
| Fase 12 faz o registro explicitamente | Fase 11 disponibiliza no SDK; Fase 12 habilita no Brain SDR via enableTool() | ✓ |
| SDK auto-registra para todos os brainTypes | Import automático registra em todos os brainTypes | |
| BrainRunner auto-registra se BRAIN_TOOLS inclui o nome | BrainRunner.init() lê BRAIN_TOOLS e chama enableTool() para standard tools na whitelist | |

**User's choice:** Fase 12 faz o registro explicitamente (TOOLS-STD-03 é req da Fase 12)

---

| Option | Description | Selected |
|--------|-------------|----------|
| SDK exporta as tool instances prontas | Instâncias StructuredTool sem sql; Brain cria bound em buildGraph() com ctx.sql | |
| SDK exporta factories que retornam StructuredTool | `createPauseSessionTool(sql)` — Brain inclui resultado em tools[] | |
| Claude decide o padrão de export | Desde que funcione com ctx.sql via BrainBuildContext, planejador define formato | ✓ |

**User's choice:** Claude decide o padrão de export

---

## Claude's Discretion

- Formato de export das standard tools (instâncias vs factories)
- Localização dos arquivos de tool dentro de `packages/core/src/tools/`
- API dos novos métodos do LeadService (`setFullpp`, `setIaAtivada`)
- Mensagem de retorno das tools para o LLM quando bem-sucedidas

## Deferred Ideas

- `BRAIN_TOOLS_DISABLED` (blacklist) — whitelist é suficiente para v1.2
- Auto-registration de standard tools para todos os brainTypes
- BrainRunner auto-registrando tools via BRAIN_TOOLS no init()
- LeadService com retry/circuit breaker nos updates
