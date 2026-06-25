# Phase 21: RAG - Research

**Researched:** 2026-06-24
**Domain:** RAG (Retrieval-Augmented Generation) — ingest endpoint, chunking, embeddings, pgvector cosine search, LangChain tool factory
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Chunk size 1000 chars, overlap 200 chars — hardcoded, no ENV (YAGNI).
**D-02:** Recursive split: `\n\n` (paragraph) → `\n` (line) → space/chars. Standard LangChain `RecursiveCharacterTextSplitter` pattern.
**D-03:** Re-ingestão da mesma coleção = `DELETE WHERE collection AND embedding_model = current_model` + re-insert. Chunks de modelos diferentes preservados.
**D-03a:** `search_knowledge` filtra `WHERE embedding_model = current_model` antes de calcular similaridade.
**D-03b:** Tradeoff aceito: chunks de modelos antigos acumulam storage. Limpeza manual é opcional via RAG-F02 (futuro).
**D-04:** Código RAG em `packages/core/src/rag/` com arquivos: `chunker.ts`, `search.ts`, `ingest.ts`.
**D-05:** `createIngestApp(sql)` exportada de `packages/core` e montada explicitamente no `server.ts` de cada Brain.
**D-06:** `createSearchKnowledgeTool(sql)` segue padrão de `createPauseSessionTool(sql)` — factory function registrada via `toolsRegistry.enableTool(brainType, 'search_knowledge')`.
**D-07:** Top 5 chunks no total, combinando todas as coleções pesquisadas. Sem limite por coleção individual.
**D-08:** Threshold de similaridade cosine: 0.5.
**D-09:** topK e threshold hardcoded — LLM não pode configurá-los na chamada da tool.
**D-10:** Retorno em blocos formatados: `[Coleção: X] chunk N/M\nConteúdo...\n---`
**D-11:** Sem resultados → string `"Nenhum resultado encontrado para a consulta nas coleções informadas."` (sem erro/exception).
**D-12:** Habilitação via `toolsRegistry.enableTool(brainType, 'search_knowledge')` no startup do Brain.
**D-13:** `/api/v1/ingest` usa `Authorization: Bearer <INGEST_TOKEN>` — 401 se token inválido/ausente; 503 fail-closed se INGEST_TOKEN não configurado.
**D-14:** `EMBEDDING_MODEL` ENV opcional. Defaults por provider: `openai`/`openrouter` → `text-embedding-3-small`; `gemini` → `text-embedding-004`.
**D-15:** Nome do modelo resolvido gravado em `knowledge_chunks.embedding_model` a cada ingestão.
**D-16:** `EMBEDDING_DIMENSIONS=768` garante compatibilidade entre OpenAI e Gemini na mesma coluna pgvector.
**D-17:** `createEmbeddings()` em `packages/ai/src/embeddings/factory.ts` deve ser atualizada: remover o `throw` quando `EMBEDDING_MODEL` ausente, usar defaults de D-14. Esta é uma mudança no arquivo existente.

### Claude's Discretion

- Biblioteca de splitting: `@langchain/textsplitters` `RecursiveCharacterTextSplitter` ou implementação própria (ambas aceitáveis desde que siga D-02)
- Timeout e error handling no endpoint de ingest (e.g., tamanho máximo de payload)
- Estrutura exata do barrel export em `packages/core/src/index.ts` para os novos símbolos RAG
- Textos exatos das mensagens de erro (400, 401, 503) no ingest endpoint

### Deferred Ideas (OUT OF SCOPE)

- RAG-F01: Re-indexação de coleção ao trocar modelo de embedding
- RAG-F02: Endpoint DELETE /api/v1/ingest/:collection
- RAG-F03: Interface de monitoramento de coleções
- INGEST_CHUNK_SIZE e INGEST_CHUNK_OVERLAP como ENVs configuráveis
- packages/rag separado
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RAG-01 | POST /api/v1/ingest com `{ text, collection }` + Bearer token — chunka, embede, armazena no pgvector; 401 sem token válido | `createIngestApp(sql)` replica padrão de `createCoreApp` com `Authorization: Bearer`; `RecursiveCharacterTextSplitter` de `@langchain/textsplitters`; `createEmbeddings()` atualizada (D-17) |
| RAG-02 | LLM pode chamar `search_knowledge(query, collections[])` e receber trechos por similaridade cosine acima de threshold | `createSearchKnowledgeTool(sql)` replica padrão de `createPauseSessionTool`; cosine query adapta `searchSimilar()` de `packages/memory/src/semantic.ts` para `knowledge_chunks` |
| RAG-03 | `search_knowledge` com múltiplas coleções retorna resultados de todas em único response ordenados por score | Query Drizzle com `inArray(knowledgeChunks.collection, collections)` + filtro `embedding_model` + `orderBy(desc(similarity))` + `limit(5)` |
| RAG-04 | Cada chunk armazena `collection_name`, `embedding_model`, `chunk_index`, `total_chunks` como metadados não-nulos | Schema `knowledgeChunks` já definido em `packages/database/src/schema/tables.ts` com todas as colunas; INSERT registra o modelo resolvido via D-14/D-15 |
</phase_requirements>

---

## Summary

A Fase 21 implementa RAG sobre infraestrutura já existente no projeto. O schema `knowledge_chunks` já foi criado na Phase 19. O padrão de Hono sub-app com auth Bearer já existe em `createCoreApp` (usa `X-Admin-Token`). O padrão de cosine similarity query já existe em `packages/memory/src/semantic.ts`. O padrão de tool factory com sql injetado já existe em `createPauseSessionTool`. Esta fase é predominantemente **adaptação de código existente**, não construção do zero.

A única mudança de infraestrutura é em `packages/ai/src/embeddings/factory.ts`: remover o `throw` quando `EMBEDDING_MODEL` é ausente e adicionar defaults por provider (D-17). Esta é uma mudança cirúrgica em ~5 linhas de um arquivo existente.

A biblioteca de splitting recomendada é `@langchain/textsplitters@1.0.1` — package dedicado, peer dep de `@langchain/core ^1.0.0` (já instalado em `^1.1.48`), exporta `RecursiveCharacterTextSplitter` com a API correta para D-02. Alternativa é implementação própria (~40 linhas), viável mas sem ganho sobre a biblioteca oficial.

**Recomendação primária:** Use `@langchain/textsplitters@1.0.1` para chunking. Adapte `searchSimilar()` para `knowledge_chunks` com `inArray`. Replique exatamente o padrão de `createCoreApp` e `createPauseSessionTool`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/textsplitters` | 1.0.1 | `RecursiveCharacterTextSplitter` para chunking (D-02) | Package oficial LangChain para splitting; peer dep compatível com `@langchain/core ^1.0.0` já instalado [VERIFIED: npm view] |
| `drizzle-orm` (já instalado) | 0.45.2 | `cosineDistance`, `inArray`, `and`, `desc`, `gt`, `sql` para query pgvector | Já é a ORM do projeto; `cosineDistance` já usada em `packages/memory/src/semantic.ts` [VERIFIED: grep codebase] |
| `@brain-pkg/ai` (já instalado) | workspace | `createEmbeddings()` para gerar vetores em ingest e em search | Já suporta OpenAI e Gemini; D-17 remove o throw e adiciona defaults [VERIFIED: grep codebase] |
| `hono` (já instalado) | ^4.12.0 | Sub-app Hono para `createIngestApp` | Padrão do projeto; `createCoreApp` é o template exato [VERIFIED: codebase] |
| `zod` (já instalado) | ^4.4.3 | Schema do request body `{ text, collection }` e schema da tool | Já é a lib de validação do projeto [VERIFIED: codebase] |

### New Dependency
| Library | Version | Purpose | Install |
|---------|---------|---------|---------|
| `@langchain/textsplitters` | 1.0.1 | Chunking recursivo (única dependência nova) | `pnpm add @langchain/textsplitters@1.0.1 --filter @brain-pkg/core` |

**Versão verificada:**
```bash
npm view @langchain/textsplitters version
# → 1.0.1  [VERIFIED: npm registry 2026-06-24]
```

**Peer deps de `@langchain/textsplitters@1.0.1`:** `@langchain/core ^1.0.0` (satisfeito por `^1.1.48` já instalado) [VERIFIED: npm view]
**Dep de `@langchain/textsplitters@1.0.1`:** `js-tiktoken ^1.0.12` (para tokenização do chunk size) [VERIFIED: npm view]

### Alternativas Consideradas
| Em vez de | Alternativa | Tradeoff |
|-----------|-------------|----------|
| `@langchain/textsplitters` | Implementação própria (~40 linhas) | Própria: zero dep nova, mas precisa implementar sliding window com overlap manualmente. Biblioteca: menos código de produção, testada, mantida. Ambas aceitáveis por D-02 (Claude's Discretion). |

## Architecture Patterns

### Estrutura Recomendada
```
packages/core/src/
  rag/
    chunker.ts          # splitText(text): string[] — RecursiveCharacterTextSplitter
    search.ts           # searchKnowledge(db, queryVector, collections, model): ChunkResult[]
    ingest.ts           # createIngestApp(sql): Hono — POST /api/v1/ingest
    index.ts            # barrel export de rag/
  tools/
    search-knowledge.ts # createSearchKnowledgeTool(sql): StructuredTool — LangChain tool factory
  index.ts              # adicionar exports: createIngestApp, createSearchKnowledgeTool
```

### Pattern 1: Hono Sub-App com Bearer Auth (createIngestApp)

**O que é:** Sub-app Hono com autenticação via `Authorization: Bearer <INGEST_TOKEN>`. Replica exatamente `createCoreApp` mas com Bearer em vez de `X-Admin-Token`.

**Quando usar:** D-05 — `createIngestApp(sql)` é montado no `server.ts` do Brain via `app.route('/', createIngestApp(sql))`.

**Exemplo:**
```typescript
// Source: packages/core/src/server.ts (template exato) — adaptado para Bearer + INGEST_TOKEN
// [VERIFIED: codebase read]
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

export function createIngestApp(sql: Sql): Hono {
  const app = new Hono();

  app.post("/api/v1/ingest", async (c) => {
    const ingestToken = process.env.INGEST_TOKEN;

    // Fail closed: INGEST_TOKEN não configurado → 503
    if (!ingestToken) {
      return c.json({ error: "Service unavailable — ingest endpoint not configured" }, 503);
    }

    // Bearer token: "Authorization: Bearer <token>"
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token || token !== ingestToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json().catch(() => null);
    if (!body?.text || !body?.collection) {
      return c.json({ error: "Bad Request — text and collection required" }, 400);
    }

    // chunk → embed → delete existing → insert
    const db = drizzle(sql);
    // ... (chunker, embedder, db ops)

    return c.json({ status: "ok", chunks: chunksInserted });
  });

  return app;
}
```

### Pattern 2: Factory de Tool com Closure sobre sql (createSearchKnowledgeTool)

**O que é:** Replica exatamente `createPauseSessionTool(sql)` — closure sobre `sql`, instancia `drizzle(sql)` internamente, usa `tool()` do LangChain core.

**Quando usar:** D-06 — registrada via `toolsRegistry.enableTool(brainType, 'search_knowledge')` no startup.

**Exemplo:**
```typescript
// Source: packages/core/src/tools/pause-session.ts (template exato) — adaptado para search_knowledge
// [VERIFIED: codebase read]
import { tool } from "@langchain/core/tools";
import { drizzle } from "drizzle-orm/postgres-js";
import { z } from "zod";
import type { Sql } from "postgres";

export function createSearchKnowledgeTool(sql: Sql) {
  const db = drizzle(sql);
  return tool(
    async (args: { query: string; collections: string[] }) => {
      // searchKnowledge() de packages/core/src/rag/search.ts
      const results = await searchKnowledge(db, args.query, args.collections);
      if (results.length === 0) {
        return "Nenhum resultado encontrado para a consulta nas coleções informadas.";
      }
      return formatResults(results); // D-10: blocos [Coleção: X]
    },
    {
      name: "search_knowledge",
      description: "Busca contexto relevante na base de conhecimento. Use quando precisar de informações sobre produtos, FAQs, manuais ou qualquer conteúdo ingerido.",
      schema: z.object({
        query: z.string().describe("Texto da busca semântica"),
        collections: z.array(z.string()).describe("Lista de coleções para buscar"),
      }),
    }
  );
}
```

### Pattern 3: Cosine Similarity Query com Múltiplas Coleções

**O que é:** Adapta `searchSimilar()` de `packages/memory/src/semantic.ts` para `knowledge_chunks`. Diferenças: troca filtro `userId` por `inArray(collection, collections)`, adiciona filtro `embedding_model`, usa `knowledgeChunks` em vez de `embeddings`, seleciona metadados extras.

**Exemplo:**
```typescript
// Source: packages/memory/src/semantic.ts (template exato) — adaptado para knowledge_chunks
// [VERIFIED: codebase read]
import { cosineDistance, desc, gt, and, sql, inArray, eq } from "drizzle-orm";
import { knowledgeChunks } from "@brain-pkg/database";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export async function searchKnowledge(
  db: PostgresJsDatabase,
  queryVector: number[],
  collections: string[],
  embeddingModel: string,
  topK = 5,          // D-07
  threshold = 0.5    // D-08
): Promise<ChunkResult[]> {
  const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryVector)})`;

  return db
    .select({
      id: knowledgeChunks.id,
      content: knowledgeChunks.content,
      collection: knowledgeChunks.collection,
      chunkIndex: knowledgeChunks.chunkIndex,
      totalChunks: knowledgeChunks.totalChunks,
      similarity,
    })
    .from(knowledgeChunks)
    .where(
      and(
        inArray(knowledgeChunks.collection, collections),  // RAG-03: múltiplas coleções
        eq(knowledgeChunks.embeddingModel, embeddingModel), // D-03a: filtrar por modelo atual
        gt(similarity, threshold)                           // D-08: threshold 0.5
      )
    )
    .orderBy(desc(similarity))  // ordenar por similaridade decrescente
    .limit(topK);               // D-07: top 5 global
}
```

### Pattern 4: Chunking com RecursiveCharacterTextSplitter

**O que é:** `@langchain/textsplitters` `RecursiveCharacterTextSplitter` com separators recursivos conforme D-02.

**Exemplo:**
```typescript
// Source: @langchain/textsplitters docs + D-01/D-02 decisions
// [VERIFIED: npm view + training knowledge — LOW confidence on exact API]
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export async function splitText(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,      // D-01
    chunkOverlap: 200,    // D-01
    separators: ["\n\n", "\n", " ", ""],  // D-02: parágrafo → linha → espaço → chars
  });
  return splitter.splitText(text);
}
```

### Pattern 5: Ingest Flow Completo

**O que é:** Sequência de operações dentro do handler POST /api/v1/ingest.

```
POST /api/v1/ingest { text, collection }
  ↓ auth check (INGEST_TOKEN)
  ↓ body validation (text + collection required)
  ↓ splitText(text) → string[] (chunker.ts)
  ↓ resolveEmbeddingModel() → string (D-14: default por provider)
  ↓ embedder.embedDocuments(chunks) → number[][] (createEmbeddings())
  ↓ db.delete WHERE collection = ? AND embedding_model = ? (D-03)
  ↓ db.insert knowledge_chunks rows with chunkIndex, totalChunks, embeddingModel (RAG-04)
  ↓ return { status: "ok", chunks: N }
```

### Pattern 6: Resolução de Embedding Model (D-14/D-17)

**O que é:** Mudança em `packages/ai/src/embeddings/factory.ts` — remover `throw` quando `EMBEDDING_MODEL` ausente, usar defaults por provider.

**Código atual (deve mudar):**
```typescript
// Linha 24 atual — DEVE ser removida/substituída:
if (!model) {
  throw new ConfigurationError("EMBEDDING_MODEL env var is required", { model: "missing" });
}
```

**Código novo:**
```typescript
const DEFAULT_MODELS: Record<string, string> = {
  gemini: "text-embedding-004",
  openai: "text-embedding-3-small",
  openrouter: "text-embedding-3-small",
};

const provider = process.env.LLM_PROVIDER || "openai";
const model = process.env.EMBEDDING_MODEL ?? DEFAULT_MODELS[provider] ?? "text-embedding-3-small";
// Dimensões continuam via EMBEDDING_DIMENSIONS ENV (já existente)
```

**Função auxiliar para resolução de model (usada em ingest e search):**
```typescript
// Em packages/core/src/rag/search.ts ou utils
export function resolveEmbeddingModel(): string {
  if (process.env.EMBEDDING_MODEL) return process.env.EMBEDDING_MODEL;
  const provider = process.env.LLM_PROVIDER || "openai";
  const defaults: Record<string, string> = {
    gemini: "text-embedding-004",
    openai: "text-embedding-3-small",
    openrouter: "text-embedding-3-small",
  };
  return defaults[provider] ?? "text-embedding-3-small";
}
```

### Anti-Patterns a Evitar

- **Gerar embedding de query dentro de `search.ts`:** `search.ts` deve receber `queryVector: number[]` já gerado — separação de concerns. `createSearchKnowledgeTool` chama embedder antes de chamar `searchKnowledge`.
- **Usar `embedder.embedQuery()` para batch de chunks:** Use `embedder.embedDocuments(chunks)` para ingestão em batch e `embedder.embedQuery(text)` para a query single do `search_knowledge` (API correta do LangChain).
- **Montar `createIngestApp` sem passar `sql`:** Requer `sql` para inicializar `drizzle(sql)` — mesmo padrão de `createHealthApp(sql)`.
- **Registrar `search_knowledge` na whitelist TOOL_EVENTS_WHITELIST do runner:** `search_knowledge` não precisa de evento externo (out of scope — ver REQUIREMENTS.md Out of Scope).
- **Chamar `cosineDistance` sem o `1 -`:** `cosineDistance` retorna distância (menor = mais similar); precisa de `1 - distance` para ter similarity score onde maior = melhor.
- **Não filtrar por `embedding_model` no search:** D-03a — sem esse filtro, chunks de modelos antigos aparecem nos resultados após troca de provider.

## Don't Hand-Roll

| Problema | Não Construir | Usar | Motivo |
|----------|--------------|------|--------|
| Chunking recursivo com overlap | Sliding window manual | `RecursiveCharacterTextSplitter` de `@langchain/textsplitters` | Troca de separador recursiva com overlap correto é sutil; biblioteca oficial já trata edge cases (unicode, separador não encontrado) |
| Cosine similarity query | SQL manual com `<=>` ou `<->` | `cosineDistance()` de `drizzle-orm` | Já em uso em `packages/memory/src/semantic.ts`; type-safe, gera SQL correto para pgvector |
| Batch embeddings | Loop de `embedQuery` | `embedder.embedDocuments(chunks)` | API batch do LangChain; evita N requests individuais; rate limiting automático nos providers |
| Bearer token parsing | `split(" ")[1]` manual | `header?.replace("Bearer ", "")` | Padrão já estabelecido em `packages/core/src/server.ts` e comentários do CONTEXT.md |

**Insight chave:** Todo o "trabalho pesado" (pgvector, drizzle cosine, LangChain embeddings) já tem padrão estabelecido no projeto. Esta fase é montagem de peças existentes, não invenção.

## Common Pitfalls

### Pitfall 1: `embedDocuments` vs `embedQuery` — Uso Incorreto
**O que dá errado:** Usar `embedQuery` em loop para chunks de ingestão, ou usar `embedDocuments` para a query single da tool.
**Por que acontece:** APIs com nomes diferentes para operações semanticamente similares.
**Como evitar:**
- Ingestão → `embedder.embedDocuments(chunks: string[])` — retorna `number[][]`
- Search → `embedder.embedQuery(query: string)` — retorna `number[]`
- Fonte: comportamento padrão de `Embeddings` do LangChain (`@langchain/core/embeddings`)

### Pitfall 2: `cosineDistance` Retorna Distância, Não Similaridade
**O que dá errado:** Ordenar por `cosineDistance` ascending e filtrar `> threshold` — resultado invertido.
**Por que acontece:** Nome intuitivo mas semantica invertida (distância zero = vetores idênticos).
**Como evitar:** Sempre `1 - cosineDistance(...)` para similarity. `gt(similarity, 0.5)` filtra abaixo do threshold. `orderBy(desc(similarity))` ordena do mais similar. [VERIFIED: codebase — semantic.ts linha 67 usa exatamente esse padrão]

### Pitfall 3: `inArray` com Array Vazio
**O que dá errado:** Se `collections` chegar como `[]`, `inArray(col, [])` pode gerar SQL inválido ou retornar todos os registros dependendo do driver.
**Por que acontece:** LLM pode chamar `search_knowledge` com `collections: []`.
**Como evitar:** Validar no schema Zod da tool (`z.array(z.string()).min(1)`) e no handler de ingest. Se `collections` vazio, retornar string de "sem resultados" sem consultar o banco.

### Pitfall 4: DELETE por Coleção sem Filtro de Modelo
**O que dá errado:** `DELETE WHERE collection = ?` apaga chunks de todos os modelos, quebrando D-03.
**Por que acontece:** D-03 especifica delete seletivo por modelo.
**Como evitar:** `DELETE WHERE collection = ? AND embedding_model = resolveEmbeddingModel()` — apenas chunks do modelo atual são substituídos; chunks de modelos anteriores sobrevivem.

### Pitfall 5: `EMBEDDING_MODEL` throw em `createEmbeddings()` sem D-17
**O que dá errado:** `createEmbeddings()` lança `ConfigurationError` quando `EMBEDDING_MODEL` não está setado — ingest e search falham silenciosamente para operadores que não setaram a ENV.
**Por que acontece:** Código atual (linha 24 de `factory.ts`) tem `throw` explícito quando model é `undefined`.
**Como evitar:** D-17 DEVE ser implementado antes de RAG-01 e RAG-02 — a modificação em `factory.ts` é prerequisito para todos os outros arquivos RAG.

### Pitfall 6: Montar `createIngestApp` no Server sem Export no Barrel
**O que dá errado:** `apps/brain-sdr/src/server.ts` importa `createIngestApp` de `@brain-pkg/core` mas não foi adicionado ao `packages/core/src/index.ts`.
**Por que acontece:** Barrel export frequentemente esquecido em fases de adição de código.
**Como evitar:** Task de integração deve incluir atualização do barrel e verificar que `apps/brain-sdr` importa com sucesso via typecheck.

### Pitfall 7: `RecursiveCharacterTextSplitter.splitText` é Async
**O que dá errado:** Chamar `splitter.splitText(text)` sem `await`.
**Por que acontece:** API assíncrona mesmo para operação em memória — retorna `Promise<string[]>`.
**Como evitar:** `const chunks = await splitter.splitText(text)`.

## Code Examples

### Formato de Bloco de Resultado (D-10)
```typescript
// Source: D-10 decision no CONTEXT.md [VERIFIED: codebase CONTEXT.md]
function formatResults(results: ChunkResult[]): string {
  return results
    .map(
      (r) =>
        `[Coleção: ${r.collection}] chunk ${r.chunkIndex + 1}/${r.totalChunks}\n${r.content}`
    )
    .join("\n---\n");
}
```

### Ingest: DELETE + INSERT Pattern (D-03)
```typescript
// D-03: delete chunks do modelo atual nessa coleção, preservar outros modelos
await db
  .delete(knowledgeChunks)
  .where(
    and(
      eq(knowledgeChunks.collection, collection),
      eq(knowledgeChunks.embeddingModel, currentModel)
    )
  );

// INSERT batch
const rows = chunks.map((content, i) => ({
  collection,
  content,
  embedding: vectors[i],
  embeddingModel: currentModel,  // RAG-04: D-15
  chunkIndex: i,                  // RAG-04
  totalChunks: chunks.length,     // RAG-04
}));
await db.insert(knowledgeChunks).values(rows);
```

### Test Pattern: Ingest Endpoint (replicando server.test.ts)
```typescript
// Padrão de teste para createIngestApp — replica estrutura de server.test.ts
// [VERIFIED: codebase — packages/core/src/__tests__/server.test.ts]
import { describe, it, expect, mock, beforeEach } from "bun:test";

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => mockDb),
}));

// Hono app.fetch() com Request object — zero external calls
const app = createIngestApp({} as never);
const res = await app.fetch(
  new Request("http://localhost/api/v1/ingest", {
    method: "POST",
    headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Hello world", collection: "faq" }),
  })
);
```

## State of the Art

| Abordagem Antiga | Abordagem Atual | Quando Mudou | Impacto |
|------------------|-----------------|--------------|---------|
| `langchain` (monorepo) para text splitters | `@langchain/textsplitters` (package dedicado) | LangChain v0.2+ | Import de `@langchain/textsplitters`, não de `langchain/text_splitter` |
| `EMBEDDING_MODEL` obrigatório (throw) | `EMBEDDING_MODEL` opcional com defaults por provider | Phase 21 (D-17) | Operadores sem ENV funcionam com modelo adequado ao provider |
| `embedDocuments` retorna `number[][]` flat | Idem — sem mudança | — | Manter padrão: `vectors[i]` acessa o vetor do chunk `i` |

**Deprecated/outdated:**
- Import de `RecursiveCharacterTextSplitter` de `langchain/text_splitter`: usar `@langchain/textsplitters` [ASSUMED — baseado em split do monorepo LangChain]

## Assumptions Log

| # | Claim | Section | Risco se Errado |
|---|-------|---------|-----------------|
| A1 | `RecursiveCharacterTextSplitter` de `@langchain/textsplitters@1.0.1` usa exatamente a API `new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap, separators })` e método assíncrono `splitText(text)` | Code Examples | Se API mudou, implementação própria de ~40 linhas é fallback viável (Claude's Discretion) |
| A2 | `embedder.embedDocuments(chunks)` retorna `number[][]` com índices correspondentes aos chunks de entrada | Standard Stack | Se API retornar objeto diferente, ajuste simples na indexação do INSERT batch |
| A3 | Import de `RecursiveCharacterTextSplitter` de `langchain/text_splitter` (monorepo antigo) está deprecated em favor de `@langchain/textsplitters` | State of the Art | Sem risco — usamos `@langchain/textsplitters` diretamente |

**Nota:** Os claims de maior confiança (padrões de código, schema, drizzle API) foram todos verificados via leitura do codebase. Apenas A1 e A2 são baseados em training knowledge sobre a API do LangChain — ambos têm fallbacks simples se errados.

## Open Questions (RESOLVED)

1. **pgvector 0.8.x no Docker image?**
   - O que sabemos: STATE.md menciona "pgvector 0.8.x no Docker image? (`hnsw.iterative_scan = relaxed_order` requer 0.8.0+)" como research flag.
   - O que é incerto: Versão do pgvector instalada na imagem Docker atual (`oven/bun:1` + pg).
   - Recomendação: **Sem impacto na Phase 21** — HNSW index é criado manualmente pós-ingestão (D-09 / out of scope). Esta fase usa apenas sequential scan (sem HNSW). A flag do STATE.md é para fase futura.
   - RESOLVED: Sem impacto na Phase 21. Phase 21 usa sequential scan apenas; HNSW fica para fase futura. Nenhuma ação necessária nesta fase.

2. **`@langchain/textsplitters` vs implementação própria**
   - O que sabemos: `@langchain/textsplitters@1.0.1` é compatível com `@langchain/core ^1.1.48`; dep de `js-tiktoken` para tokenização.
   - O que é incerto: Se `js-tiktoken` causa incompatibilidade com Bun 1.3.2 (CLAUDE.md menciona sensibilidade a compatibilidade Bun).
   - Recomendação: Se `js-tiktoken` causar problema em Bun, implementação própria de ~40 linhas é fallback imediato. Testar na Wave 0 (install + import).
   - RESOLVED: Plano 02 Task 1 instrui o executor a tentar `@langchain/textsplitters` primeiro e usar implementação própria como fallback explícito se `js-tiktoken` causar incompatibilidade com Bun. Ambos os caminhos documentados no action.

## Environment Availability

| Dependência | Requerida por | Disponível | Versão | Fallback |
|-------------|--------------|-----------|--------|----------|
| Bun | Runtime | ✓ | 1.3.2 | — |
| PostgreSQL | pgvector queries | ✓ (psql cli) | 16.14 | — |
| PostgreSQL server | Integration tests | ✗ | — | Unit tests com mocks (padrão do projeto) |
| Docker | Build/deploy | ✓ | 29.4.1 | — |
| `@langchain/textsplitters` | chunker.ts | ✗ (não instalado) | — | Implementação própria ~40 linhas |

**Dependências sem fallback que bloqueiam execução:**
- PostgreSQL server (porta 5432 sem resposta) — bloqueia apenas integration tests. Unit tests com mocks funcionam sem o servidor, seguindo padrão estabelecido do projeto.

**Dependências com fallback:**
- `@langchain/textsplitters`: fallback = implementação própria (Claude's Discretion).

## Validation Architecture

### Test Framework
| Propriedade | Valor |
|-------------|-------|
| Framework | `bun test` (built-in, v1.3.2) |
| Config file | Nenhum — `bun test` via scripts em `package.json` |
| Comando rápido | `bun test packages/core/src/rag/ packages/core/src/tools/__tests__/search-knowledge.test.ts` |
| Suite completa | `bun test packages/core/src` |

**Baseline verificado:** 57 testes passando em `packages/core/src/__tests__/` antes desta fase. [VERIFIED: `bun test packages/core/src/__tests__/` 2026-06-24]

### Mapa Requisitos → Testes
| Req ID | Comportamento | Tipo de Teste | Comando | Arquivo Existe? |
|--------|--------------|---------------|---------|-----------------|
| RAG-01 | POST /ingest retorna 401 sem token | unit | `bun test packages/core/src/rag/__tests__/ingest.test.ts -t "401"` | ❌ Wave 0 |
| RAG-01 | POST /ingest retorna 503 sem INGEST_TOKEN configurado | unit | `bun test packages/core/src/rag/__tests__/ingest.test.ts -t "503"` | ❌ Wave 0 |
| RAG-01 | POST /ingest chunka, embede e insere no banco | unit (mock db) | `bun test packages/core/src/rag/__tests__/ingest.test.ts -t "chunks"` | ❌ Wave 0 |
| RAG-02 | `search_knowledge` retorna string formatada quando há resultados | unit | `bun test packages/core/src/tools/__tests__/search-knowledge.test.ts -t "resultado"` | ❌ Wave 0 |
| RAG-02 | `search_knowledge` retorna string de "Nenhum resultado" quando vazio | unit | `bun test packages/core/src/tools/__tests__/search-knowledge.test.ts -t "Nenhum"` | ❌ Wave 0 |
| RAG-03 | `search_knowledge` busca em múltiplas coleções (inArray) | unit (mock db) | `bun test packages/core/src/tools/__tests__/search-knowledge.test.ts -t "múltiplas"` | ❌ Wave 0 |
| RAG-04 | INSERT registra embeddingModel, chunkIndex, totalChunks não-nulos | unit (mock db) | `bun test packages/core/src/rag/__tests__/ingest.test.ts -t "metadados"` | ❌ Wave 0 |
| D-17 | `createEmbeddings()` usa default por provider quando EMBEDDING_MODEL ausente | unit | `bun test packages/ai/src/embeddings/__tests__/factory.test.ts -t "default"` | ❌ Wave 0 |
| D-02 | `splitText` respeita separadores recursivos e overlap | unit | `bun test packages/core/src/rag/__tests__/chunker.test.ts` | ❌ Wave 0 |

### Taxa de Amostragem
- **Por commit de task:** `bun test packages/core/src/rag/ packages/core/src/tools/__tests__/search-knowledge.test.ts`
- **Por merge de wave:** `bun test packages/core/src`
- **Gate de fase:** Suite completa verde antes do `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/core/src/rag/__tests__/ingest.test.ts` — cobre RAG-01, RAG-04
- [ ] `packages/core/src/rag/__tests__/chunker.test.ts` — cobre D-02
- [ ] `packages/core/src/rag/__tests__/search.test.ts` — cobre RAG-02, RAG-03
- [ ] `packages/core/src/tools/__tests__/search-knowledge.test.ts` — cobre RAG-02, RAG-03, D-11
- [ ] `packages/ai/src/embeddings/__tests__/factory.test.ts` — cobre D-17 (defaults por provider)

## Security Domain

### Categorias ASVS Aplicáveis

| Categoria ASVS | Aplica | Controle Padrão |
|----------------|--------|-----------------|
| V2 Authentication | sim | Bearer token vs INGEST_TOKEN — fail closed (503) se token não configurado |
| V3 Session Management | não | Endpoint stateless, sem sessão |
| V4 Access Control | sim | Token único por instância — sem granularidade por coleção (v1) |
| V5 Input Validation | sim | Zod schema no body `{ text, collection }`; `collection` não pode ser vazio/injetado |
| V6 Cryptography | não | Não armazena/transmite dados sensíveis além do conteúdo ingerido |

### Padrões de Ameaça para Este Stack

| Padrão | STRIDE | Mitigação Padrão |
|--------|--------|-----------------|
| Ingestão sem autenticação → dump do banco via search | Elevation of Privilege | Bearer token fail-closed (D-13); mesmo padrão do ADMIN_TOKEN |
| `collection` com caracteres especiais injetando SQL | Tampering | Drizzle ORM parametriza automaticamente — sem SQL manual |
| Payload gigante → DoS de memória/CPU no chunking | Denial of Service | Limitar tamanho do body no handler (Claude's Discretion — e.g., 1MB max) |
| `collections: []` na tool chamando banco com `inArray` vazio | Tampering/DoS | Zod schema `z.array(z.string()).min(1)` + guard antes do db query |
| Log de INGEST_TOKEN em mensagens de erro | Information Disclosure | Replicar padrão de `createCoreApp`: nunca logar token, apenas presença/ausência |

## Project Constraints (from CLAUDE.md)

| Diretiva | Impacto na Phase 21 |
|----------|---------------------|
| Runtime: Bun | `bun test` para todos os testes; imports ESM nativos |
| ORM: Drizzle 0.45.x | `cosineDistance`, `inArray`, `and`, `desc`, `gt`, `sql` de `drizzle-orm` |
| Sem `amqplib` (usar `amqplib-bun`) | Não aplicável — RAG não usa RabbitMQ |
| Testes em `__tests__/unit/` e `__tests__/integration/` | Testes RAG em `packages/core/src/rag/__tests__/` |
| `packages/` para código reutilizável por qualquer Brain | RAG em `packages/core/src/rag/` — correto |
| Commits com emoji + Conventional Commits | Aplicável ao commitar docs e código |
| Nunca criar `.md` na raiz do repo ou pacotes | Apenas `__tests__/` e `src/` — sem .md de documentação nos pacotes |

## Sources

### Primary (HIGH confidence)
- Codebase: `packages/core/src/server.ts` — template de auth Hono sub-app
- Codebase: `packages/core/src/tools/pause-session.ts` — template de tool factory
- Codebase: `packages/memory/src/semantic.ts` — template de cosine similarity query
- Codebase: `packages/ai/src/embeddings/factory.ts` — código a modificar (D-17)
- Codebase: `packages/database/src/schema/tables.ts` — schema `knowledgeChunks` já criado
- Codebase: `apps/brain-sdr/src/server.ts` e `index.ts` — ponto de integração
- Codebase: `packages/core/src/index.ts` — barrel export a atualizar
- npm registry: `@langchain/textsplitters@1.0.1` — versão e deps verificadas [VERIFIED: npm view 2026-06-24]

### Secondary (MEDIUM confidence)
- `.planning/phases/21-rag/21-CONTEXT.md` — todas as decisões D-01 a D-17 documentadas pelo discuss-phase
- `.planning/REQUIREMENTS.md` — RAG-01 a RAG-04 com descrições exatas

### Tertiary (LOW confidence)
- A1: API exata de `RecursiveCharacterTextSplitter` (método, parâmetros) — baseada em training knowledge sobre LangChain textsplitters

## Metadata

**Breakdown de confiança:**
- Standard stack: HIGH — todas as bibliotecas verificadas via npm e codebase
- Architecture: HIGH — padrões verificados via leitura direta do código existente
- Pitfalls: HIGH — verificados contra código existente e decisões do CONTEXT.md
- API de `@langchain/textsplitters`: MEDIUM — versão verificada, API exata [ASSUMED]

**Data da pesquisa:** 2026-06-24
**Válido até:** 2026-07-24 (stack estável; `@langchain/textsplitters` raramente tem breaking changes em minor)
