// SDK-04: loadPrompts — loads prompts from the prompts table by brainType and keys.
// SDK-04b: upsertPrompts — inserts/updates Brain's default prompts into the prompts table.
// D-06: Called by BrainRunner.init() to load all promptKeys before starting.
// D-07: upsertPrompts called by refreshPrompts() when IBrain.defaultPrompts is defined.
// D-08: Uses (brain_type, key) scoped queries — no cross-brainType contamination.
// Pattern: mirrors packages/memory/src/long-term.ts — Sql instance injected, drizzle created locally.
// Never use bun:sql as driver — postgres.js (Sql) only (see CLAUDE.md Critical Risks).

import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, inArray } from "drizzle-orm";
import { prompts } from "@brain-pkg/database";
import type { Sql } from "postgres";

/**
 * SDK-04: Load prompts from the prompts table for a given brainType.
 *
 * Returns a Record mapping key → content for the requested keys.
 * Only returns rows matching both brainType AND the requested keys.
 *
 * Security (T-3-02-02): Query uses and(eq(brainType), inArray(key, keys)) —
 * double filter guarantees no cross-brainType contamination.
 *
 * @param sql - postgres.js Sql instance (from TenantPoolManager or direct inject)
 * @param brainType - Brain category to scope the query (e.g., "echo", "sdr")
 * @param keys - Prompt keys to load (e.g., ["system", "greeting"])
 * @returns Record<string, string> — { [key]: content }
 */
export async function loadPrompts(
  sql: Sql,
  brainType: string,
  keys: string[]
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};

  const db = drizzle(sql);
  const rows = await db
    .select({ key: prompts.key, content: prompts.content })
    .from(prompts)
    .where(and(eq(prompts.brainType, brainType), inArray(prompts.key, keys)));

  return Object.fromEntries(rows.map((r: { key: string; content: string }) => [r.key, r.content]));
}

/**
 * SDK-04b: Upsert prompts into the prompts table for a given brainType.
 * INSERT ... ON CONFLICT (brain_type, key) DO UPDATE SET content = excluded.content
 *
 * Called by BrainRunner.refreshPrompts() when IBrain.defaultPrompts is defined.
 * Allows the Brain code to be the source of truth: modify defaultPrompts, deploy,
 * call POST /reload-prompts — the new content is pushed to DB and reloaded in one step.
 *
 * @param sql - postgres.js Sql instance
 * @param brainType - Brain category (e.g., "sdr", "echo")
 * @param defaultPrompts - Map of { [key]: content } to upsert
 */
export async function upsertPrompts(
  sql: Sql,
  brainType: string,
  defaultPrompts: Record<string, string>
): Promise<void> {
  const entries = Object.entries(defaultPrompts);
  if (entries.length === 0) return;

  const db = drizzle(sql);
  for (const [key, content] of entries) {
    await db
      .insert(prompts)
      .values({ brainType, key, content })
      .onConflictDoUpdate({
        target: [prompts.brainType, prompts.key],
        set: { content, updatedAt: new Date() },
      });
  }
}
