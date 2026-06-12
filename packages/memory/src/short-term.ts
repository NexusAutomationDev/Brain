import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";

/**
 * MEM-01: Short-term memory wrapper around PostgresSaver.
 *
 * Short-term memory = the current conversation context stored as LangGraph checkpoints.
 * PostgresSaver is the canonical store (AI-01: MemorySaver prohibited outside unit tests).
 *
 * This module provides thin wrappers so MemoryManager can call these
 * without importing LangGraph's checkpoint API directly.
 */

/**
 * Retrieves the latest checkpoint for a given thread.
 *
 * @param checkpointer - PostgresSaver instance (from createCheckpointer)
 * @param threadId - Session thread ID (from BrainEvent.conversationId or sessionId)
 * @returns The latest CheckpointTuple, or undefined if no checkpoint exists
 */
export async function getCheckpoint(
  checkpointer: PostgresSaver,
  threadId: string
): Promise<CheckpointTuple | undefined> {
  return checkpointer.getTuple({ configurable: { thread_id: threadId } });
}

/**
 * Lists all checkpoints for a thread (useful for history inspection).
 *
 * @param checkpointer - PostgresSaver instance
 * @param threadId - Session thread ID
 * @returns Array of CheckpointTuple in reverse chronological order (newest first)
 */
export async function listCheckpoints(
  checkpointer: PostgresSaver,
  threadId: string
): Promise<CheckpointTuple[]> {
  const tuples: CheckpointTuple[] = [];
  for await (const tuple of checkpointer.list({ configurable: { thread_id: threadId } })) {
    tuples.push(tuple);
  }
  return tuples;
}
