// SC-2: HTTP end-to-end — transport → BrainRunner → LangGraph → 3 memory layers → resposta
// Requer container brain-echo rodando (ECHO_URL env var)
// Se ECHO_URL não estiver definido, os testes de integração são pulados

import { describe, test, expect } from "bun:test";

const BASE_URL = process.env.ECHO_URL;
const RUN_INTEGRATION = !!BASE_URL;

// Helper para criar um BrainEvent válido com campos padronizados (TRP-02)
function makeBrainEvent(message: string, numero = `num-${Date.now()}`) {
  return {
    Name: "Test User SC2",
    Message: message,
    Numero: numero,
    IDLead: `lead-sc2-${Date.now()}`,
  };
}

// Helper para fazer POST ao webhook
async function postWebhook(
  body: unknown,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

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

  itOrSkip("body inválido (sem Name, Numero, IDLead) retorna 400", async () => {
    const { status, data } = await postWebhook(
      { Message: "hello" }, // falta Name, Numero, IDLead
    );
    expect(status).toBe(400);
    expect((data as any).error).toBe("Invalid BrainEvent");
  });

  itOrSkip(
    "POST válido retorna 200 com { status: 'ok', reply: string }",
    async () => {
      const event = makeBrainEvent("Olá! Qual é 2+2?", `conv-${Date.now()}`);

      const { status, data } = await postWebhook(event);

      expect(status).toBe(200);
      expect((data as any).status).toBe("ok");
      expect(typeof (data as any).reply).toBe("string");
      expect((data as any).reply.length).toBeGreaterThan(0);
    },
    30_000 // timeout maior — LLM real pode demorar
  );
});
