# Phase 12: Brain SDR Integration - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

O Brain SDR é migrado para usar o contrato completo de v1.2 — Output Parser (PARSER-03) e Standard Tools habilitadas por padrão (TOOLS-STD-03). Após esta fase, o Brain SDR retorna `BrainOutput` estruturado em todas as respostas e disponibiliza `pause_session` e `finish_conversation` para o LLM.

Scope: `apps/brain-sdr` (brain.ts, index.ts) e `packages/transport` (webhook handler — resposta ao caller). Nenhuma alteração em `packages/core` ou `packages/shared` (já entregues nas Fases 10 e 11).

</domain>

<decisions>
## Implementation Decisions

### Resposta do Webhook

- **D-01:** O handler do webhook (`packages/transport/src/webhook/handler.ts`) deve ser atualizado para retornar o `BrainOutput` completo ao caller: `{ status: 'ok', fullResponse, responseMode, mediaType?, mediaUrl? }`.
- **D-02:** O campo `reply` atual é **removido** da resposta — não é backward-compat shim; o downstream deve usar `fullResponse` diretamente.
- **D-03:** RabbitMQ **não publica de volta** — apenas consume. O Success Criterion 1 ("RabbitMQ entrega JSON") é satisfeito porque `BrainRunner.run()` retorna `BrainOutput | null` internamente. Publicação de resposta via RabbitMQ permanece Out of Scope (PROJECT.md).

### Binding das Standard Tools

- **D-04:** `createPauseSessionTool(ctx.sql)` e `createFinishConversationTool(ctx.sql)` são criadas **dentro de `buildGraph()`** com closure sobre `ctx.sql` — mesmo padrão do `boundQualifyTool` com closure sobre `ctx.prompts`.
- **D-05:** `sdrBrain.tools[]` **não recebe stubs** das standard tools — permanece `[qualifyLeadTool]`. O campo `tools[]` é informativo para o ToolsRegistry; as standard tools operam via bound direto no ToolNode.
- **D-06:** `enableTool("sdr", "pause_session")` e `enableTool("sdr", "finish_conversation")` são chamados em `apps/brain-sdr/src/index.ts` — serve para registrar os nomes no registry (evitar `ConfigurationError` e respeitar `BRAIN_TOOLS` ENV no futuro se stubs forem adicionados).
- **D-07:** O `ToolNode` no `buildGraph()` passa a receber `[boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool]` — 3 tools.
- **D-08:** `llmWithTools = ctx.llm.bindTools([boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool])` — o LLM tem acesso às 3 tools.

### Nó llm — BrainOutput

- **D-09:** O nó `llm` do `buildGraph()` do brain-sdr é atualizado para setar `state.brainOutput` após `llmWithTools.invoke()` — mesmo padrão do brain-echo (D-07/D-08 da Fase 10):
  ```ts
  const fullResponse = typeof response.content === "string" ? response.content : "";
  return {
    messages: [response],
    brainOutput: { fullResponse, responseMode: "text" as const },
  };
  ```
- **D-10:** O reducer `last-write-wins` do `BrainStateAnnotation` garante que o `brainOutput` final é sempre o da última execução do nó `llm` (resposta definitiva, após tool calls). Nenhum tratamento especial para intermediários com `tool_calls`.

### Prompts SDR

- **D-11:** Os prompts do Brain SDR no banco **não são alterados** nesta fase. O LLM aprende quando usar `pause_session` e `finish_conversation` via tool description das factories (já especificadas na Fase 11). Zero mudanças em seeds ou migrations de prompts.

### Testes

- **D-12:** Apenas **unit tests** atualizados — sem integração com DB real nesta fase.
- **D-13:** `brain.test.ts` é atualizado para verificar:
  - `sdrBrain.tools` ainda tem 1 tool (`qualifyLeadTool`) — `tools[]` não muda
  - `buildGraph(ctx)` com mock de `ctx.sql` cria grafo com 3 tools no ToolNode (qualify, pause, finish)
  - O nó `llm` retorna `brainOutput: { fullResponse, responseMode: 'text' }` no estado
- **D-14:** `ctx.sql` nos testes é um mock simples (objeto vazio ou mock de `Sql`) — não precisa de DB real porque `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` aceitam qualquer `Sql` instance (o banco só é acessado na invocação da tool, não na criação).

### Lint (INFRA-02)

- **D-15:** `apps/brain-sdr/package.json` recebe `"lint": "tsc --noEmit"` — resolve o tech debt INFRA-02 e satisfaz o Success Criterion 4 (`turbo run lint` passa em brain-sdr).

### Claude's Discretion

- Ordem dos bound tools no array passado ao ToolNode e ao `bindTools()` — qualquer ordem é correta
- Mensagem de erro no teste quando `ctx.sql` é undefined/mock — verificar apenas que `buildGraph()` não lança antes da invocação da tool

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §PARSER-03 — Brain SDR migrado para Output Parser
- `.planning/REQUIREMENTS.md` §TOOLS-STD-03 — Brain SDR com pause_session e finish_conversation habilitadas por padrão

### Roadmap
- `.planning/ROADMAP.md` §Phase 12 — 4 success criteria definitivos

### Brain SDR (arquivos a modificar)
- `apps/brain-sdr/src/brain.ts` — buildGraph() recebe extensão do nó llm + 2 bound standard tools + ToolNode com 3 tools
- `apps/brain-sdr/src/index.ts` — 2 novos enableTool() após o qualify_lead
- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — testes atualizados para 3 tools no ToolNode
- `apps/brain-sdr/package.json` — adicionar "lint": "tsc --noEmit"

### Transport (arquivo a modificar)
- `packages/transport/src/webhook/handler.ts` — resposta passa de { reply } para { fullResponse, responseMode, mediaType?, mediaUrl? }
- `packages/transport/src/webhook/handler.test.ts` — atualizar assertion da resposta (de reply para fullResponse)

### Prior Phase Context
- `.planning/phases/10-output-parser-sdk/10-CONTEXT.md` — D-07, D-08: padrão do nó llm montando BrainOutput; D-12: BrainRunner.run() retorna BrainOutput | null
- `.planning/phases/11-tool-contracts-sdk/11-CONTEXT.md` — D-01/D-03: ctx.sql via BrainBuildContext; D-04/D-05: thread_id do RunnableConfig; D-10: Fase 12 responsável pelo enableTool() das standard tools

### Standard Tools SDK (referência — NÃO modificar)
- `packages/core/src/tools/pause-session.ts` — factory `createPauseSessionTool(sql)`, name: "pause_session"
- `packages/core/src/tools/finish-conversation.ts` — factory `createFinishConversationTool(sql)`, name: "finish_conversation"

### brain-echo (referência de migração)
- `apps/brain-echo/src/brain.ts` — padrão completo do nó llm setando brainOutput (D-09 desta fase segue o mesmo padrão)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `boundQualifyTool` pattern em `apps/brain-sdr/src/brain.ts`: closure sobre `ctx.prompts["qualification"]` — padrão idêntico para `createPauseSessionTool(ctx.sql)` e `createFinishConversationTool(ctx.sql)` com closure sobre `ctx.sql`
- `apps/brain-echo/src/brain.ts`: nó llm com `brainOutput: { fullResponse, responseMode: "text" }` — copiar e adaptar
- `packages/core/src/tools/pause-session.ts` e `finish-conversation.ts`: factories prontas, exportadas em `packages/core/src/index.ts`

### Established Patterns
- `ToolNode([boundTool1, boundTool2])` — já em uso com 1 tool; estender para array de 3
- `ctx.llm.bindTools([...])` — guard `if (!ctx.llm.bindTools)` já presente no brain-sdr; manter e passar array estendido
- `process.env.CONTEXT_WINDOW_MESSAGES` parsing em `getContextWindow()` — não muda

### Integration Points
- `apps/brain-sdr/src/index.ts` linhas com `toolsRegistry.enableTool("sdr", "qualify_lead")`: adicionar 2 linhas após
- `packages/transport/src/webhook/handler.ts` linha `return c.json({ status: "ok", reply: result.fullResponse })`: atualizar para retornar campos completos de `result`
- `turbo.json` / workspace config — verificar se `"lint"` está mapeado em turbo para brain-sdr

</code_context>

<specifics>
## Specific Ideas

- A resposta do webhook com BrainOutput completo permite que o cliente downstream (WhatsApp/CRM) tome decisões por `responseMode` — ex: chamar API de TTS se `"audio"`, enviar imagem se `"image"`. Esse era o propósito original do campo.
- A remoção do campo `reply` é intencional (não é backward-compat) — alinhado com a política de breaking changes do projeto (sem deprecation shims).

</specifics>

<deferred>
## Deferred Ideas

- Stubs de `pause_session` / `finish_conversation` em `sdrBrain.tools[]` para filtração via `BRAIN_TOOLS` — decidido manter `tools[]` apenas com `qualifyLeadTool`; filtragem das standard tools via BRAIN_TOOLS é v1.3+
- Testes de integração do POST /api/v1/webhook com DB real — deferido; unit tests com mock são suficientes para esta fase (Success Criterion 3 é validado pela asserção de schema via typecheck + build)
- Atualização dos prompts SDR para instruir o LLM explicitamente sobre pause/finish — deferido; tool description é suficiente

</deferred>

---

*Phase: 12-brain-sdr-integration*
*Context gathered: 2026-06-15*
