// TOOLS-STD-02: finish_conversation — encerra conversa de um lead via thread_id do RunnableConfig.
// D-04: thread_id lido de config.configurable.thread_id (padrão LangChain) — nunca do LLM (D-06).
// D-05: thread_id = lead.uniqueId (IDLead canonical), definido pelo BrainRunner.
// D-11: Factory function — closure sobre sql para compatibilidade multi-tenant.
// Pitfall 1: update ATÔMICO — ia_ativada e fullpp no mesmo .set() para evitar inconsistência.

import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { leads } from "@brain-pkg/database";
import type { Sql } from "postgres";
import { z } from "zod";

/**
 * TOOLS-STD-02: Cria a tool finish_conversation bound ao sql do tenant.
 *
 * Quando invocada, altera leads.ia_ativada = false E leads.fullpp = false
 * em um único UPDATE atômico para o lead identificado pelo thread_id do RunnableConfig.
 *
 * @param sql - postgres.js Sql instance do tenant (de BrainBuildContext.sql)
 */
export function createFinishConversationTool(sql: Sql) {
  const db = drizzle(sql);
  return tool(
    async (_args: Record<string, never>, config?: RunnableConfig) => {
      // D-04: thread_id do RunnableConfig — seguro contra alucinação do LLM (D-06)
      const threadId = config?.configurable?.thread_id as string | undefined;
      if (!threadId) {
        return "Erro: thread_id não disponível na configuração";
      }
      // TOOLS-STD-02: update atômico — iaAtivada=false E fullpp=false no mesmo UPDATE
      // Pitfall 1: dois updates separados criariam risco de inconsistência
      await db
        .update(leads)
        .set({ iaAtivada: false, fullpp: false, updatedAt: new Date() })
        .where(eq(leads.uniqueId, threadId));
      return "Conversa encerrada — IA desativada para este lead";
    },
    {
      name: "finish_conversation",
      description:
        "Encerra definitivamente a conversa automatizada. Use quando o usuário solicita explicitamente encerrar o atendimento ou quando a conversa está concluída.",
      schema: z.object({}),
    }
  );
}
