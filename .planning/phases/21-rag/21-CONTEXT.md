# Phase 21: RAG - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Operador pode ingerir texto em coleções via `POST /api/v1/ingest` (autenticado por Bearer token). O LLM pode buscar contexto relevante chamando `search_knowledge(query, collections[])`, que retorna os chunks mais similares do pgvector. Base de conhecimento semântica disponível para todos os Brains — lógica em `packages/core/src/rag/`.

Não inclui: HNSW index (criado manualmente pós-ingestão), re-indexação por modelo (RAG-F01), endpoint DELETE de coleção (RAG-F02), monitoramento de coleções (RAG-F03).

</domain>

<decisions>
## Implementation Decisions

### Chunking Strategy

- **D-01:** Tamanho de chunk: 1000 chars, overlap de 200 chars — hardcoded, sem ENV configurável (YAGNI).
- **D-02:** Método de split: recursivo — divide primeiro por `\n\n` (parágrafo), depois `\n` (linha), depois espaço/chars. Preserva unidades de significado sem cortar sentenças no meio. Padrão do LangChain `RecursiveCharacterTextSplitter`.
- **D-03:** Re-ingestão da mesma coleção = `DELETE WHERE collection AND embedding_model = current_model` + re-insert. Chunks de modelos diferentes na mesma coleção são preservados no banco — não são apagados ao trocar de modelo.
- **D-03a:** `search_knowledge` filtra `WHERE embedding_model = current_model` (modelo resolvido automaticamente por provider — veja D-14) antes de calcular similaridade. Ao trocar de provedor, chunks antigos ficam no banco mas são automaticamente excluídos dos resultados de busca — sem necessidade de apagar manualmente.
- **D-03b:** Tradeoff aceito: chunks de modelos antigos acumulam storage. Para o volume de RAG de um Brain SDR isso é aceitável. Limpeza manual é opcional via RAG-F02 (futuro).

### Localização da Arquitetura

- **D-04:** Todo o código RAG vive em `packages/core/src/rag/` com os seguintes arquivos: `chunker.ts` (splitting), `search.ts` (cosine similarity query), `ingest.ts` (Hono app com endpoint).
- **D-05:** `createIngestApp(sql)` é exportada de `packages/core` e montada explicitamente no `server.ts` de cada Brain (como `createCoreApp(runner)`) — Brain decide se inclui RAG ou não.
- **D-06:** `createSearchKnowledgeTool(sql)` segue o padrão de `createPauseSessionTool(sql)` — factory function em `packages/core/src/rag/`, registrada via `toolsRegistry.enableTool(brainType, 'search_knowledge')`.

### search_knowledge: Parâmetros e Resultados

- **D-07:** Top 5 chunks no total, combinando todas as coleções pesquisadas. Sem limite por coleção individual.
- **D-08:** Threshold de similaridade cosine: 0.5 — filtra resultados irrelevantes sem ser restritivo demais.
- **D-09:** Parâmetros (topK e threshold) hardcoded no SDK — LLM não pode configurá-los na chamada da tool.
- **D-10:** Retorno para o LLM: texto formatado em blocos:
  ```
  [Coleção: faq] chunk 1/3
  Conteúdo do chunk...
  ---
  [Coleção: manual] chunk 2/5
  Conteúdo do outro chunk...
  ```
- **D-11:** Quando sem resultados (coleção vazia ou threshold não atingido): retornar string `"Nenhum resultado encontrado para a consulta nas coleções informadas."` — sem erro/exception.

### Modelo de Embedding por Provedor (Auto-resolução)

- **D-14:** `EMBEDDING_MODEL` ENV é **opcional**. Quando ausente, o sistema resolve o modelo padrão com base no `LLM_PROVIDER`:
  - `openai` ou `openrouter` → `text-embedding-3-small`
  - `gemini` → `text-embedding-004`
  Operador pode sobrescrever com `EMBEDDING_MODEL` se quiser outro modelo.
- **D-15:** O nome do modelo resolvido (ex: `text-embedding-3-small`) é gravado em `knowledge_chunks.embedding_model` a cada ingestão — rastreia qual modelo gerou cada chunk (RAG-04).
- **D-16:** **Compatibilidade de dimensão entre provedores:** `text-embedding-3-small` (OpenAI) suporta output de 768 dims via parâmetro; `text-embedding-004` (Google) usa 768 dims por padrão. Para troca de provedor sem re-migrar a coluna de vetor, configurar `EMBEDDING_DIMENSIONS=768`. Com 768, ambos os provedores são compatíveis com a mesma coluna pgvector. Operadores que usam apenas OpenAI podem manter 1536 (default atual).
- **D-17:** `createEmbeddings()` em `packages/ai/src/embeddings/factory.ts` precisa ser atualizada: remover o `throw` quando `EMBEDDING_MODEL` é ausente e usar os defaults de D-14. **Esta é uma mudança na factory existente**, não um arquivo novo.

### Ativação da Tool nos Brains

- **D-12:** Habilitação via `toolsRegistry.enableTool(brainType, 'search_knowledge')` explicitamente no startup do Brain — mesmo padrão de `pause_session` e `finish_conversation`. Brains sem RAG simplesmente não registram.
- **D-13:** O endpoint `/api/v1/ingest` usa `Authorization: Bearer <INGEST_TOKEN>` — retorna 401 se token ausente ou inválido. Falha fechada se INGEST_TOKEN não configurado (retorna 503), mesmo padrão de ADMIN_TOKEN no `/reload-prompts`.

### Claude's Discretion

- Biblioteca de splitting: LangChain `RecursiveCharacterTextSplitter` ou implementação própria (ambas aceitáveis desde que siga o padrão D-02)
- Timeout e error handling no endpoint de ingest (e.g., tamanho máximo de payload)
- Estrutura exata do barrel export em `packages/core/src/index.ts` para os novos símbolos RAG
- Textos exatos das mensagens de erro (400, 401, 503) no ingest endpoint

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e Roadmap

- `.planning/REQUIREMENTS.md` §RAG-01, RAG-02, RAG-03, RAG-04 — definições exatas dos requisitos; seção Out of Scope para HNSW, DELETE de coleção, interface admin
- `.planning/ROADMAP.md` §Phase 21 — Success Criteria: 4 critérios de aceitação

### Schema e Decisões de Phase 19

- `.planning/phases/19-database-foundation/19-CONTEXT.md` — D-07 (re-ingestão), D-08 (EMBEDDING_DIM via ENV), D-09 (sem HNSW): decisões de schema knowledge_chunks já tomadas
- `packages/database/src/schema/tables.ts` — definição Drizzle de `knowledgeChunks` (colunas: id, collection, content, embedding, embeddingModel, chunkIndex, totalChunks, createdAt, updatedAt)

### Implementações de Referência (padrões a replicar)

- `packages/core/src/server.ts` — `createCoreApp(runner)`: padrão de Hono sub-app em packages/core com auth (X-Admin-Token → ADMIN_TOKEN); adapter para `createIngestApp(sql)` com `Authorization: Bearer` → `INGEST_TOKEN`
- `packages/core/src/tools/pause-session.ts` — factory `createPauseSessionTool(sql)`: padrão de tool factory com sql injetado; `createSearchKnowledgeTool(sql)` segue exatamente esse padrão
- `packages/memory/src/semantic.ts` — `searchSimilar()`: uso de `cosineDistance`, `gt`, `desc`, `sql` do drizzle-orm para cosine similarity; adaptar para `knowledge_chunks` (sem filtro `userId`, adicionar filtro `collection IN (...)`)
- `packages/ai/src/embeddings/factory.ts` — `createEmbeddings()`: factory de embeddings com suporte OpenAI e Gemini; reutilizar para gerar embeddings durante ingest e durante search

### Padrão de Montagem de Rotas

- `apps/brain-sdr/src/server.ts` — como adicionar `app.route('/', createIngestApp(sql))` junto com createHealthApp, createWebhookApp, createCoreApp

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/ai/src/embeddings/factory.ts` → `createEmbeddings()`: já suporta OpenAI e Gemini via `LLM_PROVIDER` ENV. Usar para gerar embeddings no ingest (batch de chunks) e na search (query única).
- `packages/memory/src/semantic.ts` → `searchSimilar()`: lógica de cosine similarity com drizzle-orm já implementada. Adaptar para `knowledge_chunks` (trocar tabela, trocar filtro `userId` por `collection IN (...)`, ajustar topK e threshold).
- `packages/core/src/server.ts` → `createCoreApp()`: padrão de sub-app Hono com auth de header. Replicar exatamente para `createIngestApp()` com Bearer token.
- `packages/core/src/tools/pause-session.ts` → padrão de factory com closure sobre `sql` → adaptar para `createSearchKnowledgeTool(sql)`.

### Established Patterns

- Auth de endpoint: `c.req.header("Authorization")?.replace("Bearer ", "")` vs `process.env.INGEST_TOKEN`; ausência de ENV = 503 fail-closed.
- Embeddings: `const embedder = await createEmbeddings(); const vectors = await embedder.embedDocuments(chunks)` para batch, `embedder.embedQuery(text)` para search.
- EMBEDDING_DIM: lido de `parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)` — consistente com tabela.
- Drizzle cosine: `sql<number>\`1 - (${cosineDistance(knowledgeChunks.embedding, queryVector)})\`` para similarity score.

### Integration Points

- `packages/core/src/index.ts`: barrel export — adicionar `createIngestApp`, `createSearchKnowledgeTool` para consumo pelos Brain apps.
- `apps/brain-sdr/src/server.ts`: adicionar `app.route('/', createIngestApp(sql))` após `createCoreApp`.
- `apps/brain-sdr/src/index.ts`: adicionar `toolsRegistry.enableTool("sdr", "search_knowledge")` junto aos demais.
- `packages/core/src/runner/runner.ts`: `buildGraph()` ou equivalente já passa sql para factories de tools — `createSearchKnowledgeTool(sql)` segue o mesmo fluxo.

</code_context>

<specifics>
## Specific Ideas

- Chunking recursivo por parágrafo/linha/chars preserva coerência semântica para textos de SDR (scripts de vendas, FAQs, manuais de produto).
- Texto formatado em blocos `[Coleção: X]` é mais natural para o LLM consumir sem parsing adicional.
- `createIngestApp(sql)` recebe `sql` direto (como createHealthApp) e inicializa `drizzle(sql)` internamente — sem dependência em BrainRunner.

</specifics>

<deferred>
## Deferred Ideas

- RAG-F01: Re-indexação de coleção ao trocar modelo de embedding — operação de manutenção futura
- RAG-F02: Endpoint DELETE /api/v1/ingest/:collection — requisito futuro
- RAG-F03: Interface de monitoramento de coleções — requisito futuro
- INGEST_CHUNK_SIZE e INGEST_CHUNK_OVERLAP como ENVs configuráveis — descartado (YAGNI para v1.4)
- packages/rag separado — descartado; packages/core/src/rag/ é suficiente e consistente

</deferred>

---

*Phase: 21-rag*
*Context gathered: 2026-06-24*
