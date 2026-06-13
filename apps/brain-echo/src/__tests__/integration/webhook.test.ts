// SC-2: HTTP end-to-end — transport → BrainRunner → LangGraph → 3 memory layers → resposta
// Requer container brain-echo rodando (ECHO_URL env var)
// Se ECHO_URL não estiver definido, os testes de integração são pulados

import { describe, test, expect } from "bun:test";

const BASE_URL = process.env.ECHO_URL;
const RUN_INTEGRATION = !!BASE_URL;

// Helper para criar um BrainEvent válido
function makeBrainEvent(content: string, conversationId = `test-sc2-${Date.now()}`) {
  return {
    conversationId,
    stepIndex: 0,
    userId: "test-user-sc2",
    content,
  };
}

// Helper para fazer POST ao webhook
async function postWebhook(
  body: unknown,
  requestId?: string
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (requestId) {
    headers["X-Request-Id"] = requestId;
  }

  const res = await fetch(`${BASE_URL}/api/v1/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return { status: res.status, data };
}

describe("SC-2: POST /api/v1/webhook end-to-end", () => {
  test("placeholder: arquivo existe e é parseável", () => {
    expect(true).toBe(true);
  });

  const itOrSkip = RUN_INTEGRATION ? test : test.skip;

  itOrSkip("sem X-Request-Id retorna 400", async () => {
    const { status } = await postWebhook(makeBrainEvent("hello"), undefined);
    expect(status).toBe(400);
  });

  itOrSkip("body inválido (sem conversationId) retorna 400", async () => {
    const { status, data } = await postWebhook(
      { content: "hello" }, // falta conversationId, stepIndex, userId
      `test-invalid-${Date.now()}`
    );
    expect(status).toBe(400);
    expect((data as any).error).toBe("Invalid BrainEvent");
  });

  itOrSkip("mesmo X-Request-Id em duas requests retorna 409 na segunda", async () => {
    const requestId = `test-dedup-${Date.now()}`;
    const event = makeBrainEvent("hello dedup", `conv-dedup-${Date.now()}`);

    const first = await postWebhook(event, requestId);
    expect(first.status).toBe(200);

    const second = await postWebhook(event, requestId);
    expect(second.status).toBe(409);
  });

  itOrSkip(
    "POST válido retorna 200 com { status: 'ok', reply: string }",
    async () => {
      const requestId = `test-valid-${Date.now()}`;
      const event = makeBrainEvent("Olá! Qual é 2+2?", `conv-${Date.now()}`);

      const { status, data } = await postWebhook(event, requestId);

      expect(status).toBe(200);
      expect((data as any).status).toBe("ok");
      expect(typeof (data as any).reply).toBe("string");
      expect((data as any).reply.length).toBeGreaterThan(0);
    },
    30_000 // timeout maior — LLM real pode demorar
  );
});
