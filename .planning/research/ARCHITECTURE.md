# Architecture Research

**Domain:** Multi-agent lead handoff + per-brain-type seed scoping — Brain Core v1.6
**Researched:** 2026-08-12
**Confidence:** HIGH (grounded directly in current repo source — `packages/core`, `packages/database`, `packages/transport`, `packages/ai`, `apps/brain-{sdr,support,echo}`)

This is integration-point research against the ACTUAL existing codebase, not a generic ecosystem survey. Every claim below is traced to a real file/line read during research.

## Part A — Per-brain-type scoped seeding

### The bug, precisely

`packages/database/src/migrate.ts::runMigrations(sql, migrationsFolder)` wraps drizzle-kit's `migrate(db, { migrationsFolder })` in a `_schema_lock` row-lock transaction. Drizzle's migrator reads **the entire folder + its own `meta/_journal.json`** and applies every migration file not yet recorded — it has no concept of "brain type," only of DDL files in sequence.

Confirmed contamination: `packages/database/src/migrations/` contains, alongside pure schema DDL (0000, 0001, 0003, 0004, 0006-0009, 0011), three **seed-only** files that are 100% `INSERT INTO prompts ... ON CONFLICT DO NOTHING` with no DDL:
- `0002_echo_brain_seed.sql` → `brain_type='echo'`
- `0005_brain_sdr_prompts.sql` → `brain_type='sdr'`
- `0010_brain_support_prompts.sql` → `brain_type='support'`

Every Brain's `Dockerfile` (`apps/brain-sdr/Dockerfile:95`, `apps/brain-support/Dockerfile:97` — comment literally says *"D-04: packages/database/src/migrations é compartilhado entre todos os Brains"*) copies this **entire** folder to `/app/migrations`, and every `.env.example` sets `MIGRATIONS_FOLDER=../../packages/database/src/migrations` pointing at the same shared tree. Result: brain-sdr's database ends up with `echo` and `support` prompt rows too (harmless-but-wasteful today because `loadPrompts()` double-filters on `(brain_type, key)` — see `packages/core/src/prompts/loader.ts:36-39` — but it is exactly the "leaking" the milestone wants closed).

Separately confirmed: **no migration anywhere inserts a `fup_config` row or a `prompts(key='fup')` row** for any brain type. `packages/core/src/fup/fup-scheduler.ts:148-160` queries `SELECT content FROM prompts WHERE brain_type = $1 AND key = 'fup'` directly and **logs a skip + does nothing** when it's missing ("prompt key='fup' não encontrado — pulando lead"). This is why FUP is silently dead on every fresh database today — not a scheduler bug, a missing-seed bug.

### Constraint: you cannot make drizzle-kit brainType-aware

Drizzle's migrator has no filtering hook. The only two ways to stop cross-seeding are (1) fork/patch the migrator, or (2) remove the brain-type-specific seed content from the drizzle-tracked folder entirely and apply it through a separate, non-drizzle idempotent mechanism. Given the codebase's own conventions (idempotent `ON CONFLICT DO NOTHING` INSERTs, already used for exactly this purpose), option 2 is the only one consistent with "don't break the shared-migrations convention more than necessary" — it changes *what* runs where, not *how* schema migrations run.

### Recommended design

**Split "schema" from "seed" as two mechanisms, not two migration folders:**

1. **Schema migrations — untouched.** `packages/database/src/migrations/` + `runMigrations()` + `_schema_lock` row-lock + `MIGRATIONS_FOLDER` ENV + Dockerfile `COPY .../migrations` stay **exactly as they are**. This is pure DDL, genuinely shared across every Brain type, and the row-lock/PgBouncer-compat work already done for it (D-06, PGB-02/03) must not be touched.
2. **New seed mechanism — per brain type, NOT drizzle-tracked.** Add `packages/database/src/seeds/<brainType>/` (e.g. `seeds/sdr/`, `seeds/support/`, `seeds/echo/`), each containing that brain's own idempotent SQL (or a small `.ts` seed descriptor — SQL is simpler and matches existing style). Add a new exported function `runBrainSeed(sql: Sql, brainType: string, seedsFolder: string): Promise<void>` in `packages/database` that reads and executes the SQL file(s) in that folder with the same `ON CONFLICT DO NOTHING` idempotency already used — **no drizzle, no journal, no migrator involved**, so there's nothing to reconcile against `__drizzle_migrations`/journal bookkeeping.
3. **Each Brain's Dockerfile copies only its own seed subfolder**, e.g. `COPY --from=builder /app/packages/database/src/seeds/sdr ./seeds` for brain-sdr, mirroring the existing `COPY .../migrations` line. New ENV `SEEDS_FOLDER` (parallel naming to `MIGRATIONS_FOLDER`) points at `/app/seeds` inside the image.
4. **`BrainRunner.init()` calls `runBrainSeed(this.sql, this.brain.brainType, seedsFolder)` immediately after `runMigrations()` and before `loadPrompts()`** (`packages/core/src/runner/runner.ts:141-189`) — ordering matters because the very next block validates `promptKeys` are all present and calls `process.exit(1)` otherwise (D-06 fail-fast); seeding must land before that check.
5. **Every brain type's seed folder gets two new rows added to what it already seeds**: a default `fup_config` row (`enabled=true`, sane `intervals_seconds`/`min_hour`/`max_hour`/`allowed_days`/`timezone`) and a `prompts(brain_type, key='fup', content=...)` row. This directly fixes the "no Brain has FUP out of the box" gap — `LeadService.upsertLead()` (`packages/core/src/leads/lead-service.ts:55-84`) already auto-activates `fup_enabled` the moment a `fup_config` row exists for that `brainType`, so this seed alone turns FUP on with zero other code changes.

**Why `ON CONFLICT DO NOTHING` scoped seeds are safe even if two brain types share one database** (an edge case the codebase does not fully prevent, even though `apps/brain-support/.env.example` explicitly documents the convention that co-located Brains for the same client should use *different* `DATABASE_NAME`s): every seed row is keyed by `(brain_type, key)` for prompts and `brain_type` (PK) for `fup_config`. Running brain-sdr's seed and then brain-support's seed against the same DB just adds two disjoint sets of rows — never overwrites, never cross-contaminates a query (loader.ts's `and(eq(brainType), inArray(key,...))` double-filter already guarantees this). No new risk is introduced by this design for the shared-DB edge case.

### Migration-risk rollout note (flag for phase-level validation)

Two rollout strategies exist for what to do with the *existing* 0002/0005/0010 seed migrations already recorded as applied in every deployed customer database:

- **Strategy A (bigger diff):** retroactively strip those three files + their `_journal.json` entries out of the shared schema folder now that their content lives in the new per-type seed mechanism. Requires verifying drizzle-kit's migrator doesn't choke when a target DB's `__drizzle_migrations` bookkeeping references a journal tag no longer present locally (my read of the migrator's reconciliation logic says this is safe — it only checks local-journal-entries against remote state, never the reverse — but this has **not been empirically verified against drizzle-kit source in this session** and should be tested against a DB carrying the full 0000-0011 history before relying on it).
- **Strategy B (recommended, lower risk):** leave 0000-0011 exactly as committed (accept the historical cross-seeding as inert legacy debt — it's dead rows, not a correctness bug, per the double-filter above). Ship the new per-type seed mechanism purely additively for what the milestone actually requires (fup_config + fup prompt for every brain type), and simply stop adding brain-type-specific seed content to the shared numbered-migrations folder from this point forward. This satisfies "without breaking the existing shared-migrations convention more than necessary" literally, and ships faster with zero regression risk to already-deployed databases.

Recommend **Strategy B** for v1.6; defer Strategy A to a future cleanup milestone if the dead rows ever become an actual operational problem.

## Part B — Multi-agent lead handoff

### What already exists that this reuses directly

| Existing primitive | File | Reused for handoff as |
|---|---|---|
| Tool factory closure-over-`sql` pattern | `packages/core/src/tools/pause-session.ts`, `finish-conversation.ts` | `createTransferLeadTool(sql, ...)` follows the identical shape: `thread_id` read from `config.configurable.thread_id`, never from the LLM (D-04) |
| `LeadService.setIaAtivada(uniqueId, value)` | `packages/core/src/leads/lead-service.ts:152-157` | **Already exists, currently dead code** (tech debt TD-04: "sem callers de produção"). Transfer-lead is the first real production caller — deactivates the source lead after a *confirmed successful* handoff. Ships as a byproduct: TD-04 gets resolved for free. |
| `BrainRunner.injectMessage(threadId, content)` + `compiledGraph.updateState()` | `packages/core/src/runner/runner.ts:287-305`, exposed via `packages/core/src/server.ts` `/debug/inject-message` | This is the exact primitive needed to seed the **destination** thread's checkpoint with handoff context, without invoking the destination's LLM. Built last milestone, designed for debug use — now gets its first real production caller. |
| One-shot stateless sub-agent reading checkpointer history | `apps/brain-sdr/src/qualifier.ts` (`runQualificationAgent`, reads via checkpointer, no own persisted state) + `FupScheduler`'s one-shot LLM generation via `PostgresSaver.getTuple()` (FUP-03) | Precedent/template for a new stateless "summarize this thread for handoff" sub-agent — same computational shape, different prompt |
| `IEventPublisher` + `TOOL_EVENTS_WHITELIST` | `packages/core/src/events/event-publisher.ts`, `packages/core/src/runner/runner.ts:36-40` | Adding `"transfer_lead"` to the whitelist gets the existing external-notification event `{action:"transfer_lead", lead, result}` **for free** — zero new plumbing for the "tell my CRM a handoff happened" concern |
| Admin-token auth pattern (`X-Admin-Token` vs `ADMIN_TOKEN`, fail-closed 503 if unset) | `packages/core/src/server.ts` (`/reload-prompts`, `/debug/inject-message`) | Exact auth model for the new Brain-to-Brain receiving endpoint — this is server-to-server traffic, not lead-facing traffic |
| FUP eligibility gate `WHERE fup_enabled = true AND ia_ativada = true` | `packages/core/src/fup/fup-scheduler.ts:113-114` | Confirms that deactivating `ia_ativada` on the source lead after transfer **automatically and correctly** removes it from future FUP scheduling — no separate "cancel pending FUP" call is needed |

### Answering the integration questions directly

**Does the source Brain need an HTTP client to call the destination's webhook, reusing the existing webhook shape? — No. New dedicated client + new dedicated endpoint.**

`POST /api/v1/webhook` (`packages/transport/src/webhook/handler.ts`) is shaped for **lead-facing traffic**: it validates `BrainEventSchema {Name, Message, Numero, IDLead}`, immediately calls `runner.run(event)`, which upserts the lead, checks `ia_ativada`, and **invokes the LLM**. None of that is correct for a handoff: a handoff must NOT trigger an LLM turn (the whole point is to seed context silently before the lead's next real message arrives), and its payload shape is different (needs a summary/history field, a `sourceBrainType`, no `Message` to reply to). Reusing it would require overloading its contract in a way that breaks its existing lead-facing semantics.

`IEventPublisher` is also the wrong fit, for a different reason: it is explicitly designed as **fire-and-forget, one-directional, single-destination-per-Brain** notification (one `TOOL_EVENTS_URL`/`TOOL_EVENTS_QUEUE` per Brain instance, not one-per-named-agent), with no response/ack path. The transfer_lead tool's own success/failure **must** be awaited synchronously — the decision to deactivate the source lead's `ia_ativada` depends on the destination confirming receipt — which is structurally incompatible with EventPublisher's D-08 "never await, absorb failures silently" contract. Keep `IEventPublisher` doing exactly what it does today (notify externally that a transfer happened, via the whitelist addition); it is not the transfer mechanism itself.

**Recommended: a new synchronous Brain-to-Brain HTTP call, admin-authenticated, hitting a NEW endpoint:**
- New client: `packages/core/src/handoff/handoff-client.ts` — small `fetch()`-based client (same shape as `EventPublisher._publishWebhook`'s pattern, but **awaited**, not fire-and-forget, with a longer timeout than EVT's 5s since a summary + DB write on the destination happens synchronously inside the request — recommend `AbortSignal.timeout(10000)`).
- New endpoint: `POST /api/v1/handoff` in `packages/core/src/server.ts`, alongside `/reload-prompts` and `/debug/inject-message`, same `X-Admin-Token`/`ADMIN_TOKEN` fail-closed auth model. (Promote this out of the `/debug/*` namespace — unlike `injectMessage`, this is a first-class production feature, not a debugging aid, even though it reuses the debugging primitive internally.)
- New `BrainRunner.receiveHandoff(payload)` method — thin orchestration only, no new LangGraph mechanics:
  1. `await this.leadService.upsertLead(payload.numero, payload.uniqueId, payload.nome, this.brain.brainType)` — reuses the existing method verbatim, which means the incoming lead **automatically becomes FUP-eligible** on the destination if that brain type's `fup_config` is seeded (Part A dependency — see Build Order below).
  2. `await this.injectMessage(payload.uniqueId, payload.summary)` — reuses the existing primitive verbatim to seed the destination's checkpoint with an AIMessage carrying the handoff context, without invoking the destination LLM.
  3. Return 200 only after both steps succeed.

**How does conversation-context continuity work?**

At transfer time, the **source** Brain's `transfer_lead` tool handler (not the destination) is responsible for producing the context to hand over, since it has ready access to the live thread's checkpoint state (`this.compiledGraph.getState({configurable:{thread_id}})`, the same primitive `BrainRunner.run()` already uses at `runner.ts:366-369` to read `historicalMessages`). Recommended v1 approach, mirroring the FUP-03 precedent (one-shot LLM condensation of checkpointer history, no persisted sub-agent state): a new stateless module `packages/core/src/handoff/summarize.ts` that takes the raw message history and produces a short handoff summary string via one `createLLM()` call — same shape as `qualifier.ts`'s `runQualificationAgent`. That summary string is what travels over the wire to `/api/v1/handoff` and becomes the single `injectMessage()` payload on the destination. (A raw-history / multi-message injection variant is possible as a v2 enhancement — see Open Questions — but a single AIMessage summary is the smallest correct increment and matches the shape `injectMessage()` already supports without any LangGraph-side changes.)

**Does the destination need a registry of "known agents"? Where does it live?**

Yes — the milestone explicitly requires agent names to be **configurable, not fixed to 2-3 hardcoded types** ("nomes de agente configuráveis"). None of the three existing config idioms in the codebase fit a growable N-entry registry cleanly:
- ENV vars (`TOOL_EVENTS_URL`, `FUP_WEBHOOK_URL`, `MCP_URL`) are single-value-per-concern — fine for "this Brain's one event sink" but wrong shape for "this Brain's N possible handoff destinations, each with its own base URL + its own admin token."
- A `config.json`-style file requires a redeploy to add/rotate an agent — inconsistent with how `fup_config` and `prompts` (the two closest analogues, both per-deployment tunables) are already modeled as **database tables**, changeable per-client without a rebuild.

**Recommended: a new `agents` table**, added to the shared schema migrations folder (real DDL, applies uniformly to every Brain type — unlike Part A's seeds, this is genuinely shared schema since any Brain could be a source or a destination):

```
agents (
  name          text PRIMARY KEY,   -- what the LLM's tool-call argument references
  brain_type    text NOT NULL,      -- destination's own brainType, for observability/logging only
  base_url      text NOT NULL,      -- destination Brain's reachable HTTP base (own host/DB, possibly different)
  admin_token   text NOT NULL,      -- matches destination's ADMIN_TOKEN — used as X-Admin-Token
  enabled       boolean NOT NULL DEFAULT true,
  created_at, updated_at
)
```

Lives in each Brain's **own** database (source-side lookup only — the destination never needs to know its own registry entry). No CRUD UI is needed for v1 (matches the existing "UI de gerenciamento de Brains — futuro" out-of-scope decision in PROJECT.md) — populated via direct SQL insert by ops, same operational tier as `fup_config` today.

Read timing: unlike `prompts` (snapshotted into the closure at `_compileGraph()` time and refreshed only via `/reload-prompts`), recommend the `transfer_lead` tool's handler **queries `agents` live on every invocation** rather than snapshotting at compile time — the same per-invocation DB read cost that `pause_session`/`finish_conversation` already pay, and it avoids a staleness class of bug entirely (adding a new agent shouldn't require a `/reload-prompts` call to become usable).

**Should the source Brain deactivate `ia_ativada` after a successful handoff, mirroring `pause_session`?**

Yes, but with a stricter ordering than `finish_conversation`'s single atomic UPDATE: the destination call must be confirmed successful **first**, and `setIaAtivada(threadId, false)` only happens after a 2xx from `/api/v1/handoff`. If the HandoffClient call fails (unreachable destination, timeout, unknown `agents.name`), the tool must return an error-shaped JSON result (same `{status:"error", ...}` convention `qualifier.ts`'s `serializeQualificationResult()` already uses, which `isErrorToolResult()` in `event-publisher.ts:41-53` already knows to suppress from the external ToolEvent feed) and **leave the source lead's `ia_ativada` untouched** — the conversation must keep flowing on the source side if the transfer didn't actually land. This is a meaningful divergence from `pause_session`'s "always succeeds, pure local DB write" shape, because `transfer_lead` has a genuine network failure mode `pause_session` never had.

Because the `FupScheduler` eligibility query already filters `WHERE fup_enabled = true AND ia_ativada = true` (`fup-scheduler.ts:113-114`), setting `ia_ativada=false` on a successful transfer automatically and correctly removes the source lead from any further FUP scheduling — no separate cancellation call is required.

### New vs. modified components

**NEW:**
- `packages/database/src/seeds/<brainType>/*.sql` — per-type seed content (existing prompt seeds relocated/duplicated here going forward + new `fup_config`/`key='fup'` rows for sdr, support, echo)
- `packages/database` — `runBrainSeed(sql, brainType, seedsFolder)` function
- `packages/database/src/schema/tables.ts` — new `agents` table (real schema migration, shared folder)
- `packages/core/src/tools/transfer-lead.ts` — `createTransferLeadTool(sql, ...)` factory, same shape as `pause-session.ts`
- `packages/core/src/handoff/handoff-client.ts` — synchronous, awaited, admin-token-authenticated HTTP client
- `packages/core/src/handoff/summarize.ts` — stateless one-shot LLM handoff-summary generator (mirrors `qualifier.ts`)
- `POST /api/v1/handoff` route in `packages/core/src/server.ts`
- `BrainRunner.receiveHandoff(payload)` method in `packages/core/src/runner/runner.ts`
- `SEEDS_FOLDER` ENV (parallel to `MIGRATIONS_FOLDER`)

**MODIFIED:**
- `packages/core/src/runner/runner.ts` — call `runBrainSeed()` after `runMigrations()`/before `loadPrompts()` in `init()`; add `"transfer_lead"` to `TOOL_EVENTS_WHITELIST`; add `receiveHandoff()` method
- `packages/core/src/server.ts` — new `/api/v1/handoff` route alongside existing two
- Each `apps/brain-{sdr,support,echo}/src/index.ts` — `toolsRegistry.enableTool("<type>", "transfer_lead")`
- Each `apps/brain-{sdr,support,echo}/src/brain.ts` — add bound `transfer_lead` tool to `nativeTools`/`buildGraph()`, same pattern as `boundPauseSessionTool`/`boundFinishConversationTool` in `apps/brain-sdr/src/brain.ts:145-146`
- Each `apps/brain-{sdr,support,echo}/Dockerfile` — `COPY` only that Brain's own `packages/database/src/seeds/<type>` subfolder; `MIGRATIONS_FOLDER` COPY/ENV unchanged
- `packages/core/src/leads/lead-service.ts` — **no code change**; `setIaAtivada()` already exists and gains its first production caller (resolves TD-04)

**LEFT UNTOUCHED (deliberately):**
- `packages/database/src/migrate.ts` / `runMigrations()` / `_schema_lock` row-lock — the entire schema-migration mechanism
- `packages/transport` webhook/RabbitMQ handlers and `BrainEventSchema` — lead-facing contract stays exactly as-is
- `IEventPublisher`/`EventPublisher` internals — only its whitelist constant in `runner.ts` gains one entry
- `TenantPoolManager` — no cross-container DB pooling is introduced; the destination Brain talks to its own database through its own already-running process, reached purely over HTTP

### Data flow

```
SOURCE Brain container                              DESTINATION Brain container
┌─────────────────────────────┐                      ┌─────────────────────────────┐
│ LLM emits transfer_lead(    │                      │                             │
│   destination: "support")   │                      │                             │
│         │                    │                      │                             │
│         ▼                    │                      │                             │
│ createTransferLeadTool       │                      │                             │
│   1. thread_id from config    │                      │                             │
│      (never from LLM)         │                      │                             │
│   2. SELECT * FROM agents      │                      │                             │
│      WHERE name=destination   │                      │                             │
│      AND enabled=true         │                      │                             │
│   3. read checkpoint history  │                      │                             │
│      (compiledGraph.getState) │                      │                             │
│   4. summarize.ts: one-shot    │                      │                             │
│      LLM condenses history    │                      │                             │
│         │                     │                      │                             │
│         ▼                     │   POST /api/v1/handoff│                             │
│ handoff-client.ts  ───────────┼──────────────────────►│  X-Admin-Token auth          │
│   (awaited, 10s timeout)      │  {uniqueId, numero,   │         │                    │
│                                │   nome, sourceType,   │         ▼                    │
│                                │   summary}            │  BrainRunner.receiveHandoff  │
│                                │                        │   1. leadService.upsertLead │
│                                │                        │      (fup_config auto-      │
│                                │                        │       activates if seeded)  │
│                                │                        │   2. injectMessage(summary) │
│                                │                        │      → compiledGraph        │
│                                │                        │        .updateState()       │
│                                │  ◄─────────────────────┼─── 200 OK                    │
│         │                      │                        └─────────────────────────────┘
│         ▼ (only on 2xx)         │
│ leadService.setIaAtivada(false) │  ← source stops answering; FupScheduler eligibility
│         │                       │    query (fup_enabled AND ia_ativada) auto-excludes it
│         ▼                       │
│ TOOL_EVENTS_WHITELIST includes   │
│ "transfer_lead" → existing       │
│ IEventPublisher fires             │
│ {action:"transfer_lead",...}      │  ← separate, pre-existing, fire-and-forget channel
│ to source's own CRM/webhook/queue │    (unchanged — just gains this action name)
└───────────────────────────────────┘
```

### Suggested build order across phases

**Phase 1 — Seed-scoping fix (Part A), ships alone first.**
Per-brain-type `seeds/` folders, `runBrainSeed()`, `fup_config` + `key='fup'` prompt defaults for sdr/support/echo, Dockerfile updates. No new tools, no new endpoints — low risk, independently verifiable (spin up a fresh DB per brain type, assert exactly that type's prompts + one `fup_config` row exist, assert FUP actually fires against a silent test lead).

*Why this must land first:* `LeadService.upsertLead(numero, uniqueId, nome, brainType)` — the exact method `BrainRunner.receiveHandoff()` will call in Phase 2/3 — already auto-activates `fup_enabled` by looking up `fup_config` for that `brainType` (Phase 25/26 logic, confirmed in `lead-service.ts:55-84`). If Part A hasn't shipped, every lead newly created via a handoff lands on a destination with no FUP safety net, silently, for exactly the same root-cause reason FUP is broken today. Handoff correctness is therefore causally downstream of seed-scoping correctness, not just sequenced by convention.

**Phase 2 — Destination-receiving side.**
`agents` table (schema migration), `POST /api/v1/handoff` endpoint, `BrainRunner.receiveHandoff()`. Testable standalone via a raw HTTP client (curl/integration test) without touching the LLM/tool side at all — deliberately built and verified before the source-initiating side exists, so failures are isolated to one direction at a time.

**Phase 3 — Source-initiating side.**
`transfer-lead.ts` tool, `handoff-client.ts`, `summarize.ts`, `TOOL_EVENTS_WHITELIST` addition, per-Brain `buildGraph()`/`ToolsRegistry` registration. Wires the LLM-facing decision + the strict "confirm destination success before deactivating source" ordering.

**Phase 4 (stretch, defer if time-constrained) — richer context handoff.**
Multi-message raw history injection instead of a single summarized AIMessage (would need to extend `injectMessage()`/`updateState()` to accept an array of typed messages rather than one AIMessage); bidirectional handoff-back; agent registry admin UI. None of these block the v1.6 milestone's stated scope.

## Open Questions

- Exact `injectMessage()` extension point if a future phase wants to hand over raw alternating Human/AI messages instead of one summarized AIMessage — current signature only accepts a single `content: string` → `AIMessage`.
- Whether `agents.admin_token` should be stored in plaintext in the destination's own database (matches how `ADMIN_TOKEN` itself is a plaintext ENV var today — no existing precedent for secret-at-rest encryption in this codebase) or whether this needs a stronger secret-handling story before shipping to production customers.
- Whether a transferred-and-then-returned lead (destination later hands back to original source) needs `ia_ativada` re-activation on the original source, or whether that's an out-of-scope v2 concern — not addressed by the milestone's stated scope ("Mecanismo para a IA decidir transferir" implies one-directional handoff, not round-trip).

## Sources

- `/root/Brain/packages/core/src/runner/runner.ts` (BrainRunner lifecycle, TOOL_EVENTS_WHITELIST, injectMessage, _compileGraph)
- `/root/Brain/packages/core/src/tools/pause-session.ts`, `finish-conversation.ts` (tool factory pattern)
- `/root/Brain/packages/core/src/events/event-publisher.ts` (IEventPublisher contract, fire-and-forget design)
- `/root/Brain/packages/core/src/leads/lead-service.ts` (upsertLead FUP auto-activation, setIaAtivada dead code)
- `/root/Brain/packages/core/src/fup/fup-scheduler.ts` (eligibility query, prompt key='fup' lookup)
- `/root/Brain/packages/core/src/prompts/loader.ts` (brand_type/key double-filter)
- `/root/Brain/packages/core/src/server.ts` (admin-token auth pattern, /debug/inject-message)
- `/root/Brain/packages/database/src/migrate.ts`, `src/schema/tables.ts`, `src/migrations/*.sql`, `src/migrations/meta/_journal.json`
- `/root/Brain/packages/transport/src/webhook/handler.ts`, `src/webhook/events.ts`, `src/interface.ts`
- `/root/Brain/packages/ai/src/graph/checkpointer.ts` (PostgresSaver setup)
- `/root/Brain/apps/brain-sdr/src/brain.ts`, `src/qualifier.ts` (stateless sub-agent precedent, tool wiring)
- `/root/Brain/apps/brain-sdr/src/index.ts`, `/root/Brain/apps/brain-support/src/index.ts` (ToolsRegistry.enableTool wiring)
- `/root/Brain/apps/brain-sdr/Dockerfile`, `/root/Brain/apps/brain-support/Dockerfile` (shared migrations COPY, confirmed contamination)
- `/root/Brain/.planning/PROJECT.md` (milestone goal, prior decisions, tech-debt ledger including TD-04)

---
*Architecture research for: multi-agent lead handoff + per-brain-type seed scoping*
*Researched: 2026-08-12*
