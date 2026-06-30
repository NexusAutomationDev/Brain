# Requirements: Brain Core v1.5

**Defined:** 2026-06-29
**Core Value:** Infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base

## v1.5 Requirements

### Tech Debt

- [ ] **TECH-01**: Developer pode controlar tools bound em `buildGraph()` via `BRAIN_TOOLS` whitelist (fix TD-03)
- [ ] **TECH-02**: Existe teste de integração E2E do FUP rodando contra banco PostgreSQL real (fix FUP-02)
- [ ] **TECH-03**: `GET /health` retorna status do transport (conectado/desconectado) junto com health geral (fix OBS-02)

### Embedding SDK

- [ ] **EMBD-01**: Developer implementa `IEmbeddingProvider` para qualquer provider (interface: `embed(texts): Promise<number[][]>`, `dimensions: number`, `providerName: string`)
- [ ] **EMBD-02**: `OpenAIEmbeddingProvider` disponível como adapter padrão em `packages/embeddings`
- [ ] **EMBD-03**: Migration cria coluna `vector(N)` com N lido da ENV `EMBEDDING_DIMENSIONS` em runtime (fix D-16)
- [ ] **EMBD-04**: Brain configura provider, modelo e dimensões via ENV sem alterar código TypeScript
- [ ] **EMBD-05**: `BrainRunner` conecta semantic write path (`createEmbeddings`) ao `IEmbeddingProvider` (fix MEM-03)

### Brain Suporte

- [ ] **SUP-01**: Brain Suporte recebe mensagens via webhook e RabbitMQ configurável por ENV (mesma interface do SDR)
- [ ] **SUP-02**: `search_knowledge` tool sempre ativa no grafo (RAG obrigatório — sem flag, sem ENV)
- [ ] **SUP-03**: Tools do grafo (qualify, pause_session, finish_conversation) carregadas via MCP dinâmico, sem hardcode em `buildGraph()`
- [ ] **SUP-04**: Brain Suporte usa `IEmbeddingProvider` com provider/modelo/dimensões configuráveis independentemente do SDR
- [ ] **SUP-05**: Brain Suporte retorna `BrainOutput` estruturado (`fullResponse`, `responseMode`) validado pelo SDK
- [ ] **SUP-06**: `Dockerfile` multi-stage independente e funcional para `apps/brain-support`
- [ ] **SUP-07**: Gate `ia_ativada` + histórico de conversa persistente por lead via `PostgresSaver` (thread_id = lead.uniqueId)
- [ ] **SUP-08**: Brain Suporte registrado no `ToolsRegistry` com tipo `"support"`

## Future Requirements

### Outros Brains

- **BRAIN-01**: Brain Customer Success (apps/brain-cs)
- **BRAIN-02**: Brain Cobrança (apps/brain-cobranca)

### Infraestrutura

- **INFRA-01**: CI/CD — build + publish imagem Docker via DockGate (Phase 18 backlog carry-over)
- **INFRA-02**: responseMode dinâmico via structured output multi-provider (OpenAI + Google)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Sub-agente de qualificação avançada (SPIN/BANT completo) | Simplificado para v1.1; deferido para milestone posterior |
| Brain SDR publicando respostas ao RabbitMQ (canal async) | Backlog de produto; não bloqueia v1.5 |
| Mecanismo de licenciamento (LICENSE_KEY) | Infraestrutura futura |
| UI de gerenciamento de Brains | Futuro |
| FUP para Brain Suporte | Brain Suporte é síncrono; FUP é conceito SDR |
| Múltiplos adapters de embedding (Cohere, local) | OpenAI suficiente para v1.5; interface extensível garante futuro |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TECH-01 | Phase 27 | Pending |
| TECH-02 | Phase 27 | Pending |
| TECH-03 | Phase 27 | Pending |
| EMBD-01 | Phase 28 | Pending |
| EMBD-02 | Phase 28 | Pending |
| EMBD-03 | Phase 28 | Pending |
| EMBD-04 | Phase 28 | Pending |
| EMBD-05 | Phase 28 | Pending |
| SUP-01 | Phase 29 | Pending |
| SUP-02 | Phase 29 | Pending |
| SUP-03 | Phase 29 | Pending |
| SUP-04 | Phase 29 | Pending |
| SUP-05 | Phase 29 | Pending |
| SUP-06 | Phase 30 | Pending |
| SUP-07 | Phase 29 | Pending |
| SUP-08 | Phase 29 | Pending |

**Coverage:**
- v1.5 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-29*
*Last updated: 2026-06-29 after roadmap creation (phases 27-30)*
