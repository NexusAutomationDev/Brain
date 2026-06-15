import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWebhookApp } from "./handler.js";

const TEST_TOKEN = "test-token-handler";

const validEvent = {
  Name: "João Silva",
  Message: "Olá, quero saber mais sobre o produto",
  Numero: "5511999990001",
  IDLead: "lead-001",
};

describe("WebhookTransport handler (TRANS-02, TRP-02)", () => {
  let app: ReturnType<typeof createWebhookApp>;

  beforeEach(() => {
    // Set WEBHOOK_TOKEN so auth passes in all handler tests
    process.env.WEBHOOK_TOKEN = TEST_TOKEN;
    // Fresh app for each test
    app = createWebhookApp();
  });

  afterEach(() => {
    delete process.env.WEBHOOK_TOKEN;
  });

  it("POST /api/v1/webhook with valid BrainEvent returns 200 { status: 'accepted' } without runner", async () => {
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(validEvent),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("accepted");
  });

  it("POST /api/v1/webhook without X-Request-Id returns 200 (header not required)", async () => {
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(validEvent),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
  });

  it("POST /api/v1/webhook with runner injected returns 200 { status: 'ok', reply: string }", async () => {
    // Duck typed — compatível com nova IBrainRunnerLike (SDK-06)
    const mockRunner = {
      run: async (_event: unknown) => ({
        fullResponse: "Olá! Posso te ajudar.",
        responseMode: "text" as const,
      }),
    };
    const appWithRunner = createWebhookApp(mockRunner);
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(validEvent),
    });
    const res = await appWithRunner.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.reply).toBe("string");
    expect(body.reply).toBe("Olá! Posso te ajudar.");
  });

  it("POST /api/v1/webhook with old payload { conversationId, stepIndex, userId, content } returns 400", async () => {
    const oldEvent = {
      conversationId: "conv-001",
      stepIndex: 0,
      userId: "user-001",
      content: "hello",
    };
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(oldEvent),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Invalid BrainEvent");
  });

  it("POST /api/v1/webhook with malformed JSON returns 400 (T-05-01)", async () => {
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_TOKEN}`,
      },
      body: "not-valid-json{{{",
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
  });

  it("POST with missing required BrainEvent field (only Name) returns 400 (T-05-01)", async () => {
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({ Name: "João" }), // missing Message, Numero, IDLead
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Invalid BrainEvent");
  });

  it("POST /api/v1/webhook com runner retornando null retorna 200 { status: 'ignored' } (LEAD-03)", async () => {
    const nullRunner = {
      run: async (_event: unknown) => null,
    };
    const appWithNullRunner = createWebhookApp(nullRunner);
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(validEvent),
    });
    const res = await appWithNullRunner.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ignored");
  });

  it("POST /api/v1/webhook sem IDLead retorna 400 com error Invalid BrainEvent (TRP-01)", async () => {
    // TRP-01: T-07-01 — IDLead ausente deve ser rejeitado antes do upsert
    const req = new Request("http://localhost/api/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({ Name: "João", Message: "Olá", Numero: "5511999990001" }), // IDLead ausente
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Invalid BrainEvent");
  });
});
