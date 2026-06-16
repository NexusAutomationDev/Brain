# Response Format — schema-as-tool com createRespondTool()

**Abordagem:** schema-as-tool via `createRespondTool()` (Phase 16 — Brain Core v1.3)

## Conceito

O LLM escolhe o formato de resposta (`responseMode`) dinamicamente ao invocar a `respond` tool
como **último passo de cada turno**. O schema da tool define os valores aceitos e é convertido
automaticamente para JSON Schema pelo LangChain Core via `bindTools()`.

Esta abordagem substitui o hardcode `responseMode: "text" as const` que existia no nó `llm`.

## Por que schema-as-tool (e não as alternativas)?

| Abordagem | Problema |
|-----------|---------|
| `withStructuredOutput()` | Incompatível com `bindTools()` — langchainjs #7757 |
| `responseFormat` do `createReactAgent` | Faz segunda chamada LLM reescrevendo `fullResponse` — LangGraph #4756 |
| Instrução de prompt para JSON | Alucinações de JSON malformado; não garante `fullResponse` correto |
| **schema-as-tool (abordagem atual)** | `bindTools()` é API padrão do `BaseChatModel` — funciona com OpenAI e Anthropic sem branching de código |

## Schema da respond tool

```typescript
// packages/core/src/tools/respond.ts
{
  fullResponse: z.string(),           // OBRIGATÓRIO: texto completo da resposta
  responseMode: z.enum([              // OBRIGATÓRIO: modo de entrega
    "undefined",                      // sem preferência específica (valor padrão)
    "text",                           // resposta textual explícita
    "audio",                          // converter para áudio via TTS downstream
  ]),
  mediaType: z.enum(["image", "file", "video", "audio"]).optional(),
  mediaUrl: z.string().url().optional(),
}
```

`mediaType` e `mediaUrl` são co-dependentes: se um está presente, o outro é obrigatório.

**Nota:** `mediaType: "file"` é mapeado para `"document"` no nó `respond` antes de passar para `BrainOutputSchema.parse()` — o contrato de saída usa "document", mas o schema da tool usa "file" (mais intuitivo para o LLM).

## Fluxo do grafo

```
__start__ → llm → routeAfterLlm:
  ├── "respond"  → nó respond (seta brainOutput + emite ToolMessage)  → __end__
  ├── "tools"    → ToolNode com tools nativas/MCP                     → llm (ReAct loop)
  └── "__end__"  → fallback D-10: brainOutput { responseMode: "undefined" }
```

**Atenção brain-echo:** quando `ctx.mcpTools=[]`, o router retorna `END` para qualquer tool call
que não seja "respond" — evita invocar um `ToolNode` vazio. O nó "tools" existe no grafo mas é
inalcançável nessa configuração.

## Fallback D-10 (PITFALL-6)

Se o LLM emitir texto plano sem invocar a `respond` tool:
- O nó `llm` detecta `tool_calls.length === 0`
- Seta `brainOutput` com `{ fullResponse: <conteúdo>, responseMode: "undefined" }`
- Loga `warn` com tag "PITFALL-6"
- O grafo termina normalmente (comportamento degradado, não erro)

A description da tool instrui o LLM: **"SEMPRE invoque esta tool ao final da sua resposta"**.

## Como usar em um novo Brain

```typescript
import { createRespondTool } from "@brain-pkg/core";

// Em buildGraph():
const respondTool = createRespondTool();
const hasMcpTools = ctx.mcpTools.length > 0; // necessário para guarda do router (Brain sem tools nativas)
const llmWithTools = ctx.llm.bindTools([
  ...minhasTools,
  respondTool,         // adicionar por último (ou antes de mcpTools)
  ...ctx.mcpTools,
]);

// Router com guarda para ToolNode vazio (obrigatório quando Brain não tem tools nativas):
function routeAfterLlm(state: any) {
  const toolCalls = (state.messages.at(-1) as AIMessage)?.tool_calls ?? [];
  if (toolCalls.length === 0) return END;
  if (toolCalls[0].name === "respond") return "respond";
  if (!hasMcpTools) return END; // guarda: ToolNode ficaria vazio
  return "tools";
}

// Adicionar nó respond e router no StateGraph:
.addNode("respond", respondNode)          // nó regular que seta brainOutput
.addConditionalEdges("llm", routeAfterLlm, ["tools", "respond", "__end__"])
.addEdge("respond", "__end__")
```

Copiar a implementação completa de `respondNode` de `apps/brain-sdr/src/brain.ts`.

## Valores de responseMode

| Valor | Quando usar | Consumer downstream |
|-------|-------------|---------------------|
| `"undefined"` | Sem preferência específica (fallback) | Trata como texto |
| `"text"` | Resposta textual explícita | Renderiza como texto |
| `"audio"` | Usuário pediu para ouvir | Converte via TTS |

## Fora de escopo (pós v1.3)

- `responseMode: "video"` e `"document"` — RESP-F01
- Publicar `responseMode` + `mediaUrl` no RabbitMQ — RESP-F02
- `splitResponse` (dividir em múltiplos balões) — feature futura
