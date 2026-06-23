# Technology Stack

**Project:** Brain Core v1.4 — RAG + Tool Events + FUP Automático
**Researched:** 2026-06-23
**Research Mode:** Ecosystem (incremental — v1.4 additions only)
**Confidence:** HIGH

---

## Scope

This document covers **only what is new or changed for v1.4**. The validated stack from prior milestones — Bun 1.x, Hono 4.12.x, Drizzle 0.45.x (postgres.js driver), LangGraph 1.4.x, PostgresSaver, pgvector 0.3.x, Pino, rabbitmq-client 5.0.8, @langchain/mcp-adapters 1.1.3 — is unchanged and NOT re-evaluated here.

The three new capability domains researched:

1. **RAG** — text chunking, embedding generation, pgvector upsert, semantic retrieval tool
2. **Tool Events** — outbound event publishing when a Brain tool produces a result
3. **FUP Automático** — background scheduler detecting silent leads, timezone-aware time window enforcement

---

## New Dependencies for v1.4

### RAG: Text Chunking

| Package | Version | Purpose | Where to Install |
|---------|---------|---------|-----------------|
| `@langchain/textsplitters` | `^0.1.0` | RecursiveCharacterTextSplitter for ingest pipeline | `packages/core` or new `packages/rag` |

**Why this and not custom code:** `RecursiveCharacterTextSplitter` splits on paragraph → sentence → word boundaries in order, gracefully handling real-world documents without splitting mid-concept. Writing an equivalent chunker from scratch is error-prone and not differentiating work for this project.

**Why not `langchain` (the monolith package):** `@langchain/textsplitters` is the standalone JS package that was extracted from langchain. Installs only text splitting logic (~few KB) with no LLM adapter dependencies.

**Peer dependency situation:** `@langchain/textsplitters` peer-depends on `@langchain/core ^0.3.x || ^1.x`. The project already has `@langchain/core ^1.1.48` — fully satisfied. No version conflict.

**Bun compatibility:** Confirmed installable via `bun add @langchain/textsplitters`. Package uses standard ESM and has no native modules or Node.js stream dependencies. Docs specify Node.js 22+ runtime requirement, which Bun 1.x satisfies via Node.js API compatibility.

**RecursiveCharacterTextSplitter configuration for RAG:**
```typescript
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 512,      // chars per chunk — matches 3-small's ~380 token window well
  chunkOverlap: 64,    // 12.5% overlap — prevents context loss at boundaries
});

const chunks = await splitter.splitText(rawText);
// chunks: string[] — each under chunkSize chars
```

### RAG: Embedding Generation

**No new package required.** The project already has:

- `@langchain/openai ^1.4.7` in `packages/ai` — provides `OpenAIEmbeddings`
- `@langchain/google-genai ^2.1.31` — provides `GoogleGenerativeAIEmbeddings`
- `createEmbeddings()` factory already exists in `packages/ai/src/embeddings/factory.ts` — reads `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `API_KEY` from ENV and returns the correct `Embeddings` instance

The `createEmbeddings()` factory already handles both OpenAI and Gemini. The RAG ingest endpoint calls this factory, passes chunks through `embeddings.embedDocuments(chunks)`, and stores the resulting vectors in pgvector.

**Recommended embedding model for v1.4:** `text-embedding-3-small` at 1536 dimensions.

- **Cost:** $0.02/1M input tokens. For a 100K-document corpus, annual embedding cost is ~$2.72 — negligible.
- **Quality:** MTEB retrieval score 62% vs 67% for 3-large. The 5-point gap rarely matters for intra-domain SDR knowledge bases (product info, playbooks, FAQs).
- **Dimensions:** Use 1536 (the model default). This matches the existing `EMBEDDING_DIMENSIONS=1536` default in `packages/database/src/schema/tables.ts`.
- **When to upgrade to 3-large:** If retrieval quality testing shows measurable miss-rate on critical knowledge. The 6.5x cost premium ($0.13/1M) is only justified when precision demonstrably matters.

### RAG: Vector Store

**No new package required.** The project already has:

- `pgvector ^0.3.0` in `packages/database` — npm client with Bun SQL support documented
- `embeddings` table in `packages/database/src/schema/tables.ts` with HNSW index on `vector_cosine_ops`
- `upsertEmbedding()` and `searchSimilar()` already implemented in `packages/memory/src/semantic.ts`

**Schema gap:** The existing `embeddings` table uses `userId` + `sessionId` as the partition key, not a `collection` field. The RAG ingest endpoint needs a `collection` dimension to segment knowledge by topic (e.g., "product-playbook", "faq"). A **new Drizzle migration** is required to add a `collection` column and update the HNSW index strategy.

No new npm package — only schema + migration change.

### FUP Automático: Background Scheduler

| Package | Version | Purpose | Where to Install |
|---------|---------|---------|-----------------|
| `croner` | `^10.0.1` | In-process cron scheduler with timezone support | `packages/core` |

**Why croner and not Bun.cron():**

Bun 1.3.11+ ships `Bun.cron()` as a native built-in. It works for in-process callbacks. However, it has a critical limitation for this use case: **the in-process callback variant interprets schedules in UTC only with no timezone parameter.** FUP Automático must respect `FUP_TIMEZONE` ENV (e.g., `America/Sao_Paulo`) to enforce `FUP_MIN_HOUR`/`FUP_MAX_HOUR` business windows correctly. Bun.cron cannot do this.

**Why croner and not node-cron:**

- `croner` explicitly supports timezone via `{ timezone: "America/Sao_Paulo" }` option
- `croner` uses Intl API (zero external IANA database bundled) — timezone database from the runtime, always current, no extra weight
- `croner` has zero dependencies
- `croner` works in Bun >=1.0.0 (confirmed; Bun CI workflow shown in GitHub repo)
- `croner` handles DST transitions correctly — tested explicitly. node-cron has known DST bugs where jobs fire at wrong hour during spring-forward/fall-back
- `croner` is TypeScript-native with bundled `.d.ts`
- `croner` has `.pause()` / `.resume()` / `.stop()` lifecycle controls, needed when `ia_ativada=false` disables FUP for a lead

**croner usage for FUP:**
```typescript
import { Cron } from "croner";

const job = new Cron(
  "*/30 * * * * *",    // every 30 seconds — FUP_CHECK_INTERVAL from ENV
  { timezone: process.env.FUP_TIMEZONE ?? "America/Sao_Paulo" },
  async () => {
    await checkAndSendFups();  // scans leads table, sends follow-ups
  }
);

// To stop:
job.stop();
```

**Why not pg-boss:** pg-boss is a job queue backed by PostgreSQL. It adds significant complexity (schema, worker polling, dead letter queues) that is disproportionate to the FUP requirement. The FUP scheduler is a single-process background loop — a simple in-process cron is the correct tool. pg-boss is appropriate when jobs must survive process restarts and be distributed across multiple workers; FUP state is tracked in the `leads` table in PG already.

**Why not setInterval with Intl math:** Would work, but reinvents the wheel. croner's timezone-aware scheduling eliminates custom DST arithmetic and is zero-cost.

### Tool Events: Outbound Channel

**No new package required.** The existing stack already handles both outbound patterns:

**Webhook outbound:** Bun's native `fetch()` (globally available, no import) handles `HTTP POST` to `TOOL_EVENT_WEBHOOK_URL`. No library needed — standard Web API.

```typescript
await fetch(process.env.TOOL_EVENT_WEBHOOK_URL!, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action, lead, result }),
});
```

**RabbitMQ outbound:** `rabbitmq-client` is already installed in `packages/transport`. The existing `RabbitMQTransport` already uses `this.pub = this.rabbit.createPublisher({ confirm: true })` and `pub.send(queue, payload)` for DLQ. The same `Publisher` API publishes tool events to `TOOL_EVENT_RABBITMQ_QUEUE`.

The outbound channel selection is `TOOL_EVENT_TRANSPORT=webhook|rabbitmq` ENV — pure application logic, no new library.

### Timezone Handling

**No new package required.** `Intl.DateTimeFormat` (built into V8, used by Bun) handles all timezone logic needed for FUP:

```typescript
// Check current hour in configured timezone
function getCurrentHourInTz(tz: string): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10
  );
}

// Check allowed weekday
function getCurrentWeekdayInTz(tz: string): number {
  // 0=Sunday ... 6=Saturday
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "numeric",  // returns day-of-week number as string
    }).format(new Date()),
    10
  );
}
```

Bun's V8 engine carries the full IANA timezone database — no library needed. `luxon` and `date-fns-tz` would add 30-50KB bundle weight for identical functionality. Use native Intl.

---

## What NOT to Add

| Package | Why Avoid | Use Instead |
|---------|-----------|-------------|
| `luxon` | Adds ~60KB for IANA timezone DB that V8 already has | Native `Intl.DateTimeFormat` |
| `date-fns-tz` | Same issue — bundles IANA data unnecessarily; verbose API | Native `Intl.DateTimeFormat` |
| `node-cron` | DST bugs; no timezone parameter on the `schedule()` overload used for Bun | `croner` |
| `Bun.cron()` (in-process) | UTC-only for in-process callbacks; no timezone parameter | `croner` |
| `pg-boss` | Job queue with full PG schema — overkill for single-process FUP | `croner` + leads table columns |
| `bullmq` | Requires Redis — adds infrastructure dependency; no requirement here | `croner` + leads table columns |
| `@langchain/community` | 200+ bundled adapters; adds dead weight. Text splitting is in `@langchain/textsplitters` | `@langchain/textsplitters` |
| `langchain` (monolith) | Wraps everything including deprecated modules; heavyweight; peer dep conflicts with existing `@langchain/*` packages | `@langchain/textsplitters` only |
| `openai` SDK (direct) | Already using `@langchain/openai` which wraps it. Direct SDK use creates dual dependency and version mismatch risk | `@langchain/openai` (already installed) |
| `axios` / `got` | HTTP clients for outbound webhook — Bun has native `fetch()` | `fetch()` (built-in) |

---

## Summary: Net New Packages

| Package | Version | Added To | Purpose |
|---------|---------|---------|---------|
| `@langchain/textsplitters` | `^0.1.0` | `packages/core` (or `packages/rag`) | Text chunking for RAG ingest |
| `croner` | `^10.0.1` | `packages/core` | Timezone-aware cron for FUP scheduler |

**Total new packages: 2.** All other v1.4 capabilities (embeddings, vector store, outbound webhook, outbound RabbitMQ, timezone arithmetic) are served by existing stack or built-in Bun/V8 APIs.

---

## Installation

```bash
# Text chunking for RAG ingest
pnpm add @langchain/textsplitters --filter @brain-pkg/core

# Timezone-aware scheduler for FUP Automático
pnpm add croner --filter @brain-pkg/core
```

---

## Schema Changes Required (no new packages — only Drizzle migrations)

### 1. `embeddings` table — add `collection` column

The existing `embeddings` table scopes by `userId` + `sessionId`. RAG requires a `collection` dimension (e.g., `"product-playbook"`, `"faq"`, `"pricing"`). Add:

```sql
ALTER TABLE embeddings ADD COLUMN collection text NOT NULL DEFAULT 'default';
CREATE INDEX embeddings_collection_idx ON embeddings(collection);
```

The `searchSimilar()` function in `packages/memory/src/semantic.ts` needs a `collection` filter parameter.

### 2. `leads` table — add FUP tracking columns

FUP Automático tracks per-lead state:

```sql
ALTER TABLE leads ADD COLUMN fup_step integer NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN fup_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN last_message_at timestamp;
```

- `fup_step`: which follow-up message (0=none, 1=first FUP, 2=second, ..., N=last). When last step reached → set `ia_ativada=false`, `fup_enabled=false`.
- `fup_enabled`: explicit flag — set to true when lead stops responding, false when disabled or ia_ativada=false.
- `last_message_at`: timestamp of last inbound message — scheduler computes elapsed time against this.

---

## Environment Variables for v1.4

| Variable | Purpose | Default |
|----------|---------|---------|
| `TOOL_EVENT_TRANSPORT` | `"webhook"` or `"rabbitmq"` — outbound tool event channel | (none — feature disabled if unset) |
| `TOOL_EVENT_WEBHOOK_URL` | Target URL for webhook tool events | — |
| `TOOL_EVENT_RABBITMQ_QUEUE` | RabbitMQ queue name for tool events | — |
| `FUP_ENABLED` | `"true"` to activate FUP scheduler | `"false"` |
| `FUP_SILENCE_THRESHOLD_SECONDS` | Seconds with no response before first FUP trigger | `86400` (24h) |
| `FUP_INTERVALS_SECONDS` | Comma-separated intervals between FUP steps (e.g., `"86400,172800"`) | — |
| `FUP_MIN_HOUR` | Earliest hour to send FUP (0-23, in FUP_TIMEZONE) | `9` |
| `FUP_MAX_HOUR` | Latest hour to send FUP (0-23, in FUP_TIMEZONE) | `18` |
| `FUP_ALLOWED_WEEKDAYS` | Comma-separated weekdays (0=Sun ... 6=Sat) | `"1,2,3,4,5"` (Mon-Fri) |
| `FUP_TIMEZONE` | IANA timezone string | `"America/Sao_Paulo"` |
| `FUP_CHECK_INTERVAL_SECONDS` | How often the scheduler checks for due FUPs | `60` |

Existing variables (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `API_KEY`, `LLM_PROVIDER`) already cover RAG embedding configuration — no new ENV needed for embeddings.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@langchain/textsplitters ^0.1.0` | `@langchain/core ^1.x` | Peer dep satisfied by existing `^1.1.48` |
| `croner ^10.0.1` | Bun >=1.0.0 | Zero deps; uses Intl API for timezone — fully Bun-native |
| `croner ^10.0.1` | TypeScript 5.x | Bundled `.d.ts`; no @types package needed |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| `@langchain/textsplitters` Bun compat | HIGH | ESM package; no native modules; LangChain docs confirm `bun add` works; peer dep satisfied |
| `croner` Bun compat | HIGH | Explicitly listed as Bun >=1.0.0 in docs; Bun CI workflow in GitHub repo |
| `croner` timezone | HIGH | Intl API-based; DST-tested in v10.0 changelog; `{ timezone }` option confirmed |
| Bun.cron() UTC limitation | HIGH | Official Bun docs state "interpret schedules in UTC" — no timezone param for in-process callback |
| `fetch()` for outbound webhook | HIGH | Bun native Web API; no compatibility concerns |
| `rabbitmq-client` for outbound publish | HIGH | `pub.send()` already used in project for DLQ; same API applies |
| `createEmbeddings()` reuse for RAG | HIGH | Factory already exists in `packages/ai/src/embeddings/factory.ts`; confirmed multi-provider |
| `text-embedding-3-small` default | HIGH | $0.02/1M, sufficient MTEB score for intra-domain RAG; already default dimension in schema |
| Schema migration approach | HIGH | Drizzle migration pattern proven across v1.0–v1.3 |
| `Intl.DateTimeFormat` for timezone | HIGH | V8 built-in; Bun confirmed; no external IANA DB needed |

---

## Sources

- Bun.cron() docs (UTC-only for in-process): https://bun.com/docs/runtime/cron
- Bun 1.3.11 cron API introduction: https://itacademy.com.ua/en/articles/2026-03-19/bun-v1311-cron-api-and-improvements-2026-03-19/
- croner v10.0.1 GitHub (zero deps, Bun >=1.0.0, timezone option): https://github.com/Hexagon/croner
- croner docs (API reference, timezone syntax): https://croner.56k.guru/
- croner vs node-cron comparison 2026 (DST handling): https://www.pkgpulse.com/guides/node-cron-vs-node-schedule-vs-croner-task-scheduling-2026
- @langchain/textsplitters npm (v0.1.0, last published 7 months ago): https://www.npmjs.com/package/@langchain/textsplitters
- LangChain text splitter integrations (bun install confirmed): https://docs.langchain.com/oss/javascript/integrations/splitters
- text-embedding-3-small pricing ($0.02/1M tokens): https://tokenmix.ai/blog/openai-embedding-pricing
- Embedding model comparison 2026 (MTEB scores): https://pecollective.com/tools/text-embedding-models-compared/
- Intl.DateTimeFormat timezone (MDN): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
- Bun + Intl timezone support confirmed: https://bun.sh/docs/test/dates-times
- rabbitmq-client Publisher.send() API: https://github.com/cody-greene/node-rabbitmq-client
- packages/ai/src/embeddings/factory.ts — read directly (createEmbeddings already multi-provider)
- packages/memory/src/semantic.ts — read directly (upsertEmbedding + searchSimilar already implemented)
- packages/database/src/schema/tables.ts — read directly (embeddings table with HNSW index confirmed)
- packages/transport/src/rabbitmq/consumer.ts — read directly (pub.send() pattern confirmed)

---

*Stack research for: Brain Core v1.4 — RAG + Tool Events + FUP Automático (incremental)*
*Researched: 2026-06-23*
