// PARSER-01: BrainOutputSchema — validação de contrato de saída
import { describe, test, expect } from "bun:test";
import { BrainOutputSchema } from "../../../output/schema.js";
import { ZodError } from "zod";

describe("BrainOutputSchema — PARSER-01", () => {
  test("text mode: fullResponse + responseMode são suficientes", () => {
    expect(() =>
      BrainOutputSchema.parse({ fullResponse: "hello", responseMode: "text" })
    ).not.toThrow();
    const result = BrainOutputSchema.parse({ fullResponse: "hello", responseMode: "text" });
    expect(result.fullResponse).toBe("hello");
    expect(result.responseMode).toBe("text");
  });

  test("audio mode: não exige mediaType nem mediaUrl (D-03: TTS signal)", () => {
    expect(() =>
      BrainOutputSchema.parse({ fullResponse: "fale isso", responseMode: "audio" })
    ).not.toThrow();
  });

  test("image mode com mediaType + mediaUrl: válido", () => {
    expect(() =>
      BrainOutputSchema.parse({
        fullResponse: "veja a imagem",
        responseMode: "image",
        mediaType: "image/jpeg",
        mediaUrl: "https://example.com/img.jpg",
      })
    ).not.toThrow();
  });

  test("image mode sem mediaType e mediaUrl: inválido — 2 issues (D-04)", () => {
    let error: ZodError | null = null;
    try {
      BrainOutputSchema.parse({ fullResponse: "veja a imagem", responseMode: "image" });
    } catch (e) {
      if (e instanceof ZodError) error = e;
    }
    expect(error).not.toBeNull();
    const paths = error!.issues.map((i) => i.path[0]);
    expect(paths).toContain("mediaType");
    expect(paths).toContain("mediaUrl");
  });

  test("video mode sem mediaUrl: inválido — issue em mediaUrl", () => {
    let error: ZodError | null = null;
    try {
      BrainOutputSchema.parse({ fullResponse: "assista", responseMode: "video", mediaType: "video/mp4" });
    } catch (e) {
      if (e instanceof ZodError) error = e;
    }
    expect(error).not.toBeNull();
    const paths = error!.issues.map((i) => i.path[0]);
    expect(paths).toContain("mediaUrl");
    expect(paths).not.toContain("mediaType");
  });

  test("document mode sem mediaType: inválido", () => {
    let error: ZodError | null = null;
    try {
      BrainOutputSchema.parse({ fullResponse: "veja o doc", responseMode: "document", mediaUrl: "https://example.com/doc.pdf" });
    } catch (e) {
      if (e instanceof ZodError) error = e;
    }
    expect(error).not.toBeNull();
    const paths = error!.issues.map((i) => i.path[0]);
    expect(paths).toContain("mediaType");
  });

  test("fullResponse vazia: inválido (D-03: TTS com string vazia causaria silêncio)", () => {
    expect(() =>
      BrainOutputSchema.parse({ fullResponse: "", responseMode: "text" })
    ).toThrow(ZodError);
  });

  test("responseMode inválido: inválido (enum guard D-02)", () => {
    expect(() =>
      BrainOutputSchema.parse({ fullResponse: "ok", responseMode: "invalid_mode" })
    ).toThrow(ZodError);
  });

  test("safeParse retorna success=false sem lançar (API alternativa)", () => {
    const result = BrainOutputSchema.safeParse({ fullResponse: "", responseMode: "text" });
    expect(result.success).toBe(false);
  });
});
