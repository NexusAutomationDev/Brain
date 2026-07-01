// packages/core — public API barrel export
// T-3-04-04: Explicit named exports only — no `export *` to prevent leaking internals.

// SDK-01: IBrain contract
export type { IBrain, BrainBuildContext } from "./brain/interface.js";
export { BrainRegistry } from "./brain/registry.js";

// SDK-02: BrainRunner
export { BrainRunner } from "./runner/runner.js";
export type { BrainRunnerOptions } from "./runner/runner.js";

// SDK-03: ToolsRegistry
export { ToolsRegistry } from "./tools/registry.js";

// SDK-04: Prompts loader/upserter (used by BrainRunner internally, exposed for testing/advanced use)
export { loadPrompts, upsertPrompts } from "./prompts/loader.js";

// SDK-05: Core server (createCoreApp — exposes /reload-prompts endpoint)
export { createCoreApp } from "./server.js";

// LEAD-02: LeadService
export { LeadService } from "./leads/lead-service.js";
export type { Lead } from "./leads/lead-service.js";

// SDK-06: BrainOutput contract — schema Zod em core, type em shared
export { BrainOutputSchema, ResponseModeSchema } from "./output/schema.js";
export type { BrainOutput, ResponseMode } from "./output/schema.js";

// SDK-07: Standard Tools — factories para tools de controle de sessão + respond tool (RESP-01)
// D-11: Exportar apenas factories (não instâncias) — Brain chama createXTool(ctx.sql!) em buildGraph()
export { createPauseSessionTool } from "./tools/pause-session.js";
export { createFinishConversationTool } from "./tools/finish-conversation.js";
export { createRespondTool } from "./tools/respond.js";

// RAG-01/RAG-02: RAG tools and ingest endpoint
// D-05: createIngestApp exportado para Brain apps montarem explicitamente no server.ts
// D-06: createSearchKnowledgeTool exportado para BrainRunner injetar via buildGraph()
export { createSearchKnowledgeTool } from "./tools/search-knowledge.js";
export { createIngestApp } from "./rag/index.js";
export { createReembedApp } from "./rag/index.js";

// EVT-01: EventPublisher — canal de saída para eventos de tools
export type { IEventPublisher, ToolEvent } from "./events/event-publisher.js";
export { EventPublisher, NoopEventPublisher } from "./events/event-publisher.js";

// FUP-01 a FUP-08: FupScheduler — scheduler background de follow-ups automáticos
export type { IFupScheduler } from "./fup/fup-scheduler.js";
export { FupScheduler, getNextValidSlot } from "./fup/fup-scheduler.js";
