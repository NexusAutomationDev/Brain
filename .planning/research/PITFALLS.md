# Pitfalls Research

**Domain:** Per-brain-type migration/seed scoping + cross-database multi-agent lead handoff (Brain Core v1.6)
**Researched:** 2026-08-12
**Confidence:** MEDIUM (cross-checked web sources on distributed-systems/migration patterns; project-specific mechanics verified against `.planning/PROJECT.md` decisions log, not against live code)

## Critical Pitfalls

### Pitfall 1: Splitting a shared migrations folder breaks Drizzle's applied-migration tracking on already-deployed client databases

**What goes wrong:**
Every existing client database (per `TenantPoolManager`, 1 DB per client/brain-type combo) already has `_journal.json` entries and applied migration files 0001-0009 from the *current* shared folder. If the fix moves/renames/splits migration files into per-brain-type folders (e.g. `apps/brain-sdr/migrations/` vs `apps/brain-support/migrations/`), Drizzle may see these as new/unknown migrations (different journal hash or file identity) on the next deploy and attempt to re-run DDL that already exists — causing `relation already exists` errors, or duplicate seed inserts if the new files aren't purely idempotent, or a currently-fine `runMigrations()` call now blocking startup with an unhandled migration error.

**Why it happens:**
Drizzle's migration runner keys off `_journal.json` + file content, not semantic identity. Restructuring the migrations directory is a "just move the files" refactor that looks safe in a fresh database but is a breaking change against every already-migrated production database.

**How to avoid:**
Do not retroactively rename/relocate the 9 existing migration files. Instead: (1) keep the existing shared "core schema" migrations exactly as-is (schema DDL that legitimately applies to every brain type: `leads`, `fup_config`, checkpoint tables, etc.), and (2) introduce a *new*, additive migration numbering scheme per brain type for brain-specific seed content only, applied via a brain-type-aware runner that filters which new files a given `MIGRATIONS_FOLDER` picks up. Validate against a copy of a real client DB snapshot (or the existing e2e migration test) before shipping.

**Warning signs:**
`runMigrations()` throwing on a database that was previously healthy; journal hash mismatch errors in CI against a seeded test DB; drizzle-kit `generate` producing diffs for files that were never meant to change.

**Phase to address:**
Seed-scoping fix phase.

---

### Pitfall 2: `ON CONFLICT DO NOTHING` gives zero signal when a seed is silently skipped — the exact bug already in production

**What goes wrong:**
This is the mechanism behind the reported bug: the FUP scheduler logs a warning and skips leads with no default `fup_config`/`prompts.key='fup'` row, but nothing in the migration path *fails* — the `INSERT ... ON CONFLICT DO NOTHING` seed simply never inserted the row (because it was never written for that brain type, not because of a real conflict) and the container reports healthy startup. Idempotent seeding and *silent* seeding are the same mechanism, so "migrations ran with exit 0" is not evidence "expected default data exists."

**Why it happens:**
`ON CONFLICT DO NOTHING` is chosen specifically so re-running seed SQL doesn't blow up on duplicate keys — but it deliberately discards conflicting/skipped rows with no logging and no `RETURNING` output. There's no distinction in that construct between "row correctly pre-existing" and "row simply never got seeded."

**How to avoid:**
Add a post-migration assertion step (not just idempotent inserts): after seeds run, `SELECT` for each brain-type's required default rows (e.g. `fup_config` for this `brain_type`, `prompts.key='fup'`) and raise a loud, fail-fast error (not a runtime warning buried in scheduler logs) if any expected row is absent. This turns "missing seed" into a startup-time failure operators can't miss, instead of a silent per-lead skip discovered only when FUP doesn't fire.

**Warning signs:**
FUP scheduler warning logs with no corresponding alert/paging; any Brain type reporting "0 leads have `fup_enabled=true`" despite leads being created; new client databases behaving differently from older ones for the same brain type.

**Phase to address:**
Seed-scoping fix phase — this is the direct fix for the described bug, not just a hardening nice-to-have.

---

### Pitfall 3: Seed/schema conflation — mixing "must run for every brain type" DDL with "brain-specific" DML in the same migration file

**What goes wrong:**
The root cause of cross-contamination is architectural, not a one-off missing `WHERE` clause: today, one migrations folder serves every Brain image, so a migration file that seeds SDR's `qualifier` prompt is physically present in Support's and Echo's `MIGRATIONS_FOLDER` too, and gets applied to their databases. Any fix that just "adds a brain_type column and filters the SELECT at query time" without also fixing *what gets inserted* at migration time still leaves every brain-type's seed physically shipped inside every other brain-type's Docker image and migration run.

**Why it happens:**
Convenient reuse of one migrations directory across all Docker images (single source of truth in the monorepo) was the right call for schema DDL (all brains share `leads`, `fup_config`, checkpoint tables) but the wrong call for prompt seed data, and nobody separated the two concerns when FUP/prompt seeding was added.

**How to avoid:**
Split by *concern*, not just by folder name: core schema migrations (shared, apply to all brain types unconditionally) vs. brain-specific seed migrations (only ever copied into that brain's own Dockerfile build context / `MIGRATIONS_FOLDER`, never present in another brain's image at all). Verify by inspecting the built Docker image for `apps/brain-echo` and asserting the SDR `qualifier` prompt seed SQL is not present anywhere in its filesystem — a passing DB query isn't sufficient proof if the SQL is merely filtered at insert time; the SQL itself must not ship in the wrong image.

**Warning signs:**
`docker run apps/brain-echo ... find /app -name "*.sql" | xargs grep qualify` returning hits; any Brain's seed migration containing an `IF brain_type = 'x'` conditional (a sign seeds are unified rather than physically separated).

**Phase to address:**
Seed-scoping fix phase.

---

### Pitfall 4: Backward-fill gap — already-deployed client databases have stale cross-contaminated rows that a forward-only fix won't clean up

**What goes wrong:**
Fixing the seed mechanism prevents *future* contamination but does nothing about client databases that, under the old shared-folder scheme, already received another brain type's prompt/config rows. Teams often ship the structural fix and declare victory, leaving existing production databases quietly wrong (e.g. a Support DB still holding an SDR-only prompt key that's now dead weight, or worse, actively selected by application code that isn't brain_type-aware everywhere).

**Why it happens:**
"Fix the seed migration" is naturally scoped as forward-looking (new databases only); auditing/cleaning existing databases requires an explicit, separate, riskier data-migration step that's easy to defer indefinitely.

**How to avoid:**
Add an explicit cleanup migration (or a documented one-time operational script) that identifies and removes/flags rows that don't belong to a database's actual brain type, run and verified against at least one real client database copy before declaring the milestone done. Treat this as part of the same phase's Definition of Done, not a "future backlog" item.

**Warning signs:**
Any brain-type-specific query in the codebase that doesn't filter by `brain_type` explicitly and would silently return another brain's leaked row.

**Phase to address:**
Seed-scoping fix phase.

---

### Pitfall 5: Direct cross-database SQL writes from the source Brain violate the tenant-isolation model the platform was built on

**What goes wrong:**
The simplest way to implement "transfer the lead to another agent's database" is to have the source Brain open a raw `postgres.js`/Drizzle connection directly to the destination Brain's database and `INSERT`. This is the single biggest architectural risk in the handoff feature: it means the SDR Brain process now needs network reachability *and* valid credentials to a database it does not own, undermining the entire "1 banco por cliente, isolamento via `TenantPoolManager`" design. A compromised or buggy source Brain instance can now write/corrupt an unrelated Brain's database directly.

**Why it happens:**
It's the fastest thing to build — "just add another connection string" — especially when both databases happen to be reachable from the same network today. It quietly stops being an option the moment the destination is genuinely on a different host/network segment, as the milestone context explicitly anticipates ("possibly outro banco de dados... possibly outro host").

**How to avoid:**
Model the handoff as an API/message contract, not a database credential. The source Brain should call the destination Brain's own ingestion boundary (an HTTP endpoint or a RabbitMQ message the destination already owns and validates) to *request* the handoff; only the destination process ever writes to its own database. This preserves least-privilege access and keeps the "each Brain owns its own DB" invariant intact even when handoff crosses hosts/networks.

**Warning signs:**
Any new ENV var on the source Brain that looks like `DESTINATION_DATABASE_URL` or a per-agent connection-string table; the handoff tool importing another brain-type's Drizzle schema/client directly.

**Phase to address:**
Handoff feature phase — this is the core architectural decision that must be made correctly before any implementation starts.

---

### Pitfall 6: thread_id collisions and checkpoint corruption across independently-seeded databases

**What goes wrong:**
`thread_id` today equals `lead.unique_id` (the external `IDLead`), scoped implicitly by "this is the only database this lead's data lives in." Once a lead's conversation state can land in a *different* database, that assumption breaks in two ways: (1) the destination database may already contain an unrelated thread under the exact same `thread_id` string (plausible if `IDLead` values are numeric/sequential per external CRM and namespaces overlap across clients or brain types), silently overwriting or interleaving with someone else's checkpoint history; (2) LangGraph's Postgres checkpoint schema is an internal serialization format tied to a specific `@langchain/langgraph-checkpoint-postgres` version — since each Brain image is deployed and versioned independently, source and destination may run different checkpointer versions, so a raw copy of checkpoint rows can be misread as empty/corrupted state at the destination with no visible error (this is a documented LangGraph gotcha, not hypothetical).

**Why it happens:**
`thread_id = unique_id` was a perfectly fine simplification when every lead's checkpoint lived in exactly one database for its entire lifetime. It was never designed to be a globally-unique, cross-database key, and checkpoint rows were never designed to be portable data.

**How to avoid:**
Never copy raw checkpoint table rows between databases. Reconstruct destination-side conversation context through the Brain SDK's own APIs (e.g., `PostgresSaver.getTuple()` on the source to read message history, then write a fresh, destination-namespaced conversation state via the destination's own public checkpointer API) — never bytes-for-bytes row copy. Additionally, namespace `thread_id` for anything that crosses a database boundary (e.g. `{source_brain_type}:{unique_id}` at the destination, or check-and-reject on collision) rather than assuming a bare `unique_id` is safe everywhere.

**Warning signs:**
A migrated lead's conversation history appearing empty or truncated at the destination with no error logged; two unrelated leads sharing identical `unique_id` strings across different clients/brain types.

**Phase to address:**
Handoff feature phase.

---

### Pitfall 7: No cross-database atomicity — partial handoff leaves a lead orphaned or duplicated

**What goes wrong:**
A handoff touches at least three pieces of state: the `leads` row, the LangGraph checkpoint history, and an outbound event publish (`IEventPublisher`) — potentially across two separate Postgres instances with no shared transaction possible. If the tool successfully writes the lead row at the destination but fails mid-copy on the checkpoint history (network blip, destination momentarily down), or successfully completes the transfer but crashes before flipping `ia_ativada=false`/deactivating the source, the lead ends up in an inconsistent state: either no agent manages it (both sides think it's the other's job) or two agents manage it simultaneously (double-response to the same WhatsApp number).

**Why it happens:**
This is the classic dual-write/distributed-transaction problem — there is no 2PC across two independently-owned Postgres databases, and treating the handoff tool call like the codebase's existing fire-and-forget `IEventPublisher` pattern (fine for non-critical side-channel events) is unsafe for the one operation that changes who owns the lead.

**How to avoid:**
Apply an outbox + saga-style approach: persist the handoff intent (source lead id, destination agent name, payload snapshot, status) durably in the source database *before* attempting the remote call, with explicit intermediate states (`pending` → `delivered` → `confirmed` → `source_released`). Only flip `ia_ativada=false` at the source after the destination has *acknowledged* receipt — never eagerly. Add a periodic reconciliation job that finds handoffs stuck in an intermediate state and either retries or surfaces them for manual resolution rather than leaving them silently stuck forever.

**Warning signs:**
A lead with `ia_ativada=false` at source but no corresponding active lead found at any destination; a lead simultaneously "active" in two Brain databases; support tickets about "the bot stopped responding" or "two different bots replied."

**Phase to address:**
Handoff feature phase.

---

### Pitfall 8: Handoff tool call is not idempotent — LLM retries or transport redelivery cause duplicate transfers

**What goes wrong:**
Two independent retry sources can trigger the handoff tool twice for the same lead: the LLM itself re-invoking the tool after an ambiguous/error-looking result, or at-least-once redelivery from the transport layer (RabbitMQ redelivering a tool-call event after a timeout, even though the first invocation actually completed server-side). Without idempotency, a duplicate invocation can create a second lead row at the destination, double-append conversation history, or fire a second outbound event — all silently, since nothing in the current architecture treats "the same handoff, twice" as a special case.

**Why it happens:**
Existing tool contracts (`qualify_lead`, `pause_session`, `finish_conversation`) are low-stakes and largely idempotent-by-nature (flipping a boolean, appending a qualification note) — the handoff tool is qualitatively different because it creates state at a *second* system, and that asymmetry is easy to miss when reusing the existing tool-factory pattern.

**How to avoid:**
Derive an idempotency key from stable business identifiers — e.g. `(source_brain_type, unique_id, destination_agent, attempt_generation)` — and have the destination check-and-reject/no-op on a duplicate key within a bounded window, returning the original result instead of re-executing. Follow the same `event_id` discipline already established for tool events (`thread_id:tool_call_id`, with the FUP exception documented as D-17) — define an explicit `event_id` scheme for handoff (e.g. `handoff:{source_brain_type}:{unique_id}:{tool_call_id}`) so duplicate publishes are detectable too.

**Warning signs:**
Duplicate `unique_id` rows appearing at a destination database; a lead's conversation history at destination containing repeated/duplicated message blocks; more than one outbound handoff event for the same `tool_call_id`.

**Phase to address:**
Handoff feature phase.

---

### Pitfall 9: Destination Brain down/unreachable — source releases ownership before confirming the destination actually took over

**What goes wrong:**
If the handoff tool follows the existing fire-and-forget philosophy used for `IEventPublisher` (deliberately non-blocking so tool events never stall the main flow), a down or unreachable destination means the transfer silently never lands, but the source may already have set `ia_ativada=false` or called `finish_conversation` optimistically — the lead falls into a black hole with no agent managing it and no visible error to the operator (the same failure mode as the current FUP-seed bug, just relocated to a different feature).

**Why it happens:**
Reusing the "don't block the main flow" instinct that's correct for observability-only events (tool-call telemetry) is wrong for an operation that changes who is responsible for responding to the lead.

**How to avoid:**
Treat handoff delivery confirmation as a hard requirement before any source-side state change: retry with exponential backoff on transient failures, and only release source-side ownership after a positive acknowledgment from the destination (synchronous HTTP response, or an async confirmation event the source explicitly waits/polls for). After retries are exhausted, route to a dead-letter/manual-intervention path and *keep the source Brain responsible* for the lead (fail safe toward "still handled by someone" rather than "orphaned").

**Warning signs:**
`ia_ativada=false` at source with the corresponding destination lookup returning nothing; handoff attempts with no corresponding success/failure record after N minutes; no alerting configured for failed handoff attempts (only for FUP failures per existing `fup_failure_count` pattern — handoff needs its own).

**Phase to address:**
Handoff feature phase.

---

### Pitfall 10: Copying the lead's FUP scheduling state verbatim corrupts destination FUP behavior

**What goes wrong:**
The `leads` row carries FUP progress fields (`fup_step`, `fup_next_at`, `fup_enabled`, `fup_failure_count`). If the handoff tool copies these verbatim into the destination, the destination Brain (a different type, with its own `fup_config` — different max steps, intervals, and possibly a different timezone/window) may misinterpret them: `fup_next_at` landing in the past could fire an immediate, out-of-context follow-up the instant the lead arrives; `fup_step` exceeding the destination's configured step count could index past the end of its `fup_config` intervals array.

**Why it happens:**
"Copy the whole lead row" is the simplest implementation and works fine when both sides share identical `fup_config` semantics — which is exactly what the new per-brain-type seed scoping (feature a) explicitly says will no longer be true.

**How to avoid:**
Explicitly reset FUP state as part of the handoff write (destination lead starts with `fup_step=0`, `fup_enabled` derived fresh from the destination's own `fup_config`, `fup_next_at` recalculated via `getNextValidSlot()` against the destination's config), rather than transplanting source progress. Preserve/copy only the conversation-relevant fields (name, numero, conversation history) plus a reference back to the origin for audit purposes.

**Warning signs:**
A newly-handed-off lead immediately receiving a follow-up message before any real silence has elapsed; FUP scheduler errors referencing an out-of-range step index right after a handoff.

**Phase to address:**
Handoff feature phase.

---

### Pitfall 11: Dual-active-agent race — DB-level ownership flag flips without the actual message routing layer being updated

**What goes wrong:**
`ia_ativada` and the destination database gaining a new lead row are internal state changes — but the physical routing of the *next* inbound WhatsApp/CRM message (which webhook URL or RabbitMQ queue a message lands on) is controlled upstream, outside Brain Core, and is not necessarily brain-aware today. If the handoff only updates internal DB rows without also updating (or coordinating with) whatever routes inbound messages to a specific Brain's webhook/queue, the destination Brain can have a perfectly correct lead+history and still never receive the next message — because the message is still being delivered to the source Brain's endpoint. This is a "looks done but isn't" trap: the data model handoff can be 100% correct and the feature can still not work end-to-end.

**Why it happens:**
The handoff feature is naturally scoped and built as a database/tool-layer concern; the upstream routing/ownership question (which Brain's webhook a client's WhatsApp Business number or CRM points at) is a different system entirely and easy to treat as "someone else's problem" or "out of scope" during implementation, only to surface as a broken end-to-end demo.

**How to avoid:**
Explicitly scope, during discussion/planning of the handoff phase, whether message routing is (a) already Brain-agnostic (e.g. all Brain types for a client sit behind one shared gateway that Brain Core itself controls, so flipping DB ownership is sufficient), or (b) requires an explicit external action (updating a webhook URL, re-pointing a CRM assignment) that must be included as part of the handoff tool's side effects or documented as a manual step. Do not assume (a) without verifying it against how routing actually works in this deployment model.

**Warning signs:**
End-to-end UAT that only checks database state ("lead row now exists at destination") without sending a real follow-up WhatsApp message through the actual transport to confirm the destination Brain receives and responds to it.

**Phase to address:**
Handoff feature phase — should be an explicit discussion-phase question, not discovered during execution.

---

### Pitfall 12: Hardcoding destination agent names defeats the "configurable names" requirement and reintroduces the seed-drift bug in a new place

**What goes wrong:**
The requirement explicitly calls for configurable agent names ("não fixos em 2-3 tipos"), meaning the set of valid handoff destinations must live in data, not in a code-level enum/whitelist. If this configuration lives in a new table (e.g. `agent_registry` mapping a configurable name to connection/endpoint info), that table now needs its own seeding strategy — and naively seeding it the same way the original `prompts`/`fup_config` seeds were done (one shared migration, `ON CONFLICT DO NOTHING`, no per-brain-type scoping) risks reintroducing exactly the class of bug feature (a) is fixing, just in a new table.

**Why it happens:**
It's tempting to solve the "configurable names" requirement with a quick enum or ENV list for the MVP, deferring the "real" registry to later — but that quietly violates the stated requirement and creates a second migration/seeding surface that hasn't learned the lesson of pitfall 2/3.

**How to avoid:**
Design the agent/destination registry as a first-class, brain-type-scoped seeded table from day one, applying the same per-brain-type seed-scoping mechanism built in feature (a) — don't build a second, unaudited seeding path for it. Validate that a new Brain type (future Customer Success, per the roadmap backlog) can register itself as a valid handoff destination purely through configuration, with no code change to the handoff tool.

**Warning signs:**
A `switch(destinationType)` or hardcoded array of `['sdr', 'support', 'echo']` anywhere in the handoff tool implementation.

**Phase to address:**
Handoff feature phase — verify against the "configurable names" requirement explicitly during plan review.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| Reuse `IEventPublisher` fire-and-forget pattern for the handoff tool itself | Fast to build, consistent with existing tool code | Silent lead loss if destination unreachable (Pitfall 9) | Never for the handoff's ownership-transfer step; fine only for a secondary "handoff happened" telemetry event alongside a confirmed-delivery mechanism |
| Copy `leads` row verbatim (including FUP fields) to destination | One INSERT, no field-by-field logic | Corrupted FUP scheduling at destination (Pitfall 10) | Never — always re-derive FUP state from destination's own `fup_config` |
| Raw cross-database SQL connection from source to destination for handoff | Simplest to prototype, no new API surface | Breaks tenant isolation, credential sprawl, unusable once hosts diverge (Pitfall 5) | Only acceptable as a throwaway local-dev spike, never shipped |
| Hardcoded brain-type enum for destination whitelist in handoff tool | No new schema needed | Violates "configurable names" requirement, repeats seed-drift bug (Pitfall 12) | Only acceptable if explicitly descoped for MVP and documented as a known gap, not shipped silently |
| Skip post-migration seed assertions ("if it ran without SQL error, it worked") | No extra code | Reproduces the exact silent-fup-skip bug being fixed (Pitfall 2) | Never |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|------------------|-------------------|
| Drizzle migrations (shared folder → per-brain-type) | Renaming/relocating existing applied migration files, breaking journal tracking on live client DBs | Keep existing files untouched; add new, additive, brain-scoped migration files/journals only (Pitfall 1) |
| LangGraph `PostgresSaver` cross-database | Copying raw checkpoint table rows between databases assuming format portability | Read via `getTuple()`/public API on source, reconstruct via public checkpointer API on destination; never bytes-for-bytes row copy (Pitfall 6) |
| RabbitMQ (`rabbitmq-client`) tool-call/event transport for handoff | Treating handoff delivery as fire-and-forget like other tool events | Require positive ack before source releases ownership; add DLQ + reconciliation specific to handoff, not reused from generic event publishing (Pitfalls 7, 9) |
| Cross-database connection for handoff | Source Brain opening a direct Postgres connection to destination's database | Handoff via destination's own HTTP/RabbitMQ ingestion boundary; destination is the only writer to its own DB (Pitfall 5) |
| Upstream WhatsApp/CRM message routing | Assuming DB-level `ia_ativada` flip is sufficient for message routing to switch | Verify/update whatever controls inbound message routing as an explicit part of handoff, or document it as a manual step (Pitfall 11) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Transferring full conversation history payload synchronously in the handoff tool call | Tool call latency spikes or timeouts on leads with long conversation histories | Transfer a bounded, summarized context (recent N turns + an LLM-generated summary) rather than the entire raw checkpoint history; consider async/background completion of full-history transfer after the fast-path handoff confirms | Breaks once a lead has enough turns that checkpoint payload size approaches RabbitMQ/HTTP message-size limits (same class of issue as the project's known amqplib large-message pitfall, even though `rabbitmq-client` is used instead) |
| Per-message brain-type seed assertion query on every startup of every instance | Extra startup latency across N instances of the same Brain type per client | Run the seed-assertion check inside the same row-lock-guarded migration path (once per deploy, not once per instance boot query) | Negligible until very high instance counts per client; still cheap relative to migration itself |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Source Brain holding a live connection string/credentials to a destination Brain's database | A compromised or buggy source Brain instance can read/write an unrelated client's or brain-type's data, defeating the platform's core tenant-isolation guarantee | Handoff must cross an API boundary (HTTP/RabbitMQ) owned and authenticated by the destination, never a shared DB credential (Pitfall 5) |
| Handoff payload transmitted without integrity/authentication between independently-deployed, possibly cross-host services | A network-level attacker or misconfigured routing could inject a fabricated "handoff" claiming ownership of a lead that was never actually released by its real source | Authenticate/sign handoff requests (shared secret, mTLS, or signed payload) and validate origin at the destination before accepting a transfer |
| Storing full conversation history (potentially containing PII from WhatsApp leads) in transit/logs during handoff | Sensitive lead data (phone numbers, conversation content) exposed in plaintext logs, retry queues, or DLQ entries during handoff failures | Scrub/redact PII from handoff failure logs and DLQ entries; treat handoff payloads with the same care as the primary conversation data at rest |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|--------------|-------------------|
| Lead silently orphaned after a failed/partial handoff (Pitfalls 7, 9) | Lead stops receiving any response from either agent, with no operator visibility until the customer complains | Fail-safe toward keeping source ownership until destination confirms; alert on stuck/failed handoffs the same way `fup_failure_count` already alerts on FUP failures |
| Duplicate agent responses to the same WhatsApp message after a race between source/destination ownership (Pitfall 11) | Lead receives two different bot replies to one message, visibly confusing/unprofessional | Ensure only one side is ever "active" at a time via confirmed handoff plus (if applicable) upstream routing coordination |
| Missing default FUP seed causing silent skip (Pitfall 2, the reported bug) | Leads never receive automated follow-ups on a fresh client database, with no operator-facing error — discovered only by noticing low engagement | Fail loud at startup if required seed rows are missing, not a buried scheduler warning |

## "Looks Done But Isn't" Checklist

- [ ] **Per-brain-type seed scoping:** Migrations run cleanly and DB has the "right" prompts — verify by inspecting the *built Docker image* of each brain type for another brain's seed SQL physically present, not just querying the resulting database (Pitfall 3).
- [ ] **Default FUP seed:** `fup_config` and `prompts.key='fup'` exist in a freshly migrated DB for every brain type — verify with an explicit post-migration assertion query per brain type, not by observing the absence of a scheduler warning.
- [ ] **Existing client databases:** New seed-scoping code is deployed — verify a backfill/cleanup pass was run (or explicitly scoped out with a documented reason) against at least one real client database copy (Pitfall 4).
- [ ] **Handoff tool "works":** A test handoff moves a lead row and checkpoint to another database — verify end-to-end by sending a real follow-up message through the actual transport (webhook/RabbitMQ) and confirming the destination Brain — not just the database — receives and responds (Pitfall 11).
- [ ] **Handoff idempotency:** The tool has a happy-path test — verify a *duplicate* invocation (same lead, same destination, invoked twice) does not create two lead rows, two checkpoints, or two outbound events (Pitfall 8).
- [ ] **Handoff failure handling:** Happy path works — verify behavior when the destination Brain's process/database is simply down or the network path is blocked: does the source correctly retain ownership, alert, and retry, or does it silently lose the lead (Pitfall 9)?
- [ ] **FUP state after handoff:** Lead arrives at destination — verify `fup_step`/`fup_next_at`/`fup_enabled` were reset against the destination's own `fup_config`, not copied verbatim from source (Pitfall 10).
- [ ] **Configurable destination names:** Handoff tool accepts a destination agent name — verify it resolves through a data-driven registry, not a hardcoded enum, and that a hypothetical new Brain type can be added as a destination with zero code changes (Pitfall 12).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Cross-contaminated seed rows already in production client DBs (Pitfall 4) | MEDIUM | Write a one-time audit query per client DB identifying rows whose implicit brain-type doesn't match the DB's actual brain type; remove or flag them; re-verify prompts served are correct via a follow-up conversation test |
| Orphaned lead after a partial/failed handoff (Pitfall 7, 9) | MEDIUM | Reconciliation job scans handoff-intent records for anything stuck past a timeout in a non-terminal state; either resumes the transfer from the last confirmed step or restores full ownership to the source and alerts an operator |
| Duplicate lead/checkpoint created at destination from a non-idempotent retry (Pitfall 8) | HIGH | Requires manual identification of the duplicate (matching `unique_id`/idempotency key), merging or deleting the extra lead row and any duplicated checkpoint history — costly if conversation history diverged before being caught |
| Corrupted checkpoint at destination from raw cross-version row copy (Pitfall 6) | HIGH | Conversation history for that lead may be unrecoverable from the checkpoint table directly; fall back to whatever summary/audit trail exists (event log, EVT-0x published events) to manually reconstruct enough context for the destination agent to continue gracefully |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| 1. Migration file restructuring breaks journal tracking on live DBs | Seed-scoping fix | Apply new migration scheme against a snapshot/copy of a real client DB and confirm no re-run/hash errors |
| 2. `ON CONFLICT DO NOTHING` silently masks missing FUP seed | Seed-scoping fix | Post-migration assertion query fails loudly on a DB missing required seed rows; FUP scheduler no longer silently skips |
| 3. Schema/seed conflation ships wrong-brain seeds into every image | Seed-scoping fix | Inspect built Docker image filesystem per brain type for absence of other brains' seed SQL |
| 4. Existing client DBs never backfilled/cleaned | Seed-scoping fix | Backfill script run and verified against at least one real client DB copy before milestone sign-off |
| 5. Direct cross-database SQL writes for handoff | Handoff feature (design decision, early) | Architecture review confirms no shared DB credentials between brain-type deployments; handoff only via API/message boundary |
| 6. thread_id collision / checkpoint format incompatibility | Handoff feature | Handoff test explicitly reconstructs destination checkpoint via public API, never raw row copy; namespaced/collision-checked thread_id |
| 7. No cross-database atomicity, partial handoff | Handoff feature | Fault-injection test: kill destination mid-transfer, confirm reconciliation job resolves to a consistent terminal state |
| 8. Handoff tool not idempotent | Handoff feature | Explicit duplicate-invocation test confirms no duplicate lead/checkpoint/event created |
| 9. Destination down/unreachable, source releases ownership too early | Handoff feature | Explicit destination-down test confirms source retains ownership and alerts, never silently orphans the lead |
| 10. FUP state copied verbatim, corrupting destination scheduling | Handoff feature | Post-handoff test confirms FUP state at destination derives from destination's `fup_config`, not source's progress |
| 11. Upstream message routing not updated alongside DB handoff | Handoff feature (discuss-phase question) | End-to-end UAT sends a real follow-up message through actual transport, confirms destination Brain (not just DB) receives it |
| 12. Hardcoded destination agent enum defeats configurability requirement | Handoff feature | Plan review explicitly checks destination resolution against a data-driven registry, not a code enum |

## Sources

- Drizzle ORM monorepo migration sharing discussions: [answeroverflow.com/m/1115698958094827560](https://www.answeroverflow.com/m/1115698958094827560), [answeroverflow.com/m/1271027557923422280](https://www.answeroverflow.com/m/1271027557923422280) (community discussion, LOW confidence — no authoritative single pattern)
- Postgres `ON CONFLICT DO NOTHING` behavior and gotchas: [prisma.io/dataguide/postgresql/inserting-and-modifying-data/insert-on-conflict](https://www.prisma.io/dataguide/postgresql/inserting-and-modifying-data/insert-on-conflict), [queryplane.com/blog/postgres-upsert](https://queryplane.com/blog/postgres-upsert/) (MEDIUM confidence, cross-checked)
- LangGraph persistence/checkpointer mechanics: [docs.langchain.com/oss/python/langgraph/persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [fast.io/resources/langgraph-persistence](https://fast.io/resources/langgraph-persistence/) (MEDIUM confidence)
- LangGraph multi-agent handoff / swarm (`Command.PARENT`): [docs.langchain.com/oss/python/langchain/multi-agent/handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs), [npmjs.com/package/@langchain/langgraph-swarm](https://www.npmjs.com/package/@langchain/langgraph-swarm) (MEDIUM confidence)
- Saga pattern / compensating transactions: [microservices.io/patterns/data/saga.html](https://microservices.io/patterns/data/saga.html), [baeldung.com/cs/saga-pattern-microservices](https://www.baeldung.com/cs/saga-pattern-microservices) (MEDIUM confidence, cross-checked)
- Transactional outbox / dual-write problem: [docs.aws.amazon.com/prescriptive-guidance/.../transactional-outbox.html](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html), [developer.confluent.io/courses/microservices/the-transactional-outbox-pattern](https://developer.confluent.io/courses/microservices/the-transactional-outbox-pattern/) (MEDIUM confidence, cross-checked)
- Idempotency keys for LLM tool calls / agent retries: [dev.to/mukundakatta/make-your-agents-api-calls-idempotent-before-you-need-to-2994](https://dev.to/mukundakatta/make-your-agents-api-calls-idempotent-before-you-need-to-2994), [www.channel.tel/blog/idempotent-tool-calls-agent-retry-safety](https://www.channel.tel/blog/idempotent-tool-calls-agent-retry-safety) (MEDIUM confidence, cross-checked)
- Webhook delivery guarantees, DLQ patterns: [hookdeck.com/outpost/guides/outbound-webhook-retry-best-practices](https://hookdeck.com/outpost/guides/outbound-webhook-retry-best-practices), [codelit.io/blog/api-webhooks-delivery-guarantee](https://codelit.io/blog/api-webhooks-delivery-guarantee) (MEDIUM confidence, cross-checked)
- Two Generals Problem / distributed consistency without 2PC: [en.wikipedia.org/wiki/Two_Generals'_Problem](https://en.wikipedia.org/wiki/Two_Generals'_Problem), [medium.com/memobank/how-we-ensure-eventual-consistency-in-a-distributed-system](https://medium.com/memobank/how-we-ensure-eventual-consistency-in-a-distributed-system-932ab2493b39) (MEDIUM confidence, cross-checked)
- Seed-vs-migration maintenance pitfalls: [seedfa.st/blog/seed-file-maintenance](https://seedfa.st/blog/seed-file-maintenance), [supabase.com/docs/guides/local-development/seeding-your-database](https://supabase.com/docs/guides/local-development/seeding-your-database) (MEDIUM confidence, cross-checked)
- Project-specific context (row-lock migration mechanism, `IEventPublisher` fire-and-forget design, FUP scheduler state fields, `event_id` conventions, prior PgBouncer/advisory-lock decision): `/root/Brain/.planning/PROJECT.md` Key Decisions log (HIGH confidence — primary source)

---
*Pitfalls research for: Brain Core v1.6 — per-brain-type seed scoping + cross-database lead handoff*
*Researched: 2026-08-12*
