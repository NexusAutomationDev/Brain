// D-01: LLM decide quando acionar qualify_lead via tool call
// D-02: Grafo ReAct com 3 nós: llm → routeAfterLlm → (tools | respond | __end__)
// D-03: Única tool em v1.1: qualify_lead
// D-04: boundQualifyTool criado em buildGraph() com closure sobre ctx.prompts["qualification"]
//        — garante que o prompt do banco é sempre usado, zero hardcode (SDR-04)
// Anti-pattern: NUNCA chamar compile() aqui — BrainRunner é responsável (runner.ts)
// Anti-pattern: NUNCA usar ctx.tools no ToolNode — usar [boundQualifyTool] diretamente

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BrainStateAnnotation, extractTokenUsage } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";
import { createPauseSessionTool, createFinishConversationTool, createRespondTool } from "@brain-pkg/core";
import { qualifyLeadTool, runQualificationAgent } from "./qualifier.js";
import { createLogger } from "@brain-pkg/observability";

const logger = createLogger();

export const sdrBrain: IBrain = {
  id: "brain-sdr",
  brainType: "sdr",
  // D-08: promptKeys obrigatórios — BrainRunner.init() faz process.exit(1) se algum faltar no banco
  promptKeys: ["system", "qualification"],
  // D-03: Apenas qualify_lead em v1.1 — campo estático para BrainRunner/ToolsRegistry
  // NOTA: tools[] lista as tools disponíveis para o IBrain.
  //       Em execução, buildGraph() cria boundQualifyTool com o prompt real do banco.
  tools: [qualifyLeadTool],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildGraph(ctx: BrainBuildContext): any {
    // D-04: boundQualifyTool — closure sobre ctx.prompts["qualification"] (SDR-04)
    // Garante que o prompt do banco é passado ao sub-agente em cada invocação da tool.
    // qualifyLeadTool (módulo) serve apenas como contrato de schema/name/description.
    // Fix: session_id removido do schema — LLM não sabe o valor real.
    // thread_id é injetado via RunnableConfig do LangGraph (config.configurable.thread_id).
    const boundQualifyTool = tool(
      async ({ description }, config) => {
        const sessionId = (config as any)?.configurable?.thread_id ?? "";
        logger.info({ sessionId }, "qualify_lead tool called (boundQualifyTool)");
        const result = await runQualificationAgent(
          description,
          sessionId,
          ctx.prompts["qualification"] // D-04: prompt do banco — zero hardcode
        );
        return JSON.stringify(result);
      },
      {
        name: qualifyLeadTool.name,
        description: qualifyLeadTool.description,
        schema: z.object({
          description: z
            .string()
            .describe(
              "Breve descrição do momento da conversa e comportamento do lead que motivou a qualificação"
            ),
        }),
      }
    );

    // D-04 (Fase 12): bound com closure sobre ctx.sql — injetado pelo BrainRunner (sempre presente para brain-sdr)
    // ctx.sql! é seguro: index.ts passa sql no construtor do BrainRunner (linha 67)
    const boundPauseSessionTool = createPauseSessionTool(ctx.sql!);
    const boundFinishConversationTool = createFinishConversationTool(ctx.sql!);

    // D-09 (Fase 16): respond tool para responseMode dinâmico (schema-as-tool)
    const respondTool = createRespondTool();

    // CRITICAL: bindTools() com [boundQualifyTool] — não ctx.tools
    // ctx.tools vem do ToolsRegistry e contém qualifyLeadTool sem closure;
    // usar boundQualifyTool garante que o prompt do banco é injetado.
    // BaseChatModel.bindTools é opcional na tipagem — guard de runtime garante provider com tool calling
    if (!ctx.llm.bindTools) {
      throw new Error("LLM provider não suporta tool calling — configure um provider compatível (ex: OpenAI, Anthropic, Gemini)");
    }
    // D-08 (Fase 12): bind com 4 tools nativas + MCP tools injetadas (MCP-02, D-03)
    // Fase 16: respondTool adicionada (D-09) — LLM escolhe responseMode dinamicamente
    // ctx.mcpTools é sempre array (D-02) — [] quando MCP_URL ausente (sem impacto no comportamento)
    const llmWithTools = ctx.llm.bindTools([
      boundQualifyTool,
      boundPauseSessionTool,
      boundFinishConversationTool,
      respondTool,         // D-09 (Fase 16): respond tool para responseMode dinâmico
      ...ctx.mcpTools,    // D-03: MCP tools injetadas pelo BrainRunner; [] quando MCP_URL ausente (D-02)
    ]);

    // HIST-03: context window — slice feito no nó, não no invoke() (Pitfall 3 do runner.ts)
    const getContextWindow = (): number => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40; // SECURITY: T-08-ENV
    };

    // D-01 (Fase 16): router customizado — substitui toolsCondition
    // Inspeciona o NOME do tool_call em vez de apenas a presença
    function routeAfterLlm(state: typeof BrainStateAnnotation.State): "respond" | "tools" | typeof END {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || !("tool_calls" in lastMessage)) return END;
      const toolCalls = (lastMessage as AIMessage).tool_calls ?? [];
      if (toolCalls.length === 0) return END;
      // D-01: respond tool → nó respond; qualquer outra tool → ReAct loop
      if (toolCalls[0].name === "respond") return "respond";
      return "tools";
    }

    return new StateGraph(BrainStateAnnotation)
      .addNode("llm", async (state) => {
        // Substituição de {{ $json.Name }} no system prompt
        const systemContent = ctx.prompts["system"]
          .replace(/\{\{\s*\$json\.Name\s*\}\}/g, state.leadName || "");

        // Fix: garantir que o slice começa em HumanMessage — evita AIMessage/ToolMessage
        // órfão no início da janela, que o Gemini rejeita com 400 Bad Request.
        const allMessages = state.messages;
        const windowSize = getContextWindow();
        let sliceStart = Math.max(0, allMessages.length - windowSize);
        while (sliceStart < allMessages.length && allMessages[sliceStart]._getType() !== "human") {
          sliceStart++;
        }
        const messagesForLLM = allMessages.slice(sliceStart);

        // Injetar data/hora atual na última mensagem do lead (não persiste no checkpoint)
        // Substitui {{ $now.format(...) }} e {{ $now.setLocale(...).weekdayLong }} (syntax n8n)
        const nowTs = new Date();
        const nowTz = 'America/Sao_Paulo';
        const nowParts = new Intl.DateTimeFormat('pt-BR', {
          timeZone: nowTz, day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(nowTs);
        const nowP: Record<string, string> = Object.fromEntries(nowParts.map(({ type, value }) => [type, value]));
        const nowFormatted = `${nowP.day}/${nowP.month}/${nowP.year} ${nowP.hour}:${nowP.minute}`;
        const nowWeekday = new Intl.DateTimeFormat('pt-BR', { timeZone: nowTz, weekday: 'long' }).format(nowTs);
        const enrichedMessages = messagesForLLM.map((msg, idx) => {
          if (idx === messagesForLLM.length - 1 && msg._getType() === "human") {
            const original = typeof msg.content === "string" ? msg.content : "";
            const enriched = `<informacoes>\nO horário atual é ${nowFormatted} de um(a) ${nowWeekday}\n</informacoes>\n\nmensagem:\n${original}`;
            return new HumanMessage(enriched);
          }
          return msg;
        });

        const response = await llmWithTools.invoke([
          { role: "system", content: systemContent },
          ...enrichedMessages,
        ]);
        // Fase 16: Lógica dual — caminho normal (respond tool) vs fallback D-10 (texto plano)
        const fullResponse = typeof response.content === "string" ? response.content : "";
        const toolCalls = (response as AIMessage).tool_calls ?? [];
        const hasRespondCall = toolCalls.some((tc: any) => tc.name === "respond");
        const hasOtherToolCall = !hasRespondCall && toolCalls.length > 0;

        if (hasOtherToolCall) {
          // LLM chamou uma tool que não é respond (ex: getAvailableDate, qualify_lead)
          // Deixar routeAfterLlm rotear para "tools" — NÃO setar brainOutput aqui
          return {
            messages: [response],
            tokenUsage: extractTokenUsage(response),
          };
        }

        if (!hasRespondCall) {
          // D-10 (Fase 16): PITFALL-6 real — LLM emitiu texto sem nenhuma tool call
          const fallback = fullResponse || "Desculpe, tive um problema técnico. Pode repetir?";
          if (!fullResponse) {
            logger.warn("LLM emitiu resposta vazia sem tool call — PITFALL-6");
          } else {
            logger.warn({ content: fullResponse }, "LLM emitiu texto plano sem respond tool — PITFALL-6");
          }
          return {
            messages: [response],
            brainOutput: { fullResponse: fallback, responseMode: "undefined" as const },
            tokenUsage: extractTokenUsage(response),
          };
        }

        // Caminho normal: respond tool será chamada pelo nó respond
        // brainOutput será setado pelo nó respond — não setar aqui
        return {
          messages: [response],
          tokenUsage: extractTokenUsage(response),
        };
      })
      // D-07 (Fase 12): ToolNode com 3 tools nativas + MCP tools (MCP-02, D-03)
      // Fase 16: respondTool excluída do ToolNode de tools — tem seu próprio nó "respond"
      // D-11, MCP-04: handleToolErrors: true — captura erro de MCP tool, injeta ToolMessage — evita thread corrompido (PITFALL-2)
      .addNode("tools", new ToolNode(
        [boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool, ...ctx.mcpTools],
        { handleToolErrors: true }
      ))
      // D-02 (Fase 16): nó respond como nó regular (não ToolNode) — pode setar brainOutput + messages
      // PITFALL-4: emitir ToolMessage para manter paridade AIMessage/ToolMessage no PostgresSaver
      .addNode("respond", async (state) => {
        const messages = state.messages;
        let respondCall: any = null;
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.getType?.() === "ai" || (msg as any)._getType?.() === "ai") {
            const tc = (msg as AIMessage).tool_calls ?? [];
            respondCall = tc.find((c: any) => c.name === "respond");
            if (respondCall) break;
          }
        }
        if (!respondCall) {
          logger.error("respondNode chamado sem tool_call 'respond' no estado — estado inconsistente");
          return {};
        }
        const args = respondCall.args;
        // D-05 (Fase 16): mapear mediaType "file" → "document" antes de BrainOutputSchema.parse()
        const mediaType = args.mediaType === "file" ? "document" : args.mediaType;
        const toolMessage = new ToolMessage({
          content: "ok",
          tool_call_id: respondCall.id ?? "",
          name: "respond",
        });
        return {
          messages: [toolMessage], // D-02: paridade AIMessage/ToolMessage
          brainOutput: {
            fullResponse: args.fullResponse,
            responseMode: args.responseMode,
            ...(mediaType ? { mediaType } : {}),
            ...(args.mediaUrl ? { mediaUrl: args.mediaUrl } : {}),
          },
        };
      })
      .addEdge("__start__", "llm")
      // D-01 (Fase 16): routeAfterLlm substitui toolsCondition — 3 destinos
      .addConditionalEdges("llm", routeAfterLlm, ["tools", "respond", "__end__"])
      .addEdge("tools", "llm")
      .addEdge("respond", "__end__"); // D-01 (Fase 16): respond sempre termina o turno
    // NUNCA chamar compile() aqui — BrainRunner._compileGraph() é responsável
  },
};
