# Brain

## What This Is

Brain is a centralized AI service built with LangGraph (Python) that receives requests from conversational bots (WhatsApp, Telegram, and similar), processes them through multi-provider LLMs (OpenAI and Gemini in v1) with per-bot personas and per-session memory, and returns structured responses. It is designed as the "thinking layer" that any number of bot frontends can delegate to, exposing both an HTTP webhook interface and a RabbitMQ queue interface.

## Core Value

A single bot frontend can hand a `{ botId, sessionId, conteudo }` payload to Brain and get back a coherent, persona-correct, memory-aware reply — regardless of which LLM provider answers behind the scenes.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] HTTP webhook input/output mode (Bearer token auth)
- [ ] RabbitMQ input/output mode (separate `brain.in` / `brain.out` queues)
- [ ] LangGraph orchestration with Postgres checkpointer
- [ ] Multi-provider LLM support: OpenAI (GPT-4.1) + Google (Gemini 2.5 Flash)
- [ ] Default model selection via env, automatic fallback to secondary provider on error/timeout
- [ ] Per-bot system prompts stored in Postgres (each bot = its own persona)
- [ ] CRUD API for bot/persona management
- [ ] Session-isolated conversational memory (no cross-session leak)
- [ ] Short-term memory: last 10 messages per session (Postgres)
- [ ] Long-term memory: semantic recall from vector DB (scoped by botId + sessionId)
- [ ] Vector DB with multimodal headroom (image/video future) — text-only ingest in v1
- [ ] Response payload includes the reply, model used, token usage, and LangGraph node trace
- [ ] Langfuse integration for tracing/observability (self-hosted)
- [ ] Full Docker Compose deployment (Brain + Postgres + RabbitMQ + Vector DB + Langfuse)
- [ ] All connection details and routing configured via `.env`

### Out of Scope

- **Streaming responses (SSE/WebSocket)** — async-first architecture (queues + webhooks) doesn't benefit; add later only if a real client needs it.
- **Direct image/video processing** — v1 accepts only text content (including text *descriptions* of images/video). Native multimodal ingest is a future milestone once base flow is solid.
- **Anthropic / other providers** — MVP scoped to OpenAI + Gemini; more providers added once the abstraction is proven.
- **Intelligent / intent-based model routing** — v1 only does default-model + fallback-on-error. Smarter routing (by complexity, cost, intent) is a later concern.
- **Cross-session / per-user long-term memory** — v1 memory is strictly scoped to a single `sessionId`. No `userId` aggregation across sessions.
- **Local LLM providers (Ollama, etc.)** — only "online" providers in v1.
- **Authenticated end-user model** — Brain is a backend service; auth on the webhook is a single Bearer token between trusted services, not multi-user.

## Context

- LangGraph (Python) is the canonical implementation — most mature, official Postgres checkpointer, native Langfuse and provider SDKs. The JS port lags and was deliberately rejected.
- Expected callers are bot adapters (e.g., a WhatsApp gateway, a Telegram bot). Brain itself doesn't talk to messaging platforms directly.
- The async/queue-first design exists because real-world bot pipelines often look like `gateway → queue → brain → queue → gateway`, while simpler integrations can hit the webhook directly.
- The vector DB choice is deferred to the research phase. Selection criteria: text + future multimodal (image/video), runs in Docker Compose, supports per-bot index or filtered single index.
- Each bot's persona/prompt lives in Postgres so that adding a new bot is a data operation, not a code/redeploy.

## Constraints

- **Tech stack**: Python + LangGraph (Python-first ecosystem; JS port not mature enough).
- **Tech stack**: Postgres as the primary transactional store — used for LangGraph checkpointer, bot definitions, and short-term message history (one DB to operate).
- **Deployment**: Must run end-to-end via `docker compose up` on a developer machine, including Postgres, RabbitMQ, Vector DB, and Langfuse.
- **Configuration**: All providers, queue names, model defaults, and connection strings must be configurable via `.env` — no hardcoded endpoints.
- **Security**: Webhook protected by static Bearer token from env. Internal services (Postgres, RabbitMQ, Vector DB, Langfuse) live on the Docker network.
- **Observability**: Every request must produce a Langfuse trace and an in-response trace of LangGraph node execution for debuggability.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Language: Python | LangGraph Python is the canonical, most mature implementation; JS port lags in features and provider support | — Pending |
| Two ingress modes (webhook + RabbitMQ) | Real pipelines vary — some integrators prefer HTTP, others prefer queues; supporting both makes Brain genuinely reusable | — Pending |
| Session-isolated memory (no userId in v1) | Keeps memory model simple and prevents cross-session contamination; cross-session memory is a known future need but adds significant complexity | — Pending |
| Per-bot personas in Postgres (not env) | Adding a new bot must not require redeploying Brain; storing personas as data enables a CRUD API and multi-tenant operation | — Pending |
| Default + fallback routing (no intent routing v1) | Intent-based routing requires either an extra classifier model (cost + latency) or hand-tuned heuristics; default + fallback is enough to keep the service reliable | — Pending |
| Langfuse for observability | Self-hostable, native LangChain/LangGraph integration, visualizes graph traces well | — Pending |
| Non-streaming responses in v1 | Webhook→webhook and queue→queue are intrinsically batch; streaming complicates both without clear MVP value | — Pending |
| Vector DB selection deferred to research | Decision depends on multimodal roadmap + Docker fit + per-bot isolation story; warrants explicit comparison | — Pending |
| Postgres as the single transactional store | One DB for LangGraph checkpoints, bot definitions, and short-term history reduces operational surface area | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-21 after initialization*
