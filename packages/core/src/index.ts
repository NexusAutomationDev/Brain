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
