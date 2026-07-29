// Regressão: Gemini 503 ("high demand") derrubava BrainRunner.run() e o lead ficava sem
// resposta. Debug: .planning/debug/resolved/gemini-503-brainrunner-falha.md
//
// Causa raiz (AND-gate): (1) modelo único saturado no provider E (2) createLLM() sem
// nenhuma cadeia de fallback. O retry do langchain já existia (AsyncCaller maxRetries=6,
// 503 fora de STATUS_NO_RETRY) e já exauria em ~87s antes de propagar — provado por probe
// empírico e pelos gaps do log de produção (80s/84s/87s). Portanto o teste NÃO afirma
// "não havia retry": afirma que sem fallback o erro chega ao chamador.
import { describe, it, expect, beforeEach, mock } from "bun:test";

/** Erro no formato exato de @google/generative-ai (handleResponseNotOk) */
class GoogleGenerativeAIFetchError extends Error {
  status: number;
  statusText = "Service Unavailable";
  constructor(model: string, status = 503) {
    super(
      `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent: [${status} Service Unavailable] This model is currently experiencing high demand.`,
    );
    this.name = "GoogleGenerativeAIFetchError";
    this.status = status;
  }
}

/**
 * Comportamento por nome de modelo, controlado por teste.
 * "ok" = responde; número = lança erro HTTP com aquele status.
 */
const BEHAVIOR: Record<string, "ok" | "network" | number> = {};
/** Ordem de invocação observada — prova qual modelo atendeu e quais foram tentados */
let INVOCATIONS: string[] = [];

class FakeChatModel {
  constructor(public config: Record<string, unknown>) {}

  private get modelName(): string {
    return String(this.config.model);
  }

  async invoke(_input: unknown, _options?: unknown): Promise<{ content: string }> {
    INVOCATIONS.push(this.modelName);
    const behavior = BEHAVIOR[this.modelName] ?? "ok";
    if (typeof behavior === "number") {
      throw new GoogleGenerativeAIFetchError(this.modelName, behavior);
    }
    if (behavior === "network") {
      throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    }
    return { content: `resposta de ${this.modelName}` };
  }

  bindTools(tools: unknown[]): { tools: unknown[]; invoke: (i: unknown, o?: unknown) => Promise<{ content: string }> } {
    return {
      tools,
      invoke: (i: unknown, o?: unknown) => this.invoke(i, o),
    };
  }

  withStructuredOutput(
    schema: unknown
  ): { schema: unknown; invoke: (i: unknown, o?: unknown) => Promise<{ content: string }> } {
    return {
      schema,
      invoke: (i: unknown, o?: unknown) => this.invoke(i, o),
    };
  }
}

mock.module("@langchain/openai", () => ({
  ChatOpenAI: class MockChatOpenAI extends FakeChatModel {},
  OpenAIEmbeddings: class MockOpenAIEmbeddingsStub {
    constructor(public config: Record<string, unknown> = {}) {}
    async embedQuery(): Promise<number[]> {
      return Array(Number(process.env.EMBEDDING_DIMENSIONS) || 1536).fill(0.1);
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(Number(process.env.EMBEDDING_DIMENSIONS) || 1536).fill(0.1));
    }
  },
}));

mock.module("@langchain/anthropic", () => ({
  ChatAnthropic: class MockChatAnthropic extends FakeChatModel {},
}));

mock.module("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: class MockChatGoogleGenerativeAI extends FakeChatModel {},
}));

const { createLLM } = await import("../../llm/factory.js");

/** Config de produção no momento da falha: gemini + modelo saturado */
function setupProduction(fallbacks?: string): void {
  process.env.LLM_PROVIDER = "gemini";
  process.env.LLM_MODEL = "gemini-3.5-flash";
  process.env.API_KEY = "test-key";
  if (fallbacks !== undefined) process.env.LLM_FALLBACK_MODELS = fallbacks;
}

describe("createLLM — fallback de modelo em erro transitório do provider", () => {
  beforeEach(() => {
    for (const key of Object.keys(BEHAVIOR)) delete BEHAVIOR[key];
    INVOCATIONS = [];
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.API_KEY;
    delete process.env.LLM_FALLBACK_MODELS;
    delete process.env.LLM_MAX_RETRIES;
    delete process.env.API_KEY_OPENAI;
  });

  it("REGRESSÃO: 503 no modelo primário responde pelo fallback (lead nunca fica sem resposta)", async () => {
    setupProduction("gemini-2.5-flash");
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-2.5-flash");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
  });

  it("REGRESSÃO: fallback também vale no caminho bindTools() — usado pelo brain-sdr", async () => {
    // brain.ts:210 faz ctx.llm.bindTools(tools) e invoca o runnable resultante.
    // Sem cobertura aqui, o Brain que quebrou em produção continuaria sem fallback.
    setupProduction("gemini-2.5-flash");
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    expect(llm.bindTools).toBeDefined();
    const bound = llm.bindTools!([{ name: "HTTP_Request" }]);
    const result = (await bound.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-2.5-flash");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
  });

  it("REGRESSÃO: fallback também vale em withStructuredOutput() — sub-agente de qualificação", async () => {
    // qualifier.ts usa llm.withStructuredOutput(schema).invoke(). Sem trap no proxy,
    // o runnable ficaria preso ao modelo primário via value.bind(obj) — e o sub-agente
    // falharia por completo quando o primário está saturado, em vez de degradar.
    setupProduction("gemini-2.5-flash");
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    expect(llm.withStructuredOutput).toBeDefined();
    const structured = llm.withStructuredOutput!({ type: "object" });
    const result = (await structured.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-2.5-flash");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
  });

  it("percorre a cadeia inteira até achar um modelo saudável", async () => {
    setupProduction("gemini-2.5-flash,gemini-2.0-flash");
    BEHAVIOR["gemini-3.5-flash"] = 503;
    BEHAVIOR["gemini-2.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-2.0-flash");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"]);
  });

  it("suporta fallback cross-provider via sintaxe provider:model", async () => {
    setupProduction("openai:gpt-4.1-mini");
    process.env.API_KEY_OPENAI = "openai-key";
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gpt-4.1-mini");
  });

  it("NÃO faz fallback em erro permanente (400) — rethrow imediato, só o primário é tentado", async () => {
    setupProduction("gemini-2.5-flash");
    BEHAVIOR["gemini-3.5-flash"] = 400;

    const llm = await createLLM();
    await expect(llm.invoke("olá")).rejects.toThrow(/400/);
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash"]);
  });

  it("quando todos os modelos falham, propaga o erro (não engole silenciosamente)", async () => {
    setupProduction("gemini-2.5-flash");
    BEHAVIOR["gemini-3.5-flash"] = 503;
    BEHAVIOR["gemini-2.5-flash"] = 503;

    const llm = await createLLM();
    await expect(llm.invoke("olá")).rejects.toThrow(/503/);
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
  });

  // Vizinhos de fronteira da classe de equivalência "transitório"
  it.each([429, 500, 502, 503, 504])("status %i é transitório → aciona fallback", async (status) => {
    setupProduction("gemini-2.5-flash");
    BEHAVIOR["gemini-3.5-flash"] = status;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };
    expect(result.content).toBe("resposta de gemini-2.5-flash");
  });

  it.each([400, 401, 403, 404, 409])("status %i é permanente → NÃO aciona fallback", async (status) => {
    setupProduction("gemini-2.5-flash");
    BEHAVIOR["gemini-3.5-flash"] = status;

    const llm = await createLLM();
    await expect(llm.invoke("olá")).rejects.toThrow();
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash"]);
  });

  it("erro de rede sem status HTTP (ECONNRESET) é tratado como transitório", async () => {
    setupProduction("gemini-2.5-flash");
    BEHAVIOR["gemini-3.5-flash"] = "network";

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-2.5-flash");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
  });
});

describe("createLLM — configuração de retry e compatibilidade", () => {
  beforeEach(() => {
    for (const key of Object.keys(BEHAVIOR)) delete BEHAVIOR[key];
    INVOCATIONS = [];
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.API_KEY;
    delete process.env.LLM_FALLBACK_MODELS;
    delete process.env.LLM_MAX_RETRIES;
  });

  it("sem LLM_FALLBACK_MODELS, retorna o modelo primário puro (compat: constructor.name)", async () => {
    setupProduction();
    const llm = await createLLM();
    expect(llm.constructor.name).toBe("MockChatGoogleGenerativeAI");
  });

  it("COM fallback ativo, o proxy não sombreia membros de Object.prototype", async () => {
    // Bug pego por probe com classes reais: usar `prop in extraTraps` em vez de
    // Object.hasOwn fazia `constructor`/`toString`/`valueOf` resolverem para membros de
    // Object.prototype — constructor.name virava "Object" e a introspecção do LangGraph
    // sobre o modelo quebrava silenciosamente.
    setupProduction("gemini-2.5-flash");
    const llm = await createLLM();

    expect(llm.constructor.name).toBe("MockChatGoogleGenerativeAI");
    expect(typeof llm.bindTools).toBe("function");
    // membros de Object.prototype não podem vazar como se fossem do "trap"
    for (const prop of ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf"] as const) {
      expect((llm as unknown as Record<string, unknown>)[prop]).not.toBe(
        (Object.prototype as unknown as Record<string, unknown>)[prop],
      );
    }
  });

  it("CSV vazio / só espaços não cria fallback nem quebra", async () => {
    setupProduction("  ,  , ");
    const llm = await createLLM();
    expect(llm.constructor.name).toBe("MockChatGoogleGenerativeAI");
  });

  it("LLM_MAX_RETRIES é repassado ao construtor do modelo", async () => {
    setupProduction();
    process.env.LLM_MAX_RETRIES = "3";
    const llm = (await createLLM()) as unknown as { config: Record<string, unknown> };
    expect(llm.config.maxRetries).toBe(3);
  });

  it("default de maxRetries limita a latência (< 6, o default do langchain)", async () => {
    // Load-bearing: com maxRetries=6 o primário consome ~87s antes do fallback entrar,
    // e o chamador síncrono do webhook já teria dado timeout.
    setupProduction();
    const llm = (await createLLM()) as unknown as { config: Record<string, unknown> };
    expect(llm.config.maxRetries).toBeLessThan(6);
    expect(llm.config.maxRetries).toBeGreaterThanOrEqual(1);
  });

  it("LLM_MAX_RETRIES inválido cai no default em vez de virar NaN", async () => {
    setupProduction();
    process.env.LLM_MAX_RETRIES = "abc";
    const llm = (await createLLM()) as unknown as { config: Record<string, unknown> };
    expect(Number.isNaN(llm.config.maxRetries)).toBe(false);
    expect(llm.config.maxRetries).toBeGreaterThanOrEqual(1);
  });

  it("fallbacks herdam o maxRetries configurado", async () => {
    setupProduction("gemini-2.5-flash");
    process.env.LLM_MAX_RETRIES = "1";
    BEHAVIOR["gemini-3.5-flash"] = 503;
    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };
    expect(result.content).toBe("resposta de gemini-2.5-flash");
  });
});

// O console do Google mostra o modelo como `models/<nome>`, e foi essa a grafia que o
// usuário validou empiricamente contra a API real (`models/gemini-3.1-flash-lite`).
// Probe com as classes REAIS provou que as duas grafias são a MESMA request:
//   @langchain/google-genai@2.1.31 chat_models.js:428 remove o prefixo;
//   @google/generative-ai@0.24.1  index.mjs:1348-1355 o recoloca ao montar a URL.
// Ou seja: `models/models/...` é impossível — a biblioteca está segura.
// O risco real é NOSSO: a dedup da cadeia compara strings, então sem normalizar
// `models/x` e `x` contariam como modelos distintos.
describe("createLLM — normalização do prefixo `models/` do Google", () => {
  beforeEach(() => {
    for (const key of Object.keys(BEHAVIOR)) delete BEHAVIOR[key];
    INVOCATIONS = [];
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.API_KEY;
    delete process.env.LLM_FALLBACK_MODELS;
    delete process.env.LLM_MAX_RETRIES;
    delete process.env.API_KEY_OPENAI;
  });

  it("REGRESSÃO: `models/x` como fallback de `x` é deduplicado — a cadeia não repete o modelo saturado", async () => {
    // Sem normalizar, a cadeia viraria [gemini-3.1-flash-lite, gemini-3.1-flash-lite]:
    // um "fallback" que tenta de novo o MESMO modelo saturado, só dobrando a latência do
    // lead no 503. É exatamente a falha que esta sessão de debug existe para impedir.
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_MODEL = "gemini-3.1-flash-lite";
    process.env.API_KEY = "test-key";
    process.env.LLM_FALLBACK_MODELS = "models/gemini-3.1-flash-lite";
    BEHAVIOR["gemini-3.1-flash-lite"] = 503;

    const llm = await createLLM();
    await expect(llm.invoke("olá")).rejects.toThrow(/503/);
    expect(INVOCATIONS).toEqual(["gemini-3.1-flash-lite"]);
  });

  it("prefixo no LLM_MODEL primário funciona e é normalizado na cadeia", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_MODEL = "models/gemini-3.5-flash";
    process.env.API_KEY = "test-key";
    process.env.LLM_FALLBACK_MODELS = "gemini-3.1-flash-lite";
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-3.1-flash-lite");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-3.1-flash-lite"]);
  });

  it("prefixo no LLM_FALLBACK_MODELS funciona (grafia validada pelo usuário)", async () => {
    setupProduction("models/gemini-3.1-flash-lite");
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-3.1-flash-lite");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-3.1-flash-lite"]);
  });

  it("as duas grafias no mesmo CSV colapsam em um único elo", async () => {
    setupProduction("models/gemini-3.1-flash-lite,gemini-3.1-flash-lite");
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-3.1-flash-lite");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-3.1-flash-lite"]);
  });

  it("combina com a sintaxe provider:model — `gemini:models/x`", async () => {
    setupProduction("gemini:models/gemini-3.1-flash-lite");
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-3.1-flash-lite");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-3.1-flash-lite"]);
  });

  it("entrada degenerada `models/` (nome vazio após normalizar) é descartada", async () => {
    setupProduction("models/,gemini-3.1-flash-lite");
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de gemini-3.1-flash-lite");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "gemini-3.1-flash-lite"]);
  });

  // Fronteiras da classe de equivalência: o que NÃO pode ser removido.
  it("NÃO normaliza em outro provider — `models/` só é convenção do Google", async () => {
    // Em OpenRouter/OpenAI o "/" faz parte do nome (`vendor/model`); remover trocaria o
    // modelo pedido por outro. O strip precisa ser escopado ao provider gemini.
    setupProduction("openai:models/gpt-4.1-mini");
    process.env.API_KEY_OPENAI = "openai-key";
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe("resposta de models/gpt-4.1-mini");
    expect(INVOCATIONS).toEqual(["gemini-3.5-flash", "models/gpt-4.1-mini"]);
  });

  it.each([
    ["tunedModels/meu-modelo", "tunedModels/meu-modelo"],
    ["models/models/gemini-x", "models/gemini-x"],
  ])("paridade com o regex do langchain: %s -> %s", async (input, expected) => {
    // `^models/` ancorado e removido UMA vez só — exatamente
    // `fields.model.replace(/^models\//, "")` do chat_models.js:428. `tunedModels/` é um
    // caminho válido do SDK e precisa sobreviver intacto.
    setupProduction(input);
    BEHAVIOR["gemini-3.5-flash"] = 503;

    const llm = await createLLM();
    const result = (await llm.invoke("olá")) as unknown as { content: string };

    expect(result.content).toBe(`resposta de ${expected}`);
  });
});
