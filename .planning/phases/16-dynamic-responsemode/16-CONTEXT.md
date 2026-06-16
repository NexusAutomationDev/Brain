# Phase 16: Dynamic responseMode - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Implementar `createRespondTool()` (schema-as-tool) e integrá-la no grafo do brain-sdr e brain-echo, de forma que o LLM escolha `responseMode` (undefined/text/audio/image/file/video) dinamicamente via tool call — sem `responseMode: "text" as const` hardcoded no código.

O approach central foi definido antes desta fase (STATE.md): schema-as-tool via `createRespondTool()` + nó `respond` + router customizado, porque:
- `withStructuredOutput()` é incompatível com `bindTools()` (langchainjs #7757)
- `responseFormat` de `createReactAgent` reescreve `fullResponse` com segunda chamada LLM (LangGraph #4756)

**Fora de escopo:** splitResponse (divisão em múltiplos balões), novos providers além de OpenAI/Anthropic, canal de resposta RabbitMQ com responseMode, migration de system prompt.

</domain>

<decisions>
## Implementation Decisions

### Router customizado (substitui toolsCondition)

- **D-01:** O router customizado substitui `toolsCondition` em brain-sdr e brain-echo. Lógica: inspecionar `tool_calls` do último AIMessage:
  - Se tool_call com nome `"respond"` → rota para nó `"respond"`
  - Se tool_calls com outros nomes (qualify_lead, pause_session, finish_conversation, MCP tools) → rota para nó `"tools"`
  - Se nenhuma tool_call (texto plano) → rota para `"__end__"` (fallback PITFALL-6)
- **D-02:** O nó `"respond"` executa via ToolNode contendo apenas a respond tool — `ToolMessage` vai para `state.messages` para manter consistência de paridade `AIMessage/ToolMessage` no PostgresSaver/LangGraph.

### Schema da respond tool

- **D-03:** Schema da respond tool (Zod em `createRespondTool()`):
  ```typescript
  {
    fullResponse: z.string(),                                           // obrigatório sempre
    responseMode: z.enum(["undefined", "text", "audio"]),             // obrigatório; default "undefined"
    mediaType: z.enum(["image", "file", "video", "audio"]).optional(), // obrigatório quando mediaUrl presente
    mediaUrl: z.string().url().optional(),                             // obrigatório quando mediaType presente; https:// + extensão
  }
  ```
  Validação condicional: se `mediaType` presente → `mediaUrl` obrigatório (e vice-versa).
- **D-04:** `responseMode: "undefined"` é um valor explícito — o LLM o usa quando não há preferência de formato específica. É adicionado ao `ResponseMode` type em `packages/shared`.
- **D-05:** `mediaType: "file"` é mapeado para `"document"` no nó `respond` antes de passar para `BrainOutputSchema.parse()` — o `BrainOutput` não tem "file" em `ResponseMode`, tem "document".

### ResponseMode — mudança no contrato

- **D-06:** `ResponseMode` em `packages/shared/src/types/index.ts` ganha `"undefined"` como valor válido:
  ```typescript
  export type ResponseMode = "undefined" | "text" | "image" | "audio" | "video" | "document";
  ```
- **D-07:** `ResponseModeSchema` em `packages/core/src/output/schema.ts` é atualizado para incluir `"undefined"` no enum Zod.
- **D-08:** `BrainOutputSchema` não precisa de mudança adicional — `"undefined"` não requer `mediaType`/`mediaUrl` (cai fora de `MODES_REQUIRING_MEDIA`).

### Localização de createRespondTool

- **D-09:** `createRespondTool()` fica em `packages/core` (mesmo package de `createPauseSessionTool` e `createFinishConversationTool`). Exportado pelo barrel `packages/core/src/index.ts`. Brain SDR e Brain Echo importam de `@brain-pkg/core`.

### PITFALL-6: texto plano sem tool call

- **D-10:** Quando o LLM emite texto plano (sem `tool_calls`), o router cai no branch `"__end__"`. O nó `"llm"` detecta isso e seta `state.brainOutput` com:
  ```typescript
  { fullResponse: response.content as string, responseMode: "undefined" }
  ```
  Comportamento degradado (não erro) — PITFALL-6 é logado como warn.
- **D-11:** O system prompt do brain-sdr **não precisa de atualização** via migration SQL. A descrição da respond tool em `createRespondTool()` instrui o LLM sobre quando e como chamá-la — `bindTools()` passa essa informação automaticamente. `ON CONFLICT DO NOTHING` do seed impede re-seed em produção.

### docs/guides/response-format-prompt.md

- **D-12:** O arquivo `docs/guides/response-format-prompt.md` **será recriado** como parte desta fase. O conteúdo atual é desatualizado (referencia `response_format` da API e `splitResponse` que não fazem parte da abordagem atual). O novo arquivo documenta a abordagem schema-as-tool com `createRespondTool()`.

### Claude's Discretion

- Implementação exata do `mediaUrl` pattern de validação: regex no Zod ou apenas `z.string().url()` — Claude decide baseado no que o LangGraph repassa ao LLM como JSON Schema.
- Lógica do fallback em D-10: o nó `llm` pode verificar `response.content !== ""` antes de setar brainOutput com "undefined" — se content for vazio, emitir warn mais específico.
- Nomenclatura interna do router: `routeAfterLlm(state)` — Claude decide nome exato.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tipos e Schema

- `packages/shared/src/types/index.ts` — `ResponseMode` type; adicionar `"undefined"` (D-04, D-06)
- `packages/core/src/output/schema.ts` — `ResponseModeSchema` e `BrainOutputSchema`; adicionar `"undefined"` ao enum (D-07, D-08)
- `packages/core/src/index.ts` — barrel exports; exportar `createRespondTool` (D-09)

### Brains

- `apps/brain-sdr/src/brain.ts` — nó `llm` (remover `responseMode: "text" as const`), adicionar router customizado, adicionar nó `respond`, adicionar `createRespondTool()` em `bindTools()` e ToolNode de respond (D-01, D-02, D-10)
- `apps/brain-echo/src/brain.ts` — idem

### Tool Factory (a criar)

- `packages/core/src/tools/respond.ts` (novo arquivo) — `createRespondTool()` factory (D-03, D-09)

### Documentação

- `docs/guides/response-format-prompt.md` — RECRIAR com abordagem schema-as-tool (D-12)

### Requirements e State

- `.planning/REQUIREMENTS.md` §RESP-01 a RESP-03 — requisitos formais desta fase
- `.planning/STATE.md` — decisão de schema-as-tool e PITFALL-6 já documentados

### Pitfalls (existentes, aplicáveis)

- `langchainjs #7757` — `withStructuredOutput()` incompatível com `bindTools()` — NÃO usar
- `LangGraph #4756` — `responseFormat` do `createReactAgent` reescreve `fullResponse` — NÃO usar
- PITFALL-6 (STATE.md) — LLM pode emitir texto plano; mitigado por D-10 (fallback) + descrição clara na tool

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `createPauseSessionTool()` e `createFinishConversationTool()` (`packages/core/src/tools/`) — padrão de factory de tool com closure; `createRespondTool()` segue o mesmo padrão
- `ToolNode` com `{ handleToolErrors: true }` — já usado em brain-sdr e brain-echo para MCP tools; nó `respond` usa ToolNode **sem** `handleToolErrors: true` (resposta deve falhar explicitamente se schema inválido)
- `BrainStateAnnotation.brainOutput` (`packages/ai/src/graph/state.ts`) — campo existente que o nó `respond` vai setar; reducer last-write-wins já configurado
- `extractTokenUsage()` (`@brain-pkg/ai`) — já importado em brain-sdr e brain-echo; nó `respond` NÃO precisa chamar — tokenUsage já foi capturado no nó `llm`

### Established Patterns

- `toolsCondition` (`@langchain/langgraph/prebuilt`) — será **substituído** pelo router customizado em ambos os Brains; sem impacto em `ToolNode` de tools nativas
- `ctx.mcpTools` spread (`D-02, D-03 da Fase 15`) — padrão já estabelecido; `createRespondTool()` é adicionado da mesma forma
- Tool factories com closure sobre `ctx.sql` — `createRespondTool()` NÃO precisa de sql (apenas define o schema e loga); factory é stateless

### Integration Points

- `apps/brain-sdr/src/brain.ts:69` — `llmWithTools = ctx.llm.bindTools([...])`: adicionar `createRespondTool()` ao array
- `apps/brain-sdr/src/brain.ts:70` — `new ToolNode([...])` do nó "tools": **não** adicionar respond tool aqui (respond tem seu próprio ToolNode)
- `apps/brain-sdr/src/brain.ts:90` — `responseMode: "text" as const`: **remover**; o nó llm não seta mais responseMode (exceto no fallback D-10)
- `apps/brain-sdr/src/brain.ts` grafo — `.addConditionalEdges("llm", toolsCondition, ...)`: substituir por `.addConditionalEdges("llm", routeAfterLlm, ["tools", "respond", "__end__"])`
- `packages/core/src/tools/` — criar `respond.ts` com `createRespondTool()` (verificar se pasta já existe)

</code_context>

<specifics>
## Specific Ideas

- Schema exato definido pelo usuário para a respond tool:
  ```json
  {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["fullResponse", "responseMode"],
    "properties": {
      "mediaType": {
        "type": "string",
        "enum": ["image", "file", "video", "audio"],
        "description": "Tipo da mídia enviada em mediaUrl. Obrigatório quando mediaUrl estiver presente."
      },
      "mediaUrl": {
        "type": "string",
        "pattern": "^https://.*\\.(mp3|mp4|pdf|png|jpg|jpeg|gif|webp|wav|ogg|mov|avi|webm)$",
        "description": "URL direta de download de um arquivo de mídia."
      },
      "fullResponse": {
        "type": "string",
        "description": "Mensagem completa da resposta em formato contínuo, sem divisões."
      },
      "responseMode": {
        "type": "string",
        "enum": ["undefined", "text", "audio"],
        "default": "undefined",
        "description": "Modo de entrega da resposta. Use 'undefined' quando não há preferência de formato específica."
      }
    },
    "if": { "properties": { "mediaType": { "type": "string" } }, "required": ["mediaType"] },
    "then": { "required": ["mediaUrl"] }
  }
  ```
- Fluxo no brain-sdr com respond tool:
  ```
  __start__ → llm → routeAfterLlm:
    ├── "respond"  → [respond ToolNode]     → __end__
    ├── "tools"    → [tools ToolNode]        → llm (ReAct loop)
    └── "__end__"  → (fallback: brainOutput com responseMode "undefined")
  ```

</specifics>

<deferred>
## Deferred Ideas

- `splitResponse`: divisão de resposta em múltiplos balões (mencionada em docs/guides/response-format-prompt.md antigo) — feature separada, não faz parte do escopo de responseMode
- `responseMode: "image"` com geração de imagem via URL externa — mediaUrl suportado no schema da tool, mas integração com gerador de imagem (ex: DALL-E) é feature futura
- Canal de resposta RabbitMQ com `responseMode` + `mediaUrl` (RESP-F02) — pós v1.3

</deferred>

---

*Phase: 16-dynamic-responsemode*
*Context gathered: 2026-06-16*
