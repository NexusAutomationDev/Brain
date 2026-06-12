import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readProfile, writeProfile } from "./long-term.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb("LongTermMemory (MEM-02)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  const testUserId = `test-user-${Date.now()}`;

  beforeAll(() => {
    sql = postgres(TEST_URL!);
    db = drizzle(sql) as PostgresJsDatabase;
  });

  afterAll(async () => {
    await sql.end();
  });

  it("readProfile returns null when key does not exist", async () => {
    const result = await readProfile(db, testUserId, "nonexistent-key");
    expect(result).toBeNull();
  });

  it("writeProfile inserts a row in memories table", async () => {
    await expect(
      writeProfile(db, testUserId, "preferences", { theme: "dark" })
    ).resolves.toBeUndefined();
  });

  it("readProfile returns stored value after writeProfile", async () => {
    await writeProfile(db, testUserId, "language", { locale: "pt-BR" });
    const result = await readProfile(db, testUserId, "language");
    expect(result).toEqual({ locale: "pt-BR" });
  });

  it("writeProfile upserts — second write updates value", async () => {
    await writeProfile(db, testUserId, "theme", { mode: "light" });
    await writeProfile(db, testUserId, "theme", { mode: "dark" });
    const result = await readProfile(db, testUserId, "theme");
    expect(result).toEqual({ mode: "dark" });
  });

  it("readProfile with different userId returns null (isolation)", async () => {
    await writeProfile(db, testUserId, "secret-key", { val: 42 });
    const result = await readProfile(db, "other-user-different", "secret-key");
    expect(result).toBeNull();
  });
});
