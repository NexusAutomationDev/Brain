import { eq, and } from "drizzle-orm";
import { memories } from "@brain-pkg/database";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * MEM-02: Long-term memory — structured user profile read/write via Drizzle.
 *
 * Uses the `memories` table from Phase 1 schema.
 * Provides key/value storage per userId — suitable for user preferences,
 * summarized history, and context that must survive session restarts.
 *
 * Security (T-2-05-01): WHERE clause always includes eq(memories.userId, userId)
 * to enforce per-user isolation and prevent cross-user data leakage.
 *
 * @param db - Drizzle database instance (from drizzle(sql) using postgres.js)
 * @param userId - External user identifier (from BrainEvent.userId)
 * @param key - Memory key (e.g., "preferences", "summary", "profile")
 * @returns The stored JSON value, or null if not found
 */
export async function readProfile(
  db: PostgresJsDatabase,
  userId: string,
  key: string
): Promise<unknown | null> {
  const rows = await db
    .select({ value: memories.value })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.key, key)))
    .limit(1);

  return rows.length > 0 ? rows[0].value : null;
}

/**
 * MEM-02: Write (upsert) a user profile value.
 *
 * Inserts a new row or updates the existing one if userId+key already exists.
 * Uses Drizzle's onConflictDoUpdate for atomic upsert.
 *
 * @param db - Drizzle database instance
 * @param userId - External user identifier
 * @param key - Memory key
 * @param value - JSON-serializable value to store
 */
export async function writeProfile(
  db: PostgresJsDatabase,
  userId: string,
  key: string,
  value: unknown
): Promise<void> {
  await db
    .insert(memories)
    .values({
      userId,
      key,
      value: value as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [memories.userId, memories.key],
      set: {
        value: value as Record<string, unknown>,
        updatedAt: new Date(),
      },
    });
}
