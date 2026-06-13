import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { CheckpointTuple } from "@langchain/langgraph";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { readProfile, writeProfile } from "./long-term.js";
import { upsertEmbedding, searchSimilar } from "./semantic.js";
import type { EmbeddingInput } from "./semantic.js";
import { getCheckpoint } from "./short-term.js";

/**
 * MEM-04: Unified context returned by MemoryManager.getContext().
 * Contains data from all 3 memory layers.
 */
export interface MemoryContext {
  /** Long-term: stored user profile (key/value from memories table) */
  profile: unknown | null;
  /** Short-term: latest LangGraph checkpoint for this session */
  checkpoint: CheckpointTuple | undefined;
  /** Semantic: top-K similar embeddings from past conversations */
  similarEmbeddings: Array<{ id: string; content: string; similarity: number }>;
}

/**
 * Input for MemoryManager.saveContext().
 */
export interface MemorySaveInput {
  userId: string;
  profileKey: string;
  profileValue: unknown;
  embedding?: EmbeddingInput;
}

/**
 * MEM-04: MemoryManager — unified interface encapsulating all 3 memory layers.
 *
 * Architecture: composition (not inheritance) — each layer is a set of pure functions
 * injected via the db and checkpointer dependencies at construction time.
 *
 * Usage:
 *   const manager = new MemoryManager({ db, checkpointer });
 *   const ctx = await manager.getContext(threadId, userId, queryVector);
 */
export class MemoryManager {
  private db: PostgresJsDatabase;
  private checkpointer: PostgresSaver;

  constructor({ db, checkpointer }: { db: PostgresJsDatabase; checkpointer: PostgresSaver }) {
    this.db = db;
    this.checkpointer = checkpointer;
  }

  /**
   * MEM-04, SC-2: Retrieve context from all 3 memory layers in parallel.
   *
   * @param threadId - Session thread ID (used for short-term checkpoint lookup)
   * @param userId - User ID (used for long-term profile and semantic isolation)
   * @param queryVector - Embedding vector for semantic search (pass [] to skip)
   * @param profileKey - Which profile key to read (default: "context")
   * @param topK - Number of similar embeddings to retrieve (default: 3)
   */
  async getContext(
    threadId: string,
    userId: string,
    queryVector: number[],
    profileKey = "context",
    topK = 3
  ): Promise<MemoryContext> {
    const [profile, checkpoint, similarEmbeddings] = await Promise.all([
      readProfile(this.db, userId, profileKey),
      getCheckpoint(this.checkpointer, threadId),
      queryVector.length > 0
        ? searchSimilar(this.db, userId, queryVector, topK)
        : Promise.resolve([]),
    ]);

    return { profile, checkpoint, similarEmbeddings };
  }

  /**
   * MEM-04: Persist context to long-term and semantic layers.
   * Short-term (checkpoint) is managed by LangGraph automatically — no explicit save needed here.
   */
  async saveContext(input: MemorySaveInput): Promise<void> {
    await writeProfile(this.db, input.userId, input.profileKey, input.profileValue);
    if (input.embedding) {
      upsertEmbedding(this.db, input.embedding); // fire-and-forget
    }
  }
}
