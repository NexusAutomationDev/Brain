# Phase 21: RAG - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 21-rag
**Areas discussed:** Chunking strategy, Localização da arquitetura, search_knowledge: resultados, Ativação da tool nos Brains

---

## Chunking strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 1000 chars com 200 de overlap | Padrão bem estabelecido para RAG. Chunks menores = embeddings mais precisos. Overlap preserva contexto entre chunks. | ✓ |
| 500 chars sem overlap | Chunks menores e mais focados. Sem perda de contexto entre chunks adjacentes (independentes). | |
| 2000 chars com 400 de overlap | Chunks maiores = mais contexto por resultado. Mais tokens consumidos pelo LLM. | |

**User's choice:** 1000 chars com 200 de overlap

---

| Option | Description | Selected |
|--------|-------------|----------|
| Por parágrafo, depois por chars | Divide por `\n\n`, depois `\n`, depois espaço/chars. Preserva unidades de significado. Padrão do LangChain RecursiveCharacterTextSplitter. | ✓ |
| Somente por tamanho fixo | Divide rigidamente a cada N chars, pode cortar sentenças no meio. | |

**User's choice:** Por parágrafo, depois por chars

---

| Option | Description | Selected |
|--------|-------------|----------|
| ENVs com defaults | INGEST_CHUNK_SIZE=1000 e INGEST_CHUNK_OVERLAP=200 configuráveis via ENV. | |
| Hardcoded no código | 1000/200 hardcoded — YAGNI. Menos ENVs para gerenciar. | ✓ |

**User's choice:** Hardcoded no código

---

## Localização da arquitetura

| Option | Description | Selected |
|--------|-------------|----------|
| packages/core | createIngestApp() e createSearchKnowledgeTool() em packages/core, como createCoreApp e pause_session. Qualquer Brain herda RAG montando a rota e registrando a tool. | ✓ |
| packages/rag separado | Novo pacote @brain-pkg/rag isolado. Mais separation of concerns, mais um pacote no workspace. | |

**User's choice:** packages/core

---

| Option | Description | Selected |
|--------|-------------|----------|
| Brain monta explicitamente | createIngestApp(sql) exportada de packages/core, montada em server.ts do Brain. Controle explícito. | ✓ |
| BrainRunner monta automaticamente | Não existe arquiteturalmente — BrainRunner não gerencia rotas HTTP. | |

**User's choice:** Montagem explícita pelo Brain (server.ts)

---

| Option | Description | Selected |
|--------|-------------|----------|
| packages/core/src/rag/ | Nova pasta rag/ com chunker.ts, search.ts, ingest.ts. Segue padrão de fup/, events/, tools/. | ✓ |
| Misturado com tools/ | search_knowledge.ts em packages/core/src/tools/. Mais simples, mas RAG tem mais do que uma tool. | |

**User's choice:** packages/core/src/rag/

---

## search_knowledge: resultados

| Option | Description | Selected |
|--------|-------------|----------|
| Top 5 no total | 5 chunks mais similares combinados de todas as coleções. Sem limite por coleção. | ✓ |
| Top 3 por coleção | Até 3 chunks por coleção. Garante representação de cada coleção nos resultados. | |

**User's choice:** Top 5 no total

---

| Option | Description | Selected |
|--------|-------------|----------|
| 0.5 | Threshold moderado — elimina irrelevantes sem ser restritivo. | ✓ |
| 0.3 | Threshold baixo — retorna mais resultados, incluindo menos precisos. Risco de ruído. | |

**User's choice:** 0.5

---

| Option | Description | Selected |
|--------|-------------|----------|
| Texto formatado em blocos | String com [Coleção: X] chunk N/M\nConteúdo...\n--- por resultado. Fácil para LLM processar. | ✓ |
| JSON estruturado | Array JSON com collection, content, chunk_index, total_chunks, similarity. | |

**User's choice:** Texto formatado em blocos

---

| Option | Description | Selected |
|--------|-------------|----------|
| Não, hardcoded | LLM passa apenas query e collections[]. topK=5 e threshold=0.5 fixos no SDK. YAGNI. | ✓ |
| Sim, parâmetros opcionais | LLM pode passar top_k e min_score opcionais. Mais flexível, mas risco de decisões ruins do LLM. | |

**User's choice:** Hardcoded no SDK

---

## Ativação da tool nos Brains

| Option | Description | Selected |
|--------|-------------|----------|
| enableTool explicitamente | toolsRegistry.enableTool('sdr', 'search_knowledge') no startup do Brain. Brains sem RAG não registram. | ✓ |
| Automático se INGEST_TOKEN existir | BrainRunner detecta ENV e registra automaticamente. Menos controle explícito. | |

**User's choice:** enableTool explicitamente

---

| Option | Description | Selected |
|--------|-------------|----------|
| Retornar mensagem útil | "Nenhum resultado encontrado para a consulta nas coleções informadas." — sem erro. | ✓ |
| Retornar array vazio JSON | Retorna '[]' como string. LLM precisa parsear. | |

**User's choice:** Retornar mensagem útil

---

## Claude's Discretion

- Biblioteca de splitting (LangChain RecursiveCharacterTextSplitter ou implementação própria)
- Timeout e error handling no endpoint de ingest (tamanho máximo de payload)
- Estrutura exata do barrel export em packages/core/src/index.ts para símbolos RAG
- Textos exatos das mensagens de erro (400, 401, 503) no ingest endpoint

## Deferred Ideas

- RAG-F01: Re-indexação ao trocar modelo de embedding
- RAG-F02: Endpoint DELETE /api/v1/ingest/:collection
- RAG-F03: Interface de monitoramento de coleções
- INGEST_CHUNK_SIZE/OVERLAP como ENVs configuráveis — descartado (YAGNI)
- packages/rag separado — descartado em favor de packages/core/src/rag/
