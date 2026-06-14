# Phase 8: BrainRunner + Conversation History - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 entrega histórico de conversa funcional e controlado:
1. Confirma e testa que `thread_id = lead.uniqueId` (HIST-01) — código já implementado como WR-02 em Phase 7
2. Verifica via integration test que o histórico persiste entre chamadas ao mesmo IDLead (HIST-02)
3. Implementa janela de contexto enviada ao LLM: PostgresSaver guarda o histórico completo, BrainRunner lê apenas as últimas N mensagens do checkpoint antes de invocar o graph (HIST-03)

Esta fase não implementa o Brain SDR (Phase 9) nem memória semântica (pós v1.1).

</domain>

<decisions>
## Implementation Decisions

### Janela de Contexto (HIST-03)

- **D-01:** PostgresSaver guarda o **histórico completo** — sem trim no checkpoint. O banco mantém todas as mensagens da conversa (necessário para SDR-05 no Phase 9 que lê o histórico completo).
- **D-02:** Antes de invocar o graph, BrainRunner lê o checkpoint via `compiledGraph.getState({ configurable: { thread_id: threadId } })` e extrai as últimas `CONTEXT_WINDOW_MESSAGES` mensagens.
- **D-03:** Apenas essas mensagens são passadas como contexto ao LLM na chamada `invoke()`. O PostgresSaver então acumula a nova mensagem ao histórico completo.
- **D-04:** ENV: `CONTEXT_WINDOW_MESSAGES=40` — padrão 40 mensagens (20 turnos humano + IA). Configurável por cliente.
- **D-05:** Onde aplicar: **pre-invoke no BrainRunner.run()** — ler checkpoint, slicear mensagens, passar janela ao invoke. Não usa trimMessages como reducer do state graph (pois isso removeria mensagens do checkpoint).

### Verificação de HIST-01

- **D-06:** Integration test atualizado para confirmar explicitamente que `thread_id = event.IDLead` (via lead.uniqueId), não `event.Numero`. Assert verifica que duas chamadas com mesmo IDLead mas Numeros diferentes compartilham o mesmo thread (se o IDLead for o mesmo).
- **D-07:** Remover comentário `// Phase 8: substituir por lead.unique_id` do integration test e substituir por assert verificável.

### Verificação de HIST-02

- **D-08:** Integration test demonstra recuperação de histórico via mesmo runner: primeira chamada com mensagem X, segunda chamada com mesmo IDLead — graph do test demonstra que tem acesso ao estado anterior (via checkpoint do PostgresSaver).
- **D-09:** Teste usa mesmo BrainRunner instance para ambas as chamadas. O PostgresSaver carrega o checkpoint automaticamente ao fazer invoke com o mesmo `thread_id`.

### Claude's Discretion

- Implementação exata de como ler o checkpoint (`getState()` vs outro mecanismo do LangGraph)
- Fallback quando `CONTEXT_WINDOW_MESSAGES` não está no ENV (usar padrão 40 sem falhar)
- Estrutura exata do assertion de HIST-01 no integration test

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fase e Requirements

- `.planning/ROADMAP.md` §Phase 8 — Goal, success criteria, requirements HIST-01, HIST-02, HIST-03
- `.planning/REQUIREMENTS.md` §Histórico de Conversas — definição formal de HIST-01, HIST-02, HIST-03

### Código existente a modificar

- `packages/core/src/runner/runner.ts` — BrainRunner.run(): onde `threadId = lead.uniqueId` já existe (linha ~171) e onde a janela de contexto deve ser aplicada antes do invoke
- `packages/core/src/runner/__tests__/brain-runner.integration.test.ts` — integration test com comentário `// Phase 8: substituir por lead.unique_id` a ser atualizado (linha ~101)

### Contexto de fases anteriores (decisões que afetam esta fase)

- `.planning/phases/07-leadservice-rabbitmq-transport/07-CONTEXT.md` — D-06 (threadId = lead.uniqueId já implementado como WR-02)
- `.planning/phases/06-leads-schema-migration/06-CONTEXT.md` — D-02 (unique_id = IDLead do payload = thread_id para PostgresSaver)

### Infraestrutura de checkpointing (referência para getState())

- `packages/ai/src/graph/checkpointer.ts` — createCheckpointer() + PostgresSaver setup
- `packages/ai/src/graph/checkpointer.test.ts` — testes existentes do checkpointer (incluindo SC-1: persistência entre invocações)

### Convenções

- `CLAUDE.md` — constraints de runtime (Bun), convenções de teste, paths, estrutura de testes em `__tests__/`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/core/src/runner/runner.ts` linha 171: `const threadId = lead.uniqueId;` — HIST-01 já implementado, não reescrever
- `compiledGraph.getState({ configurable: { thread_id: threadId } })` — API do LangGraph para ler o checkpoint atual antes do invoke (disponível em CompiledGraph)
- `packages/ai/src/graph/checkpointer.ts`: `PostgresSaver.fromConnString()` + `setup()` — checkpointer já configurado e passado ao `compile({ checkpointer })`
- `@langchain/core/messages`: `trimMessages` utility disponível — mas nesta fase é usado conceitualmente (slicear array de mensagens do checkpoint, não necessariamente chamar trimMessages)

### Established Patterns

- BrainRunner._compileGraph(): `this.compiledGraph = this.brain.buildGraph(ctx).compile({ checkpointer })` — checkpointer já injetado, getState() disponível
- Integration test pattern em `brain-runner.integration.test.ts`: `describeOrSkip` com `TEST_DB_URL` — manter padrão de skip gracioso quando DB indisponível
- ENV pattern: `process.env.X ?? defaultValue` sem process.exit(1) para ENVs opcionais com padrão sensato

### Integration Points

- `BrainRunner.run()`: ponto de modificação — adicionar leitura de checkpoint e slicear mensagens ANTES da chamada invoke()
- `.env.example` em `apps/brain-echo` e apps futuros: adicionar `CONTEXT_WINDOW_MESSAGES=40`
- Integration test: mesmo arquivo, atualizar o teste existente e adicionar assertion de HIST-01

</code_context>

<specifics>
## Specific Ideas

- **Decisão crítica de semântica**: o usuário NÃO quer limitar o histórico armazenado — quer guardar tudo, mas controlar o que vai ao LLM. PostgresSaver = storage ilimitado; `CONTEXT_WINDOW_MESSAGES` = janela de contexto para o LLM apenas.
- **Por que pre-invoke e não reducer**: se trimMessages fosse reducer no state graph, removeria mensagens do checkpoint — perdendo o histórico completo que Phase 9 (SDR-05) precisa para análise do sub-agente.
- **Sequência no run()**: upsert lead → gate ia_ativada → `getState(thread_id)` → slice últimas 40 msgs → invoke(sliced msgs) → extract reply → saveContext.

</specifics>

<deferred>
## Deferred Ideas

- Token-based context window (vs message count) — pode ser avaliado em v1.2 quando modelos com preços diferentes forem usados
- Dois BrainRunners separados testando persistência entre restarts — mais realista mas complexidade extra sem valor adicional em v1.1
- Exposição do histórico completo via API (ex: GET /history/:leadId) — Phase 9+ quando necessário para o dashboard

</deferred>

---

*Phase: 08-brainrunner-conversation-history*
*Context gathered: 2026-06-14*
