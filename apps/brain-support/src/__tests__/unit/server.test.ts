import { describe, test, expect } from "bun:test";
import { createServer } from "../../server.js";

describe("createServer — brain-support Hono composition (SUP-01, SUP-05)", () => {
  test("GET /health responde sem lançar erro de rota não encontrada (sub-app health montado)", async () => {
    const fakeSql = {
      unsafe: async () => [{ "?column?": 1 }],
    } as any;
    const fakeRunner = {} as any;
    const app = createServer(fakeSql, fakeRunner);
    const res = await app.request("/health");
    // 404 indicaria que createHealthApp não foi montado — qualquer outro status confirma a rota existe
    expect(res.status).not.toBe(404);
  });

  test("POST /api/v1/webhook não retorna 404 (sub-app webhook montado)", async () => {
    const fakeSql = {} as any;
    const fakeRunner = {} as any;
    const app = createServer(fakeSql, fakeRunner);
    const res = await app.request("/api/v1/webhook", { method: "POST", body: "{}" });
    expect(res.status).not.toBe(404);
  });

  test("POST /reload-prompts não retorna 404 (sub-app core montado)", async () => {
    const fakeSql = {} as any;
    const fakeRunner = { refreshPrompts: async () => {} } as any;
    const app = createServer(fakeSql, fakeRunner);
    const res = await app.request("/reload-prompts", { method: "POST" });
    expect(res.status).not.toBe(404);
  });

  test("sem embeddingProvider — /api/v1/ingest retorna 404 (montagem condicional preservada)", () => {
    const fakeSql = {} as any;
    const fakeRunner = {} as any;
    const app = createServer(fakeSql, fakeRunner); // embeddingProvider omitido
    return app.request("/api/v1/ingest", { method: "POST", body: "{}" }).then((res) => {
      expect(res.status).toBe(404);
    });
  });
});
