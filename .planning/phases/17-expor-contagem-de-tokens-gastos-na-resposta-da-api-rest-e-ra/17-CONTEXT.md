# Phase 17: Expor contagem de tokens gastos na resposta da API REST e RabbitMQ - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Capturar e expor dados de consumo de tokens LLM (inputTokens / outputTokens / totalTokens) em cada turno de conversa via REST API (webhook). No transporte RabbitMQ, apenas logar com Pino — sem nova fila.

O escopo é limitado a:
1. Adicionar acumulador `tokenUsage` no `BrainState` (`packages/ai`)
2. Nó `llm` de cada Brain atualiza o acumulador com `usage_metadata` do `AIMessage`
3. `BrainRunner.run()` extrai `tokenUsage` do estado após `invoke()` e retorna no wrapper
4. `handler.ts` (webhook) inclui `tokenUsage` na resposta HTTP
5. `consumer.ts` (RabbitMQ) loga `tokenUsage` com Pino

**Fora de escopo:** publicar reply com tokenUsage em fila RabbitMQ, canal de resposta async, mudanças no `BrainOutput` (shared/types/index.ts).

</domain>

<decisions>
## Implementation Decisions

### Contrato de Saída

- **D-01:** `BrainOutput` (em `packages/shared/src/types/index.ts`) NÃO muda — tokenUsage fica fora do contrato estruturado e não é validado pelo `BrainOutputSchema` (Zod).
- **D-02:** `BrainRunner.run()` passa a retornar `{ brainOutput: BrainOutput; tokenUsage: TokenUsage } | null` (wrapper). `IBrainRunnerLike.run()` em `handler.ts` também atualiza para refletir o wrapper.
- **D-03:** `TokenUsage` é um novo tipo em `packages/shared/src/types/index.ts` (ao lado de `BrainOutput`): `{ inputTokens: number; outputTokens: number; totalTokens: number }`.

### Nomenclatura dos Campos

- **D-04:** camelCase consistente com o projeto: `{ inputTokens: number; outputTokens: number; totalTokens: number }`.
- **D-05:** Quando o provider não retorna dados de token (ex: provider sem suporte a `usage_metadata`), retornar `{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }` — zeros explícitos, não `undefined`.

### Captura e Aggregação

- **D-06:** Somar tokens de **todos os LLM calls do turno** (não só o último). Custo real para billing — especialmente importante no ReAct do Brain SDR (llm → tools → llm → __end__).
- **D-07:** Captura via acumulador em `BrainState`: `BrainStateAnnotation` em `packages/ai/src/graph/state.ts` ganha campo `tokenUsage` com reducer de soma. O nó `llm` de cada Brain é responsável por retornar `tokenUsage` acumulado a partir de `response.usage_metadata`.
- **D-08:** `BrainRunner.run()` extrai `state.tokenUsage` após o `compiledGraph.invoke()` e retorna no wrapper `{ brainOutput, tokenUsage }`.

### Exposição via Transporte

- **D-09:** Webhook (`handler.ts`): extrair `tokenUsage` do wrapper e incluí-lo na resposta HTTP JSON:
  ```json
  {
    "status": "ok",
    "fullResponse": "...",
    "responseMode": "text",
    "tokenUsage": { "inputTokens": 512, "outputTokens": 128, "totalTokens": 640 }
  }
  ```
- **D-10:** RabbitMQ (`consumer.ts`): capturar o retorno de `runner.run()` e logar `tokenUsage` com `pino.info`. Sem publicação em fila separada — zero mudança no contrato do broker.

### Claude's Discretion

- Tipo `TokenUsage` pode ficar junto de `BrainOutput` em `packages/shared/src/types/index.ts` — sem novo arquivo.
- Reducer do acumulador em `BrainState`: `(prev, next) => ({ inputTokens: (prev?.inputTokens ?? 0) + (next?.inputTokens ?? 0), ... })` — Claude decide implementação exata.
- Se `response.usage_metadata` for `null`/`undefined`, contribuição é zero para cada campo.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contrato de Saída e Tipos

- `packages/shared/src/types/index.ts` — `BrainOutput` e `ResponseMode`; adicionar `TokenUsage` aqui (D-03)
- `packages/core/src/output/schema.ts` — `BrainOutputSchema` Zod; NÃO muda (D-01)

### BrainRunner e Wrapper

- `packages/core/src/runner/runner.ts` — `BrainRunner.run()` retorna `BrainOutput | null` hoje; deve retornar wrapper (D-02, D-08)
- `packages/transport/src/webhook/handler.ts` — `IBrainRunnerLike.run()` e response HTTP (D-02, D-09)
- `packages/transport/src/rabbitmq/consumer.ts` — captura retorno de run() e loga (D-10)

### Estado do Grafo e Captura

- `packages/ai/src/graph/state.ts` — `BrainStateAnnotation`; adicionar campo `tokenUsage` com reducer de soma (D-07)
- `apps/brain-sdr/src/brain.ts` — nó `llm`; deve acumular `response.usage_metadata` em `tokenUsage` no retorno do nó (D-07)
- `apps/brain-echo/src/brain.ts` — Brain echo também precisa do mesmo padrão no nó llm

### LangChain Token API

- LangChain `AIMessage.usage_metadata` (desde `@langchain/core` 0.2) — `{ input_tokens, output_tokens, total_tokens }` (snake_case do LangChain; converter para camelCase em D-04)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `BrainStateAnnotation` (`packages/ai/src/graph/state.ts`) — padrão de `Annotation` com reducer já estabelecido; adicionar campo `tokenUsage` segue o mesmo padrão de `brainOutput` (last-write-wins) mas com reducer de soma.
- `createLogger()` de `@brain-pkg/observability` — já usado em `consumer.ts`; reutilizar para o log de tokenUsage.
- Padrão de `...(result.mediaType && { mediaType: result.mediaType })` em `handler.ts` — para inclusão condicional do `tokenUsage` na resposta HTTP.

### Established Patterns

- Tipos TypeScript sem Zod ficam em `packages/shared/src/types/index.ts`; schemas Zod ficam em `packages/core` — separação já estabelecida na Fase 10 (BrainOutput vs BrainOutputSchema).
- `IBrainRunnerLike` em `handler.ts` é duck-typed para evitar ciclo de dependência `core → transport → core`. O wrapper de retorno segue o mesmo princípio.
- `BrainStateAnnotation` usa `Annotation<T | null>({ default: () => null, reducer: (_, next) => next })` para last-write-wins. Para tokenUsage, o reducer precisa de soma acumulada — diferente de `brainOutput`.

### Integration Points

- `BrainRunner.run()` em `runner.ts` — ponto central de mudança; extrai `state.tokenUsage` e retorna no wrapper.
- `consumer.ts` linha 113: `await this.runner.run(parsed.data)` — capturar resultado e logar `tokenUsage`.
- `handler.ts` linha 84-90: bloco de response JSON — adicionar `tokenUsage` ao lado de `fullResponse`.

</code_context>

<specifics>
## Specific Ideas

- A decisão de manter `BrainOutput` inalterado preserva backward compatibility nos clientes que já integram com a API v1.2 — `tokenUsage` é um campo adicional na resposta HTTP, não uma mudança no schema.
- Zeros explícitos (`{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }`) tornam o contrato da resposta HTTP previsível — client não precisa verificar `undefined`.

</specifics>

<deferred>
## Deferred Ideas

- Publicar `tokenUsage` via RabbitMQ em fila de reply (`RABBITMQ_REPLY_QUEUE`) — deferido para quando o canal de resposta async for implementado (pós v1.3).
- Expor tokenUsage por LLM call (array) para análise granular — aggregação por turno é suficiente para billing agora.
- Alertas automáticos quando totalTokens excede threshold por turno — monitoring futuro.

</deferred>

---

*Phase: 17-expor-contagem-de-tokens-gastos-na-resposta-da-api-rest-e-ra*
*Context gathered: 2026-06-15*
