# Feature Research

**Domain:** Multi-tenant LangGraph-based AI orchestration service ("bot brain")
**Researched:** 2026-05-21
**Confidence:** HIGH (Langfuse, LangGraph, RabbitMQ patterns); MEDIUM (LLM gateway industry conventions); HIGH (grounding in locked PROJECT.md scope)

---

## How to Read This File

Every feature below is annotated with:

- **In Scope / Adjacent / Out of Scope** — mapped to the locked `.planning/PROJECT.md`
- **Complexity:** S (≤ 1 dev-day), M (1–3 days), L (> 3 days, possibly multi-phase)
- **Dependencies:** other features it requires or strongly enhances
- **Phase suggestion** — for differentiators only

"Adjacent" = not in v1 Active, not in Out of Scope; a defensible v1.x add.

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are non-negotiable for a backend AI service consumed by *other developers* (bot adapter teams). Missing any of them produces frustration on first integration.

| # | Feature | Scope Mapping | Why Expected | Complexity | Notes |
|---|---------|---------------|--------------|------------|-------|
| TS-1 | **Bearer-token auth on webhook** | In Scope (Active) | Single trusted-service auth is explicitly called out; without it the webhook is unsafe | S | Static token from `.env`; constant-time compare; 401 on mismatch |
| TS-2 | **Health endpoint (`/healthz` liveness)** | Adjacent | Docker Compose, Kubernetes, and any reverse proxy expect it | S | Returns 200 if process alive; no dependency checks |
| TS-3 | **Readiness endpoint (`/readyz`)** | Adjacent | Distinguishes "process up" from "Postgres + RabbitMQ + vector DB + provider reachable"; needed for safe rolling restarts | S | Checks DB connection, RabbitMQ channel, vector DB ping; short timeouts to prevent cascading failures |
| TS-4 | **Structured error responses** | Adjacent (implied by Active) | Bot adapters need machine-parseable errors to decide retry vs surface-to-user | S | Consistent envelope: `{error: {code, message, retryable, traceId}}`; distinct codes for `BOT_NOT_FOUND`, `PROVIDER_TIMEOUT`, `ALL_PROVIDERS_FAILED`, `RATE_LIMITED`, `INVALID_PAYLOAD` |
| TS-5 | **Idempotency on webhook ingestion** | Adjacent (gap in Active) | At-least-once delivery from queues and webhook retries are universal; without an idempotency key, duplicate user messages produce duplicate LLM calls (cost + UX) | M | Client-supplied `Idempotency-Key` header (UUID per logical message); short-TTL store in Postgres returning the cached previous response on replay |
| TS-6 | **RabbitMQ message acknowledgment discipline** | In Scope (RabbitMQ ingestion is Active) | Auto-ack causes silent message loss on crash; the canonical pattern is prefetch + manual ack + nack-on-failure | M | `prefetch_count` per consumer, disable auto-ack, ack only after successful response publish, nack with requeue=false on permanent errors so DLQ catches them |
| TS-7 | **Dead-letter queue for `brain.in`** | Adjacent (gap in Active) | Poison messages will exist (malformed payloads, unknown botId); without a DLQ they either crash-loop the consumer or get silently dropped | M | DLX + DLQ + retry queue with TTL; max-retries before DLQ; structured error metadata captured on DLQ message headers |
| TS-8 | **Retry semantics with exponential backoff for provider calls** | Adjacent (gap in Active — fallback is in scope, retry is not) | Transient 429/503 from OpenAI/Gemini is common; a single retry before triggering fallback dramatically improves success rate | S | Tenacity or built-in retry: 2–3 attempts, exponential, jittered; distinguish retryable (429, 5xx, network) from non-retryable (400, 401) |
| TS-9 | **Per-request timeout configuration** | Adjacent | LLM calls hang; without a timeout a single stuck request blocks a worker indefinitely | S | Per-provider timeout from `.env`; wrap with `asyncio.wait_for`; trigger fallback on timeout |
| TS-10 | **Graceful shutdown with in-flight request drain** | Adjacent (gap in Active) | Docker Compose restart / re-deploy mid-conversation loses messages and corrupts session state | M | FastAPI lifespan + SIGTERM handler; flip readiness flag to 503; wait until active-request counter reaches 0 or grace period (~30s) expires; close RabbitMQ channels cleanly so unacked messages return to queue |
| TS-11 | **Request payload validation with clear errors** | Adjacent | Pydantic-style validation on `{botId, sessionId, conteudo}`; bad payloads should never reach the graph | S | Pydantic models; 422 with field-level errors |
| TS-12 | **Request size limit** | Adjacent | Prevents oversized `conteudo` from blowing up token budgets / DoS | S | Hard cap (e.g., 32 KB) at the FastAPI / RabbitMQ layer; reject early with a clear error |
| TS-13 | **OpenAPI / Swagger docs for webhook + CRUD APIs** | Adjacent (gap in Active) | FastAPI gives this nearly free, but RabbitMQ schemas must be documented separately; integrators cannot integrate without a contract | S | Auto-generated `/docs`; AsyncAPI doc for the RabbitMQ contract |
| TS-14 | **Per-bot system-prompt CRUD with audit log** | Partially In Scope (CRUD is Active; audit is gap) | Bots get edited in production by humans; a bad persona change must be traceable and revertable | M | Append-only `bot_audit_log` table: who/when/old_prompt/new_prompt; sufficient for v1, no UI required |
| TS-15 | **Schema versioning on input/output payloads** | Adjacent (gap in Active) | Brain will outlive any single bot adapter version; without a `schema_version` field on `brain.in` / `brain.out` and webhook payloads, breaking changes become un-shippable | S | Required `schema_version` field on every payload; refuse unknown major versions with an explicit error |
| TS-16 | **Session-isolated memory (no cross-session leakage)** | In Scope (Active) | Explicit core requirement; double-checked here because cross-session leakage is the #1 production failure mode | M | Every Postgres query and vector query filtered by `(botId, sessionId)`; integration test verifies no leak even with identical user phrasings across sessions |
| TS-17 | **Response includes traceId / Langfuse link** | Partially In Scope (Active says trace + metadata in response; Langfuse is in scope) | Integrators need to debug; a clickable Langfuse URL is what makes that fast | S | Inject `traceId` (Langfuse trace) into response envelope alongside `model`, `tokenUsage`, and the LangGraph node trace |
| TS-18 | **Configurable concurrency / connection pooling** | Adjacent | Default Postgres pool of ~5 chokes immediately under load; default RabbitMQ prefetch=1 underutilizes workers | S | `DB_POOL_SIZE`, `RABBIT_PREFETCH`, `MAX_CONCURRENT_LLM_CALLS` in `.env` |
| TS-19 | **`bot.in` / `bot.out` message correlation ID** | In Scope (Active — RabbitMQ ingestion) | Async response on a different queue is useless without a correlation ID for the adapter to match request → response | S | Use AMQP `correlation_id` property; round-trip it; also embed in response body |
| TS-20 | **Provider API-key configuration via env (no hardcoding)** | In Scope (Active — `.env` configuration constraint) | Already a stated constraint; restated here because key rotation is the operational follow-on | S | Multiple env vars supported; document the rotation procedure (restart-based for v1) |

---

### Differentiators (Competitive Advantage)

These elevate Brain above a "thin LangGraph + FastAPI wrapper." Each is mapped to either a v1 phase or a future milestone.

| # | Feature | Scope Mapping | Value Proposition | Complexity | Phase Suggestion |
|---|---------|---------------|-------------------|------------|------------------|
| D-1 | **Per-bot, per-session cost tracking via Langfuse tags** | Adjacent (extends in-scope Langfuse integration) | Operators see "which bot is burning budget" without leaving Langfuse; tagging is a near-free win because the trace is already created | S | **v1 — same phase as Langfuse integration.** Just tag `bot:{botId}` and `session:{sessionId}` on every trace; Langfuse already aggregates cost per tag |
| D-2 | **Fine-grained Langfuse tagging (bot, session, provider, model, fallback-used)** | Adjacent (extends in-scope Langfuse integration) | Lets ops slice traces by *why* a request was slow or expensive (e.g., "show me only fallback-triggered requests") | S | **v1 — same phase as Langfuse integration.** Cost is in the tagging convention design, not the code |
| D-3 | **Provider-fallback observability (was fallback triggered?)** | Adjacent (extends in-scope fallback) | A silent fallback that doubles latency without alerting is worse than no fallback; emit a metric/log/Langfuse tag every time the secondary provider handled a request | S | **v1 — same phase as multi-provider fallback.** Pair with D-2 |
| D-4 | **Langfuse-backed prompt versioning for bot personas** | Adjacent | Replaces "edit prompt in Postgres → pray → no rollback" with labelled versions and one-click rollback. Langfuse Prompt CMS already supports this natively | M | **v1.x (post-MVP).** v1 keeps personas in Postgres per locked scope; v1.x can dual-write or migrate to Langfuse-managed prompts referenced by ID. Worth flagging in v1's bot CRUD schema so the migration is cheap |
| D-5 | **A/B test prompts via Langfuse labels (`prod-a` / `prod-b`)** | Out of v1 (depends on D-4) | Lets product owners safely test a new persona on 10% of sessions and compare cost/latency/eval scores | M | **Future milestone** after D-4 is in place |
| D-6 | **Structured output schemas per bot** | Adjacent | Some bot adapters need JSON (e.g., a CRM bot returning intent + entities) rather than free text; storing an optional JSON schema per bot and using provider structured-output mode makes Brain useful beyond chat | M | **v1.x.** Optional column on bot table; pass through to OpenAI `response_format` / Gemini structured output |
| D-7 | **Tool / function calling extensibility per bot** | Out of v1 (orthogonal to memory + persona) | Lets a single bot definition declare tools (e.g., `get_order_status`) executed inside the LangGraph node | L | **Future milestone.** Requires careful security boundary (tools execute *in Brain*, not in the bot adapter). Defer until at least one real use case demands it |
| D-8 | **Exact-match response cache for identical `(botId, sessionId, conteudo, persona_version)` tuples** | Adjacent | Catches webhook retries and accidental duplicate publishes; cheap latency + cost win | S | **v1.x.** Use Postgres unique constraint or Redis; pairs naturally with TS-5 (idempotency). NOT semantic caching — that's D-9 |
| D-9 | **Semantic response cache for paraphrased prompts** | Out of v1 | Cache-hit on rephrased questions ("what's my balance" vs "how much do I have") cuts cost significantly for FAQ-heavy bots | L | **Future milestone.** Requires embedding model on the request path + similarity threshold tuning; risk of stale or wrong cache hits across personas. Defer until v1 cost data justifies it |
| D-10 | **Per-bot rate limiting** | Adjacent | Prevents one misbehaving bot adapter from exhausting shared provider quotas (and budget) for all other bots | M | **v1.x.** Token-bucket per `botId`, persisted in Postgres or Redis; return 429 with `Retry-After`. *Not* per-end-user since user identity isn't in v1 scope |
| D-11 | **Per-bot model override (default provider/model in bot row)** | Adjacent | Most differentiated bots want different models (a code-review bot vs a customer-care bot); cheap to add since the abstraction already exists | S | **v1.** Add optional `preferred_provider`, `preferred_model` columns on the bot table; fall back to env default when null. Near-free given the multi-provider abstraction is already in scope |
| D-12 | **Per-bot embedding model selection** | Adjacent | Different bots may need different embedding dimensions or providers (e.g., multilingual vs English-only); aligns with "multimodal headroom" in scope | M | **v1.x.** Adds a column on the bot table; vector DB choice must support multiple embedding configs (filter consideration for stack research) |
| D-13 | **PII redaction on log / trace storage** | Adjacent | Sensitive content reaching Langfuse traces is a real-world compliance concern (LGPD/GDPR); a redaction layer before trace export keeps observability without leaking PII | M | **v1.x.** Use Langfuse's `mask` callback or a Presidio-style filter; configurable on/off per bot |
| D-14 | **Evaluation harness hook (Langfuse Evaluations / datasets)** | Adjacent | Lets persona changes be regression-tested against a fixed dataset before promotion; Langfuse provides this natively | M | **v1.x or future.** Pairs with D-4; cheap to surface once prompts are versioned |
| D-15 | **Async response delivery via webhook callback** | Adjacent (queue side is in scope) | Some integrators want fire-and-forget HTTP: POST request, get 202 + traceId, receive response on a callback URL. Closes the symmetry gap with the RabbitMQ mode | M | **v1.x.** Reuses the async pipeline; new column or per-request `callbackUrl` field; signed callbacks |
| D-16 | **Persona-aware memory summarization (when > 10 messages)** | Adjacent (refines in-scope memory) | The locked scope caps short-term memory at last 10 messages; for long sessions a per-session rolling summary preserves context cheaply | M | **v1.x.** A background summarizer LLM call collapses older messages into a `session_summary` field; surfaces in the prompt without growing the context window |
| D-17 | **Bot-config "dry run" / shadow mode** | Adjacent | Run a new persona against live traffic without returning its output — capture trace + cost diff in Langfuse for safe A/B | M | **Future milestone.** Closely related to D-5 |

---

### Anti-Features (Commonly Requested, Often Problematic for THIS Project)

Each anti-feature below is justified against the user's *locked* constraints and out-of-scope list, not against generic best practice.

| # | Anti-Feature | Why It Will Be Requested | Why It's Wrong for Brain | What to Do Instead |
|---|--------------|--------------------------|--------------------------|---------------------|
| AF-1 | **Built-in chat UI / playground** | Every LLM project gets asked "where do I test it?" | Brain is explicitly a backend service for bot adapters; a chat UI invites end-user-facing scope (auth, sessions, branding) that the locked scope says doesn't exist (single Bearer token, no end-user auth) | Provide a minimal `curl` example, OpenAPI `/docs`, and Langfuse for trace replay. Suggest Postman/HTTPie collections in the README |
| AF-2 | **Operating our own embedded vector DB / pgvector everywhere** | "Postgres is already there, just use pgvector" | Locked scope explicitly calls out a separate vector DB with multimodal headroom (image/video); pgvector would lock us out of that future. The decision is also explicitly deferred to research, not assumed | Pick the vector DB in the stack research phase; keep it as a service in Docker Compose; do *not* try to make Postgres pull double duty |
| AF-3 | **Building a full agentic / multi-agent framework on top of LangGraph** | LangGraph makes it tempting to add supervisor/worker patterns, hand-offs, parallel agents | Out of scope: intent-based routing, intelligent routing. v1 is single-persona-per-request with fallback. Multi-agent introduces routing logic that's explicitly deferred | Single LangGraph graph per request: load persona → load memory → call provider (with fallback) → persist memory → return. Resist branching. |
| AF-4 | **Cross-session / per-user long-term memory aggregation** | Product people will ask "can it remember the user across sessions?" | Explicitly Out of Scope. Adds a `userId` model, identity dedup, and cross-session privacy that the locked scope rejects | Document that the bot adapter owns user identity. If cross-session recall ever ships, it's a future milestone with its own privacy review |
| AF-5 | **Streaming responses (SSE/WebSocket)** | "ChatGPT streams, why don't you" | Explicitly Out of Scope. Webhook→webhook and queue→queue pipelines don't carry streams; adding SSE adds a third transport with no real consumer | Document the choice; revisit only when a real client requires it |
| AF-6 | **Local LLM provider support (Ollama, llama.cpp)** | Common dev-experience ask | Explicitly Out of Scope for v1. The provider abstraction should make it easy *later*, but supporting local now expands testing surface (GPU, model availability) for no MVP value | Keep the LiteLLM-style abstraction clean so it's a small change later |
| AF-7 | **Direct image/video ingestion in v1** | "Vector DB has multimodal headroom, why not use it now?" | Explicitly Out of Scope. The vector DB choice keeps the *door open*, but accepting binary payloads now means storage, scanning, content moderation, and provider-multimodal-support concerns Brain doesn't need yet | v1 accepts text descriptions of media. Document the future ingestion contract so adapters know what's coming |
| AF-8 | **Intent classifier / smart model routing** | "Use cheap model for easy queries, expensive for hard" | Explicitly Out of Scope. Either needs another LLM call (cost + latency) or hand-tuned heuristics (brittle). Default + fallback covers reliability without complexity | Per-bot model preference (D-11) covers the legitimate use case (different bots need different models) without per-request classification |
| AF-9 | **Multi-tenant *end-user* auth (JWTs, roles, OAuth)** | "We're multi-tenant, where's the user model?" | Locked constraint: "Brain is a backend service; auth on the webhook is a single Bearer token between trusted services." Multi-tenancy in Brain means multi-*bot*, not multi-*user* | Stay with the single Bearer token. The bot adapter owns end-user auth |
| AF-10 | **Building our own prompt-management UI** | Persona editing will feel raw via CRUD API | Langfuse Prompt CMS already exists, is in scope (Langfuse is already integrated), and provides versioning + rollback for free (D-4) | Either accept "edit via CRUD" for v1 or migrate to Langfuse-managed prompts in v1.x. Don't build a UI |
| AF-11 | **Connecting Brain directly to messaging platforms (WhatsApp/Telegram)** | "Why split it into two services?" | Stated context: "Brain itself doesn't talk to messaging platforms directly." Each platform has its own webhook signing, rate limits, and quirks that don't belong in the thinking layer | Keep the bot-adapter / Brain split. Provide examples but not implementations |
| AF-12 | **Real-time analytics dashboard inside Brain** | "Where can I see usage stats?" | Langfuse already provides dashboards (cost per user/session/model, latency, traces) for free | Lean into Langfuse. Document the operator workflow as "open Langfuse." |
| AF-13 | **Server-side prompt-injection defense as a hard guardrail** | Every LLM app gets the injection question | Heavy-handed pre-filtering breaks legitimate prompts and creates false confidence. The realistic v1 defense is (a) session-scoped memory (AF-3 reinforces), (b) per-bot system prompts with explicit roles, (c) structured outputs (D-6) where possible | Document the threat model honestly; add a guardrail *layer* (D-13 PII redaction) but don't pretend to "solve" prompt injection |

---

## Feature Dependencies

```
TS-5 (Idempotency Key)
    └── enables ──> D-8 (Exact-Match Cache)
    └── enables ──> safe retries on TS-8

TS-6 (RabbitMQ Ack Discipline)
    └── requires ──> TS-7 (Dead-Letter Queue) for poison messages
    └── requires ──> TS-10 (Graceful Shutdown) so unacked msgs return on restart

TS-14 (Bot CRUD + Audit Log)
    └── superseded-by (v1.x) ──> D-4 (Langfuse Prompt Versioning)
                                     └── enables ──> D-5 (A/B Testing)
                                     └── enables ──> D-14 (Eval Harness)
                                     └── enables ──> D-17 (Shadow Mode)

TS-17 (Response includes traceId)
    └── requires ──> Langfuse integration (in scope)
    └── enables ──> D-1, D-2, D-3 (cost / tagging / fallback observability)

TS-15 (Schema Versioning)
    └── enables ──> safe evolution of TS-19 (correlation ID), D-15 (callback URL)

D-11 (Per-bot model override)
    └── requires ──> in-scope multi-provider abstraction
    └── enhances ──> D-3 (fallback observability — track fallback per bot)

D-6 (Structured outputs per bot)
    └── enhances ──> AF-13 (mitigation against open-ended prompt injection)

D-10 (Per-bot rate limit)
    └── conflicts-with ──> AF-9 (per-user rate limit) — keep at bot scope only

D-16 (Memory summarization)
    └── extends ──> in-scope short-term memory (last 10 msgs cap)
    └── requires ──> care in cost tracking (D-1) — summarization itself costs tokens
```

### Dependency Notes

- **TS-7 strictly requires TS-6**: a DLQ does nothing if the consumer auto-acks. Both must ship in the same phase.
- **TS-10 strictly requires TS-3**: graceful shutdown flips readiness to 503; without `/readyz`, load balancers / Compose health checks keep routing traffic to the draining instance.
- **D-1 / D-2 / D-3 are a unit**: ship the Langfuse tagging convention once. Defining it later costs a backfill or a permanent tagging-style split in the dashboard.
- **D-4 invalidates part of TS-14**: if Langfuse Prompt CMS becomes the source of truth in v1.x, the Postgres `bot.system_prompt` column becomes a denormalized cache, not the master. Design the bot row so this migration is cheap (store either `system_prompt` OR `langfuse_prompt_id`, never both authoritative).
- **D-9 conflicts with TS-16**: semantic caching across sessions would leak personalized answers across sessions. If D-9 ever ships, cache keys MUST include `botId + sessionId` or be limited to obviously generic prompts.
- **AF-3 (anti-multi-agent) constrains D-7 (tools)**: per-bot tool calling is acceptable as long as the graph stays single-persona. Multi-agent supervision is the line not to cross in v1/v1.x.

---

## MVP Definition

### Launch With (v1)

The list below is the locked v1 scope plus the table-stakes gaps that are too small / too critical to defer. Every item here is either already Active in PROJECT.md or an "Adjacent" table-stakes feature.

**From locked v1 Active:**

- [ ] HTTP webhook input/output mode with Bearer token auth (TS-1)
- [ ] RabbitMQ input/output mode on `brain.in` / `brain.out` (TS-6, TS-19)
- [ ] LangGraph orchestration with Postgres checkpointer
- [ ] Multi-provider LLM (OpenAI GPT-4.1 + Gemini 2.5 Flash) with env-driven default + fallback
- [ ] Per-bot system prompts in Postgres + CRUD API
- [ ] Session-isolated memory: short-term last-10 in Postgres + long-term vector recall (TS-16)
- [ ] Vector DB with multimodal headroom, text-only ingest
- [ ] Response payload: reply + model + token usage + LangGraph node trace (TS-17)
- [ ] Langfuse integration (self-hosted)
- [ ] Full Docker Compose deployment
- [ ] `.env`-driven configuration (TS-20)

**Table-stakes gaps to close in v1 (small + critical):**

- [ ] Structured error envelope with stable codes (TS-4)
- [ ] Idempotency-Key support on webhook (TS-5) — pairs with at-least-once delivery from queues
- [ ] Dead-letter queue + retry queue for `brain.in` (TS-7) — without this, poison messages crash-loop
- [ ] Provider retry with exponential backoff before triggering fallback (TS-8)
- [ ] Per-provider request timeout (TS-9)
- [ ] Graceful shutdown with in-flight drain (TS-10) — Compose restarts are routine
- [ ] Pydantic payload validation (TS-11) + 32 KB size cap (TS-12)
- [ ] OpenAPI `/docs` + AsyncAPI doc for RabbitMQ contract (TS-13)
- [ ] Bot edit audit log table (TS-14)
- [ ] `schema_version` field on all payloads (TS-15)
- [ ] `/healthz` and `/readyz` (TS-2, TS-3)
- [ ] Configurable pool sizes / prefetch / concurrency (TS-18)

**Cheap differentiators worth taking in v1:**

- [ ] D-1, D-2, D-3 — Langfuse tagging convention (bot / session / provider / model / fallback-used). Ship once with the Langfuse integration; effectively free.
- [ ] D-11 — Optional per-bot `preferred_provider` / `preferred_model` columns. The abstraction already exists; the column is one migration.

### Add After Validation (v1.x)

Triggered once v1 has real traffic and operators have asked for these:

- [ ] D-4 — Langfuse-backed prompt versioning for personas (trigger: first "I want to roll back yesterday's prompt edit")
- [ ] D-6 — Per-bot structured output schemas (trigger: first non-chat bot use case)
- [ ] D-8 — Exact-match response cache (trigger: visible duplicate-cost in Langfuse)
- [ ] D-10 — Per-bot rate limiting (trigger: first noisy-neighbor incident)
- [ ] D-12 — Per-bot embedding model selection (trigger: first multilingual or domain-specific bot)
- [ ] D-13 — PII redaction on traces (trigger: first compliance/LGPD question)
- [ ] D-14 — Eval harness hooks (trigger: first regression caused by a persona edit)
- [ ] D-15 — Async webhook callback delivery (trigger: first integrator that wants HTTP fire-and-forget)
- [ ] D-16 — Per-session memory summarization (trigger: real sessions exceeding 10 messages with degraded context)

### Future Consideration (v2+)

- [ ] D-5 — Prompt A/B testing via Langfuse labels (after D-4 is stable)
- [ ] D-7 — Per-bot tool / function calling (requires explicit security review of tool execution boundary)
- [ ] D-9 — Semantic response caching (requires real cost data + careful cross-session leakage prevention)
- [ ] D-17 — Shadow-mode persona testing (after D-5)
- [ ] Native multimodal ingestion — gated by user's existing future milestone for image/video
- [ ] Cross-session memory — gated by user's existing out-of-scope decision; requires identity model

---

## Feature Prioritization Matrix

(Table-stakes feature numbers prefixed `TS-`, differentiators `D-`.)

| Feature | User Value | Impl. Cost | Priority |
|---------|------------|------------|----------|
| TS-1 Bearer auth | HIGH | LOW | P1 |
| TS-2 `/healthz` | MEDIUM | LOW | P1 |
| TS-3 `/readyz` | HIGH | LOW | P1 |
| TS-4 Structured errors | HIGH | LOW | P1 |
| TS-5 Idempotency key | HIGH | MEDIUM | P1 |
| TS-6 RabbitMQ ack discipline | HIGH | MEDIUM | P1 |
| TS-7 Dead-letter queue | HIGH | MEDIUM | P1 |
| TS-8 Retry with backoff | HIGH | LOW | P1 |
| TS-9 Per-request timeout | HIGH | LOW | P1 |
| TS-10 Graceful shutdown | HIGH | MEDIUM | P1 |
| TS-11 Payload validation | HIGH | LOW | P1 |
| TS-12 Size limit | MEDIUM | LOW | P1 |
| TS-13 OpenAPI/AsyncAPI | HIGH | LOW | P1 |
| TS-14 Bot audit log | MEDIUM | MEDIUM | P1 |
| TS-15 Schema versioning | MEDIUM | LOW | P1 |
| TS-16 Session isolation | HIGH | MEDIUM | P1 |
| TS-17 Trace ID in response | HIGH | LOW | P1 |
| TS-18 Pool / prefetch config | MEDIUM | LOW | P1 |
| TS-19 Correlation ID | HIGH | LOW | P1 |
| TS-20 Provider keys in env | HIGH | LOW | P1 |
| D-1 Cost tagging | HIGH | LOW | **P1** (ship with Langfuse) |
| D-2 Fine-grained Langfuse tags | HIGH | LOW | **P1** (ship with Langfuse) |
| D-3 Fallback observability | HIGH | LOW | **P1** (ship with fallback) |
| D-11 Per-bot model override | HIGH | LOW | **P1** (cheap given abstraction exists) |
| D-4 Langfuse prompt versioning | HIGH | MEDIUM | P2 |
| D-6 Structured outputs per bot | MEDIUM | MEDIUM | P2 |
| D-8 Exact-match cache | MEDIUM | LOW | P2 |
| D-10 Per-bot rate limit | MEDIUM | MEDIUM | P2 |
| D-12 Per-bot embedding model | MEDIUM | MEDIUM | P2 |
| D-13 PII redaction on traces | MEDIUM | MEDIUM | P2 |
| D-14 Eval harness hook | MEDIUM | MEDIUM | P2 |
| D-15 Async webhook callback | MEDIUM | MEDIUM | P2 |
| D-16 Memory summarization | MEDIUM | MEDIUM | P2 |
| D-5 A/B prompt testing | MEDIUM | MEDIUM | P3 |
| D-7 Tool/function calling | HIGH | HIGH | P3 |
| D-9 Semantic cache | MEDIUM | HIGH | P3 |
| D-17 Shadow-mode personas | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1 launch
- P2: v1.x, add post-validation
- P3: v2+ / future milestone

---

## Competitor / Adjacent-Product Feature Analysis

| Feature | Generic LangGraph App | LiteLLM / Bifrost Gateway | Chainlit + LangGraph | Brain's Approach |
|---------|----------------------|---------------------------|----------------------|------------------|
| Multi-provider fallback | DIY | Native, sophisticated | DIY | In-scope; simple default + fallback (no intent routing) |
| Cost tracking | None | Per-key, per-team | None | Langfuse tags by bot + session (D-1/D-2) — leverages existing Langfuse, doesn't duplicate it |
| Per-bot persona | DIY in code | N/A | DIY | First-class: Postgres row + CRUD + audit log (TS-14), v1.x migrate to Langfuse Prompt CMS (D-4) |
| Memory model | DIY (checkpointer only) | N/A | Session-scoped, bundled | Postgres checkpointer + last-10 + vector recall, strictly per-session |
| Ingress | HTTP only typically | HTTP only | HTTP + Chainlit UI | HTTP webhook + RabbitMQ (two equal-weight modes) |
| Chat UI | None | None | Built in | None — anti-feature AF-1 |
| Observability | LangSmith or DIY | Built-in dashboards | Chainlit logs + DIY | Langfuse (self-hosted, in-scope) |
| Prompt-injection guardrails | DIY | Optional add-on | DIY | Mitigations only (session isolation, structured outputs, PII redaction in v1.x) — no false-confidence guardrail (AF-13) |
| Tool calling | First-class | N/A | Yes | Out of v1 (D-7, future milestone) |
| Streaming | First-class | First-class | First-class | Out of scope explicitly |

**Brain's positioning:** "The Langfuse-native, dual-ingress thinking layer with first-class per-bot personas and session-isolated memory" — distinct from LLM gateways (which are stateless proxies) and from agent frameworks (which bundle UI / orchestration / runtime).

---

## Sources

### High-confidence (official docs)

- [Langfuse Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) — cost-per-session/user/model tagging
- [Langfuse Prompt Management](https://langfuse.com/docs/prompt-management/overview) — versioning + labels + rollback
- [Langfuse Prompt Version Control](https://langfuse.com/docs/prompt-management/features/prompt-version-control) — D-4 mechanics
- [Langfuse A/B Testing](https://langfuse.com/docs/prompt-management/features/a-b-testing) — D-5 mechanics
- [Langfuse + LangGraph Cookbook](https://langfuse.com/guides/cookbook/integration_langgraph) — confirms in-scope integration is well-trodden
- [FastAPI Lifespan Events](https://fastapi.tiangolo.com/advanced/events/) — TS-10 graceful shutdown primitive
- [LangGraph Platform GA blog](https://blog.langchain.com/langgraph-platform-ga/) — production patterns (we deliberately don't use the platform; informs feature parity expectations)

### Medium-confidence (industry references)

- [Top 5 LLM Gateways 2026 (Maxim)](https://www.getmaxim.ai/articles/top-5-llm-gateways-in-2026-for-enterprise-grade-reliability-and-scale/) — table-stakes set for gateway-like services
- [LLM Guardrails Explained](https://llmgateway.io/blog/llm-guardrails-explained) — PII / moderation positioning (D-13, AF-13)
- [Redis LangCache / Semantic Caching](https://redis.io/docs/latest/develop/ai/langcache/) — D-8 vs D-9 distinction
- [RabbitMQ DLQ Production Guide (Medium)](https://medium.com/@thyagodoliveiraperez/rabbitmq-in-production-dlq-retry-with-ttl-and-a-generic-consumer-framework-3482f9cf2337) — TS-6/TS-7
- [Python Graceful Shutdown in Kubernetes (OneUptime)](https://oneuptime.com/blog/post/2025-01-06-python-graceful-shutdown-kubernetes/view) — TS-10 implementation pattern
- [Prompt Versioning & Change Management (TianPan)](https://tianpan.co/blog/2026-03-13-prompt-versioning-change-management-production) — D-4 rationale
- [Conversational UI vs Chat UI vs Agent UI (DesignKey)](https://www.designkey.studio/post/conversational-chat-agent-ui-design) — AF-1 rationale

### Lower-confidence / supporting

- [LangGraph Multi-Agent Orchestration Guide (Latenode)](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025) — AF-3 (supervisor pattern context)
- [Best AI Guardrails Platforms 2026 (Maxim)](https://www.getmaxim.ai/articles/best-ai-guardrails-platforms-in-2026/) — guardrail landscape

---

*Feature research for: Multi-tenant LangGraph orchestration service ("Brain")*
*Researched: 2026-05-21*
