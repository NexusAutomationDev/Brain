# Architecture Research: v1.3 MCP Integration + Dynamic responseMode

**Milestone:** v1.3 MCP Integration + Dynamic responseMode
**Researched:** 2026-06-15
**Confidence:** HIGH (existing codebase read directly; MCP API verified via official docs and GitHub; structured output constraints verified via GitHub issue #7757 + LangGraph issue #5872 + official LangChain docs)

---

## MCP Integration Architecture

### Question 1 — Where in the lifecycle should MCP client be initialized?

**Answer: inside `BrainRunner._compileGraph()`, stored as a long-lived instance on the runner.**

Rationale from research:

- `MultiServerMCPClient` (from `@langchain/mcp-adapters` v1.1.3) must be initialized once per process, not per request. Official docs and Python lifecycle documentation confirm: "In production, hold the client open for the lifetime of the process." The TypeScript API follows the same architectural principle. (MEDIUM confidence — derived from Python lifecycle guidance; TypeScript API is stateless by default per official docs, but persistent connection is still preferable for SSE transport startup overhead.)
- `_compileGraph()` is already the single point where all graph dependencies (`llm`, `checkpointer`, `tools`) are wired. Adding MCP client initialization here keeps all graph wiring in one place and avoids scattering async startup across `init()` and `buildGraph()`.
- The tools returned by `client.getTools()` must be available before `brain.buildGraph(ctx)` is called, since `buildGraph` receives `ctx.tools` and passes them to `ToolNode`. MCP initialization must happen inside `_compileGraph()`, before `BrainBuildContext` is assembled.
- Storing the client reference on the runner (`this.mcpClient`) enables `close()` on shutdown and proper reuse across `refreshPrompts()` calls (which also call `_compileGraph()`).

**Not recommended:**
- `BrainRunner.init()` directly: too early; the actual initialization happens in `_compileGraph()` called from `init()`, so placing MCP init there means it runs before `_compileGraph()` is called — wrong sequencing.
- `brain.init()`: there is no `init()` on `IBrain`. Adding one would change the interface contract unnecessarily.
- `BrainBuildContext`: the context is a plain data bag passed to `buildGraph()`. Putting a client lifecycle object here would make Brain implementations responsible for managing connection state — wrong layer.
- Per-request (inside `run()`): explicitly ruled out; SSE connection startup overhead is non-trivial per-request.

### New components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `MCPClientManager` (optional thin helper) | `packages/core/src/mcp/manager.ts` | Reads ENV (`MCP_URL`, `MCP_TOOLS`), initializes `MultiServerMCPClient`, exposes `getFilteredTools()` and `close()`. Keeps `_compileGraph()` readable. |
| `@langchain/mcp-adapters` (npm dep) | `packages/core/package.json` | Provides `MultiServerMCPClient` and `getTools()`. |

The `MCPClientManager` can be a plain module-level factory function `initMCPClient(config): Promise<{ tools: StructuredTool[], close: () => Promise<void> }>`. A class is also fine for consistency with other managers in the codebase.

### Modified components

**`BrainRunner._compileGraph()` (packages/core/src/runner/runner.ts)**

Current flow:
```
createCheckpointer → drizzle → MemoryManager → getTools(registry) → createLLM → BrainBuildContext → buildGraph() → compile()
```

New flow:
```
createCheckpointer → drizzle → MemoryManager → getTools(registry)
  → [if MCP_URL: initMCPClient → getFilteredTools()]
  → merge tools
  → createLLM → BrainBuildContext(merged tools) → buildGraph() → compile()
```

Concrete changes to `runner.ts`:
- Add `private mcpClient: { close: () => Promise<void> } | null = null` field.
- Before building `BrainBuildContext`, check `process.env.MCP_URL`; if present, initialize `MultiServerMCPClient`, call `await client.getTools()`, filter by `MCP_TOOLS` CSV, merge with `filteredTools`.
- Store the `close()` reference for shutdown.
- Add `async close(): Promise<void>` method on `BrainRunner` (calls `await this.mcpClient?.close()`).
- Pass merged tools to `ctx.tools` — no change to `BrainBuildContext` type needed.

**`BrainBuildContext` (packages/core/src/brain/interface.ts)**

No structural change required. The merged tools (local + MCP) arrive through `ctx.tools` exactly as before. `IBrain.buildGraph()` passes `ctx.tools` to `ToolNode` — no interface change needed.

**`IBrain` interface**

No change required for MCP integration.

### Data flow

```
ENV: MCP_URL=https://n8n.example.com/mcp, MCP_TOOLS=getAvailableDate,schedule_meeting

BrainRunner._compileGraph()
  ├── filteredTools = toolsRegistry.getTools(brainType, brain.tools)
  │
  ├── IF process.env.MCP_URL:
  │     client = new MultiServerMCPClient({
  │       mcpServers: { external: { transport: "sse", url: process.env.MCP_URL } }
  │     })
  │     allMcpTools = await client.getTools()
  │     allowList = process.env.MCP_TOOLS?.split(",").map(s => s.trim()) ?? []
  │     filteredMcpTools = allMcpTools.filter(t => allowList.includes(t.name))
  │     this.mcpClient = { close: () => client.close() }
  │     allTools = [...filteredTools, ...filteredMcpTools]
  │   ELSE:
  │     allTools = filteredTools
  │
  ├── ctx = { llm, prompts, tools: allTools, sql }
  └── brain.buildGraph(ctx)  ← receives merged tools, ToolNode uses them as usual

BrainRunner.close()  [new — called on SIGTERM]
  └── await this.mcpClient?.close()
```

### Question 5 — Config placement: ENV read in BrainRunner (not in Brain's init)

`MCP_URL` and `MCP_TOOLS` are read by `BrainRunner._compileGraph()`. This follows the established pattern: the runner already reads `DATABASE_URL`, `MIGRATIONS_FOLDER`, `LLM_PROVIDER`, etc. Brains are ignorant of infrastructure concerns. `IBrain` remains a pure definition of prompts, tools, and graph structure.

### Question 2 — How should MCP tools be added to ToolNode without changing IBrain dramatically?

By merging them into `ctx.tools` inside `_compileGraph()`, the Brain's `buildGraph(ctx)` receives a combined list with no knowledge of which tools are local vs MCP. The Brain implementation passes `ctx.tools` to `ToolNode` as it already does (or as it should — see brain-sdr note below). No interface change required.

**Note on brain-sdr's current pattern:** `brain.ts` currently does NOT use `ctx.tools` for `ToolNode` — it constructs `boundQualifyTool`, `boundPauseSessionTool`, `boundFinishConversationTool` inline in `buildGraph()`. MCP tools cannot be "bound" with closures the same way. For MCP tools, they should be passed through `ctx.tools` and added directly to `ToolNode`. The `buildGraph()` implementation needs to merge its inline-bound tools with `ctx.tools` for the `ToolNode` call:

```typescript
// In buildGraph(), ToolNode receives local bound tools + ctx.tools (MCP tools)
new ToolNode([boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool, ...ctx.tools])
// And llmWithTools binds all of them too:
ctx.llm.bindTools([boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool, ...ctx.tools, respondTool])
```

This is the minimal change to `brain-sdr/src/brain.ts` for MCP integration.

---

## Dynamic responseMode Architecture

### Question 3 — Does `.withStructuredOutput()` break the ReAct pattern?

**Answer: YES — `withStructuredOutput` and `bindTools` are mutually exclusive on the same LLM instance.** (HIGH confidence — confirmed by GitHub issue langchain-ai/langchainjs #7757 which is open with "triage: high-impact" label, LangGraph issue #5872 which explicitly calls this out, and LangChain community forum discussion.)

When both are applied to the same LLM instance, tool schemas are silently dropped or the structured output schema conflicts with tool schemas. The framework does NOT throw an error — it silently breaks. This eliminates `withStructuredOutput()` as a solution for the main `llmWithTools` instance.

### The correct pattern: Schema-as-Tool (response schema bound as a tool alongside regular tools)

This is the established LangGraph pattern documented in `how-tos/respond-in-format` and explicitly proposed in LangGraph issue #5872 as the fix for `create_react_agent`. The pattern:

1. Define the response schema as a Zod object matching `BrainOutputSchema` shape.
2. Convert it into a `tool()` using `@langchain/core/tools` — this is the `respond` tool.
3. Bind `[...realTools, respondTool]` together to the LLM via `bindTools()` only — no `withStructuredOutput()` on the main LLM.
4. In the conditional router, detect when the `respond` tool was called and route to a `respond` node (not `tools`).
5. The `respond` node extracts the tool call arguments, validates them with `BrainOutputSchema`, and writes to `state.brainOutput`.

This eliminates the need for a second LLM instance or a second LLM invocation. The LLM calls `respond` as its final action, providing the structured `BrainOutput` as tool arguments.

### llm node changes

**Current state (brain-sdr/src/brain.ts):**
```typescript
const llmWithTools = ctx.llm.bindTools([boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool]);

// llm node sets brainOutput inline:
const fullResponse = typeof response.content === "string" ? response.content : "";
return { messages: [response], brainOutput: { fullResponse, responseMode: "text" as const } };
```

**New approach (schema-as-tool):**
```typescript
// 1. respond tool defined in packages/core/src/tools/respond.ts
const respondTool = createRespondTool(); // returns tool() with BrainOutputSchema shape

// 2. All tools bound together — respond is just another tool
const llmWithTools = ctx.llm.bindTools([
  boundQualifyTool,
  boundPauseSessionTool,
  boundFinishConversationTool,
  ...ctx.tools,    // MCP tools
  respondTool,     // final response schema
]);

// 3. llm node becomes simpler — no inline brainOutput
// Returns only messages; brainOutput set by respond node
return { messages: [response] };

// 4. respond node extracts brainOutput from tool call args
"respond" node: (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  const respondCall = lastMsg.tool_calls?.find(tc => tc.name === "respond");
  const brainOutput = BrainOutputSchema.parse(respondCall.args);
  return { brainOutput };
}

// 5. Custom router replaces toolsCondition
(state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (!lastMsg.tool_calls?.length) return "__end__";
  const hasRespondCall = lastMsg.tool_calls.some(tc => tc.name === "respond");
  if (hasRespondCall) return "respond";
  return "tools";
}
```

### Graph structure changes

Current graph (2 nodes, toolsCondition):
```
__start__ → llm → [toolsCondition] → tools → llm → [toolsCondition] → __end__
                                    ↘ __end__
```

New graph (3 nodes, custom router):
```
__start__ → llm → [customRouter] → tools → llm → [customRouter] → __end__
                                  ↘ respond → __end__
```

The `respond` node is a pure extraction node — no LLM call, no DB access, just parse tool call args and return `{ brainOutput }`. The `llm` node becomes simpler: returns `{ messages: [response] }` only, never sets `brainOutput` directly.

The old pattern (`brainOutput: { fullResponse, responseMode: "text" as const }` in the llm node) is removed. This was a v1.2 approximation that hardcoded `responseMode: "text"`. The schema-as-tool pattern is the correct long-term architecture.

### Impact on BrainStateAnnotation

No change to `BrainStateAnnotation` in `packages/ai/src/graph/state.ts`. The `brainOutput` field already exists with the correct type and last-write-wins reducer. The `respond` node writes to it exactly as the `llm` node did before.

### Impact on BrainRunner.run() validation

No change. `BrainRunner.run()` already validates `result.brainOutput !== null` and calls `BrainOutputSchema.parse(rawOutput)`. The `respond` node sets `state.brainOutput` before `__end__`, so the invariant holds. The existing validation catches any case where the LLM fails to call `respond`.

### Question 4 — Multi-provider configuration

`packages/ai/src/llm/factory.ts` already implements multi-provider via `LLM_PROVIDER` ENV (`openai | anthropic | gemini | openrouter`). **No change required.**

The `schema-as-tool` pattern works identically across all providers that support `bindTools()`, which includes both target providers:
- OpenAI (`ChatOpenAI`): native function calling — tool schemas sent as `functions` parameter.
- Anthropic (`ChatAnthropic`): native tool use — tool schemas sent via `tool_use` protocol.

Both providers surface tool call results as `tool_calls` on the `AIMessage`, which is what the custom router inspects. No provider-specific branching needed.

`withStructuredOutput()` — which we are NOT using for the main LLM — has provider-specific behavior (some use JSON mode, some use tool calling internally). Since we use `schema-as-tool` instead, those differences are irrelevant.

The existing `if (!ctx.llm.bindTools)` guard in `brain.ts` remains valid and sufficient.

### `createRespondTool` placement

New file: `packages/core/src/tools/respond.ts`

This belongs in `packages/core` alongside `pause-session.ts` and `finish-conversation.ts`. It is a SDK-provided tool, not a Brain-specific tool. All Brains that want dynamic responseMode import and use it.

```typescript
// packages/core/src/tools/respond.ts
export function createRespondTool() {
  return tool(
    async (args) => args, // args ARE the brainOutput — passthrough
    {
      name: "respond",
      description: "Call this tool to send your final response to the user. Always use this as your last action.",
      schema: z.object({
        fullResponse: z.string().describe("Full text of your response"),
        responseMode: z.enum(["text","audio","image","video","document"])
          .describe("Format: text for messages, audio for voice, image/video/document for media"),
        mediaType: z.string().optional().describe("MIME type, required for image/video/document"),
        mediaUrl: z.string().optional().describe("URL to media file, required for image/video/document"),
      }),
    }
  );
}
```

The schema mirrors `BrainOutputSchema` but is defined inline (avoids importing Zod schema from core into the tool definition, which would create an awkward dep on the output schema module).

---

## Suggested Build Order

### Phase A: TD-01 Fix (prerequisite)

**Scope:** `apps/brain-sdr/src/qualifier.ts` — add `prepare: false` to the postgres connection used by the qualifier sub-agent.

**Why first:** Production blocker (PgBouncer incompatibility). Zero architecture impact; isolated to one file. Should be deployed before any other v1.3 work to reduce production risk.

### Phase B: MCP Integration

Build order within this phase:

1. Install `@langchain/mcp-adapters` in `packages/core/package.json`.
2. Create `packages/core/src/mcp/manager.ts` — `initMCPClient(url, toolsAllowList)` function.
3. Modify `BrainRunner._compileGraph()` — add MCP conditional block, tool merge, client storage.
4. Add `BrainRunner.close()` method.
5. Register `runner.close()` on `process.on("SIGTERM")` in `apps/brain-sdr/src/index.ts`.
6. Modify `apps/brain-sdr/src/brain.ts` — spread `ctx.tools` into `ToolNode` and `bindTools()` call.
7. Unit tests: mock `MultiServerMCPClient`, verify tool merge and filtering.

**Why before responseMode:** MCP tools arrive in `ctx.tools`. The responseMode phase also modifies `bindTools()` (adds `respondTool`). Separating them makes each change reviewable in isolation and avoids touching `brain.ts` twice with entangled concerns.

### Phase C: Dynamic responseMode

Build order within this phase:

1. Create `packages/core/src/tools/respond.ts` — `createRespondTool()` factory.
2. Export from `packages/core/src/index.ts`.
3. Modify `apps/brain-sdr/src/brain.ts`:
   - Import `createRespondTool` from `@brain-pkg/core`.
   - Add `respondTool = createRespondTool()` to `bindTools()`.
   - Remove static `brainOutput` assignment from `llm` node (return only `{ messages: [response] }`).
   - Add `respond` node.
   - Replace `toolsCondition` with custom router function.
   - Add `"respond" → "__end__"` edge.
4. Update system prompt seed: instruct LLM to call `respond` as final action.
5. Unit tests: mock LLM returning a `respond` tool call with `responseMode: "audio"`, verify `brainOutput` is correctly parsed.
6. Verify across providers: run with `LLM_PROVIDER=anthropic` and `LLM_PROVIDER=openai`.

---

## Component Summary

| Component | Action | File | Notes |
|-----------|--------|------|-------|
| `BrainRunner._compileGraph()` | MODIFY | `packages/core/src/runner/runner.ts` | Add MCP conditional block + tool merge |
| `BrainRunner.close()` | ADD | `packages/core/src/runner/runner.ts` | Calls `mcpClient?.close()` |
| `MCPClientManager` / `initMCPClient` | ADD | `packages/core/src/mcp/manager.ts` | ENV → MultiServerMCPClient |
| `createRespondTool` | ADD | `packages/core/src/tools/respond.ts` | Schema-as-tool for responseMode |
| `IBrain` interface | NO CHANGE | `packages/core/src/brain/interface.ts` | `ctx.tools` field unchanged |
| `BrainBuildContext` | NO CHANGE | `packages/core/src/brain/interface.ts` | MCP tools arrive via existing `tools` field |
| `BrainStateAnnotation` | NO CHANGE | `packages/ai/src/graph/state.ts` | `brainOutput` field already exists |
| `createLLM` factory | NO CHANGE | `packages/ai/src/llm/factory.ts` | Multi-provider already handled via ENV |
| `qualifier.ts` | FIX | `apps/brain-sdr/src/qualifier.ts` | Add `prepare: false` (TD-01) |
| `brain-sdr buildGraph()` | MODIFY | `apps/brain-sdr/src/brain.ts` | Add MCP tools to ToolNode+bindTools; add respond tool + respond node + custom router; remove inline brainOutput |
| SIGTERM handler | ADD | `apps/brain-sdr/src/index.ts` | Calls `runner.close()` |

---

## Open Questions

1. **System prompt update for `respond` tool.** The LLM must know to call `respond` as its final action. The `system` prompt needs explicit instruction. Example addition: "After reasoning and any tool use, you MUST call the `respond` tool with your final answer and the appropriate responseMode (text, audio, image, video, or document)." This is a prompt engineering concern, planned for the same phase as responseMode.

2. **MCP tool name prefixing.** `MultiServerMCPClient` supports `prefixToolNameWithServerName: true` to namespace tools. The `MCP_TOOLS` whitelist must match whatever naming convention is used. Recommendation: default to no prefix (bare tool names), since `MCP_TOOLS=getAvailableDate,schedule_meeting` is simpler for operators.

3. **`MCP_TOOLS` when empty or `*`.** If `MCP_TOOLS` is unset or `"*"`, all tools from the MCP server are loaded. If set to a CSV, only matching tools are passed to `ctx.tools`. Need to decide and document the default behavior. Recommendation: `MCP_TOOLS` required when `MCP_URL` is set; fail-fast if empty.

4. **Graceful degradation if MCP server unreachable.** If `MCP_URL` is set but the server is down at startup, `client.getTools()` will throw. Decision: fail-fast (same pattern as missing `DATABASE_URL`) or warn and continue without MCP tools? Recommendation: fail-fast at startup; MCP tools being absent would silently break the Brain's advertised capabilities.

5. **`respond` tool and context window.** Adding `respond` as a tool call adds overhead to messages (AIMessage with `tool_calls` + a ToolMessage with the args). At `CONTEXT_WINDOW_MESSAGES=40`, this is acceptable but worth monitoring in production.

---

## Sources

- `@langchain/mcp-adapters` npm: https://www.npmjs.com/package/@langchain/mcp-adapters (v1.1.3)
- LangChain MCP adapters JS GitHub: https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters
- LangChain MCP official docs (JS): https://docs.langchain.com/oss/javascript/langchain/mcp
- LangChain MCP adapters announcement: https://changelog.langchain.com/announcements/mcp-adapters-for-langchain-and-langgraph
- LangChain.js issue #7757 — bindTools + withStructuredOutput conflict (OPEN, triage: high-impact): https://github.com/langchain-ai/langchainjs/issues/7757
- LangGraph issue #5872 — schema-as-tool pattern for structured output in ReAct agents: https://github.com/langchain-ai/langgraph/issues/5872
- LangGraph how-to: respond in format: https://www.baihezi.com/mirrors/langgraph/how-tos/respond-in-format/index.html
- DeepWiki: LangChain.js response format and structured output: https://deepwiki.com/langchain-ai/langchainjs/3.4-response-format-and-structured-output
- LangChain forum: withStructuredOutput + bindTools conflict: https://forum.langchain.com/t/make-a-llm-with-structured-output-call-a-tool/622
