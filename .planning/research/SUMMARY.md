# Project Research Summary

**Project:** Brain Core v1.1 — RabbitMQ Transport + Brain SDR + Lead Management
**Domain:** Modular AI agent platform — async transport, lead identity, WhatsApp SDR conversations
**Researched:** 2026-06-13
**Confidence:** HIGH

## Executive Summary

Brain Core v1.1 is an incremental build on top of a validated v1.0 foundation. The work centers on three interlocked concerns: (1) plugging a second transport into the existing `ITransport` interface (RabbitMQ via `rabbitmq-client`), (2) replacing the generic `users` table with a domain-specific `leads` table that drives conversation thread anchoring, and (3) shipping the first real Brain — Brain SDR — which qualifies leads over WhatsApp using LangGraph-orchestrated conversations. No new packages are needed beyond the RabbitMQ client, and no version bumps are required in the current lockfile.

The critical architectural decision for v1.1 is that `leads.unique_id` (mapped from `IDLead` in incoming messages) becomes the `thread_id` for all LangGraph checkpoints. This single mapping — set once in `BrainRunner.run()` — gives every Brain persistent, lead-scoped conversation memory automatically. Everything downstream (context recovery, qualification state continuity) derives from getting this binding right. The stack also contains two existing gaps (GAP-1 in WebhookTransport runner injection, and the `amqplib-bun` vs `rabbitmq-client` package decision) that must be resolved before any new feature work begins.

The highest risks in v1.1 are operational, not architectural: RabbitMQ consumer crashes from unhandled channel errors (INT-01), unacked messages freezing the queue on LangGraph exceptions (INT-02), and concurrent startup races in Drizzle migrations (INT-08). These are all preventable with established patterns. Brain SDR's qualification logic is the highest-effort work but follows proven patterns. The recommended approach is to ship a single-graph SDR in v1.1 and extract the qualification sub-agent to v1.2 once the conversation flow is validated.

---

## Key Findings

### Stack Additions

The v1.0 stack is unchanged and validated. The only new dependency is `rabbitmq-client@^5.0.8`, which supersedes the CLAUDE.md constraint naming `amqplib-bun`. The swap is warranted: `rabbitmq-client` is zero-production-dependencies, imports cleanly in Bun 1.3.2, provides built-in auto-reconnect, and avoids the `node:stream` compatibility issue (Bun #5627) that still affects `amqplib-bun`. No version bumps required — langgraph@1.4.1, checkpoint-postgres@1.0.3, drizzle-orm@0.45.2, postgres@3.4.9 are all current stable.

**New dependencies:**
- `rabbitmq-client@^5.0.8`: RabbitMQ async transport — zero deps, Bun-compatible, built-in auto-reconnect; replaces `amqplib-bun`

**New structural elements (code only, no packages):**
- `IBrainRunnerLike` promoted to `packages/transport/src/runner-contract.ts` (shared by both transports)
- `ILeadGate` in `packages/transport/src/lead-gate.ts` (allows transport to call lead lookup without importing from `core`)

**What NOT to add:** `amqplib` vanilla, `amqp-connection-manager`, `@langchain/community`, `bullmq`, any stream-dependent AMQP library.

---

### Feature Table Stakes

**RabbitMQ Consumer (non-negotiable):**
- Manual ack (`autoAck: false`) — ack only after BrainRunner returns; `nack(requeue=false)` for permanent failures
- `prefetch(1)` — one LLM call saturates a worker; `prefetch=0` causes unbounded heap growth
- Graceful SIGTERM shutdown — cancel consumer tag, wait for in-flight, then close
- Dead Letter Queue (DLQ) configured at queue assertion — never defer to v2
- Queue assertion with `{ durable: true }` on startup — fail fast if RabbitMQ unreachable

**Leads Schema (non-negotiable):**
- Auto-registration on first message via `INSERT ... ON CONFLICT (numero) DO NOTHING` + re-fetch
- `ia_ativada` checked as the FIRST gate after lead lookup — before any LangGraph invocation
- UNIQUE constraint on `leads.numero` in the migration SQL (not only Drizzle schema)
- `IDLead` → `unique_id` as stable cross-system identifier

**Conversation History (non-negotiable):**
- `thread_id = event.IDLead` — derived server-side, never from incoming payload
- `trimMessages` context window management from day one — SDR conversations span 30-80 turns; cannot retrofit
- No cross-lead thread_id leakage — always derive `thread_id` from `leads.unique_id` after DB lookup

**Brain SDR (non-negotiable):**
- One message per response (WhatsApp UX) — enforce via system prompt
- Qualification signals in LangGraph state fields, not only in message history
- `handoff_requested` flag in state when lead requests human or sufficient signals captured
- System prompt fetched from DB at runtime — qualification criteria must not be hardcoded

**Defer to v1.2:** qualification sub-agent as isolated subgraph; adaptive BANT/CHAMP routing; CRM write operations.

**Estimated effort:** ~9-12 days: RabbitMQ (2d), leads schema + service (1d), conversation history (1-2d), Brain SDR simplified (4-5d), GAP-1 fix (0.5d).

---

### Architecture Approach

v1.1 adds components within existing packages — no new packages, no new dep edges. The dep graph `apps/* → core → ai, memory, transport, database, observability, shared` is preserved. The key structural element is `ILeadGate` living in `packages/transport`, which allows both transports to call lead lookup without importing `LeadService` from `packages/core` (which would create a cycle).

**New components:**
1. `packages/transport/src/rabbitmq/handler.ts` — `RabbitMQTransport implements ITransport`; constructor-injected runner + leadGate; manual ack/nack
2. `packages/transport/src/runner-contract.ts` + `lead-gate.ts` — duck-type interfaces preventing circular deps
3. `packages/database/src/schema/leads.ts` + migration — `leads` table; UNIQUE on `numero`; do NOT drop `users`
4. `packages/core/src/leads/service.ts` — `LeadService` with `findOrCreate` via `ON CONFLICT`
5. `apps/brain-sdr/` — new app parallel to `brain-echo`; LangGraph state with qualification fields

**Modified components:**
- `packages/transport/src/webhook/events.ts` — breaking schema change: `{Name, Message, Numero, IDLead}` replaces `{conversationId, stepIndex, userId, content}`; all test fixtures must update in the same PR
- `packages/transport/src/webhook/handler.ts` — GAP-1 fix: runner + leadGate constructor injection
- `packages/transport/src/factory.ts` — updated signature: `createTransport(runner, leadGate?, type?)`
- `packages/core/src/runner/runner.ts` — field mapping: `event.IDLead → threadId`, `event.Numero → userId`

**Build order (dependency-enforced):**
- Step 1: BrainEvent schema + transport infrastructure (GAP-1, shared interfaces, factory)
- Step 2: Leads schema + Drizzle migration (schema file + generated SQL committed together)
- Step 3: LeadService in `packages/core`
- Step 4: RabbitMQ transport (can run parallel to Step 3 once ILeadGate is defined)
- Step 5: BrainRunner field mapping (can merge with Step 1)
- Step 6: Brain SDR (depends on all prior steps)

---

### Critical Pitfalls

**v1.1-specific (highest severity):**

1. **INT-01: Unhandled channel closure crashes Bun process (CRITICAL)** — Attach `connection.on('error')` and `channel.on('error')` listeners; reconnect in `close` handler. Without this, any RabbitMQ blip kills the container and corrupts in-flight LangGraph checkpoints.

2. **INT-02: LangGraph throw leaves message unacked — queue freezes (CRITICAL)** — Wrap all consumer processing in `try/catch`; always call ack or nack. `nack(false, false)` for deterministic failures; `nack(false, true)` for transient only. DLX must be configured in the same phase as the consumer.

3. **INT-05: Concurrent upsert creates duplicate lead rows (HIGH)** — Use `INSERT ... ON CONFLICT (numero) DO UPDATE` as a single statement then re-fetch. UNIQUE constraint on `numero` must be in migration SQL, not only Drizzle schema.

4. **INT-04: `users` table migration breaks existing data (HIGH)** — Add `leads` additively; do NOT drop `users` in v1.1. Existing EchoBrain checkpoints used UUID-format thread_ids that won't resolve via the new IDLead-based lookup.

5. **INT-08: Concurrent startup race in Drizzle migrations (MEDIUM)** — Add `pg_advisory_lock(7246842)` around `runMigrations()`. Safe with postgres.js directly (not PgBouncer).

6. **INT-10: Context window overflow breaks long SDR conversations (MEDIUM)** — Implement `trimMessages` from day one in Brain SDR graph node. Once a thread overflows it becomes permanently unresponsive.

7. **INT-11: GAP-1 WebhookTransport runner not injected (MEDIUM)** — Fix constructor injection before changing BrainEvent field names. Without this fix, webhook returns `{status: "accepted"}` with no LLM call.

**v1.0 pitfalls still relevant for SDR:**
- Pitfall 4 (LangGraph state schema evolution) — add `schema_version` field and default values for all Brain SDR state fields from day one
- Pitfall 9 (recursion limit) — set `recursionLimit: 100` for SDR; default 25 is too low for qualification patterns
- Pitfall 19 (subgraph checkpointer inheritance) — relevant when extracting qualification sub-agent in v1.2

---

## Implications for Roadmap

### Phase 1: Transport Foundation + Schema Contract

**Rationale:** Every downstream component depends on the canonical `BrainEvent` shape and the corrected `createTransport()` factory. GAP-1 must be fixed before new field names are introduced. Migration race condition (INT-08) and PostgresSaver setup race (INT-09) must also be addressed here — they block safe multi-instance deployment of everything that follows.

**Delivers:** Correct WebhookTransport constructor injection; standardized BrainEvent schema (`{Name, Message, Numero, IDLead}`); shared `IBrainRunnerLike` and `ILeadGate` interfaces; advisory lock in `runMigrations()`; updated `createTransport()` factory.

**Addresses:** INT-11 (GAP-1), INT-03 (schema divergence between transports), INT-08 (migration race), INT-09 (PostgresSaver setup race)

**Constraint:** BrainEvent field rename and test fixture updates must be in the same PR — atomic change.

---

### Phase 2: Leads Schema + Migration

**Rationale:** LeadService depends on the leads schema. The migration file must be committed before any Brain starts up against a real DB. Cannot build the RabbitMQ consumer or Brain SDR without `leads` table.

**Delivers:** `packages/database/src/schema/leads.ts` with UNIQUE on `numero`; Drizzle-generated migration SQL committed alongside schema; schema exported from database barrel.

**Addresses:** INT-04 (additive migration strategy — no DROP users), INT-05 (UNIQUE constraint in migration SQL)

**Constraint:** Migration SQL file must be committed in the same PR as the schema file. Do not drop `users`.

---

### Phase 3: LeadService + RabbitMQ Consumer

**Rationale:** Both depend on Phase 2 (leads table) and Phase 1 (ILeadGate interface). Can develop in parallel — LeadService and RabbitMQ handler each implement/satisfy ILeadGate independently.

**Delivers:** `packages/core/src/leads/service.ts` with upsert via `ON CONFLICT`; `packages/transport/src/rabbitmq/handler.ts` using `rabbitmq-client`; manual ack/nack with DLX; graceful SIGTERM shutdown; integration test against real RabbitMQ.

**Addresses:** INT-01 (unhandled channel closure), INT-02 (unacked message), INT-05 (concurrent upsert via ON CONFLICT), FEATURES.md anti-features (requeue=true, autoAck, unlimited prefetch)

**Stack note:** Use `rabbitmq-client` (zero deps, Bun-tested) not `amqplib-bun`.

---

### Phase 4: BrainRunner Field Mapping + Conversation History

**Rationale:** Mechanically simple but sequentially required. `BrainRunner.run()` must map `event.IDLead → threadId` before Brain SDR can use persistent memory. Context window trimming must be implemented here — cannot be retrofitted after Brain SDR ships.

**Delivers:** `BrainRunner.run()` field mapping update; `thread_id = event.IDLead`; `trimMessages` context window management utility; updated integration tests.

**Addresses:** INT-10 (context window overflow), INT-03 (consistent field mapping), FEATURES.md anti-feature (per-session thread_id)

---

### Phase 5: Brain SDR Application

**Rationale:** Terminal feature — consumes all prior phases. Correct approach: green test suite for Phases 1-4 before writing brain-sdr code.

**Delivers:** `apps/brain-sdr/` with Dockerfile; LangGraph state schema with qualification fields (`qualificado`, `budget_hint`, `need_hint`, `timeline_hint`, `handoff_requested`); structured LLM output for qualification signal extraction; personalized greeting via `nome`; prompts seed SQL for `brain_type="sdr"`; integration test for full message flow including `ia_ativada` skip path.

**Addresses:** INT-10 (trimMessages in graph node), FEATURES.md anti-features (scripted BANT sequence, multiple messages per response, hardcoded criteria, CRM writes)

**Scope boundary:** Single-graph SDR. Qualification sub-agent extraction → v1.2. CRM integration → v2.

---

### Phase Ordering Rationale

- Phase 1 must be first: both transports share BrainEvent schema — a partial change creates a window where webhook and RabbitMQ diverge
- Phase 2 can technically parallel Phase 1 (schema has no dep on events.ts) but is ordered second so migration SQL exists before Phase 3 integration tests run
- Phase 3 can begin once ILeadGate is defined (end of Phase 1), even while LeadService is in progress
- Phase 4 depends only on Phase 1 (BrainEvent shape) — could merge with Phase 1 to reduce PR count
- Phase 5 depends on all previous phases — no shortcuts

### Research Flags

**Standard patterns — skip `/gsd-research-phase`:**
- Phase 1 (transport refactor, schema standardization) — internal codebase changes; all patterns clear from ARCHITECTURE.md
- Phase 2 (Drizzle schema + migration) — established pattern already in use; `drizzle-kit generate` is the only command needed
- Phase 4 (field mapping in BrainRunner) — single-file change with known target values

**May benefit from targeted research spike during planning:**
- Phase 3 (`rabbitmq-client` Consumer API) — package is new to codebase; confirm `createConsumer` + ack/nack method signatures from v5.0.8 docs before writing handler
- Phase 5 (Brain SDR graph design) — LangGraph state schema for qualification signals and `trimMessages` integration warrant a design spike before implementation to avoid Pitfall 4 (state schema evolution)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Packages verified in lockfile; `rabbitmq-client` import tested in Bun 1.3.2; no version bumps needed confirmed |
| Features | HIGH | RabbitMQ behaviors from official docs; LangGraph thread_id from PostgresSaver internals; WhatsApp SDR from production guides |
| Architecture | HIGH | Direct codebase analysis of all v1.0 source files; dep graph and component boundaries from actual code |
| Pitfalls | HIGH | All critical pitfalls traced to GitHub issues, official docs, or verified production incidents |

**Overall confidence:** HIGH

### Gaps to Address

- **`rabbitmq-client` Consumer API shape (Phase 3):** Package is installed but handler not written. Confirm exact `createConsumer` + ack/nack API from v5.0.8 before implementation — do not guess at method signatures.
- **Brain SDR qualification state schema (Phase 5):** Field names are defined but LangGraph state annotation + reducer design needs a short design spike. Once committed, treat as a one-way door (Pitfall 4).
- **`users` table deprecation timeline:** The additive migration strategy leaves `users` as dead weight. Capture deprecation decision as a task before v1.2 planning.
- **TenantPoolManager activation:** Scoped for v1.1 in PROJECT.md but flagged as a distraction risk (ARCHITECTURE.md Risk 5). Treat as isolated task; do not block Phase 5 on it.
- **DLQ monitoring:** v1.1 scoped to log-only; automated alerting deferred to v2. Document this boundary explicitly so ops is not surprised.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `packages/transport/src/`, `packages/core/src/`, `packages/database/src/schema/`, `apps/brain-echo/src/`
- `pnpm-lock.yaml` — all installed package versions confirmed
- `rabbitmq-client` v5.0.8 — zero deps confirmed, Bun 1.3.2 import tested
- RabbitMQ Consumer Acknowledgements official docs — https://www.rabbitmq.com/docs/confirms
- RabbitMQ Dead Letter Exchanges official docs — https://www.rabbitmq.com/docs/dlx
- `@langchain/langgraph-checkpoint-postgres` (v1.0.3) — PostgresSaver thread_id behavior
- LangGraph PR #2494 — PostgresSaver race condition fix

### Secondary (MEDIUM confidence)
- LangGraph issue #2040 — cross-thread checkpoint contamination report
- CloudAMQP RabbitMQ Best Practices — prefetch sizing for LLM workloads
- Zylos Research 2026 — context window management for long-running agents
- WhatsApp SDR qualification pattern research (trypeach.ai, monday.com, setsmart.io, trengo.com)
- Drizzle ORM migrations in production (advisory lock pattern) — dev.to

### Tertiary (LOW confidence — needs implementation validation)
- `trimMessages` token counting accuracy with `bun test` — needs integration test verification
- DLQ routing behavior with `rabbitmq-client` v5 — needs smoke test against real RabbitMQ

---

*Research completed: 2026-06-13*
*Ready for roadmap: yes*
