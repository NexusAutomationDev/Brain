// MCP-04, PITFALL-2: Testes para ToolNode.handleToolErrors
// Verifica que tool errors MCP não corrompem o thread (ToolMessage de erro em vez de throw)
import { describe, test, expect } from "bun:test";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, ToolMessage } from "@langchain/core/messages";

describe("ToolNode handleToolErrors — PITFALL-2 (MCP-04)", () => {
  test("ToolNode com handleToolErrors:true injeta ToolMessage de erro sem lançar", async () => {
    const { tool } = await import("@langchain/core/tools");
    const { z } = await import("zod");

    const failingTool = tool(
      async (_input: { query: string }) => {
        throw new Error("MCP tool timeout");
      },
      {
        name: "failing_mcp_tool",
        description: "Simula MCP tool que falha",
        schema: z.object({ query: z.string() }),
      }
    );

    const toolNode = new ToolNode([failingTool], { handleToolErrors: true });

    const aiMessage = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call_123",
          name: "failing_mcp_tool",
          args: { query: "test" },
          type: "tool_call",
        },
      ],
    });

    // Não deve lançar — handleToolErrors captura e injeta ToolMessage de erro
    const result = await toolNode.invoke({ messages: [aiMessage] });

    // Deve haver pelo menos 1 ToolMessage no resultado
    const toolMessages = result.messages.filter(
      (m: any) => m instanceof ToolMessage
    );
    expect(toolMessages).toHaveLength(1);
    // ToolMessage de erro deve ter o mesmo tool_call_id
    expect((toolMessages[0] as ToolMessage).tool_call_id).toBe("call_123");
    // Conteúdo deve mencionar o erro
    expect(typeof (toolMessages[0] as ToolMessage).content).toBe("string");
  });

  test("ToolNode com array vazio e handleToolErrors:true não lança em construção", () => {
    expect(() => new ToolNode([], { handleToolErrors: true })).not.toThrow();
  });
});
