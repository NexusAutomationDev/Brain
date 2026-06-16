# Phase 16: Dynamic responseMode - Research

**Researched:** 2026-06-16
**Domain:** LangGraph tool calling — schema-as-tool pattern, custom router, ToolNode dispatch
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Router customizado substitui `toolsCondition` em brain-sdr e brain-echo. Lógica: inspecionar `tool_calls` do último AIMessage:
  - Se tool_call com nome `"respond"` → rota para nó `"respond"`
  - Se tool_calls com outros nomes → rota para nó `"tools"`
  - Se nenhuma tool_call (texto plano) → rota para `"__end__"` (fallback PITFALL-6)
- **D-02:** O nó `"respond"` executa via ToolNode contendo apenas a respond tool — `ToolMessage` vai para `state.messages` para manter consistência de paridade `AIMessage/ToolMessage` no PostgresSaver/LangGraph.
- **D-03:** Schema da respond tool (Zod em `createRespondTool()`): `fullResponse: z.string()`, `responseMode: z.enum(["undefined", "text", "audio"])`, `mediaType: z.enum(["image", "file", "video", "audio"]).optional()`, `mediaUrl: z.string().url().optional()`. Validação condicional: se `mediaType` presente → `mediaUrl` obrigatório.
- **D-04:** `responseMode: "undefined"` é valor explícito no schema da tool e no `ResponseMode` type.
- **D-05:** `mediaType: "file"` é mapeado para `"document"` no nó `respond` antes de `BrainOutputSchema.parse()`.
- **D-06:** `ResponseMode` em `packages/shared/src/types/index.ts` ganha `"undefined"`: `"undefined" | "text" | "image" | "audio" | "video" | "document"`.
- **D-07:** `ResponseModeSchema` em `packages/core/src/output/schema.ts` é atualizado para incluir `"undefined"` no enum Zod.
- **D-08:** `BrainOutputSchema` não precisa de mudança adicional — `"undefined"` não requer `mediaType`/`mediaUrl`.
- **D-09:** `createRespondTool()` fica em `packages/core` (mesmo package de `createPauseSessionTool` e `createFinishConversationTool`). Exportado pelo barrel `packages/core/src/index.ts`.
- **D-10:** Quando o LLM emite texto plano (sem `tool_calls`), o router cai no branch `"__end__"`. O nó `"llm"` detecta isso e seta `state.brainOutput` com `{ fullResponse: response.content as string, responseMode: "undefined" }`. Comportamento degradado (não erro) — PITFALL-6 é logado como warn.
- **D-11:** System prompt do brain-sdr não precisa de atualização via migration SQL.
- **D-12:** `docs/guides/response-format-prompt.md` será recriado documentando a abordagem schema-as-tool.

### Claude's Discretion

- Implementação exata do `mediaUrl` pattern de validação: regex no Zod ou apenas `z.string().url()` — Claude decide baseado no que o LangGraph repassa ao LLM como JSON Schema.
- Lógica do fallback em D-10: verificar `response.content !== ""` antes de setar brainOutput com "undefined".
- Nomenclatura interna do router: `routeAfterLlm(state)` — Claude decide nome exato.

### Deferred Ideas (OUT OF SCOPE)

- `splitResponse`: divisão de resposta em múltiplos balões
- `responseMode: "image"` com geração de imagem via URL externa (DALL-E)
- Canal de resposta RabbitMQ com `responseMode` + `mediaUrl` (RESP-F02) — pós v1.3
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RESP-01 | LLM escolhe `responseMode` (`text`/`audio`/`image`) dinamicamente como parte do `BrainOutput` — sem valor hardcoded | `createRespondTool()` via `bindTools()` + nó `respond` + router customizado; LangGraph 1.4.1 ToolNode dispatch por nome |
| RESP-02 | Conteúdo de `fullResponse` não é alterado pelo mecanismo de seleção de formato | `fullResponse` é campo autônomo no schema da respond tool; o nó `respond` lê `args.fullResponse` diretamente sem re-processamento |
| RESP-03 | responseMode dinâmico funciona com OpenAI e Anthropic sem branching de código por provider | `bindTools()` é API padrão de `BaseChatModel`; schema Zod é convertido para JSON Schema pelo LangChain core — agnóstico de provider |
</phase_requirements>

---

## Summary

A Phase 16 implementa o padrão **schema-as-tool** para `responseMode` dinâmico: em vez de hardcodar `responseMode: "text"` no nó `llm`, o LLM recebe uma tool chamada `respond` cujo schema inclui `fullResponse`, `responseMode`, `mediaType` e `mediaUrl`. O LLM sempre invoca essa tool como último passo de cada turno, sinalizando o formato de resposta desejado.

A abordagem funciona porque `bindTools()` é API da `BaseChatModel` (LangChain Core) — agnóstica de provider. OpenAI e Anthropic recebem o mesmo JSON Schema convertido a partir do Zod pela infra do LangChain Core (`zodToJsonSchema`). O grafo passa de dois destinos (`"tools"` | `"__end__"`) para três: `"respond"` (respond tool) | `"tools"` (tools nativas/MCP) | `"__end__"` (fallback texto plano). O `toolsCondition` prebuilt é substituído por `routeAfterLlm()` que inspeciona o nome do primeiro `tool_call` do último AIMessage.

A mudança exige: (1) criar `createRespondTool()` em `packages/core`, (2) adicionar `"undefined"` ao `ResponseMode` type e `ResponseModeSchema`, (3) atualizar os grafos de brain-sdr e brain-echo com o nó `respond` e o router, (4) atualizar testes que hardcodam `responseMode: "text"` como valor esperado do fallback D-10.

**Primary recommendation:** Implementar `createRespondTool()` seguindo o padrão exato de `createPauseSessionTool()` (stateless, sem closure de sql), adicionar ao `bindTools()` dos dois brains, e substituir `toolsCondition` por `routeAfterLlm` que roteia por nome de tool_call.

---

## Standard Stack

### Core (verificado no codebase)

| Library | Version | Purpose | Why |
|---------|---------|---------|------|
| `@langchain/langgraph` | 1.4.1 | StateGraph, ToolNode, addConditionalEdges | Instalado e em uso — API verificada |
| `@langchain/core` | 1.1.48 | `tool()` factory, `BaseChatModel.bindTools()`, zodToJsonSchema | Instalado — converte Zod para JSON Schema para LLMs |
| `zod` | 4.4.3 (packages/core) | Schema da respond tool | packages/core usa Zod v4 — APIs confirmadas |
| `zod` | 3.25.76 (brain-sdr) | Schemas locais | brain-sdr usa Zod v3 — NÃO importar de packages/core no brain-sdr |

[VERIFIED: codebase grep — package.json de packages/core, apps/brain-sdr, packages/ai]

### APIs LangGraph confirmadas no código instalado

| API | Signature | Comportamento |
|-----|-----------|---------------|
| `toolsCondition(state)` | `(BaseMessage[] \| MessagesAnnotation.State) => "tools" \| END` | Verifica apenas se há tool_calls; não filtra por nome |
| `ToolNode(tools, options)` | `(tools: StructuredTool[], options?: { handleToolErrors?: boolean }) => RunnableCallable` | Encontra tool por `tool.name === call.name` em `runTool()` |
| `addConditionalEdges(source, path, pathMap?)` | `(N, RunnableLike, BranchPathReturnValue[]) => this` | pathMap pode ser array de strings destino |

[VERIFIED: leitura direta de tool_node.d.ts e tool_node.js em node_modules]

### Zod v4 API confirmada (packages/core)

| Pattern | Status | Output JSON Schema |
|---------|--------|--------------------|
| `z.string().url()` | Funciona em Zod v4 | `{ "format": "uri" }` |
| `z.string().regex(pattern)` | Funciona em Zod v4 | `{ "pattern": "<regex>" }` |
| `z.url()` | Novo em Zod v4 — retorna `ZodURL`, não `ZodString` | Tipo diferente |
| `z.enum([...]).optional()` | Funciona em Zod v4 | `{ "enum": [...] }` ou `anyOf` com null |
| `.superRefine()` | Funciona em Zod v4 | Validação condicional personalizada |

[VERIFIED: bun runtime test em /root/Brain/packages/core — scripts executados e resultados confirmados]

---

## Architecture Patterns

### Padrão de factory existente (referência)

`createRespondTool()` segue exatamente o padrão de `createPauseSessionTool()`:
- Factory function exportada
- Stateless: sem closure sobre `sql` (respond tool não toca banco)
- Usa `tool()` de `@langchain/core/tools` com `{ name, description, schema }`
- Schema Zod v4 (packages/core usa v4)

```typescript
// Padrão estabelecido — pause-session.ts
export function createPauseSessionTool(sql: Sql) {
  return tool(
    async (_args, config?) => { /* impl */ },
    { name: "pause_session", description: "...", schema: z.object({}) }
  );
}

// createRespondTool() — stateless, sem sql
export function createRespondTool() {
  return tool(
    async (args) => {
      // Apenas loga e retorna confirmação — o nó respond lê state.messages
      logger.info({ responseMode: args.responseMode }, "respond tool called");
      return "ok";
    },
    { name: "respond", description: "...", schema: respondToolSchema }
  );
}
```

[VERIFIED: código em /root/Brain/packages/core/src/tools/pause-session.ts]

### Router customizado — padrão de substituição de `toolsCondition`

`toolsCondition` (código fonte verificado):
```javascript
function toolsCondition(state) {
  const message = Array.isArray(state) ? state[state.length - 1] : state.messages[state.messages.length - 1];
  if (message !== void 0 && "tool_calls" in message && (message.tool_calls?.length ?? 0) > 0) return "tools";
  else return END;
}
```

O router customizado inspeciona o **nome** do tool_call em vez de apenas a presença:

```typescript
// Source: padrão derivado de toolsCondition (tool_node.js:300-304) + D-01 do CONTEXT.md
import { END } from "@langchain/langgraph";
import type { BrainState } from "@brain-pkg/ai";

function routeAfterLlm(state: BrainState): "respond" | "tools" | typeof END {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || !("tool_calls" in lastMessage)) return END;
  const toolCalls = (lastMessage as any).tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return END;
  // D-01: resposta usa "respond" tool → vai para nó respond
  if (toolCalls[0].name === "respond") return "respond";
  // D-01: qualquer outra tool → ReAct loop
  return "tools";
}
```

[VERIFIED: código-fonte de toolsCondition lido diretamente — pattern derivado de comportamento verificado]

### Grafo atualizado (brain-sdr e brain-echo)

```
__start__ → llm → routeAfterLlm:
  ├── "respond"  → respondNode (ToolNode)   → __end__
  ├── "tools"    → toolsNode (ToolNode)     → llm (ReAct loop)
  └── "__end__"  → (fallback D-10: brainOutput { responseMode: "undefined" })
```

O nó `llm` precisa de lógica dupla:
1. **Caminho normal:** LLM chama `respond` tool → nó `respond` seta `brainOutput`
2. **Fallback D-10:** LLM emite texto plano → nó `llm` seta `brainOutput` com `responseMode: "undefined"`

```typescript
// Nó "llm" atualizado (dentro de addNode)
async (state) => {
  const response = await llmWithTools.invoke([...]);
  const toolCalls = (response as any).tool_calls ?? [];
  const respondCall = toolCalls.find((tc: any) => tc.name === "respond");
  
  if (!respondCall) {
    // D-10: fallback — texto plano sem tool call
    const content = typeof response.content === "string" ? response.content : "";
    if (!content) {
      logger.warn("LLM emitiu resposta vazia sem tool call — PITFALL-6");
    } else {
      logger.warn({ content }, "LLM emitiu texto plano sem respond tool — PITFALL-6");
    }
    return {
      messages: [response],
      brainOutput: { fullResponse: content, responseMode: "undefined" as const },
      tokenUsage: extractTokenUsage(response),
    };
  }
  
  // Caminho normal: respond tool será chamada pelo nó respond
  // brainOutput será setado pelo nó respond — não setar aqui
  return {
    messages: [response],
    tokenUsage: extractTokenUsage(response),
  };
}
```

[ASSUMED] — O nó `respond` (ToolNode) precisa de lógica adicional para extrair os args da tool call e setar `brainOutput`. ToolNode padrão apenas persiste o `ToolMessage` em `state.messages`. O nó `respond` pode ser um ToolNode com função customizada ou um nó regular que lê `state.messages`.

**CLARIFICAÇÃO CRÍTICA — como o nó `respond` deve funcionar:**

D-02 diz "O nó `respond` executa via ToolNode contendo apenas a respond tool". ToolNode padrão:
- Recebe state com `messages`
- Executa a tool com os `args` do tool_call
- Retorna `{ messages: [ToolMessage] }`

Para que o nó `respond` TAMBÉM sete `brainOutput`, a respond tool precisa setar `brainOutput` via mecanismo de retorno — mas `ToolNode` retorna apenas `ToolMessage`. Há duas opções:

**Opção A (recomendada — sem ToolNode customizado):** Implementar o nó `respond` como nó regular (não ToolNode) que:
1. Lê `state.messages` para encontrar o último AIMessage com tool_call `respond`
2. Extrai os args
3. Seta `brainOutput` + emite `ToolMessage` em `state.messages`

**Opção B (via ToolNode com Command):** Usar `Command` do LangGraph para que a tool retorne atualizações de estado junto com o ToolMessage. Mais complexo, não segue padrão estabelecido no projeto.

**Decisão de implementação (Claude's Discretion):** A Opção A é mais simples e mais alinhada com o padrão existente do projeto. O nó `respond` é um `addNode("respond", async (state) => {...})` regular, não um ToolNode.

### Localização dos arquivos (verificado)

```
packages/core/src/
  tools/
    respond.ts          ← NOVO: createRespondTool()
    pause-session.ts    ← referência de padrão
    finish-conversation.ts  ← referência de padrão
    __tests__/
      respond.test.ts   ← NOVO: testes unitários

apps/brain-sdr/src/
  brain.ts              ← MODIFICAR: remover responseMode hardcode, adicionar router + nó respond
  __tests__/unit/
    brain.test.ts       ← MODIFICAR: atualizar assertions de responseMode

apps/brain-echo/src/
  brain.ts              ← MODIFICAR: idem ao brain-sdr

packages/shared/src/types/
  index.ts              ← MODIFICAR: adicionar "undefined" ao ResponseMode type

packages/core/src/output/
  schema.ts             ← MODIFICAR: adicionar "undefined" ao ResponseModeSchema
  index.ts              ← MODIFICAR: exportar createRespondTool
```

[VERIFIED: leitura direta dos arquivos]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Converter schema Zod para JSON Schema para LLM | Parser manual | LangChain Core `zodToJsonSchema` via `bindTools()` | Já feito automaticamente pelo `tool()` + `bindTools()` |
| Roteamento por tool call | Switch/if statement externo | Função inline `routeAfterLlm` passada para `addConditionalEdges` | É uma função simples — o LangGraph cuida do dispatch |
| Executar a respond tool | Código manual de dispatch por nome | ToolNode (se Opção B) ou nó regular que lê messages (Opção A) | ToolNode já faz lookup por nome; nó regular é mais simples |
| Paridade AIMessage/ToolMessage | Emitir ToolMessage manualmente | Nó `respond` que cria `ToolMessage` explicitamente | Necessário para PostgresSaver não reclamar de thread inconsistente |

**Key insight:** `bindTools()` já converte o Zod schema para JSON Schema e passa para a API do provider. Não há código adicional necessário para que OpenAI e Anthropic recebam o schema correto — é idêntico ao que já acontece com `pause_session` e `finish_conversation`.

---

## Common Pitfalls

### Pitfall 1: PITFALL-6 — LLM não invoca respond tool
**What goes wrong:** LLM emite `HumanMessage` com `content: "Olá!"` sem tool_calls. Router cai em `"__end__"` sem `brainOutput` setado → `BrainOutputValidationError`.
**Why it happens:** Sem instrução explícita no system prompt (D-11), o LLM pode responder diretamente.
**How to avoid:** D-10 — o nó `llm` detecta ausência de tool_calls e seta `brainOutput` com `responseMode: "undefined"` antes de retornar. **Combinado com:** description clara na respond tool ("Sempre invoque esta tool ao final da sua resposta").
**Warning signs:** Logs `warn` com "PITFALL-6" + `brainOutput.responseMode === "undefined"` em condições que não deveriam ser fallback.

### Pitfall 2: `withStructuredOutput()` incompatível com `bindTools()`
**What goes wrong:** `llm.withStructuredOutput(schema).bindTools([...])` — `withStructuredOutput` descarta silenciosamente os tool schemas.
**Why it happens:** `withStructuredOutput` sobrescreve o formato de saída via `response_format`, conflitando com o mecanismo de tool calling.
**How to avoid:** Nunca usar. Usar apenas `bindTools()` com a respond tool no array. Documentado em `langchainjs #7757`.
**Warning signs:** LLM não chama nenhuma tool mesmo com `bindTools` configurado.

### Pitfall 3: `responseFormat` de `createReactAgent` reescreve `fullResponse`
**What goes wrong:** Usar `responseFormat` em `createReactAgent` — ele faz uma segunda chamada LLM para estruturar a resposta, reescrevendo `fullResponse`.
**Why it happens:** `createReactAgent` chama o LLM novamente para formatar a saída.
**How to avoid:** Nunca usar `createReactAgent` com `responseFormat`. Usar StateGraph manual como já feito. Documentado em `LangGraph #4756`.

### Pitfall 4: Paridade AIMessage/ToolMessage no PostgresSaver
**What goes wrong:** Nó `respond` seta `brainOutput` mas não emite `ToolMessage` → PostgresSaver recebe thread com AIMessage sem ToolMessage correspondente → erro na próxima invocação.
**Why it happens:** LangGraph/PostgresSaver verifica consistência de mensagens no checkpoint.
**How to avoid:** D-02 — nó `respond` DEVE emitir `ToolMessage` em `state.messages` além de setar `brainOutput`.
**Warning signs:** Erro no segundo turno de conversa do mesmo lead: "Expected AIMessage after ToolMessage" ou similar.

### Pitfall 5: Zod v4 vs v3 — packages/core usa Zod v4
**What goes wrong:** Usar API de Zod v3 em `createRespondTool()` que fica em packages/core (Zod v4).
**Why it happens:** brain-sdr tem Zod v3 (`^3.25.76`); packages/core tem Zod v4 (`^4.4.3`). Em Zod v4, `z.url()` retorna `ZodURL` (novo tipo), não `ZodString`. Usar `z.url().optional()` no schema pode gerar tipo TypeScript incompatível.
**How to avoid:** Em packages/core, usar `z.string().url().optional()` (mantém compatibilidade) ou `z.string().regex(pattern).optional()`. Ambos verificados como funcionando em Zod v4.
**Warning signs:** TypeScript error: "Type 'ZodURL' is not assignable to type 'ZodString'".

### Pitfall 6: Teste brain-sdr que hardcoda `responseMode: "text"`
**What goes wrong:** `brain.test.ts` linha 142 assert `expect(result.brainOutput.responseMode).toBe("text")` — falha após remover o hardcode.
**Why it happens:** O teste usa um LLM mock que retorna `tool_calls: []` → D-10 fallback → `responseMode: "undefined"`, não `"text"`.
**How to avoid:** Atualizar o teste para `toBe("undefined")` (fallback D-10) OU adicionar um segundo teste que mocka uma resposta com respond tool_call e verifica `"text"`.
**Warning signs:** `bun test` falha em `apps/brain-sdr/src/__tests__/unit/brain.test.ts` na asserção `responseMode`.

### Pitfall 7: `mediaType: "file"` não existe em `ResponseMode`
**What goes wrong:** Schema da respond tool aceita `mediaType: "file"`, mas `BrainOutputSchema` aceita `"document"`. Se o mapeamento D-05 não for feito, `BrainOutputSchema.parse()` lança `ZodError`.
**Why it happens:** Convenção diferente entre o schema da tool (orientado ao LLM) e o contrato de saída (orientado ao downstream).
**How to avoid:** D-05 — no nó `respond`, antes de `BrainOutputSchema.parse()`, mapear `args.mediaType === "file"` → `"document"`.

---

## Code Examples

### respond tool schema (Zod v4 — packages/core)

```typescript
// Source: CONTEXT.md D-03 + verificação de API Zod v4 em runtime
import { z } from "zod";

const respondToolSchema = z.object({
  fullResponse: z.string().describe(
    "Mensagem completa da resposta em formato contínuo, sem divisões."
  ),
  responseMode: z.enum(["undefined", "text", "audio"]).describe(
    "Modo de entrega da resposta. Use 'undefined' quando não há preferência de formato específica. Use 'audio' quando o usuário pedir explicitamente para ouvir."
  ),
  mediaType: z.enum(["image", "file", "video", "audio"]).optional().describe(
    "Tipo da mídia enviada em mediaUrl. Obrigatório quando mediaUrl estiver presente."
  ),
  mediaUrl: z.string().url().optional().describe(
    "URL direta de download de um arquivo de mídia. Obrigatório quando mediaType estiver presente."
  ),
}).superRefine((data, ctx) => {
  if (data.mediaType && !data.mediaUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "mediaUrl é obrigatório quando mediaType está presente",
      path: ["mediaUrl"],
    });
  }
  if (data.mediaUrl && !data.mediaType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "mediaType é obrigatório quando mediaUrl está presente",
      path: ["mediaType"],
    });
  }
});
```

**Nota sobre Claude's Discretion (mediaUrl):** `z.string().url()` converte para `{ "format": "uri" }` em JSON Schema. O pattern regex de CONTEXT.md (`"^https://.*\\.(mp3|mp4|...)"`) converte para `{ "pattern": "..." }` — mais restritivo para o LLM. Para este projeto, `z.string().url()` é suficiente: instrui o LLM sobre o formato sem tornar o schema fragil para URLs válidas sem extensão.

[VERIFIED: bun runtime test confirma `z.string().url()` funciona em Zod v4 + inspecção de zodToJsonSchema output em LangChain Core]

### Nó respond (padrão nó regular, não ToolNode)

```typescript
// Source: padrão derivado de D-02 CONTEXT.md + análise de ToolNode.runTool() em tool_node.js
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { BrainState } from "@brain-pkg/ai";

async function respondNode(state: BrainState) {
  // Encontrar o último AIMessage com tool_call "respond"
  const messages = state.messages;
  let respondCall: any = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.getType() === "ai") {
      const tc = (msg as AIMessage).tool_calls ?? [];
      respondCall = tc.find((c) => c.name === "respond");
      if (respondCall) break;
    }
  }

  if (!respondCall) {
    // Não deveria acontecer se o router funcionou corretamente
    logger.error("respondNode chamado sem tool_call 'respond' no estado");
    return {};
  }

  const args = respondCall.args;
  
  // D-05: mapear mediaType "file" → "document"
  const mediaType = args.mediaType === "file" ? "document" : args.mediaType;
  
  const toolMessage = new ToolMessage({
    content: "ok",
    tool_call_id: respondCall.id ?? "",
    name: "respond",
  });

  return {
    messages: [toolMessage],  // D-02: paridade AIMessage/ToolMessage
    brainOutput: {
      fullResponse: args.fullResponse,
      responseMode: args.responseMode,
      ...(mediaType && { mediaType }),
      ...(args.mediaUrl && { mediaUrl: args.mediaUrl }),
    },
  };
}
```

### Grafo atualizado (brain-sdr)

```typescript
// Source: apps/brain-sdr/src/brain.ts (atual) + D-01, D-02 CONTEXT.md
import { END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createRespondTool } from "@brain-pkg/core";

// Router customizado — substitui toolsCondition
function routeAfterLlm(state: BrainState): "respond" | "tools" | typeof END {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || !("tool_calls" in lastMessage)) return END;
  const toolCalls = (lastMessage as AIMessage).tool_calls ?? [];
  if (toolCalls.length === 0) return END;
  if (toolCalls[0].name === "respond") return "respond";
  return "tools";
}

// Em buildGraph():
const respondTool = createRespondTool();
const llmWithTools = ctx.llm.bindTools([
  boundQualifyTool,
  boundPauseSessionTool,
  boundFinishConversationTool,
  respondTool,          // NOVO
  ...ctx.mcpTools,
]);

return new StateGraph(BrainStateAnnotation)
  .addNode("llm", llmNode)
  .addNode("tools", new ToolNode(
    [boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool, ...ctx.mcpTools],
    { handleToolErrors: true }
  ))
  .addNode("respond", respondNode)   // NOVO
  .addEdge("__start__", "llm")
  .addConditionalEdges("llm", routeAfterLlm, ["tools", "respond", "__end__"])
  .addEdge("tools", "llm")
  .addEdge("respond", "__end__");    // NOVO
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in) |
| Config file | none — sem config file, Jest-compatible API |
| Quick run command | `bun test packages/core/src/tools/__tests__/respond.test.ts apps/brain-sdr/src/__tests__/unit/brain.test.ts apps/brain-echo/src/__tests__/unit/brain.test.ts packages/core/src/__tests__/unit/output/schema.test.ts` |
| Full suite command | `bun test packages/ apps/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| RESP-01 | `createRespondTool()` schema tem campos corretos | unit | `bun test packages/core/src/tools/__tests__/respond.test.ts` | ❌ Wave 0 |
| RESP-01 | Router `routeAfterLlm` retorna "respond" quando tool_call.name === "respond" | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ (atualizar) |
| RESP-01 | Router retorna "tools" para outras tool_calls | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ❌ Wave 0 (novo teste) |
| RESP-01 | Router retorna END para texto plano | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ❌ Wave 0 (novo teste) |
| RESP-02 | `fullResponse` inalterado no nó respond | unit | `bun test packages/core/src/tools/__tests__/respond.test.ts` | ❌ Wave 0 |
| RESP-03 | bindTools aceita respond tool + mcpTools + tools nativas (count correto) | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ (atualizar count) |
| RESP-03 | BrainOutputSchema aceita responseMode "undefined" | unit | `bun test packages/core/src/__tests__/unit/output/schema.test.ts` | ✅ (adicionar caso) |

### Sampling Rate

- **Por task:** `bun test packages/core/src/tools/__tests__/respond.test.ts packages/core/src/__tests__/unit/output/schema.test.ts apps/brain-sdr/src/__tests__/unit/brain.test.ts apps/brain-echo/src/__tests__/unit/brain.test.ts`
- **Por wave:** `bun test packages/ apps/`
- **Phase gate:** Suite completa green antes do `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/tools/__tests__/respond.test.ts` — cobre RESP-01 e RESP-02; testa schema, factory, nó respond
- [ ] Novos casos em `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — testa routeAfterLlm com 3 cenários

Testes existentes a ATUALIZAR (não criar do zero):
- [ ] `apps/brain-sdr/src/__tests__/unit/brain.test.ts:142` — atualizar `toBe("text")` para `toBe("undefined")` (fallback D-10)
- [ ] `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — teste de `bindTools` count: de 3 para 4 (adicionar respondTool)
- [ ] `apps/brain-echo/src/__tests__/unit/brain.test.ts` — idem (bindTools com respondTool)
- [ ] `packages/core/src/__tests__/unit/output/schema.test.ts` — adicionar teste `responseMode: "undefined"` é válido

---

## Runtime State Inventory

Fase não é rename/migration — esta seção não se aplica.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Runtime + test runner | ✓ | 1.3.2 | — |
| Docker | Build/deploy (não necessário para dev) | ✓ | 29.4.1 | — |

Fase 16 é puramente código TypeScript — sem dependências externas adicionais além das já instaladas.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `responseMode: "text" as const` hardcoded no nó llm | respond tool via `bindTools()` + nó `respond` | Phase 16 | LLM controla formato dinamicamente |
| `toolsCondition` prebuilt (2 destinos) | `routeAfterLlm` customizado (3 destinos) | Phase 16 | Separa respond tool de tools de negócio |
| `ResponseMode` sem "undefined" | `ResponseMode` com "undefined" como valor explícito | Phase 16 | Fallback D-10 tem valor válido no contrato |

**Abordagens descartadas (confirmadas como inviáveis):**
- `withStructuredOutput()`: incompatível com `bindTools()` — `langchainjs #7757`
- `responseFormat` de `createReactAgent`: faz segunda chamada LLM reescrevendo `fullResponse` — `LangGraph #4756`
- Instrução de prompt para JSON: alucinações de formato JSON malformado

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | O nó `respond` deve ser nó regular (não ToolNode) para poder setar `brainOutput` além de `messages` | Architecture Patterns | Se ToolNode suportar Command para atualizar estado, Opção B seria mais limpa — mas Opção A é mais segura e simples |
| A2 | A description da respond tool em `createRespondTool()` é suficiente para instruir o LLM a sempre chamá-la (sem atualizar system prompt) | Pitfall 1 / D-11 | Se o LLM ignorar a tool com frequência, o system prompt precisaria de atualização — isso é mitigado pelo fallback D-10 |

---

## Open Questions (RESOLVED)

1. **Opção A vs Opção B para o nó respond**
   - O que sabemos: ToolNode padrão retorna apenas `{ messages: [ToolMessage] }` — não atualiza `brainOutput`
   - O que é incerto: LangGraph suporta `Command` como retorno de tool para atualizar estado arbitrário — se a respond tool usar `Command`, poderia ser um ToolNode
   - Recomendação: Usar Opção A (nó regular). É o padrão mais simples, não requer importar `Command`, e mantém consistência com o estilo do projeto. ToolNode sem `handleToolErrors` (D-02) para falhar explicitamente se schema inválido ainda é satisfeito com um nó regular.
   - RESOLVED: Opção A (nó regular `addNode("respond", async (state) => {...})`) escolhida — adotada nos planos 16-01 e 16-02. ToolMessage é emitido explicitamente no nó, preservando paridade AIMessage/ToolMessage de D-02.

2. **brain-echo não tem respond tool como default — precisa?**
   - O que sabemos: brain-echo existe como brain de validação/eco; não tem tools nativas; usa mcpTools
   - O que é incerto: D-01 e D-02 do CONTEXT.md mencionam "brain-sdr e brain-echo" — implica que ambos recebem a mudança
   - Recomendação: Implementar em ambos conforme CONTEXT.md. brain-echo sem `respond` tool quebraria o contrato de `brainOutput` quando usado sem MCP tools (responderia apenas texto plano → D-10 fallback).
   - RESOLVED: Implementado em ambos conforme D-01/D-02 do CONTEXT.md — plano 16-02 Task 2 cobre brain-echo.

---

## Security Domain

Fase 16 é puramente interna — adiciona tool ao grafo e atualiza tipos. Não expõe novos endpoints HTTP, não processa input de usuário fora do fluxo já existente, não adiciona criptografia. ASVS V5 (Input Validation) aplica-se ao schema Zod da respond tool (já coberto pela validação Zod + `superRefine`).

---

## Sources

### Primary (HIGH confidence)
- Leitura direta de `/root/Brain/node_modules/.pnpm/.../tool_node.js` e `tool_node.d.ts` — comportamento de `toolsCondition`, `ToolNode.runTool()`, assinatura de `addConditionalEdges`
- Leitura direta de `/root/Brain/packages/core/src/tools/pause-session.ts` e `finish-conversation.ts` — padrão factory confirmado
- Leitura direta de `/root/Brain/apps/brain-sdr/src/brain.ts` — código atual do grafo, integração com `toolsCondition` e `ToolNode`
- Leitura direta de `/root/Brain/packages/core/src/output/schema.ts` e `/root/Brain/packages/shared/src/types/index.ts` — estado atual de `ResponseMode` e `ResponseModeSchema`
- Bun runtime tests em `/root/Brain/packages/core` — confirmação de Zod v4 API: `z.string().url()`, `z.url()`, `z.enum().optional()`, `superRefine`
- Leitura de `/root/Brain/node_modules/.bun/@langchain+core@1.1.48/node_modules/@langchain/core/dist/utils/zod-to-json-schema/parsers/string.js` — confirma `z.string().url()` → `{ "format": "uri" }` em JSON Schema

### Secondary (MEDIUM confidence)
- `16-CONTEXT.md` — decisões D-01 a D-12 já validadas pelo usuário em sessão de discuss
- Inspecção de todos os testes que hardcodam `responseMode: "text"` — lista completa de testes que precisam atualização

### Tertiary (LOW confidence)
- Nenhuma

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versões verificadas em package.json instalado, APIs confirmadas via leitura de código fonte
- Architecture patterns: HIGH para padrão factory (leitura direta); MEDIUM para nó respond (Opção A vs B — decisão de implementação razoável, mas não testada end-to-end)
- Pitfalls: HIGH — todos baseados em código verificado + decisões D-01 a D-12 do CONTEXT.md

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (LangGraph 1.4.1 é estável; Zod v4 API confirmada)
