// TOOLS-STD-01: pause_session — pausa sessão de um lead via thread_id do RunnableConfig.
// D-04: thread_id lido de config.configurable.thread_id (padrão LangChain) — nunca do LLM (D-06).
// D-05: thread_id = lead.uniqueId (IDLead canonical), definido pelo BrainRunner.
// D-11: Factory function — closure sobre sql para compatibilidade multi-tenant.

import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { leads } from "@brain-pkg/database";
import type { Sql } from "postgres";
import { z } from "zod";

/**
 * TOOLS-STD-01: Cria a tool pause_session bound ao sql do tenant.
 *
 * Quando invocada, altera leads.fullpp = false para o lead identificado
 * pelo thread_id do RunnableConfig (= lead.uniqueId canonical).
 *
 * @param sql - postgres.js Sql instance do tenant (de BrainBuildContext.sql)
 */
export function createPauseSessionTool(sql: Sql) {
  const db = drizzle(sql);
  return tool(
    async (_args: Record<string, never>, config?: RunnableConfig) => {
      // D-04: thread_id do RunnableConfig — seguro contra alucinação do LLM (D-06)
      const threadId = config?.configurable?.thread_id as string | undefined;
      if (!threadId) {
        return "Erro: thread_id não disponível na configuração";
      }
      await db
        .update(leads)
        .set({ fullpp: false, updatedAt: new Date() })
        .where(eq(leads.uniqueId, threadId));
      return "Sessão pausada com sucesso — atendimento humano ativado";
    },
    {
      name: "pause_session",
      description:
        "Pausa a sessão atual e transfere para atendimento humano. Use quando o usuário pede para falar com um humano ou quando a conversa requer intervenção manual.",
      schema: z.object({}),
    }
  );
}
