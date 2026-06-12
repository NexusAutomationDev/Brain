// SDK-04: loadPrompts — loads prompts from the prompts table by brainType and keys.
// D-06: Called by BrainRunner.init() to load all promptKeys before starting.
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

  return Object.fromEntries(rows.map((r) => [r.key, r.content]));
}
