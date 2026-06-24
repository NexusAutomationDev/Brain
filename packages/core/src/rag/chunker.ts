// RAG-01/D-01/D-02: Implementação própria de recursive character text splitter
// @langchain/textsplitters não está instalado — fallback próprio conforme Plano 02 action
// Separadores: ["\n\n", "\n", " ", ""] — D-02 (parágrafo → linha → espaço → chars)
// splitText() é async (retorna Promise<string[]>) mesmo sendo operação em memória (Pitfall 7)

const CHUNK_SIZE = 1000; // D-01: hardcoded, sem ENV (YAGNI)
const CHUNK_OVERLAP = 200; // D-01: hardcoded, sem ENV (YAGNI)

/**
 * D-02: Split recursivo por parágrafo → linha → espaço → chars.
 * splitText() é async (retorna Promise<string[]>) mesmo sendo operação em memória.
 *
 * @param text - Texto a ser dividido em chunks
 * @returns Array de strings com chunks de até 1000 chars com overlap de 200
 */
export async function splitText(text: string): Promise<string[]> {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= CHUNK_SIZE) return [text];
  const separators = ["\n\n", "\n", " ", ""];
  return recursiveSplit(text, separators);
}

/**
 * Implementação recursiva do split com overlap.
 * Usa D-02: parágrafo → linha → espaço → chars para determinar split points.
 */
function recursiveSplit(text: string, separators: string[]): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const [sep, ...rest] = separators;

  // Sem separador válido: split bruto em CHUNK_SIZE
  if (sep === undefined) {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + CHUNK_SIZE));
      start += CHUNK_SIZE - CHUNK_OVERLAP;
    }
    return chunks.filter((c) => c.trim().length > 0);
  }

  // Strings vazias (separador = "") — split caractere a caractere não faz sentido para overlap
  // Nesse caso forçar split por CHUNK_SIZE
  if (sep === "") {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + CHUNK_SIZE));
      start += CHUNK_SIZE - CHUNK_OVERLAP;
    }
    return chunks.filter((c) => c.trim().length > 0);
  }

  const parts = text.split(sep);
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const candidate = current ? current + sep + part : part;

    if (candidate.length <= CHUNK_SIZE) {
      current = candidate;
    } else {
      if (current) {
        // Salvar chunk atual
        chunks.push(current);
        // Overlap: manter os últimos CHUNK_OVERLAP chars como início do próximo chunk
        const overlapStart = Math.max(0, current.length - CHUNK_OVERLAP);
        const overlapText = current.slice(overlapStart);
        current = overlapText ? overlapText + sep + part : part;
        // Se ainda assim o new current for > CHUNK_SIZE, recursão com sep menor
        if (current.length > CHUNK_SIZE && rest.length > 0) {
          const subChunks = recursiveSplit(current, rest);
          // Manter apenas o último sub-chunk como "current" para continuar
          if (subChunks.length > 1) {
            chunks.push(...subChunks.slice(0, -1));
            current = subChunks[subChunks.length - 1];
          } else if (subChunks.length === 1) {
            current = subChunks[0];
          }
        }
      } else {
        // part sozinha > CHUNK_SIZE: recursão com separadores menores
        if (rest.length > 0) {
          chunks.push(...recursiveSplit(part, rest));
        } else {
          // Último recurso: split bruto
          let start = 0;
          while (start < part.length) {
            chunks.push(part.slice(start, start + CHUNK_SIZE));
            start += CHUNK_SIZE - CHUNK_OVERLAP;
          }
        }
        current = "";
      }
    }
  }

  if (current) chunks.push(current);

  return chunks.filter((c) => c.trim().length > 0);
}
