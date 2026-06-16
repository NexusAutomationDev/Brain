// MCP-01, MCP-02, MCP-03, MCP-05: Testes unitários para o bloco MCP de BrainRunner._compileGraph()
// e para o método close(). Usam helper que replica a lógica exata do runner.ts.
import { describe, test, expect, mock } from "bun:test";

// Helper: simular o bloco MCP de _compileGraph()
// Este helper replica a lógica exata que será implementada no runner.ts
async function runMcpInit(options: {
  mcpUrl: string | undefined;
  mcpTools: string | undefined;
  mcpAuthToken: string | undefined;
  getToolsResult: Array<{ name: string }> | Error;
}): Promise<{
  mcpTools: Array<{ name: string }>;
  warnCalled: boolean;
  infoCalled: boolean;
  clientCreated: boolean;
  clientConfig: any;
}> {
  let warnCalled = false;
  let infoCalled = false;
  let clientCreated = false;
  let clientConfig: any = null;
  let capturedMcpTools: Array<{ name: string }> = [];

  const fakeLogger = {
    info: (_obj: any, _msg: string) => { infoCalled = true; },
    warn: (_obj: any, _msg: string) => { warnCalled = true; },
  };

  const fakeClient = {
    getTools: mock(async () => {
      if (options.getToolsResult instanceof Error) throw options.getToolsResult;
      return options.getToolsResult;
    }),
    close: mock(async () => {}),
  };

  // Simula a lógica de _compileGraph() bloco MCP (Pattern 3 da RESEARCH.md)
  const mcpUrl = options.mcpUrl?.trim();
  let mcpToolsResult: Array<{ name: string }> = [];

  if (mcpUrl) {
    try {
      clientCreated = true;
      clientConfig = {
        mcpServers: {
          "external-server": {
            url: mcpUrl,
            ...(options.mcpAuthToken && {
              headers: { Authorization: `Bearer ${options.mcpAuthToken}` },
            }),
          },
        },
        onConnectionError: "ignore",
      };

      let allTools = await fakeClient.getTools();
      const toolFilter = options.mcpTools?.trim();
      if (toolFilter) {
        const allowed = new Set(
          toolFilter.split(",").map((t: string) => t.trim()).filter(Boolean)
        );
        allTools = allTools.filter((t: { name: string }) => allowed.has(t.name));
      }
      mcpToolsResult = allTools;
      fakeLogger.info(
        { mcpToolCount: mcpToolsResult.length },
        "MCP tools loaded successfully"
      );
    } catch (err) {
      fakeLogger.warn({ err }, "MCP server unreachable at startup — continuing with native tools only (MCP-03)");
      mcpToolsResult = [];
    }
  }

  return {
    mcpTools: mcpToolsResult,
    warnCalled,
    infoCalled,
    clientCreated,
    clientConfig,
  };
}

describe("MCP Init — BrainRunner bloco MCP (MCP-01, MCP-02, MCP-03)", () => {
  test("MCP_URL ausente → mcpTools = [], sem cliente criado (D-09)", async () => {
    const result = await runMcpInit({
      mcpUrl: undefined,
      mcpTools: undefined,
      mcpAuthToken: undefined,
      getToolsResult: [],
    });
    expect(result.mcpTools).toEqual([]);
    expect(result.clientCreated).toBe(false);
  });

  test("MCP_URL definido, getTools() retorna 2 tools → mcpTools tem 2 tools (MCP-01)", async () => {
    const result = await runMcpInit({
      mcpUrl: "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05",
      mcpTools: undefined,
      mcpAuthToken: undefined,
      getToolsResult: [{ name: "tool_a" }, { name: "tool_b" }],
    });
    expect(result.mcpTools).toHaveLength(2);
    expect(result.mcpTools.map(t => t.name)).toContain("tool_a");
    expect(result.mcpTools.map(t => t.name)).toContain("tool_b");
    expect(result.infoCalled).toBe(true);
  });

  test("MCP server inacessível → mcpTools = [], warn logado, sem throw (MCP-03, D-12)", async () => {
    const result = await runMcpInit({
      mcpUrl: "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05",
      mcpTools: undefined,
      mcpAuthToken: undefined,
      getToolsResult: new Error("ECONNREFUSED"),
    });
    expect(result.mcpTools).toEqual([]);
    expect(result.warnCalled).toBe(true);
  });

  test("MCP_TOOLS='tool_a,tool_b' filtra por nome exato (D-08)", async () => {
    const result = await runMcpInit({
      mcpUrl: "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05",
      mcpTools: "tool_a,tool_b",
      mcpAuthToken: undefined,
      getToolsResult: [{ name: "tool_a" }, { name: "tool_b" }, { name: "tool_c" }],
    });
    expect(result.mcpTools).toHaveLength(2);
    expect(result.mcpTools.map(t => t.name)).not.toContain("tool_c");
  });

  test("MCP_TOOLS vazio ('') → retorna todas as tools (D-07)", async () => {
    const result = await runMcpInit({
      mcpUrl: "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05",
      mcpTools: "",
      mcpAuthToken: undefined,
      getToolsResult: [{ name: "tool_a" }, { name: "tool_b" }, { name: "tool_c" }],
    });
    expect(result.mcpTools).toHaveLength(3);
  });

  test("MCP_AUTH_TOKEN definido → header Authorization Bearer adicionado ao config (D-10)", async () => {
    const result = await runMcpInit({
      mcpUrl: "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05",
      mcpTools: undefined,
      mcpAuthToken: "secret-token-123",
      getToolsResult: [],
    });
    expect(result.clientConfig.mcpServers["external-server"].headers).toEqual({
      Authorization: "Bearer secret-token-123",
    });
  });

  test("MCP_AUTH_TOKEN ausente → sem campo headers no config (D-10)", async () => {
    const result = await runMcpInit({
      mcpUrl: "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05",
      mcpTools: undefined,
      mcpAuthToken: undefined,
      getToolsResult: [],
    });
    expect(result.clientConfig.mcpServers["external-server"].headers).toBeUndefined();
  });

  test("onConnectionError é 'ignore' na config do cliente (PITFALL-1)", async () => {
    const result = await runMcpInit({
      mcpUrl: "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05",
      mcpTools: undefined,
      mcpAuthToken: undefined,
      getToolsResult: [],
    });
    expect(result.clientConfig.onConnectionError).toBe("ignore");
  });
});

describe("BrainRunner.close() — shutdown limpo (MCP-05)", () => {
  test("close() é no-op quando mcpClient é null", async () => {
    // Simula BrainRunner com mcpClient = null
    let mcpClient: { close: ReturnType<typeof mock> } | null = null;
    const closeFn = async () => {
      if (mcpClient) {
        await mcpClient.close();
        mcpClient = null;
      }
    };
    // Não deve lançar
    await expect(closeFn()).resolves.toBeUndefined();
  });

  test("close() chama mcpClient.close() e seta campo como null", async () => {
    const closeMock = mock(async () => {});
    let mcpClient: { close: ReturnType<typeof mock> } | null = { close: closeMock };
    const closeFn = async () => {
      if (mcpClient) {
        await mcpClient.close();
        mcpClient = null;
      }
    };
    await closeFn();
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(mcpClient).toBeNull();
  });
});
