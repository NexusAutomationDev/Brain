---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-22T02:11:20.250Z"
progress:
  total_phases: 9
  completed_phases: 0
  total_plans: 9
  completed_plans: 0
  percent: 0
---

# State: Brain

**Initialized:** 2026-05-21
**Last updated:** 2026-05-21

## Project Reference

- **Project doc:** `.planning/PROJECT.md`
- **Requirements:** `.planning/REQUIREMENTS.md` (96 v1 requirements across 14 categories)
- **Roadmap:** `.planning/ROADMAP.md` (9 phases)
- **Research:** `.planning/research/SUMMARY.md` + STACK / FEATURES / ARCHITECTURE / PITFALLS

**Core Value:** A single bot frontend can hand a `{ botId, sessionId, conteudo }` payload to Brain and get back a coherent, persona-correct, memory-aware reply — regardless of which LLM provider answers behind the scenes.

**Current Focus:** Phase 01 — foundations-compose-skeleton

## Current Position

Phase: 01 (foundations-compose-skeleton) — EXECUTING
Plan: 1 of 9

- **Milestone:** v1
- **Phase:** 1 — Foundations & Compose Skeleton
- **Plan:** (not yet planned)
- **Status:** Executing Phase 01
- **Progress:** Phase 1 of 9 (0% phases complete)
- **Mode:** YOLO (per `config.json`)

```
[░░░░░░░░░░░░░░░░░░░░] 0/9 phases complete
```

## Next Action

`/gsd-plan-phase 1` — decompose Phase 1 (Foundations & Compose Skeleton) into executable plans.

Phase 1 is flagged for deeper research by `research/SUMMARY.md` (Langfuse v3 compose subsystem, Alembic + LangGraph schema interplay). Consider `/gsd-research-phase 1` before planning if blockers surface during decomposition.

## Performance Metrics

(Populated as phases complete.)

| Phase | Plans | Repairs | Time | Notes |
|-------|-------|---------|------|-------|
| 1 | - | - | - | - |
| 2 | - | - | - | - |
| 3 | - | - | - | - |
| 4 | - | - | - | - |
| 5 | - | - | - | - |
| 6 | - | - | - | - |
| 7 | - | - | - | - |
| 8 | - | - | - | - |
| 9 | - | - | - | - |

## Accumulated Context

### Key Decisions (locked at init / research)

| Decision | Source | Rationale |
|----------|--------|-----------|
| Python 3.12-slim-bookworm (not 3.13, not alpine) | STACK.md §9 | ML wheels lag on 3.13; musl breaks `psycopg[binary]` / ML wheels |
| `psycopg[binary,pool]` v3 (NOT asyncpg) | STACK.md §3, FOUND-06 | Required by `langgraph-checkpoint-postgres`; asyncpg = custom checkpointer |
| LangGraph 1.2.1 + checkpoint-postgres 3.1.0 exact-pinned | PITFALLS 1.1, FOUND-02 | Minor bumps have broken checkpoint metadata serialization |
| Qdrant (single collection `brain_memory` + filterable HNSW) | STACK.md §4, VEC-01 | Multimodal headroom + per-bot isolation; collection-per-bot is escape hatch |
| Two Postgres instances: `brain-postgres` + `langfuse-postgres` | PITFALLS 6.2, 7.1 | Never share schemas across product + observability |
| Two Postgres schemas in `brain-postgres`: `langgraph.*` + `brain.*` | FOUND-07 | Alembic owns `brain`, checkpointer `.setup()` owns `langgraph` |
| `thread_id = f"{bot_id}:{session_id}"` always | PITFALLS 10.1, FOUND-08 | Bare sessionId leaks across bots; enforce via helper + lint |
| Provider fallback via LangChain `with_fallbacks` (inside `call_llm`, not as graph edges) | ARCHITECTURE.md §3, LLM-05 | Keeps graph linear; Langfuse traces nest cleanly |
| Per-`(botId, sessionId)` `asyncio.Lock` registry | ARCHITECTURE.md §Concurrency, GRAPH-03 | AsyncPostgresSaver does not protect read-mutate-write turn boundary |
| Embedding dim fixed in adapter (not env) | EMB-03/04 | Dim is locked at Qdrant collection-create time; treat as install-time decision |
| Idempotency cache in Postgres (not Redis) | SUMMARY.md Q4, IDEMP-02 | One fewer service surface; Postgres already in stack |
| Langfuse callbacks fire-and-forget + circuit breaker | PITFALLS 8.1, OBS-04/05 | Observability must never block the request path |
| `BRAIN_AUTH_TOKEN` (single) in v1; `BRAIN_AUTH_TOKENS` (list, rotation) in Phase 9 | AUTH-01, Phase 9 | Avoid scope creep on token mgmt before traffic exists |
| `docker-compose.lite.yml` excludes Langfuse subsystem | DEPLOY-02 | Inner-loop dev needs fast startup without ClickHouse/Redis/MinIO |

### Open Questions (deferred per SUMMARY.md)

1. **Embedding provider default at install time:** OpenAI 1536d vs Gemini 768d. Decision required at Phase 7 start; recommend OpenAI per STACK.md §5.
2. **Vector TTL policy values:** sized after Phase 9 traffic data.
3. **Multi-replica deployment:** in-process lock works for one Brain instance; distributed lock (Redis) is v1.x / Phase 9+ if horizontal scale needed.
4. **LGPD / PII redaction timing:** deferred to Phase 9 (v2-HARD-01); flag during Phase 4 research if legal surfaces it earlier.

### Todos / Follow-ups

(None at roadmap-creation time. Populated during planning + execution.)

### Blockers

(None.)

## Session Continuity

**Last session:** 2026-05-22T01:02:27.707Z

**What was done:**

- Read PROJECT.md, REQUIREMENTS.md (96 v1 reqs), config.json
- Read all research artifacts: SUMMARY.md, STACK.md, ARCHITECTURE.md, PITFALLS.md, FEATURES.md
- Adopted the 9-phase structure proposed in research/SUMMARY.md
- Mapped all 96 v1 requirements to phases 1-8 (Phase 9 = operational hardening, no v1 functional reqs)
- Derived 5 observable success criteria per phase (goal-backward)
- Updated REQUIREMENTS.md traceability table with phase assignments
- Wrote ROADMAP.md + STATE.md

**What's next:** `/gsd-plan-phase 1` to decompose Phase 1 into plans.

---
*State file: project memory for the Brain orchestrator.*
*Last updated: 2026-05-21 after roadmap creation.*
