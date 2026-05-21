# Roadmap: Brain

**Defined:** 2026-05-21
**Granularity:** standard
**Coverage:** 96/96 v1 requirements mapped
**Project:** Brain — centralized LangGraph-based AI orchestration service
**Core Value:** A single bot frontend can hand a `{ botId, sessionId, conteudo }` payload to Brain and get back a coherent, persona-correct, memory-aware reply — regardless of which LLM provider answers behind the scenes.

## Phases

- [ ] **Phase 1: Foundations & Compose Skeleton** — Walking skeleton: pinned deps, FastAPI healthchecks, Pydantic Settings, multi-stage Dockerfile, full + lite Compose, Alembic init, dual Postgres schemas, gitleaks, structlog, thread_id helper, schema_version, graceful shutdown.
- [ ] **Phase 2: Bot Persona CRUD + Audit** — `bots` + `bot_audit_log` tables, full CRUD, soft-delete (410), prompt size cap, TTL cache, per-turn persona pinning, `langfuse_prompt_id` v1.x migration slot.
- [ ] **Phase 3: Minimal Webhook + Single-Node Graph** — Bearer-auth `/v1/webhook` with Pydantic + 32KB cap + structured errors, `BrainService` shared waist, one-node LangGraph against a single hardcoded provider, success/error response envelopes with `node_trace`.
- [ ] **Phase 4: Langfuse Wiring** — Callback handler on every graph invoke, request root span with tag convention frozen, `traceId` populated in response, fire-and-forget + circuit breaker, Authorization/API-key masking.
- [ ] **Phase 5: Multi-Provider + Fallback** — `LLMProvider` protocol, OpenAI + Gemini adapters, `with_fallbacks` router, `ProviderError` taxonomy, tenacity retry, per-provider timeout + token counter, per-bot model override wiring.
- [ ] **Phase 6: Short-Term Memory + Postgres Checkpointer** — `messages` table, `ShortTermRepo`, `fetch_short_term` + `persist_message` nodes, `AsyncPostgresSaver` wired with `thread_id(bot_id, session_id)`, per-session asyncio.Lock registry, concurrency + cross-session-leak tests.
- [ ] **Phase 7: Vector Memory (Qdrant)** — `VectorStore` protocol + `QdrantStore`, single `brain_memory` collection with filterable HNSW, `EmbeddingProvider` protocol + OpenAI (1536d) + Gemini (768d) adapters, `fetch_long_term` + `embed_and_store` nodes (parallel fetch, idempotent upsert), startup dim validation.
- [ ] **Phase 8: RabbitMQ Ingress + Idempotency** — `aio-pika.connect_robust` consumer, init-container topology with DLX/DLQ, manual ack + prefetch=1, correlation_id round-trip, publisher confirms, AsyncAPI doc, Postgres-backed idempotency cache covering BOTH ingresses, FastAPI lifespan integration.
- [ ] **Phase 9: Hardening & Production-Readiness** — Checkpoint retention, vector TTL plan, DLQ replay tooling, token rotation hooks, LGPD/PII review flag, secrets-beyond-env, backup/restore drill, README + runbook, capacity model.

## Phase Details

### Phase 1: Foundations & Compose Skeleton
**Goal**: Operator can `docker compose up` and reach a healthy Brain process with all infrastructure dependencies on a green status check, and the project's foundational conventions (pinned deps, dual schemas, gitignored secrets, structured logs, schema_version) are locked.
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07, FOUND-08, FOUND-09, FOUND-10, FOUND-11, FOUND-12, AUTH-03, AUTH-04, DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05, DEPLOY-06, DEPLOY-07, DEPLOY-08
**Success Criteria** (what must be TRUE):
  1. `docker compose up` on a fresh checkout brings the full 10-service stack (Brain + Postgres + RabbitMQ + Qdrant + Langfuse-web + Langfuse-worker + Langfuse-Postgres + ClickHouse + Redis + MinIO) to `service_healthy` deterministically, and `docker compose -f docker-compose.lite.yml up` brings up the inner-loop subset without the Langfuse subsystem.
  2. `GET /healthz` returns 200 (liveness) and `GET /readyz` returns 200 only when Postgres + RabbitMQ + Qdrant connections are reachable; missing dependencies surface a clear 503 with which check failed.
  3. Service refuses to start with a clear Pydantic Settings error if any required env var is missing or malformed; `.env.example` documents every variable and `gitleaks` (pre-commit) blocks any commit containing a real secret.
  4. Two Postgres schemas exist after the `brain-migrate` init container completes: `langgraph.*` (owned by checkpointer `.setup()`) and `brain.*` (owned by Alembic), and the workers depend on the init container's successful completion.
  5. Sending `SIGTERM` to the running container drains in-flight HTTP requests within the grace window before exit; all logs are JSON via structlog (no `print` / stdlib logging in production code).
**Plans**: TBD

### Phase 2: Bot Persona CRUD + Audit
**Goal**: An operator can manage bot personas as data (create, read, update, soft-delete) through a documented HTTP API, with every change captured in an append-only audit log and existing conversations protected from mid-turn persona changes.
**Depends on**: Phase 1
**Requirements**: BOT-01, BOT-02, BOT-03, BOT-04, BOT-05, BOT-06, BOT-07, BOT-08, BOT-09
**Success Criteria** (what must be TRUE):
  1. Operator can `POST /v1/bots` to create a bot, `GET /v1/bots/{id}` to read it, `PUT /v1/bots/{id}` to update it, and `DELETE /v1/bots/{id}` to soft-delete it; responses match a documented OpenAPI schema.
  2. A soft-deleted bot returns 410 Gone on lookup but persona snapshots taken before deletion remain resolvable for the duration of an in-flight turn.
  3. Every create/update/delete writes a row to `brain.bot_audit_log` with actor + timestamp + before/after diff that an operator can query to reconstruct the persona history.
  4. The DB rejects a `system_prompt` exceeding the configured size cap (default 32KB) with a CHECK constraint, and the CRUD endpoint surfaces this as a 422 with a clear message.
  5. Persona lookups served on the request path hit an in-process TTL cache; a turn that begins reading persona vN continues to see vN even if `PUT /v1/bots/{id}` lands mid-turn.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Minimal Webhook + Single-Node Graph
**Goal**: A trusted bot adapter can `POST /v1/webhook` with a Bearer token and a valid payload and receive a coherent, persona-correct reply from a single hardcoded LLM provider through a one-node LangGraph, with a stable success/error response envelope.
**Depends on**: Phase 2
**Requirements**: AUTH-01, AUTH-02, WEB-01, WEB-02, WEB-03, WEB-04, WEB-05, GRAPH-05, GRAPH-06, RESP-01, RESP-02, RESP-04
**Success Criteria** (what must be TRUE):
  1. `POST /v1/webhook` with a valid Bearer token + payload `{ botId, sessionId, conteudo, schema_version }` for an existing bot returns 200 with a documented success envelope including `resposta`, `model`, `tokenUsage`, `nodeTrace`, and `traceId` (placeholder OK until Phase 4 populates it).
  2. Requests with missing/invalid Bearer return 401, unknown `botId` returns 404, malformed payloads return 422 with field-level errors, oversize payloads return 413, and all errors share the `{ error: { code, message, traceId } }` envelope.
  3. The `Authorization` header is stripped from any log line, error response, or downstream call (a canary-token regression test confirms it never reaches stdout).
  4. The response's `nodeTrace` lists each LangGraph node that executed with its duration, and graph recursion limit is set explicitly (no opaque `GraphRecursionError`).
  5. OpenAPI docs at `/docs` describe the webhook, error envelope, and stable error codes such that an integrator can complete a first call with curl using only the README + `/docs`.
**Plans**: TBD
**UI hint**: yes

### Phase 4: Langfuse Wiring
**Goal**: Every Brain request produces a Langfuse trace with consistent tagging that an operator can use to slice cost/latency by bot, session, provider, model, and fallback usage — without Langfuse availability ever blocking the request path.
**Depends on**: Phase 3
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06
**Success Criteria** (what must be TRUE):
  1. Every webhook request opens a Langfuse root span in middleware and the LangGraph callback handler is attached to every `graph.ainvoke` invocation; the response envelope's `traceId` field is now the real Langfuse trace id.
  2. Operator viewing Langfuse can filter traces by `bot:{id}`, `session:{id}`, `provider`, `model`, `fallback_used`, and `ingress:{http|amqp}` (placeholder for AMQP until Phase 8) without any backfill.
  3. Pointing `LANGFUSE_HOST` at an unreachable port has no effect on request success rate or p95 latency; Langfuse failures are swallowed and logged, never propagated to callers.
  4. After N consecutive Langfuse export failures the circuit breaker opens; export auto-resumes after a cooldown without operator intervention.
  5. A canary-token regression test confirms `Authorization` headers and provider API keys do not appear in any Langfuse trace payload.
**Plans**: TBD

### Phase 5: Multi-Provider + Fallback
**Goal**: When the configured default provider fails with a transient/rate-limit error, Brain automatically falls back to the secondary provider within the configured per-provider timeout, returning a correct reply with accurate per-provider token usage and a clear signal of which provider answered.
**Depends on**: Phase 4
**Requirements**: LLM-01, LLM-02, LLM-03, LLM-04, LLM-05, LLM-06, LLM-07, LLM-08, LLM-09, LLM-10, LLM-11
**Success Criteria** (what must be TRUE):
  1. With `PROVIDER_DEFAULT=openai` and `PROVIDER_FALLBACK=gemini`, a forced OpenAI timeout/5xx results in a successful Gemini reply within the configured timeout budget and the response's `fallbackUsed: true` reflects it.
  2. A non-retryable error (BAD_INPUT, CONTENT_POLICY, AUTH) from the primary provider does NOT trigger fallback — it surfaces as a structured error to the caller with the correct taxonomy code.
  3. `tokenUsage` in the response uses provider-native counters (`tiktoken` for OpenAI, `count_tokens` API for Gemini) and is per-provider correct; `Retry-After` is honored on RATE_LIMIT.
  4. A bot row with `preferred_provider` / `preferred_model` set overrides the env defaults for that bot's turns; unset bots fall through to env defaults.
  5. Adding a hypothetical third provider requires only a new file in `providers/` + a single registry line — verified by a smoke test that drops in a stub provider without modifying any graph or service code.
**Plans**: TBD

### Phase 6: Short-Term Memory + Postgres Checkpointer
**Goal**: A returning user on the same `(botId, sessionId)` gets replies that reference their last 10 turns; concurrent same-session requests are serialized end-to-end so no message is ever lost or interleaved; messages from one session never bleed into another.
**Depends on**: Phase 5
**Requirements**: GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04, STM-01, STM-02, STM-03, STM-04, STM-05, STM-06
**Success Criteria** (what must be TRUE):
  1. Sending 5 sequential turns to the same `(botId, sessionId)` produces replies that demonstrably reference earlier turns; the `brain.messages` table holds the strictly-ordered user + assistant pairs for that session.
  2. Firing 5 concurrent requests against the same `(botId, sessionId)` results in 5 strictly-ordered turns in `brain.messages` (no interleaving, no loss) — per-session `asyncio.Lock` registry serializes the whole read-mutate-write turn.
  3. Cross-session leak test: messages written under `(bot X, session A)` never surface in any query against `(bot X, session B)` or `(bot Y, session A)`, on either Postgres or LangGraph state.
  4. `AsyncPostgresSaver` is the active checkpointer keyed by `thread_id(bot_id, session_id)`; replaying a checkpoint does NOT produce duplicate rows in `brain.messages` (effect nodes use `sha256(bot_id|session_id|content)` idempotency keys + ON CONFLICT DO NOTHING).
  5. Graph topology now executes `load_persona → fetch_short_term → build_messages → call_llm → persist_message → build_response` (long-term + embedding land in Phase 7); `node_trace` reflects it.
**Plans**: TBD

### Phase 7: Vector Memory (Qdrant)
**Goal**: Brain semantically recalls relevant prior content within a `(botId, sessionId)` scope to enrich replies, with embed + long-term-fetch executing in parallel with short-term fetch on the hot path, and embedding-dimension safety enforced at startup.
**Depends on**: Phase 6
**Requirements**: VEC-01, VEC-02, VEC-03, VEC-04, VEC-05, VEC-06, VEC-07, VEC-08, EMB-01, EMB-02, EMB-03, EMB-04, EMB-05
**Success Criteria** (what must be TRUE):
  1. A user message that semantically matches an earlier turn in the same `(botId, sessionId)` produces a reply that demonstrably uses that prior context, recalled via Qdrant filterable HNSW with a `Filter(must=[bot_id, session_id])` payload filter.
  2. Brain refuses to start if the active embedding provider's `dimensions` constant does not match the existing Qdrant collection's vector dimension — startup logs a clear "expected N, found M; reindex or switch provider" message.
  3. `fetch_short_term` and `fetch_long_term` execute in parallel via `asyncio.gather`; the `node_trace` durations confirm they overlap rather than serialize, and replays produce no duplicate vectors (idempotent upsert keyed by content hash).
  4. A vector query missing `bot_id` raises at runtime; raw `qdrant_client` usage outside `vectordb/` fails CI; switching `EMBEDDING_PROVIDER` between `openai` and `gemini` requires an adapter swap + reindex (README documents this as a one-way door).
  5. Adding a hypothetical third embedding provider requires only one new file in `embeddings/` + a single registry line — verified by stub provider integration that lands without graph changes.
**Plans**: TBD

### Phase 8: RabbitMQ Ingress + Idempotency
**Goal**: A bot adapter can publish a request to `brain.in` and receive a structured reply on `brain.out` with the original `correlation_id`, with the same idempotency guarantees as the HTTP path, dead-letter protection on poison messages, and at-least-once safety on broker restarts.
**Depends on**: Phase 7
**Requirements**: MQ-01, MQ-02, MQ-03, MQ-04, MQ-05, MQ-06, MQ-07, MQ-08, MQ-09, IDEMP-01, IDEMP-02, IDEMP-03, RESP-03
**Success Criteria** (what must be TRUE):
  1. Publishing a valid `BrainRequest` to `brain.in` with a `correlation_id` results in a response on `brain.out` carrying the same `correlation_id` and the same envelope shape as the HTTP response — both ingresses funnel through `BrainService.handle_request` (symmetry test passes).
  2. A poison message (malformed JSON, unknown bot, oversize payload) lands in `brain.dlq` via DLX rather than infinite-looping on `brain.in`; topology is declared by a one-shot `brain-topology-init` container and consumers declare `passive=True`.
  3. Killing the worker mid-LLM-call (`kill -9`) results in the message being redelivered on restart and processed correctly (manual ack only, `prefetch_count=1`, per-LLM `httpx` timeout < broker `consumer_timeout`); publisher confirms guarantee no silent `brain.out` loss.
  4. Replaying the same `idempotency_key` (HTTP header or AMQP property) within TTL returns the cached response without re-invoking the graph, on EITHER ingress; the cache is backed by Postgres `brain.idempotency` with daily cleanup and a 409+retry-hint contract for in-flight duplicates.
  5. An integrator can read the published AsyncAPI document for `brain.in` / `brain.out` schemas and exchange a first message without consulting source code; FastAPI lifespan starts and gracefully stops the consumer alongside the web app.
**Plans**: TBD

### Phase 9: Hardening & Production-Readiness
**Goal**: Brain runs in a real deployment without on-call surprise: storage doesn't grow unbounded, poison messages can be replayed by an operator, tokens can be rotated without downtime, backups can be restored cleanly, and a written runbook covers the common failure modes.
**Depends on**: Phase 8
**Requirements**: (None — all v1 functional requirements are satisfied by phases 1–8; Phase 9 covers operational concerns that surface only with real traffic. v2-HARD items are tracked separately in REQUIREMENTS.md.)
**Success Criteria** (what must be TRUE):
  1. A scheduled retention job keeps the `langgraph.checkpoints` table bounded (e.g., latest 20 per thread + last 24h); table size growth over a soak period is linear in active sessions, not in superstep count.
  2. An operator can run a documented `dlq-replay` command that re-publishes a corrected message from `brain.dlq` back into `brain.in`, and observes it succeeded via Langfuse.
  3. The Bearer-token list supports rotation (e.g., `BRAIN_AUTH_TOKENS=tok1,tok2`); a token can be added and the previous token removed across deployments without dropping a single in-flight request.
  4. A backup/restore drill restores both `langgraph.*` and `brain.*` schemas atomically into a staging stack, and a smoke-test session completes end-to-end against the restored state.
  5. README + runbook document: startup ordering, secrets-beyond-`.env` path (Docker secrets / SOPS / 1Password), LGPD/PII review checklist, capacity model based on first-week metrics, and DLQ replay procedure.
**Plans**: TBD

## Dependencies

```
Phase 1 (Foundations)
  └── Phase 2 (Bot CRUD)
        └── Phase 3 (Webhook + Single-Node Graph)
              └── Phase 4 (Langfuse Wiring)
                    └── Phase 5 (Multi-Provider + Fallback)
                          └── Phase 6 (Short-Term Memory + Checkpointer)
                                └── Phase 7 (Vector Memory)
                                      └── Phase 8 (RabbitMQ Ingress + Idempotency)
                                            └── Phase 9 (Hardening)
```

Linear chain: each phase builds on the artifacts and conventions locked by the previous one. No phase can be safely skipped or reordered without re-deriving success criteria.

## Research Flags

Per `research/SUMMARY.md`, the following phases warrant a `/gsd-research-phase` pass before planning:

| Phase | Research Focus |
|-------|----------------|
| 1 | Langfuse v3 self-hosted compose subsystem; Alembic + LangGraph schemas interplay (gh issue #465) |
| 4 | Tag conventions, mask callbacks, circuit breaker, async-boundary trace propagation (pitfall 8.3) |
| 5 | `ProviderError` taxonomy mapping for OpenAI + Gemini (2.1); partial-response policy (2.2) |
| 7 | Qdrant filterable HNSW tuning; named-vector schema for future multimodal; embedding cache key design |
| 8 | `consumer_timeout` vs prefetch vs per-LLM-call timeout interaction (4.2) |

Phases that can skip research (standard patterns): **2, 3, 6, 9**.

## Coverage Validation

| Category | Reqs | Phase(s) |
|----------|------|----------|
| FOUND-01..12 | 12 | Phase 1 |
| AUTH-01..02 | 2 | Phase 3 |
| AUTH-03..04 | 2 | Phase 1 |
| BOT-01..09 | 9 | Phase 2 |
| WEB-01..05 | 5 | Phase 3 |
| MQ-01..09 | 9 | Phase 8 |
| IDEMP-01..03 | 3 | Phase 8 |
| GRAPH-01..04 | 4 | Phase 6 |
| GRAPH-05..06 | 2 | Phase 3 |
| LLM-01..11 | 11 | Phase 5 |
| STM-01..06 | 6 | Phase 6 |
| VEC-01..08 | 8 | Phase 7 |
| EMB-01..05 | 5 | Phase 7 |
| OBS-01..06 | 6 | Phase 4 |
| RESP-01..02 | 2 | Phase 3 |
| RESP-03 | 1 | Phase 8 |
| RESP-04 | 1 | Phase 3 |
| DEPLOY-01..08 | 8 | Phase 1 |
| **Total** | **96** | **Mapped to phases 1-8** |

✓ Every v1 requirement maps to exactly one phase.
✓ No orphans.
✓ No duplicates.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations & Compose Skeleton | 0/TBD | Not started | - |
| 2. Bot Persona CRUD + Audit | 0/TBD | Not started | - |
| 3. Minimal Webhook + Single-Node Graph | 0/TBD | Not started | - |
| 4. Langfuse Wiring | 0/TBD | Not started | - |
| 5. Multi-Provider + Fallback | 0/TBD | Not started | - |
| 6. Short-Term Memory + Postgres Checkpointer | 0/TBD | Not started | - |
| 7. Vector Memory (Qdrant) | 0/TBD | Not started | - |
| 8. RabbitMQ Ingress + Idempotency | 0/TBD | Not started | - |
| 9. Hardening & Production-Readiness | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-21*
*Last updated: 2026-05-21 after initial roadmap creation*
