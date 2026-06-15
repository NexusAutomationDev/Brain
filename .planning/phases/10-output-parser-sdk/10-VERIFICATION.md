---
phase: 10-output-parser-sdk
verified: 2026-06-15T04:04:20Z
status: gaps_closed
score: 8/8 must-haves verified
overrides_applied: 0
gaps_resolved:
  - truth: "BrainRunner.run() lança BrainOutputValidationError quando brainOutput é null após invoke"
    status: resolved
    fixed_by: "10-04-PLAN.md"
    resolution: "Remoção dos arquivos .js stale (errors/index.js, types/index.js, utils/index.js, index.js) de packages/shared/src/ e correção do arquivo de teste brain-runner.test.ts para usar mock.module() e DATABASE_URL fake"
    verified: "2026-06-15T15:56:54Z"

  - truth: "Testes unitários do BrainRunner passam com novo contrato"
    status: resolved
    fixed_by: "10-04-PLAN.md"
    resolution: "Consequência da remoção dos .js stale — bun agora resolve ./errors/index.js para ./errors/index.ts, expondo BrainOutputValidationError. 17 testes passam."
    verified: "2026-06-15T15:56:54Z"

deferred:
  - truth: "Brain SDR retorna BrainOutput em todas as respostas (PARSER-03)"
    addressed_in: "Phase 12"
    evidence: "Phase 12 success criteria: 'Brain SDR retorna BrainOutput estruturado em todas as respostas — webhook e RabbitMQ entregam JSON com fullResponse e responseMode'. PARSER-03 mapeado para Phase 12 na tabela de traceability de REQUIREMENTS.md."
---

# Phase 10: Output Parser SDK — Verification Report

**Phase Goal:** O SDK define e aplica um contrato de saída estruturado — todo Brain retorna `BrainOutput` com `fullResponse` e `responseMode` obrigatórios; string plana deixa de ser output válido
**Verified:** 2026-06-15T04:04:20Z
**Re-verified:** 2026-06-15T15:56:54Z
**Status:** gaps_closed
**Re-verification:** Yes — após gap closure por 10-04-PLAN.md

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BrainOutputSchema valida todos os 5 valores de responseMode | VERIFIED | packages/core/src/output/schema.ts existe com z.enum(["text","image","audio","video","document"]) e superRefine; 9 testes passam |
| 2 | mediaType e mediaUrl são exigidos apenas para image, video e document | VERIFIED | superRefine condicional em schema.ts com MODES_REQUIRING_MEDIA; coberto por 4 testes no schema.test.ts |
| 3 | fullResponse vazia falha na validação com ZodError | VERIFIED | z.string().min(1) em BrainOutputSchema; teste "fullResponse vazia" passa |
| 4 | BrainOutput type está disponível em @brain-pkg/shared sem ciclo de dependência | VERIFIED | packages/shared/src/types/index.ts contém `export interface BrainOutput` e `export type ResponseMode`; packages/ai importa de @brain-pkg/shared (não core) |
| 5 | BrainOutputValidationError permite catch específico separado de ConfigurationError | VERIFIED | packages/shared/src/errors/index.ts contém `class BrainOutputValidationError extends BrainError` com code BRAIN_OUTPUT_VALIDATION_ERROR |
| 6 | packages/core exporta BrainOutputSchema, BrainOutput e ResponseMode no barrel | VERIFIED | packages/core/src/index.ts contém as linhas SDK-06 exportando BrainOutputSchema, ResponseModeSchema, BrainOutput, ResponseMode |
| 7 | BrainRunner.run() lança BrainOutputValidationError quando brainOutput é null após invoke | VERIFIED | Plano 10-04 removeu arquivos .js stale de shared/src/ — bun resolve corretamente para .ts. `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` → 17 pass, 0 fail |
| 8 | Testes unitários do BrainRunner passam com novo contrato | VERIFIED | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` → 17 pass, 0 fail |

**Score:** 8/8 truths verified

### Deferred Items

Items não satisfeitos que são explicitamente endereçados em fases futuras do milestone.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Brain SDR migrado para Output Parser (PARSER-03) | Phase 12 | Phase 12 success criteria item 1: "Brain SDR retorna BrainOutput estruturado em todas as respostas". REQUIREMENTS.md Traceability: PARSER-03 → Phase 12 |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/shared/src/types/index.ts` | BrainOutput interface TypeScript | VERIFIED | Contém `export interface BrainOutput` e `export type ResponseMode` |
| `packages/shared/src/errors/index.ts` | BrainOutputValidationError extends BrainError | VERIFIED | Contém a classe com code BRAIN_OUTPUT_VALIDATION_ERROR |
| `packages/core/src/output/schema.ts` | BrainOutputSchema Zod com superRefine | VERIFIED | Arquivo existe com BrainOutputSchema, ResponseModeSchema, re-exporta types de shared |
| `packages/core/src/__tests__/unit/output/schema.test.ts` | 9 testes unitários PARSER-01 | VERIFIED | 9 testes existem e passam com `bun test` |
| `packages/ai/src/graph/state.ts` | brainOutput: Annotation<BrainOutput \| null> | VERIFIED | Campo adicionado com default null e reducer last-write-wins |
| `packages/core/src/runner/runner.ts` | BrainRunner.run() retorna Promise<BrainOutput \| null> | VERIFIED | Código implementado corretamente; 17 testes do runner passam após gap closure |
| `packages/core/src/runner/__tests__/brain-runner.test.ts` | Testes atualizados com BrainOutput | VERIFIED | Assertions corretas (result.fullResponse, result.responseMode); 17 pass, 0 fail após fix de mock.module() e DATABASE_URL |
| `apps/brain-echo/src/brain.ts` | Nó "llm" seta state.brainOutput | VERIFIED | Contém `brainOutput: { fullResponse, responseMode: "text" as const }` |
| `packages/transport/src/webhook/handler.ts` | IBrainRunnerLike com duck typing; reply usa fullResponse | VERIFIED | Interface atualizada; `return c.json({ status: "ok", reply: result.fullResponse })` |
| `packages/transport/src/webhook/handler.test.ts` | Mock com fullResponse/responseMode | VERIFIED | Mock atualizado para `{ fullResponse: "Olá! Posso te ajudar.", responseMode: "text" as const }` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/core/src/output/schema.ts` | `packages/core/src/index.ts` | named export SDK-06 | WIRED | `export { BrainOutputSchema, ResponseModeSchema } from "./output/schema.js"` presente no barrel |
| `packages/shared/src/types/index.ts` | `packages/core/src/output/schema.ts` | re-export type | WIRED | schema.ts faz `export type { ResponseMode, BrainOutput } from "@brain-pkg/shared"` |
| `packages/ai/src/graph/state.ts` | `@brain-pkg/shared` | import type BrainOutput | WIRED | `import type { BrainOutput } from "@brain-pkg/shared"` no topo de state.ts |
| `packages/core/src/runner/runner.ts` | `BrainOutputSchema` | BrainOutputSchema.parse(rawOutput) | WIRED | Linha 235: `brainOutput = BrainOutputSchema.parse(rawOutput)` |
| `packages/core/src/runner/runner.ts` | `BrainOutputValidationError` | throw new BrainOutputValidationError | WIRED | Código correto; gap de resolução de módulo resolvido por 10-04 (remoção de .js stale) |
| `packages/transport/src/webhook/handler.ts` | `result.fullResponse` | reply: result.fullResponse na HTTP response | WIRED | Linha 84: `return c.json({ status: "ok", reply: result.fullResponse })` |
| `apps/brain-echo/src/brain.ts` | `BrainStateAnnotation.brainOutput` | retorno do nó "llm" | WIRED | Nó retorna `{ messages, brainOutput: { fullResponse, responseMode: "text" as const } }` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| BrainOutputSchema valida text mode | `bun test packages/core/src/__tests__/unit/output` | 9 pass, 0 fail | PASS |
| BrainRunner.run() tests | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | 17 pass, 0 fail | PASS |
| brain-echo unit tests | `bun test apps/brain-echo/src/__tests__/unit` | 10 pass, 0 fail | PASS |
| transport webhook tests | `bun test packages/transport/src` | 32 pass, 0 fail | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PARSER-01 | 10-01-PLAN.md | SDK expõe Output Parser com JSON schema definido — fullResponse/responseMode obrigatórios; mediaType/mediaUrl condicionais | SATISFIED | BrainOutputSchema em core, BrainOutput type em shared, 9 testes unitários verdes |
| PARSER-02 | 10-02-PLAN.md, 10-03-PLAN.md, 10-04-PLAN.md | Todos os Brains retornam exclusivamente o formato estruturado | SATISFIED | Contrato definido, runner.ts implementado, testes do runner 17/17 verdes após gap closure (10-04) |
| PARSER-03 | N/A (Phase 12) | Brain SDR migrado para usar Output Parser | DEFERRED | Mapeado para Phase 12 em REQUIREMENTS.md — fora de escopo da Fase 10 |

### Anti-Patterns Resolved

| File | Pattern | Status | Resolution |
|------|---------|--------|------------|
| `packages/shared/src/errors/index.js` | Arquivo .js compilado desatualizado em diretório src/ | RESOLVED | Removido por 10-04 — bun agora resolve para .ts |
| `packages/shared/src/types/index.js` | Arquivo .js desatualizado em src/ com `export {}` (placeholder da Fase 1) | RESOLVED | Removido por 10-04 |

### Human Verification Required

Nenhum item requer verificação humana nesta fase.

## Gap Closure Summary

**Status final:** 8/8 truths verificadas — Fase 10 completa

Os 2 gaps identificados na verificação inicial foram fechados pelo plano 10-04:
1. **Arquivos .js stale removidos** — `packages/shared/src/errors/index.js` e outros removidos. Bun resolve `./errors/index.js` para `./errors/index.ts` corretamente.
2. **17 testes do BrainRunner passam** — Consequência direta da correção anterior + mocks para evitar conflito de zod v4 em bun 1.3.2.

---

_Verificado inicialmente: 2026-06-15T04:04:20Z_
_Re-verificado: 2026-06-15T15:56:54Z_
_Plano de gap closure: 10-04-PLAN.md_
_Verifier: Claude (gsd-executor)_
