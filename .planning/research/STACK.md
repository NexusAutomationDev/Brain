# Stack Research

**Domain:** Cross-Brain lead handoff + per-brain-type seed scoping (v1.6 milestone — extension of existing Brain Core stack)
**Researched:** 2026-08-12
**Confidence:** HIGH (primary conclusion is codebase-derived); MEDIUM on the general ecosystem framing (corroborated by official Drizzle docs + rabbitmq-client docs via web search, which the confidence seam scores LOW by default for raw `websearch` regardless of domain — treat the specific citations below as authoritative since they are the vendor's own docs/npm registry pages, not third-party blogs)

## Headline Conclusion

**No new runtime, HTTP framework, ORM, message-broker, or RPC library is needed for either feature.** Both (a) and (b) are solved entirely by extending SDK primitives that already exist in this codebase (`packages/core`, `packages/database`) using patterns already proven elsewhere in the project. This is a "wire the existing pieces together correctly" milestone, not a "add a dependency" milestone.

## Recommended Stack

### Core Technologies (all already in the stack — reused, not new)

| Technology | Version (pinned) | Purpose in v1.6 | Why (not something new) |
|------------|-------------------|------------------|--------------------------|
| `drizzle-orm` | 0.45.2 (pinned in `packages/core`, `packages/database`) | Application-level idempotent seed upserts, per `brain_type` | Same `db.insert(...).onConflictDoUpdate()` idiom already implemented in `packages/core/src/prompts/loader.ts::upsertPrompts()` — just needs to be (1) wired into `init()`, not only `refreshPrompts()`, and (2) mirrored for `fup_config` |
| `postgres` (postgres.js) | ^3.4.9 | Sql pool for the new `transfer_lead` tool + target-side lead upsert | Identical factory-over-`Sql` closure pattern as `packages/core/src/tools/pause-session.ts` / `finish-conversation.ts` |
| `hono` | ^4.12.x | One new authenticated route: `POST /handoff/receive` in `packages/core/src/server.ts` | Same file, same auth/fail-closed pattern already used for `/reload-prompts` and `/debug/inject-message` |
| `@langchain/langgraph` | ^1.4.1 | Seed conversation context into the target Brain's own checkpoint on handoff | `compiledGraph.updateState(...)` is **already exposed** as `BrainRunner.injectMessage()` (packages/core/src/runner/runner.ts) — this is literally the primitive the milestone brief flags as a candidate; no new LangGraph API surface needed |
| Native `fetch()` (Bun/runtime built-in) | — | Brain-to-Brain HTTP call from the `transfer_lead` tool | Same call shape as `EventPublisher._publishWebhook()` (packages/core/src/events/event-publisher.ts), except **awaited**, not fire-and-forget (see rationale below) |
| `rabbitmq-client` | ^5.0.8 (pinned) | Unchanged — still only Transport ingestion + fire-and-forget `IEventPublisher` | Explicitly **not** used for the handoff RPC itself — see Alternatives Considered |

### Net-New Code (no new npm packages)

| Addition | Location | Mirrors existing pattern |
|----------|----------|---------------------------|
| `upsertFupConfig(sql, brainType, defaults)` | `packages/database` (alongside `upsertPrompts`) | `upsertPrompts()` — `ON CONFLICT (brain_type) DO NOTHING/UPDATE` |
| `IBrain.defaultFupConfig?: FupConfigDefaults` | `packages/core/src/brain/interface.ts` | `IBrain.defaultPrompts?` |
| Call `upsertPrompts()` + `upsertFupConfig()` from `BrainRunner.init()`, not only `refreshPrompts()` | `packages/core/src/runner/runner.ts` | Same function, new call site |
| `POST /handoff/receive` route | `packages/core/src/server.ts` | `POST /debug/inject-message` (shared-secret header, 503 fail-closed if unconfigured, 401 on mismatch) |
| `HANDOFF_TOKEN` env (distinct from `ADMIN_TOKEN`) | per-Brain `.env.example` | `ADMIN_TOKEN` |
| `createTransferLeadTool(sql, targetRegistry)` | `packages/core/src/tools/transfer-lead.ts` | `createPauseSessionTool(sql)` / `createFinishConversationTool(sql)` — factory-over-`Sql` closure, `thread_id` from `RunnableConfig`, never from LLM args |
| `"transfer_lead"` added to `TOOL_EVENTS_WHITELIST` | `packages/core/src/runner/runner.ts` | Existing whitelist already drives `IEventPublisher` for `qualify_lead`/`pause_session`/`finish_conversation` — new tool gets external-event notification for free |
| Agent-name → base-URL/token registry, ENV-driven (e.g. `HANDOFF_TARGETS` JSON, or `HANDOFF_URL_<AGENT_NAME>` per-agent envs) | new small module in `packages/core` | Satisfies "nomes de agente configuráveis, não fixos em 2-3 tipos" — same spirit as `BRAIN_TOOLS` CSV whitelist being ENV-driven rather than hardcoded |

## Feature (a): Per-Brain-Type Scoped Seeding

### Root cause (confirmed by reading the code)

`MIGRATIONS_FOLDER` is set to the **same** `packages/database/src/migrations` path in every Brain's `.env.example` (`brain-sdr`, `brain-support`, `brain-echo`). `runMigrations()` (packages/database/src/migrate.ts) calls Drizzle's `migrate(db, { migrationsFolder })`, which applies **every** entry in that single shared `_journal.json` unconditionally, tracked in one `drizzle.__drizzle_migrations` table per database. Three of those migration files are actually **data seeds**, not schema DDL:

- `0002_echo_brain_seed.sql` — `brain_type='echo'` prompts
- `0005_brain_sdr_prompts.sql` — `brain_type='sdr'` prompts
- `0010_brain_support_prompts.sql` — `brain_type='support'` prompts

Every Brain image runs all three, so e.g. brain-sdr's database ends up with `support`'s and `echo`'s prompt rows too (harmless-but-wrong pollution) — and critically, **no migration ever inserts a `prompts.key='fup'` row or a `fup_config` default row for any brain_type**, so `FupScheduler` has nothing to read out of the box (confirmed: `fup_config` has no seed anywhere in `packages/database/src/migrations`, and `fupConfig` schema's only PK is `brain_type` with no default row inserted).

### Recommendation: application-level seed step, not per-app migrations folder, not tagged-file filtering

Confirmed against Drizzle's own guidance (see Sources): the idiomatic split is **schema-defining data stays in migrations; environment/tenant-specific data moves to an app-level seed script using the ORM's insert API**, decoupled entirely from `drizzle-kit`'s migration journal. Applied here:

1. **Schema DDL stays in the single shared `packages/database/src/migrations` folder, unchanged.** All Brain types genuinely share the same tables (`prompts`, `fup_config`, `leads`, `knowledge_chunks`) — this part of the current design is *correct* and should not be forked per app.
2. **Brain-type-specific rows move out of the migration journal into an application-level, idempotent upsert step**, gated by the running Brain's own identity (`brainType`) — exactly the mechanism that **already exists but is incompletely wired**:
   - `upsertPrompts(sql, brainType, defaultPrompts)` (packages/core/src/prompts/loader.ts) is already `(brain_type, key)`-scoped and `ON CONFLICT DO UPDATE` idempotent. Today it only runs when `POST /reload-prompts` is called manually (via `refreshPrompts()`), **not** at `init()` — so a brand-new database still depends on the raw-SQL seed migrations to have any prompt rows at all before `loadPrompts()` runs (which `process.exit(1)`s on a missing key). Fix: call `upsertPrompts()` from `init()` whenever `this.brain.defaultPrompts` is set, before `loadPrompts()`.
   - Add the same pair for FUP: `IBrain.defaultFupConfig?: FupConfigDefaults` + `upsertFupConfig(sql, brainType, defaults)`, called from the same `init()` step. Each Brain app declares its own `defaultPrompts` (including `key: 'fup'`) and `defaultFupConfig` in its own `brain.ts` — code is the source of truth per Brain, extending the existing D-07 rationale rather than inventing a new one.
3. **Retire the raw-SQL seed migrations as the source of truth going forward** (0002/0005/0010 stay in the journal for already-deployed databases — do not delete/renumber applied migrations, that's a migration-integrity pitfall, not a stack decision) but stop treating "add a new migration file" as how future Brain types get seeded.

### Alternatives considered and rejected

| Alternative | Why not |
|---|---|
| Per-app migrations folder (each Brain app gets its own copy of `packages/database/src/migrations`) | Forks schema DDL 3+ ways for tables that are genuinely identical across Brain types — `drizzle-kit generate` diffing three independent journals against the same logical schema is a guaranteed future drift/PITFALL source (echo's schema silently diverging from sdr's) |
| Brain-type-tagged seed files inside the shared folder, filtered at runtime | Drizzle's `migrate()` applies the **entire** journal unconditionally — there is no supported hook to conditionally skip specific journal entries per consumer; would require monkey-patching the migrator internals, unsupported and fragile |
| `drizzle-seed` npm package | Purpose-built for generating **fake/randomized data at dev time** (`db.seed(schema).refine(...)`), not for deterministic, idempotent, production default-row seeding gated by application identity — wrong tool for this job |

## Feature (b): Cross-Database Lead Handoff

### Constraint framing

Two Brains may run against **completely separate PostgreSQL databases** (different `DATABASE_NAME`, potentially different host) — this is the same multi-tenant isolation boundary (`TenantPoolManager`, 1 DB per client scope) already enforced in production, just crossed between two different Brain *types* serving the same client.

### Recommendation: synchronous HTTP endpoint (Brain-to-Brain), same shape as `/debug/inject-message` — not direct cross-DB SQL, not event/queue-based

**1. Direct cross-database SQL access — ruled out.** Giving Brain A raw `DATABASE_URL`/credentials to Brain B's Postgres (possibly a different host) means distributing DB credentials cross-image and bypassing Brain B's own domain logic (`LeadService.upsert()` dedup-by-`numero`, `ia_ativada` gating, FUP state reset on new message). This breaks the "each Brain owns its own database" boundary that the whole multi-tenant architecture is built on. Never do this.

**2. `IEventPublisher` (fire-and-forget) — ruled out for the transfer-of-record itself.** `EventPublisher`/`NoopEventPublisher` (packages/core/src/events/event-publisher.ts) is explicitly designed to **never block and never guarantee delivery** (D-08: "absorver silenciosamente — nunca bloquear a resposta ao lead"). That's correct for side-channel notification (CRM sync, analytics webhook) but wrong for the handoff itself: the source Brain needs a definite success/failure signal *before* it can safely deactivate `ia_ativada` on its own lead row — an unconfirmed fire-and-forget event risks a lead silently falling into a gap if the target Brain (or its webhook/queue) is down. The existing event channel remains the right mechanism for *notifying external systems that a transfer happened*, not for performing it.

**3. RabbitMQ RPC (`rabbitmq-client`'s `createRPCClient()` / `reply_to`+`correlation_id`) — a real option, deliberately not chosen.** `rabbitmq-client` (already pinned at ^5.0.8) does support a request/reply RPC pattern. It was rejected here because:
   - `TRANSPORT` (webhook vs rabbitmq) is an independent per-Brain ENV choice — RabbitMQ is **not guaranteed** to be configured on every Brain image, whereas the Hono HTTP server (serving `/health`, `/reload-prompts`, `/debug/inject-message`) is always up. Making handoff depend on RabbitMQ would mean it only works for the subset of Brain pairs that both happen to run `TRANSPORT=rabbitmq` with a shared broker.
   - RPC-over-queue adds topology (reply queue, correlation-id bookkeeping, broker reachability from both sides) for a low-volume, point-to-point, operator/LLM-triggered event — not a throughput or durability problem that justifies it.

**4. HTTP endpoint, synchronous, same auth pattern as `/debug/inject-message` — recommended.**

- **New route:** `POST /handoff/receive` in `packages/core/src/server.ts`. Named distinctly from `/debug/*` since this is a production SDK capability, not a debug tool. Same fail-closed precedent: 503 if its token env is unset, 401 on mismatch, never distinguishing "missing" vs "wrong" token in the response.
- **New env:** `HANDOFF_TOKEN`, separate from `ADMIN_TOKEN`, so this secret can be scoped/rotated independently of admin/debug access, and so different agent pairs could in principle use different values if the registry design calls for it.
- **Body shape:** `{ leadPayload: { uniqueId, nome, numero, idDeal?, idContato? }, contextMessages: string[], sourceBrainType: string }` — `contextMessages` is either a condensed LLM-generated summary or the last-N turns (a phase-planning decision, not a stack decision).
- **Target-side handler, in the target Brain's own process, against its own DB — no new checkpoint-writing logic needed:**
  1. `LeadService.upsert()` (existing service, existing call site — same one every Brain's transport handler already calls on first contact) creates/updates the lead row in the target's own database.
  2. Reuse `BrainRunner.injectMessage(threadId, content)` — the **already-built** primitive (packages/core/src/runner/runner.ts, shipped in commit `beedaca`/`8423284`) — to seed the new thread's checkpoint with the handoff context as a synthetic `AIMessage` via `compiledGraph.updateState()`, before the lead's next real message triggers the graph. This is exactly why that endpoint was flagged as a "candidate primitive" in the milestone brief: it *is* the primitive. The only new work is the wrapper endpoint + auth + lead upsert, not new checkpoint logic.
- **Source-side:** a new native tool `createTransferLeadTool(sql, targetRegistry)`, same factory-over-`Sql`-closure idiom as `pause-session.ts`/`finish-conversation.ts` (`thread_id` read from `RunnableConfig`, never trusted from LLM args):
  1. Looks up the target Brain's base URL + token from an ENV-driven registry keyed by agent name (satisfies "nomes de agente configuráveis, não fixos em 2-3 tipos" — do not hardcode a `sdr | support | echo` union anywhere in this tool).
  2. Does a **synchronous, awaited** `fetch()` POST — same call shape as `EventPublisher._publishWebhook()` (`AbortSignal.timeout(...)`), but awaited rather than fire-and-forget, because the tool's return value **is** the confirmation the graph needs.
  3. On success, calls the same local DB update pattern as `finish_conversation` to deactivate `ia_ativada` on the source lead (and, per the milestone's tool-decision framing, likely `fullpp`/FUP fields too — a phase-planning detail).
  4. On failure/timeout, returns an error-shaped string (`{"status":"error",...}`) so `isErrorToolResult()` (already in `event-publisher.ts`, EVT-06) correctly suppresses a false "transfer succeeded" event, and the LLM/flow can retry or escalate.
- **Free integration:** add `"transfer_lead"` to `TOOL_EVENTS_WHITELIST` (packages/core/src/runner/runner.ts) — the existing `IEventPublisher` wiring in `run()` already iterates the whitelist generically, so external systems (CRM, etc.) get notified of successful transfers with zero new publisher code.

### What NOT to add

| Avoid | Why | Use instead |
|-------|-----|--------------|
| A new message-broker dependency (BullMQ, additional RabbitMQ topology, SQS) | No throughput/durability requirement — handoff is a rare, single-lead, operator/LLM-triggered event, not a stream | Synchronous HTTP + existing retry idiom |
| A generic RPC/gRPC library (`grpc-js`, tRPC, etc.) | Introduces a second wire protocol next to the existing Hono HTTP surface for one endpoint | Plain Hono route, same as `/debug/inject-message` |
| A saga/workflow-orchestration client (e.g. Temporal) | The operation is one HTTP call + two independent local DB writes (source deactivate, target upsert+inject), not a multi-step long-running workflow | Hand-rolled retry (2-3 attempts) mirroring `isLockNotAvailable` retry loop already in `packages/database/src/migrate.ts` |
| Direct `DATABASE_URL` access from Brain A into Brain B's database | Breaks the "1 database per client, each Brain owns its own DB" isolation boundary; bypasses target's own domain logic | HTTP call into the target Brain's own process, which writes to its own DB via its own services |
| Reusing `ADMIN_TOKEN` for the handoff endpoint | Conflates debug-only access with a production SDK capability; can't rotate/scope independently | Dedicated `HANDOFF_TOKEN` env |

## Installation

No new dependencies to install. All additions are new TypeScript modules/functions/routes inside `packages/core` and `packages/database`, using packages already present in `package.json`.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Seed scoping | App-level upsert step gated by `brainType`, wired into `init()` | Per-app migrations folder | Forks identical schema DDL 3+ ways — drift risk across Brain images |
| Seed scoping | App-level upsert step | Tagged seed files filtered at migration-run time | Drizzle's `migrate()` has no supported partial-journal-application hook |
| Seed scoping | Hand-written `upsertPrompts`/`upsertFupConfig` (already exists for prompts) | `drizzle-seed` package | Built for randomized dev/test data generation, not deterministic production default rows |
| Lead handoff transport | Synchronous HTTP endpoint | RabbitMQ RPC (`createRPCClient`) | RabbitMQ not guaranteed configured on every Brain; adds topology for a low-volume point-to-point call |
| Lead handoff transport | Synchronous HTTP endpoint | `IEventPublisher` fire-and-forget | No delivery/success confirmation — wrong for a transfer-of-record, right only for notifying external systems afterward |
| Lead handoff transport | HTTP call into target's own process/DB | Direct cross-database SQL from source Brain | Breaks per-client DB isolation boundary; bypasses target's own domain logic |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `drizzle-orm@0.45.2` | `postgres@^3.4.9`, `drizzle-kit@^0.31.10` | Already validated in production by this project — no version change needed for either feature |
| `@langchain/langgraph@^1.4.1` | `compiledGraph.updateState()` | Already used in production via `BrainRunner.injectMessage()` — no version change needed |
| `hono@^4.12.x` | New route in existing `createCoreApp()` | Purely additive — no version change needed |
| `rabbitmq-client@^5.0.8` | Supports `createRPCClient()` if ever reconsidered | Confirmed present in current version, but deliberately not adopted for this milestone (see Alternatives) |

## Sources

- Codebase inspection (primary source, HIGH confidence): `packages/core/src/runner/runner.ts`, `packages/core/src/server.ts`, `packages/core/src/prompts/loader.ts`, `packages/core/src/brain/interface.ts`, `packages/core/src/tools/{pause-session,finish-conversation,registry}.ts`, `packages/core/src/events/event-publisher.ts`, `packages/database/src/migrate.ts`, `packages/database/src/migrations/{0002,0005,0007,0010}*.sql`, `packages/database/src/schema/tables.ts`
- Drizzle Seed overview (official docs) — confirms `drizzle-seed` is a dev/test data generator, not a production seeding mechanism: https://orm.drizzle.team/docs/seed-overview
- Drizzle Kit custom migrations (official docs) — confirms migrations are schema-focused; data seeding is treated as a separate concern: https://orm.drizzle.team/docs/kit-custom-migrations
- `rabbitmq-client` npm package + docs — confirms `createRPCClient()`/request-reply is available in the already-pinned version: https://www.npmjs.com/package/rabbitmq-client, https://cody-greene.github.io/node-rabbitmq-client/latest/index.html

---
*Stack research for: v1.6 — Cross-Brain lead handoff + per-brain-type seed scoping*
*Researched: 2026-08-12*
