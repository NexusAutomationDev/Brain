---
phase: 09-brain-sdr
plan: "00"
subsystem: brain-sdr
tags: [tdd, scaffolding, test-stubs, wave-0]
dependency_graph:
  requires: []
  provides: [brain-sdr-test-scaffolding]
  affects: [09-01, 09-02, 09-03]
tech_stack:
  added: []
  patterns: [tdd-red-stubs, dynamic-import-isolation, test-skip-pattern]
key_files:
  created:
    - apps/brain-sdr/package.json
    - apps/brain-sdr/src/__tests__/unit/brain.test.ts
    - apps/brain-sdr/src/__tests__/integration/qualify.test.ts
  modified: []
decisions:
  - "Uso de import() dinâmico dentro dos tests para evitar falha de parse quando módulos ainda não existem (brain.js, qualifier.js)"
  - "test.skip() nos integration tests — executáveis sem banco real, ativados após Plan 02"
metrics:
  duration: "~15 min"
  completed: "2026-06-14T21:15:24Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
---

# Phase 09 Plan 00: Brain SDR — Test Scaffolding Summary

## One-liner

Scaffolding Nyquist Wave 0: package.json + stubs RED unitários (9 testes) + stubs skipped de integração (3 tests) para Brain SDR, garantindo RED antes de qualquer implementação.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Criar package.json do brain-sdr | c116881 | apps/brain-sdr/package.json |
| 2 | Criar stubs RED de testes unitários | 8298ea0 | apps/brain-sdr/src/__tests__/unit/brain.test.ts |
| 3 | Criar stubs de testes de integração | ac85903 | apps/brain-sdr/src/__tests__/integration/qualify.test.ts |

(Commit cc667ce: chore — restauração dos arquivos de plano após reset incorreto do worktree base)

## What Was Built

Scaffolding completo de testes para o Brain SDR seguindo o padrão Nyquist (testes antes da implementação):

**package.json** (`@brain-app/sdr`): cópia adaptada do brain-echo com adição de `@langchain/core ^1.1.48` e `zod ^3.25.76` — dependências necessárias para qualifier.ts (tool() e schema Zod). Scripts `test` e `test:integration` configurados.

**unit/brain.test.ts** (9 testes em 3 describes):
- `BrainSDR — IBrain contract (SDR-01, SDR-04)`: 5 testes verificando id, brainType, promptKeys, tools (qualify_lead), buildGraph
- `qualify_lead tool — contrato SDR-05`: 3 testes verificando name e campos do schema (description, session_id)
- `contextWindowSize — parse seguro (SDR-01, HIST-03)`: 1 teste validando lógica de fallback para ENV inválida (inline, sem import)

**integration/qualify.test.ts** (3 test.skip em 2 describes):
- `qualify_lead — integração E2E`: 2 testes skipped — runQualificationAgent com e sem checkpoint real
- `Brain SDR — integração completa`: 1 teste skipped — BrainRunner end-to-end placeholder

## Verification Results

1. Todos os 3 arquivos existem: PASS
2. `"test": "bun test src/__tests__/unit"`: PASS
3. `"test:integration": "bun test src/__tests__/integration"`: PASS
4. 9 calls a `test()` em unit/brain.test.ts: PASS (>= 8 exigido)
5. 3 calls a `test.skip` em integration/qualify.test.ts: PASS
6. Sem import estático de módulos inexistentes (usa `import()` dinâmico): PASS

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restauração de arquivos de plano deletados inadvertidamente**
- **Found during:** Task 1 commit
- **Issue:** O `git reset --soft` fez com que os 4 arquivos de plano (09-00 a 09-03) ficassem staged, sendo incluídos na deleção pelo commit de Task 1
- **Fix:** Restaurados via `git checkout a05c656 -- .planning/phases/09-brain-sdr/09-*.md` e recomitados (cc667ce)
- **Files modified:** .planning/phases/09-brain-sdr/09-00-PLAN.md, 09-01-PLAN.md, 09-02-PLAN.md, 09-03-PLAN.md
- **Commit:** cc667ce

## Known Stubs

Os arquivos de teste contêm imports dinâmicos de módulos que ainda não existem:
- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` → `../../brain.js` e `../../qualifier.js` — RED intencional
- `apps/brain-sdr/src/__tests__/integration/qualify.test.ts` → `../../qualifier.js` — skipped, não causa falha

Estes stubs são intencionais: Wave 0 garante que os testes existam antes do código. Os Plans 01 e 02 implementarão os módulos que farão estes testes passar (GREEN).

## Threat Flags

Nenhuma superfície de segurança nova introduzida — apenas arquivos de teste e package.json.

## Self-Check: PASSED

- [x] apps/brain-sdr/package.json existe
- [x] apps/brain-sdr/src/__tests__/unit/brain.test.ts existe
- [x] apps/brain-sdr/src/__tests__/integration/qualify.test.ts existe
- [x] Commits c116881, 8298ea0, ac85903 existem no log
