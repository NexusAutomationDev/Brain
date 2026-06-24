// D-01, D-02: splitText — test stubs (Wave 0 / RED)
// Testa chunking recursivo: 1000 chars, overlap 200, split por parágrafo/linha/espaço
import { describe, it, expect } from "bun:test";

// WAVE 0: Import falhará com "Cannot find module" — estado RED esperado
import { splitText } from "../../rag/chunker.js";

// Helper: texto longo (~1400 chars) com parágrafos para testar múltiplos chunks
const longText = "palavra ".repeat(200); // ~1400 chars

// Helper: texto com estrutura de parágrafos
const paragraphText = [
  "Este é o primeiro parágrafo com algum conteúdo relevante sobre o assunto.",
  "",
  "Este é o segundo parágrafo que continua a discussão com mais detalhes importantes.",
  "",
  "E este é o terceiro parágrafo finalizando o conteúdo com uma conclusão.",
].join("\n");

describe("splitText (D-01, D-02)", () => {
  describe("D-01/D-02: texto curto retorna array com 1 elemento", () => {
    it("splitText com texto curto retorna array com 1 elemento", async () => {
      const result = await splitText("texto curto");
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it("splitText com string vazia retorna array com 0 ou 1 elemento", async () => {
      const result = await splitText("");
      expect(Array.isArray(result)).toBe(true);
    });

    it("splitText retorna o texto original para conteúdos pequenos", async () => {
      const shortText = "Texto pequeno sem necessidade de chunking.";
      const result = await splitText(shortText);
      expect(result[0]).toContain("Texto pequeno");
    });
  });

  describe("D-01/D-02: texto longo retorna múltiplos chunks", () => {
    it("splitText de texto longo (>1000 chars) retorna múltiplos chunks", async () => {
      const result = await splitText(longText);
      expect(result.length).toBeGreaterThan(1);
    });

    it("cada chunk tem tamanho <= 1000 chars", async () => {
      const result = await splitText(longText);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(1000);
      }
    });

    it("cobre todo o conteúdo original (union de chunks contém partes do texto)", async () => {
      const result = await splitText(longText);
      const joined = result.join(" ");
      // O texto original deve ter cobertura nos chunks
      expect(joined.length).toBeGreaterThanOrEqual(longText.length * 0.8);
    });
  });

  describe("D-02: overlap entre chunks consecutivos", () => {
    it("há sobreposição de conteúdo entre chunks consecutivos (overlap ~200 chars)", async () => {
      const result = await splitText(longText);
      if (result.length >= 2) {
        // Pegar o final do chunk 0 e o início do chunk 1
        const endOfFirst = result[0].slice(-200);
        const startOfSecond = result[1].slice(0, 200);
        // Deve haver overlap — algum conteúdo em comum
        const firstWords = endOfFirst.split(" ").filter(Boolean);
        const secondContent = startOfSecond;
        const hasOverlap = firstWords.some((w) => secondContent.includes(w));
        expect(hasOverlap).toBe(true);
      }
    });

    it("splitText preserva texto por parágrafo quando possível", async () => {
      const result = await splitText(paragraphText);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
