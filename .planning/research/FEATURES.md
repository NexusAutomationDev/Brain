# Features Research: Brain Core v1.3

**Domain:** MCP tool integration + dynamic responseMode for existing AI agent platform (Bun + LangGraph)
**Researched:** 2026-06-15
**Scope:** v1.3 new features only. v1.0–v1.2 infrastructure (BrainRunner, ToolsRegistry, BrainOutput, existing tools) is already built.
**Overall confidence:** HIGH (verified via official LangChain.js docs, Anthropic API docs, @langchain/mcp-adapters GitHub, multiple cross-checked sources)

---

## MCP Integration

### Table Stakes (must-have)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`@langchain/mcp-adapters` as integration layer** | Official LangChain.js MCP adapter converts MCP tool schemas into `StructuredTool` objects compatible with `ToolNode` and `createReactAgent`. Direct MCP SDK usage would require manual schema translation and tool wrapping — the adapter eliminates that. | Low | Install: `npm install @langchain/mcp-adapters @modelcontextprotocol/sdk`. Peer deps: `@langchain/core`, `@langchain/langgraph`. |
| **`MultiServerMCPClient` for HTTP/SSE transport** | The Brain connects to n8n's MCP server over HTTP. `MultiServerMCPClient` is the correct class — supports Streamable HTTP (preferred, protocol v2025-03-26+) with automatic SSE fallback for legacy servers. n8n exposes MCP via `/webhook/mcp/:workflowId` (SSE) or Streamable HTTP endpoint. | Low | Config shape: `{ url: MCP_URL, headers?: { Authorization: "Bearer ..." }, automaticSSEFallback: true, reconnect: { enabled: true, maxAttempts: 5, delayMs: 2000 } }`. |
| **`getTools()` at Brain startup, tools injected into graph** | Tools must be loaded once during `IBrain.init()` — not per-request. `getTools()` returns `Promise<StructuredTool[]>`. These tools are then passed to the existing `ToolNode` in `buildGraph()` alongside the existing LangGraph tools (qualify_lead, pause_session, finish_conversation). | Low | Pattern: `const mcpTools = await mcpClient.getTools(); const allTools = [...existingTools, ...mcpTools];`. The `ToolNode` receives the merged array. |
| **Tool name filtering via `MCP_TOOLS` ENV** | An MCP server exposes all its tools. The Brain should only load the specific tools configured by the client (`MCP_TOOLS=getAvailableDate,schedule_meeting`). This is safety scoping — prevents the LLM from accidentally calling unintended tools exposed by the same n8n server. | Low | Filter after `getTools()`: `const filtered = mcpTools.filter(t => allowedNames.includes(t.name));`. The `MCP_TOOLS` CSV is parsed at startup. Empty/absent `MCP_TOOLS` = load all tools from server (acceptable default for single-tool servers). |
| **MCP tools described in system prompt** | MCP tools are foreign to the Brain's knowledge — the LLM needs natural-language descriptions to know when and how to invoke them. The system prompt must include the tool's name, purpose, required inputs, and expected output format. | Low | Each `StructuredTool` from `getTools()` has `.name`, `.description`, `.schema` (Zod). Render these into the prompt template at `init()` time. Pattern already exists in Brain SDR for internal tools. |
| **`close()` on Brain shutdown** | `MultiServerMCPClient.close()` disconnects from all MCP servers. Must be called on SIGTERM/SIGINT to avoid dangling connections. Without it, the n8n server may hold the connection open and throttle or error on reconnection. | Low | Call in `BrainRunner` shutdown hook or in `IBrain` teardown if added. |
| **Connection error handling on startup** | If the MCP server is unreachable at startup, the Brain should fail fast with a clear error. Silent degradation (proceeding without MCP tools) is worse than a startup crash — the LLM would try to call tools that don't exist in the `ToolNode`. | Low | Use `onConnectionError: "throw"` (default). Wrap `mcpClient.getTools()` in `init()` in a try/catch that produces a `BrainConfigurationError`. Log the MCP_URL and error. |

### Nice-to-Have

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Tool call result logging via `afterToolCall` hook** | `MultiServerMCPClient` supports `afterToolCall: (tool, result) => void`. Logging MCP tool calls and their results separately from LangGraph node traces makes debugging n8n failures trivial. | Low | Hook receives tool name, input args, and result. Pass to Pino logger with `level: "debug"`. Langfuse/LangSmith already captures the trace, but explicit log is useful for production ops. |
| **Reconnect config for production resilience** | `reconnect: { enabled: true, maxAttempts: 5, delayMs: 2000 }` in the HTTP config handles transient n8n restarts without requiring a Brain restart. | Low | Already supported by `@langchain/mcp-adapters` HTTP transport. Add to default config. |
| **`MCP_URL` absent = no MCP tools, no failure** | If `MCP_URL` is not set, the Brain should proceed without MCP tools (useful for Brains that don't need external tools). Makes the feature purely additive — v1.2 Brains not setting `MCP_URL` continue to work unchanged. | Low | Guard in `init()`: `if (!process.env.MCP_URL) return;`. No client created, `mcpTools = []`. |
| **`prefixToolNameWithServerName: false`** | Default is false. Keep it false — tool names in the system prompt and in the LLM's function calls must match exactly. Prefixing would require the prompt to use `n8n__getAvailableDate` instead of `getAvailableDate`. | Low | Default is already correct. Document the decision explicitly in Brain SDR's init config. |

### Anti-Features (what NOT to build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Per-request MCP connection (`connect` + `getTools` per message)** | Each `getTools()` creates a new HTTP session. For a Brain handling 100 messages/minute, this creates 100 connections to n8n per minute — unnecessary overhead and rate-limiting risk. | Connect once at startup (`init()`), reuse `StructuredTool[]` across all `run()` calls. Tools are registered in the graph at compile time, not per-invocation. |
| **Proxying MCP calls through Brain HTTP API** | Building a custom endpoint (`POST /mcp/call`) that the LangGraph tools hit — instead of calling the MCP server directly — adds an extra network hop, custom auth, and a new failure mode with no benefit. | Use `@langchain/mcp-adapters` directly. The adapter handles the MCP protocol; the Brain's HTTP layer (Hono) is unrelated. |
| **Runtime tool re-discovery (polling MCP server for new tools)** | Dynamic tool list changes at runtime (without rebuilding the graph) would require rebuilding `ToolNode` and re-compiling the graph mid-execution. LangGraph graphs are compiled once. | Rebuild the Brain (restart container) to pick up new MCP tools. Tools are startup configuration, not runtime-mutable state. |
| **Implementing MCP server in the Brain** | The Brain is an MCP client (consumer), not an MCP server. Building an MCP server in the Brain would expose Brain functionality as MCP tools — a completely different feature with no use case in v1.3. | The Brain calls n8n's MCP server. n8n is the MCP server. |
| **Manual `@modelcontextprotocol/sdk` client management** | Writing raw MCP protocol handling (JsonRpc, session management, tool schema parsing) when `@langchain/mcp-adapters` already does this. | Use `MultiServerMCPClient`. The adapter is official, maintained by LangChain, and handles edge cases (SSE fallback, reconnect, auth). |
| **Storing MCP tool results in leads table or separate DB table** | MCP tool results are intermediate agent state — already captured in the LangGraph checkpoint via `ToolMessage` entries in the messages array. A separate DB write duplicates data and adds a write failure mode. | MCP tool call results live in the LangGraph checkpoint (PostgresSaver). Queryable via checkpoint inspection if needed. |

### MCP Tool Lifecycle (definitive)

```
Brain startup (IBrain.init()):
  1. Parse MCP_URL from ENV — skip if absent
  2. Parse MCP_TOOLS CSV → allowedNames[]
  3. new MultiServerMCPClient({ n8n: { url: MCP_URL, automaticSSEFallback: true } })
  4. mcpTools = await client.getTools()        ← throws MCPClientError if unreachable
  5. filtered = mcpTools.filter(t => allowedNames.includes(t.name))
  6. Store filtered tools on Brain instance
  7. Merge into allTools = [...existingTools, ...filtered] in buildGraph()
  8. Compile graph with ToolNode(allTools)

Per message (IBrain.run()):
  → No MCP connection work. Tool calls happen inside ToolNode as usual.
  → When LLM calls getAvailableDate, ToolNode invokes the MCP adapter's tool.run()
  → Adapter opens a tool-call session to n8n MCP server, executes, returns result
  → Result lands in ToolMessage in graph state → LLM continues

Brain shutdown:
  → await client.close()
```

### Complexity Assessment

Overall complexity: **Low-Medium**. The `@langchain/mcp-adapters` package handles all MCP protocol details. The integration work is: (1) adding `MultiServerMCPClient` init in `IBrain.init()`, (2) merging MCP tools into the `ToolNode`, (3) rendering tool descriptions in the system prompt. The main risk is n8n's MCP transport format — verify whether n8n uses SSE or Streamable HTTP to confirm the correct `automaticSSEFallback` setting. Estimated effort: 1.5–2 days.

### Dependencies

- Requires: `@langchain/mcp-adapters` package (new dependency)
- Requires: `@modelcontextprotocol/sdk` (peer dep, likely already transitive)
- Requires: n8n MCP server running and accessible from Brain container (network, auth)
- Integrates with: existing `ToolNode` in Brain SDR graph — MCP tools are appended, not replacing
- Integrates with: existing `BRAIN_TOOLS` whitelist (TD-03 note: whitelist doesn't cover tools bound directly in buildGraph — same limitation applies here; MCP tools bypass whitelist by design since they're declared via `MCP_TOOLS` ENV)
- No schema migration required

---

## Dynamic responseMode

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`responseMode` in `BrainOutput` decided by LLM, not hardcoded** | v1.2 hardcodes `responseMode: "text"` in the brain node. The entire point of `BrainOutput` structured output was to allow the LLM to control the response format. Hardcoding removes this capability and defeats the schema contract. | Medium | The LLM must output a `BrainOutput`-shaped object as its final response. `responseMode` must be one of `"text" | "audio" | "image"`. |
| **`createReactAgent` `responseFormat` parameter** | LangGraph's prebuilt `createReactAgent` accepts a `responseFormat` parameter (Zod schema or JSON schema). When provided, the agent makes a **separate final LLM call** after the tool-calling loop completes to produce a structured response. The result lands in `state.structuredResponse`. | Medium | This is the correct mechanism for Brain SDR — tool calling (qualify_lead, MCP tools) happens normally; the final structured response is enforced afterward. No conflict between tool calling and structured output. |
| **Zod schema for `BrainOutput` passed as `responseFormat`** | `BrainOutputSchema` (already exists in `packages/core`) should be passed as `responseFormat`. The agent enforces the schema on the final response. | Low | `BrainOutputSchema` already defined with Zod in v1.2. Pass it directly: `createReactAgent({ ..., responseFormat: BrainOutputSchema })`. Access result via `state.structuredResponse` not `state.messages[-1]`. |
| **Multi-provider support: OpenAI and Anthropic** | Brain SDR must work with both providers. `responseFormat` uses `.withStructuredOutput()` internally. LangChain.js abstracts provider differences — the same Zod schema works for both. | Medium | See multi-provider section below for the one actual difference. |
| **Conditional `mediaUrl` enforcement** | When `responseMode` is `"audio"` or `"image"`, `mediaUrl` is required in `BrainOutput`. This is already enforced by `BrainOutputSchema` Zod conditional validation (`.superRefine()`). No changes needed to the schema — only to how the LLM is prompted to produce it. | Low | System prompt must instruct: "When responseMode is audio or image, you MUST provide mediaUrl." This is a prompt concern, not a schema concern. |

### Schema Design

The `BrainOutput` Zod schema (already defined in v1.2) is the source of truth. No schema changes are needed. Key structure:

```typescript
// Already exists in packages/core — do not change
const BrainOutputSchema = z.object({
  fullResponse: z.string().describe("The full text of the response to send to the user"),
  responseMode: z.enum(["text", "audio", "image"]).describe(
    "How the response should be delivered: text for plain text, audio for voice message, image for image attachment"
  ),
  mediaType: z.string().optional().describe("MIME type when responseMode is audio or image"),
  mediaUrl: z.string().url().optional().describe("URL of the media file when responseMode is audio or image"),
}).superRefine((data, ctx) => {
  if ((data.responseMode === "audio" || data.responseMode === "image") && !data.mediaUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "mediaUrl required when responseMode is audio or image" });
  }
});
```

**Design recommendation:** Add richer `.describe()` strings to guide the LLM:
- `responseMode`: "Choose 'audio' only when the user explicitly asks for a voice message. Choose 'image' only when you are providing a visual (chart, image, diagram). Default to 'text'."
- `fullResponse`: "Always fill this with the complete text response, even when responseMode is audio or image — this is the fallback for clients that cannot render media."

**What `responseFormat` does internally in LangGraph:**
The `responseFormat` schema becomes a tool (internally named based on schema `$title`). After the main agent loop finishes, a second LLM call is made with only this tool available — forcing the model to output the schema shape. The result goes into `state.structuredResponse`, not `state.messages`. The existing `BrainRunner.run()` must read from `state.structuredResponse` instead of parsing `state.messages[-1]`.

**Impact on `BrainRunner.run()`:**
```typescript
// Before (v1.2): reading from last message
const lastMsg = result.messages[result.messages.length - 1];

// After (v1.3): reading from structuredResponse
const output = result.structuredResponse as BrainOutput;
// BrainOutputSchema validation still applies via BrainOutputValidationError
```

### Multi-Provider Considerations

**The core insight:** LangChain.js's `createReactAgent` with `responseFormat` uses `.withStructuredOutput()` on the model for the final response call. Both OpenAI and Anthropic support this, but their internal mechanism differs.

| Aspect | OpenAI | Anthropic |
|--------|--------|-----------|
| Default `withStructuredOutput` method | `json_schema` (native structured output, JSON Schema constrained decoding) | `functionCalling` (tool-based, structured output via forced tool call) |
| Tool calling + structured output same call | Supported natively | Also supported — they are separate mechanisms: tool calls control what Claude does, output_config controls the final response format |
| LangChain abstraction | `ChatOpenAI.withStructuredOutput(schema)` | `ChatAnthropic.withStructuredOutput(schema)` |
| Difference in practice | OpenAI uses JSON Schema constrained decoding directly on the response | Anthropic implements structured output via a forced tool call internally (the `functionCalling` method) — same external behavior |
| `method` parameter relevance | `json_schema` is default and recommended | Default `functionCalling` is fine; `json_schema` (Anthropic native structured outputs, Nov 2025 GA) is also available but requires `output_config.format` — not exposed via LangChain's `withStructuredOutput` yet |
| `strict` mode | Supported via `{ strict: true }` in `withStructuredOutput` options | `strict: true` only applies to `functionCalling` method; incompatible with `json_schema` method |
| Schema support gaps | Full JSON Schema support | Recursive schemas not supported; `additionalProperties` complex cases limited; same limits as Anthropic structured outputs API |

**What this means for Brain SDR implementation:**

1. Use the same `BrainOutputSchema` (Zod) for both providers — no branching needed.
2. `createReactAgent({ ..., responseFormat: BrainOutputSchema })` works identically for both `ChatOpenAI` and `ChatAnthropic`.
3. The only code change needed when switching providers is the LLM instantiation — the graph, schema, and `responseFormat` configuration are provider-agnostic.
4. If using Anthropic and hitting structured output issues: use `withStructuredOutput(schema, { method: "functionCalling" })` explicitly (it is the default, but being explicit avoids ambiguity).

**Known provider-specific pitfall:**

Anthropic's `withStructuredOutput` with `functionCalling` method: the model may occasionally output reasoning/thinking blocks before the tool call. This can cause `withStructuredOutput` to fail parsing. This is a known LangChain.js issue (#10437 — affects extended thinking/Sonnet 3.7 and newer). Mitigation: disable extended thinking when using structured output, or use `ChatAnthropic` without extended thinking enabled.

**The `responseFormat` + tool calling compatibility question (fully resolved):**

LangGraph's `createReactAgent` with `responseFormat`:
- During the agent loop: normal tool calling runs (qualify_lead, MCP tools). No structured output constraint applied to intermediate steps.
- After the loop: a final separate LLM call enforces `BrainOutputSchema`. No tool calls in this final call.
- These are two separate LLM calls — no API-level conflict between tool use and structured output.
- Anthropic API: `output_config.format` (structured output) and `tools` (tool use) can co-exist in the same request if needed, but LangGraph handles them in separate calls anyway.

### Anti-Features for responseMode

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **`withStructuredOutput()` on the agent's main LLM (not via `responseFormat`)** | Calling `llm.withStructuredOutput(BrainOutputSchema)` on the model used in the agent node prevents tool calling — when structured output is active on the main model, it cannot emit tool calls in the same response. This is the "conflict" people hit. | Use `responseFormat` parameter in `createReactAgent`. LangGraph handles the two-phase approach internally: tools in phase 1, structured output in phase 2. |
| **Parsing `responseMode` from `state.messages[-1]` with regex/JSON.parse** | Brittle. The LLM may wrap the JSON in markdown backticks, add text before/after, or omit fields. This was the pre-v1.2 approach. | Use `state.structuredResponse` from `createReactAgent` with `responseFormat`. The adapter guarantees the schema. |
| **Adding `responseMode` as a separate LangGraph tool** | "Call the set_response_mode tool with value='audio'" — this is unnecessary complexity. The `responseFormat` mechanism already forces the LLM to output the complete `BrainOutput` struct including `responseMode`. A separate tool adds a redundant step. | Include `responseMode` as a field in `BrainOutputSchema` — already done in v1.2. |
| **Making `responseMode` a global Brain config (ENV variable)** | Setting `RESPONSE_MODE=audio` at the ENV level means the Brain can never adapt per-conversation. The point of dynamic responseMode is that the LLM decides per-response. | Let the LLM decide based on context. Guide it with the `responseMode` field description in the schema and system prompt instructions. |
| **Separate graph node for "response formatting"** | Building a custom node at the end of the graph that calls `llm.withStructuredOutput(BrainOutputSchema)` is a manual reimplementation of what `responseFormat` in `createReactAgent` already provides. | Use the built-in `responseFormat` parameter. |

---

## Cross-Feature Dependencies for v1.3

```
MCP Integration:
  @langchain/mcp-adapters installed
    └── MultiServerMCPClient.init() in IBrain.init()
          └── getTools() → filtered by MCP_TOOLS ENV
                └── allTools = [...existingTools, ...mcpTools]
                      └── ToolNode(allTools) in buildGraph()
                            └── LLM can now call getAvailableDate, schedule_meeting

Dynamic responseMode:
  BrainOutputSchema (already in packages/core)
    └── createReactAgent({ ..., responseFormat: BrainOutputSchema })
          └── agent loop: normal tool calling (qualify_lead, MCP tools, etc.)
          └── final call: enforces BrainOutputSchema → state.structuredResponse
                └── BrainRunner.run() reads state.structuredResponse (not messages[-1])
                      └── BrainOutputValidationError still thrown if null

Both features coexist cleanly:
  → MCP tools are in ToolNode (phase 1 of agent loop)
  → BrainOutput structure is enforced after loop (phase 2)
  → No conflict
```

---

## Feature Complexity Summary

| Feature | Core Complexity | High-Risk Sub-Feature | Estimated Effort |
|---------|----------------|----------------------|-----------------|
| MCP Integration (MultiServerMCPClient + tool injection) | Low-Medium | n8n transport format (SSE vs Streamable HTTP) — verify before assuming | 1.5–2 days |
| MCP system prompt integration | Low | Rendering tool descriptions from StructuredTool schema | 0.5 days |
| Dynamic responseMode via `responseFormat` | Medium | Changing BrainRunner.run() to read `structuredResponse` — breaks existing SDR if not done carefully | 1–1.5 days |
| Multi-provider validation (OpenAI + Anthropic) | Low | Anthropic extended thinking + withStructuredOutput conflict (avoid extended thinking) | 0.5 days |
| TD-01 fix (`qualifier.ts` `prepare: false`) | Low | Carry-over tech debt, targeted fix | 0.5 days |
| **Total v1.3 estimate** | | | **4–5 days** |

---

## Sources

- [@langchain/mcp-adapters GitHub (langchainjs)](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters)
- [LangChain MCP Adapters announcement](https://changelog.langchain.com/announcements/mcp-adapters-for-langchain-and-langgraph)
- [LangChain.js MCP documentation (official)](https://docs.langchain.com/oss/javascript/langchain/mcp)
- [MCP Adapters JS reference](https://reference.langchain.com/javascript/langchain-mcp-adapters)
- [Anthropic Structured Outputs API (official, GA)](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic Tool Use Overview (official)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [LangChain Structured Output (JS official)](https://docs.langchain.com/oss/javascript/langchain/structured-output)
- [createReactAgent responseFormat parameter type](https://reference.langchain.com/javascript/types/_langchain_langgraph.prebuilt.CreateReactAgentParams.html)
- [LangGraph issue #5872 — responseFormat as tool internally](https://github.com/langchain-ai/langgraph/issues/5872)
- [LangGraph JS issue #1277 — strict mode for responseFormat JSON Schema](https://github.com/langchain-ai/langgraphjs/issues/1277)
- [Get Structured Output from LangGraph (Agentuity)](https://agentuity.com/blog/langgraph-structured-output)
- [LangChain.js withStructuredOutput thinking block conflict issue #10437](https://github.com/langchain-ai/langchainjs/issues/10437)
- [n8n MCP Server endpoint format](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/)
- [LangGraph MCP Client Setup (generect.com, 2026)](https://generect.com/blog/langgraph-mcp/)
- [Connecting to MCP Server with LangChain.js (Marc Nuri)](https://blog.marcnuri.com/connecting-to-mcp-server-with-langchainjs)
