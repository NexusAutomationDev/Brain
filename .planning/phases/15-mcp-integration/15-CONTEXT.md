# Phase 15: MCP Integration - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Brain SDR e Brain Echo conectam a servidor MCP externo via ENV (`MCP_URL`, `MCP_TOOLS`, `MCP_AUTH_TOKEN`), carregam MCP tools como `StructuredTool[]` no startup, e as usam no grafo LangGraph junto com as tools nativas. O BrainRunner gerencia o ciclo de vida do cliente MCP (init em `_compileGraph()`, shutdown no SIGTERM) transparentemente — os Brains apenas recebem `ctx.mcpTools[]` e espalham no `bindTools()`.

Fora de escopo: SSE transport (deprecated + bug Bun), múltiplos MCP servers simultâneos, OAuth, reload de MCP tools em runtime sem restart.

</domain>

<decisions>
## Implementation Decisions

### Injeção de MCP tools no grafo (BrainBuildContext)

- **D-01:** `BrainBuildContext` ganha campo `mcpTools: StructuredTool[]` (novo campo em `packages/core/src/brain/interface.ts`). BrainRunner inicializa MultiServerMCPClient em `_compileGraph()`, carrega as MCP tools, e as passa via `ctx.mcpTools` ao chamar `buildGraph(ctx)`.
- **D-02:** Quando `MCP_URL` não está definido, `ctx.mcpTools = []` — nunca `undefined`. Brain espalha o array vazio sem guard: `bindTools([...nativeTools, ...ctx.mcpTools])` é no-op quando vazio.
- **D-03:** Ambos brain-sdr e brain-echo recebem e espalham `ctx.mcpTools`. Padrão para futuros Brains: `buildGraph()` sempre inclui `ctx.mcpTools` em `bindTools()` e `ToolNode()`.

### SIGTERM e lifecycle do cliente MCP

- **D-04:** `BrainRunner` ganha método `async close(): Promise<void>` que fecha o `MultiServerMCPClient` (se inicializado) e aguarda o shutdown limpo. Apenas na classe concreta — não em `IBrainRunnerLike`.
- **D-05:** `BrainRunner.init()` auto-registra o handler SIGTERM: `process.on('SIGTERM', async () => { await this.close(); process.exit(0) })`. SDK cuida do shutdown transparentemente — apps não precisam adicionar código.
- **D-06:** `IBrainRunnerLike` (interface em `handler.ts`) **não** ganha `close()`. Transporte não é responsável pelo lifecycle do cliente MCP.

### MCP_TOOLS semantics

- **D-07:** `MCP_URL` definido + `MCP_TOOLS` ausente ou vazio (`""`) → carregar **todas** as tools do servidor MCP. Sem wildcard `*` — ausente/vazio já é o sinal para "todas".
- **D-08:** `MCP_TOOLS` como CSV filtra por nome exato: `MCP_TOOLS=tool1,tool2` → apenas essas tools são carregadas do servidor MCP.
- **D-09:** `MCP_URL` ausente → `ctx.mcpTools = []`, sem tentativa de conexão. Brain funciona idêntico ao v1.2.

### Autenticação MCP

- **D-10:** Bearer token via `MCP_AUTH_TOKEN` ENV (e.g., `MCP_AUTH_TOKEN=secret123`). BrainRunner passa como header `Authorization: Bearer <token>` ao `MultiServerMCPClient`. Se ausente, conexão sem auth (para servidores locais/sem autenticação).

### Safe ToolNode para PITFALL-2

- **D-11:** Usar `new ToolNode([...tools], { handleToolErrors: true })` — opção built-in do LangGraph. Captura qualquer erro lançado por MCP tool (incluindo timeout) e injeta `ToolMessage` de erro automaticamente, garantindo que todo `AIMessage` com `tool_calls` tem um `ToolMessage` correspondente. Sem código extra.

### PITFALL-1: MultiServerMCPClient e server inacessível

- **D-12:** Defensive catch em `getTools()` ao inicializar o cliente MCP: se o servidor MCP estiver inacessível, `ctx.mcpTools = []` e log de `warn`. Brain inicializa normalmente com tools nativas. Thread de leads existentes não é afetada.

### .env.example

- **D-13:** Adicionar `MCP_URL`, `MCP_TOOLS` e `MCP_AUTH_TOKEN` ao `.env.example` (nos apps brain-sdr e brain-echo) com valores de exemplo e comentários explicativos.

### Transport type

- **D-14:** (Carry-over de STATE.md — não re-discutido) `"streamable_http"` com underscore sempre — hífen causa `ValueError` sem mensagem clara (mcp-adapters #322).

### Claude's Discretion

- Implementação exata do timeout: se `handleToolErrors: true` não capturar timeouts de rede em certos cenários, adicionar `AbortSignal` com timeout (ex: 15s) nas chamadas do MultiServerMCPClient — Claude decide se necessário.
- Localização do `mcpClient` em BrainRunner: campo `private mcpClient: MultiServerMCPClient | null = null` — inicializado em `_compileGraph()` se MCP_URL presente.
- Nome exato do package de adapters MCP: verificar `@langchain/langgraph-adapters` ou `@langchain/mcp-adapters` — usar o que o ecossistema LangGraph recomenda atualmente.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### BrainRunner e BrainBuildContext

- `packages/core/src/runner/runner.ts` — BrainRunner; adicionar `close()`, SIGTERM handler em `init()`, inicializar `MultiServerMCPClient` em `_compileGraph()`, passar `ctx.mcpTools` (D-04, D-05)
- `packages/core/src/brain/interface.ts` — `IBrainBuildContext`; adicionar `mcpTools: StructuredTool[]` (D-01)
- `packages/transport/src/webhook/handler.ts` — `IBrainRunnerLike`; NÃO muda para close() (D-06)

### Brains

- `apps/brain-sdr/src/brain.ts` — adicionar `...ctx.mcpTools` em `bindTools()` e `ToolNode()` (D-03, D-11)
- `apps/brain-echo/src/brain.ts` — idem (D-03, D-11)
- `apps/brain-sdr/src/index.ts` — **não** adicionar SIGTERM handler (D-05, SDK cuida)

### Estado do Grafo

- `packages/ai/src/graph/state.ts` — `BrainStateAnnotation`; NÃO muda nesta fase

### Requirements

- `.planning/REQUIREMENTS.md` §MCP-01 a MCP-05 — definição formal dos requisitos
- `.planning/STATE.md` — pitfalls documentados (PITFALL-1, PITFALL-2) e decisões já tomadas

### .env

- `apps/brain-sdr/.env.example` — adicionar MCP_URL, MCP_TOOLS, MCP_AUTH_TOKEN (D-13)
- `apps/brain-echo/.env.example` — idem

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `BrainStateAnnotation` (`packages/ai/src/graph/state.ts`) — não muda; MCP tools usam o estado existente
- `ToolNode` do `@langchain/langgraph/prebuilt` — já importado em brain-sdr; adicionar `{ handleToolErrors: true }` (D-11)
- `createLogger()` de `@brain-pkg/observability` — já usado em runner.ts; reutilizar para log de warn em PITFALL-1
- `toolsCondition` — já importado em brain-sdr; sem mudança de roteamento

### Established Patterns

- `BrainRunner._compileGraph()` — ponto de inicialização de dependências de I/O (checkpointer, LLM, MemoryManager). MCP client segue o mesmo padrão: inicializado aqui, não no construtor nem por request.
- `process.on('SIGTERM')` não existe hoje em nenhum arquivo — BrainRunner.init() será o primeiro a registrá-lo.
- `ctx.sql!` — brain-sdr já usa this pattern para tools de DB; `ctx.mcpTools` segue padrão similar.
- Fields `private mcpClient: X | null = null` — padrão de campos opcionais já usado em `compiledGraph` e `memoryManager`.

### Integration Points

- `BrainBuildContext` → `buildGraph()` em brain-sdr e brain-echo: adicionar `ctx.mcpTools` ao spread nos dois pontos onde tools são listadas (bindTools e ToolNode)
- `BrainRunner._compileGraph()`: novo bloco de inicialização MCP antes do `buildGraph()` call
- `BrainRunner.init()`: registro de SIGTERM handler **após** `await this._compileGraph()` — garante que o cliente MCP está pronto antes de aceitar shutdown

</code_context>

<specifics>
## Specific Ideas

- Brain SDR pattern de mudança esperada:
  ```ts
  // antes:
  const llmWithTools = ctx.llm.bindTools([boundQualifyTool, boundPauseTool, boundFinishTool])
  const toolNode = new ToolNode([boundQualifyTool, boundPauseTool, boundFinishTool])
  
  // depois:
  const llmWithTools = ctx.llm.bindTools([boundQualifyTool, boundPauseTool, boundFinishTool, ...ctx.mcpTools])
  const toolNode = new ToolNode([boundQualifyTool, boundPauseTool, boundFinishTool, ...ctx.mcpTools], { handleToolErrors: true })
  ```
- `.env.example` entries esperadas:
  ```
  # MCP Integration (opcional — Brain opera sem MCP se MCP_URL não estiver definido)
  # MCP_URL=https://n8n.example.com/mcp
  # MCP_TOOLS=tool1,tool2      # vazio ou ausente = carregar todas as tools
  # MCP_AUTH_TOKEN=<bearer-token>  # ausente = sem autenticação
  ```

</specifics>

<deferred>
## Deferred Ideas

- Múltiplos MCP servers simultâneos (multi-server config) — MCP-F01, pós v1.3
- MCP tools disponíveis globalmente para todos os Brains via config central — MCP-F02, pós v1.3
- Reload de MCP tools em runtime sem restart — MCP-F03, pós v1.3
- AbortSignal com timeout por tool (se handleToolErrors: true não for suficiente) — Claude decide em execução

</deferred>

---

*Phase: 15-mcp-integration*
*Context gathered: 2026-06-16*
