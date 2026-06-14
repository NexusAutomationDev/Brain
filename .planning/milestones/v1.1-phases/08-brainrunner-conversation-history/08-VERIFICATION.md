---
phase: 08-brainrunner-conversation-history
verified: 2026-06-14T18:45:00Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
human_verification:
  - test: "Executar integration tests com banco PostgreSQL real: TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts"
    expected: "Todos os três testes (HIST-00, HIST-01, HIST-02) passam — em particular, HIST-01 confirma que msgCount2 > 1 quando Numeros são diferentes mas IDLead é o mesmo, e HIST-02 confirma que msgCount2 > msgCount1 entre chamadas consecutivas"
    why_human: "Os integration tests requerem um PostgreSQL real com a tabela `leads`, prompts e o PostgresSaver configurado. Não é possível verificar programaticamente sem a infra de banco."
  - test: "Enviar duas mensagens via transport (webhook ou RabbitMQ) com mesmo IDLead mas Numeros diferentes e verificar que a segunda resposta reflete contexto da primeira"
    expected: "Segunda mensagem do lead tem acesso ao contexto da primeira — o Brain responde levando em conta o histórico completo"
    why_human: "Comportamento de usuário real com PostgresSaver ativo em produção não pode ser verificado com grep ou bun test isolado."
---

# Phase 8: BrainRunner + Conversation History Verification Report

**Phase Goal:** Cada lead tem histórico de conversa persistente vinculado ao seu `unique_id` como `thread_id`, recuperado automaticamente entre sessões, com janela de contexto controlada
**Verified:** 2026-06-14T18:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `BrainRunner.run()` deriva `thread_id = lead.unique_id` após lookup no DB — nunca usa `IDLead` direto do payload como thread_id | VERIFIED | `runner.ts:155-171`: `leadService.upsertLead()` retorna `lead`, depois `const threadId = lead.uniqueId` (linha 171). `IDLead` do payload jamais é usado diretamente como thread_id. |
| 2 | Lead que retorna após dias tem histórico completo de conversa anterior recuperado pelo PostgresSaver automaticamente | VERIFIED (automated partial) | `runner.ts:181-182`: `getState({ configurable: { thread_id: threadId } })` recupera o checkpoint. HIST-02 integration test verifica acumulação via `msgCount2 > msgCount1`. Execução real requer banco — ver human_verification. |
| 3 | Conversas longas não causam overflow — contexto enviado ao LLM é limitado pelo `CONTEXT_WINDOW_MESSAGES` ENV sem perder histórico armazenado | VERIFIED | `brain.ts:28-36`: `state.messages.slice(-contextWindowSize)` antes de `ctx.llm.invoke()`. Runner lê `getState()` para logging. `isFinite` + `> 0` previne NaN. `.env.example` documenta `CONTEXT_WINDOW_MESSAGES=40`. |

**Score:** 3/3 truths verified (automated); human verification pendente para SC-2 end-to-end

**Nota sobre HIST-03 / "trimMessages":** O REQUIREMENTS.md usa a expressão "trimMessages ativo" mas o ROADMAP SC-3 e o RESEARCH.md (linha 65, 93-94) explicitamente descartam o uso de `trimMessages` do LangGraph como reducer (destruiria o histórico do checkpoint) e adotam `Array.slice(-N)` como abordagem equivalente para contagem de mensagens. A implementação atende o intent do requisito com abordagem mais simples e correta para este contexto.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/runner/__tests__/brain-runner.integration.test.ts` | Integration tests HIST-01 e HIST-02 com asserts verificáveis | VERIFIED | Contém HIST-00, HIST-01 e HIST-02. `historyAwareBrain` encoda `msgCount` na reply. Comentário legado `// Phase 8: substituir por lead.unique_id` removido. Cleanup via `inArray` para 4 números de telefone de teste. |
| `packages/core/src/runner/runner.ts` | getState() pre-invoke com log do context window | VERIFIED | Linhas 173-193: `contextWindowSize` calculado com fallback seguro, `getState()` chamado, `historicalMessages` extraído via `snapshot?.values?.messages ?? []`, logging estruturado com `historicalCount`, `contextWindow`, `willTruncate`. |
| `packages/core/src/runner/__tests__/brain-runner.test.ts` | Unit tests para context window (HIST-03) | VERIFIED | 4 testes no `describe("HIST-03")`: fallback 40, ENV=10, ENV inválida ('abc'), getState chamado com thread_id correto ('lead-abc'). `getState` mock no `makeBrain`. 12 testes passam. |
| `apps/brain-echo/src/brain.ts` | Nó do grafo com slice de contexto antes de invocar o LLM | VERIFIED | Linhas 28-36: `contextWindowSize` com IIFE + `isFinite`, `messagesForLLM = state.messages.slice(-contextWindowSize)`, LLM invocado com `[systemMsg, ...messagesForLLM]`. SystemMessage construído inline (fora do slice). |
| `apps/brain-echo/src/__tests__/unit/brain.test.ts` | Unit tests para comportamento de slice no nó do brain-echo | VERIFIED | 4 testes HIST-03: slice-limit direto, passthrough quando < N, fallback T-08-ENV (undefined/abc/-5/0/10/40), teste do nó com node handler direto + fallback de slice. 10 testes passam. |
| `apps/brain-echo/.env.example` | Variável `CONTEXT_WINDOW_MESSAGES` documentada | VERIFIED | Linha 40: `CONTEXT_WINDOW_MESSAGES=40` com bloco de comentário explicativo 4 linhas (`# --- Histórico de Conversa ---`). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `brain-runner.integration.test.ts` | `BrainRunner.run()` | `runner.run(event)` com `IDLead='lead-hist-001'` | WIRED | Linhas 180/185: `runner.run(event1)` e `runner.run(event2)` com mesmo IDLead e Numeros diferentes |
| `brain-runner.integration.test.ts` | PostgresSaver checkpoint | segundo `run()` com mesmo IDLead acumula messages via `msgCount` | WIRED | Linha 191: `expect(msgCount2).toBeGreaterThan(1)` e linha 226: `expect(msgCount2).toBeGreaterThan(msgCount1)` |
| `packages/core/src/runner/runner.ts` | `compiledGraph.getState()` | `await this.compiledGraph.getState({ configurable: { thread_id: threadId } })` | WIRED | Linhas 181-184: chamada real com `threadId = lead.uniqueId` |
| `apps/brain-echo/src/brain.ts` | `state.messages` via `slice(-contextWindowSize)` | `messagesForLLM` passado ao `ctx.llm.invoke()` | WIRED | Linha 32: `const messagesForLLM = state.messages.slice(-contextWindowSize)`, linha 34-37: `ctx.llm.invoke([systemMsg, ...messagesForLLM])` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `runner.ts: run()` | `historicalMessages` | `this.compiledGraph.getState()` → PostgresSaver | Yes — lê checkpoint real do PostgresSaver (produção) ou MemorySaver (testes) | FLOWING |
| `brain.ts: nó "llm"` | `messagesForLLM` | `state.messages.slice(-N)` — estado injetado pelo LangGraph via checkpoint | Yes — `state.messages` é o histórico acumulado pelo `messagesStateReducer` a cada turno | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit tests brain-runner.test.ts passam | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | 12 pass, 0 fail | PASS |
| Unit tests brain.test.ts passam | `bun test apps/brain-echo/src/__tests__/unit/brain.test.ts` | 10 pass, 0 fail | PASS |
| Legacy comment removido | `grep "Phase 8: substituir" brain-runner.integration.test.ts` | empty output | PASS |
| runner.ts compila sem erros | `bun build packages/core/src/runner/runner.ts --target bun` | 1492 modules, runner.js 4.40 MB | PASS |
| brain.ts compila sem erros | `bun build apps/brain-echo/src/brain.ts --target bun` | 1367 modules, brain.js 4.12 MB | PASS |
| Integration tests (requer DB) | `TEST_DB_URL=<url> bun test brain-runner.integration.test.ts` | Não executável sem banco | SKIP |
| Commits documentados existem | `git log --oneline` | `4452bd5`, `407b34b`, `c559b23` — todos encontrados | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| HIST-01 | Plan 01 | `thread_id = lead.unique_id` — conversa vinculada ao lead via PostgresSaver | SATISFIED (automated) | `runner.ts:171` deriva `threadId = lead.uniqueId`. Integration test HIST-01 verifica com 2 Numeros diferentes + mesmo IDLead. |
| HIST-02 | Plan 01 | Histórico completo persistido entre sessões | SATISFIED (automated) | Integration test HIST-02 verifica `msgCount2 > msgCount1`. Requer banco para execução real. |
| HIST-03 | Plan 02 | Limite de mensagens no contexto configurável via ENV | SATISFIED | `state.messages.slice(-N)` em `brain.ts`, `getState()` + logging em `runner.ts`, `CONTEXT_WINDOW_MESSAGES=40` em `.env.example`, 8 unit tests verificam comportamento. |

Todos os 3 requisitos mapeados para Phase 8 têm implementação e testes verificáveis.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/brain-echo/src/__tests__/unit/brain.test.ts` | 4-6 | `test("placeholder: arquivo existe e é parseável", ...)` — `expect(true).toBe(true)` | Info | Teste pré-existente da fase anterior. Não bloqueia — outros 9 testes no mesmo arquivo têm asserts reais. Não removido nesta fase (fora de escopo). |
| `apps/brain-echo/src/__tests__/unit/brain.test.ts` | 135-149 | Fallback de slice direto no teste do nó — `if (nodeHandler)` com else usando slice simples | Warning | O teste real do comportamento do nó depende de acesso ao handler interno do StateGraph via `graph.nodes?.["llm"]?.action ?? graph._nodes?.["llm"]?.runnable?.func`. Se a API interna do LangGraph mudar, o teste cai no fallback simples. Integration tests cobrem o comportamento real. |

Nenhum anti-pattern bloqueador encontrado. O `return null` em `runner.ts:165` é o gate `ia_ativada` esperado (LEAD-03), não um stub.

### Human Verification Required

#### 1. Integration Tests com PostgreSQL Real

**Test:** Configurar `TEST_DB_URL` apontando para um banco PostgreSQL com schema Brain e executar:
```
TEST_DB_URL=postgresql://user:pass@localhost:5432/brain_test bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts
```
**Expected:** Todos os 3 testes passam (HIST-00, HIST-01, HIST-02). Em especial:
- HIST-01: `msgCount2 > 1` — segundo evento com Numero diferente mas mesmo IDLead herda checkpoint
- HIST-02: `msgCount2 > msgCount1` — histórico acumula entre chamadas consecutivas
**Why human:** Integration tests requerem PostgreSQL real com PostgresSaver, tabela `leads`, tabela `prompts` e schema de migrations aplicado. Não executável programaticamente sem infraestrutura de banco.

#### 2. Comportamento End-to-End com Lead Real

**Test:** Enviar duas mensagens sequenciais via webhook com o mesmo IDLead mas Numeros de telefone diferentes, usando um Brain rodando contra banco real.
**Expected:** A segunda resposta do Brain reflete contexto da primeira conversa — PostgresSaver recuperou o histórico vinculado ao `lead.uniqueId`.
**Why human:** Verificação de comportamento em tempo de execução com infra real (PostgreSQL + LLM). Não verificável programaticamente sem deploy completo.

### Gaps Summary

Nenhuma lacuna bloqueadora identificada. Toda a implementação está presente, substantiva e corretamente conectada:

- `runner.ts` deriva `threadId = lead.uniqueId` via DB lookup (HIST-01 — SC-1)
- `runner.ts` chama `getState()` pré-invoke para auditoria (HIST-03)
- `brain.ts` usa `state.messages.slice(-N)` no nó LLM para limitar contexto (HIST-03 — SC-3)
- Integration tests cobrem HIST-01 e HIST-02 com asserts verificáveis via `msgCount` encoding
- Unit tests (12 em brain-runner.test.ts + 10 em brain.test.ts) passam com 0 falhas
- `.env.example` documenta `CONTEXT_WINDOW_MESSAGES=40`
- Commits `4452bd5`, `407b34b`, `c559b23` confirmados no histórico git

O status `human_needed` reflete que os integration tests (HIST-01, HIST-02) requerem um PostgreSQL real para validação final — não foi possível executá-los nesta sessão.

---

_Verified: 2026-06-14T18:45:00Z_
_Verifier: Claude (gsd-verifier)_
