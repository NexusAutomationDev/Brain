import { describe, it, expect, afterEach } from "bun:test";
import { createWebhookApp } from "../../webhook/handler.js";

const validEvent = {
  Name: "João Silva",
  Message: "Olá, quero saber mais sobre o produto",
  Numero: "5511999990001",
  IDLead: "lead-001",
};

describe("Webhook Bearer token authentication", () => {
  const originalToken = process.env.WEBHOOK_TOKEN;

  afterEach(() => {
    // Restore env after each test
    if (originalToken === undefined) {
      delete process.env.WEBHOOK_TOKEN;
    } else {
      process.env.WEBHOOK_TOKEN = originalToken;
    }
  });

  it("retorna 503 quando WEBHOOK_TOKEN não está configurado (fail-closed)", async () => {
    delete process.env.WEBHOOK_TOKEN;
    const app = createWebhookApp();

    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer qualquer-coisa",
      },
      body: JSON.stringify(validEvent),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain("webhook not configured");
  });

  it("retorna 401 quando Authorization header está ausente", async () => {
    process.env.WEBHOOK_TOKEN = "meu-token-secreto";
    const app = createWebhookApp();

    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Unauthorized");
  });

  it("retorna 401 quando token é incorreto", async () => {
    process.env.WEBHOOK_TOKEN = "meu-token-secreto";
    const app = createWebhookApp();

    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer token-errado",
      },
      body: JSON.stringify(validEvent),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Unauthorized");
  });

  it("processa normalmente com Bearer token correto (retorna 200)", async () => {
    process.env.WEBHOOK_TOKEN = "meu-token-secreto";
    const app = createWebhookApp();

    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer meu-token-secreto",
      },
      body: JSON.stringify(validEvent),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // Sem runner injetado, retorna 'accepted'
    expect(body.status).toBe("accepted");
  });

  it("processa normalmente com token correto e runner injetado (retorna ok + fullResponse + tokenUsage)", async () => {
    process.env.WEBHOOK_TOKEN = "meu-token-secreto";
    // Duck typed — compatível com IBrainRunnerLike (D-02: wrapper { brainOutput, tokenUsage })
    const mockRunner = {
      run: async (_event: unknown) => ({
        brainOutput: {
          fullResponse: "Olá! Como posso ajudar?",
          responseMode: "text" as const,
        },
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      }),
    };
    const app = createWebhookApp(mockRunner);

    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer meu-token-secreto",
      },
      body: JSON.stringify(validEvent),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
    // D-01/D-02 (Fase 12): campo 'reply' removido — usar fullResponse e responseMode
    expect(body.fullResponse).toBe("Olá! Como posso ajudar?");
    expect(body.responseMode).toBe("text");
    expect(body.reply).toBeUndefined();
    // D-09 (Phase 17): tokenUsage na resposta HTTP
    expect(body.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
});
