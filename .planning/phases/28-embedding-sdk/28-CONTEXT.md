# Phase 28: Embedding SDK - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

`packages/embeddings` passa a existir como abstração completa de provider de embedding — qualquer Brain configura provider, modelo e dimensões via ENV sem tocar em TypeScript. A fase reconcilia infraestrutura de embedding que já existe e funciona (RAG do Brain SDR, via `packages/ai/src/embeddings/factory.ts`) — não é construção do zero, é extração/formalização + correção de gaps pontuais (D-16, MEM-03) + uma capacidade nova adicionada por decisão explícita do usuário (ferramenta de re-embed em lote).

Novos Brains (Suporte, etc.) e mudanças ao grafo do Brain SDR estão fora do escopo — isso é Fase 29/30.

</domain>

<decisions>
## Implementation Decisions

### Estrutura do pacote e integração com RAG existente

- **D-01:** Extrair `packages/ai/src/embeddings/factory.ts` para um novo `packages/embeddings`, criando o pacote que `ROADMAP.md`/`REQUIREMENTS.md` já especificam.
- **D-02:** `IEmbeddingProvider` **substitui** `createEmbeddings()` em todos os callers existentes — `packages/core/src/tools/search-knowledge.ts` e `packages/core/src/rag/ingest.ts` passam a receber um `IEmbeddingProvider` (injetado) em vez de chamar o factory do `packages/ai` diretamente. Não fica coexistindo duas formas de gerar embedding.
- **D-03:** Manter suporte a Gemini além de OpenAI — `GeminiEmbeddingProvider` junto com `OpenAIEmbeddingProvider`, preservando o que já funciona hoje (`GoogleGenerativeAIEmbeddings` no factory atual). REQUIREMENTS.md exige só OpenAI (EMBD-02) como mínimo, mas remover Gemini seria regressão.
- **D-04:** `OpenAIEmbeddingProvider` e `GeminiEmbeddingProvider` envolvem os wrappers do LangChain (`OpenAIEmbeddings`, `GoogleGenerativeAIEmbeddings`) — mesmo padrão usado por `createLLM()` em `packages/ai/src/llm/factory.ts` (retorna tipo do LangChain, não chama SDK oficial direto). Consistência com o padrão já validado em produção.

### Fix da migration com `vector(1536)` hardcoded (D-16)

- **D-05:** Confirmado que **não há clientes reais em produção** ainda — só ambientes de dev/teste. Fix pode ser mais direto, sem plano de migração de dados reais.
- **D-06:** Criar **nova migration `0009`** com `ALTER COLUMN TYPE vector(N)` — não editar a migration `0007` já aplicada (mantém histórico imutável do Drizzle).
- **D-07:** A migration `0009` é gerada via `drizzle-kit generate` com `EMBEDDING_DIMENSIONS` setado no `.env` **no momento da geração** — o SQL fica estático/literal (padrão Drizzle), não há interpolação em runtime. Mudar a dimensão de novo no futuro exige gerar outra migration. Isso é o comportamento correto e esperado, documentado para quem for operar.

### Escopo da escrita semântica no BrainRunner (EMBD-05)

- **D-08:** Conectar **ambos** os pontos identificados em `packages/core/src/runner/runner.ts`: embedar a mensagem do usuário antes do `getContext()` (linha ~296, hoje `queryVector` vazio) **e** embedar o `profileValue` no `saveContext()` (linhas ~377-385, hoje sem campo `embedding` — esse é o MEM-03 original).
- **D-09:** Embedding da mensagem do usuário é **bloqueante**, faz parte do fluxo principal — `getContext()` depende do vetor gerado para fazer a busca semântica, não pode ser fire-and-forget como `IEventPublisher`.
- **D-10:** Fallback gracioso em caso de falha na chamada de embedding — loga o erro e segue com `queryVector` vazio / sem salvar embedding. Nunca quebra o atendimento ao lead por causa disso. Mesmo padrão de resiliência já usado no projeto (fallback do MCP, fire-and-forget do `IEventPublisher`).

### `EMBEDDING_PROVIDER` independente do `LLM_PROVIDER`

- **D-11:** Introduzir `EMBEDDING_PROVIDER` como ENV dedicada **nesta fase** (não esperar a Fase 29) — já documentada como aspiracional no `CLAUDE.md`.
- **D-12:** Quando `EMBEDDING_PROVIDER` está ausente, resolver automaticamente para um provider **capaz de gerar embedding** — formalizando o comportamento que já existe em `resolveEmbeddingModel()`: `LLM_PROVIDER=gemini` → embedding via Gemini; qualquer outro valor (incluindo `anthropic`, que não tem API de embedding) → default para OpenAI. **Não é** um espelho literal de `LLM_PROVIDER` — é um mapeamento consciente de capacidade.
- **D-13:** Consequência direta do D-12: trocar `LLM_PROVIDER` (ex: openai → anthropic) **não afeta** o embedding automaticamente — o RAG permanece estável a menos que `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL` seja alterado explicitamente.
- **D-14:** **Confirmado via pesquisa** (ver Specific Ideas): vetores gerados por providers/modelos diferentes (ex: Gemini vs OpenAI) **não são comparáveis entre si**, mesmo com a mesma dimensão numérica — é uma limitação de fato dos modelos de embedding, não um gap de implementação. Não existe conversão ou adaptador que torne isso compatível.
- **D-15:** `BrainRunner.init()` valida se `IEmbeddingProvider.dimensions` bate com a dimensão esperada pela coluna `vector(N)` do banco e falha rápido com mensagem clara **antes** de aceitar mensagens — evita erro obscuro do Postgres no meio de um atendimento a um lead real.

### Ferramenta de re-embed em lote (decisão adicional, fora do EMBD-01..05 original)

- **D-16:** Por decisão explícita do usuário após a pesquisa confirmar que re-embed é inevitável ao trocar provider/modelo (ver Specific Ideas), a Fase 28 **inclui** uma ferramenta básica de re-embed em lote — endpoint/script que reprocessa embeddings de chunks já existentes em `knowledge_chunks` usando o provider/modelo atualmente configurado, **sem precisar re-subir/re-ingerir os documentos originais** (o texto de cada chunk já está preservado na tabela).
- **D-17 (consequência de D-14):** `search_knowledge` deve evitar misturar vetores de `embedding_model` incompatíveis na mesma busca — caso contrário, resultados de similaridade ficam sem sentido de forma silenciosa. Mecanismo exato (filtro estrito por `embedding_model` atual vs. outro critério) fica em Claude's Discretion.
- **Escopo explicitamente limitado do re-embed tool:** não é o pipeline enterprise-grade de zero-downtime (shadow index + recalibração de threshold + arquitetura event-driven) descrito na pesquisa — é uma ferramenta básica de reprocessamento em lote. O padrão industry-grade completo fica registrado em Deferred Ideas.

### Claude's Discretion

- Nome e path exatos do endpoint/script de re-embed (ex: `POST /api/v1/reindex` vs script CLI standalone).
- Mecanismo exato de filtro por `embedding_model` no `search_knowledge` (exclusão estrita vs. warning + inclusão).
- Estrutura interna do `packages/embeddings` (nomes de arquivo, exports) — desde que `IEmbeddingProvider`, `OpenAIEmbeddingProvider` e `GeminiEmbeddingProvider` sejam exportados.
- Mensagem exata de erro de `BrainRunner.init()` no caso de mismatch de dimensão (D-15).
- Se o re-embed tool processa em lote todo o `knowledge_chunks` de uma vez ou em batches paginados — decisão de implementação, não afeta o resultado esperado pelo usuário.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e histórico do tech debt
- `.planning/REQUIREMENTS.md` §Embedding SDK (EMBD-01 a EMBD-05) — critérios de aceitação oficiais
- `.planning/STATE.md` §Tech Debt — D-16 (vector hardcoded) e MEM-03 (semantic write path) com contexto original
- `.planning/ROADMAP.md` §Phase 28 — goal e success criteria da fase

### Código de embedding existente (a ser extraído/substituído)
- `packages/ai/src/embeddings/factory.ts` — `createEmbeddings()`, lógica atual de resolução de provider/modelo/dimensões a ser migrada para `packages/embeddings`
- `packages/ai/src/llm/factory.ts` — `createLLM()`, padrão de factory a espelhar (ConfigurationError fail-fast, dynamic import por provider, retorno de tipo LangChain)

### Callers a migrar para `IEmbeddingProvider`
- `packages/core/src/tools/search-knowledge.ts` — usa `createEmbeddings().embedQuery()`, precisa receber `IEmbeddingProvider` injetado
- `packages/core/src/rag/ingest.ts` — usa `createEmbeddings().embedDocuments()`, mesma mudança

### Schema e migration (D-16)
- `packages/database/src/schema/tables.ts` — `EMBEDDING_DIM` já lido de `EMBEDDING_DIMENSIONS` via ENV; tabelas `embeddings` e `knowledgeChunks` compartilham a mesma constante
- `packages/database/src/migrations/0007_v1_4_foundation.sql` — migration com `vector(1536)` hardcoded, não editar
- `packages/database/src/migrations/meta/_journal.json` — journal a atualizar com a nova migration `0009`
- `packages/database/src/migrate.ts` — `runMigrations()`, chamado por `BrainRunner.init()` com advisory lock

### BrainRunner — pontos de integração (EMBD-05)
- `packages/core/src/runner/runner.ts` linha ~296 — `getContext()` chamado com `queryVector` vazio
- `packages/core/src/runner/runner.ts` linhas ~377-385 — `saveContext()` sem campo `embedding`
- `packages/core/src/runner/runner.ts` linhas ~103-105, ~155-163 — padrão de DI usado para `eventPublisher?: IEventPublisher` (injeção opcional via constructor + fallback via ENV no `init()`) a espelhar para `embeddingProvider?: IEmbeddingProvider`
- `packages/memory/src/manager.ts` linhas ~84-86 — `upsertEmbedding()`, nunca disparado hoje pelo BrainRunner

### Re-embed tool (novo — D-16/D-17)
- `packages/database/src/schema/tables.ts` — tabela `knowledgeChunks` (campos `embedding_model`, `chunk_index`, `total_chunks`, texto do chunk preservado)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createLLM()` em `packages/ai/src/llm/factory.ts` — padrão de factory function a espelhar para `IEmbeddingProvider` (única ressalva: `createLLM` retorna tipo LangChain direto; `IEmbeddingProvider` será uma interface própria do projeto, algo novo).
- `resolveEmbeddingModel()` (hoje inline em `packages/ai/src/embeddings/factory.ts`) — lógica de mapeamento capability-aware (Gemini → Gemini, resto → OpenAI) a formalizar em `EMBEDDING_PROVIDER`.
- Padrão de DI opcional com fallback ENV do `IEventPublisher` em `BrainRunnerOptions` — mesmo shape para `embeddingProvider?`.
- `knowledge_chunks.embedding_model` (RAG-04) — metadado já existe, resolve boa parte da rastreabilidade necessária pro re-embed tool e pro filtro do `search_knowledge`.

### Established Patterns
- Nenhuma lib de validação de ENV (Zod etc.) — leitura direta de `process.env.X`, com dois estilos: throw em `ConfigurationError` para obrigatórios ausentes, ou validação de range com `Error` simples (como já faz `EMBEDDING_DIM` em `tables.ts`).
- Migrations Drizzle são SQL estático gerado uma vez — nunca leem ENV em runtime; qualquer mudança de dimensão exige gerar nova migration.
- Fallback gracioso é o padrão de resiliência do projeto (MCP ausente, `IEventPublisher` fire-and-forget) — D-10 e D-15 seguem essa mesma filosofia.

### Integration Points
- `BrainRunner._compileGraph()`/`init()` — onde `embeddingProvider` deve ser resolvido (injetado ou construído a partir da ENV), mesmo local onde `eventPublisher` é montado hoje.
- `search-knowledge.ts` e `rag/ingest.ts` precisam de `IEmbeddingProvider` passado via contexto/factory, substituindo a chamada direta a `createEmbeddings()`.

</code_context>

<specifics>
## Specific Ideas

- **Cenário concreto levantado pelo usuário:** Brain processa base de conhecimento usando Gemini (Google), depois troca para GPT (OpenAI) — usuário quer garantir que isso não quebra nem perde o material já processado.
- **Pesquisa feita durante a discussão (WebSearch) confirmou:**
  - Vetores de modelos/providers diferentes não são comparáveis entre si, mesmo com dimensão igual — é limitação de fato dos modelos, não implementação. Fonte: [Embeddings | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/embeddings), [A Guide to Embeddings and pgvector](https://dev.to/googleai/a-guide-to-embeddings-and-pgvector-df0), [Drift-Adapter arXiv paper](https://arxiv.org/pdf/2509.23471).
  - Padrão de mercado para lidar com isso: versionamento do modelo por vetor (já temos via `embedding_model`), batch re-embed ao trocar de modelo, e abordagem blue-green (vetores antigos e novos coexistindo durante a transição). Fonte: [RAG Series – Embedding Versioning with pgvector](https://www.dbi-services.com/blog/rag-series-embedding-versioning-with-pgvector-why-event-driven-architecture-is-a-precondition-to-ai-data-workflows/).
  - Isso levou à decisão D-16: incluir uma ferramenta básica de re-embed em lote nesta fase (não o pipeline enterprise-grade completo).
- Nenhuma outra referência específica ou exemplo visual foi levantado — discussão foi inteiramente sobre comportamento/arquitetura de backend.

</specifics>

<deferred>
## Deferred Ideas

- **Pipeline enterprise-grade de zero-downtime para troca de modelo** (shadow index + recalibração de threshold de similaridade + arquitetura event-driven, conforme padrão do paper Drift-Adapter) — a Fase 28 entrega só uma ferramenta básica de re-embed em lote (D-16). O padrão completo é overkill para o estágio atual do produto (sem clientes reais em produção ainda) — reavaliar se/quando o RAG tiver volume real de dados e clientes ativos.
- **Múltiplos adapters de embedding além de OpenAI/Gemini** (Cohere, local) — já listado como Out of Scope em `REQUIREMENTS.md` para v1.5; não revisitado nesta discussão.
- **Dimensões independentes por tabela** (`embeddings` vs `knowledgeChunks` com `EMBEDDING_DIM` diferentes) — identificado pelo scout como limitação atual (as duas tabelas compartilham a mesma constante módulo), relevante para SUP-04 na Fase 29 (Brain Suporte com config independente do SDR). Como cada Brain roda em banco próprio por cliente, na prática não é bloqueio agora — mas fica anotado para reavaliar na Fase 29 se necessário.

### Reviewed Todos (not folded)

Nenhum todo pendente foi encontrado relacionado a esta fase (`todo match-phase 28` retornou 0 matches).

</deferred>

---

*Phase: 28-embedding-sdk*
*Context gathered: 2026-06-30*
