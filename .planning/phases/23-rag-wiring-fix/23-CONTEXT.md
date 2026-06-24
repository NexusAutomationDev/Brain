# Phase 23: RAG Wiring Fix - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Vincular `createSearchKnowledgeTool` ao LLM em `apps/brain-sdr/src/brain.ts` — fechar o único gap que impede o fluxo RAG end-to-end. O ingest (POST /api/v1/ingest) funciona desde a Phase 21, e a tool está exportada, testada e habilitada no ToolsRegistry (`index.ts:70`), mas nunca foi adicionada ao `bindTools()` nem ao `ToolNode` de `buildGraph()`.

Não inclui: mudanças no core RAG, no ingest endpoint, na lógica de search, ou em outros Brains (brain-echo não tem RAG).

</domain>

<decisions>
## Implementation Decisions

### Wiring em buildGraph()

- **D-01:** `createSearchKnowledgeTool(ctx.sql!)` é instanciada dentro de `buildGraph()` em `apps/brain-sdr/src/brain.ts`, seguindo o padrão de `createPauseSessionTool(ctx.sql!)` e `createFinishConversationTool(ctx.sql!)`. A tool instanciada (`boundSearchKnowledgeTool`) é adicionada tanto ao array de `ctx.llm.bindTools([...])` quanto ao `ToolNode([...])` — mesma posição das outras bound tools.

### Declaração IBrain (sdrBrain.tools[])

- **D-02:** `sdrBrain.tools[]` é atualizado para incluir o schema estático de `search_knowledge` junto com `qualifyLeadTool`. O planner decide como exportar o schema estático (opções: export separado em `packages/core/src/tools/search-knowledge.ts`, ou definição inline local). O objetivo é manter o contrato IBrain completo e auto-documentado, alinhado com o padrão declarativo do campo.
- **D-03:** O teste `"sdrBrain.tools tem exatamente 1 tool: qualify_lead"` em `brain.test.ts` é atualizado para refletir a inclusão de `search_knowledge` (2 tools).

### Estratégia de Teste

- **D-04:** Testes via unit mocks (mocked DB + mocked LLM) — padrão estabelecido em `brain.test.ts` e nos testes de Phase 21 (`packages/core/src/rag/__tests__/`). Não requer banco real nem API keys.
- **D-05:** Novos testes adicionados no `brain.test.ts` existente, dentro do describe `BrainSDR — Standard Tools binding`. Dois asserts:
  1. `search_knowledge` está presente na lista de tools passada ao `bindTools()` (verificado capturando o argumento via mock)
  2. `search_knowledge` está no `ToolNode` do nó `"tools"` do grafo

### Claude's Discretion

- Mecanismo exato para o schema estático de `search_knowledge` em `sdrBrain.tools[]` (export separado vs definição local no brain.ts)
- Detalhes do mock do `ctx.sql` nos novos testes (seguir o padrão `sql: {} as any` do `brain.test.ts` existente)
- Import path de `createSearchKnowledgeTool` (já disponível via `@brain-pkg/core`)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements e Roadmap

- `.planning/REQUIREMENTS.md` §RAG-02, RAG-03 — definições exatas dos requisitos que esta fase fecha
- `.planning/ROADMAP.md` §Phase 23 — Success Criteria: 3 critérios de aceitação

### Auditoria de Gap

- `.planning/v1.4-MILESTONE-AUDIT.md` — evidência do gap: seção "requirements" RAG-02/RAG-03 e seção "integration" Phase 21 → buildGraph(); descreve exatamente o que está faltando

### Arquivo Principal a Modificar

- `apps/brain-sdr/src/brain.ts` — arquivo central da fase; lógica de wiring está em `buildGraph()` (~linha 80–190)

### Padrões a Replicar

- `packages/core/src/tools/search-knowledge.ts` — `createSearchKnowledgeTool(sql)`: factory a ser instanciada em buildGraph(); padrão idêntico ao de `createPauseSessionTool`
- `packages/core/src/tools/pause-session.ts` — `createPauseSessionTool(sql)`: referência de como bound tool com closure é criada e usada no brain
- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — testes existentes; padrão de mock de ctx, bindTools e sql; describe "BrainSDR — Standard Tools binding" é onde adicionar novos asserts

### Context de Phase 21 (decisões carregadas)

- `.planning/phases/21-rag/21-CONTEXT.md` — D-06 (factory pattern), D-12 (enableTool já feito em index.ts:70)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `createSearchKnowledgeTool` — já implementada e exportada de `packages/core/src/tools/search-knowledge.ts`; usa `searchKnowledge` de `packages/core/src/rag/search.ts`; factory com closure sobre `sql`
- `ctx.sql!` — já usado com `!` assertion para `createPauseSessionTool` e `createFinishConversationTool`; seguro para brain-sdr (injetado no construtor do BrainRunner)

### Established Patterns

- **Bound tools em buildGraph():** `const boundX = createXTool(ctx.sql!)` → adicionado ao `bindTools([...])` e ao `ToolNode([...])`
- **Testes de wiring:** mock de `ctx.llm.bindTools` capturando o array de tools; `sql: {} as any` como mock seguro (factory não acessa DB na criação, só na invocação)
- **ToolsRegistry registration:** `enableTool("sdr", "search_knowledge")` já está em `apps/brain-sdr/src/index.ts:70` — nenhuma mudança necessária em index.ts

### Integration Points

- `apps/brain-sdr/src/brain.ts` — único arquivo de código de produção a modificar
- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — adicionar e atualizar testes existentes

</code_context>

<specifics>
## Specific Ideas

- Nenhum requisito de visual ou UX — fase puramente backend/wiring.
- O gap está documentado com precisão no milestone audit; a mudança é pequena e cirúrgica.

</specifics>

<deferred>
## Deferred Ideas

- **fup prompt validation:** `'fup'` ausente de `sdrBrain.promptKeys` (FUP falha silenciosamente se prompt não estiver no banco) — deferred para Phase 24 (Tech Debt & Tracker Cleanup)
- **brain-echo RAG:** brain-echo não tem RAG; ativar `search_knowledge` no brain-echo é out of scope e pertence a futuro milestone
- **Nenhum escopo novo surgiu na discussão**

</deferred>

---

*Phase: 23-rag-wiring-fix*
*Context gathered: 2026-06-24*
