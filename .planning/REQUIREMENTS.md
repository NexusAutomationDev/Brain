# Requirements: Brain Core v1.5

**Defined:** 2026-06-29
**Core Value:** Infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base

## v1.5 Requirements

### Tech Debt

- [x] **TECH-01**: Developer pode controlar tools bound em `buildGraph()` via `BRAIN_TOOLS` whitelist (fix TD-03)
- [x] **TECH-02**: Existe teste de integração E2E do FUP rodando contra banco PostgreSQL real (fix FUP-02)
- [x] **TECH-03**: `GET /health` retorna status do transport (conectado/desconectado) junto com health geral (fix OBS-02)
- [ ] **TECH-04**: Fix de docker-compose.yml (porta 3003 para brain-support) está commitado e workflows de CI (`publish-brain-sdr.yml`, `publish-brain-support.yml`) fazem quote/validam saída do `jq` (fix v1.5 audit — integration finding)
- [ ] **TECH-05**: Tool `respond` tem proteção de append-after-filter equivalente a `search_knowledge`; `.env.example` do brain-sdr documenta ENVs de embedding; migration 0009 tem aviso inline sobre `vector(1536)` hardcoded (fix v1.5 audit — pre-client-onboarding items)
- [ ] **TECH-06**: Achados warning/info de code review das fases 27-30 resolvidos e lacunas de documentação/teste (frontmatter, test ordering, test isolation) preenchidas (fix v1.5 audit — tech debt cleanup)

### Embedding SDK

- [x] **EMBD-01**: Developer implementa `IEmbeddingProvider` para qualquer provider (interface: `embed(texts): Promise<number[][]>`, `dimensions: number`, `providerName: string`)
- [x] **EMBD-02**: `OpenAIEmbeddingProvider` disponível como adapter padrão em `packages/embeddings`
- [x] **EMBD-03**: Migration cria coluna `vector(N)` com N lido da ENV `EMBEDDING_DIMENSIONS` em runtime (fix D-16)
- [x] **EMBD-04**: Brain configura provider, modelo e dimensões via ENV sem alterar código TypeScript
- [x] **EMBD-05**: `BrainRunner` conecta semantic write path (`createEmbeddings`) ao `IEmbeddingProvider` (fix MEM-03)

### Brain Suporte

- [x] **SUP-01**: Brain Suporte recebe mensagens via webhook e RabbitMQ configurável por ENV (mesma interface do SDR)
- [x] **SUP-02**: `search_knowledge` tool sempre ativa no grafo (RAG obrigatório — sem flag, sem ENV)
- [x] **SUP-03**: Tools do grafo (qualify, pause_session, finish_conversation) carregadas via MCP dinâmico, sem hardcode em `buildGraph()` (reinterpretado per D-01/D-02: `pause_session`/`finish_conversation` são closures nativas hardcoded, sem `qualify_lead` — desvio confirmado pelo usuário)
- [x] **SUP-04**: Brain Suporte usa `IEmbeddingProvider` com provider/modelo/dimensões configuráveis independentemente do SDR
- [x] **SUP-05**: Brain Suporte retorna `BrainOutput` estruturado (`fullResponse`, `responseMode`) validado pelo SDK
- [x] **SUP-06**: `Dockerfile` multi-stage independente e funcional para `apps/brain-support`
- [x] **SUP-07**: Gate `ia_ativada` + histórico de conversa persistente por lead via `PostgresSaver` (thread_id = lead.uniqueId)
- [x] **SUP-08**: Brain Suporte registrado no `ToolsRegistry` com tipo `"support"`

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
| TECH-01 | Phase 27 | Complete |
| TECH-02 | Phase 27 | Complete |
| TECH-03 | Phase 27 | Complete |
| EMBD-01 | Phase 28 | Complete |
| EMBD-02 | Phase 28 | Complete |
| EMBD-03 | Phase 28 | Complete (override — see 28-VERIFICATION.md) |
| EMBD-04 | Phase 28 | Complete |
| EMBD-05 | Phase 28 | Complete |
| SUP-01 | Phase 29 | Complete |
| SUP-02 | Phase 29 | Complete |
| SUP-03 | Phase 29 | Complete (override — see 29-VERIFICATION.md D-01/D-02) |
| SUP-04 | Phase 29 | Complete |
| SUP-05 | Phase 29 | Complete |
| SUP-06 | Phase 30 | Complete |
| SUP-07 | Phase 29 | Complete |
| SUP-08 | Phase 29 | Complete |
| TECH-04 | Phase 31 | Pending |
| TECH-05 | Phase 31 | Pending |
| TECH-06 | Phase 32 | Pending |

**Coverage:**
- v1.5 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-29*
*Last updated: 2026-07-01 after gap closure phase creation (phases 31-32, from v1.5 audit tech debt)*
