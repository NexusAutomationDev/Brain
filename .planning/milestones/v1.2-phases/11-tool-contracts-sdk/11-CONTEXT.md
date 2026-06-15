# Phase 11: Tool Contracts SDK - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

O SDK disponibiliza `pause_session` e `finish_conversation` como tools padrão em `packages/core/tools`, e adiciona suporte a `BRAIN_TOOLS` ENV para whitelist de tools em runtime. Após esta fase, qualquer Brain pode habilitar essas tools via `enableTool()` — e um operador pode restringir quais tools estão ativas via ENV sem mudar código.

Scope: `packages/core` (tools + registry), `packages/shared` (LeadService methods adicionais se necessário). Brain SDR não é migrado nesta fase — isso é Fase 12.

</domain>

<decisions>
## Implementation Decisions

### DB Injection nas Standard Tools

- **D-01:** `BrainBuildContext` ganha campo `sql?: Sql` — opcional para não quebrar brain-echo e outros Brains que não usam tools de DB.
- **D-02:** O `buildGraph()` do Brain recebe `ctx.sql` e é responsável por criar as tools "bound" com acesso ao banco, seguindo o mesmo padrão de `boundQualifyTool` (closure sobre `ctx.prompts` no Brain SDR).
- **D-03:** `BrainRunner._compileGraph()` já tem `this.sql` — passa para `BrainBuildContext` como `sql: this.sql`.

### Lead Identification dentro das Tools

- **D-04:** Tools leem o `thread_id` do `RunnableConfig` recebido como segundo argumento — padrão LangChain: `tool(async (args, config) => { const threadId = config?.configurable?.thread_id; ... })`.
- **D-05:** `thread_id` = `lead.uniqueId` (IDLead canonical), conforme estabelecido pelo BrainRunner. A tool usa esse valor como `unique_id` na query ao banco — sem risco de alucinação do LLM.
- **D-06:** Tools **não** recebem `lead_id` como parâmetro do LLM — o schema das tools não inclui identificador de lead.

### BRAIN_TOOLS ENV — Ponto de Integração

- **D-07:** `ToolsRegistry.enableTool()` lê `process.env.BRAIN_TOOLS` no momento da chamada. Se `BRAIN_TOOLS` está definido e a tool **não** está na lista, ignora silenciosamente sem lançar erro.
- **D-08:** Se `BRAIN_TOOLS` está **ausente**, `enableTool()` funciona exatamente como antes — zero impacto em brain-echo e brain-sdr existentes (TOOLS-ENV-02).
- **D-09:** `BRAIN_TOOLS` é uma whitelist CSV: ex. `BRAIN_TOOLS=pause_session,finish_conversation`. Parse: `process.env.BRAIN_TOOLS?.split(",").map(s => s.trim())`.

### Registro das Standard Tools

- **D-10:** Fase 11 **apenas disponibiliza** as tools no SDK. Fase 12 é responsável por habilitar `pause_session` e `finish_conversation` no Brain SDR via `enableTool()` (TOOLS-STD-03 é req da Fase 12).
- **D-11:** O formato de export das tools (instâncias prontas vs factories) fica a critério do planejador — desde que `pause_session` e `finish_conversation` estejam em `packages/core/tools` e funcionem com `ctx.sql` via `BrainBuildContext`.

### Claude's Discretion

- Formato de export das standard tools: instâncias StructuredTool vs factories `createPauseSessionTool(sql)` — planejador decide o que melhor se encaixa com o padrão LangChain/BrainBuildContext.
- Localização dos arquivos de tool: `packages/core/src/tools/pause-session.ts`, `finish-conversation.ts` (ou similar).
- Métodos adicionais no `LeadService` para `setFullpp()` e `setIaAtivada()` — planejador define a API.
- Mensagem de retorno das tools quando bem-sucedidas (string de status para o LLM).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §TOOLS-ENV-01, §TOOLS-ENV-02, §TOOLS-STD-01, §TOOLS-STD-02 — requirements mapeados para esta fase

### Roadmap
- `.planning/ROADMAP.md` §Phase 11 — success criteria definitivos (4 critérios com checagem exata)

### Core SDK (arquivos a modificar)
- `packages/core/src/tools/registry.ts` — ToolsRegistry.enableTool() recebe a lógica BRAIN_TOOLS
- `packages/core/src/brain/interface.ts` — BrainBuildContext ganha campo sql?: Sql
- `packages/core/src/index.ts` — barrel; novas tools devem ser exportadas
- `packages/core/src/leads/lead-service.ts` — LeadService pode precisar de novos métodos (setFullpp, setIaAtivada)

### AI Package (referência)
- `packages/ai/src/graph/state.ts` — BrainStateAnnotation; NÃO modificar nesta fase (leadId não vai para o state)

### Brain SDR (referência — NÃO migrar nesta fase)
- `apps/brain-sdr/src/brain.ts` — padrão boundQualifyTool com closure; referência para como as standard tools devem ser bound com sql

### Prior Phase Context
- `.planning/phases/10-output-parser-sdk/10-CONTEXT.md` — decisões do BrainOutput; D-13 (Deferred): pause/end pertence às tools, não ao responseMode

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ToolsRegistry` (`packages/core/src/tools/registry.ts`) — `enableTool()`, `getTools()`, `disableTool()` já implementados; apenas `enableTool()` recebe nova lógica
- `LeadService` (`packages/core/src/leads/lead-service.ts`) — tem `upsertLead()`; precisa de novos métodos para atualizar `fullpp` e `ia_ativada`
- `ConfigurationError` em `@brain-pkg/shared` — disponível para erros de configuração nas tools

### Established Patterns
- Closure sobre `sql` em `buildGraph()`: `boundQualifyTool` no Brain SDR injeta deps via closure sobre `ctx.prompts`. Mesmo padrão para standard tools com `ctx.sql`.
- `tool(async (args, config) => {...})` do `@langchain/core/tools` — passagem de `RunnableConfig` como segundo argumento é o padrão LangChain.
- ENV parsing: `process.env.CONTEXT_WINDOW_MESSAGES` no brain-sdr — mesmo padrão CSV para `BRAIN_TOOLS`.

### Integration Points
- `BrainRunner._compileGraph()` — já tem `this.sql`; ponto onde `ctx` é montado (linha ~220 do runner.ts); adicionar `sql: this.sql` ao `BrainBuildContext`
- `packages/core/src/index.ts` — barrel de exports; novas tools devem ser adicionadas como exports nomeados explícitos
- `ToolsRegistry.enableTool()` — único ponto de entrada para whitelist; filtro ENV vai aqui

</code_context>

<specifics>
## Specific Ideas

- `pause_session` altera `leads.fullpp = false` — semanticamente: pausa a sessão (human takeover)
- `finish_conversation` altera `leads.ia_ativada = false` AND `leads.fullpp = false` — semanticamente: encerra definitivamente a conversa automatizada
- Ambas as tools retornam string de status para o LLM saber que a ação foi executada
- `BRAIN_TOOLS` ausente = whitelist desabilitada = comportamento atual inalterado (zero breaking change)

</specifics>

<deferred>
## Deferred Ideas

- `BRAIN_TOOLS_DISABLED` (lista de exclusão / blacklist) — decidido que whitelist (`BRAIN_TOOLS`) é suficiente para v1.2 (já em REQUIREMENTS.md Out of Scope)
- Auto-registration de standard tools para todos os brainTypes — opt-in explícito (enableTool()) preferido
- BrainRunner auto-registrando tools via BRAIN_TOOLS no init() — responsabilidade mantida no Brain/Fase 12
- Métodos `LeadService.setFullpp()` e `LeadService.setIaAtivada()` com retry/circuit breaker — overshooting para v1.2

</deferred>

---

*Phase: 11-tool-contracts-sdk*
*Context gathered: 2026-06-15*
