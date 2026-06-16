---
phase: 17-expor-contagem-de-tokens-gastos-na-resposta-da-api-rest-e-ra
verified: 2026-06-16T03:15:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 17: Expor Contagem de Tokens Verification Report

**Phase Goal:** Capturar e expor consumo de tokens LLM (inputTokens/outputTokens/totalTokens) por turno — acumulado via BrainStateAnnotation, retornado no wrapper de BrainRunner.run(), exposto na resposta HTTP e logado no RabbitMQ consumer
**Verified:** 2026-06-16T03:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Resposta HTTP do webhook inclui `tokenUsage: { inputTokens, outputTokens, totalTokens }` ao lado de `fullResponse` | VERIFIED | `handler.ts` linha 99: `tokenUsage,` na resposta JSON; destructura de `result` em linha 92; 10 testes verdes em `handler.test.ts` incluindo TOK-05 com `usage.inputTokens === 512` |
| 2 | Para Brain SDR com ReAct (múltiplos LLM calls por turno), tokenUsage reflete a soma de todos os calls do turno — não apenas o último | VERIFIED | `state.ts` linhas 50-54: reducer de soma explícito `(prev?.inputTokens ?? 0) + (next?.inputTokens ?? 0)`; `state-token.test.ts` TOK-03c verifica acumulação `300 = 100 + 200` inputTokens em dois nós llm; `brain-sdr/src/brain.ts` linha 90: `tokenUsage: extractTokenUsage(response)` no nó llm (não no ToolNode) |
| 3 | RabbitMQ consumer loga tokenUsage com pino.info a cada turno processado — sem publicar em fila separada | VERIFIED | `consumer.ts` linha 114: `const result = await this.runner.run(parsed.data);` linha 117: `this.logger.info({ tokenUsage: result.tokenUsage }, "turn token usage");`; ausência de `this.pub.send` no caminho de sucesso; 10 testes verdes em `consumer.test.ts` |
| 4 | BrainOutput (packages/shared) e BrainOutputSchema (Zod) permanecem inalterados — backward compatibility preservada | VERIFIED | `grep tokenUsage packages/core/src/output/schema.ts` retorna VAZIO; `BrainOutput` interface em linha 19 de `shared/types/index.ts` inalterada; `TokenUsage` adicionada separadamente na linha 35 |
| 5 | Provider sem suporte a usage_metadata retorna zeros explícitos — resposta HTTP nunca tem tokenUsage undefined | VERIFIED | `token.ts` linha 18-20: guard `if (!meta) { return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }; }`; `runner.ts` linha 253: fallback `result.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }`; spot-check comportamental confirmado (`undefined` input → zeros) |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/shared/src/types/index.ts` | `export interface TokenUsage` | VERIFIED | Linha 35: `export interface TokenUsage {` com campos `inputTokens`, `outputTokens`, `totalTokens`; `BrainOutput` inalterada (D-01) |
| `packages/ai/src/utils/token.ts` | `extractTokenUsage()` helper | VERIFIED | 27 linhas; exporta `extractTokenUsage`; guard de `!meta`; conversão snake_case → camelCase; importa `TokenUsage` de `@brain-pkg/shared` |
| `packages/ai/src/graph/state.ts` | `BrainStateAnnotation` com campo `tokenUsage` e reducer de soma | VERIFIED | Linhas 48-55: `tokenUsage: Annotation<TokenUsage>` com reducer de soma; `default: () => ({ inputTokens: 0, ... })`; `schema_version` incrementado para 2 |
| `packages/ai/src/index.ts` | Re-exporta `extractTokenUsage` | VERIFIED | Linha 16: `export { extractTokenUsage } from "./utils/token.js";` |
| `packages/ai/src/__tests__/unit/token.test.ts` | Testes TOK-01 e TOK-02 | VERIFIED | 5 testes verdes (TOK-01, TOK-02a/b/c/d); 7 expect() calls; 53ms |
| `packages/ai/src/__tests__/unit/state-token.test.ts` | Teste TOK-03 — reducer de soma | VERIFIED | 3 testes verdes (TOK-03a/b/c); acumulação 300 inputTokens verificada; 382ms |
| `packages/core/src/runner/runner.ts` | `run()` retorna wrapper `{ brainOutput, tokenUsage }` | VERIFIED | Linha 149: `Promise<{ brainOutput: BrainOutput; tokenUsage: TokenUsage } | null>`; linha 253-254: extração e retorno do wrapper |
| `packages/transport/src/webhook/handler.ts` | `IBrainRunnerLike` atualizada + `tokenUsage` na resposta HTTP | VERIFIED | Linhas 17-31: `IBrainRunnerLike` com `brainOutput` e `tokenUsage` no tipo de retorno; linha 99: `tokenUsage,` no JSON de resposta |
| `packages/transport/src/rabbitmq/consumer.ts` | Captura result e loga `tokenUsage` | VERIFIED | Linha 114: `const result = await this.runner.run(parsed.data);`; linha 117: `this.logger.info({ tokenUsage: result.tokenUsage }, "turn token usage")` |
| `apps/brain-sdr/src/brain.ts` | Nó llm retorna `tokenUsage: extractTokenUsage(response)` | VERIFIED | Linha 12: import de `extractTokenUsage` de `@brain-pkg/ai`; linha 90: `tokenUsage: extractTokenUsage(response)` no retorno do nó llm; ToolNode inalterado |
| `apps/brain-echo/src/brain.ts` | Nó llm retorna `tokenUsage: extractTokenUsage(response)` | VERIFIED | Linha 6: import de `extractTokenUsage` de `@brain-pkg/ai`; linha 49: `tokenUsage: extractTokenUsage(response)` no retorno do nó llm |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/ai/src/utils/token.ts` | `packages/shared/src/types/index.ts` | `import type { TokenUsage }` | WIRED | Linha 2: `import type { TokenUsage } from "@brain-pkg/shared"` |
| `packages/ai/src/graph/state.ts` | `packages/shared/src/types/index.ts` | `import type { TokenUsage }` | WIRED | Linha 3: `import type { BrainOutput, TokenUsage } from "@brain-pkg/shared"` |
| `packages/ai/src/index.ts` | `packages/ai/src/utils/token.ts` | re-export `extractTokenUsage` | WIRED | Linha 16: `export { extractTokenUsage } from "./utils/token.js"` |
| `packages/core/src/runner/runner.ts` | `packages/ai/src/graph/state.ts` | `result.tokenUsage` extraído após `invoke()` | WIRED | Linha 253: `const tokenUsage: TokenUsage = result.tokenUsage ?? { ... }` — lê do estado retornado pelo grafo |
| `packages/transport/src/webhook/handler.ts` | `packages/core/src/runner/runner.ts` | `IBrainRunnerLike` duck-typed com novo wrapper | WIRED | `IBrainRunnerLike` define `{ brainOutput: {...}; tokenUsage: {...} }` estruturalmente compatível com `runner.run()` |
| `packages/transport/src/rabbitmq/consumer.ts` | `packages/core/src/runner/runner.ts` | `const result = await this.runner.run()` | WIRED | Linha 114-117: resultado capturado e `result.tokenUsage` logado |
| `apps/brain-sdr/src/brain.ts` | `packages/ai/src/utils/token.ts` | `import { extractTokenUsage } from '@brain-pkg/ai'` | WIRED | Linha 12: import; linha 90: uso no retorno do nó llm |
| `apps/brain-echo/src/brain.ts` | `packages/ai/src/utils/token.ts` | `import { extractTokenUsage } from '@brain-pkg/ai'` | WIRED | Linha 6: import; linha 49: uso no retorno do nó llm |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `handler.ts` (resposta HTTP) | `tokenUsage` | `result.tokenUsage` do wrapper de `runner.run()` | Sim — vem de `state.tokenUsage` extraído de `compiledGraph.invoke()` | FLOWING |
| `consumer.ts` (log pino) | `result.tokenUsage` | `this.runner.run(parsed.data)` | Sim — acumulado pelo reducer de soma do `BrainStateAnnotation` | FLOWING |
| `apps/brain-sdr/src/brain.ts` (nó llm) | `tokenUsage` | `extractTokenUsage(response)` onde `response` é `AIMessage` real do LLM | Sim — `response.usage_metadata` vem do provider LLM | FLOWING |
| `apps/brain-echo/src/brain.ts` (nó llm) | `tokenUsage` | `extractTokenUsage(response)` onde `response` é `AIMessage` real do LLM | Sim — zeros quando provider não reporta (D-05), valores reais quando reporta | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `extractTokenUsage` converte snake_case para camelCase | `bun -e "import { extractTokenUsage } from '.../src/index.ts'; console.log(JSON.stringify(extractTokenUsage({ usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } })))"` | `{"inputTokens":10,"outputTokens":5,"totalTokens":15}` | PASS |
| `extractTokenUsage` retorna zeros quando `usage_metadata` é `undefined` | `bun -e "import { extractTokenUsage } from '.../src/index.ts'; console.log(JSON.stringify(extractTokenUsage({ usage_metadata: undefined })))"` | `{"inputTokens":0,"outputTokens":0,"totalTokens":0}` | PASS |
| Reducer de soma acumula 300 inputTokens (100+200) | `bun test state-token.test.ts` | `3 pass, 0 fail` — TOK-03c verifica `result2.tokenUsage.inputTokens === 300` | PASS |
| Todos os testes de transport passam | `bun test packages/core packages/transport` | `105 pass, 2 fail` (os 2 falhos são pré-existentes: integração PostgreSQL sem DB disponível) | PASS |

---

### Requirements Coverage

Os IDs de requisitos declarados nos planos (TOK-01 a TOK-06, D-03 a D-10) são **requisitos internos de design** definidos em `17-CONTEXT.md` e `17-RESEARCH.md` — não estão em `REQUIREMENTS.md` (que lista apenas MCP-*, RESP-*, TD-01 para v1.3). Nenhum requisito de `REQUIREMENTS.md` é mapeado para a Phase 17 na tabela de traceability.

| Requisito Interno | Plano | Descrição | Status | Evidência |
|-------------------|-------|-----------|--------|-----------|
| TOK-01 | 17-01 | `extractTokenUsage` é exportada de `utils/token.ts` | SATISFIED | `token.test.ts` TOK-01: 1 teste verde |
| TOK-02 | 17-01 | `extractTokenUsage` converte snake_case / retorna zeros para undefined | SATISFIED | `token.test.ts` TOK-02a/b/c/d: 4 testes verdes |
| TOK-03 | 17-01 | `BrainStateAnnotation.tokenUsage` com reducer de soma | SATISFIED | `state-token.test.ts` TOK-03a/b/c: 3 testes verdes; 300 inputTokens acumulados |
| TOK-04 | 17-02 | `BrainRunner.run()` retorna wrapper `{ brainOutput, tokenUsage }` | SATISFIED | `runner.ts` linhas 149, 253-254; `brain-runner.test.ts` 22 testes verdes |
| TOK-05 | 17-02 | Resposta HTTP inclui `tokenUsage` | SATISFIED | `handler.ts` linha 99; `handler.test.ts` 10 testes verdes com `usage.inputTokens === 512` |
| TOK-06 | 17-02 | `consumer.ts` loga `tokenUsage` com pino.info | SATISFIED | `consumer.ts` linhas 114-117; `consumer.test.ts` 10 testes verdes |
| D-03 | 17-01 | `TokenUsage` type em `@brain-pkg/shared` | SATISFIED | `shared/types/index.ts` linha 35 |
| D-04 | 17-01 | camelCase: `inputTokens`, `outputTokens`, `totalTokens` | SATISFIED | `token.ts` + `TokenUsage` interface — todos os campos em camelCase |
| D-05 | 17-01 | Zeros explícitos quando provider não reporta | SATISFIED | Guard `!meta` em `token.ts` linha 18; fallback em `runner.ts` linha 253 |
| D-06 | 17-01/03 | Soma de todos os LLM calls do turno | SATISFIED | Reducer de soma; `brain-sdr` nó llm emite delta; ToolNode não emite |
| D-07 | 17-01/03 | Helper em `packages/ai`, nós Brain usam via import | SATISFIED | `extractTokenUsage` em `@brain-pkg/ai`; importado por `brain-sdr` e `brain-echo` |
| D-08 | 17-02 | `BrainRunner.run()` extrai `state.tokenUsage` e retorna no wrapper | SATISFIED | `runner.ts` linha 253: `result.tokenUsage ?? { ... }` |
| D-09 | 17-02 | Webhook inclui `tokenUsage` na resposta HTTP JSON | SATISFIED | `handler.ts` linha 99: `tokenUsage,` na resposta |
| D-10 | 17-02 | Consumer loga — sem publicação em fila | SATISFIED | `consumer.ts`: log pino.info; sem `this.pub.send` no caminho de sucesso |

---

### Anti-Patterns Found

Nenhum anti-padrão encontrado nos arquivos principais da fase. Verificados:
- `packages/shared/src/types/index.ts`
- `packages/ai/src/utils/token.ts`
- `packages/ai/src/graph/state.ts`
- `packages/core/src/runner/runner.ts`
- `packages/transport/src/webhook/handler.ts`
- `packages/transport/src/rabbitmq/consumer.ts`
- `apps/brain-sdr/src/brain.ts`
- `apps/brain-echo/src/brain.ts`

Nenhum `TODO`, `FIXME`, `placeholder`, `return null` indevido, ou stub detectado.

---

### Human Verification Required

Nenhum item requer verificação humana. Todos os comportamentos relevantes foram verificados programaticamente:
- Testes unitários cobrem todos os casos de borda do `extractTokenUsage` (undefined, null, snake_case)
- Reducer de soma verificado por testes de integração com `StateGraph` real
- Resposta HTTP verificada por testes de `handler.test.ts` com mock do runner
- Log do consumer verificado por testes de `consumer.test.ts`

---

### Notas sobre Falhas Pré-existentes

Os 2 testes falhando na suite completa são pré-existentes e não relacionados à Phase 17:
1. `checkpointer.test.ts` — timeout/falha de conexão ao PostgreSQL (`PostgresSaver.setup()` exige banco real)
2. `brain-runner.integration.test.ts` — integração com banco de dados (`db.delete` requer banco real)

Ambos requerem infraestrutura PostgreSQL externa, documentada como limitação conhecida do ambiente CI.

---

### Gaps Summary

Nenhum gap. Todos os 5 critérios de sucesso do ROADMAP foram verificados contra o código real:
- Ciclo completo end-to-end implementado: LLM call → `extractTokenUsage` → `BrainStateAnnotation.tokenUsage` (reducer de soma) → `BrainRunner.run()` wrapper → resposta HTTP JSON / log RabbitMQ
- 9 commits na branch master verificados (5143caf, 78daaed, 43f426b, 13019b9, 66454ab, f706c93, 955389d, 18fe023, f8a13e4)
- Backward compatibility preservada: `BrainOutput` e `BrainOutputSchema` (Zod) inalterados
- 57+ testes unitários verdes cobrindo todos os requisitos internos TOK-01 a TOK-06 e D-03 a D-10

---

_Verified: 2026-06-16T03:15:00Z_
_Verifier: Claude (gsd-verifier)_
