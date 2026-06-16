# Research Summary — v1.3 MCP Integration + Dynamic responseMode

## Stack Additions

| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@langchain/mcp-adapters` | `^1.1.3` | `MultiServerMCPClient` — converte MCP tool schemas em `StructuredTool[]` para LangGraph | NOVO — instalar em `packages/core` |
| `@langchain/anthropic` | `^1.4.0` | Anthropic Claude provider com `bindTools()` | JÁ INSTALADO — sem mudança |

> Install: `cd packages/core && bun add @langchain/mcp-adapters`
> `@modelcontextprotocol/sdk` é transitivo via mcp-adapters — NÃO adicionar diretamente.

---

## Critical Architecture Decisions

**1. Schema-as-tool para responseMode — não `responseFormat`, não `withStructuredOutput` no LLM do agente**

`withStructuredOutput()` e `bindTools()` são mutuamente exclusivos na mesma instância LLM (langchainjs #7757, aberto, triage: high-impact). `createReactAgent`'s `responseFormat` dispara uma segunda chamada LLM que reescreve `fullResponse` (LangGraph #4756).

Padrão correto (schema-as-tool):
- Criar `createRespondTool()` em `packages/core/src/tools/respond.ts` — `tool()` cujo schema espelha `BrainOutputSchema`
- Vincular via `bindTools()` apenas: `ctx.llm.bindTools([...realTools, respondTool])`
- Adicionar nó `respond` que extrai `respondCall.args` e escreve `brainOutput` no state
- Substituir `toolsCondition` por router customizado: se `tool_call.name === "respond"` → nó `respond`; senão → nó `tools`
- Grafo passa de 2 para 3 nós: `llm → [router] → tools → llm` ou `→ respond → __end__`

**2. MCP client lifecycle dentro de `BrainRunner._compileGraph()`**

`MultiServerMCPClient` inicializa uma vez por processo. `_compileGraph()` já é o único ponto onde `llm`, `checkpointer` e `tools` são conectados. Fluxo:

```
_compileGraph():
  getTools(registry)
  → SE MCP_URL: initMCPClient → getFilteredTools() [com defensive catch → []]
  → allTools = [...brainTools, ...mcpTools]
  → BrainBuildContext(allTools) → buildGraph() → compile()
```

Armazenar `this.mcpClient` no runner para `close()` no SIGTERM. Sem mudanças em `IBrain` ou `BrainBuildContext`.

**3. `brain-sdr/src/brain.ts` deve espalhar `ctx.tools` em `ToolNode` e `bindTools()`**

Atualmente `brain.ts` constrói tools inline e nunca usa `ctx.tools`. MCP tools não podem ser closure-bound. Fix:

```typescript
new ToolNode([boundQualifyTool, boundPauseSession, boundFinishConversation, ...ctx.tools])
ctx.llm.bindTools([boundQualifyTool, boundPauseSession, boundFinishConversation, ...ctx.tools, respondTool])
```

**4. Transport: `"streamable_http"` (underscore), nunca `"streamable-http"` (hífen)**

O hífen lança `ValueError` no startup sem mensagem óbvia. Usar constante tipada: `const MCP_TRANSPORT = "streamable_http" as const`. Bug confirmado em mcp-adapters #322.

**5. Streamable HTTP sempre, SSE nunca**

SSE está deprecated no spec MCP (março 2025). n8n v1.99+ usa Streamable HTTP em `/mcp/{id}`. SSE também aciona bug do Bun (`ReferenceError: EventSource is not defined`). Streamable HTTP usa `fetch` nativo — sem problemas no Bun.

---

## Must-Have Features

### MCP Integration — Table Stakes

| Feature | Notas |
|---------|-------|
| `MultiServerMCPClient` inicializado uma vez em `_compileGraph()` | Não por request — overhead não trivial |
| `getTools()` filtrado por `MCP_TOOLS` CSV ENV | `MCP_TOOLS` vazio + `MCP_URL` presente → fail-fast |
| Defensive catch em `getTools()` retornando `[]` | Nunca deixar falha MCP apagar tools nativas do Brain |
| Descrições das MCP tools injetadas no system prompt | LLM precisa de contexto para saber quando chamá-las |
| `client.close()` no SIGTERM | Previne hang do processo Bun durante deploy rolling |
| `MCP_URL` ausente → pular MCP completamente, sem falha | MCP é puramente aditivo para Brains que não precisam |
| `transport: "streamable_http"` via constante tipada | Nunca depender de auto-negociação em produção |

### responseMode Dinâmico — Table Stakes

| Feature | Notas |
|---------|-------|
| `createRespondTool()` em `packages/core/src/tools/respond.ts` | Schema espelha `BrainOutputSchema` |
| Vinculado via `bindTools()` apenas, não `withStructuredOutput()` | Evita incompatibilidade langchainjs #7757 |
| Router customizado detectando chamada ao tool `respond` | Substitui `toolsCondition` |
| Nó `respond` escrevendo `brainOutput` no state | Extração pura — sem chamada LLM |
| `brainOutput: { responseMode: "text" }` estático removido do nó `llm` | v1.2 hardcodava isso — deve ser removido |
| System prompt instrui LLM a chamar `respond` como ação final | Sem isso, modelo pode emitir texto plano (SO-03) |
| `BrainOutputSchema.parse()` no nó `respond` | Valida campos ausentes/inválidos |

---

## Critical Pitfalls

**PITFALL-1 (CRÍTICO): MCP-03 — Perda silenciosa de tools quando n8n falha**

`MultiServerMCPClient` descarta tools de TODOS os servidores quando qualquer servidor falha. Tools nativas do Brain podem ser apagadas silenciosamente. Confirmado GitHub issue #492.

Prevenção:
```typescript
const mcpTools = await client.getTools().catch(() => []);
const allTools = [...brainTools, ...mcpTools]; // brainTools sempre presentes
```

**PITFALL-2 (ALTO): SO-04 — Timeout de MCP tool corrompe thread permanentemente**

Se uma MCP tool tiver timeout, ToolNode pode não escrever `ToolMessage` para o tool_call pendente. Checkpoint salvo com `AIMessage` sem par → `INVALID_CHAT_HISTORY` permanente para aquele lead.

Prevenção: Wrapper seguro do ToolNode que garante `ToolMessage` para cada `tool_call_id`, mesmo em erro.

**PITFALL-3 (ALTO): withStructuredOutput + bindTools incompatibilidade (langchainjs #7757)**

Aplicar ambos no mesmo LLM descarta silenciosamente os schemas das tools. Sem erro. Prevenção: nunca usar `withStructuredOutput()` no LLM do agente; usar exclusivamente schema-as-tool.

**PITFALL-4 (ALTO): MCP-02 — Typo no transport name causa falha no startup**

`"streamable-http"` (hífen) é inválido. Usar `const MCP_TRANSPORT = "streamable_http" as const`.

**PITFALL-5 (ALTO): BUN-02 — MCP client trava processo Bun no SIGTERM**

Conexões HTTP abertas pelo `MultiServerMCPClient` bloqueiam SIGTERM por até 30s. Handler obrigatório:
```typescript
process.on("SIGTERM", async () => { await runner.close(); process.exit(0); });
```

**PITFALL-6 (ALTO): SO-03 — Modelo pula chamada ao tool `respond`**

LLM pode emitir texto plano em vez de chamar `respond` → `brainOutput` undefined → `BrainOutputValidationError`. Prevenção: instrução forte no system prompt + fallback `withStructuredOutput()` como recuperação.

**PITFALL-7 (ALTO): SO-01 — `responseFormat` em `createReactAgent` reescreve `fullResponse`**

Segunda chamada LLM altera a mensagem. Usuário recebe texto diferente do original. Não usar `responseFormat`. Usar schema-as-tool.

---

## Suggested Build Order

**Phase 14 — TD-01 Fix** (0.5 dias)
`qualifier.ts` + `prepare: false`. Isolado, blocker de produção, deploy imediato.

**Phase 15 — MCP Integration** (1.5–2 dias)
`@langchain/mcp-adapters` → `MCPClientManager` → `BrainRunner._compileGraph()` → SIGTERM handler → `brain.ts` espalha `ctx.tools`.

**Phase 16 — Dynamic responseMode** (1–1.5 dias)
`createRespondTool()` → nó `respond` → router customizado → remover `responseMode: "text"` hardcoded → atualizar system prompt seed.

**Total estimado: 3–4 dias.**

---

## Open Questions

1. **`MCP_TOOLS` vazio mas `MCP_URL` presente** — fail-fast (recomendado) vs carregar tudo?
2. **Colisão de nomes MCP vs Brain-native** — prefixar `mcp_` ou validar no startup?
3. **Degradação graciosa vs. fail-fast em startup MCP** — recomendação: warn e continuar com zero MCP tools.
4. **Enum `responseMode`** — `["text","audio","image"]` ou adicionar `"video"`/`"document"` no v1.3?
5. **Atualização do system prompt** — migration de DB (igual v1.1) ou ENV override?
