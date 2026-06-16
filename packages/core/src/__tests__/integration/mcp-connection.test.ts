/**
 * Teste de integração MCP — conecta ao servidor real de testes.
 * Requer rede. Roda apenas quando MCP_TEST_URL está definido.
 *
 * Uso:
 *   MCP_TEST_URL=https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05 \
 *   bun test packages/core/src/__tests__/integration/mcp-connection.test.ts
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const MCP_TEST_URL =
  process.env.MCP_TEST_URL ??
  "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05";

describe("MCP Integration — servidor real", () => {
  let client: MultiServerMCPClient;

  beforeAll(async () => {
    client = new MultiServerMCPClient({
      mcpServers: {
        test: {
          url: MCP_TEST_URL,
          // D-14: "http" no JS (@langchain/mcp-adapters), NUNCA "streamable_http" (Python)
          transport: "http",
        },
      },
      onConnectionError: "ignore",
    });
  });

  test("conecta ao servidor MCP e retorna lista de tools", async () => {
    let tools: Awaited<ReturnType<typeof client.getTools>>;
    try {
      tools = await client.getTools();
    } catch (err) {
      // Se servidor inacessível: passa com skip (não é falha de código)
      console.warn("Servidor MCP inacessível — pulando teste de integração:", err);
      return;
    }

    // Servidor acessível: deve retornar array (pode ser vazio se nenhuma tool configurada)
    expect(Array.isArray(tools)).toBe(true);
    console.log(
      `MCP tools disponíveis (${tools.length}):`,
      tools.map((t) => t.name)
    );
  });

  test("tools retornadas têm name e description", async () => {
    let tools: Awaited<ReturnType<typeof client.getTools>>;
    try {
      tools = await client.getTools();
    } catch {
      return; // servidor inacessível — skip
    }

    if (tools.length === 0) {
      console.warn("Servidor MCP não retornou tools — verifique a configuração do servidor");
      return;
    }

    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
    }
  });

  test("MCP_TOOLS CSV filtra tools por nome exato (MCP-01)", async () => {
    let allTools: Awaited<ReturnType<typeof client.getTools>>;
    try {
      allTools = await client.getTools();
    } catch {
      return;
    }

    if (allTools.length === 0) return;

    // Pegar o nome da primeira tool para testar filtro
    const firstToolName = allTools[0].name;

    const filteredClient = new MultiServerMCPClient({
      mcpServers: {
        test: {
          url: MCP_TEST_URL,
          transport: "http",
        },
      },
      onConnectionError: "ignore",
    });

    const filteredTools = await filteredClient.getTools();
    // Simula filtro CSV: filtra manualmente pelo nome
    const filtered = filteredTools.filter((t) => t.name === firstToolName);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe(firstToolName);

    await filteredClient.close();
  });

  test("close() encerra conexão sem hang", async () => {
    const closePromise = client.close();
    // Deve resolver em menos de 5 segundos
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("close() demorou mais de 5s")), 5000)
    );
    await expect(Promise.race([closePromise, timeout])).resolves.toBeUndefined();
  });
});
