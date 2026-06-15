---
phase: 10-output-parser-sdk
plan: "01"
subsystem: api
tags: [zod, output-parser, brain-output, schema-validation, typescript]

# Dependency graph
requires: []
provides:
  - BrainOutput interface TypeScript em packages/shared (sem Zod, sem ciclo de dependência)
  - ResponseMode type alias "text" | "image" | "audio" | "video" | "document" em packages/shared
  - BrainOutputValidationError extends BrainError com code BRAIN_OUTPUT_VALIDATION_ERROR
  - BrainOutputSchema (Zod) com validação condicional superRefine em packages/core/src/output/schema.ts
  - ResponseModeSchema (z.enum) exportado de packages/core
  - Barrel de packages/core atualizado com exports SDK-06
  - 9 testes unitários cobrindo PARSER-01 (todos verdes)
affects:
  - 10-02-PLAN (BrainRunner integra BrainOutputSchema.parse + BrainOutputValidationError)
  - 10-03-PLAN (brain-sdr usa BrainOutput como retorno do grafo LangGraph)

# Tech tracking
tech-stack:
  added:
    - zod@4.4.3 (dependência direta de packages/core)
  patterns:
    - BrainOutputSchema.superRefine() para validação condicional de campos dependentes de responseMode
    - Separação type (shared) vs schema (core) para evitar ciclo de dependência ai→core
    - TDD RED→GREEN para schema Zod: criar testes primeiro, implementar depois

key-files:
  created:
    - packages/core/src/output/schema.ts
    - packages/core/src/__tests__/unit/output/schema.test.ts
  modified:
    - packages/shared/src/types/index.ts
    - packages/shared/src/errors/index.ts
    - packages/core/src/index.ts
    - packages/core/package.json

key-decisions:
  - "BrainOutput como interface TypeScript pura em packages/shared — zod fica só em packages/core para evitar ciclo packages/ai→packages/core"
  - "superRefine() para validação condicional image/video/document: permite múltiplos issues simultâneos (mediaType + mediaUrl) — z.refine() só reporta um"
  - "ResponseMode como type alias (não enum TS) em shared + z.enum em core — consistência sem duplicação de valores"

patterns-established:
  - "Pattern SDK-06: type em shared, schema Zod em core — padrão para contratos de saída dos Brains"
  - "Pattern TDD para schemas Zod: escrever casos de falha primeiro (RED), depois implementar superRefine (GREEN)"

requirements-completed:
  - PARSER-01

# Metrics
duration: 15min
completed: "2026-06-15"
---

# Phase 10 Plan 01: Output Parser SDK — BrainOutput Contract Summary

**BrainOutputSchema Zod com validação condicional superRefine (image/video/document exigem mediaType+mediaUrl), BrainOutput interface TypeScript em shared e BrainOutputValidationError, todos exportados via barrel de packages/core**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-15T03:15:00Z
- **Completed:** 2026-06-15T03:31:38Z
- **Tasks:** 1 (TDD — RED + GREEN em único commit)
- **Files modified:** 6 (+ 2 criados)

## Accomplishments

- BrainOutput interface TypeScript pura em packages/shared (folha — sem dependências internas) define o contrato de saída de todos os Brains
- BrainOutputSchema Zod em packages/core valida em runtime todos os 5 valores de responseMode com regra condicional: image/video/document exigem mediaType + mediaUrl; text e audio não
- BrainOutputValidationError permite catch específico separado de ConfigurationError, com code 'BRAIN_OUTPUT_VALIDATION_ERROR'
- 9 testes unitários verdes cobrindo PARSER-01 (incluindo safeParse, superRefine com múltiplos issues simultâneos)
- BrainRunResult removido do barrel de packages/core (preparação para plano 02)

## Task Commits

1. **Task 1: BrainOutput type + BrainOutputSchema + testes unitários** — `59c3148` (feat)

## Files Created/Modified

- `packages/core/src/output/schema.ts` — BrainOutputSchema, ResponseModeSchema; re-exporta BrainOutput e ResponseMode de shared
- `packages/core/src/__tests__/unit/output/schema.test.ts` — 9 testes unitários cobrindo PARSER-01 (TDD)
- `packages/shared/src/types/index.ts` — BrainOutput interface + ResponseMode type alias (era placeholder vazio)
- `packages/shared/src/errors/index.ts` — BrainOutputValidationError adicionada após ConfigurationError
- `packages/core/src/index.ts` — exports SDK-06 adicionados; BrainRunResult removido do barrel
- `packages/core/package.json` — zod@^4.4.3 adicionado como dependência direta

## Decisions Made

- **BrainOutput em shared (sem Zod):** packages/ai importa de packages/shared mas não pode importar de packages/core (core já depende de ai). Zod como dependência de runtime em shared causaria ciclo — então interface TypeScript pura em shared, schema Zod em core.
- **superRefine() em vez de z.discriminatedUnion():** discriminatedUnion exigiria schemas separados por responseMode (mais verboso); superRefine com MODES_REQUIRING_MEDIA é mais simples e suporta múltiplos issues simultâneos no mesmo campo.
- **ResponseMode como type alias em shared + z.enum em core:** evita duplicação de valores mantendo type safety em ambos os pacotes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Caminho de import relativo incorreto no arquivo de teste**
- **Found during:** Task 1 (RED phase — primeiro run dos testes)
- **Issue:** O plano especificava `../../../../output/schema.js` mas o arquivo de teste está em `src/__tests__/unit/output/`, então 4 níveis acima chegaria em `packages/core/` (não em `src/`). O caminho correto é `../../../output/schema.js` (3 níveis).
- **Fix:** Corrigido para `../../../output/schema.js` antes de rodar o GREEN
- **Files modified:** `packages/core/src/__tests__/unit/output/schema.test.ts`
- **Verification:** `bun test packages/core/src/__tests__/unit/output` — 9 testes verdes
- **Committed in:** 59c3148 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug no caminho de import)
**Impact on plan:** Correção necessária para que os testes funcionassem. Sem impacto em scope.

## Issues Encountered

- `bun add zod` migrou o lockfile de pnpm-lock.yaml para bun.lockb automaticamente. Não há impacto — o lockfile do monorepo é gerenciado pelo workspace root.

## Known Stubs

Nenhum — todos os campos exportados têm implementação real. Não há dados hardcoded, placeholders ou mock data fluindo para produção.

## Threat Flags

Nenhuma — os arquivos criados são puramente de definição de schema/tipos sem endpoints de rede, acesso a arquivos ou autenticação.

## Next Phase Readiness

- packages/core e packages/shared exportam o contrato de saída completo — plano 02 pode integrar BrainOutputSchema.parse() no BrainRunner.run()
- BrainRunResult já removido do barrel — plano 02 pode remover também do runner.ts sem breaking change externo
- 9 testes unitários verdes garantem que qualquer regressão no schema será detectada imediatamente

---
## Self-Check: PASSED

- FOUND: packages/core/src/output/schema.ts
- FOUND: packages/core/src/__tests__/unit/output/schema.test.ts
- FOUND: packages/shared/src/types/index.ts
- FOUND: packages/shared/src/errors/index.ts
- FOUND: packages/core/src/index.ts
- FOUND: .planning/phases/10-output-parser-sdk/10-01-SUMMARY.md
- FOUND commit: 59c3148
- Tests: 9 pass, 0 fail

---
*Phase: 10-output-parser-sdk*
*Completed: 2026-06-15*
