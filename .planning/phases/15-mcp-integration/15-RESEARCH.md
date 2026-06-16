# Phase 15: MCP Integration - Research

**Researched:** 2026-06-16
**Domain:** @langchain/mcp-adapters + LangGraph ToolNode + BrainRunner lifecycle
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `BrainBuildContext` ganha campo `mcpTools: StructuredTool[]` em `packages/core/src/brain/interface.ts`. BrainRunner inicializa MultiServerMCPClient em `_compileGraph()`, carrega as MCP tools, e as passa via `ctx.mcpTools` ao chamar `buildGraph(ctx)`.
- **D-02:** Quando `MCP_URL` não está definido, `ctx.mcpTools = []` — nunca `undefined`. Brain espalha o array vazio sem guard.
- **D-03:** Ambos brain-sdr e brain-echo recebem e espalham `ctx.mcpTools`. Padrão para futuros Brains: `buildGraph()` sempre inclui `ctx.mcpTools` em `bindTools()` e `ToolNode()`.
- **D-04:** `BrainRunner` ganha método `async close(): Promise<void>` que fecha o `MultiServerMCPClient` (se inicializado) e aguarda o shutdown limpo. Apenas na classe concreta — não em `IBrainRunnerLike`.
- **D-05:** `BrainRunner.init()` auto-registra o handler SIGTERM: `process.on('SIGTERM', async () => { await this.close(); process.exit(0) })`. SDK cuida do shutdown transparentemente — apps não precisam adicionar código.
- **D-06:** `IBrainRunnerLike` (interface em `handler.ts`) **não** ganha `close()`. Transporte não é responsável pelo lifecycle do cliente MCP.
- **D-07:** `MCP_URL` definido + `MCP_TOOLS` ausente ou vazio (`""`) → carregar **todas** as tools do servidor MCP. Sem wildcard `*`.
- **D-08:** `MCP_TOOLS` como CSV filtra por nome exato: `MCP_TOOLS=tool1,tool2` → apenas essas tools são carregadas.
- **D-09:** `MCP_URL` ausente → `ctx.mcpTools = []`, sem tentativa de conexão. Brain funciona idêntico ao v1.2.
- **D-10:** Bearer token via `MCP_AUTH_TOKEN` ENV. BrainRunner passa como header `Authorization: Bearer <token>`. Se ausente, conexão sem auth.
- **D-11:** `new ToolNode([...tools], { handleToolErrors: true })` — opção built-in do LangGraph. Captura qualquer erro lançado por MCP tool e injeta `ToolMessage` de erro automaticamente.
- **D-12:** Defensive catch em `getTools()` ao inicializar o cliente MCP: se servidor inacessível, `ctx.mcpTools = []` e log de `warn`. Brain inicializa normalmente com tools nativas.
- **D-13:** Adicionar `MCP_URL`, `MCP_TOOLS` e `MCP_AUTH_TOKEN` ao `.env.example` (nos apps brain-sdr e brain-echo).
- **D-14 (carry-over de STATE.md):** IMPORTANTE — ver seção Critical Findings abaixo. O issue #322 referenciado em STATE.md é do pacote **Python** (`langchain-mcp-adapters`). No pacote **JavaScript** (`@langchain/mcp-adapters`), o transport type para Streamable HTTP é `"http"` (não `"streamable_http"`).

### Claude's Discretion

- Implementação exata do timeout: se `handleToolErrors: true` não capturar timeouts de rede, adicionar `AbortSignal` com timeout (ex: 15s).
- Localização do `mcpClient` em BrainRunner: campo `private mcpClient: MultiServerMCPClient | null = null`.
- Nome exato do package: verificar `@langchain/langgraph-adapters` ou `@langchain/mcp-adapters` — **RESOLVIDO: usar `@langchain/mcp-adapters`**.

### Deferred Ideas (OUT OF SCOPE)

- Múltiplos MCP servers simultâneos (multi-server config) — MCP-F01
- MCP tools disponíveis globalmente para todos os Brains via config central — MCP-F02
- Reload de MCP tools em runtime sem restart — MCP-F03
- AbortSignal com timeout por tool (se handleToolErrors: true não for suficiente) — Claude decide em execução
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCP-01 | Brain se conecta a servidor MCP externo via `MCP_URL` ENV e carrega tools selecionadas por `MCP_TOOLS` CSV | MultiServerMCPClient com `url` + `headers` no `streamableHttpConnectionSchema`; `getTools()` retorna `DynamicStructuredTool[]`; filtro por nome via `Array.filter()` após `getTools()` |
| MCP-02 | Brain registra MCP tools como LangGraph `StructuredTool[]` no startup e as usa no grafo junto com tools nativas | `DynamicStructuredTool extends StructuredTool` — compatível com `bindTools()` e `ToolNode()`; spread pattern `[...nativeTools, ...ctx.mcpTools]` |
| MCP-03 | Se MCP server estiver inacessível no startup, Brain continua operando com tools nativas (warn, sem falha) | `onConnectionError: "ignore"` no ClientConfig OU try/catch em `getTools()`; D-12 usa try/catch — funciona mesmo se o servidor falhar depois de conectar |
| MCP-04 | Timeout ou falha de execução de MCP tool não corrompe o histórico de conversa do lead | `new ToolNode([...tools], { handleToolErrors: true })` — tipo verificado em `@langchain/langgraph@1.4.1` instalado |
| MCP-05 | Brain encerra conexão MCP de forma limpa no SIGTERM (processo Bun não trava no shutdown) | `MultiServerMCPClient.close()` — método `async close(): Promise<void>` confirmado no código-fonte; `process.on('SIGTERM', async () => { await this.close(); process.exit(0) })` em `BrainRunner.init()` |
</phase_requirements>

---

## Summary

A fase 15 integra o `@langchain/mcp-adapters` ao `BrainRunner` do SDK. O padrão é simples: `MultiServerMCPClient` é inicializado em `_compileGraph()` quando `MCP_URL` está definido, suas tools são carregadas via `getTools()` e injetadas em `BrainBuildContext.mcpTools[]`, e os Brains as espalham no `bindTools()` e `ToolNode()` junto com tools nativas. O shutdown limpo é gerenciado pelo novo `BrainRunner.close()` registrado como handler de SIGTERM em `init()`.

A pesquisa confirmou que `@langchain/mcp-adapters` é o package correto (não `@langchain/langgraph-adapters` — este não existe no registry). A versão atual é `1.1.3` (publicada em fev/2026). **Descoberta crítica:** o transport type string para Streamable HTTP no pacote **JavaScript** é `"http"` — não `"streamable_http"`. O issue #322 mencionado em D-14 é do repositório **Python** (`langchain-mcp-adapters`), onde o valor correto é `"streamable_http"`. No JS, os valores válidos são `"http"` e `"sse"`. Usar `"streamable_http"` no JS simplesmente não corresponde a nenhum schema e resultará na conexão ser ignorada.

O `ToolNode` no `@langchain/langgraph@1.4.1` (já instalado) aceita `{ handleToolErrors: boolean }` como segundo argumento — confirmado nos tipos instalados. O `MultiServerMCPClient` expõe `close(): Promise<void>` verificado diretamente no código-fonte do repositório.

**Recomendação principal:** Instalar `@langchain/mcp-adapters` no `packages/core` (onde o BrainRunner vive). Usar `transport: "http"` na configuração do MultiServerMCPClient. Usar `onConnectionError: "ignore"` para resiliência a falhas de servidor, complementado pelo try/catch em `getTools()` per D-12.

---

## Critical Findings (Transport Type Correction)

**D-14 no STATE.md/CONTEXT.md diz:** "streamable_http com underscore sempre — hífen causa ValueError"

**Esta regra se aplica ao pacote Python, não ao JS.**

| Pacote | Transport string correto | Alternativa que falha |
|--------|--------------------------|----------------------|
| Python `langchain-mcp-adapters` | `"streamable_http"` (underscore) | `"streamable-http"` (hífen) → ValueError |
| JS `@langchain/mcp-adapters` v1.1.3 | `"http"` | `"streamable_http"` → não reconhecido (schema não aceita) |

**Fonte verificada:** `types.ts` no repo langchain-ai/langchainjs, linha 351-356:
```typescript
transport: z.union([z.literal("http"), z.literal("sse")]).optional()
type: z.union([z.literal("http"), z.literal("sse")]).optional()
```

**Impacto no plano:** A config do `MultiServerMCPClient` deve usar `transport: "http"` (ou omitir o campo — a presença de `url` já é suficiente para identificar conexão HTTP).

[VERIFIED: github.com/langchain-ai/langchainjs/libs/langchain-mcp-adapters/src/types.ts]

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/mcp-adapters` | 1.1.3 | MCP client adapter — carrega tools de servidores MCP como `DynamicStructuredTool[]` | Pacote oficial LangChain para integração MCP; peer deps satisfeitos pelo stack atual (`@langchain/core ^1.0.0`, `@langchain/langgraph ^1.0.0`) |
| `@langchain/langgraph` | 1.4.1 (já instalado) | ToolNode com `handleToolErrors` | Já no projeto; opção `handleToolErrors: boolean` confirmada nos tipos instalados |

### Já Instalado (sem mudança de versão)

| Library | Versão Atual | Uso na fase |
|---------|-------------|-------------|
| `@langchain/core` | ^1.1.48 | Tipo `StructuredTool` para `ctx.mcpTools: StructuredTool[]` |
| `@brain-pkg/observability` | workspace:* | `createLogger()` para warn de servidor inacessível |

**Instalação (apenas pacote novo):**
```bash
# Adicionar ao packages/core (onde BrainRunner vive)
pnpm add @langchain/mcp-adapters --filter @brain-pkg/core
```

**Verificação de versão:**
```bash
npm view @langchain/mcp-adapters version  # → 1.1.3 (verificado em 2026-06-16)
npm view @langchain/mcp-adapters time.1.1.3  # → 2026-02-12T03:09:33.622Z
```

[VERIFIED: npm registry, 2026-06-16]

---

## Architecture Patterns

### Estrutura de Arquivos Afetados

```
packages/core/src/
  runner/
    runner.ts           ← add: close(), SIGTERM handler, MCP init em _compileGraph()
  brain/
    interface.ts        ← add: mcpTools: StructuredTool[] em BrainBuildContext

apps/brain-sdr/src/
  brain.ts              ← add: ...ctx.mcpTools em bindTools() e ToolNode(,{handleToolErrors:true})
  .env.example          ← add: MCP_URL, MCP_TOOLS, MCP_AUTH_TOKEN

apps/brain-echo/src/
  brain.ts              ← add: bindTools() + ToolNode com ctx.mcpTools (echo ganha tool calling)
  .env.example          ← add: idem
```

### Pattern 1: MultiServerMCPClient Config (Streamable HTTP)

```typescript
// Source: github.com/langchain-ai/langchainjs/libs/langchain-mcp-adapters/src/types.ts
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const client = new MultiServerMCPClient({
  mcpServers: {
    "external-server": {
      // transport: "http" é opcional — presença de `url` já identifica HTTP
      // NÃO usar "streamable_http" — esse valor é do Python, não do JS
      url: process.env.MCP_URL!,
      headers: process.env.MCP_AUTH_TOKEN
        ? { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` }
        : undefined,
    },
  },
  onConnectionError: "ignore",  // não trava o startup se servidor inacessível
});
```

[VERIFIED: github.com/langchain-ai/langchainjs/libs/langchain-mcp-adapters/src/types.ts]

### Pattern 2: getTools() + filtro por CSV

```typescript
// Source: github.com/langchain-ai/langchainjs/libs/langchain-mcp-adapters/src/client.ts
// getTools() sem args retorna TODAS as tools de todos os servers
let mcpTools = await client.getTools();  // DynamicStructuredTool[]

// Filtro por MCP_TOOLS CSV (D-08)
const mcpToolsEnv = process.env.MCP_TOOLS?.trim();
if (mcpToolsEnv) {
  const allowedTools = new Set(mcpToolsEnv.split(",").map(t => t.trim()).filter(Boolean));
  mcpTools = mcpTools.filter(t => allowedTools.has(t.name));
}
```

### Pattern 3: Bloco MCP em _compileGraph() com defensive catch

```typescript
// Localização: BrainRunner._compileGraph() — após createLLM(), antes de buildGraph()
// D-12: try/catch → mcpTools = [] se servidor inacessível
private mcpClient: MultiServerMCPClient | null = null;

// Em _compileGraph():
let mcpTools: StructuredTool[] = [];
const mcpUrl = process.env.MCP_URL?.trim();

if (mcpUrl) {
  try {
    this.mcpClient = new MultiServerMCPClient({
      mcpServers: {
        "external-server": {
          url: mcpUrl,
          ...(process.env.MCP_AUTH_TOKEN && {
            headers: { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` },
          }),
        },
      },
      onConnectionError: "ignore",
    });
    
    let allTools = await this.mcpClient.getTools();
    const toolFilter = process.env.MCP_TOOLS?.trim();
    if (toolFilter) {
      const allowed = new Set(toolFilter.split(",").map(t => t.trim()).filter(Boolean));
      allTools = allTools.filter(t => allowed.has(t.name));
    }
    mcpTools = allTools;
    this.logger.info({ count: mcpTools.length }, "MCP tools loaded");
  } catch (err) {
    this.logger.warn({ err }, "MCP server unreachable — continuing with native tools only");
    this.mcpClient = null;
    mcpTools = [];
  }
}

const ctx: BrainBuildContext = {
  llm,
  prompts: this.prompts,
  tools: filteredTools,
  sql: this.sql,
  mcpTools,  // D-01: sempre array (nunca undefined)
};
```

[VERIFIED: padrão baseado no código-fonte do client.ts + tipos confirmados]

### Pattern 4: close() e SIGTERM handler

```typescript
// BrainRunner.close() — novo método público
async close(): Promise<void> {
  if (this.mcpClient) {
    await this.mcpClient.close();  // Promise<void> confirmado
    this.mcpClient = null;
  }
}

// Em BrainRunner.init() — APÓS await this._compileGraph()
process.on('SIGTERM', async () => {
  this.logger.info({}, 'SIGTERM received — shutting down');
  await this.close();
  process.exit(0);
});
```

[VERIFIED: close() em github.com/langchain-ai/langchainjs/libs/langchain-mcp-adapters/src/client.ts L620-626]

### Pattern 5: ToolNode com handleToolErrors (D-11)

```typescript
// Source: @langchain/langgraph@1.4.1 dist/prebuilt/tool_node.d.ts (instalado localmente)
// ToolNodeOptions = { name?: string; tags?: string[]; handleToolErrors?: boolean }

// brain-sdr após a mudança:
const llmWithTools = ctx.llm.bindTools([
  boundQualifyTool,
  boundPauseSessionTool,
  boundFinishConversationTool,
  ...ctx.mcpTools,
]);

const toolNode = new ToolNode(
  [boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool, ...ctx.mcpTools],
  { handleToolErrors: true }
);
```

[VERIFIED: tipos em /root/Brain/node_modules/.pnpm/.../langgraph/dist/prebuilt/tool_node.d.ts]

### Pattern 6: BrainBuildContext interface

```typescript
// packages/core/src/brain/interface.ts — adicionar campo
export interface BrainBuildContext {
  llm: BaseChatModel;
  prompts: Record<string, string>;
  tools: StructuredTool[];
  sql?: Sql;
  mcpTools: StructuredTool[];  // D-01: sempre array, nunca undefined (D-02)
}
```

### Anti-Patterns a Evitar

- **Usar `"streamable_http"` no JS:** Valor inválido no schema do `@langchain/mcp-adapters` JS. Omitir `transport` ou usar `"http"`. [VERIFIED]
- **Inicializar `mcpClient` no construtor:** Padrão estabelecido é inicializar dependências de I/O em `_compileGraph()` — não no construtor.
- **Chamar `mcpClient.getTools()` por request:** Deve ser chamado UMA VEZ em startup. Tools são cacheadas no `MultiServerMCPClient.#serverNameToTools`.
- **`ctx.mcpTools` como `undefined`:** Deve ser sempre `[]` quando MCP_URL ausente — evita guards nos Brains (D-02).
- **Registrar SIGTERM antes de `_compileGraph()`:** Handler deve ser registrado APÓS `await this._compileGraph()` para garantir que `mcpClient` existe quando SIGTERM chegar.
- **`IBrainRunnerLike` ganhar `close()`:** Interface de transport não é responsável por lifecycle do cliente MCP (D-06).

---

## Don't Hand-Roll

| Problema | Não construir | Usar | Por quê |
|----------|--------------|------|---------|
| Conversão MCP tool → LangChain tool | Parser manual de tool schemas MCP | `client.getTools()` do `@langchain/mcp-adapters` | Lida com schemas JSON Schema → Zod, validação de input/output, SSE fallback automático |
| Captura de erro em tool call | try/catch em cada tool | `ToolNode({ handleToolErrors: true })` | Garante que todo `AIMessage` com `tool_calls` tem `ToolMessage` correspondente — sem esse par o thread fica corrompido permanentemente |
| Gerenciamento de conexão MCP | Pool manual de conexões, heartbeat | `MultiServerMCPClient` | Lida com reconexão, fallback SSE, retry, cleanup de recursos |
| Autenticação MCP | Middleware custom | `headers: { Authorization: "Bearer ..." }` no config | Suportado nativamente no schema `streamableHttpConnectionSchema` |

---

## Common Pitfalls

### Pitfall 1: onConnectionError default é "throw"

**O que dá errado:** `new MultiServerMCPClient({ mcpServers: {...} })` sem `onConnectionError` → se o servidor MCP estiver fora do ar no startup, o client lança exceção propagando para `_compileGraph()` → Brain não sobe.

**Por que acontece:** O default de `onConnectionError` é `"throw"` (verificado em `types.ts` L745-764).

**Como evitar:** Dois mecanismos combinados conforme D-12:
1. `onConnectionError: "ignore"` no config (skipa servers que falham ao conectar)
2. try/catch em torno de `client.getTools()` (captura falhas que ocorrem DEPOIS da conexão inicial)

**Sinais de alerta:** Brain não sobe + erro `MCPClientError` nos logs.

[VERIFIED: types.ts L745-764 — default é "throw"]

### Pitfall 2: Thread corrompido por MCP tool sem ToolMessage par

**O que dá errado:** Se uma MCP tool lança exceção (timeout, erro de rede), o `AIMessage` com `tool_calls` fica no histórico sem `ToolMessage` correspondente. Em chamadas subsequentes ao LangGraph o estado é inválido → `BrainOutputValidationError` em cascata.

**Por que acontece:** Sem `handleToolErrors: true`, o `ToolNode` re-lança a exceção em vez de criar um `ToolMessage` de erro.

**Como evitar:** `new ToolNode([...tools], { handleToolErrors: true })` — cria automaticamente um `ToolMessage` com o texto de erro como conteúdo.

**Sinais de alerta:** Erros em leads que já interagiram antes; mensagens do tipo "tool_call without matching tool_message" nos logs do LangGraph.

[VERIFIED: tool_node.d.ts instalado localmente em @langchain/langgraph@1.4.1]

### Pitfall 3: Transport type string errada

**O que dá errado:** Usar `transport: "streamable_http"` (underscore) — este é o valor do Python. No JS, o schema Zod aceita apenas `"http"` ou `"sse"`. O campo é **opcional** — se passado com valor inválido, a validação Zod do `clientConfigSchema.parse(config)` lançará erro no construtor.

**Como evitar:** Omitir `transport` completamente (a presença de `url` já identifica como HTTP) ou usar `transport: "http"`.

[VERIFIED: types.ts L351-356]

### Pitfall 4: Processo Bun trava no SIGTERM sem close()

**O que dá errado:** Sem `await this.close()` no handler SIGTERM, o processo Bun aguarda conexões ativas do MCP client finalizarem (keep-alive HTTP). Docker/Kubernetes mata o processo com SIGKILL após timeout (default 30s).

**Como evitar:** `BrainRunner.init()` registra `process.on('SIGTERM', ...)` que chama `await this.close()` antes de `process.exit(0)`.

[ASSUMED — baseado em comportamento padrão de HTTP keep-alive e Bun process lifecycle]

### Pitfall 5: brain-echo não tem bindTools() — MCP tools não teriam efeito

**O que dá errado:** `brain-echo/src/brain.ts` atual não chama `bindTools()` nem tem `ToolNode` — usa `ctx.llm.invoke()` diretamente. Se apenas espalhamos `ctx.mcpTools` sem adicionar `bindTools()` e `ToolNode`, as tools não ficam disponíveis para o LLM.

**Como evitar:** brain-echo precisa de refactor para padrão ReAct quando `ctx.mcpTools.length > 0`. Opção mais simples: adicionar `bindTools()` + `ToolNode` + `toolsCondition` ao brain-echo como parte desta fase, mesmo que com zero tools nativas. O grafo já funciona com array vazio.

**Nota:** `ctx.llm.invoke()` deve virar `ctx.llm.bindTools([...ctx.mcpTools]).invoke()` ou extrair `llmWithTools = ctx.llm.bindTools([...ctx.mcpTools])` no início.

[VERIFIED: brain-echo/src/brain.ts atual — não tem bindTools()]

---

## Code Examples

### Exemplo completo: `_compileGraph()` com MCP (parcial)

```typescript
// Source: padrão combinado de runner.ts existente + mcp-adapters API verificada
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { StructuredTool } from "@langchain/core/tools";

// Campo de instância (inicializado como null — padrão do projeto)
private mcpClient: MultiServerMCPClient | null = null;

private async _compileGraph(): Promise<void> {
  // ... (checkpointer, memoryManager, filteredTools, llm — igual ao atual) ...

  // --- BLOCO MCP (novo) ---
  let mcpTools: StructuredTool[] = [];
  const mcpUrl = process.env.MCP_URL?.trim();

  if (mcpUrl) {
    try {
      this.mcpClient = new MultiServerMCPClient({
        mcpServers: {
          "external-server": {
            url: mcpUrl,
            ...(process.env.MCP_AUTH_TOKEN && {
              headers: { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` },
            }),
          },
        },
        onConnectionError: "ignore",
      });

      let allTools = await this.mcpClient.getTools();

      const toolFilter = process.env.MCP_TOOLS?.trim();
      if (toolFilter) {
        const allowed = new Set(
          toolFilter.split(",").map((t) => t.trim()).filter(Boolean)
        );
        allTools = allTools.filter((t) => allowed.has(t.name));
      }

      mcpTools = allTools;
      this.logger.info(
        { brainId: this.brain.id, mcpToolCount: mcpTools.length },
        "MCP tools loaded successfully"
      );
    } catch (err) {
      this.logger.warn(
        { brainId: this.brain.id, err },
        "MCP server unreachable at startup — continuing with native tools only (MCP-03)"
      );
      this.mcpClient = null;
      mcpTools = [];
    }
  }
  // --- FIM BLOCO MCP ---

  const ctx: BrainBuildContext = {
    llm,
    prompts: this.prompts,
    tools: filteredTools,
    sql: this.sql,
    mcpTools,  // D-01: sempre array
  };

  this.compiledGraph = this.brain.buildGraph(ctx).compile({ checkpointer });
}
```

### Exemplo: brain-echo com MCP tools

```typescript
// apps/brain-echo/src/brain.ts — nova estrutura após fase 15
buildGraph(ctx: BrainBuildContext): any {
  // MCP-02: brain-echo ganha tool calling quando ctx.mcpTools.length > 0
  const allTools = [...ctx.mcpTools];  // apenas MCP tools (echo não tem nativas)
  
  if (!ctx.llm.bindTools) {
    throw new Error("LLM provider não suporta tool calling");
  }
  
  const llmWithTools = ctx.llm.bindTools(allTools);
  
  const llmNode = async (state: ...) => {
    const messagesForLLM = state.messages.slice(-contextWindowSize);
    const response = await llmWithTools.invoke([
      { role: "system", content: ctx.prompts["system"] },
      ...messagesForLLM,
    ]);
    const fullResponse = typeof response.content === "string" ? response.content : "";
    return {
      messages: [...state.messages, response],
      brainOutput: { fullResponse, responseMode: "text" as const },
      tokenUsage: extractTokenUsage(response),
    };
  };
  
  return new StateGraph(BrainStateAnnotation)
    .addNode("llm", llmNode)
    .addNode("tools", new ToolNode(allTools, { handleToolErrors: true }))
    .addEdge("__start__", "llm")
    .addConditionalEdges("llm", toolsCondition, ["tools", "__end__"])
    .addEdge("tools", "llm");
}
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@langchain/mcp-adapters` npm | MCP-01, MCP-02 | Pendente instalação | 1.1.3 | Nenhum — instalar em Wave 0 |
| MCP server externo | Testes de integração | Não verificável (externo) | — | Testes unit usam mock do `MultiServerMCPClient` |
| `@langchain/langgraph` | MCP-04 (ToolNode) | ✓ (já instalado) | 1.4.1 | — |
| Bun | Runtime | ✓ | 1.x | — |

**Dependências pendentes (bloqueantes para execução):**
- `@langchain/mcp-adapters@1.1.3` — instalar em Wave 0 via `pnpm add @langchain/mcp-adapters --filter @brain-pkg/core`

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in) |
| Config file | `package.json` scripts — sem arquivo de config separado |
| Quick run command | `bun test --filter packages/core` |
| Full suite command | `bun test` (raiz do monorepo via turbo) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Arquivo existe? |
|--------|----------|-----------|-------------------|-----------------|
| MCP-01 | BrainRunner inicializa MultiServerMCPClient quando MCP_URL definido | unit | `bun test packages/core/src/__tests__/unit/runner-mcp.test.ts` | ❌ Wave 0 |
| MCP-01 | Filtro MCP_TOOLS CSV funciona corretamente | unit | idem | ❌ Wave 0 |
| MCP-02 | ctx.mcpTools injetado no BrainBuildContext | unit | idem | ❌ Wave 0 |
| MCP-02 | brain-sdr espalha mcpTools em bindTools() e ToolNode() | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ (precisa de atualização) |
| MCP-03 | Servidor inacessível → mcpTools = [], warn, Brain sobe | unit | `bun test packages/core/src/__tests__/unit/runner-mcp.test.ts` | ❌ Wave 0 |
| MCP-04 | ToolNode com handleToolErrors captura erro e injeta ToolMessage | unit | `bun test packages/core/src/__tests__/unit/runner-mcp.test.ts` | ❌ Wave 0 |
| MCP-05 | SIGTERM chama close() e fecha mcpClient | unit | idem | ❌ Wave 0 |
| MCP-05 | close() é no-op quando mcpClient é null | unit | idem | ❌ Wave 0 |

### Sampling Rate

- **Por task commit:** `bun test packages/core/src/__tests__/unit/ && bun test apps/brain-sdr/src/__tests__/unit/`
- **Por wave merge:** `bun test` (suite completa)
- **Phase gate:** Suite completa verde antes do `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/__tests__/unit/runner-mcp.test.ts` — cobre MCP-01, MCP-02, MCP-03, MCP-04, MCP-05
- [ ] Mock de `MultiServerMCPClient` para testes unit — usando `mock()` do `bun:test`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Parcial | `MCP_AUTH_TOKEN` como Bearer token — simples mas adequado para v1.3; não expor em logs |
| V3 Session Management | Não | MCP é stateless por request |
| V4 Access Control | Não | MCP server é externo; não gerenciamos permissões |
| V5 Input Validation | Sim | `MultiServerMCPClient` valida schemas das tools via Zod; `MCP_TOOLS` CSV sanitizado com `.trim().filter(Boolean)` |
| V6 Cryptography | Não | Bearer token transmitido via HTTPS (responsabilidade do servidor MCP externo) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| MCP_AUTH_TOKEN vazado em logs | Information Disclosure | `this.logger.warn({ err }, ...)` — nunca logar `process.env.MCP_AUTH_TOKEN`; apenas logar o `err` |
| MCP tool injetando output malicioso no histórico | Tampering | `handleToolErrors: true` injeta `ToolMessage` de erro; output da tool não é interpretado como instrução — é conteúdo de `ToolMessage` |
| MCP_TOOLS CSV com nomes de tools inexistentes | Denial of Service | `Array.filter()` silenciosamente retorna `[]` para nomes não encontrados; Brain opera normalmente com tools nativas |

---

## Assumptions Log

| # | Claim | Section | Risk se errado |
|---|-------|---------|----------------|
| A1 | Processo Bun trava sem `close()` no SIGTERM por causa de HTTP keep-alive | Common Pitfalls — Pitfall 4 | Baixo: pior caso é SIGKILL após timeout do Docker, não corrupção de dados |
| A2 | brain-echo precisa de refactor completo para ReAct para suportar MCP tools | Common Pitfalls — Pitfall 5 | Médio: se não refatorado, MCP-02 para brain-echo não é cumprido |

---

## Open Questions (RESOLVED)

1. **brain-echo com zero MCP tools — ToolNode break?**
   - O que sabemos: `new ToolNode([], { handleToolErrors: true })` com array vazio
   - O que era incerto: se `toolsCondition` funciona corretamente quando `tool_calls` vem de `ctx.llm.bindTools([])` (LLM sem tools disponíveis)
   - **RESOLVED:** Adotada a abordagem `toolsCondition` com `allTools = []` incondicionalmente. Com array vazio, `ctx.llm.bindTools([])` não expõe tools ao LLM, portanto o LLM nunca emite `tool_calls` — `toolsCondition` sempre roteia para `__end__`. `new ToolNode([], { handleToolErrors: true })` não lança na construção (verificado em 15-01 Task 1, teste "ToolNode com array vazio e handleToolErrors:true não lança em construção"). Implementado em 15-02 Task 2.

2. **`onConnectionError: "ignore"` cobre erros de `getTools()`?**
   - O que sabemos: `onConnectionError` controla falhas na fase de `initializeConnections()`; `getTools()` chama `initializeConnections()` internamente
   - O que era incerto: erros que ocorrem DEPOIS da conexão (ex: timeout na listagem de tools) podem não ser cobertos
   - **RESOLVED:** Adotada dupla proteção per D-12: `onConnectionError: "ignore"` cobre falhas na fase de conexão inicial; try/catch em torno de `getTools()` captura erros que ocorrem após a conexão (timeout na listagem, resposta malformada). Implementado em 15-01 Task 2 no bloco MCP de `_compileGraph()`.

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED] `github.com/langchain-ai/langchainjs/libs/langchain-mcp-adapters/src/types.ts` — schema Zod completo; transport type strings `"http"` e `"sse"`; `onConnectionError` default `"throw"`; `ClientConfig` interface
- [VERIFIED] `github.com/langchain-ai/langchainjs/libs/langchain-mcp-adapters/src/client.ts` — `MultiServerMCPClient` constructor, `getTools()` overloads, `close()` implementação
- [VERIFIED] `github.com/langchain-ai/langchainjs/libs/langchain-mcp-adapters/src/index.ts` — exports: `MultiServerMCPClient`, `loadMcpTools`, tipos
- [VERIFIED] `/root/Brain/node_modules/.pnpm/.../langgraph/dist/prebuilt/tool_node.d.ts` — `ToolNodeOptions = { handleToolErrors?: boolean }` em `@langchain/langgraph@1.4.1`
- [VERIFIED] `npm view @langchain/mcp-adapters` — versão 1.1.3, publicada 2026-02-12, peer deps `@langchain/core ^1.0.0` + `@langchain/langgraph ^1.0.0`
- [VERIFIED] `npm view @langchain/langgraph-adapters` — **pacote não existe** no registry

### Secondary (MEDIUM confidence)

- [CITED] `github.com/langchain-ai/langchain-mcp-adapters/issues/322` — issue sobre confusão `streamable_http` vs `streamable-http` no **Python** — context sobre D-14

### Tertiary (LOW confidence)

- [ASSUMED] Comportamento de Bun no SIGTERM com HTTP keep-alive ativo

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@langchain/mcp-adapters` verificado no npm registry, código-fonte inspecionado no GitHub
- Architecture: HIGH — padrão segue código existente em `runner.ts`; API verificada diretamente no código-fonte do pacote
- Pitfalls: HIGH para P1/P2/P3 (verificados no código); LOW para P4 (comportamento de runtime Bun)
- Transport type correction: HIGH — verificado no schema Zod do código-fonte real (não documentação)

**Research date:** 2026-06-16
**Valid until:** 2026-08-16 (estável — @langchain/mcp-adapters muda lentamente)
