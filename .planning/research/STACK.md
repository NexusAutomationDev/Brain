# Technology Stack

**Project:** Brain Core v1.1 — RabbitMQ Transport + Brain SDR
**Researched:** 2026-06-13
**Research Mode:** Ecosystem (incremental — v1.1 additions only)
**Confidence:** HIGH

---

## Scope

This document covers **only what is new or changed for v1.1**. The full v1.0 stack (Bun, Hono, Drizzle + postgres.js, LangGraph, PostgresSaver, pgvector, Pino, Langfuse) is validated and unchanged. Do not re-evaluate those choices.

---

## New Dependencies for v1.1

### RabbitMQ Transport

| Package | Version | Purpose | Source |
|---------|---------|---------|--------|
| `rabbitmq-client` | `^5.0.8` | RabbitMQ consumer + publisher | Installed, verified Bun-compatible |

**Recommendation: Use `rabbitmq-client` instead of `amqplib-bun`.**

The CLAUDE.md constraint names `amqplib-bun`, but the research reveals `rabbitmq-client` is the stronger choice for v1.1:

- `amqplib-bun` v0.10.4 still carries legacy dependencies: `readable-stream@1.x`, `buffer-more-ints@1.0.x`, `url-parse`. These are Node.js compatibility shims that create unnecessary surface area in Bun.
- `rabbitmq-client` v5.0.8 has **zero production dependencies** — pure TypeScript compiled to CJS. Confirmed imports cleanly in Bun 1.3.2 (`import { Connection } from 'rabbitmq-client'` works without errors).
- `rabbitmq-client` v5.0.3+ explicitly supports RabbitMQ 4.1.x+. `amqplib-bun` v0.10.4 is based on amqplib 0.10 which also supports RabbitMQ 4.1 (amqplib >= 0.10.7 requirement from RabbitMQ 4.1.0 release notes).
- `rabbitmq-client` provides a high-level `Consumer` / `Publisher` API with **built-in auto-reconnect**, which is critical for a production transport layer. Raw `amqplib-bun` requires hand-rolling reconnect logic.
- The `node:stream` compatibility issue (Bun issue #5627, still open) that affects `amqplib-bun` does not affect `rabbitmq-client` since it uses its own frame parser.

**If the team decides to keep `amqplib-bun`** for constraint compliance, the reconnect pattern must be implemented manually (see Integration Points below). `rabbitmq-client` eliminates this work.

**Package to add to `packages/transport/package.json`:**
```bash
pnpm add rabbitmq-client --filter @brain-pkg/transport
```

---

## Version Changes

### No version bumps required

All currently installed packages in the project lock file are at the correct versions:

| Package | Installed | Status |
|---------|-----------|--------|
| `@langchain/langgraph` | 1.4.1 | Current — no bump needed |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.3 | Current — no bump needed |
| `drizzle-orm` | 0.45.2 | Stable — no bump needed (v1.0 RC not recommended) |
| `drizzle-kit` | 0.31.10 | Current stable |
| `postgres` | 3.4.9 | Current — no bump needed |
| `zod` | 3.23.8 | Current — no bump needed |
| `hono` | 4.12.x | Current — no bump needed |

No additional LangChain packages (`@langchain/community`, etc.) are needed for Brain SDR. All SDR tools are custom `StructuredTool` implementations using the already-installed `@langchain/core`.

---

## What NOT to Add

| Package | Why to Avoid |
|---------|-------------|
| `amqplib` (vanilla) | Bun incompatibility — open issues #4791 and #5627 for connection failures and invalid frame errors on large messages |
| `amqp-connection-manager` | Wraps `amqplib` — inherits all its Bun issues; depends on the broken base |
| `@langchain/community` | Not needed for Brain SDR. Adds 200+ optional integrations as dead weight. All SDR tools are custom. |
| `bull` / `bullmq` | Adds Redis dependency; not a requirement for v1.1 |
| Any stream-dependent AMQP lib | Bun's `node:stream` implementation has open compatibility bugs as of June 2026 |

---

## Integration Points

### 1. RabbitMQ Transport — `packages/transport`

The ITransport interface already exists. The RabbitMQ implementation slot is the `default` case in the factory that currently throws `ConfigurationError`. The integration path:

**Factory change (`packages/transport/src/factory.ts`):**
```typescript
case "rabbitmq":
  return new RabbitMQTransport();
```

**RabbitMQ transport shape (using `rabbitmq-client`):**
```typescript
import { Connection } from 'rabbitmq-client';

export class RabbitMQTransport implements ITransport {
  private conn: Connection | undefined;

  async start(): Promise<void> {
    this.conn = new Connection(process.env.RABBITMQ_URL!);
    const consumer = this.conn.createConsumer(
      { queue: process.env.RABBITMQ_QUEUE! },
      async (msg) => {
        // Parse BrainEvent from msg.body
        // Call runner.run(event)
        // Ack/nack inside this callback
      }
    );
    // consumer handles reconnect internally — no manual retry loop needed
  }

  async stop(): Promise<void> {
    await this.conn?.close();
  }
}
```

**Key difference from WebhookTransport:** RabbitMQ messages are acked/nacked in the consumer callback, not returned over HTTP. The runner injection problem (GAP-1) that affects WebhookTransport also applies here — the runner must be injected into RabbitMQTransport at construction time.

### 2. BrainEvent Schema Change — `packages/transport/src/webhook/events.ts`

The current schema uses `conversationId`, `stepIndex`, `userId`, `content`. The v1.1 spec introduces standardized fields: `Name`, `Message`, `Numero`, `IDLead`. This is a **breaking schema change** affecting both WebhookTransport and RabbitMQTransport.

**Decision required by roadmap:** Whether to replace the existing fields or add a compatibility layer. Recommendation: replace `userId` with `IDLead` (as the unique lead identifier), `content` with `Message`, map `Name` and `Numero` into the event. The `conversationId` can be derived from `Numero` or `IDLead` for thread continuity.

No new package is needed — this is a `zod` schema change in the existing file.

### 3. Leads Schema Migration — `packages/database`

The `users` table (DB-01) is replaced by `leads`. The migration pattern already works correctly:

- `migrate()` from `drizzle-orm/postgres-js/migrator` is already used in `packages/database/src/migrate.ts`
- Auto-migrate at Brain startup is already called in `apps/brain-echo/src/index.ts`
- The new migration is a standard Drizzle-generated SQL file added to `packages/database/src/migrations/`

The `leads` table needs these columns: `id` (uuid, pk), `unique_id` (text, unique — maps to `IDLead`), `nome` (text), `numero` (text, unique), `ia_ativada` (boolean, default true), `fullpp` (text, nullable), `created_at`, `updated_at`.

No new packages. Only schema file + migration file changes.

### 4. Brain SDR Implementation — `apps/brain-sdr`

Brain SDR follows the exact pattern established by `apps/brain-echo`. It implements the `IBrain` interface from `@brain-pkg/core`. All required packages are already in the workspace.

**SDR-specific tools are custom `StructuredTool` instances using `@langchain/core/tools`:**
- `RegisterLeadTool` — inserts/updates lead in the `leads` table via drizzle
- `CheckIAAtivadaTool` — reads `ia_ativada` flag from `leads` table
- `GetConversationHistoryTool` — retrieves memory via existing `MemoryManager`

No new packages. The `StructuredTool` base class and tool calling interface are provided by the already-installed `@langchain/core@1.1.48`.

### 5. WebhookTransport GAP-1 Fix

The `WebhookTransport.start()` creates a Hono app without runner injection:
```typescript
// Current (broken):
const app = createWebhookApp(); // runner is undefined → fallback path in production
```

Fix requires changing the constructor to accept an `IBrainRunnerLike` parameter and storing it for use in `start()`. This is purely a code change — no new packages.

---

## Environment Variables for v1.1

| Variable | Purpose | Used By |
|----------|---------|---------|
| `TRANSPORT` | `"webhook"` or `"rabbitmq"` (default: `"webhook"`) | `packages/transport/src/factory.ts` |
| `RABBITMQ_URL` | AMQP connection string (e.g., `amqp://user:pass@host:5672`) | `RabbitMQTransport` |
| `RABBITMQ_QUEUE` | Queue name to consume from | `RabbitMQTransport` |

Existing variables (`DATABASE_URL`, `OPENAI_API_KEY`, `LANGCHAIN_*`) are unchanged.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| `rabbitmq-client` Bun compatibility | HIGH | Tested: `import { Connection } from 'rabbitmq-client'` in Bun 1.3.2 — no errors |
| `rabbitmq-client` vs `amqplib-bun` | HIGH | Direct package inspection: zero deps vs legacy shims; auto-reconnect built-in |
| No new LangChain packages for SDR | HIGH | Reviewed IBrain interface + BrainBuildContext — StructuredTool from @langchain/core covers all SDR tool needs |
| Schema migration (Drizzle) | HIGH | Existing `migrate()` pattern already works; confirmed in `packages/database/src/migrate.ts` |
| No version bumps required | HIGH | pnpm lock file reviewed — all packages at current stable versions |
| Leads schema design | MEDIUM | Field names match PROJECT.md spec; `ia_ativada` flag logic is straightforward Drizzle query |

---

## Sources

- `rabbitmq-client` v5.0.8 installed and tested in Bun 1.3.2 — zero deps, Bun import confirmed
- `amqplib-bun` v0.10.4 — package.json inspected: still uses `readable-stream@1.x` and `buffer-more-ints@1.0.x`
- Bun issue #5627 (invalid frame in amqplib) — confirmed still open as of June 2026
- `amqplib` v2.0.1 GitHub releases — removed `buffer-more-ints`, now uses BigInt; but vanilla amqplib still has Bun stream issues
- `rabbitmq-client` GitHub: v5.0.3+ required for RabbitMQ 4.1.x support
- pnpm-lock.yaml reviewed: langgraph@1.4.1, checkpoint-postgres@1.0.3, drizzle-orm@0.45.2 all confirmed installed
- `packages/database/src/migrate.ts` — confirmed programmatic `migrate()` from `drizzle-orm/postgres-js/migrator` already implemented and working
- `packages/core/src/brain/interface.ts` — confirmed `StructuredTool` from `@langchain/core/tools` covers SDR tool requirements

---

*Stack research for: Brain Core v1.1 — RabbitMQ transport + Brain SDR (incremental)*
*Researched: 2026-06-13*

---

---

# Stack Research: v1.3 MCP Integration + Dynamic responseMode

**Researched:** 2026-06-15
**Scope:** New dependencies only — existing stack (Bun, Hono, LangGraph, Drizzle, postgres.js, pgvector, rabbitmq-client, Pino, Langfuse) is validated and unchanged.

---

## New Dependencies Needed

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@langchain/mcp-adapters` | `^1.1.3` | Convert MCP server tools into LangGraph-compatible `StructuredTool[]` | Official LangChain adapter; peer deps (`@langchain/core ^1.0.0`, `@langchain/langgraph ^1.3.4`) already satisfied by project; supports Streamable HTTP and SSE — both used by n8n MCP Server Trigger |
| `@langchain/anthropic` | `^1.4.0` | Anthropic Claude provider with `.withStructuredOutput()` | **ALREADY INSTALLED** in `packages/ai/package.json` at `^1.4.0` (latest: 1.4.1 as of June 2026); no upgrade needed |

**Total new packages: 1** (`@langchain/mcp-adapters`).

The `@modelcontextprotocol/sdk` (`^1.29.0`) is a direct dependency of `@langchain/mcp-adapters` and installs automatically as a transitive dep — do not add it explicitly.

### Where to Install

```bash
# packages/ai is where @langchain/langgraph and @langchain/core live
cd packages/ai
bun add @langchain/mcp-adapters
```

---

## MCP Transport Protocol

### What n8n MCP Server Trigger Exposes

n8n's MCP Server Trigger node exposes HTTP endpoints. The transport evolved across n8n versions:

| n8n Version | Transport | Endpoint Pattern |
|-------------|-----------|-----------------|
| Pre-v1.99 | SSE (HTTP+SSE, deprecated) | `/mcp/{id}/sse` |
| v1.99+ (current, 2026) | Streamable HTTP | `/mcp/{id}` (no `/sse` suffix) |

**The `/sse` postfix was removed in n8n v1.99** as part of the MCP spec migration to Streamable HTTP (spec revision 2025-03-26). The URL shown in the n8n trigger panel is used as-is — no manual modification required.

The MCP Server Trigger node also still supports SSE for backward compatibility with older MCP clients.

### Connecting from LangGraph via `MultiServerMCPClient`

`@langchain/mcp-adapters` exports `MultiServerMCPClient` which supports three transport types: `stdio`, `sse`, and `http` (Streamable HTTP). For n8n:

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

// Streamable HTTP — correct for n8n v1.99+ (2026 default)
const client = new MultiServerMCPClient({
  mcpServers: {
    n8n: {
      transport: "http",                     // Streamable HTTP
      url: process.env.MCP_URL!,            // e.g. https://n8n.example.com/mcp/abc123
      headers: {
        Authorization: `Bearer ${process.env.MCP_TOKEN}`,
      },
      automaticSSEFallback: true,           // auto-fallback to SSE if server signals it
    },
  },
});

// Returns StructuredTool[] — plug directly into LangGraph ToolNode
const mcpTools = await client.getTools();
```

For older n8n instances (pre-v1.99), use `transport: "sse"` and append `/sse` to the URL.

### ENV-Driven Tool Filtering (`MCP_TOOLS`)

The v1.3 requirement specifies `MCP_TOOLS` ENV as a whitelist. Pure application logic, no extra packages:

```typescript
const allMcpTools = await client.getTools();
const allowed = (process.env.MCP_TOOLS ?? "").split(",").filter(Boolean);
const tools = allowed.length > 0
  ? allMcpTools.filter(t => allowed.includes(t.name))
  : allMcpTools;

// Register into LangGraph ToolNode alongside existing tools
const toolNode = new ToolNode([...existingTools, ...tools]);
```

### `MultiServerMCPClient` Lifecycle Notes

- **Stateless by default**: Each tool invocation creates a fresh MCP session, executes the tool, then closes. Good for the Brain's per-message execution model.
- **Startup cost**: `getTools()` must be called before the graph runs — do it in `BrainRunner.init()` (or `IBrain.init()`), not on each message.
- **Connection caching**: If MCP_URL is set, init the client once in startup; if unset, skip MCP tool registration entirely.

---

## Provider Compatibility for `.withStructuredOutput()`

### Status

Both `ChatOpenAI` and `ChatAnthropic` implement `.withStructuredOutput()` with Zod schemas. The call signature is identical across providers. The internal implementation differs but the behavior is equivalent for Zod schemas with the default method.

### Method Options Comparison

| Method | OpenAI | Anthropic | Recommendation |
|--------|--------|-----------|----------------|
| `"functionCalling"` (default, no option needed) | Tool-call with JSON output | Forces `tool_choice: {type: "tool", name: ...}` | **Use this** — most reliable cross-provider |
| `"jsonSchema"` | Native Structured Outputs (`strict: true`) | Anthropic native structured output, no `strict` | Avoid for cross-provider code — subtle differences |
| `"jsonMode"` | `response_format: {type: "json_object"}` | Not supported | Never use for Anthropic |

**Use the default (no explicit `method` option).** Both providers fall through to `"functionCalling"` which works reliably with Zod schemas.

### Zod Schema for `BrainOutput` with `responseMode`

```typescript
import { z } from "zod";

// In packages/shared or packages/core — BrainOutputSchema
const BrainOutputSchema = z.object({
  fullResponse: z.string().describe("Complete response text to deliver to the user"),
  responseMode: z.enum(["text", "audio", "image"]).describe(
    "Output format chosen by the model: text for messages, audio for voice, image for visual content"
  ),
  // ...other existing BrainOutput fields
});

// Usage — identical for OpenAI and Anthropic:
const structuredLlm = model.withStructuredOutput(BrainOutputSchema, {
  name: "BrainOutput",  // REQUIRED for Anthropic — see gotchas below
});
```

### Cross-Provider Gotchas

**1. Always pass `name` option for Anthropic (HIGH priority)**
Without `{ name: "SchemaName" }`, older Anthropic versions generate a generic tool name. In `@langchain/anthropic ^1.4.x` it should default cleanly, but passing `name` explicitly is required for reliability across both providers.

**2. Make `responseMode` required, not optional**
`z.enum(["text","audio","image"]).optional()` causes incomplete outputs on Anthropic — the model may omit the field when it's optional, producing a Zod validation error. The field must be required in the schema.

**3. Do not combine `method: "jsonSchema"` with `strict: true`**
In `@langchain/anthropic ^1.4.x`, passing `strict: true` together with `method: "jsonSchema"` throws. This is not a concern if using the default method (which is the recommendation).

**4. Model must support tool calling**
`.withStructuredOutput()` requires a model with tool-calling capability. Confirmed working: GPT-4o, GPT-4 Turbo, Claude 3+ (all variants including Haiku 3.5). Claude 2.x does NOT support tool calling — avoid if targeting older Claude.

**5. No Bun-specific issues**
LangChain providers use standard `fetch` API for all provider calls. Bun's native `fetch` is fully compatible. No shims or workarounds needed.

### Version Alignment (already satisfied)

```
packages/ai/package.json — current state:
  @langchain/anthropic:  ^1.4.0   ← current (1.4.1 latest June 2026)
  @langchain/core:       ^1.1.48  ← satisfies peer dep ^1.0.0
  @langchain/langgraph:  ^1.4.1   ← satisfies peer dep ^1.3.4
  @langchain/openai:     ^1.4.7   ← current
```

No version bumps required for structured output functionality.

---

## Bun Runtime Risk: MCP SSE Transport Startup Latency

**Severity: MEDIUM — mitigated by using Streamable HTTP transport.**

Open Bun issue (#22396, reported September 2025, unresolved as of June 2026): `SSEClientTransport` startup takes ~15 seconds in Bun vs ~130ms in Node.js. Root cause is Bun's `EventSource` implementation behavior under the `@modelcontextprotocol/sdk`'s SSE client.

**Mitigation:** Use `transport: "http"` (Streamable HTTP) in `MultiServerMCPClient`, never `transport: "sse"`. Streamable HTTP uses standard `fetch` (not `EventSource`), which Bun handles at full native speed. The `@modelcontextprotocol/sdk` v1.29.0 explicitly confirms Bun support for its Streamable HTTP transport.

Since n8n v1.99+ exposes Streamable HTTP at `/mcp/{id}` by default, this risk is **neutralized** — the correct transport is also the performant one. Only a risk if connecting to an older n8n instance.

---

## What NOT to Add

| Library | Why Avoid |
|---------|-----------|
| `@modelcontextprotocol/sdk` (direct dep) | Transitively installed by `@langchain/mcp-adapters`; adding directly risks version conflict |
| `mcp` (older npm package) | Pre-standard, effectively unmaintained; replaced by `@modelcontextprotocol/sdk` |
| `n8n-nodes-mcp` | Community node for n8n *consuming* MCP servers — wrong direction; we are the MCP client, not n8n |
| `@h1deya/langchain-mcp-tools` | Third-party alternative; use the official `@langchain/mcp-adapters` |
| `@langchain/community` | Not needed — MCP adapter is in `@langchain/mcp-adapters`, not community |
| Direct `zod` version change | `@langchain/mcp-adapters` requires `zod "^3.25.76 || ^4"`; project uses `^4.4.3` — already satisfied |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| `@langchain/mcp-adapters` version (1.1.3) | HIGH | npm package page confirmed; GitHub package.json confirmed |
| n8n Streamable HTTP default (v1.99+) | MEDIUM | n8n community thread confirmed; official docs partially loaded |
| Streamable HTTP transport config API | HIGH | GitHub source (client.ts) inspected; `transport: "http"` with `url` and `headers` confirmed |
| `@langchain/anthropic` version (1.4.x) | HIGH | npm confirmed; `packages/ai/package.json` read directly |
| `.withStructuredOutput()` cross-provider | MEDIUM | LangChain docs + GitHub issues reviewed; default `functionCalling` method confirmed working; some historical issues exist with `jsonSchema` method |
| Bun SSE latency risk | HIGH | Bun issue #22396 confirmed; mitigation via Streamable HTTP confirmed |
| `name` option requirement for Anthropic | MEDIUM | Referenced in multiple sources; best practice confirmed |

---

## Sources

- `@langchain/mcp-adapters` npm (v1.1.3): https://www.npmjs.com/package/@langchain/mcp-adapters
- `@langchain/mcp-adapters` source (client.ts transport types): https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-mcp-adapters/src/client.ts
- LangChain MCP docs (JS): https://docs.langchain.com/oss/javascript/langchain/mcp
- LangChain MCP streamable HTTP announcement: https://changelog.langchain.com/announcements/mcp-with-streamable-http-transport
- `@langchain/anthropic` npm (v1.4.1, June 2026): https://www.npmjs.com/package/@langchain/anthropic
- `@langchain/anthropic` withStructuredOutput reference: https://reference.langchain.com/javascript/langchain-anthropic/ChatAnthropic
- `@modelcontextprotocol/sdk` GitHub (v1.29.0, Bun-compatible): https://github.com/modelcontextprotocol/typescript-sdk
- Bun MCP SSE startup latency (open issue): https://github.com/oven-sh/bun/issues/22396
- n8n MCP Server Trigger docs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/
- n8n community — /sse removed in v1.99: https://community.n8n.io/t/why-doesnt-the-mcp-trigger-node-url-include-sse-endpoint-v1-99-1-deployed-on-hostinger/145518
- MCP spec: SSE deprecated, Streamable HTTP standard (March 2025): https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-went-with-streamable-http/
- Anthropic structured output issue (langchain #30158): https://github.com/langchain-ai/langchain/issues/30158
- `packages/ai/package.json` — read directly (confirmed installed versions)

---

*Stack research for: Brain Core v1.3 — MCP Integration + Dynamic responseMode (incremental)*
*Researched: 2026-06-15*
