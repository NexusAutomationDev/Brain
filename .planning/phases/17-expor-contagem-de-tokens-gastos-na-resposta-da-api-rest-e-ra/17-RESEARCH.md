# Phase 17: Expor Contagem de Tokens — Research

**Researched:** 2026-06-15
**Domain:** LangChain `AIMessage.usage_metadata` + LangGraph state accumulator + BrainRunner wrapper
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `BrainOutput` (em `packages/shared/src/types/index.ts`) NÃO muda — tokenUsage fica fora do contrato estruturado e não é validado pelo `BrainOutputSchema` (Zod).
- **D-02:** `BrainRunner.run()` passa a retornar `{ brainOutput: BrainOutput; tokenUsage: TokenUsage } | null`. `IBrainRunnerLike.run()` em `handler.ts` também atualiza para refletir o wrapper.
- **D-03:** `TokenUsage` é um novo tipo em `packages/shared/src/types/index.ts`: `{ inputTokens: number; outputTokens: number; totalTokens: number }`.
- **D-04:** camelCase consistente com o projeto: `{ inputTokens, outputTokens, totalTokens }`.
- **D-05:** Provider sem suporte retorna zeros explícitos — `{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }` — não `undefined`.
- **D-06:** Somar tokens de **todos os LLM calls do turno** (não só o último) — acumulador em `BrainState`.
- **D-07:** Campo `tokenUsage` em `BrainStateAnnotation` com reducer de soma. Helper `extractTokenUsage(response: AIMessage): TokenUsage` exportado de `packages/ai`.
- **D-08:** `BrainRunner.run()` extrai `state.tokenUsage` após `compiledGraph.invoke()` e retorna no wrapper.
- **D-09:** Webhook `handler.ts` inclui `tokenUsage` na resposta HTTP JSON.
- **D-10:** RabbitMQ `consumer.ts` loga `tokenUsage` com `pino.info`. Sem publicação em fila.

### Claude's Discretion

- Tipo `TokenUsage` fica junto de `BrainOutput` em `packages/shared/src/types/index.ts` — sem novo arquivo.
- Reducer do acumulador: `(prev, next) => ({ inputTokens: (prev?.inputTokens ?? 0) + (next?.inputTokens ?? 0), ... })`.
- Se `response.usage_metadata` for `null`/`undefined`, contribuição é zero.

### Deferred Ideas (OUT OF SCOPE)

- Publicar `tokenUsage` via RabbitMQ em fila de reply (`RABBITMQ_REPLY_QUEUE`).
- Expor tokenUsage por LLM call (array) para análise granular.
- Alertas automáticos quando `totalTokens` excede threshold por turno.
</user_constraints>

---

## Summary

A fase 17 adiciona extração e exposição do consumo de tokens LLM (`inputTokens / outputTokens / totalTokens`) em cada turno de conversa. A mudança é cirúrgica: nenhum contrato existente (`BrainOutput`, `BrainOutputSchema`) é alterado — `tokenUsage` é um campo adicional no wrapper de retorno de `BrainRunner.run()`.

O ponto-chave de implementação é que `@langchain/core` (v1.1.48, instalado no projeto) já expõe o tipo `UsageMetadata` com campos `{ input_tokens, output_tokens, total_tokens }` (snake_case) em `AIMessage.usage_metadata`, e também exporta a função utilitária `mergeUsageMetadata()` que soma dois objetos de metadados com suporte nativo a `undefined`. O helper `extractTokenUsage()` do projeto apenas converte snake_case → camelCase e trata o caso de `usage_metadata === undefined`.

O reducer de soma em `BrainStateAnnotation` é o mecanismo central que garante acumulação por turno — especialmente importante para o Brain SDR (ReAct: `llm → tools → llm → __end__`) onde múltiplos LLM calls ocorrem por turno.

**Primary recommendation:** Usar `AIMessage.usage_metadata` diretamente (campo nativo do LangChain, disponível desde @langchain/core 0.2, confirmado na versão 1.1.48 instalada). Não há dependência nova; a implementação é pure TypeScript sem I/O.

---

## Standard Stack

### Core (sem adições — zero novas dependências)

| Library | Versão instalada | Uso nesta fase | Por quê |
|---------|-----------------|---------------|---------|
| `@langchain/core` | 1.1.48 | `AIMessage.usage_metadata`, tipo `UsageMetadata`, `mergeUsageMetadata()` | Campo nativo desde 0.2; já instalado |
| `@langchain/langgraph` | ^1.4.1 | `Annotation` com reducer de soma em `BrainStateAnnotation` | Padrão já estabelecido no projeto |
| `pino` (via `@brain-pkg/observability`) | ^9.x | Log de `tokenUsage` no `consumer.ts` | Já em uso no consumer |

Nenhum pacote novo. A fase é 100% refactoring + extensão de tipos.

---

## Architecture Patterns

### Padrão de Reducer de Soma em BrainStateAnnotation

O padrão existente usa `reducer: (_, next) => next` (last-write-wins) para campos como `brainOutput`. Para `tokenUsage` é necessário reducer de **soma acumulada** — diferente padrão, mesmo mecanismo `Annotation<T>`.

```typescript
// Source: verificado em packages/ai/src/graph/state.ts (padrão existente) + @langchain/core 1.1.48
import type { TokenUsage } from "@brain-pkg/shared";

tokenUsage: Annotation<TokenUsage>({
  default: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  reducer: (prev, next) => ({
    inputTokens: (prev?.inputTokens ?? 0) + (next?.inputTokens ?? 0),
    outputTokens: (prev?.outputTokens ?? 0) + (next?.outputTokens ?? 0),
    totalTokens: (prev?.totalTokens ?? 0) + (next?.totalTokens ?? 0),
  }),
}),
```

**IMPORTANTE:** O reducer recebe o estado anterior acumulado (`prev`) + o delta retornado pelo nó (`next`). Para o Brain SDR com ReAct (múltiplas passagens pelo nó `llm`), cada passagem incrementa o acumulador.

### Padrão extractTokenUsage — Conversão snake_case → camelCase

`AIMessage.usage_metadata` usa snake_case (`input_tokens`, `output_tokens`, `total_tokens`). O helper converte para camelCase do projeto (D-04) e trata `undefined`.

```typescript
// Source: @langchain/core 1.1.48 — UsageMetadata type verificado em
// node_modules/.pnpm/@langchain+core@1.1.48_.../dist/messages/metadata.d.ts
import type { AIMessage } from "@langchain/core/messages";
import type { TokenUsage } from "@brain-pkg/shared";

export function extractTokenUsage(response: AIMessage): TokenUsage {
  const meta = response.usage_metadata;
  if (!meta) {
    // D-05: zeros explícitos quando provider não reporta tokens
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  return {
    inputTokens: meta.input_tokens,
    outputTokens: meta.output_tokens,
    totalTokens: meta.total_tokens,
  };
}
```

### Padrão BrainRunner.run() — Wrapper de Retorno

`runner.ts` retorna atualmente `BrainOutput | null`. Com D-02, passa a retornar `{ brainOutput: BrainOutput; tokenUsage: TokenUsage } | null`.

```typescript
// Source: packages/core/src/runner/runner.ts (linha 251 atual)
// Após a mudança D-08:
const tokenUsage: TokenUsage = result.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
return { brainOutput, tokenUsage };
```

### Padrão IBrainRunnerLike — Duck Typing sem Ciclo de Dependência

`IBrainRunnerLike` em `handler.ts` é definido localmente para evitar o ciclo `core → transport → core`. Com D-02, a interface deve refletir o novo tipo de retorno. Não importar tipos de `@brain-pkg/core` — manter duck typing inline.

```typescript
// Source: packages/transport/src/webhook/handler.ts (padrão existente)
export interface IBrainRunnerLike {
  run(event: BrainEvent): Promise<{
    brainOutput: {
      fullResponse: string;
      responseMode: string;
      mediaType?: string;
      mediaUrl?: string;
    };
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  } | null>;
}
```

### Padrão de Resposta HTTP — Spread Condicional

`handler.ts` usa o padrão `...(result.mediaType && { mediaType: result.mediaType })` para campos opcionais. `tokenUsage` é sempre presente (D-05 garante zeros), então spread incondicional é correto.

```typescript
// Source: packages/transport/src/webhook/handler.ts (padrão existente adaptado)
// Após a mudança D-09:
const { brainOutput, tokenUsage } = result;
return c.json({
  status: "ok",
  fullResponse: brainOutput.fullResponse,
  responseMode: brainOutput.responseMode,
  ...(brainOutput.mediaType && { mediaType: brainOutput.mediaType }),
  ...(brainOutput.mediaUrl && { mediaUrl: brainOutput.mediaUrl }),
  tokenUsage,  // sempre presente — D-05 garante zeros
});
```

### Padrão de Log no consumer.ts

```typescript
// Source: packages/transport/src/rabbitmq/consumer.ts (padrão existente, linha 113)
const result = await this.runner.run(parsed.data);
if (result) {
  this.logger.info({ tokenUsage: result.tokenUsage }, "turn token usage");
}
// ACK segue normalmente (o log não bloqueia nem altera o fluxo)
```

### Padrão nos nós llm de Brain SDR e Brain Echo

```typescript
// Source: apps/brain-sdr/src/brain.ts e apps/brain-echo/src/brain.ts (padrão existente)
// Adicionar extractTokenUsage() ao retorno do nó:
import { extractTokenUsage } from "@brain-pkg/ai";

// Dentro do nó "llm":
const response = await llmWithTools.invoke([...]);
return {
  messages: [response],
  brainOutput: { fullResponse, responseMode: "text" as const },
  tokenUsage: extractTokenUsage(response),  // delta do nó atual
};
```

O reducer de soma em `BrainStateAnnotation` acumula automaticamente todos os deltas.

### Anti-Patterns a Evitar

- **Não usar `mergeUsageMetadata()` do LangChain no reducer:** A função aceita `UsageMetadata` (snake_case) — o projeto usa `TokenUsage` (camelCase). O reducer do projeto opera em camelCase; `extractTokenUsage()` faz a conversão na fronteira (dentro do nó).
- **Não modificar `BrainOutputSchema` (Zod) em `packages/core/src/output/schema.ts`:** D-01 — `tokenUsage` fica fora do schema Zod.
- **Não importar `@brain-pkg/core` em `handler.ts`:** Ciclo de dependência. Usar duck typing local.
- **Não retornar `tokenUsage` do nó `tools` (ToolNode):** `ToolNode` retorna `ToolMessage`, não `AIMessage`. Tokens de tool execution não são capturáveis via `usage_metadata` — apenas o nó `llm` emite `AIMessage` com `usage_metadata`.
- **Não propagar `undefined` do acumulador:** O `default` do `Annotation` deve retornar zeros, não `null`. Isso garante que `state.tokenUsage` nunca é `undefined` após `invoke()`.

---

## Don't Hand-Roll

| Problema | Não construir | Usar | Por quê |
|----------|--------------|------|---------|
| Merge/soma de UsageMetadata | Lógica manual de merge | Reducer no `Annotation` + retorno delta por nó | LangGraph propaga automaticamente via reducer; zero código extra em `runner.ts` |
| Tipo `UsageMetadata` | Tipo próprio para metadados do LangChain | `AIMessage.usage_metadata` (campo nativo) | Já existe em `@langchain/core` 1.1.48; refletir, não duplicar |
| Serialização do `tokenUsage` no PostgresSaver | Serialização customizada | JSON-safe primitives (numbers) | `TokenUsage = { inputTokens: number, outputTokens: number, totalTokens: number }` é JSON-safe por design (AI-03) |

---

## Common Pitfalls

### Pitfall 1: Modificar `BrainOutput` ou `BrainOutputSchema`

**O que acontece:** Adicionar `tokenUsage` ao schema Zod ou à interface `BrainOutput` quebra o contrato com clientes que já integram via API v1.2.
**Por que acontece:** Confusão entre o contrato de saída do Brain (BrainOutput) e o envelope de resposta HTTP (que é mais amplo).
**Como evitar:** D-01 é um bloqueio — `BrainOutput` e `BrainOutputSchema` não mudam. `tokenUsage` fica no wrapper de retorno de `BrainRunner.run()`.

### Pitfall 2: `state.tokenUsage` undefined após invoke() no Brain Echo

**O que acontece:** Brain Echo tem apenas um nó `llm` e nenhum nó `tools`. Se o nó não retornar `tokenUsage`, o campo fica com o valor `default` do Annotation (zeros). Isso é comportamento correto — mas se o `default` for `null` em vez de zeros, `BrainRunner` pode receber `null` e o type system falha.
**Por que acontece:** Default do `Annotation` deve ser definido como `() => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })`, não `() => null`.
**Como evitar:** Definir o tipo do Annotation como `TokenUsage` (não `TokenUsage | null`) e o default como zeros explícitos.

### Pitfall 3: BrainState type (BrainState alias) não reflete o novo campo

**O que acontece:** Após adicionar `tokenUsage` ao `BrainStateAnnotation`, o type alias `BrainState = typeof BrainStateAnnotation.State` atualiza automaticamente — mas o `state.test.ts` existente faz checagem de tipo inline: `const _typeCheck: BrainState = { ..., }`. O teste passará no TS mas *sem* `tokenUsage`, pois TypeScript aceita objetos com campos extras ou faltantes dependendo do contexto.
**Por que acontece:** O teste de tipo usa assignment, não verificação de exaustividade.
**Como evitar:** Atualizar `state.test.ts` para incluir `tokenUsage` no `_typeCheck` + adicionar teste do reducer de soma.

### Pitfall 4: Testes de `BrainRunner` precisam atualizar o retorno do mock de `invoke()`

**O que acontece:** `brain-runner.test.ts` tem mocks que retornam `{ brainOutput: {...} }` do grafo compilado. Após a mudança em `runner.ts` para extrair `state.tokenUsage`, os mocks precisam incluir `tokenUsage` no objeto retornado por `invoke()`. Caso contrário, `state.tokenUsage` será `undefined` e o runner retornará `tokenUsage: undefined`.
**Por que acontece:** Os mocks de `compiledGraph.invoke()` simulam o estado completo do grafo — devem incluir todos os campos que `runner.ts` lê.
**Como evitar:** Adicionar `tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }` ao objeto retornado pelos mocks de `invoke()` nos testes existentes. E adicionar testes específicos para o wrapper.

### Pitfall 5: handler.ts — acesso a `result.fullResponse` direto quebra após D-02

**O que acontece:** Atualmente `handler.ts` faz `result.fullResponse`, `result.responseMode`. Após D-02, `result` é `{ brainOutput, tokenUsage }`. Acesso direto `result.fullResponse` falha em TypeScript.
**Por que acontece:** Mudança estrutural no tipo de retorno de `IBrainRunnerLike.run()`.
**Como evitar:** Desestruturar `const { brainOutput, tokenUsage } = result` antes de montar a resposta JSON. Atualizar todos os testes de `handler.test.ts` que mocam `runner.run()`.

### Pitfall 6: consumer.ts — `await this.runner.run(parsed.data)` descarta o resultado atualmente

**O que acontece:** Em `consumer.ts` linha 113, o resultado de `runner.run()` é ignorado com `await this.runner.run(parsed.data)`. Após D-02, é necessário capturar o retorno para logar `tokenUsage`.
**Por que acontece:** RabbitMQ consumer originalmente não precisava do retorno — o ack é baseado em sucesso/falha, não no conteúdo.
**Como evitar:** Mudar para `const result = await this.runner.run(parsed.data)` + `if (result) { this.logger.info(...) }`. O log não deve impedir o ACK em caso de erro.

---

## Code Examples

### TokenUsage type em packages/shared/src/types/index.ts

```typescript
// Source: CONTEXT.md D-03, D-04 — tipo a ser adicionado ao lado de BrainOutput
/**
 * Contagem de tokens consumidos em um turno de conversa.
 * Soma de todos os LLM calls no turno (D-06).
 * Zeros explícitos quando o provider não reporta tokens (D-05).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
```

### BrainStateAnnotation com campo tokenUsage

```typescript
// Source: packages/ai/src/graph/state.ts — adicionar campo ao Root existente
import type { TokenUsage } from "@brain-pkg/shared";

// Dentro de Annotation.Root({...}):
tokenUsage: Annotation<TokenUsage>({
  default: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  reducer: (prev, next) => ({
    inputTokens: (prev?.inputTokens ?? 0) + (next?.inputTokens ?? 0),
    outputTokens: (prev?.outputTokens ?? 0) + (next?.outputTokens ?? 0),
    totalTokens: (prev?.totalTokens ?? 0) + (next?.totalTokens ?? 0),
  }),
}),
```

### extractTokenUsage helper

```typescript
// Source: novo arquivo packages/ai/src/utils/token.ts
// Exportado via packages/ai/src/index.ts
import type { AIMessage } from "@langchain/core/messages";
import type { TokenUsage } from "@brain-pkg/shared";

export function extractTokenUsage(response: AIMessage): TokenUsage {
  const meta = response.usage_metadata;
  if (!meta) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  return {
    inputTokens: meta.input_tokens,
    outputTokens: meta.output_tokens,
    totalTokens: meta.total_tokens,
  };
}
```

---

## Runtime State Inventory

Esta é uma fase de adição de feature (não rename/refactor). Nenhuma migração de dados em runtime é necessária.

| Categoria | Encontrado | Ação |
|-----------|-----------|------|
| Dados armazenados | Nenhum — `tokenUsage` é per-turno, não persistido | Nenhuma |
| Config de serviço vivo | Nenhum | Nenhuma |
| Estado registrado no OS | Nenhum | Nenhuma |
| Secrets/env vars | Nenhum | Nenhuma |
| Artefatos de build | Nenhum | Nenhuma |

---

## Environment Availability

Step 2.6: SKIPPED — fase é puramente code/type change. Nenhuma dependência externa nova além do stack já instalado.

---

## Validation Architecture

### Test Framework

| Propriedade | Valor |
|-------------|-------|
| Framework | `bun test` (nativo) |
| Config | Sem arquivo de config — bun test detecta `*.test.ts` automaticamente |
| Quick run (packages/ai) | `cd packages/ai && bun test src/graph/state.test.ts src/utils/` |
| Quick run (packages/core) | `cd packages/core && bun test src/runner/__tests__/brain-runner.test.ts` |
| Quick run (packages/transport) | `cd packages/transport && bun test src/webhook/handler.test.ts` |
| Full suite | `bun run test` na raiz (turbo) |

### Phase Requirements → Test Map

| ID | Comportamento | Tipo | Comando automatizado | Arquivo existe? |
|----|--------------|------|---------------------|-----------------|
| TOK-01 | `TokenUsage` type exportado de `@brain-pkg/shared` | unit | `cd packages/ai && bun test src/utils/token.test.ts` | Wave 0 |
| TOK-02 | `extractTokenUsage()` retorna camelCase com zeros para `usage_metadata=undefined` | unit | `cd packages/ai && bun test src/utils/token.test.ts` | Wave 0 |
| TOK-03 | `BrainStateAnnotation.tokenUsage` reducer acumula tokens de múltiplos nós | unit | `cd packages/ai && bun test src/graph/state.test.ts` | Atualizar existente |
| TOK-04 | `BrainRunner.run()` retorna wrapper `{ brainOutput, tokenUsage }` | unit | `cd packages/core && bun test src/runner/__tests__/brain-runner.test.ts` | Atualizar existente |
| TOK-05 | Webhook response JSON inclui campo `tokenUsage` | unit | `cd packages/transport && bun test src/webhook/handler.test.ts` | Atualizar existente |
| TOK-06 | Consumer loga `tokenUsage` com pino sem publicar em fila | unit | `cd packages/transport && bun test` | Atualizar existente |

### Sampling Rate

- **Por task commit:** Quick run do pacote modificado no task
- **Por wave merge:** `bun run test` completo na raiz
- **Phase gate:** Full suite green antes do `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/ai/src/utils/token.test.ts` — cobre TOK-01, TOK-02
- [ ] `packages/ai/src/__tests__/` (ou direto em `src/utils/`) — novo arquivo de teste para `extractTokenUsage()`
- [ ] `packages/ai/src/graph/state.test.ts` — atualizar com teste do reducer de soma (TOK-03)
- [ ] `packages/core/src/runner/__tests__/brain-runner.test.ts` — atualizar mocks de `invoke()` para incluir `tokenUsage`, adicionar testes TOK-04
- [ ] `packages/transport/src/webhook/handler.test.ts` — atualizar mocks de `runner.run()` para retornar wrapper, adicionar testes TOK-05/TOK-06

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | sim (parcial) | `usage_metadata` é lido da resposta do LLM (confiável), não de input externo — sem validação adicional necessária |
| V6 Cryptography | no | — |

### Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Token count manipulation | Tampering | N/A — `usage_metadata` vem do provider LLM (resposta interna), não de input do usuário |
| Info disclosure em logs | Info Disclosure | Logar apenas `tokenUsage` agregado (números), não conteúdo da mensagem — padrão já seguido em `consumer.ts` |
| `tokenUsage` com zeros enganosos | Spoofing | D-05 estabelece que zeros são expectados quando provider não reporta — documentar comportamento no tipo |

---

## Assumptions Log

| # | Claim | Section | Risk se errado |
|---|-------|---------|----------------|
| A1 | `AIMessage.usage_metadata` é populado pelos providers OpenAI e Anthropic em condições normais | Standard Stack | Tokens não capturados — resultado seriam zeros; não quebra o sistema |
| A2 | Bun PostgresSaver serializa `TokenUsage` (JSON primitives) sem problemas | Architecture | Histórico de conversa corrompido se falha — mas AI-03 documenta que apenas JSON-safe primitives são seguros, e numbers qualificam |

**Nota sobre A1:** Verificado indiretamente — `mergeUsageMetadata()` no `tracer_langchain.js` do LangChain Core usa `AIMessage.usage_metadata` para agregação nos traces do LangSmith, confirmando que providers populam o campo. [VERIFIED: @langchain/core 1.1.48 source code]

---

## Open Questions (RESOLVED)

1. **`usage_metadata` para o nó `respond` (Phase 16 / Brain SDR com responseMode dinâmico)** — DEFERRED: Phase 16 não implementada
   - O que sabemos: Phase 16 adiciona um nó `respond` separado com `respondTool`. Esse nó chama o LLM internamente.
   - O que está incerto: se o nó `respond` já retorna `tokenUsage` via `extractTokenUsage()` ou se o runner da fase 16 ainda não tem o campo `tokenUsage` no estado.
   - Recomendação: Verificar `apps/brain-sdr/src/brain.ts` após Phase 16 estar implementada. O planner deve tratar o nó `respond` como mais um nó `llm` que retorna `tokenUsage` delta.

2. **`schema_version` — incrementar com adição de `tokenUsage` ao BrainState** — RESOLVED: schema_version incrementado para 2 no Plan 01 Task 3
   - O que sabemos: `schema_version: 1` é o valor atual.
   - O que estava incerto: o comentário em `state.ts` diz "Increment when shape changes" — adição de campo é mudança de shape.
   - Resolução: Incrementar para `schema_version: 2` junto com a adição do campo `tokenUsage` (Plan 01 Task 3). Sem migração de dados — o campo tem `default: () => zeros`, então estados antigos (sem `tokenUsage`) são compatíveis via forward-compatibility.

---

## Sources

### Primary (HIGH confidence)

- `@langchain/core` 1.1.48 instalado em `/root/Brain` — tipo `UsageMetadata` verificado em `node_modules/.pnpm/@langchain+core@1.1.48_.../dist/messages/metadata.d.ts` [VERIFIED: codebase grep]
- `mergeUsageMetadata()` verificado em `metadata.js` linhas 26-36 — handles `undefined` com `?? 0` [VERIFIED: codebase grep]
- `AIMessage.usage_metadata` verificado como campo opcional em `ai.d.ts` linha 10 [VERIFIED: codebase grep]
- `packages/ai/src/graph/state.ts` — padrão de `Annotation` com reducer analisado [VERIFIED: codebase Read]
- `packages/core/src/runner/runner.ts` — ponto de mudança principal, retorno atual `BrainOutput | null` linha 149 [VERIFIED: codebase Read]
- `packages/transport/src/webhook/handler.ts` — `IBrainRunnerLike` e resposta HTTP linhas 17-90 [VERIFIED: codebase Read]
- `packages/transport/src/rabbitmq/consumer.ts` — linha 113 descarta resultado de `runner.run()` [VERIFIED: codebase Read]
- `apps/brain-sdr/src/brain.ts` e `apps/brain-echo/src/brain.ts` — nó `llm` analisado [VERIFIED: codebase Read]

### Secondary (MEDIUM confidence)

- CONTEXT.md Phase 17 — decisões de implementação [CITED: .planning/phases/17-.../17-CONTEXT.md]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero novas dependências; tudo verificado no código instalado
- Architecture: HIGH — padrões verificados diretamente no código do projeto
- Pitfalls: HIGH — derivados da leitura real do código existente (mocks, handler, consumer)

**Research date:** 2026-06-15
**Valid until:** 2026-09-15 (estável — sem dependências externas novas)
