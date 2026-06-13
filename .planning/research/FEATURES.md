# Feature Landscape: Brain Core v1.1

**Domain:** Modular AI agent infrastructure platform — RabbitMQ transport, lead management, conversation history, Brain SDR
**Researched:** 2026-06-13
**Scope:** v1.1 new features only. v1.0 infrastructure is already built and validated.
**Overall confidence:** HIGH (verified across official RabbitMQ docs, LangGraph checkpoint internals, production guides, WhatsApp SDR pattern research)

---

## Feature Area 1: RabbitMQ Transport Consumer

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Manual acknowledgement (autoAck: false)** | At-least-once delivery guarantee requires manual ack. RabbitMQ official docs state autoAck mode "should be considered unsafe" for production. Without manual ack, a crash mid-processing loses the message silently. | Low | Must ack only after LangGraph BrainRunner returns. Must nack with requeue=false (not requeue=true, which creates infinite redelivery loops) on permanent processing failures. |
| **Bounded prefetch count** | RabbitMQ docs recommend 100-300 for throughput; prefetch=1 is too conservative, prefetch=0 (unlimited) causes unbounded heap growth. For an AI agent consumer where each message may call an LLM (500ms–10s), prefetch=1 or prefetch=5 is appropriate — one LLM call saturates a worker. | Low | Set via `channel.prefetch(N)` before consuming. Start with prefetch=1 for LLM workloads, increase only when profiling shows headroom. |
| **Graceful shutdown on SIGTERM** | Kubernetes sends SIGTERM before SIGKILL with a grace period. The consumer must: (1) stop accepting new messages (cancel consumer tag), (2) wait for in-flight messages to finish, (3) ack/nack pending messages, (4) close channel then connection. | Medium | Store consumer tag from `channel.consume()` response. Use process signal handlers. Budget 30s grace period — LLM calls must complete or be nacked. |
| **Connection/channel error recovery** | amqplib's built-in reconnect is single-attempt only. After that, the consumer stops processing silently. Production requires a retry loop with exponential backoff on connection failures. | Medium | amqplib-bun inherits this limitation. Implement try/reconnect loop at startup. Emit structured log on each reconnect attempt. Circuit breaker optional for v1.1. |
| **Queue and exchange assertion on startup** | Consumer must `assertQueue()` before consuming to ensure the queue exists with correct durability settings. Crash if queue doesn't exist is a deployment footgun. | Low | `{ durable: true }` on queue assertion. Fail fast if RabbitMQ is unreachable at startup — do not silently skip. |
| **Structured logging per message** | Each message processed needs: queue name, correlation ID (if present), lead numero/IDLead, processing duration, success/failure outcome. Without this, debugging production failures is impossible. | Low | Reuse Pino logger already in stack. Include `message_id` from AMQP properties for tracing. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Dead Letter Queue (DLQ) setup** | Messages that fail processing after N retries should land in a DLQ for manual inspection, not silently disappear. Production systems using "topology-as-retry" (TTL-based delay queues) avoid retry logic in application code entirely. | Medium | Configure `x-dead-letter-exchange` on queue assertion. Define a `brain.sdr.dlq` queue. For v1.1, log DLQ events — manual inspection only. Automated retry flows are v2. |
| **Message idempotency via numero/IDLead** | RabbitMQ guarantees at-least-once, meaning duplicate messages will arrive on restart or nack-requeue. Consumer must be idempotent. Looking up lead by numero before processing achieves this naturally — processing the same message twice just hits the same lead record. | Low | This comes "for free" if lead lookup is the first step. No separate dedup table needed in v1.1. |
| **ENV-driven transport selection** | The same Brain image works with webhook or RabbitMQ by changing TRANSPORT env. Avoids separate Docker images per transport. | Low | Already planned. Transport selection logic lives in ITransport implementation layer. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **requeue=true on nack for processing errors** | Creates an infinite redelivery loop — the LLM will keep failing the same malformed message. RabbitMQ doesn't have built-in redelivery limits unless DLQ is configured. | Use requeue=false + DLQ. Log the failed message body. Alert on DLQ accumulation. |
| **Unlimited prefetch (prefetch=0)** | Unbounded message buffering in consumer memory. For LLM workloads (potentially 10s per message), this queues thousands of messages in RAM before the consumer can process them. | Start with prefetch=1. Increase after load testing. |
| **Automatic ack (autoAck: true)** | Message is acked as soon as delivered, before processing. If Brain crashes during LangGraph run, message is lost permanently. | Always manual ack. Ack only after BrainRunner.run() returns successfully. |
| **Reconnection inside message handler** | Reconnecting to RabbitMQ from inside the message processing callback creates race conditions and blocks the event loop. | Connection management is a separate concern from message processing. Reconnect at the connection layer, not per-message. |

### Complexity Notes

Consumer lifecycle (connect → assert → consume → graceful shutdown) is medium complexity. The hard part is the reconnect loop — amqplib-bun doesn't handle this automatically. Budget extra implementation time for: (1) exponential backoff reconnect, (2) SIGTERM handler that waits for in-flight messages, (3) DLQ topology assertion. Total: ~2 days implementation + testing.

### Dependencies

- Requires: `amqplib-bun` package (not vanilla amqplib — Bun incompatibility bugs)
- Requires: RabbitMQ 4.1.0+ → amqplib-bun >= 0.10.7
- Requires: BrainRunner interface stable (already validated in v1.0)
- Requires: Leads lookup (Feature Area 2) — consumer calls lead lookup before passing to BrainRunner
- Blocks: Brain SDR cannot receive messages without this transport

---

## Feature Area 2: Leads Schema and Auto-Registration

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Lead lookup by numero on every message** | Every AI chat system with user tracking does this. Without lookup, the Brain has no context about who it's talking to. `numero` is the natural key for WhatsApp-sourced messages. | Low | SQL: `SELECT * FROM leads WHERE numero = $1 LIMIT 1`. Index on `numero` is mandatory — this runs on every message. |
| **Auto-registration on first message** | Industry standard for chat-based lead capture. Requiring pre-registration is friction that kills conversion. First message = implicit opt-in to conversation. | Low | If lookup returns null, INSERT lead with nome, numero, unique_id. Set ia_ativada=true by default. Return the newly created lead record. |
| **ia_ativada gate before any processing** | Silently dropping messages when ia_ativada=false is expected behavior for AI chatbots with human override. Operations team needs the ability to take over a conversation by disabling the AI without touching code. | Low | Check immediately after lead lookup. If false, ack the message (do not requeue) and return without calling BrainRunner. Log the skip at INFO level with lead ID. |
| **IDLead as external reference** | The sending system (WhatsApp gateway, CRM) may have its own lead ID. IDLead allows lookups without relying solely on phone number, which can change. | Low | Lookup strategy: if IDLead present, try `WHERE unique_id = $IDLead` first, fall back to `WHERE numero = $numero`. On creation, store IDLead as unique_id. |
| **Lead data available in BrainRunner context** | The Brain needs to know who it's talking to (nome, numero, history link). Lead data must be injected into the LangGraph invocation context. | Low | Pass lead record as part of the initial state when invoking the graph. Brain SDR uses nome for personalization. |
| **Unique index on numero** | Without a unique constraint, concurrent messages from the same number (duplicate delivery) create two lead records. This corrupts conversation history. | Low | `UNIQUE INDEX ON leads(numero)`. On INSERT, use `ON CONFLICT (numero) DO NOTHING` and re-fetch — avoids race condition. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **unique_id as stable cross-system identifier** | If the CRM assigns IDs, using those as unique_id creates a single namespace across systems. Avoids N-way ID mapping tables. | Low | App-generated (UUID or CRM-provided). Stored as TEXT to be format-agnostic. |
| **fullpp flag as reserved field** | Having the column now costs nothing but enables future features (full product purchase, premium profile, etc.) without a migration. | Low | Store as boolean, default false. No business logic in v1.1. Document intent in schema comments. |
| **Lead record as LangGraph thread anchor** | The thread_id passed to PostgresSaver should be derived from lead.id (e.g., `lead-${lead.id}`) — not from the message itself. This ensures all messages from the same lead resume the same conversation thread automatically. | Low | Critical for conversation continuity. See Feature Area 3. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Hard-fail on duplicate numero at INSERT** | Concurrent message delivery (RabbitMQ at-least-once) will cause two messages from the same lead to race on INSERT. A hard constraint error crashes the consumer. | Use `INSERT ... ON CONFLICT (numero) DO NOTHING` + re-fetch. Idempotent by design. |
| **Soft-delete / deactivation cascade to history** | Deleting or deactivating a lead should not cascade-delete conversation history. Audit trail is valuable even for churned leads. | ia_ativada=false is the "off" switch. No DELETE in v1.1. Hard deletes are an ops tool, not an application path. |
| **Storing raw message content in leads table** | The leads table is identity data (who they are). Message content belongs in conversation history (what was said). Mixing them creates a bloated table that's hard to query. | Leads table: identity. Conversation history: LangGraph checkpoints + optional messages table. |
| **Eager lead enrichment at registration** | Calling external APIs (CNPJ lookup, LinkedIn enrichment) at registration time adds latency to message processing and a failure mode that blocks the conversation. | Register with data provided. Enrich asynchronously in v2+ if needed. |

### Complexity Notes

Schema migration + CRUD is low complexity. The tricky parts are: (1) race condition on concurrent INSERT for the same numero (solved by ON CONFLICT), (2) ensuring the ia_ativada check is the first gate in every message handler (both webhook and RabbitMQ consumer), (3) propagating lead context into BrainRunner invocation without coupling the transport layer to domain logic. Total: ~1 day.

### Dependencies

- Requires: PostgreSQL schema migration (Drizzle, auto-run on Brain startup per v1.1 plan)
- Requires: Both transports (Webhook and RabbitMQ) must share the same lead lookup logic — extract into a shared `LeadService` class to avoid duplication
- Blocks: Feature Areas 3 and 4 — conversation history and Brain SDR both require the lead record

---

## Feature Area 3: Conversation History Linked to Lead

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Thread ID derived from lead ID** | LangGraph's PostgresSaver stores state keyed by `thread_id`. To resume a conversation, the same thread_id must be used across messages. The stable mapping is `thread_id = "lead-${lead.id}"`. | Low | This is the architectural glue between the leads table and LangGraph checkpoints. If thread_id is message-scoped (random per message), each invocation starts a fresh graph with no history. |
| **Automatic context recovery on invocation** | When BrainRunner invokes the graph with an existing thread_id, PostgresSaver automatically loads the latest checkpoint and resumes from it. No manual history fetch is needed. | Low | This is already how PostgresSaver works — it is "free" if thread_id is consistent. The implementation work is ensuring thread_id is always `lead-{id}`, not random. |
| **Conversation continuity across restarts** | PostgresSaver persists state to PostgreSQL. If the Brain container restarts, the next message from the same lead resumes the conversation. This is the v1.0 SC-3 validated capability. | Low | Already validated in v1.0 (MARKER_BRAINCORE_42 survived docker restart). Extend this guarantee to leads. |
| **Context window management** | LangGraph's message list grows unbounded in checkpoints. Long conversations will eventually exceed the LLM's context window. Production systems need a trim strategy. | Medium | Standard approaches: (1) keep last N messages, (2) summarize older messages and store summary, (3) use sliding window. For v1.1 MVP, keep last N messages (e.g., last 20 turns). Mark as tech debt for proper summarization in v2. |
| **No cross-lead context leakage** | Thread IDs must be lead-scoped. A bug that passes the wrong thread_id gives one lead access to another's conversation. | Low | Enforcement is trivial if thread_id is always derived from `lead.id` from the leads table lookup. Never accept thread_id from the incoming message payload. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Separate thread_views index table** | For operational visibility (ops team wants to see all conversations for a lead), a lightweight index table (lead_id, thread_id, last_message_at, message_count) enables fast queries without scanning LangGraph's binary checkpoint blobs. | Medium | Not required for v1.1 functionality but greatly simplifies debugging. Add if time allows; otherwise defer to v2. |
| **Conversation handoff metadata in checkpoint state** | Storing structured flags in LangGraph state (e.g., `qualificado: boolean`, `hot_lead: boolean`, `handoff_requested: boolean`) enables downstream systems (CRM, human agent queue) to read conversation outcome without re-parsing the message history. | Medium | Required for Brain SDR's qualification output to be useful downstream. Design state schema to include these flags from the start. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Accepting thread_id from message payload** | Allows any sender to hijack any lead's conversation by providing an arbitrary thread_id. | Always derive thread_id server-side from `lead.id` after lookup. Ignore any thread_id in the incoming payload. |
| **Storing full conversation in a messages table separate from checkpoints** | Duplicates state. LangGraph checkpoints already contain the full message history. Maintaining a parallel messages table creates consistency issues when checkpoints rollback or are corrupted. | Use LangGraph checkpoints as the source of truth. Add a lightweight index table for query purposes only, not as the conversation store. |
| **Unbounded message history without trim** | OpenAI GPT-4o has a 128K token context window. A 200-turn WhatsApp conversation can exceed this. Passing unbounded history to the LLM will cause token limit errors in production. | Implement last-N-messages trim in the graph's state reducer from day one. Hard to retrofit. |
| **Per-session thread_id (new thread per message)** | Common mistake when adapting examples that use `uuid()` as thread_id. Results in a Brain with no memory — every message starts from scratch. | Use lead-scoped thread_id. Session ≠ thread. A thread spans the entire relationship with a lead. |

### Complexity Notes

The actual implementation is low complexity if the thread_id convention is established correctly from the start. Medium complexity comes from: (1) context window trimming (requires a state reducer that truncates messages), (2) the thread_views index table (optional for v1.1). The most dangerous pitfall is subtle — a random or message-scoped thread_id gives a system that appears to work in single-message testing but has no memory in production. This must be verified in integration tests. Total: ~1 day for core wiring, +1 day if adding context trim.

### Dependencies

- Requires: leads table with stable `lead.id` (Feature Area 2)
- Requires: PostgresSaver already working (validated in v1.0, SC-3)
- Requires: BrainRunner.run() accepts thread_id as part of config (already part of LangGraph invocation config)
- Blocks: Brain SDR (cannot qualify a lead without remembering previous turns)

---

## Feature Area 4: Brain SDR — First Real Brain

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Personalized greeting using lead nome** | Every AI SDR tool personalizes the first message. "Oi João, vi que você entrou em contato..." converts significantly better than "Olá, como posso ajudar?". Lead nome is available from the leads table. | Low | Pass nome into the initial prompt context. Fallback to "você" if nome is empty. |
| **Context-aware qualification (not scripted forms)** | 2026 market research confirms: rigid scripted flows ("press 1 for budget") fail on WhatsApp because users give non-scripted answers. AI SDRs must extract qualification signals from natural conversation. | High | LangGraph graph routes based on what the lead said, not button presses. Qualification signals (budget, need, timeline) are extracted by the LLM, not form fields. |
| **ia_ativada respect throughout conversation** | If ia_ativada is set to false mid-conversation (ops team takes over), the Brain must stop responding immediately on the next message. | Low | The ia_ativada check is the first gate in the message handler — already covered in Feature Area 2. Brain SDR gets this for free. |
| **Conversation memory (no re-asking known facts)** | The SDR must remember what the lead said in previous messages. Re-asking "qual seu orçamento?" after the lead already answered it destroys trust. | Low | Covered by Feature Area 3 (thread_id-anchored checkpoints). Brain SDR gets this for free from the infrastructure. |
| **Graceful handling of out-of-scope messages** | Leads will ask questions the SDR cannot answer (technical specs, pricing tables, competitor comparisons). The Brain must handle these gracefully without hallucinating or crashing. | Medium | Design the system prompt to acknowledge limits and redirect. "Ótima pergunta sobre pricing, deixa eu conectar você com alguém que pode detalhar isso melhor." |
| **Qualification signal capture into state** | When the lead reveals budget, need, authority, or timeline, these signals must be captured into the LangGraph state, not left only in the message history. | Medium | Design LangGraph state schema with explicit qualification fields. Use a node that extracts signals from the latest message and updates state. |
| **Human handoff trigger** | When qualification is complete or when the lead explicitly asks for a human, the Brain should flag for handoff. v1.1 scope: set state flag + log. Actual routing to human agent queue is v2. | Low | `handoff_requested: true` in LangGraph state. Log at WARN level. Downstream system reads this flag. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Sub-agent for qualification** | PROJECT.md specifies: "o Brain SDR tem uma arquitetura com sub-agente de qualificação: o Brain principal conversa com leads e aciona o sub-agente quando chega o momento de qualificar." This maps to LangGraph subgraph composition — the qualification logic is isolated in its own graph node cluster, not mixed into the main conversation flow. | High | High value: keeps main conversation graph clean. The qualification sub-agent runs as a LangGraph subgraph — it receives the conversation state, runs qualification extraction, returns structured result. Main graph continues with result. |
| **Adaptive questioning order** | BANT/CHAMP frameworks should not be applied as a rigid script. Leading with Budget first (BANT) vs Challenges first (CHAMP) depends on the lead's first message. An SDR that adapts question order based on what the lead volunteered performs better. | High | Requires LLM to route conversation based on context, not fixed sequence. Design graph with routing nodes that select the next qualification question based on current state. Defer to v2 if too complex for v1.1. |
| **Conversation tone adaptation** | WhatsApp conversations are informal. An AI that sounds like a corporate script gets ignored. The prompt must instruct informal Brazilian Portuguese with appropriate casualness. | Low | Prompt engineering concern, not infrastructure. Include in system prompt design. High value, low cost. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **SPIN or full BANT scripted as fixed node sequence** | Fixed qualification sequences ("first ask budget, then ask need, then ask authority") break when the lead volunteers information out of order, which is the default on WhatsApp. | Extract qualification signals dynamically from message content using LLM function calling or structured output. Update qualification state fields when signals appear, regardless of sequence. |
| **Sending multiple messages per response** | WhatsApp UX: multiple rapid messages from a bot feel like spam and trigger block. One thoughtful message beats three short ones. | System prompt constraint: one message per response. One question per response. |
| **Asking qualification questions consecutively** | Research confirms "form fatigue" — asking 4 BANT questions in sequence feels like an interrogation. Leads disengage. | Weave qualification questions into natural conversation. One question per exchange. Mix with empathic statements. |
| **Hard-coding qualification criteria in code** | If SDR qualification criteria change (new product, new market), a code change + redeploy is required. This kills the "update without deploy" value proposition. | Store qualification criteria in the prompts table (DB). The system prompt and qualification instructions are fetched at runtime. Only the graph structure is in code. |
| **CRM write operations in v1.1** | Writing to external CRM (HubSpot, Pipedrive, Salesforce) adds external API dependency, auth complexity, error handling surface area, and potential for data inconsistency. | Capture all qualification data in LangGraph state + leads table. CRM integration is v2 (separate sync service). |
| **Full SPIN/BANT completion before handoff** | Requiring 100% qualification before any human contact loses warm leads who want to talk now. | Handoff trigger on: (1) explicit request from lead, (2) sufficient qualification signals captured (3 of 4 criteria), (3) emotional escalation. Don't gate on completeness. |

### Complexity Notes

Brain SDR is the highest-complexity feature area. The qualification sub-agent is a non-trivial LangGraph composition pattern. For v1.1, consider a simplified initial implementation: one graph with explicit qualification state fields, extraction via structured LLM output, without a fully separate subgraph. The full sub-agent architecture (described in PROJECT.md) is the right long-term design but adds implementation time. Risk: over-engineering the graph in v1.1 at the expense of shipping a working Brain. Recommendation: start with a single graph, extract sub-agent in v1.2 once the conversation flow is validated. Total: ~4-5 days for working SDR Brain, +2-3 days for proper sub-agent extraction.

### Dependencies

- Requires: Leads schema (Feature Area 2) — nome, numero available for personalization
- Requires: Conversation history (Feature Area 3) — thread_id anchoring for memory
- Requires: Both transports (webhook for testing, RabbitMQ for production)
- Requires: Prompts table in DB (already planned in PROJECT.md) — SDR system prompt stored there
- Requires: Auto-migrate on startup (ensures prompts and leads tables exist)
- Blocks: Nothing in v1.1 (this is the terminal feature, built on everything else)

---

## Cross-Feature Dependencies

```
PostgreSQL schema (auto-migrate on startup)
  └── leads table (Feature Area 2)
        └── Lead lookup by numero/IDLead
        └── ia_ativada gate (shared by both transports)
        └── thread_id derivation: "lead-${lead.id}"
              └── PostgresSaver conversation history (Feature Area 3)
                    └── Brain SDR context recovery (Feature Area 4)

RabbitMQ consumer (Feature Area 1)
  └── Calls LeadService.findOrCreate(numero, IDLead, nome) (Feature Area 2)
  └── Checks ia_ativada — returns if false
  └── Derives thread_id from lead.id
  └── Calls BrainRunner.run(message, { thread_id }) → Brain SDR (Feature Area 4)

Webhook transport (existing, fix GAP-1)
  └── Same LeadService call (shared logic, not duplicated)
  └── Same ia_ativada gate
  └── Same thread_id derivation

LeadService (shared service)
  └── Used by both transports
  └── findOrCreate: lookup by IDLead → fallback to numero → INSERT ON CONFLICT
  └── Returns: lead record + derived thread_id

Brain SDR LangGraph graph
  └── Receives: { message, lead, thread_id }
  └── State: { messages[], nome, numero, ia_ativada, qualificado, budget_hint, need_hint, timeline_hint, handoff_requested }
  └── Nodes: greeting | main_conversation | qualification_extractor | handoff_check
  └── Sub-agent (v1.2): qualification as isolated subgraph
```

---

## Feature Complexity Summary

| Feature Area | Core Complexity | High-Risk Sub-Feature | Estimated Effort |
|-------------|----------------|----------------------|-----------------|
| RabbitMQ Consumer | Medium | Reconnect loop + graceful shutdown | 2 days |
| Leads Schema + Auto-registration | Low | Race condition on concurrent INSERT | 1 day |
| Conversation History Wiring | Low | Context window trim + correct thread_id | 1-2 days |
| Brain SDR (simplified, no sub-agent) | High | Qualification signal extraction from natural language | 4-5 days |
| Brain SDR sub-agent extraction | High | LangGraph subgraph composition | +2-3 days (v1.2) |
| Webhook GAP-1 fix | Low | Runner injection in WebhookTransport.start() | 0.5 days |

Total v1.1 estimate: ~9-12 days depending on sub-agent scope decision.

---

## Sources

- [RabbitMQ Consumer Acknowledgements (official docs)](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ Dead Letter Exchanges (official docs)](https://www.rabbitmq.com/docs/dlx)
- [RabbitMQ in Production: DLQ, Retry with TTL, and a Generic Consumer Framework (Medium, Jan 2026)](https://medium.com/@thyagodoliveiraperez/rabbitmq-in-production-dlq-retry-with-ttl-and-a-generic-consumer-framework-3482f9cf2337)
- [Graceful Shutdown of containerised RabbitMQ consumers with Kubernetes (Medium)](https://medium.com/@Monu_Kumar/graceful-shutdown-of-containerised-rabbitmq-consumers-with-kubernetes-6f183368db57)
- [amqplib-bun package (socket.dev)](https://socket.dev/npm/package/amqplib-bun)
- [Managing LangGraph State Across Multiple Servers Using PostgreSQL (Medium, Jun 2026)](https://medium.com/@venkatanaveen.avvaru/managing-langgraph-state-across-multiple-servers-using-postgresql-e3c87e62c058)
- [Managing Threads and Conversation History in LangChain with Checkpoints (Medium)](https://medium.com/@m.naufalrizqullah17/managing-threads-and-conversation-history-in-langchain-with-checkpoints-df7b02beb321)
- [Internals of LangGraph Postgres Checkpointer (blog.lordpatil.com)](https://blog.lordpatil.com/posts/langgraph-postgres-checkpointer/)
- [Stop Using Flow-Builders for Sales: Build a WhatsApp Lead Qualification Agent (trypeach.ai)](https://trypeach.ai/blog/whatsapp-lead-qualification-agent-vs-flow-builder)
- [AI SDR Agents: the complete guide for sales teams in 2026 (monday.com)](https://monday.com/blog/crm-and-sales/ai-sdr-agent/)
- [BANT Lead Qualification: AI-Adapted 2026 (setsmart.io)](https://setsmart.io/blog/bant-lead-qualification)
- [WhatsApp Lead Qualification: Why It's Urgent & How to Automate (trengo.com)](https://trengo.com/blog/whatsapp-lead-qualification)
- [Idempotent Consumer Pattern (microservices.io)](https://microservices.io/post/microservices/patterns/2020/10/16/idempotent-consumer.html)
- [Reliable RabbitMQ: Preventing Message Loss, Duplicates, and Ordering Issues (backend-engineering-chronicles.github.io)](https://backend-engineering-chronicles.github.io/2025/10/31/reliable-rabbitmq-preventing-message-loss-duplicates-and-ordering-issues.html)
- [n8n workflow: AI-powered lead qualification chatbot with Claude, PostgreSQL memory (GitHub)](https://github.com/cameronobriendev/ai-chat-agent)
