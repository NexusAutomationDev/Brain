// D-04: Sub-agente stateless — compilado sem checkpointer (apenas analisa, não persiste)
// D-05: Usa createLLM() padrão — sem LLM separado
// D-06: Histórico buscado via PostgresSaver.getTuple() pelo sub-agente diretamente
// D-07: qualify_lead(description, session_id) → {qualificado, motivo, proximo_passo}
// Anti-pattern: NUNCA chamar checkpointer.setup() aqui — tabelas já existem (Pitfall 4)
// Anti-pattern: NUNCA usar instanceof AIMessage — usar _getType() (runner.ts linha ~223)

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createLLM } from "@brain-pkg/ai";
import { createLogger } from "@brain-pkg/observability";
import type { BaseMessage } from "@langchain/core/messages";
import postgres from "postgres";

const logger = createLogger();

// ─── Contrato de resultado ───────────────────────────────────────────────────

/**
 * Resultado da qualificação.
 *
 * `qualificado: null` significa **não foi possível analisar** — falha técnica
 * (LLM indisponível, resposta não-parseável, banco inacessível). NÃO é uma
 * desqualificação: o lead não foi avaliado. Consumidores devem tratar `null`
 * como "sem informação", nunca como "lead rejeitado".
 */
export interface QualificationResult {
  qualificado: boolean | null;
  motivo: string;
  proximo_passo: string;
}

/** Falha dentro do nó `analyze` — LLM não respondeu ou respondeu algo inutilizável. */
const ANALYSIS_FAILED: QualificationResult = {
  qualificado: null,
  motivo: "Falha técnica ao analisar o histórico — a qualificação não foi realizada",
  proximo_passo:
    "Continue a conversa normalmente; não trate o lead como desqualificado",
};

// ─── Helpers de persistência ─────────────────────────────────────────────────

async function saveQualificationToMemories(
  dbUrl: string,
  userId: string,
  qualificado: boolean,
  motivo: string,
  proximo_passo: string
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false }); // PGB-TD01: prepare:false — PgBouncer transaction mode nao suporta prepared statements
  try {
    const value = { qualificado, motivo, proximo_passo, timestamp: new Date().toISOString() };
    await sql`
      INSERT INTO memories (id, user_id, key, value, created_at, updated_at)
      VALUES (gen_random_uuid(), ${userId}, 'qualification', ${sql.json(value)}, NOW(), NOW())
      ON CONFLICT (user_id, key) DO UPDATE
        SET value = ${sql.json(value)}, updated_at = NOW()
    `;
  } finally {
    await sql.end();
  }
}

// ─── QualificationAnnotation ─────────────────────────────────────────────────
// Sub-agente tem StateAnnotation próprio — não usa BrainStateAnnotation
// que é específico para o grafo principal (messages, userId, sessionId)

const QualificationAnnotation = Annotation.Root({
  description: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
  aiMessages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
  humanMessages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
  qualificationPrompt: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
  qualificado: Annotation<boolean | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
  motivo: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
  proximo_passo: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extrai primeiro bloco JSON válido do conteúdo do LLM (Pitfall 5 do RESEARCH.md) */
function extractJSON(text: string): string {
  // Remove code fences se presentes: ```json...```
  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeFenceMatch) return codeFenceMatch[1];
  // Extrai primeiro objeto JSON encontrado
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return text;
}

/** Formata histórico de mensagens como texto para o sub-agente analisar */
function buildHistoryText(
  aiMessages: BaseMessage[],
  humanMessages: BaseMessage[]
): string {
  // Intercalar em ordem cronológica não é possível sem timestamps — listar separado
  const lines: string[] = [];
  lines.push("=== Mensagens do Lead ===");
  humanMessages.forEach((m, i) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    lines.push(`Lead [${i + 1}]: ${content}`);
  });
  lines.push("\n=== Mensagens da IA ===");
  aiMessages.forEach((m, i) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    lines.push(`IA [${i + 1}]: ${content}`);
  });
  return lines.join("\n");
}

// ─── Sub-agente de qualificação ───────────────────────────────────────────────

const qualificationGraph = new StateGraph(QualificationAnnotation)
  .addNode("analyze", async (state) => {
    // D-05: createLLM() usa o provider configurado via ENV
    const llm = await createLLM();
    const historyText = buildHistoryText(state.aiMessages, state.humanMessages);

    try {
      const response = await llm.invoke([
        { role: "system", content: state.qualificationPrompt },
        {
          role: "human",
          content: `Descrição do momento da conversa: ${state.description}\n\nHistórico completo:\n${historyText}\n\nResponda EXCLUSIVAMENTE em JSON: {"qualificado": true/false, "motivo": "...", "proximo_passo": "..."}`,
        },
      ]);

      const content =
        typeof response.content === "string" ? response.content : "";
      const jsonStr = extractJSON(content);
      const parsed = JSON.parse(jsonStr);

      // Sem o booleano não há veredito — resposta inutilizável é falha, não um `false`.
      // Cair no catch abaixo devolve `null`; devolver `false` aqui inventaria uma
      // desqualificação que o modelo nunca emitiu.
      if (typeof parsed.qualificado !== "boolean") {
        throw new Error(
          "campo 'qualificado' ausente ou não-booleano na resposta do LLM"
        );
      }

      return {
        qualificado: parsed.qualificado,
        motivo:
          typeof parsed.motivo === "string" && parsed.motivo
            ? parsed.motivo
            : "Sem motivo informado pelo modelo",
        proximo_passo:
          typeof parsed.proximo_passo === "string" && parsed.proximo_passo
            ? parsed.proximo_passo
            : "Continue a conversa normalmente para coletar mais informações",
      };
    } catch (err) {
      // Pitfall 5: Fallback gracioso — não derruba a conversa principal
      // RESOLVED: Retornar fallback em vez de throw (Open Question Q2 — RESEARCH.md)
      logger.warn(
        { err },
        "Qualification sub-agent: analysis failed — returning null (não é desqualificação)"
      );
      return { ...ANALYSIS_FAILED };
    }
  })
  .addEdge("__start__", "analyze")
  .addEdge("analyze", "__end__");

// D-04: compile() sem checkpointer — stateless por design
// NOTA: MemorySaver é proibido em produção (AI-01 em checkpointer.ts)
// Sub-agente stateless não precisa de checkpointer
const compiledQualificationGraph = qualificationGraph.compile();

// ─── runQualificationAgent ────────────────────────────────────────────────────

/**
 * D-06: Busca histórico via PostgresSaver.getTuple() e invoca sub-agente.
 * Não chama setup() — tabelas já existem (criadas pelo checkpointer principal no init).
 *
 * @param description - Breve contexto do momento da conversa (fornecido pelo LLM principal)
 * @param sessionId - thread_id do lead = lead.uniqueId (D-07)
 * @param qualificationPrompt - Prompt do banco para o sub-agente (ctx.prompts["qualification"]).
 *   Em produção, SEMPRE fornecido pelo boundQualifyTool em brain.ts (SDR-04).
 *   Fallback mínimo usado apenas em chamadas diretas sem contexto de BrainRunner.
 * @returns {qualificado, motivo, proximo_passo} — `qualificado: null` quando a análise falhou
 */
export async function runQualificationAgent(
  description: string,
  sessionId: string,
  qualificationPrompt?: string
): Promise<QualificationResult> {
  const fallback: QualificationResult = {
    qualificado: null,
    motivo: "Falha técnica ao acessar o histórico — a qualificação não foi realizada",
    proximo_passo:
      "Continue a conversa normalmente; não trate o lead como desqualificado",
  };

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.error({}, "DATABASE_URL not set — qualification agent cannot fetch history");
    return fallback;
  }

  // Prompt de fallback mínimo — usado apenas em chamadas sem contexto de BrainRunner.
  // Em produção, ctx.prompts["qualification"] (do banco) é sempre passado via boundQualifyTool.
  const resolvedPrompt =
    qualificationPrompt ??
    'Analise o histórico e determine se o lead está qualificado. Retorne JSON: {"qualificado": bool, "motivo": "...", "proximo_passo": "..."}';

  try {
    // D-06: PostgresSaver.fromConnString sem setup() — tabelas já existem
    // Pitfall 4: NÃO chamar saver.setup() aqui
    // D-03: PostgresSaver usa driver pg (node-postgres v8.21) internamente — nao aceita prepare:false.
    // Limitacao documentada em packages/ai/src/graph/checkpointer.ts. Fora do escopo de TD-01.
    const saver = PostgresSaver.fromConnString(dbUrl);

    // CR-01 fix: fechar pg.Pool após getTuple() — saver não é usado após esta chamada
    // compiledQualificationGraph é stateless e não depende do saver (Pitfall 5 do RESEARCH.md)
    let tuple: Awaited<ReturnType<typeof saver.getTuple>>;
    try {
      tuple = await saver.getTuple({
        configurable: { thread_id: sessionId },
      });
    } finally {
      await saver.end(); // D-09: API pública tipada — fecha o pg.Pool interno
    }

    // Extrair mensagens — tuple pode ser undefined se sessão não tem checkpoint
    const allMessages: BaseMessage[] =
      ((tuple?.checkpoint?.channel_values?.messages) as BaseMessage[]) ?? [];

    // Anti-pattern: _getType() em vez de instanceof (runner.ts linha ~223)
    const aiMessages = allMessages.filter((m) => m._getType() === "ai");
    const humanMessages = allMessages.filter((m) => m._getType() === "human");

    logger.debug(
      { sessionId, aiCount: aiMessages.length, humanCount: humanMessages.length },
      "Qualification agent: history fetched"
    );

    const result = await compiledQualificationGraph.invoke({
      description,
      aiMessages,
      humanMessages,
      qualificationPrompt: resolvedPrompt,
    });

    const finalResult: QualificationResult = {
      qualificado: result.qualificado ?? null,
      motivo: result.motivo || fallback.motivo,
      proximo_passo: result.proximo_passo || fallback.proximo_passo,
    };

    // Persiste resultado na tabela memories (key: "qualification") — fire-and-forget com log.
    // O UPSERT usa ON CONFLICT DO UPDATE: gravar uma falha aqui sobrescreveria uma
    // qualificação genuína anterior. Resultado indeterminado não toca no banco.
    if (finalResult.qualificado !== null) {
      saveQualificationToMemories(
        dbUrl,
        sessionId,
        finalResult.qualificado,
        finalResult.motivo,
        finalResult.proximo_passo
      ).catch((err) => logger.warn({ err, sessionId }, "Qualification: falha ao salvar em memories"));
    } else {
      logger.warn(
        { sessionId },
        "Qualification: resultado indeterminado — memories preservado, evento não publicado"
      );
    }

    return finalResult;
  } catch (err) {
    logger.error({ err, sessionId }, "Qualification agent error — returning fallback");
    return fallback;
  }
}

// ─── serializeQualificationResult ────────────────────────────────────────────

/**
 * Converte o resultado na string de conteúdo da ToolMessage — único ponto de
 * serialização (usado por qualifyLeadTool aqui e por boundQualifyTool em brain.ts).
 *
 * Quando `qualificado` é `null`, a payload ganha `status: "error"`. Esse marcador é
 * lido por `isErrorToolResult` (packages/core/src/events/event-publisher.ts) e faz o
 * BrainRunner NÃO publicar o evento no canal de saída — sem ele, o consumidor externo
 * leria uma falha técnica como lead desqualificado.
 *
 * No caminho de sucesso a payload permanece byte-idêntica à anterior (sem `status`),
 * para não quebrar consumidores já integrados ao webhook.
 */
export function serializeQualificationResult(result: QualificationResult): string {
  if (result.qualificado === null) {
    return JSON.stringify({ status: "error", ...result });
  }
  return JSON.stringify(result);
}

// ─── qualifyLeadTool ─────────────────────────────────────────────────────────

/**
 * D-07: Tool que define o contrato IBrain (schema, name, description).
 *
 * IMPORTANTE: Este export é usado em sdrBrain.tools = [qualifyLeadTool] para satisfazer
 * o contrato IBrain (lista estática de tools disponíveis para o BrainRunner/ToolsRegistry).
 *
 * Em execução, brain.ts cria um `boundQualifyTool` dentro de buildGraph() usando
 * o mesmo schema/name/description mas com closure sobre ctx.prompts["qualification"].
 * É o boundQualifyTool que é passado ao ToolNode e ao bindTools() — não este export.
 *
 * Este qualifyLeadTool sem closure NÃO é chamado em produção diretamente pelo ToolNode.
 */
export const qualifyLeadTool = tool(
  async ({ description, session_id }) => {
    // Este handler só é executado se qualifyLeadTool for chamado diretamente
    // (ex: testes unitários de schema). Em produção, boundQualifyTool é usado.
    logger.info({ session_id }, "qualify_lead tool called (without qualification prompt)");
    const result = await runQualificationAgent(description, session_id);
    return serializeQualificationResult(result);
  },
  {
    name: "qualify_lead",
    description:
      "Aciona o sub-agente de qualificação do lead. Use quando o lead demonstrou interesse suficiente para avaliar o fit com o produto/serviço. Fornece uma análise completa do histórico da conversa e retorna se o lead está qualificado, o motivo e o próximo passo recomendado.",
    schema: z.object({
      description: z
        .string()
        .describe(
          "Breve descrição do momento da conversa e comportamento do lead que motivou a qualificação"
        ),
      session_id: z
        .string()
        .describe(
          "ID da sessão do lead (thread_id = lead.uniqueId) para buscar o histórico completo da conversa"
        ),
    }),
  }
);
