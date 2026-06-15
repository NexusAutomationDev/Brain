# Phase 10: Output Parser SDK - Research

**Researched:** 2026-06-14
**Domain:** TypeScript SDK design — Zod schema validation, LangGraph state annotation extension, breaking API change
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `responseMode` representa o tipo de midia da resposta, nao o estado da conversa nem o modo de entrega.
**D-02:** Valores validos: `"text" | "image" | "audio" | "video" | "document"` (Zod enum).
**D-03:** `responseMode: "audio"` e um sinal de TTS — o `fullResponse` contem o texto que sera convertido em audio pelo sistema downstream. `mediaType` e `mediaUrl` nao se aplicam ao modo audio.
**D-04:** `mediaType` e `mediaUrl` sao obrigatorios apenas quando `responseMode === "image"` ou `responseMode === "document"` ou `responseMode === "video"` (validacao condicional no Zod schema via `.refine()`).
**D-05:** `mediaType` e string livre (MIME type, ex: `"image/jpeg"`, `"application/pdf"`). Nao e um enum.
**D-06:** `mediaUrl` e string contendo URL externa. Upload direto (base64) esta fora de escopo em v1.2.
**D-07:** O no do grafo e responsavel por montar o `BrainOutput` manualmente apos invocar o LLM. Sem `.withStructuredOutput()` — o LLM retorna string, o no wraps em BrainOutput.
**D-08:** Fluxo dentro do no: `llm.invoke([...])` → extrai `content` como string → monta `{ fullResponse: content, responseMode: "text" }` → seta `state.brainOutput`.
**D-09:** `BrainStateAnnotation` ganha o campo `brainOutput: BrainOutput | null`.
**D-10:** Reducer: last-write wins (`(_, b) => b`). Default: `() => null`.
**D-11:** `BrainOutput` e importado de `@brain-pkg/core` no `BrainStateAnnotation` — core exporta o tipo/schema, ai o usa no state.
**D-12:** `BrainRunner.run()` passa a retornar `Promise<BrainOutput | null>` diretamente (sem wrapper). `null` quando `ia_ativada = false`.
**D-13:** O tipo `BrainRunResult` (`{ reply: string }`) e removido do SDK. Breaking change controlado — apenas `handler.ts` dos Brains consome esse tipo.
**D-14:** Apos `compiledGraph.invoke()`, BrainRunner le `result.brainOutput` e valida com `BrainOutputSchema.parse()`. Se invalido (null ou schema mismatch), lanca erro — nunca retorna silenciosamente.

### Claude's Discretion

- Localizacao do schema: `packages/core/src/output/schema.ts`
- Classe de erro na validacao: usar `ConfigurationError` existente (de `@brain-pkg/shared`) ou criar `BrainOutputValidationError` — a criterio do planejador
- Exportacao no barrel do core: `BrainOutputSchema`, `BrainOutput`, `ResponseMode`
- brain-echo migration: o no `"llm"` existente recebe extensao que seta `brainOutput` no estado retornado

### Deferred Ideas (OUT OF SCOPE)

- `mediaType` como enum restrito — futuro se precisarmos validar MIME types aceitos pelo WhatsApp
- Upload base64 (mediaUrl com conteudo embutido) — fora de escopo em v1.2
- `responseMode: "end" | "pause"` ligado ao estado da conversa — pertence as tools da Fase 11
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PARSER-01 | O SDK expoe um Output Parser padrao com o JSON schema definido — `fullResponse` e `responseMode` obrigatorios; `mediaType`/`mediaUrl` condicionalmente obrigatorios entre si | `BrainOutputSchema` com `z.superRefine()` verificado em runtime — veja secao Architecture Patterns |
| PARSER-02 | Todos os Brains retornam exclusivamente o formato estruturado (breaking change — sem fallback para string plana) | `IBrain.run()` passa a retornar `BrainOutput`; `BrainRunner.run()` valida e lanca erro; `IBrainRunnerLike` em transport precisa ser atualizado |
</phase_requirements>

---

## Summary

A Fase 10 e uma refatoracao de contrato de API com quatro frentes independentes: (1) criar `BrainOutputSchema` com Zod em `packages/core`, (2) adicionar campo `brainOutput` ao `BrainStateAnnotation` em `packages/ai`, (3) alterar `BrainRunner.run()` para retornar `BrainOutput | null` e validar via `BrainOutputSchema.parse()`, e (4) migrar `brain-echo` para que seu no "llm" sete `state.brainOutput`.

O risco tecnico central e o breaking change em cascata: `BrainRunResult` (removido), `IBrainRunnerLike` em `packages/transport` (precisa ser atualizado para aceitar `BrainOutput | null`), e todos os testes existentes que assercionam `{ reply: string }`. Zod 3.x ja esta instalado em `packages/transport` e `apps/brain-sdr` — basta adicionar como dependencia direta de `packages/core`.

O padrao `.superRefine()` do Zod 3.x (verificado em runtime com Bun 1.3.2 e Zod 3.25.76) cobre com precisao a validacao condicional `mediaType`/`mediaUrl` pelos modos `image`, `video` e `document`.

**Recomendacao primaria:** Criar `BrainOutputValidationError` como classe dedicada (em vez de reutilizar `ConfigurationError`) — semantica mais clara, facilita catch especifico em handler.ts e testes. Adicionar `zod` como dependencia direta de `packages/core`. Seguir a ordem: schema → state → runner → brain-echo.

---

## Project Constraints (from CLAUDE.md)

| Diretiva | Impacto nesta fase |
|----------|--------------------|
| Runtime: Bun 1.x | Todos os testes rodam com `bun test` |
| ORM: Drizzle, sem geracao de client | Sem impacto (fase e TypeScript puro) |
| Testes em `__tests__/unit/` ou `__tests__/integration/` | Novo arquivo de teste para `BrainOutputSchema` vai em `packages/core/src/__tests__/unit/output/` |
| Arquivos de teste manual em `manual/` (gitignored) | Scripts exploratórios fora do repo |
| Sem `export *` — apenas named exports | `index.ts` do core recebe 3 named exports: `BrainOutputSchema`, `BrainOutput`, `ResponseMode` |
| Commits: Conventional Commits com emoji | `✨ feat(core): add BrainOutputSchema and BrainOutput contract` |
| Nunca incluir Co-Authored-By do Claude nos commits | Confirmar antes de commitar |

---

## Standard Stack

### Core

| Biblioteca | Versao | Proposito | Por que padrao |
|------------|--------|-----------|----------------|
| `zod` | 3.25.76 | Schema de validacao em runtime | Ja instalado no projeto (transport, brain-sdr); API estavel; `.superRefine()` verificado |
| `bun test` | built-in (Bun 1.3.2) | Testes unitarios | Padrao do projeto — Jest-compatible, zero config |
| TypeScript | 5.x | Tipagem estatica | Padrao do projeto |

Zod nao esta em `packages/core/package.json` atualmente — e dependencia indireta via LangGraph/LangChain. Para uso explicito de `z.object()` em producao, deve ser adicionado como dependencia direta.

**Versao verificada:** Zod 3.25.76 instalado em `packages/transport/node_modules` e `apps/brain-sdr/node_modules`. [VERIFIED: package.json dos pacotes do projeto]

**Instalacao necessaria:**
```bash
# Adicionar zod como dependencia direta de packages/core
cd packages/core
bun add zod
```

### Alternativas Consideradas

| Em vez de | Poderia usar | Tradeoff |
|-----------|-------------|----------|
| `z.superRefine()` | `z.discriminatedUnion()` | discriminatedUnion seria mais elegante mas exigiria objetos separados por responseMode — mais verboso para 5 valores com apenas 2 campos opcionais |
| Classe `BrainOutputValidationError` dedicada | Reutilizar `ConfigurationError` | ConfigurationError e semanticamente para erros de inicializacao/configuracao; validacao de output em runtime e conceito diferente |

---

## Architecture Patterns

### Estrutura de Arquivos Recomendada

```
packages/core/src/
  output/
    schema.ts              # BrainOutputSchema (Zod), BrainOutput type, ResponseMode type
  __tests__/
    unit/
      output/
        schema.test.ts     # testes unitarios do BrainOutputSchema
  runner/
    runner.ts              # alterado: run() retorna BrainOutput | null
  brain/
    interface.ts           # inalterado: IBrain nao define run() — so buildGraph()
  index.ts                 # adiciona exports: BrainOutputSchema, BrainOutput, ResponseMode

packages/ai/src/
  graph/
    state.ts               # adiciona campo brainOutput: BrainOutput | null

apps/brain-echo/src/
  brain.ts                 # no "llm" passa a retornar { messages, brainOutput }
  __tests__/
    unit/
      brain.test.ts        # atualizar testes para novo contrato
```

### Padrao 1: BrainOutputSchema com validacao condicional

**O que e:** Zod schema com `.superRefine()` para impor que `mediaType` e `mediaUrl` sejam obrigatorios apenas quando `responseMode` e `"image"`, `"video"` ou `"document"`.

**Quando usar:** Unico schema de validacao do contrato de saida — usado pelo BrainRunner para validar `result.brainOutput` antes de retornar.

```typescript
// Source: verificado em runtime com Bun 1.3.2 + Zod 3.25.76
// packages/core/src/output/schema.ts

import { z } from "zod";

export const ResponseModeSchema = z.enum([
  "text",
  "image",
  "audio",
  "video",
  "document",
]);

export type ResponseMode = z.infer<typeof ResponseModeSchema>;

const MODES_REQUIRING_MEDIA = ["image", "video", "document"] as const;

export const BrainOutputSchema = z
  .object({
    /** Texto obrigatorio em todos os modos — legenda, acompanhamento ou texto para TTS */
    fullResponse: z.string().min(1, "fullResponse is required"),
    /** Tipo de midia da resposta */
    responseMode: ResponseModeSchema,
    /** MIME type (ex: "image/jpeg", "application/pdf") — obrigatorio quando responseMode requer midia */
    mediaType: z.string().optional(),
    /** URL externa do arquivo — obrigatorio quando responseMode requer midia */
    mediaUrl: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const needsMedia = (MODES_REQUIRING_MEDIA as readonly string[]).includes(
      data.responseMode
    );
    if (needsMedia) {
      if (!data.mediaType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `mediaType is required when responseMode is "${data.responseMode}"`,
          path: ["mediaType"],
        });
      }
      if (!data.mediaUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `mediaUrl is required when responseMode is "${data.responseMode}"`,
          path: ["mediaUrl"],
        });
      }
    }
  });

export type BrainOutput = z.infer<typeof BrainOutputSchema>;
```

**Resultado verificado:** [VERIFIED: teste runtime com Bun 1.3.2 + Zod 3.25.76]
- `{ fullResponse: "hello", responseMode: "text" }` — valida (true)
- `{ fullResponse: "speak this", responseMode: "audio" }` — valida (true)
- `{ fullResponse: "caption", responseMode: "image", mediaType: "image/jpeg", mediaUrl: "https://..." }` — valida (true)
- `{ fullResponse: "caption", responseMode: "image" }` — invalido, 2 issues: mediaType required, mediaUrl required
- `{ fullResponse: "see doc", responseMode: "document", mediaType: "application/pdf" }` — invalido, 1 issue: mediaUrl required
- `{ fullResponse: "", responseMode: "text" }` — `.parse()` lanca `ZodError`

### Padrao 2: BrainStateAnnotation com campo brainOutput

**O que e:** Adicionar `brainOutput: BrainOutput | null` ao `BrainStateAnnotation` existente em `packages/ai/src/graph/state.ts`.

**Dependency direction:** `packages/ai` ja depende de `packages/core` via `IBrain` importado no runner — MAS `state.ts` atualmente nao importa de `@brain-pkg/core`. A decisao D-11 cria uma dependencia direta de `packages/ai` → `packages/core` para o tipo `BrainOutput`. Verificar se essa direcao de dependencia ja existe ou cria ciclo.

**Verificacao de dependencias circulares:**
- `packages/core/package.json` ja declara `"@brain-pkg/ai": "workspace:*"` como dependencia
- Se `packages/ai` passar a importar de `@brain-pkg/core`, criaria um ciclo: `core → ai → core`

**Resolucao:** O tipo `BrainOutput` deve ser definido em um pacote sem dependencias upstream — candidatos: (a) `packages/shared` ou (b) definir o tipo em `packages/ai` e exporta-lo de la, enquanto `packages/core` importa de `@brain-pkg/ai`. Alternativa (c): `packages/core` nao importa de `@brain-pkg/ai` — apenas `packages/ai` importa de `@brain-pkg/core`.

**Verificacao do grafo de dependencias atual:** [VERIFIED: package.json de cada pacote]
```
packages/core    → depends on: @brain-pkg/ai, @brain-pkg/memory, @brain-pkg/database,
                                @brain-pkg/transport, @brain-pkg/observability, @brain-pkg/shared
packages/ai      → depends on: @brain-pkg/shared (e libs LangChain — NÃO depende de @brain-pkg/core)
packages/shared  → depends on: nada (pacote folha)
```

`packages/ai` NAO depende de `packages/core` atualmente. Adicionar `@brain-pkg/core` em `packages/ai` criaria um ciclo (`core → ai`, `ai → core`). [VERIFIED: cat packages/ai/package.json]

**Solucao correta:** Definir `BrainOutput` / `BrainOutputSchema` em `packages/core` (conforme D-11 descreve a intencao de direcao). Importar em `packages/ai/src/graph/state.ts` exige adicionar `@brain-pkg/core` como dependencia de `@brain-pkg/ai` — o que cria ciclo.

**Alternativa sem ciclo:** Definir o tipo `BrainOutput` em `packages/shared` (sem schema Zod, apenas o type) e importar em `packages/ai`. O schema Zod com `.superRefine()` fica em `packages/core`. `packages/ai` importa apenas o tipo TypeScript de `@brain-pkg/shared`.

**Alternativa mais simples:** Inlinar o tipo em `packages/ai/src/graph/state.ts` sem importar de nenhum pacote interno:
```typescript
// Inlined to avoid circular dependency (core → ai already exists)
export interface BrainOutput {
  fullResponse: string;
  responseMode: "text" | "image" | "audio" | "video" | "document";
  mediaType?: string;
  mediaUrl?: string;
}
```
E `packages/core` importa o tipo de `@brain-pkg/ai` (como ja faz para `BrainStateAnnotation`).

**Recomendacao do planejador:** Avaliar qual alternativa seguir. A mais conservadora e inlinar o type em `packages/shared` (sem Zod), manter o schema Zod em `packages/core`, e `packages/ai` importa o type de `@brain-pkg/shared`. Isso preserva o grafo de dependencias existente sem criar ciclos.

```typescript
// packages/ai/src/graph/state.ts — padrao de adicao de campo (last-write-wins)
// Source: padrao existente do projeto verificado em state.ts
import type { BrainOutput } from "@brain-pkg/shared"; // ou inlined

export const BrainStateAnnotation = Annotation.Root({
  schema_version: Annotation<number>({ default: () => 1, reducer: (_, next) => next }),
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  userId: Annotation<string>({ default: () => "", reducer: (_, next) => next }),
  sessionId: Annotation<string>({ default: () => "", reducer: (_, next) => next }),
  // D-09, D-10: brainOutput — last-write-wins, default null
  brainOutput: Annotation<BrainOutput | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
});
```

### Padrao 3: BrainRunner.run() — novo retorno e validacao

**O que e:** Substituir a extracao da ultima AIMessage por leitura de `result.brainOutput` + validacao com `BrainOutputSchema.parse()`.

```typescript
// packages/core/src/runner/runner.ts — trecho alterado
// Substituir Step 3 atual (linhas 224-229)

// Step 3: Validate structured output — D-14: lanca erro se brainOutput invalido
const rawOutput = result.brainOutput;
if (rawOutput === null || rawOutput === undefined) {
  throw new BrainOutputValidationError(
    "Brain graph returned null brainOutput — node must set state.brainOutput",
    { brainId: this.brain.id, threadId }
  );
}
// BrainOutputSchema.parse() lanca ZodError se invalido
const brainOutput = BrainOutputSchema.parse(rawOutput);

// Step 4: Persist long-term memory (MEM-04) — agora usa brainOutput.fullResponse
await this.memoryManager.saveContext({
  userId: event.IDLead,
  profileKey: "context",
  profileValue: {
    lastUserMessage: event.Message,
    lastReply: brainOutput.fullResponse,
    conversationId: threadId,
  },
});

return brainOutput; // Promise<BrainOutput | null>
```

### Padrao 4: brain-echo — no "llm" seta brainOutput

**O que e:** Estender o retorno do no "llm" para incluir `brainOutput`.

```typescript
// apps/brain-echo/src/brain.ts — extensao do no "llm"
// D-07, D-08: LLM retorna string, no monta BrainOutput manualmente

.addNode("llm", async (state) => {
  const contextWindowSize = /* ... igual ao atual ... */;
  const messagesForLLM = state.messages.slice(-contextWindowSize);

  const response = await ctx.llm.invoke([
    { role: "system", content: ctx.prompts["system"] },
    ...messagesForLLM,
  ]);

  // D-08: extrair content como string; montar BrainOutput manualmente
  const fullResponse =
    typeof response.content === "string" ? response.content : "";

  return {
    messages: [...state.messages, response],
    brainOutput: {
      fullResponse,
      responseMode: "text" as const,  // brain-echo e text-only
    },
  };
})
```

### Padrao 5: IBrainRunnerLike — atualizacao em packages/transport

**O que e:** A interface local `IBrainRunnerLike` em `packages/transport/src/webhook/handler.ts` atualmente declara `run(event: BrainEvent): Promise<{ reply: string } | null>`. Deve ser atualizada para `Promise<BrainOutput | null>`. Como transport nao deve importar de `@brain-pkg/core`, o tipo `BrainOutput` deve vir de `@brain-pkg/shared` (se colocado la) ou ser duck-typed localmente.

**Opcao mais simples:** Usar duck typing estrutural — `IBrainRunnerLike.run()` retorna `Promise<{ fullResponse: string; responseMode: string; [key: string]: unknown } | null>` ou simplesmente `Promise<object | null>`. O handler extrai `result.fullResponse` em vez de `result.reply`.

### Anti-patterns a Evitar

- **Nao usar `.withStructuredOutput()`** — decisao D-07 e explicita: o LLM retorna string, o no monta o objeto
- **Nao retornar `{ reply }` wrapper** — o breaking change e intencional (D-12, D-13)
- **Nao silenciar erro de validacao** — D-14 exige throw explicito, nunca retorno silencioso
- **Nao criar ciclo de dependencia** — `packages/ai` NAO deve importar de `@brain-pkg/core`

---

## Don't Hand-Roll

| Problema | Nao construir | Usar | Por que |
|----------|---------------|------|---------|
| Validacao condicional de schema | Custom `if/else` na entrada do runner | `z.superRefine()` do Zod | Integrado com erros tipados, mensagens por campo, `safeParse`/`parse` consistentes |
| Tipagem de enum em runtime | `const enum` TypeScript | `z.enum()` + `z.infer<>` | Type e enum derivados do mesmo source of truth; eliminina inconsistencia |
| Custom error class | `throw new Error()` generico | `BrainOutputValidationError extends BrainError` | Permite `catch (e instanceof BrainOutputValidationError)` no handler e nos testes |

---

## Common Pitfalls

### Pitfall 1: Ciclo de dependencia packages/ai <-> packages/core

**O que da errado:** Tentar importar `BrainOutput` de `@brain-pkg/core` dentro de `packages/ai/src/graph/state.ts` cria ciclo — `packages/core` ja depende de `@brain-pkg/ai`.

**Por que acontece:** D-11 descreve a intencao como "core exporta o tipo/schema, ai o usa no state" sem verificar o grafo de dependencias existente.

**Como evitar:** Definir o tipo TypeScript `BrainOutput` em `packages/shared` (sem Zod) ou inline em `packages/ai`. O schema Zod (`BrainOutputSchema`) fica exclusivamente em `packages/core`. `packages/ai` importa apenas o type, nao o schema.

**Sinais de alerta:** Erro de build circular dependency ou `bun install` reclamando de circular workspace references.

### Pitfall 2: Testes existentes quebram com novo retorno de run()

**O que da errado:** `brain-runner.test.ts` asserta `expect(result).toHaveProperty("reply")` e `expect(Object.keys(result)).toEqual(["reply"])` — ambos falham com o novo retorno `BrainOutput`.

**Por que acontece:** A mudanca de retorno do runner e um breaking change intencional (D-13) mas os testes nao foram atualizados.

**Como evitar:** Atualizar `brain-runner.test.ts` para: (a) mudar o mock do `compiledGraph.invoke()` para incluir `brainOutput` no resultado, e (b) assertar `result.fullResponse` e `result.responseMode` em vez de `result.reply`.

**Arquivos afetados identificados:** [VERIFIED: grep no projeto]
- `packages/core/src/runner/__tests__/brain-runner.test.ts` — linhas 199-228
- `packages/transport/src/webhook/handler.ts` — `IBrainRunnerLike` e `result.reply`
- `packages/transport/src/webhook/handler.test.ts` — linha 58 mock retorna `{ reply: "..." }`
- `apps/brain-echo/src/__tests__/unit/brain.test.ts` — testes de contrato
- `apps/brain-echo/src/__tests__/integration/webhook.test.ts` — linha com `reply: string`
- `apps/brain-echo/src/__tests__/integration/restart.test.ts` — `body.reply`

### Pitfall 3: BrainOutputSchema.parse() lanca ZodError, nao BrainOutputValidationError

**O que da errado:** `BrainOutputSchema.parse(rawOutput)` quando invalido lanca `ZodError` do Zod, nao a classe de erro customizada do projeto. O catch em `handler.ts` pode logar e mascarar o erro real sem a mensagem de contexto.

**Como evitar:** Envolver `.parse()` em try/catch e re-lancar como `BrainOutputValidationError`:
```typescript
try {
  const brainOutput = BrainOutputSchema.parse(rawOutput);
} catch (err) {
  if (err instanceof ZodError) {
    throw new BrainOutputValidationError(
      `BrainOutput schema validation failed: ${err.message}`,
      { brainId: this.brain.id, issues: err.issues }
    );
  }
  throw err;
}
```
Alternativamente, usar `.safeParse()` e checar `success === false` para montar o erro customizado.

### Pitfall 4: brain-echo nao compila por tipo incompativel no retorno do no

**O que da errado:** O no "llm" retorna `{ messages: [...], brainOutput: { ... } }` mas `BrainStateAnnotation` ainda nao tem o campo `brainOutput` — TypeScript recusa o build.

**Por que acontece:** Ordem de implementacao errada — `brain.ts` atualizado antes de `state.ts`.

**Como evitar:** Implementar nesta ordem: (1) tipo `BrainOutput` em shared/ai, (2) schema em core, (3) state annotation em ai, (4) runner em core, (5) brain-echo.

### Pitfall 5: saveContext usa result.reply que nao existe mais

**O que da errado:** `runner.ts` linha 237 usa `reply` (string extraida da ultima AIMessage) para persistir no MemoryManager. Apos a mudanca, essa variavel nao existe mais — deve ser substituida por `brainOutput.fullResponse`.

**Como evitar:** Ao substituir o Step 3, garantir que `brainOutput.fullResponse` e passado para `saveContext` no Step 4.

---

## Code Examples

Verificados contra codigo do projeto:

### Exemplo 1: BrainOutputValidationError (nova classe em packages/shared)

```typescript
// packages/shared/src/errors/index.ts — adicionar apos ConfigurationError
export class BrainOutputValidationError extends BrainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "BRAIN_OUTPUT_VALIDATION_ERROR", context);
    this.name = "BrainOutputValidationError";
  }
}
```

### Exemplo 2: Exportacoes no barrel de packages/core/src/index.ts

```typescript
// Adicionar ao packages/core/src/index.ts
// SDK-06: BrainOutput contract
export { BrainOutputSchema } from "./output/schema.js";
export type { BrainOutput, ResponseMode } from "./output/schema.js";

// Remover BrainRunResult das exportacoes (D-13 — breaking change)
// export type { BrainRunnerOptions, BrainRunResult } from "./runner/runner.js";
export type { BrainRunnerOptions } from "./runner/runner.js"; // BrainRunResult removido
```

### Exemplo 3: Mock atualizado em brain-runner.test.ts

```typescript
// Atualizar makeBrain() para retornar brainOutput no invoke mock
buildGraph: mock(() => ({
  compile: mock(() => ({
    invoke: mock(async () => ({
      messages: [new HumanMessage("hello"), new AIMessage("test reply")],
      brainOutput: {
        fullResponse: "test reply",
        responseMode: "text",
      },
    })),
    getState: mock(async () => ({ values: { messages: [] } })),
  })),
})) as unknown as IBrain["buildGraph"],
```

### Exemplo 4: IBrainRunnerLike atualizado em packages/transport

```typescript
// packages/transport/src/webhook/handler.ts
// Duck-typed para evitar dependencia de @brain-pkg/core
export interface IBrainRunnerLike {
  run(event: BrainEvent): Promise<{
    fullResponse: string;
    responseMode: string;
    mediaType?: string;
    mediaUrl?: string;
  } | null>;
}

// No handler, substituir result.reply por result.fullResponse
return c.json({ status: "ok", reply: result.fullResponse }); // reply mantido na resposta HTTP
```

---

## State of the Art

| Abordagem antiga | Abordagem atual | Quando mudou | Impacto |
|-----------------|----------------|--------------|---------|
| `run()` retorna `{ reply: string }` | `run()` retorna `BrainOutput \| null` | Phase 10 | Breaking — todo consumidor de runner.run() precisa atualizar |
| Extracao da AIMessage no runner | No do grafo monta BrainOutput | Phase 10 | Logica de extracao sobe para o Brain (D-07/D-08) |
| String plana como output valido | Apenas BrainOutput valida | Phase 10 | Qualquer Brain que retorne string nao compila |

---

## Assumptions Log

| # | Claim | Section | Risk se Errado |
|---|-------|---------|----------------|
| A1 | `packages/video` nao requer `responseMode: "video"` ter tratamento especial alem de exigir mediaType/mediaUrl | Architecture Patterns | Baixo — video esta na tabela de modos definida pelo usuario |
| A2 | `packages/ai` sera atualizado para adicionar zod como dependencia direta se o tipo BrainOutput vier de @brain-pkg/shared com Zod | Standard Stack | Medio — se shared nao usar Zod, nao ha conflito; se usar, adicionar zod a shared |
| A3 | `IBrainRunnerLike` pode usar duck typing estrutural sem importar @brain-pkg/core em packages/transport | Architecture Patterns | Baixo — TypeScript structural typing garante compatibilidade |

---

## Open Questions (RESOLVED)

1. **Onde definir o tipo TypeScript `BrainOutput` para evitar ciclo de dependencia?**
   - O que sabemos: `packages/ai` nao pode importar de `@brain-pkg/core`; `packages/core` exporta o schema Zod
   - O que era incerto: Se o type vai em `@brain-pkg/shared` (limpo, sem Zod) ou inline em `@brain-pkg/ai`
   - RESOLVED: Tipo `BrainOutput` definido como interface TypeScript pura em `packages/shared/src/types/index.ts` (sem Zod). `packages/core/src/output/schema.ts` re-exporta o type de `@brain-pkg/shared` apos derivar com `z.infer<>`. `packages/ai` importa apenas `import type { BrainOutput } from "@brain-pkg/shared"` — sem ciclo. Veja Plano 01 Task 1 e Plano 02 Task 1.

2. **O handler webhook deve continuar retornando `reply` na resposta HTTP?**
   - O que sabemos: A decisao D-12 e sobre o SDK; a API HTTP e responsabilidade do transport
   - O que era incerto: Se o campo na resposta JSON muda de `{ reply }` para `{ fullResponse }` ou permanece `{ reply }`
   - RESOLVED: Campo `reply` mantido na resposta HTTP do webhook — handler extrai `result.fullResponse` e retorna `{ status: "ok", reply: result.fullResponse }`. Evita breaking change na API publica sem motivo de negocio. Veja Plano 03 Task 2.

---

## Environment Availability

Step 2.6: SKIPPED — fase e puramente de codigo e tipagem TypeScript; sem dependencias externas alem das ja instaladas no monorepo (Zod ja presente em packages/transport).

---

## Validation Architecture

### Test Framework

| Propriedade | Valor |
|-------------|-------|
| Framework | `bun test` (built-in, Bun 1.3.2) |
| Config file | Nenhum — `bun test` e zero config |
| Quick run command | `bun test packages/core/src` |
| Full suite command | `bun test packages/core/src packages/ai/src packages/transport/src apps/brain-echo/src/__tests__/unit` |

### Phase Requirements → Test Map

| Req ID | Comportamento | Tipo de Teste | Comando | Arquivo Existe? |
|--------|--------------|---------------|---------|-----------------|
| PARSER-01 | `BrainOutputSchema` valida todas as combinacoes de responseMode corretamente | unit | `bun test packages/core/src/__tests__/unit/output` | Wave 0 |
| PARSER-01 | `BrainOutputSchema.parse()` lanca `ZodError` para outputs invalidos | unit | idem | Wave 0 |
| PARSER-01 | `mediaType`/`mediaUrl` obrigatorios para image/video/document | unit | idem | Wave 0 |
| PARSER-02 | `BrainRunner.run()` retorna `BrainOutput` (nao `{ reply }`) | unit | `bun test packages/core/src/runner/__tests__` | Existente — atualizar |
| PARSER-02 | `BrainRunner.run()` lanca erro quando `brainOutput` e null ou invalido | unit | idem | Existente — atualizar |
| PARSER-02 | brain-echo compila e testes passam com novo contrato | unit | `bun test apps/brain-echo/src/__tests__/unit` | Existente — atualizar |

### Sampling Rate

- **Por commit de task:** `bun test packages/core/src`
- **Por wave merge:** `bun test packages/core/src packages/ai/src packages/transport/src apps/brain-echo/src/__tests__/unit`
- **Phase gate:** Suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/__tests__/unit/output/schema.test.ts` — cobre PARSER-01 (arquivo nao existe)
- [ ] `packages/shared/src/types/index.ts` — pode precisar de BrainOutput interface (depende da decisao de onde definir o tipo)

---

## Security Domain

### Applicable ASVS Categories

| Categoria ASVS | Aplica | Controle Padrao |
|----------------|--------|-----------------|
| V2 Authentication | nao | sem autenticacao nova nesta fase |
| V3 Session Management | nao | sem sessao nova |
| V4 Access Control | nao | sem controle de acesso novo |
| V5 Input Validation | sim | `BrainOutputSchema` valida saida do LLM antes de retornar |
| V6 Cryptography | nao | sem criptografia |

### Threat Patterns

| Pattern | STRIDE | Mitigacao |
|---------|--------|-----------|
| LLM retorna JSON malformado ou com campos inesperados | Tampering | `BrainOutputSchema.parse()` rejeita qualquer output que nao case com o schema |
| Brain retorna `responseMode` invalido injetando valor nao permitido | Tampering | `z.enum(["text","image","audio","video","document"])` rejeita qualquer outro valor em runtime |
| `fullResponse` vazio podendo causar TTS silencioso ou resposta em branco | Denial of Service | `z.string().min(1)` garante que string vazia falha na validacao |

---

## Sources

### Primary (HIGH confidence)

- Codigo existente do projeto verificado via leitura direta — `packages/core/src/runner/runner.ts`, `packages/ai/src/graph/state.ts`, `apps/brain-echo/src/brain.ts`, `packages/transport/src/webhook/handler.ts`
- Zod 3.25.76 `.superRefine()` API — verificado em runtime com Bun 1.3.2 (script de teste executado no projeto)
- Grafo de dependencias — verificado via `package.json` de cada pacote do monorepo

### Secondary (MEDIUM confidence)

- [CITED: zod.dev/api] — API `.superRefine()`, `z.enum()`, `z.infer<>`

### Tertiary (LOW confidence)

- Nenhum

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — Zod ja instalado e API verificada em runtime
- Architecture: HIGH — codigo existente lido diretamente; ciclo de dependencia identificado por analise do package.json
- Pitfalls: HIGH — todos identificados por analise do codigo real (arquivos de teste, handler.ts)

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (stack estavel; Zod 3.x nao tem breaking changes previstos)
