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
