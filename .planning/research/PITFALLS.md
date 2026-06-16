# Domain Pitfalls

**Domain:** TypeScript AI Agent Platform (LangGraph + PostgreSQL/PGVector + Bun + Drizzle ORM, multi-tenant)
**Researched:** 2026-06-11 (v1.0) · Updated 2026-06-13 (v1.1 addendum) · Updated 2026-06-15 (v1.3 addendum)
**Overall confidence:** HIGH — all pitfalls verified against official docs, GitHub issues, or multiple production reports

---

## v1.3 Addendum: MCP Integration + Dynamic responseMode Pitfalls

> These pitfalls are specific to adding MCP tool integration and dynamic responseMode (withStructuredOutput) to the existing Brain Core v1.2 system (Bun + LangGraph 1.3.7 + postgres.js + PostgresSaver). Generic pitfalls from v1.0/v1.1 are preserved below. Do not repeat already-documented risks — reference them inline only.

---

## MCP Integration Pitfalls

### MCP-01: SSE Transport is Deprecated — Use Streamable HTTP from Day One

**Severity:** HIGH

**What goes wrong:** n8n's MCP Server Trigger and the MCP spec both supported SSE transport historically. SSE is now deprecated in the MCP specification (deprecated in the March 2025 spec revision) and multiple platforms (Atlassian, Keboola) have drop-dead dates in mid-2026. If Brain Core is built against the SSE transport, it will need to be migrated to Streamable HTTP under deadline pressure.

The SSE transport also has structural problems: it requires two endpoints (one for SSE stream, one for POST), creates long-lived connections that die under load balancers and serverless infrastructure, and has no clean recovery path when the connection drops mid-tool-call.

**Why it happens:** Much of the online tutorial content still shows SSE (`/sse` endpoint), and `@langchain/mcp-adapters` will auto-fallback to SSE if the server supports it, masking the deprecation.

**Consequences:** Forced migration mid-production, broken connections under infrastructure scaling, vendor deadline-driven breakages.

**Prevention:**
- Set `transport: "streamable_http"` (underscore, not hyphen — see MCP-02) explicitly in every server config
- n8n's MCP Server Trigger supports both SSE and Streamable HTTP (HTTP Streamable is now the recommended method for all new implementations per n8n docs)
- When using `MultiServerMCPClient` in `@langchain/mcp-adapters`, always specify transport explicitly — never rely on auto-negotiation in production:
```typescript
const client = new MultiServerMCPClient({
  servers: {
    n8n: {
      transport: "streamable_http",  // NOT "streamable-http" — see MCP-02
      url: process.env.MCP_URL!,
      headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
    },
  },
});
```

**Phase to address:** Phase 14 (MCP integration), during the initial client setup. Do not defer.

---

### MCP-02: Transport Name Typo Causes Silent ValueError — `streamable_http` Not `streamable-http`

**Severity:** HIGH

**What goes wrong:** `@langchain/mcp-adapters` accepts `"streamable_http"` (underscore) as the transport name. Developers writing `"streamable-http"` (hyphen, which looks more natural and matches other conventions) get a `ValueError: Unsupported transport: streamable-http. Must be one of: 'stdio', 'sse', 'websocket', 'streamable_http'`. This error fires at startup during client initialization, before any tool is loaded, and the error message mentions the correct spelling — but only if you read it carefully.

**Why it happens:** The library uses Python-style underscore naming for an option developers expect to follow URL/HTTP kebab-case convention. Confirmed bug/UX issue in the langchain-mcp-adapters repository (issue #322).

**Consequences:** Brain startup fails with a cryptic error. MCP tools are never registered. The Brain starts without external tools, but the error is only caught if startup failure is handled properly (see MCP-04).

**Prevention:**
- Use a constant for the transport name, not an inline string literal:
```typescript
const MCP_TRANSPORT = "streamable_http" as const; // verified spelling
```
- Add a startup test that explicitly validates the transport config string before attempting connection

**Phase to address:** Phase 14. Add a config validation step before `client.initialize()`.

---

### MCP-03: MultiServerMCPClient Silent Tool Loss When Any Server Fails

**Severity:** CRITICAL

**What goes wrong:** When `MultiServerMCPClient` connects to multiple MCP servers and any one server fails to connect, all tools from all servers are silently lost — including tools from healthy servers. Confirmed bug in langchain-mcp-adapters (Python issue #492). The root cause is `asyncio.gather()` without `return_exceptions=True`, causing one failed task to cancel all remaining tasks. The JS implementation uses a similar pattern.

In the Brain Core context: if Brain SDR configures `MCP_TOOLS=search_crm,schedule_meeting` and the n8n server is unreachable at startup, the Brain's `allTools` array will be empty — including the existing LangGraph-native tools (`pause_session`, `finish_conversation`, `qualify_lead`). The graph compiles with zero tools, and the LLM will output plain text without ever calling tools.

**Why it happens:** The concurrent connection initialization pattern does not isolate per-server failures. One broken server poisons the entire tool registry.

**Consequences:** Brain starts without any tools. LLM outputs plain text. No error is surfaced to the user. Conversations appear to work but no tools execute.

**Prevention:**
- Set `onConnectionError: "ignore"` in the MultiServerMCPClient config to skip failed servers:
```typescript
const client = new MultiServerMCPClient({
  servers: { n8n: { ... } },
  // If n8n is down, continue with zero MCP tools rather than crashing
  onConnectionError: "ignore",
});
```
- Always concatenate MCP tools with existing Brain tools AFTER the MCP client initializes — the local tools are registered unconditionally:
```typescript
const mcpTools = await client.getTools().catch(() => []); // defensive fallback
const allTools = [...brainTools, ...mcpTools]; // brainTools always present
```
- Log how many MCP tools were loaded at startup: `logger.info({ count: mcpTools.length, tools: mcpTools.map(t => t.name) }, 'MCP tools loaded')`
- Monitor: if `mcpTools.length === 0` in production and `MCP_URL` is set, alert — this is unexpected

**Phase to address:** Phase 14. The defensive fallback pattern must be in the initial MCP integration implementation, not added later.

---

### MCP-04: Brain Does Not Start if MCP Server is Unreachable at Startup

**Severity:** HIGH

**What goes wrong:** The default behavior of `MultiServerMCPClient.initialize()` (or `loadMcpTools()`) is to throw if any configured server is unreachable. If `BrainRunner.init()` awaits MCP tool loading without a fallback, and the n8n server is down (planned maintenance, network issue, cold start), the Brain fails to start entirely. All incoming messages are dropped. RabbitMQ messages pile up in the queue.

This is especially dangerous because MCP server unavailability at startup is not a bug — it's an expected operational condition (n8n restarts, network blips, cold starts in serverless deployments).

**Why it happens:** Treating external tool registration as a hard dependency of Brain startup couples the Brain's availability to the n8n server's availability.

**Consequences:** Brain fails to start, Docker restarts the container, creating a restart loop. If n8n is down for 30 minutes, Brain is down for 30 minutes — this violates the requirement that Brain SDR must be available to receive messages even when optional integrations are unavailable.

**Prevention:**
- Make MCP tool loading non-blocking and non-fatal at startup:
```typescript
async function loadMcpToolsSafely(): Promise<StructuredTool[]> {
  try {
    const client = new MultiServerMCPClient({ ... });
    await client.initialize();
    return await client.getTools();
  } catch (err) {
    logger.warn({ err }, 'MCP server unreachable at startup — running without MCP tools');
    return [];
  }
}
```
- Implement lazy re-registration: schedule a retry to load MCP tools after 30s, 60s, 120s — and rebuild the graph if tools become available. This is complex; defer to v1.4 if not needed at launch
- For v1.3: accept "MCP tools unavailable at startup → Brain starts without them" as the degraded mode. The LLM will simply not have access to n8n tools until the server reconnects

**Phase to address:** Phase 14. The startup sequence must be designed with this failure mode explicitly.

---

### MCP-05: Bun `Bun.serve` Closes SSE/Streaming Connections After 10 Seconds Idle

**Severity:** MEDIUM

**What goes wrong:** `Bun.serve` has a default `idleTimeout` of 10 seconds. Any SSE or HTTP streaming connection that is silent for more than 10 seconds is forcibly closed by Bun. This affects:
1. If Brain Core is itself acting as an MCP server (not the primary use case, but possible in the future)
2. If the `@langchain/mcp-adapters` client receives a Streamable HTTP response that takes >10 seconds to stream (long-running tool calls)

For the current use case (Brain Core as MCP CLIENT connecting to n8n): this pitfall applies to Bun's outbound HTTP client behavior, which is different from `Bun.serve`. Bun's `fetch()` does not have the same 10-second idle timeout — it uses the OS TCP keepalive. However, if n8n sends partial streaming responses with >10s gaps, Bun's fetch may still time out depending on the OS configuration.

**Confirmed Bun issue:** GitHub issue #27479 documents that Bun.serve disconnects quiet SSE streams around 10 seconds without documentation of this behavior.

**Prevention:**
- If Brain Core ever acts as an MCP server: call `server.timeout(req, 0)` to disable the idle timeout for SSE/streaming connections, or send heartbeat comments (`\n`) every 5 seconds
- For the client side (connecting to n8n): set explicit fetch timeouts in the MCP client config that are longer than the expected tool execution time:
```typescript
{
  transport: "streamable_http",
  url: process.env.MCP_URL,
  timeout: 120_000, // 2 minutes — LangChain MCP adapters respect this via RunnableConfig
}
```
- The MCP spec recommends servers send periodic pings every ≤30 seconds; verify n8n's MCP server does this

**Phase to address:** Phase 14. Set the timeout in the initial client config and document the rationale.

---

### MCP-06: MCP Tool Call Leaves Pending AIMessage If Tool Execution Is Cancelled

**Severity:** HIGH

**What goes wrong:** If a MCP tool call is in-flight (LLM returned `AIMessage` with `tool_calls`) and the tool execution is cancelled (timeout, process shutdown, asyncio cancellation), LangGraph's ToolNode does NOT create an error ToolMessage when using `handle_tool_errors=True`. This is because `asyncio.CancelledError` inherits from `BaseException`, not `Exception`, and the current ToolNode error handler only catches `Exception`.

Result: the message history ends up with an `AIMessage` that has `tool_calls` but no corresponding `ToolMessage`. On the next invocation, LangGraph raises `INVALID_CHAT_HISTORY` and the entire thread becomes permanently broken — every subsequent message for that lead will fail.

**Why this matters for MCP:** MCP tool calls to remote servers (n8n) are inherently slower and more likely to hit timeouts than local tool calls. A 30-second timeout on a CRM search is normal; a 30-second timeout in a web request handler is a death sentence.

**Prevention:**
- Wrap every MCP tool execution in a try/catch that catches `BaseException` (or the equivalent JS-side Error), not just `Error`:
```typescript
// In ToolNode or custom tool wrapper:
try {
  const result = await mcpTool.invoke(args);
  return result;
} catch (err) {
  // Catches both Error and timeout/cancellation errors
  return `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
}
```
- Use `handle_tool_errors: true` on the ToolNode as a first line of defense, but do NOT rely on it for timeout/cancellation cases — add the wrapper above
- Set a per-MCP-tool timeout that is shorter than the overall message processing timeout, ensuring the tool fails gracefully before the surrounding handler times out

**Phase to address:** Phase 14. The timeout and error handling strategy for MCP tools must be defined at integration time.

---

### MCP-07: MCP Tool Names Collide With Existing Brain Tools

**Severity:** MEDIUM

**What goes wrong:** The `ENV MCP_TOOLS=search_crm,schedule_meeting` whitelist specifies which MCP tools to register. If an MCP tool from n8n happens to have the same name as an existing Brain tool (`pause_session`, `finish_conversation`, `qualify_lead`), the second registration silently overwrites the first in the tools array. The LLM receives the n8n tool's schema for what it believes is the `pause_session` tool, and calling it sends a request to n8n instead of executing the local database operation.

**Why it happens:** ToolNode matches tool calls by name (`tool.name`). When two tools share a name, the last one registered wins.

**Prevention:**
- Namespace MCP tools with a prefix when registering them: `mcp_${toolName}`. This requires a thin wrapper:
```typescript
const namespacedMcpTools = mcpTools.map(tool => ({
  ...tool,
  name: `mcp_${tool.name}`, // prevents collisions with local tools
}));
```
- Alternatively, validate at startup that `mcpTools.map(t => t.name)` has no intersection with `brainTools.map(t => t.name)` and throw a descriptive error if there is one
- Document the naming convention in the Brain SDK so future Brain implementors know MCP tools will be prefixed

**Phase to address:** Phase 14. Add the namespace wrapper before concatenating tools arrays.

---

## Structured Output + Tool Calling Pitfalls

### SO-01: responseFormat Creates a Second LLM Call — Hidden Cost and Information Loss

**Severity:** HIGH

**What goes wrong:** Using `responseFormat` in `createReactAgent` (or the equivalent in a custom graph) does NOT make the final agent response structured in-line. Instead, LangGraph adds a second LLM call after the agent loop completes to "reformat" the last message into the schema. This second call:
1. Doubles the output token cost for every conversation turn
2. Often loses information — the reformatting call summarizes or reinterprets the original response rather than preserving it. Confirmed LangGraph issue #4756: the `structured_response` field "omitted or significantly altered" the original LLM output.
3. Does not have access to the conversation history unless explicitly passed — it only sees the last message

**Why it happens:** LangGraph's `generate_structured_response` node (the separate node handling structured output formatting) is not the same as the main `call_model` node. The architecture separates "do the work" from "format the output."

**The issue:** For `BrainOutput` (`fullResponse` + `responseMode`), the `fullResponse` field is the actual message to send to the user. If the reformatting call rewrites `fullResponse`, the user receives a different message than what the LLM originally intended.

**Prevention:**
- For the `responseMode` use case specifically: use a **custom graph node** (not `createReactAgent`'s `responseFormat`) that handles structured output inline. The final agent node should call `.withStructuredOutput(BrainOutputSchema)` directly for the final response generation:
```typescript
// In the final output node — NOT a separate reformatting node:
const structuredModel = llm.withStructuredOutput(BrainOutputSchema, { method: "json_schema" });
const result = await structuredModel.invoke([
  new SystemMessage(SYSTEM_PROMPT),
  ...state.messages,
  new HumanMessage("Format your last response as BrainOutput JSON")
]);
return { structuredResponse: result };
```
- Alternatively, use the `toolStrategy` approach from LangGraph issue #5872: convert `BrainOutputSchema` into a tool definition, bind it alongside the regular tools, and route to a respond node when the LLM calls the schema tool. This avoids the second call entirely by making structured output part of the main agent loop.
- Log both `state.messages[last]` and `state.structuredResponse.fullResponse` in Langfuse — if they diverge significantly, the reformatting is corrupting the response.

**Phase to address:** Phase 14 (responseMode implementation). Decide the strategy (custom node vs. schema-as-tool) before implementing — retrofitting is costly.

---

### SO-02: `structuredResponse` Not Available in `.getState()` — Breaks Checkpoint Recovery

**Severity:** HIGH

**What goes wrong:** When using `createReactAgent` with `responseFormat`, the `structuredResponse` field is NOT written into the graph state that is persisted by PostgresSaver. Instead, the parsed result is stored only as a `ToolMessage` in the messages array. Confirmed forum issue (January 2026): `.getState()` returns `values.structuredResponse` as `undefined` even after the agent successfully generated a structured response.

**Why this matters for Brain Core:** BrainRunner currently reads the graph output from the invocation result directly, not from `.getState()`. However, any future attempt to recover mid-conversation state, implement human-in-the-loop, or resume an interrupted conversation will fail to find `structuredResponse` — it must be re-derived from the messages array.

**Prevention:**
- Build a custom StateGraph that explicitly writes structured output into state:
```typescript
const BrainState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  structuredResponse: Annotation<BrainOutput | undefined>({ default: () => undefined }),
});
// In the output node:
return { structuredResponse: parsedBrainOutput }; // written to state, persisted
```
- This is a strong argument for NOT using `createReactAgent` for the Brain's main graph — use a custom StateGraph where `structuredResponse` is a first-class state field
- The existing Brain SDR architecture already uses a custom graph (not `createReactAgent`); extend it rather than switching to the prebuilt agent

**Phase to address:** Phase 14. If using custom graph (recommended), this pitfall is avoided by design.

---

### SO-03: Model Silently Returns Text Without Making the Schema Tool Call

**Severity:** HIGH

**What goes wrong:** When using the `toolStrategy` for structured output (where the schema is presented to the LLM as a callable tool), the model occasionally decides to respond with plain text instead of calling the schema tool. This happens more frequently with weaker models and when the conversation reaches an unusual state (apologies, refusals, clarification requests). The result: `structuredResponse` is `undefined`, the agent returns successfully, and BrainRunner receives a `null` output — triggering `BrainOutputValidationError`.

Confirmed in langchain issue #36349: "the problem arises only when models fail to make an output tool call altogether." The code only validates structured outputs when tool calls exist — the "no tool call" scenario returns silently without `structuredResponse`.

**Prevention:**
- After the agent completes, validate that `structuredResponse` is present before returning:
```typescript
const result = await graph.invoke(input, config);
if (!result.structuredResponse) {
  // Retry with a stronger prompt or use `.withStructuredOutput()` directly
  const fallback = await llm.withStructuredOutput(BrainOutputSchema).invoke([
    ...result.messages,
    new HumanMessage("You must respond as BrainOutput JSON. Provide fullResponse and responseMode.")
  ]);
  return { ...result, structuredResponse: fallback };
}
```
- Use `method: "json_schema"` (provider-native) over `toolStrategy` when the provider supports it — native structured output is a hard guarantee, not a "please call this tool" request
- In Langfuse traces, add a counter for "structured output fallback invocations" — if it exceeds 1% of turns, the primary strategy is unreliable

**Phase to address:** Phase 14. Add the validation + fallback before the first production deployment.

---

### SO-04: INVALID_CHAT_HISTORY After MCP Tool Timeout Corrupts Thread

**Severity:** HIGH

**What goes wrong:** When an MCP tool call times out or is cancelled mid-execution, the ToolNode may fail to write the `ToolMessage` response (see MCP-06). Combined with the PostgresSaver checkpoint, this means the corrupt state is persisted. On the next invocation for the same lead, LangGraph loads the checkpoint, finds an `AIMessage` with `tool_calls` and no matching `ToolMessage`, and throws `INVALID_CHAT_HISTORY`.

The error message is: "Found AIMessage with tool_calls that do not have a corresponding ToolMessage." This happens in the `call_model` node, before the agent even starts processing the new message.

**Why this is especially dangerous:** The thread remains broken permanently — every subsequent message for that lead fails. There is no self-healing. The only recovery is manual checkpoint surgery or clearing the thread.

**Prevention:**
- In the ToolNode error handler, always write an error ToolMessage for every tool_call_id in the AIMessage, even on timeout/cancellation:
```typescript
// Custom ToolNode wrapper that guarantees ToolMessage parity:
const safeToolNode = async (state: BrainState) => {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCallIds = lastMessage.tool_calls?.map(tc => tc.id) ?? [];
  
  try {
    return await toolNode.invoke(state);
  } catch (err) {
    // Guarantee a ToolMessage for every pending tool call
    return {
      messages: toolCallIds.map(id => new ToolMessage({
        tool_call_id: id,
        content: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
      }))
    };
  }
};
```
- Add a startup integrity check: query PostgresSaver for threads where the last message is an AIMessage with tool_calls but no subsequent ToolMessage — these are broken and should be flagged for manual review
- Implement a "repair" utility that appends a synthetic error ToolMessage to broken threads

**Phase to address:** Phase 14. The safe ToolNode wrapper must be in place before any MCP tool is registered.

---

## Multi-Provider Structured Output Pitfalls

### MP-01: Anthropic's `withStructuredOutput` Uses Tool Emulation by Default, Not Native JSON Schema

**Severity:** HIGH

**What goes wrong:** When calling `chatAnthropic.withStructuredOutput(schema)` without specifying `method`, LangChain defaults to `"function_calling"` (tool_use emulation) for Anthropic, NOT the native `json_schema` structured output. The two methods behave very differently:

- **Tool emulation** wraps the schema as a tool definition and forces Claude to call it. This works for simple schemas but has important limitations: it is NOT available when `thinking` mode is enabled (extended thinking), and it uses a tool call in the API that consumes tokens differently.
- **Native json_schema** (`output_config` parameter in the Claude API) uses grammar-constrained decoding — a hard guarantee, not a "please call this tool" request. This requires the `"structured-outputs-2025-11-13"` beta header (now GA for Claude Sonnet 4.5+, Haiku 4.5+, Opus 4.5+).

**Provider support gap:** Anthropic's native structured outputs do not support recursive schemas, `minLength`/`maxLength` string constraints, `minimum`/`maximum` number constraints, `additionalProperties` as anything other than `false`, and complex regex patterns. If `BrainOutputSchema` uses any of these features, the native method silently falls back to tool emulation or throws a 400 error with "Schema is too complex for compilation."

**Prevention:**
- Explicitly specify the method — never rely on the default:
```typescript
// For OpenAI (native JSON Schema — hard guarantee, strict mode):
const openAIStructured = chatOpenAI.withStructuredOutput(BrainOutputSchema, {
  method: "json_schema",
  strict: true,
});

// For Anthropic (native JSON Schema — grammar-constrained, GA for Sonnet 4.5+):
const anthropicStructured = chatAnthropic.withStructuredOutput(BrainOutputSchema, {
  method: "json_schema",
});

// Fallback to tool emulation for older Claude models:
const anthropicFallback = chatAnthropic.withStructuredOutput(BrainOutputSchema, {
  method: "function_calling", // explicit, not default
});
```
- Keep `BrainOutputSchema` simple: no recursive refs, no string length constraints, `additionalProperties: false` on all objects. Current BrainOutput (`fullResponse: string`, `responseMode: enum`) is safe for both methods.
- Test the chosen method against both providers in CI with the actual schema before any production deployment

**Phase to address:** Phase 14. The method must be explicit in the provider-specific model initialization, not discovered at runtime.

---

### MP-02: OpenAI JSON Schema Strict Mode Rejects Zod Schemas With Internal `$ref`

**Severity:** HIGH

**What goes wrong:** OpenAI's `json_schema` structured output with `strict: true` does not support relative `$ref` references in the JSON Schema, but LangChain's standard `zod-to-json-schema` conversion generates `$ref` when the same sub-schema is reused in multiple places. This causes a 400 API error when the schema is sent to OpenAI.

Confirmed LangChain.js issue #6479: "LangChain triggers an OpenAI 400 error, and the OpenAI client doesn't." OpenAI uses a forked, specialized version of `zod-to-json-schema` that avoids relative references; LangChain uses the standard version.

The symptom: `BrainOutputSchema` works fine locally (without `strict: true`) and fails in production with a cryptic 400 error after enabling strict mode.

**Prevention:**
- Keep `BrainOutputSchema` flat — avoid reusing sub-schemas in multiple places. The current schema (`fullResponse: z.string(), responseMode: z.enum([...])`) is flat and safe.
- If the schema must be complex, use OpenAI's own conversion helpers instead of relying on LangChain's conversion:
```typescript
import { zodResponseFormat } from "openai/helpers/zod"; // OpenAI's own converter
const format = zodResponseFormat(BrainOutputSchema, "brain_output");
// Pass to ChatOpenAI as responseFormat rather than using .withStructuredOutput()
```
- Add a CI test that sends the exact schema to OpenAI with `strict: true` and validates the response — not just that the LLM returns valid JSON, but that the API call doesn't 400

**Phase to address:** Phase 14. Test with `strict: true` in CI from day one.

---

### MP-03: Anthropic Native Structured Output Schema Restrictions Can Block Deployment

**Severity:** MEDIUM

**What goes wrong:** Anthropic's native structured output (`method: "json_schema"`) has hard schema restrictions that differ from OpenAI's. Specifically:
- **No `minItems > 1`** on arrays (only `minItems: 0` or `minItems: 1`)
- **No numerical constraints** (`minimum`, `maximum`, `multipleOf`)
- **No string length constraints** (`minLength`, `maxLength`)
- **No recursive schemas** (even indirect recursion via `$ref`)
- **`additionalProperties` must be `false`** on all objects (not omitted, not `true`)
- **Maximum 20 strict tools + 24 optional parameters + 16 union type parameters** per request
- **First-request latency** for grammar compilation — can add 1-5 seconds to first use of a new schema

If `BrainOutputSchema` evolves to include any of these features, Anthropic will return a 400 "Schema is too complex for compilation" error. The error surfaces only at runtime, not at schema definition time.

**Prevention:**
- Treat Anthropic's schema restrictions as the common denominator for schema design. If it works within Anthropic's restrictions, it works everywhere.
- Add `additionalProperties: false` explicitly to every object in the schema (Zod schemas converted with `z.object({...}).strict()` handle this automatically)
- Test schema compilation by calling the Anthropic API once at startup (as a warmup that also validates the schema) — cache the compiled grammar for 24 hours via prompt cache headers
- Never use schema features beyond: primitive types, enum, arrays of primitives, nested objects, optional fields with defaults

**Phase to address:** Phase 14. Apply the schema design constraints from the first draft.

---

### MP-04: Provider Auto-Detection Logic Can Switch Silently Between Methods

**Severity:** MEDIUM

**What goes wrong:** LangGraph's `AutoStrategy` for structured output detects whether the provider supports native structured output and automatically uses it if available. If Anthropic adds native support for a feature that wasn't previously supported (or removes beta header requirements), the strategy may silently switch from `toolStrategy` to `providerStrategy` after a LangChain version update. The two strategies produce different message structures: `toolStrategy` adds a synthetic `ToolMessage` to the history; `providerStrategy` adds an `AIMessage` with a different content type.

This silent switch can corrupt the message history interpretation in BrainRunner if the code assumes a specific message structure.

**Prevention:**
- Never use `AutoStrategy` in production — always specify `toolStrategy()` or `providerStrategy()` explicitly
- Pin `@langchain/core` and `@langchain-anthropic` versions and audit changelogs before upgrading
- Add an integration test that asserts the exact type of the last message after structured output generation (ToolMessage vs AIMessage) — this test will catch strategy switches during dependency updates

**Phase to address:** Phase 14. Document the chosen strategy in the architecture decision for responseMode.

---

### MP-05: Anthropic Structured Output Is Incompatible With Extended Thinking

**Severity:** LOW (current) / HIGH (future)

**What goes wrong:** Anthropic's extended thinking mode (`thinking: { type: "enabled", budget_tokens: N }`) is incompatible with forced tool calling (tool_use emulation for structured output). If future Brain versions add thinking mode for complex reasoning tasks, using `method: "function_calling"` for structured output will throw an API error.

Additionally, the native `json_schema` structured output via `output_config` and extended thinking cannot be used simultaneously in the same API request — the response will be a mix of `thinking` blocks and JSON text, which the structured output parser cannot handle.

**Prevention:**
- For any model configuration that enables thinking: use a post-processing extraction step rather than structured output for the response format
- Document this constraint in the BrainOutputSchema module: "structured output methods are incompatible with Claude thinking mode — do not enable both"
- If thinking mode is added in a future Brain, remove `withStructuredOutput` from that Brain's graph and use a manual JSON extraction + Zod parse step instead

**Phase to address:** Flag for Phase 14 documentation. Not an active risk for v1.3 scope.

---

## Bun-Specific Pitfalls

### BUN-01: Bun `fetch()` EventSource Polyfill Gap for SSE MCP Client

**Severity:** MEDIUM

**What goes wrong:** The `@modelcontextprotocol/sdk` (used internally by `@langchain/mcp-adapters`) uses `EventSource` for SSE transport connections. Bun's built-in `fetch()` supports SSE as a readable stream, but does NOT natively implement the `EventSource` Web API class. Libraries that do `new EventSource(url)` will throw `ReferenceError: EventSource is not defined` in Bun.

This is only relevant if using SSE transport (which should be avoided per MCP-01). For Streamable HTTP transport, `EventSource` is not used — the transport uses standard `fetch()` with streaming response bodies, which Bun handles correctly.

**Prevention:**
- Use Streamable HTTP transport (which avoids this entirely) — see MCP-01
- If SSE transport is required for legacy n8n compatibility: install `eventsource` polyfill and inject it:
```typescript
import EventSource from "eventsource";
if (typeof globalThis.EventSource === "undefined") {
  (globalThis as any).EventSource = EventSource;
}
```
- Add a startup test that imports `@langchain/mcp-adapters` and creates a client with SSE transport to verify the polyfill works

**Phase to address:** Phase 14. Relevant only if forced to use SSE transport.

---

### BUN-02: MCP Client Connection Not Properly Closed on Process Shutdown — Bun Process Hangs

**Severity:** MEDIUM

**What goes wrong:** `MultiServerMCPClient` holds open HTTP connections (for Streamable HTTP) or SSE streams. On `SIGTERM` or `SIGINT`, Bun exits the process, but if the MCP client's connections are not explicitly closed, the event loop remains active (waiting for the HTTP connections to drain). Bun may hang for up to 30 seconds before Docker kills the container.

**Why it happens:** The `@langchain/mcp-adapters` JS client requires an explicit `client.close()` call to terminate connections. Unlike stdio MCP servers, HTTP/SSE connections do not close automatically when the parent process signals shutdown.

**Consequences:** Rolling deployments where the old container does not exit cleanly delay the deploy. Docker health checks fail to detect the hung process. RabbitMQ messages may be delivered to the hung instance.

**Prevention:**
- Register a SIGTERM handler that closes the MCP client before exiting:
```typescript
const mcpClient = new MultiServerMCPClient({ ... });
await mcpClient.initialize();

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — closing MCP client connections");
  await mcpClient.close().catch(() => {}); // best-effort
  process.exit(0);
});
```
- Set a max shutdown timeout in Docker: `stop_grace_period: 10s` with the process forced-killed after 10s
- Validate shutdown behavior in integration tests by simulating SIGTERM and asserting exit within 5 seconds

**Phase to address:** Phase 14. Add the shutdown handler alongside the MCP client initialization.

---

### BUN-03: `@langchain/mcp-adapters` Version Compatibility With Bun

**Severity:** LOW

**What goes wrong:** `@langchain/mcp-adapters` is a JavaScript package that uses the `@modelcontextprotocol/sdk` under the hood. The SDK uses standard Node.js APIs (`http`, `https`, `EventSource`) which Bun implements but with known gaps. Reported issues include connection timeouts with certain MCP server configurations and inconsistent behavior with large MCP tool response payloads.

The stack already has a documented precedent for this class of issue: `amqplib` vs `amqplib-bun` — vanilla Node.js packages sometimes have subtle Bun incompatibilities that only surface under load.

**Prevention:**
- Pin `@langchain/mcp-adapters` to a tested version and do not auto-update
- Add an integration test that actually calls an MCP tool (not just checks connectivity) — this catches payload serialization issues that pure connection tests miss
- Monitor the `langchain-ai/langchainjs` GitHub for Bun-specific issues in the `mcp-adapters` package before each version upgrade

**Phase to address:** Phase 14. Document the pinned version in a comment explaining why.

---

## Phase-Specific Warnings (v1.3)

| Phase | Topic | Pitfall | Mitigation |
|-------|-------|---------|------------|
| Phase 14 | MCP Integration | MCP-01: SSE transport deprecated | Use `streamable_http` transport from day one |
| Phase 14 | MCP Integration | MCP-02: Transport name typo `streamable-http` vs `streamable_http` | Use a named constant, not inline string |
| Phase 14 | MCP Integration | MCP-03: Silent tool loss when any server fails | `onConnectionError: "ignore"` + defensive fallback |
| Phase 14 | MCP Integration | MCP-04: Brain fails to start if n8n unreachable | Non-fatal startup; graceful degradation without MCP tools |
| Phase 14 | MCP Integration | MCP-06: Cancelled tool call corrupts thread permanently | Safe ToolNode wrapper guaranteeing ToolMessage parity |
| Phase 14 | MCP Integration | MCP-07: Name collision between MCP and local tools | Namespace MCP tools with `mcp_` prefix |
| Phase 14 | responseMode | SO-01: Second LLM call loses information and doubles cost | Use custom graph node or schema-as-tool strategy |
| Phase 14 | responseMode | SO-02: `structuredResponse` not persisted to checkpoint | Custom StateGraph with `structuredResponse` as explicit state field |
| Phase 14 | responseMode | SO-03: Model skips schema tool call, returns plain text | Validate presence + fallback `.withStructuredOutput()` call |
| Phase 14 | responseMode | SO-04: INVALID_CHAT_HISTORY after MCP tool timeout | Safe ToolNode wrapper + startup thread integrity check |
| Phase 14 | Multi-provider | MP-01: Anthropic defaults to tool emulation, not native JSON Schema | Explicit `method: "json_schema"` in all providers |
| Phase 14 | Multi-provider | MP-02: OpenAI strict mode rejects `$ref` in complex Zod schemas | Keep BrainOutputSchema flat; test with `strict: true` in CI |
| Phase 14 | Multi-provider | MP-03: Anthropic schema restrictions block complex schemas | Design schema within Anthropic's constraints as the common denominator |
| Phase 14 | Bun compatibility | BUN-01: `EventSource` not available in Bun for SSE MCP client | Avoid SSE; use Streamable HTTP |
| Phase 14 | Bun compatibility | BUN-02: MCP client holds connections open on SIGTERM | SIGTERM handler that calls `client.close()` before exit |

---

## v1.1 Addendum: Integration Pitfalls

> These pitfalls are specific to adding RabbitMQ transport, leads schema (replacing users), and Brain SDR to the existing v1.0 system. Generic pitfalls from v1.0 are preserved below in their original sections. Do not repeat the known risks already documented (amqplib-bun, bun:sql driver, RabbitMQ 4.1.0 amqplib version requirement) — reference them inline only.

---

### INT-01: Unhandled Channel Closure Crashes the Bun Process

**Severity:** CRITICAL

**What goes wrong:** When a RabbitMQ connection drops (network blip, broker restart, broker-side timeout), amqplib emits an `error` event on the `Connection` object and a `close` event on the `Channel`. If no `error` listener is attached to either, Node.js/Bun throws `UnhandledPromiseRejection` and kills the process. Any in-flight LangGraph invocations at that moment are interrupted mid-graph — their PostgresSaver checkpoints are partially written, leaving the thread in an indeterminate state.

**Why it happens:** amqplib's event model requires explicit `connection.on('error', ...)` and `channel.on('error', ...)` listeners. There is no default swallowing. Bun's behavior matches Node.js: unhandled promise rejections crash the process in production mode.

**Warning signs:**
- Container exits with code 1 after a RabbitMQ restart or network event
- `UnhandledPromiseRejection: Channel ended` in logs
- Pino shows a clean startup followed by a sudden silence — no error log before exit
- PostgresSaver checkpoint rows with `created_at` matching the crash time but no corresponding `checkpoint_writes` row (truncated write)

**Prevention:**
```typescript
// REQUIRED pattern for RabbitMQ consumer in Bun
const conn = await amqp.connect(url);
conn.on('error', (err) => logger.error({ err }, 'RabbitMQ connection error'));
conn.on('close', () => { scheduleReconnect(); });

const ch = await conn.createChannel();
ch.on('error', (err) => logger.error({ err }, 'RabbitMQ channel error'));
ch.on('close', () => logger.warn({}, 'RabbitMQ channel closed'));

// prefetch = 1 ensures at-most-one in-flight message per consumer
// if the channel dies mid-process, only one message is re-queued
await ch.prefetch(1);
```
- Reconnection must be implemented in the `close` handler, not as a crash recovery — Bun Docker containers restart after a crash but lose the consumer tag, causing a 5-10s gap in message consumption
- The consumer tag returned by `ch.consume()` must be stored to enable graceful cancel before close

**Phase to address:** Phase 1 of v1.1 (RabbitMQ transport implementation). This must be implemented before any integration testing.

---

### INT-02: Message Not Acked After LangGraph Throws — Infinite Redelivery Loop

**Severity:** CRITICAL

**What goes wrong:** The consumer callback calls `runner.run(event)` which invokes LangGraph. If LangGraph throws (LLM API error, DB constraint error, recursion limit hit), the message is never acked or nacked. RabbitMQ keeps the message as "unacked" for the duration of the consumer's session. On channel close or reconnect, RabbitMQ redelivers it. If the error is deterministic (e.g., a malformed payload that LangGraph always rejects), this creates an infinite redelivery loop that saturates the consumer.

**Why it happens:** amqplib uses manual acknowledgement. If the code throws before `ch.ack(msg)` or `ch.nack(msg)`, the broker assumes the consumer is still processing. With `prefetch(1)`, the queue appears frozen — no new messages are delivered while one is "in-flight."

**Warning signs:**
- RabbitMQ management UI shows 1 "Unacked" message indefinitely
- New messages pile up in "Ready" state while consumer shows connected
- Same `IDLead` appears in logs multiple times within seconds after a reconnect
- `x-death` count on a message exceeds 1 (visible via message inspection in management UI)

**Prevention:**
```typescript
ch.consume(queue, async (msg) => {
  if (!msg) return; // consumer cancelled
  try {
    const event = parseAndValidate(msg.content);
    await runner.run(event);
    ch.ack(msg);
  } catch (err) {
    logger.error({ err }, 'Consumer processing error');
    // nack with requeue=false sends to DLX — do NOT requeue transient errors blindly
    // requeue=true only for known transient failures (network timeout, not parse errors)
    const isTransient = isTransientError(err);
    ch.nack(msg, false, isTransient);
  }
});
```
- Configure a Dead Letter Exchange (DLX) on the queue so permanently-failed messages land in a dead letter queue instead of being lost
- Log the full message payload on nack — dead letter queues are silent without logging
- `isTransientError` must NOT return true for payload parse failures — those must go to DLX immediately

**Phase to address:** Phase 1 of v1.1 (RabbitMQ transport). Implement DLX in the same phase as the consumer — never defer it.

---

### INT-03: BrainEvent Schema Mismatch Between Webhook and RabbitMQ Paths

**Severity:** HIGH

**What goes wrong:** The current `BrainEventSchema` uses `{ conversationId, stepIndex, userId, content, metadata }`. The v1.1 spec introduces external fields `{ Name, Message, Numero, IDLead }`. If the Webhook and RabbitMQ transports each have their own parsing logic, they can silently diverge: a field mapped in one transport is ignored in the other, and the BrainRunner receives inconsistent events. The SDR Brain is written against one contract; when a message arrives via the other transport, it silently operates with `userId = undefined` or `conversationId = undefined`.

**Why it happens:** It's tempting to write a separate Zod schema per transport to handle field name differences, then "translate" to BrainEvent. If the translation layer is tested with one transport but not the other, the bug ships silently.

**Warning signs:**
- `BrainRunner.run()` receives events where `userId` is the string `"undefined"` (coercion artifact)
- Leads are created with `unique_id = ""` or `numero = null` after a message via one transport
- LangGraph thread_id is undefined or constant (same checkpoint loaded for all users)

**Prevention:**
- Define a single canonical `IncomingMessage` type: `{ Name: string, Message: string, Numero: string, IDLead: string }`
- Write a single `normalizeToEvent(raw: IncomingMessage): BrainEvent` function used by BOTH transports
- The Zod validation schema for IncomingMessage is shared between webhook handler and RabbitMQ consumer
- Add an integration test that sends the same logical message via both transports and asserts the BrainRunner receives identical `BrainEvent` objects

**Phase to address:** Phase 1 of v1.1, when standardizing transport fields. The canonical schema must be defined before either transport implementation starts.

---

### INT-04: `users` Table Drop Breaks PostgresSaver If Foreign Keys Exist

**Severity:** HIGH

**What goes wrong:** Replacing `users` with `leads` via a Drizzle migration that drops the `users` table will fail if any Drizzle-managed table has a foreign key referencing `users.id`. More critically, the `agent_state` table in the current schema does not have a FK to `users` (verified in `0000_lyrical_scrambler.sql`), but the `memories` table uses `user_id TEXT` — which is a bare text column, not a FK. This means a DROP TABLE succeeds, but any application code that inserts into `memories` with a user_id referencing the old users.id format will silently persist orphaned rows.

**Additionally:** PostgresSaver creates its own tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`) outside of Drizzle's migration system. These tables use `thread_id TEXT` — no FK to users. They are safe. But if v1.1 code passes `thread_id` values derived from the old `users.id` (UUID format), and v1.1 also introduces `leads.unique_id` (likely a different format), existing checkpoints from v1.0 tests become unreachable via the new `thread_id` derivation logic.

**Warning signs:**
- `ERROR: relation "users" does not exist` in migration log (FK constraint from another table)
- Old EchoBrain test conversations no longer reachable after migration (thread_id format changed)
- `memories` table contains rows with `user_id` in UUID format while new code looks up by `leads.unique_id`

**Prevention:**
- Before writing the migration, run: `SELECT conname, conrelid::regclass FROM pg_constraint WHERE confrelid = 'users'::regclass` — verify zero FKs reference `users`
- Migration strategy: ADD `leads` table first → backfill → switch app code → DROP `users` in a later migration (separate deploy)
- Document the `thread_id` format explicitly: `leads.unique_id` as the thread_id key. Add a migration comment explaining the mapping
- Clean `memories` table: decide whether existing memories (keyed by UUID user_id) are migrated or dropped — do not leave orphaned rows silently

**Phase to address:** Phase 2 of v1.1 (schema migration). Verify zero FKs before executing. The migration must be a two-step additive sequence, not a single DROP/CREATE.

---

### INT-05: `unique_id` Format Choice Creates Unintended thread_id Collisions

**Severity:** HIGH

**What goes wrong:** `leads.unique_id` will be used as the `thread_id` for LangGraph checkpoints (one conversation thread per lead). If `unique_id` is generated from external data (e.g., `IDLead` from the RabbitMQ message), two leads from different clients could have the same `IDLead` if the generating CRM does not guarantee global uniqueness. In a single-tenant database this is acceptable. In the multi-tenant model (1 DB per client), it is also safe — collisions would only occur within the same client's database. However, if Brain SDR is ever shared across clients in one database (even temporarily, during a migration), thread_ids will collide and conversations will be contaminated.

**A separate, more immediate risk:** If `unique_id` is app-generated (nanoid or UUID), the generation must happen on the FIRST upsert, not on every call. If two RabbitMQ messages arrive simultaneously for the same `Numero` (WhatsApp message retry), two concurrent INSERT attempts run simultaneously — without a proper UNIQUE constraint + ON CONFLICT clause, two rows are created for the same lead.

**Warning signs:**
- Two `leads` rows with the same `numero` after a load test
- LangGraph checkpoint for lead A contains messages addressed to lead B (cross-contamination)
- `SELECT COUNT(*) FROM leads WHERE numero = '+5511999999999'` returns > 1

**Prevention:**
```typescript
// Correct upsert pattern — single SQL statement, not SELECT-then-INSERT
await db.insert(leads)
  .values({ unique_id: nanoid(), nome: name, numero, ia_ativada: true })
  .onConflictDoUpdate({
    target: leads.numero,  // UNIQUE constraint on numero
    set: { nome: name }    // update name if changed
  });
// THEN fetch the persisted unique_id (may have been set on original insert)
const lead = await db.select().from(leads).where(eq(leads.numero, numero)).limit(1);
const threadId = lead[0].unique_id;
```
- Add `UNIQUE` constraint on `leads.numero` in the migration — not just in the Drizzle schema
- `unique_id` must be generated once at insert time and never overwritten by the upsert set clause

**Phase to address:** Phase 2 of v1.1 (leads schema) and Phase 3 of v1.1 (lead registration flow). The UNIQUE constraint and upsert pattern must be in place before the first message is processed in any environment.

---

### INT-06: `ia_ativada` Check Placed After Expensive Operations

**Severity:** HIGH

**What goes wrong:** If the `ia_ativada = false` check is performed AFTER memory retrieval, prompt loading, or LangGraph invocation, the system wastes resources and introduces latency on every message for leads that should be silently ignored. More critically, if the check is inside the LangGraph graph (as a node condition), the BrainRunner still invokes the graph, which creates a new checkpoint entry for a thread that should not have been processed. This pollutes the checkpoint table and slightly degrades the lead's context on re-activation.

**A race condition variant:** If `ia_ativada` is checked once at the start of the webhook/consumer handler, then a concurrent UPDATE sets `ia_ativada = false` mid-execution, the response is sent before the flag is honored. For SDR use cases (e.g., a human operator disabling the bot mid-conversation), this is an acceptable race with low impact. But if `ia_ativada = false` means "human is taking over," a response from the bot arriving after the flag is cleared causes confusion.

**Warning signs:**
- LangGraph checkpoint table grows with entries for leads where `ia_ativada = false`
- Average response latency does not decrease for inactive leads (check is too late in the pipeline)
- Duplicate responses in WhatsApp when operator takes over (race condition)

**Prevention:**
- Check `ia_ativada` as the FIRST operation after lead lookup, before any LangGraph invocation
- If `ia_ativada = false`, ack the RabbitMQ message immediately and return without invoking BrainRunner
- The check should be synchronous against the DB result, not a second query:
```typescript
const lead = await findOrCreateLead(numero, name);
if (!lead.ia_ativada) {
  ch.ack(msg);
  return; // no BrainRunner.run(), no checkpoint created
}
await runner.run(event);
ch.ack(msg);
```
- For the race condition: accept it as a known limitation in v1.1. Document that `ia_ativada` is eventually consistent with a window of one message round-trip.

**Phase to address:** Phase 3 of v1.1 (lead registration flow). The `ia_ativada` check placement must be reviewed in the flow design phase, not implementation.

---

### INT-07: `thread_id` Collision When Same Lead Messages From Two Channels Simultaneously

**Severity:** MEDIUM

**What goes wrong:** LangGraph's PostgresSaver uses `thread_id` as the primary isolation key. If `thread_id = leads.unique_id`, and the same lead sends a message via WhatsApp (RabbitMQ consumer) and via the webhook simultaneously (e.g., a CRM integration triggers a webhook while the WhatsApp message is in-flight), both invocations will call `compiledGraph.invoke({ ... }, { configurable: { thread_id: sameLeadId } })` concurrently. PostgresSaver uses PostgreSQL transactions for checkpoint writes, but there is a documented race condition in PostgresSaver (langgraphjs issue #2040) where concurrent invocations on the same thread_id can produce cross-contaminated state.

**Warning signs:**
- LangGraph responds with a reply that references context from a different conversation channel
- `checkpoint_writes` table shows overlapping timestamps for the same `thread_id`
- Lead receives two replies in rapid succession after sending one message

**Prevention:**
- For v1.1 scope: the system only has one active transport per deployment (`TRANSPORT` env var). Webhook and RabbitMQ do not both run simultaneously. This pitfall is deferred to when multi-transport is introduced.
- If multi-transport ever runs in the same process: use `thread_id = `${leads.unique_id}:${transportType}`` to namespace per channel
- Alternatively: use a per-lead mutex (Redis or PostgreSQL advisory lock) before invoking `compiledGraph.invoke()` — only one invocation per lead at a time

**Phase to address:** Phase 3 of v1.1 (conversation history). Document the single-transport constraint as a design assumption. Flag for v2 when multi-transport is activated.

---

### INT-08: Drizzle Migration Race Condition on Simultaneous Startup

**Severity:** MEDIUM

**What goes wrong:** The current `runMigrations()` implementation calls `migrate(db, { migrationsFolder })` with no locking mechanism. When multiple Brain SDR containers start simultaneously (e.g., Docker Compose scale, Kubernetes rolling update, or CI running two containers in parallel), each instance attempts to apply the same pending migrations at the same time. Drizzle tracks applied migrations in the `__drizzle_migrations` table, but the check-then-insert is not atomic. Two instances can both read "migration X not applied," both execute it, and one fails with a PostgreSQL duplicate key or unique constraint error.

**Why this is worse for v1.1:** The `leads` table migration (adding a new table, dropping `users`) is a multi-step migration that is not idempotent — running it twice on an already-migrated DB will fail or silently corrupt data.

**Warning signs:**
- `ERROR: relation "leads" already exists` in one container's startup log
- Container startup fails and Docker restarts it, causing the healthy container to now encounter a broken DB state
- `__drizzle_migrations` table has duplicate rows for the same migration file

**Prevention:**
- Use PostgreSQL advisory locks to serialize migration execution:
```typescript
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  const db = drizzle(sql);
  // Advisory lock key: any consistent integer — use a hash of 'brain-migrations'
  await sql`SELECT pg_advisory_lock(7246842)`;
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await migrate(db, { migrationsFolder });
  } finally {
    await sql`SELECT pg_advisory_unlock(7246842)`;
  }
}
```
- **Important caveat:** Advisory locks are session-scoped and incompatible with PgBouncer transaction pooling mode. Since the stack uses `postgres.js` directly (not PgBouncer), this is safe for v1.1.
- Alternative (simpler, no locking): Run migrations as a one-time init container in Docker Compose/Kubernetes, not on every app startup. Only use the in-process migration for development convenience.

**Phase to address:** Phase 1 of v1.1 (auto-migrate startup). Implement the advisory lock before deploying multiple instances.

---

### INT-09: PostgresSaver `setup()` Called Concurrently With Drizzle Migrations

**Severity:** MEDIUM

**What goes wrong:** The current startup sequence is: `runMigrations()` → `runner.init()` → `_compileGraph()` → `createCheckpointer()` → `checkpointer.setup()`. PostgresSaver's `setup()` creates its own tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`) using CREATE TABLE IF NOT EXISTS internally. This is safe in isolation. However, if multiple instances start simultaneously and all call `checkpointer.setup()` at the same time, PostgresSaver's internal setup (which uses `pg` directly, not the postgres.js Sql instance) can encounter the same race condition as Drizzle migrations.

**A documented real bug:** langgraphjs issue #2040 and PR #2494 show that concurrent `setup()` calls with the same connection string have produced "table already exists" errors that crash the instance.

**Warning signs:**
- `ERROR: relation "checkpoints" already exists` in startup log
- Container dies immediately after migrations succeed (dies in `runner.init()`)
- Only reproducible when two containers start within ~500ms of each other

**Prevention:**
- Since `checkpointer.setup()` is called inside `_compileGraph()` which is called inside `runner.init()`, and `runner.init()` is called AFTER `runMigrations()` (which holds the advisory lock), the timing window for the race is already narrow.
- Additionally, since `setup()` uses `CREATE TABLE IF NOT EXISTS`, duplicate calls are safe in PostgreSQL — the error is typically from a CREATE INDEX IF NOT EXISTS race, not the table itself.
- Practical mitigation: add a `try/catch` around `checkpointer.setup()` that ignores "already exists" errors and retries once after a 100ms delay. This is a known pattern in LangGraph production deployments.
- Long-term: call `checkpointer.setup()` once in the migration step rather than in every BrainRunner init.

**Phase to address:** Phase 1 of v1.1 (auto-migrate startup). The advisory lock in INT-08 reduces but does not eliminate this window.

---

### INT-10: SDR Context Window Overflow for Long Leads

**Severity:** MEDIUM

**What goes wrong:** LangGraph appends all messages to the state's `messages` array. Each `compiledGraph.invoke()` call loads the full checkpoint (all prior messages) and sends them to the LLM. For a lead who has been in conversation for 50+ turns, the messages array grows to exceed the LLM's context window (GPT-4o: 128K tokens; Claude Sonnet: 200K tokens). The LLM API returns a 400 error (`context_length_exceeded`), LangGraph throws, and the entire conversation thread becomes unresponsive — every subsequent message fails with the same error.

**Why this is worse than expected:** SDR conversations are typically longer than support conversations. A qualification flow (first contact → rapport → discovery → objection handling → close attempt) can span 30-80 messages over multiple days, with each message including role-play context and CRM data injected into the system prompt.

**Warning signs:**
- `Error: This model's maximum context length is 128000 tokens. Your messages have X tokens` in Langfuse traces
- A specific lead's thread consistently fails while others work fine
- The failing lead has had > 40 conversation turns

**Prevention:**
- Implement message trimming at the graph level using LangGraph's `trimMessages` utility:
```typescript
import { trimMessages } from '@langchain/core/messages';
// In the graph node, before LLM call:
const trimmed = await trimMessages(state.messages, {
  maxTokens: 90000,      // leave headroom for system prompt + response
  strategy: 'last',     // keep most recent messages
  tokenCounter: llm,    // use LLM's tokenizer for accurate counts
  includeSystem: true,  // always keep system prompt
  allowPartial: false,
});
```
- Implement a summarization node that triggers when messages exceed a token threshold: summarize the first 60% of the conversation into a single "conversation summary" message, then drop the original messages
- For the SDR use case, the summarization node should specifically preserve: lead qualification data, stated objections, and agreed next steps — these are more important than small talk

**Phase to address:** Phase 4 of v1.1 (Brain SDR implementation). Must be implemented before any real SDR conversation goes to production. Can be deferred from Phase 4 only if a hard limit on conversation turns is enforced instead.

---

### INT-11: WebhookTransport GAP-1 Still Latent After v1.1 Webhook Standardization

**Severity:** MEDIUM

**What goes wrong:** `WebhookTransport.start()` creates the Hono app via `createWebhookApp()` with NO runner injected. The class is in the codebase, exported, and satisfies `ITransport`. If v1.1 work standardizes the webhook fields (Name, Message, Numero, IDLead) and migrates `createWebhookApp()` to accept the new schema, but GAP-1 is not fixed simultaneously, anyone calling `new WebhookTransport().start()` via the `createTransport()` factory will silently get a webhook that accepts requests but never invokes the BrainRunner (returns `{ status: "accepted" }` forever with no LLM response).

**Why it happens:** The factory returns `new WebhookTransport()` but the runner injection happens in `brain-echo/src/index.ts` which bypasses the transport class entirely (uses `createWebhookApp(runner)` directly). The gap is invisible until someone uses the factory as documented.

**Warning signs:**
- POST to `/api/v1/webhook` returns `{ "status": "accepted" }` instead of `{ "status": "ok", "reply": "..." }`
- No entries in Langfuse/LangSmith — runner.run() was never called
- Health check passes, server is up, but all messages are silently dropped

**Prevention:**
- Fix GAP-1 as part of v1.1: `WebhookTransport` must accept a runner in its constructor and pass it to `createWebhookApp(runner)`
- The fix: `class WebhookTransport { constructor(private runner?: IBrainRunnerLike) {} async start(port = 3000) { const app = createWebhookApp(this.runner); ... } }`
- Update `createTransport()` factory to accept and pass the runner
- Add a test that creates a WebhookTransport via `createTransport()`, starts it, sends a POST, and asserts the response is `{ status: "ok" }` — not `{ status: "accepted" }`

**Phase to address:** Phase 1 of v1.1 (Webhook standardization / GAP-1 fix). This is a prerequisite for any field standardization work — fixing the field schema without fixing the runner injection means the webhook still doesn't call the Brain.

---

### INT-12: Docker Image Size Bloat From `amqplib-bun` and LangChain Deps

**Severity:** LOW

**What goes wrong:** brain-echo was 419MB. Brain SDR adds `amqplib-bun` and potentially additional LangChain tools. `@langchain/langgraph`, `@langchain/core`, and their transitive dependencies (particularly `@aws-sdk/*` pulled in by some LangChain tools, `zod`, `ml-matrix`) add 30-80MB. The multi-stage Dockerfile already strips devDependencies, but the `node_modules` COPY approach copies per-package `node_modules/` directories wholesale — including any packages that could be deduped but are not because of pnpm's hoisting strategy.

**Warning signs:**
- Brain SDR image exceeds 600MB
- Docker layer for `packages/ai/node_modules` or `packages/core/node_modules` exceeds 100MB
- Build time exceeds 5 minutes on CI

**Prevention:**
- Audit what `@aws-sdk/*` packages appear in the final image: `docker run brain-sdr find /app -name "package.json" -path "*/aws-sdk/*" | wc -l`. If > 0, find which LangChain package pulls them and consider a tree-shaking bundler step
- For the `amqplib-bun` package specifically: it is a fork of vanilla `amqplib` and adds minimal size overhead (< 5MB)
- The largest size contributor is the `@langchain/*` ecosystem — no direct mitigation without bundling. Accept 500-600MB as the realistic target for Brain SDR
- Use `docker history brain-sdr` to identify the largest layers and target those specifically
- Consider `bun build --compile` (single binary) for a future optimization: reduces image to ~50MB but requires all imports to be statically resolvable — incompatible with the current dynamic prompt loading approach

**Phase to address:** Phase 5 of v1.1 (Docker packaging). Profile the image after the Brain SDR implementation is complete, not before.

---

## Phase-Specific Warnings (v1.1)

| Phase | Topic | Pitfall | Mitigation |
|-------|-------|---------|------------|
| Phase 1 | RabbitMQ transport | INT-01: Unhandled channel closure crashes process | Attach error/close listeners; implement reconnection |
| Phase 1 | RabbitMQ transport | INT-02: Unacked message causes infinite redelivery | Always ack/nack in try/catch; configure DLX |
| Phase 1 | Webhook standardization | INT-11: GAP-1 still latent | Fix runner injection before field changes |
| Phase 1 | Auto-migrate startup | INT-08: Concurrent startup race condition | Add PostgreSQL advisory lock in runMigrations() |
| Phase 1 | Auto-migrate startup | INT-09: PostgresSaver setup() race | Add try/catch around setup(); consider moving to migration step |
| Phase 2 | Leads schema | INT-04: users table drop breaks FKs or orphans data | Verify zero FKs; use additive two-step migration |
| Phase 2 | Leads schema | INT-05: unique_id collision from concurrent upsert | Add UNIQUE on numero; use ON CONFLICT upsert pattern |
| Phase 3 | Lead registration flow | INT-06: ia_ativada check placed too late | Check before any LangGraph invocation |
| Phase 3 | Lead registration flow | INT-03: BrainEvent schema mismatch between transports | Single canonical IncomingMessage type + shared normalizer |
| Phase 3 | Conversation history | INT-07: Same lead via two channels simultaneously | Document single-transport assumption; defer multi-channel to v2 |
| Phase 4 | Brain SDR | INT-10: Context window overflow for long conversations | Implement trimMessages or summarization node before production |
| Phase 5 | Docker packaging | INT-12: Image size bloat from LangChain deps | Profile after SDR complete; accept 500-600MB as realistic target |

---

## Critical Pitfalls (v1.0 — preserved)

Mistakes that cause rewrites, data loss, or production outages.

---

### Pitfall 1: LangGraph State Serialization Failures

**What goes wrong:** Graph state containing non-JSON-serializable TypeScript/JavaScript types (`Set`, `Buffer`, `Date`, `Uint8Array`, custom class instances) throws at runtime during checkpointing, LangSmith tracing, or remote execution. The error is opaque — `TypeError: Object of type set is not JSON serializable` — and only surfaces when the checkpointer actually tries to persist.

**Why it happens:** LangGraph checkpoints serialize the entire state object to JSON for persistence, tracing, and resumability. JavaScript `Set` is the most common culprit — developers use it for deduplication (visited URLs, processed IDs) without realizing it's not JSON-serializable.

**Consequences:** Entire workflow crashes mid-execution. In production with a PostgresSaver, the thread is left in a broken state with no clean recovery path.

**Prevention:**
- Define state schemas with only JSON-safe primitives: use `string[]` instead of `Set<string>`, `Record<string, unknown>` instead of `Map`, ISO strings instead of `Date` objects
- Add a CI test that constructs every state type and calls `JSON.stringify()` — fail the build if it throws
- For types that must use Set/Map internally (e.g., for performance), convert to array/object at the reducer boundary before returning from the node

**Detection:** The error fires on first checkpoint write. Run a smoke test that executes one full graph cycle with all state fields populated — this will catch it before users do.

**Phase:** Address in Phase 1 (core infrastructure) when defining state schemas. Never retrofit.

---

### Pitfall 2: MemorySaver in Any Non-Local Environment

**What goes wrong:** `MemorySaver` stores all checkpoint state in process memory. Container restarts, deployments, load balancer failovers, and crashes wipe all in-flight conversations. Users lose context silently — the agent appears to "forget" everything.

**Why it happens:** MemorySaver is the default in LangGraph examples. It works perfectly in notebooks and local demos, creating a false sense that checkpointing is "done."

**Consequences:** Complete conversation state loss on any deployment event. In a multi-instance (horizontal scale) deployment, two requests for the same thread can hit different instances and get different state.

**Prevention:** Use `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`) from the beginning. Never use `MemorySaver` outside of unit tests. The connection pattern: PostgresSaver holds a connection for the entire run duration — use a dedicated connection pool for checkpointing, separate from the application query pool.

**Detection:** Deploy to staging, restart the container mid-conversation, and verify the agent resumes correctly.

**Phase:** Phase 1. `PostgresSaver` must be the only checkpointer used in any environment that is not a unit test.

---

### Pitfall 3: LangGraph Checkpoint Table Unbounded Growth

**What goes wrong:** Every node execution creates approximately 100 rows across LangGraph's 3 checkpoint tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`). Without TTL or pruning, a moderately active deployment creates millions of rows within weeks.

**Why it happens:** LangGraph stores every intermediate state for time-travel debugging and human-in-the-loop resumption. There is no automatic expiry — as of LangGraph JS 1.x, there is no built-in TTL configuration.

**Consequences:** Database storage bloat, degraded query performance on the checkpoint tables, and full table scans during thread lookups.

**Prevention:**
- Schedule a PostgreSQL cron job (or pg_cron extension) to delete checkpoint rows older than N days: `DELETE FROM checkpoints WHERE created_at < NOW() - INTERVAL '30 days'`
- Keep `thread_id` scoped to conversation sessions, not global IDs, so old threads can be pruned by age
- Monitor table sizes with `pg_relation_size()` from day one

**Detection:** Watch `checkpoints` table row count. If it exceeds 1M rows in the first month, pruning is not running.

**Phase:** Phase 1 (schema design) for table structure; Phase 2 (observability) for monitoring; Phase 3 for scheduled pruning implementation.

---

### Pitfall 4: LangGraph Schema Evolution Breaking Existing Threads

**What goes wrong:** Renaming a state field, adding a required field without a default value, or changing a field's type in a LangGraph state definition corrupts or breaks any thread that was checkpointed under the old schema. LangGraph does not validate schema compatibility on load — it silently deserializes the old shape into the new schema, producing `undefined` values where the renamed field used to be.

**Why it happens:** The checkpoint blob is stored as raw JSON. On resume, LangGraph deserializes the JSON into the current TypedDict/annotation shape with no migration layer.

**Consequences:** Production agents silently operate on partial/corrupted state after deployments. Bugs only appear mid-conversation, not at startup.

**Prevention:**
- Add a `schema_version: number` field to every state definition from the start
- Treat state schema changes as database migrations: write an explicit migration function that transforms old checkpoint data before the new code goes live
- Always add new fields with a default value (never required without default)
- Never rename fields — add the new name and deprecate the old with a reducer that reads both

**Detection:** After any state schema change, query the checkpoint table for threads that have the old shape and verify they resume without errors.

**Phase:** Phase 1 (state design). The migration pattern must be established before any real users create threads.

---

### Pitfall 5: PGVector Embedding Dimension Lock-in and Mismatch

**What goes wrong:** The embedding dimension is baked into the column definition (`vector(1536)`). Switching embedding providers (e.g., from OpenAI `text-embedding-3-small` at 1536 dims to a 384-dim local model, or to Gemini at 768 dims) requires dropping and recreating the column and re-embedding all stored data. Silent failures also occur: if the configured provider changes via environment variable but the table still expects the old dimension, writes fail with a hard PostgreSQL error — and in some ORM configurations, this error is swallowed.

**Why it happens:** pgvector enforces dimension count strictly at write time. There is no implicit truncation or padding. Changing providers mid-deployment without a schema migration causes write failures.

**Consequences:** Complete memory system failure after an embedding provider change. Re-embedding large knowledge bases is expensive and time-consuming.

**Prevention:**
- Decide on a single embedding provider and dimension before writing any schema migrations — this is a one-way door
- Use `text-embedding-3-small` (1536 dims) or a 384-dim model (3x faster) — document the chosen dimension in the schema file as a constant
- Add a startup assertion: query the column dimension from `pg_attribute` and compare against `EMBEDDING_DIM` env var — crash loudly if they differ
- Never use the unconstrained `vector` type for the main embeddings column (loses index performance)

**Detection:** Write a startup health check that inserts and retrieves a test embedding and verifies the dimension round-trips correctly.

**Phase:** Phase 1 (schema design). The dimension choice is irreversible without a full data migration.

---

### Pitfall 6: IVFFlat Index Created Before Data is Loaded

**What goes wrong:** Creating an IVFFlat index on an empty (or near-empty) table computes k-means centroids against meaningless data. Queries then search against a broken index and return incorrect results — wrong neighbors, degraded recall — with no error messages.

**Why it happens:** IVFFlat is sometimes included in initial schema migration scripts because it looks like a standard index. Developers don't realize the index must be built after the data is populated.

**Consequences:** Semantic search returns nonsensical results silently. This is one of the hardest production bugs to detect because the queries succeed — they just return wrong data.

**Prevention:**
- Use HNSW as the default index type for new deployments — it does not require data to exist at creation time and has higher recall for typical RAG workloads
- If IVFFlat is used for a large static dataset, add it as a post-data-load script, never a schema migration
- Set reasonable defaults: `m = 16, ef_construction = 200` for HNSW (increase only if recall benchmarks show deficiency)
- Set `probes` at query time: the default `1` gives terrible recall — use `SET ivfflat.probes = 10` minimum

**Detection:** Benchmark recall after index creation using known query/result pairs. If recall is below 90%, the index may have been created on empty data.

**Phase:** Phase 1 (schema design). The index type decision should be made explicitly, not by default.

---

### Pitfall 7: Per-Tenant Connection Pool Explosion

**What goes wrong:** Brain Core uses a 1-database-per-tenant model. A naive implementation creates a new Drizzle/`pg` connection pool for each incoming request, or maintains a pool per tenant with no cap on total pools. At 50 concurrent tenants, this opens 50 × pool_size connections to PostgreSQL, which has a hard limit (typically 100 default, configurable to several hundred).

**Why it happens:** The pattern "get tenant DB name from request → create DB connection → run query" is straightforward and works in development with one tenant. In production with many tenants, the resource math breaks immediately.

**Consequences:** PostgreSQL connection exhaustion (`FATAL: remaining connection slots are reserved for non-replication superuser connections`), cascading query failures across all tenants.

**Prevention:**
- Use a connection cache: maintain a `Map<tenantId, Pool>` keyed by tenant, with a maximum cap (e.g., 20 pools) and LRU eviction for idle tenants
- Size each per-tenant pool small (2-5 connections) rather than using defaults
- Add a global connection count metric — alert if total connections exceed 70% of `max_connections`
- Consider PgBouncer in transaction-pooling mode in front of PostgreSQL for deployments with >20 tenants

**Detection:** Load test with 10+ simulated tenants making simultaneous requests and watch `pg_stat_activity` connection counts.

**Phase:** Phase 1 (multi-tenancy foundation). The connection architecture must be designed before the first request handler is written.

---

### Pitfall 8: Drizzle Client Recreation Per Request (Multi-Tenant)

**What goes wrong:** A common multi-tenant pattern is to call `drizzle(new Pool({ database: tenantDbName }))` inside the request handler. Each call creates a new pool object, which does not get reused, and the previous pool is never cleanly closed. This leaks connections and adds ~10-50ms overhead per request for pool initialization.

**Why it happens:** Drizzle's `drizzle()` constructor accepts a fresh pool instance, making per-request client creation syntactically easy. There's no warning when you do this — it works, it's just expensive.

**Consequences:** Connection leak, memory growth, and latency degradation over time.

**Prevention:**
- Cache Drizzle instances in a `Map<tenantId, DrizzleDB>` at the module level, created once and reused
- Use a lazy initialization pattern: create the pool on first request for that tenant, cache it, reuse on subsequent requests
- Add a `closeAll()` function for graceful shutdown that drains all cached pools

**Detection:** Log pool creation events. If the same tenant triggers pool creation more than once per process lifetime, the cache is not working.

**Phase:** Phase 1 (database layer). Establish the pattern in `packages/database` before any Brain uses it.

---

## Moderate Pitfalls (v1.0 — preserved)

---

### Pitfall 9: LangGraph Recursion Limit Too Low for Complex Agents

**What goes wrong:** LangGraph's default `recursionLimit` is 25 (counting each node visit as one step). A Brain with a qualification sub-agent (the SDR pattern: main agent → qualifies lead → returns to main) can exhaust 25 steps in a single conversation turn with tool calls.

**Prevention:**
- Set `recursionLimit` explicitly in `graph.compile()` config: 50 for simple agents, 100 for agents with subgraphs
- The default 25 was chosen to catch infinite loops, not as a reasonable workflow limit — treat it as a minimum floor, not a production setting
- Implement explicit termination conditions in subgraphs rather than relying on the limit as a circuit breaker

**Phase:** Phase 2 (agent orchestration). Test with realistic multi-turn conversations before declaring an agent "done."

---

### Pitfall 10: LangGraph Parallel Node State Reducer Conflicts

**What goes wrong:** When two nodes execute in parallel and both write to the same state key without a reducer, LangGraph throws `InvalidUpdateError`. This is not caught at graph compile time — it only fires at runtime when the parallel branch actually executes.

**Prevention:**
- Define explicit reducers for every state key that could be written by parallel nodes: `Annotated<T, (a: T, b: T) => T>`
- For lists that accumulate results (e.g., tool outputs), use `(existing, update) => [...existing, ...update]`
- Add a capped reducer for lists to prevent unbounded growth: `(existing, update) => [...existing, ...update].slice(-N)`

**Phase:** Phase 2 (agent graph design). Any graph with a fan-out pattern must define reducers before the first run.

---

### Pitfall 11: Bun `node:async_hooks` Gaps Break APM and Some LangChain Internals

**What goes wrong:** Bun's `node:async_hooks` implementation is missing V8 promise hooks. Libraries that depend on `AsyncLocalStorage` for context propagation (LangChain's callback handlers, some APM agents like `dd-trace`, OpenTelemetry SDK) may fail silently or produce broken traces.

**Prevention:**
- Test LangChain's callback propagation (LangSmith tracing) explicitly with Bun before relying on it in production
- Avoid `dd-trace` with Bun — use OpenTelemetry with the `@opentelemetry/sdk-node` package, which has better Bun compatibility
- If a library requires native modules (`node-gyp`), find a pure-JS alternative (`bcryptjs` instead of `bcrypt`)

**Detection:** Run the LangSmith tracing integration test on Bun. If traces appear incomplete or missing, `async_hooks` is the culprit.

**Phase:** Phase 1 (observability setup). Validate the tracing stack on Bun before integrating it into the core.

---

### Pitfall 12: Bun Monorepo Workspace Install Performance Regression

**What goes wrong:** Bun workspaces can be 70x slower than pnpm for dependency resolution in monorepos where packages are already installed (the "no-op install" case). Reported as a Bun regression in January 2026. This makes CI pipelines and local development unnecessarily slow.

**Prevention:**
- Use `pnpm` as the workspace/package manager for the monorepo, even though `bun` is the runtime
- In Docker builds and CI, use `pnpm install --frozen-lockfile` for package installation
- Use `bun run` (or explicit `bun <script>`) only for script execution and the runtime — not for package management

**Detection:** Time `bun install` on a warm cache vs. `pnpm install`. If Bun is significantly slower, switch package management to pnpm.

**Phase:** Phase 1 (monorepo scaffolding). The package manager decision is hardest to change later.

---

### Pitfall 13: TypeScript Path Aliases Not Resolved at Runtime by Bun

**What goes wrong:** TypeScript `paths` in `tsconfig.json` (e.g., `@brain/core` → `../../packages/core/src`) are a TypeScript compiler feature — they are not understood by Node.js or Bun at runtime. Running `bun src/index.ts` directly will fail with `Module not found: @brain/core` even if tsc compiles successfully.

**Why it happens:** Developers configure paths for IDE autocompletion and tsc type checking. They assume the runtime handles them the same way. It does not — path aliases require either a bundler (esbuild, tsup) or Bun's `bunfig.toml` alias configuration to work at runtime.

**Prevention:**
- For Bun runtime: define aliases in `bunfig.toml` under `[alias]` section to mirror the tsconfig paths
- Alternatively, use Node.js subpath imports (`imports` field in `package.json`) which are natively supported by both tsc and Bun
- Never rely on tsc compilation for runtime alias resolution — use a bundler or runtime-native alias mechanism

**Detection:** After adding a new path alias to tsconfig, run `bun src/index.ts` directly (not through a bundler) and verify it resolves. If not, the alias is only a type-level alias.

**Phase:** Phase 1 (monorepo TypeScript config). Establish the alias resolution pattern before it proliferates across packages.

---

### Pitfall 14: LangGraph/LangChain Peer Dependency Version Drift

**What goes wrong:** `@langchain/core`, `@langchain/langgraph`, and `langchain` share peer dependencies but are versioned independently. Installing `@langchain/langgraph@1.3.x` with an incompatible `@langchain/core@0.x` causes silent type errors, runtime failures in message serialization, and "duck-typed" incompatibilities that are extremely hard to trace.

**Prevention:**
- Pin exact versions for all `@langchain/*` packages in `package.json` — do not use caret (`^`) ranges
- Use pnpm's `peerDependencyRules` to enforce consistent peer resolution
- Create a single source of truth: define all `@langchain/*` versions in the root `package.json` and use `workspace:*` in packages that consume them
- Update all `@langchain/*` packages together in a single commit, never independently

**Detection:** Run `pnpm why @langchain/core` and verify only one version appears in the resolution tree.

**Phase:** Phase 1 (monorepo package setup). Lock versions before writing any LangGraph code.

---

### Pitfall 15: Tool Call Infinite Loop Under Rate Limiting

**What goes wrong:** LLM API rate limits cause tool calls to fail with transient errors. Naive retry logic retries the same tool call indefinitely, which — combined with LangGraph's loop structure — creates a feedback loop that burns through the recursion limit, generates enormous token usage, and may trigger secondary rate limits.

**Prevention:**
- Implement tool-level retry with exponential backoff and a hard cap (max 3 retries per tool call)
- Return a structured error result from the tool instead of throwing — let the LLM decide how to handle it rather than having the infrastructure retry blindly
- Set `maxExecutionTime` on the graph invoke call as a hard wall-clock timeout
- Track tool call counts in state — if any single tool has been called more than 5 times in one graph run, trigger a graceful abort

**Detection:** Inject a failing tool in staging and observe agent behavior — it should fail gracefully within seconds, not spin for minutes.

**Phase:** Phase 2 (tools registry). Tool error handling patterns must be established when the first real tool is implemented.

---

### Pitfall 16: Memory Layer Mixing — Embedding All Messages Into Vector Store

**What goes wrong:** Storing every conversation message in the vector store (PGVector) as an embedding is the most common memory architecture mistake. It creates retrieval noise (small talk, filler phrases, acknowledgements returning as "relevant" context), inflates storage, and makes semantic search progressively less useful as volume grows.

**Prevention:**
- Only embed semantically rich content: user-stated facts, preferences, goals, documents, and knowledge base entries
- Keep conversation history as structured records in PostgreSQL (not PGVector) — retrieve it with time-based queries, not similarity search
- Run a summarization/extraction step that distills conversation turns into facts before embedding them
- Separate tables: `memories` (structured facts) vs. `embeddings` (vector index) vs. `agent_state` (LangGraph checkpoints)

**Detection:** After 100 conversation turns, query PGVector for "hello" — if it returns conversation turns from 3 weeks ago, your embedding strategy needs filtering.

**Phase:** Phase 2 (memory architecture). The 3-layer memory design (short-term, long-term, semantic) must be implemented as distinct components with explicit boundaries.

---

## Minor Pitfalls (v1.0 — preserved)

---

### Pitfall 17: PGVector HNSW Index Memory Usage Surprise

**What goes wrong:** HNSW indexes consume 2-5x more memory than IVFFlat because the graph stores neighbor connections at every layer. At `m = 64, ef_construction = 500` (common "high quality" settings found in blog posts), memory usage can exceed available RAM on modest servers, causing the index to be paged to disk and destroying query performance.

**Prevention:** Start with `m = 16, ef_construction = 200`. These are the conservative defaults that work well up to millions of vectors. Increase only if recall benchmarks show deficiency. Index building happens in memory — ensure the Postgres server has at least `(vectors × dimensions × 4 bytes × 2)` free RAM before building.

**Phase:** Phase 1 (schema) and Phase 3 (performance tuning).

---

### Pitfall 18: LangGraph `interrupt_before` vs `interrupt_after` Confusion

**What goes wrong:** Human-in-the-loop flows use `interrupt_before` or `interrupt_after` to pause execution. Using `interrupt_after` means the node's action has already executed before the pause — the user is reviewing a fait accompli, not approving a pending action. This is the most frequently reported human-in-the-loop mistake.

**Prevention:** For approval flows, always use `interrupt_before`. Reserve `interrupt_after` for "review what happened" use cases, not "approve before proceeding."

**Phase:** Phase 3 (human-in-the-loop features, if applicable).

---

### Pitfall 19: Missing Subgraph Checkpointer Inheritance

**What goes wrong:** In Brain Core's SDR pattern (main Brain → qualification sub-agent), the parent graph's checkpointer is not automatically inherited by compiled subgraphs. If the subgraph is compiled independently (`subgraph.compile()` with no checkpointer), its internal state is not persisted and cannot be inspected or resumed.

**Prevention:** Pass the parent's checkpointer to the subgraph via `subgraph.compile({ checkpointer: parentCheckpointer })`, or use the subgraph as an uncompiled node (adding it directly as a node rather than calling `.compile()` on it separately).

**Phase:** Phase 2 (agent orchestration, when the qualification sub-agent is built).

---

## Sources

### v1.3 Sources
- MCP SSE deprecation notice (Atlassian, June 2026): https://community.atlassian.com/forums/Atlassian-Remote-MCP-Server/HTTP-SSE-Deprecation-Notice/ba-p/3205484
- MCP Streamable HTTP vs SSE migration guide (Apigene 2026): https://apigene.ai/blog/mcp-streamable-http
- MCP SSE vs Stdio transport explained (Apigene 2026): https://apigene.ai/blog/mcp-sse-vs-stdio
- langchain-mcp-adapters transport naming issue (#322 — streamable_http vs streamable-http): https://github.com/langchain-ai/langchain-mcp-adapters/issues/322
- MultiServerMCPClient silent tool loss when any server fails (#492): https://github.com/langchain-ai/langchain-mcp-adapters/issues/492
- @langchain/mcp-adapters npm — onConnectionError config: https://www.npmjs.com/package/@langchain/mcp-adapters
- n8n MCP Server Trigger documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/
- LangGraph INVALID_CHAT_HISTORY error documentation: https://docs.langchain.com/oss/python/langgraph/errors/INVALID_CHAT_HISTORY
- LangGraph ToolNode handle_tool_errors does not catch asyncio.CancelledError (#6726): https://github.com/langchain-ai/langgraph/issues/6726
- LangGraph create_react_agent structured_response omits last agent message (issue #4756): https://github.com/langchain-ai/langgraph/issues/4756
- LangGraph create_react_agent ignores last agent message (discussion #4318): https://github.com/langchain-ai/langgraph/discussions/4318
- LangGraph refactor structured output into agent node (issue #5872): https://github.com/langchain-ai/langgraph/issues/5872
- Agents silently fail when models skip structured output tool call (langchain issue #36349): https://github.com/langchain-ai/langchain/issues/36349
- Missing structuredResponse in getState() (LangChain Forum, January 2026): https://forum.langchain.com/t/missing-structuredresponse-when-retrieving-agent-state-via-getstate-other-questions/2843
- LangGraph structured output strategies (DeepWiki): https://deepwiki.com/langchain-ai/langchainjs/3.4-response-format-and-structured-output
- Anthropic Claude structured outputs documentation (GA): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic structured output beta header (structured-outputs-2025-11-13): https://towardsdatascience.com/hands-on-with-anthropics-new-structured-output-capabilities/
- LangChain withStructuredOutput Anthropic — method=json_schema vs function_calling: https://reference.langchain.com/python/langchain-anthropic/chat_models/ChatAnthropic/with_structured_output
- LangChain.js Zod-to-JSONSchema uses wrong converter for OpenAI strict mode (issue #6479): https://github.com/langchain-ai/langchainjs/issues/6479
- JSON schema not passed to OpenAI when using ReAct agent (issue #6623): https://github.com/langchain-ai/langchainjs/issues/6623
- OpenAI structured outputs provider differences (TokenMix 2026): https://tokenmix.ai/blog/structured-output-json-guide
- Bun.serve idle timeout for SSE — default 10 seconds (issue #27479): https://github.com/oven-sh/bun/issues/27479
- Bun SSE implementation guide: https://bun.com/docs/guides/http/sse
- Bun SSE MCP transport package (glama.ai): https://glama.ai/mcp/servers/@tigranbs/bun-mcp-sse-transport
- LangGraph MCP integration guide (generect.com 2026): https://generect.com/blog/langgraph-mcp/
- MCP circuit breaker pattern for production: https://dev.to/neurolink/mcp-circuit-breaker-preventing-cascading-failures-in-ai-tool-calls-4bi4
- Resilient AI agents with MCP — timeout and retry strategies: https://octopus.com/blog/mcp-timeout-retry

### v1.1 Sources
- amqplib unhandled rejection on channel close: [amqplib issue #250 — Channel ended, no reply will be forthcoming](https://github.com/amqp-node/amqplib/issues/250)
- amqplib connection close uncatchable: [amqplib issue #334 — connection.close causes process to die](https://github.com/squaremo/amqp.node/issues/334)
- RabbitMQ auto-reconnect Node.js: [Ecostack — RabbitMQ Auto Reconnect Node.js](https://ecostack.dev/posts/rabbitmq-auto-reconnect-nodejs/)
- RabbitMQ graceful shutdown: [KiritoA Blog — Shutdown RabbitMQ consumer gracefully](https://kiritox.me/shutdown-rabbitmq-consumer-gracefully/)
- RabbitMQ DLX Node.js: [Elest.io — RabbitMQ + Node.js with Dead Letter Queues](https://blog.elest.io/rabbitmq-node-js-build-resilient-event-driven-microservices-with-dead-letter-queues/)
- RabbitMQ best practices (connection/channel): [CloudAMQP — RabbitMQ Best Practices](https://www.cloudamqp.com/blog/part1-rabbitmq-best-practice.html)
- RabbitMQ 13 common errors: [CloudAMQP — 13 Common RabbitMQ Mistakes](https://www.cloudamqp.com/blog/part4-rabbitmq-13-common-errors.html)
- LangGraph thread_id cross-contamination: [langgraphjs issue #2040 — Cross-thread checkpoint data contamination](https://github.com/langchain-ai/langgraphjs/issues/2040)
- LangGraph PostgresSaver race condition fix: [LangGraph PR #2494 — Fix race condition in PostgresSaver](https://github.com/langchain-ai/langgraph/pull/2494)
- LangGraph mixed thread_id formats bug: [LangGraph issue #6623 — Partial Graph State Missing Due to Mixed thread_id Formats](https://github.com/langchain-ai/langgraph/issues/6623)
- LangGraph context window management 2026: [Zylos Research — Context Window Management and Session Lifecycle](https://zylos.ai/research/2026-03-31-context-window-management-session-lifecycle-long-running-agents/)
- LangGraph trim_messages: [LangChain Docs — Short-term memory](https://docs.langchain.com/oss/python/langchain/short-term-memory)
- Context window overflow Redis 2026: [Redis Blog — Context Window Overflow in 2026](https://redis.io/blog/context-window-overflow/)
- Drizzle migration concurrent instances: [DEV — Drizzle ORM Migrations in Production: Zero-Downtime Schema Changes](https://dev.to/whoffagents/drizzle-orm-migrations-in-production-zero-downtime-schema-changes-e71)
- Drizzle column rename/drop safety: [DEV — Zero-Downtime Postgres Migrations with Drizzle ORM](https://dev.to/whoffagents/zero-downtime-postgres-migrations-with-drizzle-orm-22ga)
- PostgreSQL advisory locks: [Leapcell — Orchestrating Distributed Tasks with PostgreSQL Advisory Locks](https://leapcell.io/blog/orchestrating-distributed-tasks-with-postgresql-advisory-locks)
- Advisory lock PgBouncer incompatibility: [IBM mcp-context-forge issue #4051](https://github.com/IBM/mcp-context-forge/issues/4051)
- NanoID vs UUID collision risk: [Toolsbase — UUID v4 vs v7 vs NanoID vs CUID2](https://toolsbase.dev/en/blog/uuid-comparison-guide)
- Docker image size reduction Bun/Node: [Better Stack — Reducing Docker Image Sizes](https://betterstack.com/community/guides/scaling-docker/reducing-docker-image-size/)

### v1.0 Sources
- LangGraph serialization: [Fix LangGraph JSON Serialization Error](https://markaicode.com/errors/langgraph-json-parse-error-fix/)
- LangGraph state management undocumented issues: [LangGraph State Management Guide](https://altersquare.io/langgraph-state-management-undocumented-issues-after-commit/)
- LangGraph checkpointing best practices: [Mastering LangGraph Checkpointing 2025](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025/)
- LangGraph checkpoint growth: [How to keep checkpoint data from growing unbounded](https://github.com/langchain-ai/langgraphjs/issues/1138)
- LangGraph PostgresSaver: [@langchain/langgraph-checkpoint-postgres npm](https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres)
- LangGraph recursion limit: [GRAPH_RECURSION_LIMIT docs](https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT)
- LangGraph infinite loop bug: [Agent infinite looping issue #6731](https://github.com/langchain-ai/langgraph/issues/6731)
- LangGraph subgraph state: [Subgraph state communication forum](https://forum.langchain.com/t/how-does-state-work-in-langgraph-subgraphs/1755)
- Multi-agent pitfalls: [Architecting Multi-Agent Systems with LangGraph](https://medium.com/@timarkanta.sharma/architecting-multi-agent-systems-with-langgraph-patterns-trade-offs-and-real-world-design-ba8c535c6b35)
- LangChain versioning: [LangChain and LangGraph 1.0 milestone](https://blog.langchain.com/langchain-langgraph-1dot0/)
- LangGraph prebuilt breaking change: [Issue #6363 version constraints](https://github.com/langchain-ai/langgraph/issues/6363)
- PGVector HNSW vs IVFFlat: [IVFFlat vs HNSW in pgvector](https://dev.to/philip_mcclarence_2ef9475/ivfflat-vs-hnsw-in-pgvector-which-index-should-you-use-305p)
- PGVector performance: [pgvector performance benchmark](https://www.instaclustr.com/education/vector-database/pgvector-performance-benchmark-results-and-5-ways-to-boost-performance/)
- PGVector dimension mismatch: [pgvector Dimension Mismatch 2026](https://dbadataverse.com/tech/postgresql/2026/05/pgvector-gotchas-dimension-mismatch-casting-errors-and-alter-table-solved-2026)
- AI agent memory architecture: [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- Tool call reliability: [LLM Tool-Calling in Production](https://medium.com/@komalbaparmar007/llm-tool-calling-in-production-rate-limits-retries-and-the-infinite-loop-failure-mode-you-must-2a1e2a1e84c8)
- Multi-tenant connection pooling: [How to Implement Multi-Tenancy in Node.js](https://oneuptime.com/blog/post/2026-01-27-nodejs-multi-tenancy/view)
- Bun Node.js compatibility: [Bun Node.js Compatibility Docs](https://bun.com/docs/runtime/nodejs-compat)
- Bun monorepo issues: [Bun workspace performance issue #25799](https://github.com/oven-sh/bun/issues/25799)
- Bun production evaluation: [Bun in 2025: Critical Evaluation](https://angelo-lima.fr/en/bun-2025-critical-evaluation-javascript-runtime-alternative/)
- TypeScript monorepo path aliases: [TypeScript Path Aliases in Turborepo](https://www.xjavascript.com/blog/how-to-configure-module-aliases-in-a-monorepo-bootstrapped-with-turborepo/)
- Drizzle multi-tenant: [Drizzle ORM multi-tenancy discussion](https://github.com/mateusflorez/drizzle-multitenant)
