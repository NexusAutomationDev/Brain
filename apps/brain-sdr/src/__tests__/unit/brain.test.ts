import { describe, test, expect, mock } from "bun:test";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

describe("BrainSDR — IBrain contract (SDR-01, SDR-04)", () => {
  test("sdrBrain.id é 'brain-sdr'", async () => {
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.id).toBe("brain-sdr");
  });

  test("sdrBrain.brainType é 'sdr'", async () => {
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.brainType).toBe("sdr");
  });

  test("sdrBrain.promptKeys é ['system', 'qualification']", async () => {
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.promptKeys).toEqual(["system", "qualification"]);
  });

  test("sdrBrain.tools tem exatamente 2 tools: qualify_lead e search_knowledge (D-02, D-03 Phase 23)", async () => {
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.tools).toHaveLength(2);
    const toolNames = mod.sdrBrain.tools.map((t: any) => t.name);
    expect(toolNames).toContain("qualify_lead");
    expect(toolNames).toContain("search_knowledge");
  });

  test("buildGraph(ctx) retorna StateGraph (tem addNode e compile)", async () => {
    const mod = await import("../../brain.js");
    const ctx = {
      llm: {
        bindTools: mock(() => ({
          invoke: mock(async () => ({ content: "resposta", tool_calls: [] })),
        })),
      },
      prompts: { system: "prompt sistema", qualification: "prompt qualificacao" },
      tools: [],
      sql: {} as any, // D-14: mock simples — createXTool(sql) acessa DB apenas na invocação, não na criação
      mcpTools: [], // MCP-02: sempre array, nunca undefined (D-02)
    };
    const graph = mod.sdrBrain.buildGraph(ctx as any);
    expect(graph).toBeTruthy();
    expect(typeof graph.addNode).toBe("function");
    expect(typeof graph.compile).toBe("function");
  });
});

describe("qualify_lead tool — contrato SDR-05", () => {
  test("qualifyLeadTool.name é 'qualify_lead'", async () => {
    const mod = await import("../../qualifier.js");
    expect(mod.qualifyLeadTool.name).toBe("qualify_lead");
  });

  test("qualifyLeadTool.schema tem campo description", async () => {
    const mod = await import("../../qualifier.js");
    // DynamicStructuredTool tem schema.shape para ZodObject
    const shape = (mod.qualifyLeadTool.schema as any).shape;
    expect(shape).toHaveProperty("description");
  });

  test("qualifyLeadTool.schema tem campo session_id", async () => {
    const mod = await import("../../qualifier.js");
    const shape = (mod.qualifyLeadTool.schema as any).shape;
    expect(shape).toHaveProperty("session_id");
  });
});

describe("contextWindowSize — parse seguro (SDR-01, HIST-03)", () => {
  test("fallback 40 quando ENV é inválida", () => {
    const validate = (envVal: string | undefined): number => {
      const n = parseInt(envVal ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40;
    };
    expect(validate(undefined)).toBe(40);
    expect(validate("abc")).toBe(40);
    expect(validate("-5")).toBe(40);
    expect(validate("0")).toBe(40);
    expect(validate("20")).toBe(20);
  });
});

describe("BrainSDR — Standard Tools binding (D-07, D-08, TOOLS-STD-03)", () => {
  test("buildGraph(ctx) com ctx.sql mock chama bindTools com 5 tools (incluindo search_knowledge e respond)", async () => {
    // Re-importar para garantir estado limpo (Bun test pode cachear módulos)
    const mod = await import("../../brain.js");
    const bindToolsMock = mock(() => ({
      invoke: mock(async () => ({ content: "resposta", tool_calls: [] })),
    }));
    const ctx = {
      llm: { bindTools: bindToolsMock },
      prompts: { system: "prompt sistema", qualification: "prompt qualificacao" },
      tools: [],
      sql: {} as any, // D-14: mock simples — factory aceita qualquer objeto em construção
      mcpTools: [], // MCP-02: mcpTools vazio → bindTools recebe 5 tools nativas (Phase 23: +search_knowledge)
    };
    mod.sdrBrain.buildGraph(ctx as any);
    // Verificar que bindTools foi chamado 1 vez com array de 5 tools (Phase 23: +search_knowledge)
    expect(bindToolsMock).toHaveBeenCalledTimes(1);
    const callArgs = (bindToolsMock as any).mock.calls[0][0] as Array<{ name: string }>;
    expect(callArgs).toHaveLength(5);
    const toolNames = callArgs.map((t) => t.name);
    expect(toolNames).toContain("qualify_lead");
    expect(toolNames).toContain("pause_session");
    expect(toolNames).toContain("finish_conversation");
    expect(toolNames).toContain("search_knowledge"); // D-01 (Phase 23): RAG-02/RAG-03
    expect(toolNames).toContain("respond");
  });

  test("sdrBrain.tools[] tem 2 tools: qualify_lead e search_knowledge (D-02, D-03 Phase 23)", async () => {
    const mod = await import("../../brain.js");
    // D-02 (Phase 23): search_knowledge entra em sdrBrain.tools[] como schema estático declarativo
    // para manter o contrato IBrain completo e auto-documentado
    expect(mod.sdrBrain.tools).toHaveLength(2);
    const toolNames = mod.sdrBrain.tools.map((t: any) => t.name);
    expect(toolNames).toContain("qualify_lead");
    expect(toolNames).toContain("search_knowledge");
  });
});

describe("BrainSDR — nó llm seta brainOutput (D-09, D-10, PARSER-03)", () => {
  test("sdrBrain.promptKeys contém 'system' e 'qualification'", async () => {
    // Verificação regressiva — promptKeys não mudam (D-11)
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.promptKeys).toEqual(["system", "qualification"]);
  });

  test("grafo compilado seta brainOutput.responseMode como 'undefined' no fallback D-10 (LLM sem tool_calls)", async () => {
    // D-10 (Fase 16): quando LLM não chama nenhuma tool, responseMode é "undefined" (fallback)
    // O mock retorna AIMessage sem tool_calls → router cai em __end__ → nó llm seta fallback
    const mod = await import("../../brain.js");
    const llmInvokeMock = mock(async () =>
      new AIMessage({ content: "resposta do llm", tool_calls: [] })
    );
    const ctx = {
      llm: {
        bindTools: mock(() => ({ invoke: llmInvokeMock })),
      },
      prompts: { system: "prompt sistema", qualification: "prompt qualificacao" },
      tools: [],
      sql: {} as any,
      mcpTools: [], // MCP-02: sempre array (D-02)
    };
    const graph = mod.sdrBrain.buildGraph(ctx as any);
    const compiled = graph.compile();
    const result = await compiled.invoke(
      { messages: [{ role: "user", content: "olá" }] },
      { configurable: { thread_id: "test-parser-03" } }
    );
    expect(result.brainOutput).toBeDefined();
    expect(result.brainOutput.fullResponse).toBe("resposta do llm");
    // D-10: fallback — LLM sem tool_calls usa responseMode "undefined" (não "text")
    expect(result.brainOutput.responseMode).toBe("undefined");
  });
});

describe("BrainSDR — MCP tools integration (MCP-02, D-03)", () => {
  test("buildGraph(ctx) com ctx.mcpTools=[mockTool] chama bindTools com 6 tools (4 nativas + respond + search_knowledge + 1 MCP)", async () => {
    const mod = await import("../../brain.js");
    const bindToolsMock = mock(() => ({
      invoke: mock(async () => ({ content: "resposta", tool_calls: [] })),
    }));
    const fakeMcpTool = {
      name: "mcp_fake_tool",
      description: "fake mcp tool para teste",
      invoke: async () => "result",
    };
    const ctx = {
      llm: { bindTools: bindToolsMock },
      prompts: { system: "s", qualification: "q" },
      tools: [],
      sql: {} as any,
      mcpTools: [fakeMcpTool], // MCP-02: 1 tool MCP → bindTools deve receber 6 no total (Phase 23: +search_knowledge)
    };
    (mod.sdrBrain as any).buildGraph(ctx as any);
    const callArgs = (bindToolsMock as any).mock.calls[0][0] as Array<{ name: string }>;
    expect(callArgs).toHaveLength(6); // Phase 23: 5 nativas + 1 MCP
    const toolNames = callArgs.map((t: any) => t.name);
    expect(toolNames).toContain("mcp_fake_tool");
    expect(toolNames).toContain("qualify_lead");
    expect(toolNames).toContain("pause_session");
    expect(toolNames).toContain("finish_conversation");
    expect(toolNames).toContain("search_knowledge"); // D-01 (Phase 23): RAG-02/RAG-03
    expect(toolNames).toContain("respond");
  });
});

describe("tokenUsage em BrainSDR llm node (D-06, D-07, TOK-07)", () => {
  test("TOK-07: llm node populates tokenUsage from usage_metadata (D-07)", async () => {
    const mod = await import("../../brain.js");
    const mockLlm = {
      bindTools: mock(() => ({
        invoke: mock(async () =>
          new AIMessage({
            content: "resposta direta",
            tool_calls: [],
            usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          })
        ),
      })),
    };
    const ctx = {
      llm: mockLlm,
      prompts: { system: "You are helpful.", qualification: "Qual é o score?" },
      tools: [],
      sql: {} as any,
      mcpTools: [],
    };
    const graph = mod.sdrBrain.buildGraph(ctx as any);
    const compiled = graph.compile();
    const result = await compiled.invoke(
      { messages: [new HumanMessage("teste")] },
      { configurable: { thread_id: "test-tok-07" } }
    );
    expect(result.tokenUsage.inputTokens).toBe(100);
    expect(result.tokenUsage.outputTokens).toBe(50);
    expect(result.tokenUsage.totalTokens).toBe(150);
  });
});

describe("BrainSDR — respond tool sempre ativa (TECH-05, D-01)", () => {
  test("buildGraph() com BRAIN_TOOLS whitelist omitting 'respond' still includes respond in bindTools", async () => {
    const mod = await import("../../brain.js");
    const bindToolsMock = mock(() => ({
      invoke: mock(async () => ({ content: "ok", tool_calls: [] })),
    }));
    const ctx = {
      llm: { bindTools: bindToolsMock },
      prompts: { system: "sys", qualification: "qual" },
      tools: [],
      sql: {} as any,
      mcpTools: [],
      enabledTools: new Set(["qualify_lead", "pause_session"]), // respond deliberately omitted
    };
    mod.sdrBrain.buildGraph(ctx as any);
    const callArgs = (bindToolsMock as any).mock.calls[0][0] as Array<{ name: string }>;
    const toolNames = callArgs.map((t) => t.name);
    expect(toolNames).toContain("respond");  // respond present despite not in enabledTools
  });
});

describe("BrainSDR — routeAfterLlm router customizado (D-01, RESP-01)", () => {
  test("retorna brainOutput com responseMode 'text' quando LLM chama respond tool com responseMode='text'", async () => {
    const mod = await import("../../brain.js");
    const bindToolsMock = mock(() => ({
      invoke: mock(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{ name: "respond", args: { fullResponse: "oi", responseMode: "text" }, id: "tc-1", type: "tool_call" }],
        })
      ),
    }));
    const ctx = {
      llm: { bindTools: bindToolsMock },
      prompts: { system: "s", qualification: "q" },
      tools: [],
      sql: {} as any,
      mcpTools: [],
    };
    const graph = mod.sdrBrain.buildGraph(ctx as any);
    const compiled = graph.compile();
    // Invocar o grafo — com respond tool_call, deve ir para nó respond e setar brainOutput
    const result = await compiled.invoke(
      { messages: [{ role: "user", content: "olá" }] },
      { configurable: { thread_id: "test-router-respond" } }
    );
    // O nó respond deve ter setado brainOutput com o responseMode da tool call
    expect(result.brainOutput).toBeDefined();
    expect(result.brainOutput.responseMode).toBe("text");
    expect(result.brainOutput.fullResponse).toBe("oi");
  });

  test("retorna responseMode 'undefined' no fallback D-10 quando LLM não chama nenhuma tool", async () => {
    const mod = await import("../../brain.js");
    const bindToolsMock = mock(() => ({
      invoke: mock(async () =>
        new AIMessage({ content: "texto direto sem tool", tool_calls: [] })
      ),
    }));
    const ctx = {
      llm: { bindTools: bindToolsMock },
      prompts: { system: "s", qualification: "q" },
      tools: [],
      sql: {} as any,
      mcpTools: [],
    };
    const graph = mod.sdrBrain.buildGraph(ctx as any);
    const compiled = graph.compile();
    const result = await compiled.invoke(
      { messages: [{ role: "user", content: "olá" }] },
      { configurable: { thread_id: "test-router-end" } }
    );
    expect(result.brainOutput.responseMode).toBe("undefined");
  });
});
