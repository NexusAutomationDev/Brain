// SC-3: PostgresSaver durable state across container restart
// D-09: usa Bun.spawn + docker CLI para reiniciar o container
// Requer: ECHO_URL e ECHO_CONTAINER_NAME env vars
// Pitfall 6: NÃO instanciar PostgresSaver diretamente em bun test

import { describe, test, expect } from "bun:test";

const BASE_URL = process.env.ECHO_URL;
const CONTAINER_NAME = process.env.ECHO_CONTAINER_NAME;
const RUN_INTEGRATION = !!(BASE_URL && CONTAINER_NAME);

// ID único para esta conversa — preservado entre turnos 1 e 2
// Numero é usado como threadId temporário (Phase 8: substituir por lead.unique_id)
const CONVERSATION_ID = `test-sc3-restart-${Date.now()}`;
// Nome único para identificar o contexto a ser recuperado
const CONTEXT_MARKER = `TestUser-${Date.now()}`;

async function sendMessage(message: string, stepIndex: number): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Name: "Test User SC3",
      Message: message,
      Numero: CONVERSATION_ID, // O mesmo Numero faz o LangGraph carregar o checkpoint do turno anterior
      IDLead: "lead-sc3-restart",
    }),
  });
  const body = await res.json() as { status: string; reply: string };
  expect(res.status).toBe(200);
  return body.reply;
}

async function waitForContainer(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // container ainda reiniciando
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`Container at ${BASE_URL} did not respond after ${timeoutMs}ms`);
}

describe("SC-3: PostgresSaver persistence across container restart", () => {
  test("placeholder: arquivo existe e é parseável", () => {
    expect(true).toBe(true);
  });

  const itOrSkip = RUN_INTEGRATION ? test : test.skip;

  itOrSkip(
    "turno 2 referencia contexto do turno 1 após docker restart",
    async () => {
      // Turno 1: enviar mensagem com contexto único
      const turn1Reply = await sendMessage(
        `Meu nome de teste é ${CONTEXT_MARKER}. Lembre-se disso.`,
        0
      );
      expect(turn1Reply).toBeTruthy();
      expect(turn1Reply.length).toBeGreaterThan(0);

      // Reiniciar o container via docker CLI (D-09)
      const restart = Bun.spawn(["docker", "restart", CONTAINER_NAME!]);
      const exitCode = await restart.exited;
      expect(exitCode).toBe(0);

      // Aguardar container subir novamente
      await waitForContainer();

      // Turno 2: verificar que o contexto foi preservado pelo PostgresSaver
      // O mesmo Numero faz o LangGraph carregar o checkpoint do turno 1
      const turn2Reply = await sendMessage("Qual é o meu nome de teste?", 1);

      expect(turn2Reply).toBeTruthy();
      // O LLM deve mencionar o CONTEXT_MARKER na resposta do turno 2
      expect(turn2Reply.toLowerCase()).toContain(CONTEXT_MARKER.toLowerCase());
    },
    60_000 // timeout longo — docker restart + LLM real
  );
});
