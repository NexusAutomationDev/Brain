// RESP-01, RESP-02: testes unitários de createRespondTool()
import { describe, test, expect } from "bun:test";
import { createRespondTool } from "../respond.js";
import { ZodError } from "zod";

describe("createRespondTool — RESP-01: schema-as-tool para responseMode dinâmico", () => {
  test("retorna tool com nome 'respond'", () => {
    const tool = createRespondTool();
    expect(tool.name).toBe("respond");
  });

  test("description contém instrução 'SEMPRE invoque' para mitigar PITFALL-6", () => {
    const tool = createRespondTool();
    expect(tool.description).toContain("SEMPRE invoque");
  });

  test("schema tem campo fullResponse obrigatório (string)", () => {
    const tool = createRespondTool();
    const schema = tool.schema as any;
    // Verificar que fullResponse é obrigatório — sem ele, parse falha
    const withoutFullResponse = schema.safeParse({ responseMode: "undefined" });
    expect(withoutFullResponse.success).toBe(false);
    // Com fullResponse, parse passa
    const parsed = schema.safeParse({ fullResponse: "hello", responseMode: "undefined" });
    expect(parsed.success).toBe(true);
  });

  test("schema tem campo responseMode com enum ['undefined', 'text', 'audio']", () => {
    const tool = createRespondTool();
    const schema = tool.schema as any;
    // responseMode "undefined" aceito
    expect(schema.safeParse({ fullResponse: "oi", responseMode: "undefined" }).success).toBe(true);
    // responseMode "text" aceito
    expect(schema.safeParse({ fullResponse: "oi", responseMode: "text" }).success).toBe(true);
    // responseMode "audio" aceito
    expect(schema.safeParse({ fullResponse: "oi", responseMode: "audio" }).success).toBe(true);
    // responseMode "image" NÃO aceito (não está no enum da tool — D-03)
    expect(schema.safeParse({ fullResponse: "oi", responseMode: "image" }).success).toBe(false);
  });

  test("schema aceita mediaType opcional com enum ['image', 'file', 'video', 'audio']", () => {
    const tool = createRespondTool();
    const schema = tool.schema as any;
    const parsed = schema.safeParse({
      fullResponse: "veja",
      responseMode: "undefined",
      mediaType: "file",
      mediaUrl: "https://example.com/doc.pdf",
    });
    expect(parsed.success).toBe(true);
  });

  test("schema aceita mediaUrl opcional como URL válida (z.string().url())", () => {
    const tool = createRespondTool();
    const schema = tool.schema as any;
    const parsed = schema.safeParse({
      fullResponse: "ouça",
      responseMode: "audio",
      mediaType: "audio",
      mediaUrl: "https://example.com/audio.mp3",
    });
    expect(parsed.success).toBe(true);
  });

  test("validação condicional: mediaType sem mediaUrl lança ZodError", () => {
    const tool = createRespondTool();
    const schema = tool.schema as any;
    const result = schema.safeParse({
      fullResponse: "veja",
      responseMode: "undefined",
      mediaType: "image",
      // mediaUrl ausente
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ZodError);
    const issues = result.error.issues;
    expect(issues.some((i: any) => i.path.includes("mediaUrl"))).toBe(true);
  });

  test("validação condicional: mediaUrl sem mediaType lança ZodError", () => {
    const tool = createRespondTool();
    const schema = tool.schema as any;
    const result = schema.safeParse({
      fullResponse: "veja",
      responseMode: "undefined",
      // mediaType ausente
      mediaUrl: "https://example.com/img.png",
    });
    expect(result.success).toBe(false);
    const issues = result.error.issues;
    expect(issues.some((i: any) => i.path.includes("mediaType"))).toBe(true);
  });
});

describe("createRespondTool — RESP-02: fullResponse não é alterado", () => {
  test("invocação da tool retorna 'ok' sem alterar fullResponse", async () => {
    const tool = createRespondTool();
    // tool.invoke chama a função com os args parseados
    const result = await tool.invoke({
      fullResponse: "Mensagem original do LLM sem alteração",
      responseMode: "text",
    });
    // A tool retorna "ok" — fullResponse não é modificado pela execução da tool
    expect(result).toBe("ok");
  });

  test("fullResponse com caracteres especiais chega intacto nos args", async () => {
    const tool = createRespondTool();
    // Verificar via schema.parse que fullResponse passa sem modificação
    const schema = tool.schema as any;
    const input = "Resposta com: acentos, emojis 🎉, e\nnewlines";
    const parsed = schema.safeParse({ fullResponse: input, responseMode: "undefined" });
    expect(parsed.success).toBe(true);
    expect(parsed.data.fullResponse).toBe(input);
  });
});
