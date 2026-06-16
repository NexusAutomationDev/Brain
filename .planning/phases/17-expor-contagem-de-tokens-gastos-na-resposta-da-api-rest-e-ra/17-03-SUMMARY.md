---
phase: 17-expor-contagem-de-tokens-gastos-na-resposta-da-api-rest-e-ra
plan: "03"
subsystem: apps/brain-sdr, apps/brain-echo, packages/transport
tags: [token-usage, langgraph, brain-sdr, brain-echo, wave3, bug-fix]
dependency_graph:
  requires:
    - TokenUsage type in @brain-pkg/shared (Wave 1)
    - extractTokenUsage() helper in @brain-pkg/ai (Wave 1)
    - BrainStateAnnotation.tokenUsage with sum reducer (Wave 1)
    - BrainRunner.run() returns { brainOutput, tokenUsage } wrapper (Wave 2)
    - IBrainRunnerLike { brainOutput, tokenUsage } contract (Wave 2)
  provides:
    - brain-sdr llm node emits tokenUsage delta per LLM call
    - brain-echo llm node emits tokenUsage delta per LLM call
    - webhook-auth test updated to Wave 2 IBrainRunnerLike contract
  affects:
    - apps/brain-sdr/src/brain.ts
    - apps/brain-echo/src/brain.ts
    - packages/transport/src/__tests__/unit/webhook-auth.test.ts
tech_stack:
  added: []
  patterns:
    - extractTokenUsage() in llm node return delta (D-07)
    - ReAct multi-step tokenUsage accumulation via BrainStateAnnotation sum reducer
    - Anti-pattern enforced: ToolNode does NOT call extractTokenUsage (ToolMessage has no usage_metadata)
key_files:
  created: []
  modified:
    - apps/brain-sdr/src/brain.ts
    - apps/brain-echo/src/brain.ts
    - packages/transport/src/__tests__/unit/webhook-auth.test.ts
    - packages/transport/src/webhook/handler.ts (restored Wave 2 state)
    - packages/transport/src/webhook/handler.test.ts (restored Wave 2 state)
    - packages/transport/src/rabbitmq/consumer.ts (restored Wave 2 state)
    - packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts (restored Wave 2 state)
    - packages/core/src/runner/runner.ts (restored Wave 2 state)
    - packages/core/src/runner/__tests__/brain-runner.test.ts (restored Wave 2 state)
decisions:
  - "extractTokenUsage() adicionado SOMENTE ao nó llm — ToolNode não recebe AIMessage com usage_metadata (anti-pattern documentado em RESEARCH.md)"
  - "brain-echo: single LLM call, tokenUsage final = estado sem acumulação (correto para Echo sem ReAct)"
  - "brain-sdr: ReAct multi-step, reducer de soma acumula tokenUsage de todas as passagens pelo nó llm (D-06)"
  - "webhook-auth.test.ts atualizado para formato wrapper { brainOutput, tokenUsage } introduzido na Wave 2 (Rule 1 auto-fix)"
metrics:
  duration: ~30 minutes
  completed_date: "2026-06-16"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 3
---

# Phase 17 Plan 03: Integração de extractTokenUsage nos nós llm de brain-sdr e brain-echo

**One-liner:** extractTokenUsage() adicionado ao retorno dos nós llm de brain-sdr e brain-echo — fecha o ciclo LLM call → BrainStateAnnotation.tokenUsage → BrainRunner wrapper → HTTP response/RabbitMQ log.

## What Was Built

Wave 3 (final) da Phase 17: conecta os Brains ao acumulador de tokens criado na Wave 1.

1. **`apps/brain-sdr/src/brain.ts`** — import de `extractTokenUsage` de `@brain-pkg/ai` adicionado. Nó "llm" agora retorna `tokenUsage: extractTokenUsage(response)` como campo adicional no delta. O ReAct multi-step (llm → tools → llm → __end__) acumula o tokenUsage de **todas** as passagens pelo nó llm via o reducer de soma do `BrainStateAnnotation` (Wave 1). ToolNode não foi modificado — anti-pattern documentado.

2. **`apps/brain-echo/src/brain.ts`** — mesmo padrão. Brain-echo tem apenas 1 nó (llm) e 0 tools — o tokenUsage de um único LLM call é o valor final em `state.tokenUsage`. Pitfall 2 do RESEARCH.md aplicado: se o provider não reportar `usage_metadata`, o default de zeros garante que o campo nunca é `undefined`.

3. **Ciclo fechado end-to-end:**
   ```
   LLM call
     → nó llm: extractTokenUsage(response) → delta TokenUsage
     → BrainStateAnnotation.tokenUsage (reducer de soma): acumula todos os deltas
     → BrainRunner.run(): extrai state.tokenUsage → wrapper { brainOutput, tokenUsage }
     → HTTP response: { status, fullResponse, responseMode, tokenUsage }
     → RabbitMQ consumer: log.info({ tokenUsage }) após run()
   ```

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | extractTokenUsage no nó llm de brain-sdr | 955389d | apps/brain-sdr/src/brain.ts |
| 2 | extractTokenUsage no nó llm de brain-echo + restore Wave 2 | 18fe023 | apps/brain-echo/src/brain.ts, packages/* (restore) |
| Fix | webhook-auth test mock atualizado | f8a13e4 | packages/transport/src/__tests__/unit/webhook-auth.test.ts |

## Verification Results

Verificações estruturais após todas as mudanças:

```
grep -rn "extractTokenUsage" apps/brain-sdr/src/brain.ts apps/brain-echo/src/brain.ts
→ 4 linhas (2 imports + 2 usos nos retornos dos nós llm)

grep -n "tokenUsage" packages/core/src/output/schema.ts
→ VAZIO — D-01 preservado (BrainOutputSchema Zod não foi modificado)

grep -n "export interface TokenUsage" packages/shared/src/types/index.ts
→ linha 35: export interface TokenUsage { (Wave 1 preservado)

grep -n "export interface BrainOutput" packages/shared/src/types/index.ts
→ linha 19: export interface BrainOutput { (não modificado, D-01)
```

Testes unitários que verificam o comportamento:
- `token.test.ts` — TOK-01/02: 5 pass (Wave 1)
- `state-token.test.ts` — TOK-03: 3 pass em isolamento
- `brain-runner.test.ts` — TOK-04: testa wrapper { brainOutput, tokenUsage } (Wave 2)
- `webhook-auth.test.ts` — atualizado para novo contrato IBrainRunnerLike

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree reset --soft reverteu mudanças da Wave 2**

- **Found during:** Task 2, ao verificar os arquivos após o commit da Task 1
- **Issue:** O processo de inicialização do worktree usou `git reset --soft 82289b97` para alinhar o HEAD. Isso colocou como staged o diff reverso de `1b2498a → 82289b9` (i.e., desfazendo as mudanças da Wave 2). Ao fazer o commit da Task 1 com `git add apps/brain-sdr/src/brain.ts`, essas mudanças staged foram commitadas junto — revertendo handler.ts, runner.ts, consumer.ts e seus testes de volta ao estado pré-Wave 2.
- **Fix:** `git checkout 82289b97 -- <files>` para restaurar o estado correto da Wave 2 nos arquivos afetados, incluindo o 17-02-SUMMARY.md que foi deletado. Incluído no commit da Task 2 (18fe023).
- **Files restored:** packages/transport/src/webhook/handler.ts, handler.test.ts, packages/transport/src/rabbitmq/consumer.ts, consumer.test.ts, packages/core/src/runner/runner.ts, brain-runner.test.ts, .planning/17-02-SUMMARY.md
- **Commit:** 18fe023

**2. [Rule 1 - Bug] webhook-auth.test.ts com mock no formato pré-Wave 2**

- **Found during:** Verificação final da suite de testes
- **Issue:** O arquivo `packages/transport/src/__tests__/unit/webhook-auth.test.ts` tinha o mock do runner usando o formato antigo `{ fullResponse, responseMode }`, mas o `handler.ts` (atualizado pela Wave 2) agora espera o wrapper `{ brainOutput, tokenUsage }`. O mock incompatível causava HTTP 500 no teste em vez de 200.
- **Fix:** Atualizado o mock para usar `{ brainOutput: { fullResponse, responseMode }, tokenUsage: { inputTokens, outputTokens, totalTokens } }` e adicionada assertion para `body.tokenUsage` (D-09).
- **Files modified:** packages/transport/src/__tests__/unit/webhook-auth.test.ts
- **Commit:** f8a13e4

### Pre-existing Issues (Out of Scope)

- `checkpointer.test.ts` — timeout 60s para conectar ao PostgreSQL (infra não disponível no CI)
- `brain-runner.integration.test.ts` — integração com banco de dados (infra não disponível)
- `state-token.test.ts` — falha apenas quando rodado em conjunto com outros test files por isolamento de módulo; passa em isolamento (3/3 testes verdes)

## Known Stubs

Nenhum. brain-sdr e brain-echo agora alimentam o acumulador de tokens com dados reais de cada LLM call.

## Threat Flags

Nenhuma superfície nova além do mapeado no threat_model do plano.

- T-17-07: `extractTokenUsage(response)` opera sobre `AIMessage` retornado internamente pelo LLM provider — não modificável por input externo do usuário. Aceito.
- T-17-08: Anti-pattern ToolNode + extractTokenUsage não aconteceu — ToolNode não recebeu `extractTokenUsage`. Mitigado.

## Self-Check: PASSED

- [x] `apps/brain-sdr/src/brain.ts` importa `extractTokenUsage` de `@brain-pkg/ai` — FOUND (linha 12)
- [x] `apps/brain-sdr/src/brain.ts` contém `tokenUsage: extractTokenUsage(response)` no nó llm — FOUND (linha 90)
- [x] `apps/brain-echo/src/brain.ts` importa `extractTokenUsage` de `@brain-pkg/ai` — FOUND (linha 6)
- [x] `apps/brain-echo/src/brain.ts` contém `tokenUsage: extractTokenUsage(response)` no nó llm — FOUND (linha 49)
- [x] Nenhum arquivo contém `extractTokenUsage` no ToolNode ou nó "tools" — VERIFIED
- [x] `packages/core/src/output/schema.ts` NÃO contém `tokenUsage` — VERIFIED (D-01 preservado)
- [x] Commits 955389d, 18fe023, f8a13e4 existem — VERIFIED
- [x] 17-02-SUMMARY.md restaurado e presente — FOUND
