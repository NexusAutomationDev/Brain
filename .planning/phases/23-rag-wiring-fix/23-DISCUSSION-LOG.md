# Phase 23: RAG Wiring Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 23-rag-wiring-fix
**Areas discussed:** Teste de integração E2E, sdrBrain.tools[] static list

---

## Teste de integração E2E

| Option | Description | Selected |
|--------|-------------|----------|
| Mocks (unit com mocked DB + LLM) | Segue o padrão já usado em brain.test.ts: ctx.sql = {} as any, LLM mockado. Verifica que search_knowledge está no bindTools() e no ToolNode. Rápido, sem infra. | ✓ |
| Integration real (pgvector + mocked LLM) | Usa banco real. Ingest real de chunks, busca real no pgvector, LLM mockado. Requer DB na CI. | |
| Apenas wiring test (sem E2E) | Dois testes unitários sem invocar o fluxo completo. | |

**User's choice:** Mocks (unit com mocked DB + LLM)
**Notes:** Padrão estabelecido nas phases anteriores; consistente com os testes de search-knowledge.test.ts da Phase 21.

| Option | Description | Selected |
|--------|-------------|----------|
| brain.test.ts (existente) | Adicionar no describe 'BrainSDR — Standard Tools binding' existente. | ✓ |
| Novo arquivo rag-wiring.test.ts | Criar arquivo dedicado para wiring da tool RAG. | |

**User's choice:** brain.test.ts (existente)
**Notes:** Mantém todos os testes do IBrain em um único arquivo.

---

## sdrBrain.tools[] static list

| Option | Description | Selected |
|--------|-------------|----------|
| Deixar com qualify_lead apenas | search_knowledge já registrada via enableTool(). Não alterar o teste existente. | |
| Adicionar searchKnowledgeTool schema | Torna o contrato IBrain completo. Atualizar o teste para 2 tools. | ✓ |

**User's choice:** Adicionar searchKnowledgeTool schema (Recommended)
**Notes:** Alinha com o padrão declarativo do IBrain. Planner decide o mecanismo de export do schema estático.

---

## Claude's Discretion

- Mecanismo exato para o schema estático de search_knowledge em sdrBrain.tools[]
- Detalhes do mock do ctx.sql nos novos testes
- Import path de createSearchKnowledgeTool

## Deferred Ideas

- fup prompt validation → Phase 24 (Tech Debt & Tracker Cleanup)
- brain-echo RAG → futuro milestone
