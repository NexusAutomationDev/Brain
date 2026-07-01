---
phase: 29
slug: brain-suporte-core
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-01
---

# Phase 29 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| Webhook ingress (`POST /api/v1/webhook`) | Untrusted external payload (WhatsApp/CRM) crosses into `WebhookTransport` → `BrainRunner.run()`. Same boundary already hardened for brain-sdr (`WEBHOOK_TOKEN` bearer auth), inherited unchanged by `createWebhookApp(runner)`. | Lead message payload |
| RabbitMQ ingress | Untrusted message body from queue crosses into `RabbitMQTransport` consumer → `BrainRunner.run()`. Same DLQ/retry handling inherited unchanged from `@brain-pkg/transport`. | Lead message payload |
| LLM tool-calling boundary | LLM output (`tool_calls`) is semi-trusted — `routeAfterLlm` inspects `tool_calls[0].name` to route; `ToolNode` only executes tools present in the closed `filteredAllTools` array. | Tool name + args (LLM-generated) |
| `thread_id` boundary | `config.configurable.thread_id` set exclusively by `BrainRunner` from `lead.uniqueId`, never from LLM output or request body. | Conversation history key |
| `BRAIN_TOOLS` env / `enabledTools` filter boundary | Operator-controlled ENV; D-04 introduces a deliberate exception (search_knowledge bypasses this filter). | Tool whitelist configuration |
| `MCP_URL`/`MCP_TOOLS` env → `ctx.mcpTools` | Operator-controlled ENV; proven capable of defeating the SUP-02 "never disableable" guarantee via name collision if unfiltered (closed in Plan 03). | Dynamically loaded MCP tool definitions |
| Migration SQL execution | `0010_brain_support_prompts.sql` runs with the same DB credentials as all migrations, under `pg_advisory_lock`. Same trust level as `0005_brain_sdr_prompts.sql` already in production. | Seed prompt content |
| `.env.example` as documentation | Not a runtime boundary — template file with `change-me-in-production` placeholders. | None (non-functional placeholders) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-29-01 | Tampering | `buildGraph()` D-04 bypass logic (`filteredAllTools = [...filteredExceptSearch, boundSearchKnowledgeTool]`) | mitigate | `boundSearchKnowledgeTool` is a fixed, closure-bound reference appended by direct variable reference (not name lookup) after `filteredExceptSearch` is computed. Verified: `apps/brain-support/src/brain.ts:142,147`. | closed |
| T-29-02 | Elevation of Privilege | LLM tool_calls routing (`routeAfterLlm`) | accept | Inherited unchanged from brain-sdr (production-accepted) — `ToolNode` only ever executes tools present in the closed `filteredAllTools` array. | closed |
| T-29-03 | Information Disclosure | `DATABASE_PASSWORD` / `MCP_AUTH_TOKEN` / `WEBHOOK_TOKEN` in logs | mitigate | ENV validation log in `index.ts` lists only missing var *names*, never values. `DATABASE_PASSWORD` is destructured and passed to `TenantPoolManager` config, never to a `logger.*` call. Verified: `apps/brain-support/src/index.ts:38-41,58`. | closed |
| T-29-04 | Denial of Service | `search_knowledge` always bound regardless of `BRAIN_TOOLS` | accept | Structural requirement (SUP-02) — RAG cannot be disabled by design. Query-level cost controls (topK=5, cosine threshold=0.5) hardcoded in `createSearchKnowledgeTool` (packages/core, unchanged). | closed |
| T-29-05 | Repudiation | Tool execution on `leads` table (`pause_session`, `finish_conversation`) without audit trail beyond `updatedAt` | accept | Same posture as brain-sdr (production-accepted) — `IEventPublisher` fire-and-forget event log already covers `pause_session`/`finish_conversation`. | closed |
| T-29-06-P2 | Tampering | Migration idempotency (`ON CONFLICT (brain_type, key) DO NOTHING`) | mitigate | Verified exact pattern present: `packages/database/src/migrations/0010_brain_support_prompts.sql:14`. | closed |
| T-29-07-P2 | Information Disclosure | `.env.example` committed with `change-me-in-production` placeholders | accept | Same posture as `apps/brain-sdr/.env.example` — placeholders are non-functional, not real secrets. | closed |
| T-29-08 | Tampering | `brain_type` value mismatch between migration and `supportBrain.brainType` | mitigate | Verified exact literal `'support'` in migration (`0010_brain_support_prompts.sql:10`) matches `brainType: "support"` in `apps/brain-support/src/brain.ts:93`. | closed |
| T-29-06-P3 | Tampering | `buildGraph()` — `ctx.mcpTools` concatenation into tool list | mitigate | `RESERVED_TOOL_NAMES` set (`brain.ts:84-89`) filters any MCP-sourced tool colliding with `search_knowledge`/`pause_session`/`finish_conversation`/`respond` via `safeMcpTools` (`brain.ts:131-140`) BEFORE concatenation into `allToolsExceptSearch` (`brain.ts:141`). `ctx.mcpTools` referenced only inside the filter, not spread directly. Regression tests confirm no duplicate-name tool reaches `bindTools()`. | closed |
| T-29-07-P3 | Information Disclosure | `logger.warn` on collision drop | accept | Only logs the colliding tool's `.name` (short identifier string) — verified `brain.ts:134-137` logs `{ toolName: t.name }` only, never args/descriptions/MCP credentials. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|--------------|------|
| AR-29-01 | T-29-02 | LLM tool_calls routing can only ever invoke tools present in the closed `filteredAllTools` array bound at graph-build time — arbitrary function names from LLM output are structurally unreachable. Inherited unchanged from brain-sdr, already accepted in production. | gsd-security-auditor (phase 29) | 2026-07-01 |
| AR-29-02 | T-29-04 | `search_knowledge` cannot be disabled via `BRAIN_TOOLS` by design (SUP-02 structural requirement — RAG is core to Brain Suporte's purpose). DoS surface is bounded by hardcoded query-level cost controls (topK=5, cosine threshold=0.5) in `createSearchKnowledgeTool`, unchanged from brain-sdr's existing usage. | gsd-security-auditor (phase 29) | 2026-07-01 |
| AR-29-03 | T-29-05 | `pause_session`/`finish_conversation` execute without a dedicated audit trail beyond `leads.updatedAt`, but `IEventPublisher` fire-and-forget event log already covers both tool names. Same posture accepted for brain-sdr in production; no new surface introduced by Brain Suporte. | gsd-security-auditor (phase 29) | 2026-07-01 |
| AR-29-04 | T-29-07-P2 | `apps/brain-support/.env.example` is committed with `change-me-in-production` placeholders for `DATABASE_PASSWORD`, `ADMIN_TOKEN`, `WEBHOOK_TOKEN`, `INGEST_TOKEN`. These are non-functional template values, not real secrets — same posture as `apps/brain-sdr/.env.example` already in the repo. | gsd-security-auditor (phase 29) | 2026-07-01 |
| AR-29-05 | T-29-07-P3 | `logger.warn` on MCP tool name collision (`brain.ts:134-137`) logs only the colliding tool's short `.name` string — never tool arguments, descriptions, or MCP server credentials (`MCP_AUTH_TOKEN`). No secret material enters the log line. | gsd-security-auditor (phase 29) | 2026-07-01 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|----------------|--------|------|--------|
| 2026-07-01 | 9 | 9 | 0 | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-01
