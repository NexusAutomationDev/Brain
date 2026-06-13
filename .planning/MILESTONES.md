# Milestones

## v1.0 MVP (Shipped: 2026-06-13)

**Phases completed:** 4 phases, 28 plans, ~234 commits
**Timeline:** 2026-05-21 → 2026-06-13 (23 days)
**TypeScript LOC:** ~7.094

**Key accomplishments:**

1. Monorepo scaffold (pnpm workspaces + Turborepo) com base PostgreSQL + PGVector — schema de 4 tabelas (`users`, `memories`, `agent_state`, `embeddings`), TenantPoolManager LRU (max 20 tenants), migrations versionadas via drizzle-kit
2. Pacotes de domínio completos: memory 3-layer (long-term Drizzle, short-term PostgresSaver, semantic pgvector), AI/LangGraph com PostgresSaver como único checkpointer, transport webhook idempotente (DedupCache + BrainEvent Zod), Langfuse observability via callbacks condicionais
3. Brain SDK: IBrain interface + BrainBuildContext, BrainRunner lifecycle (init→run→refreshPrompts), ToolsRegistry com whitelist por tipo de Brain, prompts armazenados no banco de dados (tabela `prompts`, zero prompts hardcoded)
4. EchoBrain Docker image (419MB, multi-stage Bun) valida contrato completo end-to-end: POST /webhook → BrainRunner → LangGraph → PostgresSaver → reply (SC-2 verificado com LLM real); estado LangGraph persiste após `docker restart` (SC-3 verificado com MARKER_BRAINCORE_42)

### Known Gaps

Tech debt aceito e documentado no audit `v1.0-MILESTONE-AUDIT.md`:

- **MEM-03**: BrainRunner.run() nunca gera embeddings — `createEmbeddings()` é exportado mas nunca chamado; caminho de escrita semântica é dead code em v1. Deferido para v2.
- **OBS-02**: GET /health sem campo `transport` no status. Deferido per decisão D-15 (Phase 1); Phase 2 transport completo mas campo nunca foi adicionado. Deferido para v2.

---
