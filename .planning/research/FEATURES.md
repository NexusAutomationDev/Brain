# Feature Landscape: AI Agent Platform (Brain Core)

**Domain:** Modular AI agent infrastructure platform (B2B SaaS, specialized vertical agents)
**Researched:** 2026-06-11
**Overall confidence:** HIGH (verified across multiple frameworks, official docs, production guides)

---

## Table Stakes

Features that users (developers, operators deploying Brains) expect. Missing any of these makes the platform feel unfinished or untrustworthy in production.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Brain SDK / Plugin Interface** | Every production agent framework (LangGraph, CrewAI, AutoGen) provides a structured way to define agents — prompts, tools, flows, sub-agents. Without a contract, each Brain becomes a snowflake. | Medium | Core architecture contract: must be stable from v1. Changing this later forces rewrite of all Brains. |
| **Tools Registry with per-agent scoping** | All frameworks treat tools as typed, registered, access-controlled units. LangGraph, CrewAI, MCP protocol all enforce this. "Least-privilege tooling" is now a standard production expectation. | Medium | Per-Brain enable/disable is expected. Full RBAC not required in v1 — binary enable/disable per Brain type is sufficient. |
| **3-Layer Memory (short-term + long-term + semantic)** | CrewAI, LangGraph, Mem0 all ship layered memory. A Brain with no long-term memory forgets the client it just talked to. Semantic (vector) memory enables RAG and knowledge retrieval, which differentiates agents from chatbots. | High | PGVector for semantic layer is the right choice; avoids introducing a separate vector DB. Short-term = in-context state. Long-term = persisted structured facts. Semantic = embedding-indexed retrieval. |
| **State persistence and checkpointing** | LangGraph's standout feature; CrewAI and AutoGen also support it. Production agents must survive restarts. Long-running workflows (SDR qualifying a lead over days) require durable state. | Medium | Foundation for sub-agent patterns and human-in-the-loop. Store in PostgreSQL via `agent_state` table. |
| **Structured logging** | Every production guide identifies this as a prerequisite, not a nicety. Without structured logs, debugging agent failures in production is nearly impossible. | Low | JSON logs with trace_id, tenant_id, brain_type, step_name, duration. Pino or equivalent on Bun. |
| **Health check endpoint** | Every Kubernetes/Docker deployment requires liveness and readiness probes. Ops teams will not deploy without it. | Low | `/health` returning `{ status: "ok", uptime, version }`. |
| **Configurable transport layer (Webhook + MQ)** | Agents that block an HTTP request for LLM reasoning timeout. Async patterns via queue (RabbitMQ, SQS) are a production requirement for reliability. Webhook is required for direct integrations (CRM webhooks, inbound chat). | Medium | Transport must be hot-swappable via ENV. Idempotency key handling is critical for Webhook (retries will cause duplicate agent runs). |
| **Prompt storage in database** | Updating prompts without redeploy is a baseline expectation in any agentic product. Hard-coded prompts mean every tweak requires CI/CD — unacceptable for business users tuning SDR scripts. | Low | `prompts` table with `brain_type`, `version`, `content` columns. Fetched at runtime. |
| **Multi-tenancy: 1 DB per client (initial)** | Data isolation is non-negotiable when selling to businesses. A bug that leaks Tenant A's conversation to Tenant B kills the product. Database-per-tenant provides the strongest isolation guarantee. | Low | DATABASE_NAME env var selects tenant DB. Simpler than RLS to start; can migrate to schema-per-tenant at scale. |
| **Sub-agent spawning and coordination** | Core to the Brain SDR use case (qualification sub-agent). LangGraph subgraph composition, CrewAI crews, and AutoGen GroupChat all treat this as fundamental. Without it, Brain SDR cannot be built. | High | Parent-child pattern: orchestrator Brain spawns a specialized sub-agent, receives result, continues flow. Isolated context per sub-agent is critical to prevent context bloat. |
| **Docker packaging per Brain** | The distribution model is Docker images. This is not optional — it IS the product delivery mechanism. Clients pull the image for their contracted Brain. | Medium | Bun runtime base image. Multi-stage build. Each Brain app produces its own image from the monorepo. |

---

## Differentiators

Features not universally expected, but that create competitive advantage for Brain Core specifically.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Brain SDK as monorepo plugin contract** | Most agent platforms are "single app" deployments. Brain Core's SDK lets developers define a new Brain in one file (prompts, tools, flows, sub-agents) and get the entire infrastructure for free. Speed-to-new-Brain is the moat. | High | The SDK's stability and DX quality is the product. A bad SDK means every Brain is painful to build. |
| **Vertical pre-specialization (SDR, Support, CS)** | Generic agent frameworks force users to build from scratch. Brain Core ships with opinionated Brains for known business workflows. This is what customers buy. | Very High | This is v2+ work. v1 is infrastructure only. But infrastructure decisions must anticipate this. |
| **Semantic memory with domain-specific embeddings** | Generic platforms use general-purpose embeddings. Brains that embed domain-specific knowledge (product catalog, pricing, objection handling) perform substantially better on domain tasks. | High | PGVector + pgai or custom embedding models per Brain type. v1 establishes the infrastructure; specialized models are v2+. |
| **Configurable transport without code change** | Most frameworks hardcode transport (webhook or polling). ENV-driven transport selection means the same Brain image works in different client infrastructure contexts without recompiling. | Medium | Differentiates for enterprise clients with existing RabbitMQ infrastructure. |
| **Flows as database artifacts** | Storing agent flow definitions in the DB (not just prompts) enables runtime reconfiguration without redeploy. | High | Advanced — defer to v2. Requires significant design. v1: flows in code. |
| **Brain composition (Brain-of-Brains)** | An orchestrator Brain that routes to specialist Brains (SDR, Support, CS) based on incoming context. Not available as a first-class primitive in current frameworks. | Very High | Deferred to v2+. v1 establishes the sub-agent pattern needed as building block. |
| **Observability with agent-specific trace structure** | Generic APM tools miss the agent-specific signals (tool call latency, memory retrieval hits, reasoning steps). A purpose-built trace schema for agentic workflows is more actionable. | High | v1: structured logging + health check. Full tracing (OpenTelemetry spans per agent step) is v2. LangSmith integration is a viable shortcut. |

---

## Anti-Features

Things to explicitly NOT build in v1. Each has a reason and a deferral path.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Management UI for Brains** | Requires frontend stack, auth, UX design. Adds weeks/months. Not validated by any customer yet. Zero Brains in production means no users to interact with the UI. | ENV-driven configuration. Database-level prompt editing via SQL/migration. UI in v3+ when clients demand it. |
| **Licensing / LICENSE_KEY enforcement** | Complex to build correctly (online validation, offline grace, key rotation). Adds code to every startup path. Zero revenue-generating Brains means no licensing to protect. | Ship without. Add licensing as a separate concern once the first Brain is in production and billing begins. |
| **Row-level multi-tenancy (tenant_id columns)** | Correct implementation requires adding tenant_id to every query, every index, every RLS policy, every migration. High surface area for bugs. 1-DB-per-tenant gives equivalent isolation at zero query complexity cost for current scale. | 1 DB per client via DATABASE_NAME env. Migrate to RLS/schema-per-tenant only when the number of tenants makes per-DB management painful (50+ tenants). |
| **Multi-LLM provider switching at runtime** | Provider abstraction (swap OpenAI for Anthropic per request) requires an abstraction layer, different token limits, different capability sets. Adds complexity with no current customer need. | Hard-pin to one provider in v1. Add provider abstraction via an interface in v2 only if a client contract requires it. |
| **Agent evaluation / automated testing suite** | LangSmith-style eval frameworks are valuable but require a corpus of expected inputs/outputs, which doesn't exist until Brains are in production. Building evals before having data is speculation. | Add observability hooks in v1 so traces can be captured. Build eval suite in v2 once production data exists. |
| **Visual flow builder / BPMN editor** | Requires a full frontend application. Brain flows are code-defined graphs (LangGraph) — visual abstractions add translation layers and debugging impedance. | LangGraph graph definitions in TypeScript. Flows are code, reviewed in PRs. |
| **Competing orchestration layer** | LangGraph already solves graph-based agent orchestration with checkpointing, sub-graphs, and state reducers. Building a custom orchestrator competes with a well-funded, battle-tested library. | Use LangGraph as the orchestration layer inside each Brain. Brain SDK wraps LangGraph concepts, not replaces them. |
| **Real-time streaming UI** | Server-sent events / WebSocket streaming requires a stateful HTTP layer, client SDK, and UI components. Not needed to validate that Brains work. | Batch response via Webhook or MQ. Add streaming in v2 for chat interfaces. |

---

## Feature Dependencies

```
PostgreSQL + PGVector schema
  └── Short-term memory (agent_state table)
  └── Long-term memory (memories table)
  └── Semantic memory (embeddings table via PGVector)
  └── Prompt storage (prompts table)
  └── Multi-tenancy isolation (per-tenant DB)

Brain SDK
  └── Tools Registry (tools defined and scoped within SDK)
  └── Sub-agent spawning (SDK declares sub-agent interface)
  └── LangGraph orchestration (SDK wraps graph construction)

Transport layer
  └── Webhook handler (idempotency required)
  └── RabbitMQ consumer (ENV-switched)
  └── Both consume Brain SDK entry points

State persistence
  └── LangGraph checkpointing (requires agent_state in DB)
  └── Sub-agent isolation (each sub-agent has own state scope)

Structured logging
  └── Health check (prerequisite: app boots cleanly)
  └── Observability (prerequisite: correlation IDs exist)
```

---

## MVP Recommendation

The minimal viable v1 that makes subsequent Brains buildable:

**Must ship in v1 (infrastructure core):**
1. Brain SDK interface — without this, no Brain can be registered
2. PostgreSQL schema — without this, no memory or prompts work
3. 3-layer memory architecture — short-term + long-term + semantic (PGVector)
4. Tools Registry — enable/disable per Brain type at registration time
5. Transport layer — Webhook + RabbitMQ, ENV-selected
6. Sub-agent spawning primitive — required for SDR Brain (the first planned Brain)
7. Prompt storage in DB — enables tuning without redeploy
8. Multi-tenancy — 1 DB per client via DATABASE_NAME
9. Structured logging + health check — required for Docker deployment
10. Docker packaging — IS the distribution model

**Defer from v1:**
- Specific Brain implementations (SDR, Support, CS) — v2 milestone
- Management UI — v3+
- Licensing — v3+
- Full OpenTelemetry tracing — v2 (logging is enough for v1)
- Evaluation suite — v2 after production data exists
- Flows as DB artifacts — v2+
- Brain composition (routing orchestrator) — v2+

---

## Sources

- [Best Multi-Agent Frameworks in 2026: LangGraph, CrewAI, AutoGen comparison](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [AI Agent Memory: Comparative Analysis of LangGraph, CrewAI, AutoGen](https://dev.to/foxgem/ai-agent-memory-a-comparative-analysis-of-langgraph-crewai-and-autogen-31dp)
- [CrewAI Memory Documentation — Unified Memory Architecture](https://docs.crewai.com/en/concepts/memory)
- [MCP Permissions: Securing AI Agent Access to Tools](https://www.cerbos.dev/blog/mcp-permissions-securing-ai-agent-access-to-tools)
- [AI Agent Access Control: How to manage permissions safely](https://workos.com/blog/ai-agent-access-control)
- [Multi-Tenant AI Agent Architecture Design Guide 2026](https://fast.io/resources/ai-agent-multi-tenant-architecture/)
- [Multi-Tenant Isolation for AI Agents: Security Architecture Guide](https://blaxel.ai/blog/multi-tenant-isolation-ai-agents)
- [The 3 Essential Sub-Agent Patterns for Production-Grade AI Systems](https://www.epsilla.com/blogs/2026-03-14-ai-sub-agent-patterns)
- [Subagent Orchestration: The Complete 2025 Guide](https://www.eesel.ai/blog/subagent-orchestration)
- [LangSmith: AI Agent Observability Platform](https://www.langchain.com/langsmith/observability)
- [AI Agent Observability: Tracing and Debugging with OpenTelemetry](https://callsphere.ai/blog/ai-agent-observability-opentelemetry-langsmith-tracing)
- [Webhook Patterns for AI Voice Agents: Idempotency, Retries, and Security](https://callsphere.tech/blog/webhook-patterns-ai-voice-agents)
- [7 AI Agent Anti-Patterns That Kill Production Projects](https://medium.com/@wasowski.jarek/7-ai-agent-anti-patterns-that-kill-production-projects-architecture-guide-3bb1a409902e)
- [Best Practices for Building Agentic Systems — InfoWorld](https://www.infoworld.com/article/4154570/best-practices-for-building-agentic-systems.html)
- [LangGraph AI Framework 2025: Complete Architecture Guide](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-ai-framework-2025-complete-architecture-guide-multi-agent-orchestration-analysis)
- [Building Multi-Tenant Agents with Amazon Bedrock AgentCore](https://aws.amazon.com/blogs/machine-learning/building-multi-tenant-agents-with-amazon-bedrock-agentcore/)
