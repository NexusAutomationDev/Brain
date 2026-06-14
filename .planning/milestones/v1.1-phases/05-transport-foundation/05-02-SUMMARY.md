---
phase: 05-transport-foundation
plan: 02
subsystem: tooling
tags: [lint, eslint, typescript-eslint, turbo, ci]
requirements: [INFRA-02]
dependency_graph:
  requires: []
  provides: [lint-pipeline-active]
  affects: [all-packages]
tech_stack:
  added:
    - "@typescript-eslint/parser@5.62.0"
    - "@typescript-eslint/eslint-plugin@5.62.0"
  patterns:
    - "turbo run lint delegates to per-package eslint src/ --ext .ts"
    - "root .eslintrc.js with plugin:@typescript-eslint/recommended extends to all packages"
key_files:
  created: []
  modified:
    - path: "package.json"
      change: "Add @typescript-eslint/parser + @typescript-eslint/eslint-plugin to devDependencies"
    - path: ".eslintrc.js"
      change: "Extend plugin:@typescript-eslint/recommended, add Bun global, replace no-unused-vars with @typescript-eslint/no-unused-vars, ignore *.test.ts and dist/"
    - path: "packages/shared/package.json"
      change: "Add lint script: eslint src/ --ext .ts"
    - path: "packages/database/package.json"
      change: "Add lint script: eslint src/ --ext .ts"
    - path: "packages/observability/package.json"
      change: "Add lint script: eslint src/ --ext .ts"
    - path: "packages/ai/package.json"
      change: "Add lint script: eslint src/ --ext .ts"
    - path: "packages/memory/package.json"
      change: "Add lint script: eslint src/ --ext .ts"
    - path: "packages/transport/package.json"
      change: "Add lint script: eslint src/ --ext .ts"
    - path: "packages/core/package.json"
      change: "Add lint script: eslint src/ --ext .ts"
    - path: "packages/core/src/runner/runner.ts"
      change: "Remove unused BrainStateAnnotation import (dead import)"
    - path: "packages/database/src/pool-manager.ts"
      change: "Add eslint-disable-next-line for intentional empty onnotice callback"
decisions:
  - "Use eslint src/ --ext .ts instead of eslint src/ — ESLint v8 does not detect .ts files without explicit --ext flag"
  - "Extend plugin:@typescript-eslint/recommended in .eslintrc.js — provides @typescript-eslint/no-unused-vars which understands TypeScript constructor parameter syntax"
  - "Add ignorePatterns for *.test.ts in .eslintrc.js — aligns with D-13 (tests out of scope for lint in this phase)"
  - "Add Bun global in .eslintrc.js — avoids no-undef false positive for Bun runtime API"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-13"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 11
---

# Phase 5 Plan 02: Lint Pipeline Activation Summary

**One-liner:** ESLint v8 + @typescript-eslint/recommended activated across all 7 monorepo packages with `turbo run lint` passing 7/7 with zero errors.

## What Was Built

Ativou o pipeline de lint que estava no-op desde o v1.0. O `turbo.json` já tinha a task `lint` definida, mas nenhum pacote tinha o script correspondente e as dependências `@typescript-eslint` não estavam declaradas.

**Resultado final:** `turbo run lint` → `Tasks: 7 successful, 7 total` sem erros em nenhum pacote.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Instalar deps e adicionar scripts lint nos 7 pacotes | `9704e5a` | `package.json`, 7x `packages/*/package.json`, `pnpm-lock.yaml` |
| 2 | Verificar turbo run lint e corrigir erros de lint | `10dbd63` | `.eslintrc.js`, `runner.ts`, `pool-manager.ts` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint v8 não detecta .ts sem --ext flag**
- **Found during:** Task 2 (primeira execução do turbo lint)
- **Issue:** O script `eslint src/` não encontrava arquivos TypeScript — ESLint v8 escaneia apenas `.js` por padrão quando recebe um diretório sem extensão explícita
- **Fix:** Alterei todos os 7 scripts para `eslint src/ --ext .ts`
- **Files modified:** 7x `packages/*/package.json`
- **Commit:** `10dbd63`

**2. [Rule 2 - Missing critical config] .eslintrc.js sem @typescript-eslint rules ativas**
- **Found during:** Task 2 (erros de lint reais descobertos)
- **Issue:** O `.eslintrc.js` declarava `parser: '@typescript-eslint/parser'` mas não ativava as regras do plugin. Resultado: `no-unused-vars` base do ESLint disparava falsos positivos em parâmetros de construtor TypeScript com `public readonly`; `Bun` global não reconhecido; `*.test.ts` incorretamente incluídos no lint
- **Fix:** Extendi `plugin:@typescript-eslint/recommended`, substituí `no-unused-vars` por `@typescript-eslint/no-unused-vars` (que entende TypeScript), adicionei `Bun` em globals, adicionei `ignorePatterns` para testes
- **Files modified:** `.eslintrc.js`
- **Commit:** `10dbd63`

**3. [Rule 1 - Bug] Dead import em core/runner.ts**
- **Found during:** Task 2 (lint reporting unused var)
- **Issue:** `BrainStateAnnotation` importado de `@brain-pkg/ai` mas não usado no arquivo
- **Fix:** Removido do import statement
- **Files modified:** `packages/core/src/runner/runner.ts`
- **Commit:** `10dbd63`

**4. [Rule 1 - Bug] Empty function em database/pool-manager.ts**
- **Found during:** Task 2 (lint reporting no-empty-function)
- **Issue:** `onnotice: () => {}` dispara `@typescript-eslint/no-empty-function`; o callback vazio é intencional para suprimir mensagens NOTICE do PostgreSQL
- **Fix:** Adicionado `eslint-disable-next-line @typescript-eslint/no-empty-function` com comentário explicativo
- **Files modified:** `packages/database/src/pool-manager.ts`
- **Commit:** `10dbd63`

## Known Stubs

Nenhum stub identificado — este plano é de tooling puro (scripts e configuração), sem componentes de UI ou dados.

## Threat Surface Scan

Nenhuma nova superfície de ataque introduzida — ESLint é dev tooling, não afeta runtime ou dados de produção. Alinhado com T-05-06 e T-05-07 do threat model do plano.

## Lint Results (Final)

```
turbo run lint
Tasks: 7 successful, 7 total
Cached: 7 cached, 7 total
Time: 640ms >>> FULL TURBO
```

Packages:
- `@brain-pkg/shared` — OK (0 errors)
- `@brain-pkg/database` — OK (0 errors)
- `@brain-pkg/observability` — OK (0 errors)
- `@brain-pkg/ai` — OK (0 errors)
- `@brain-pkg/memory` — OK (0 errors)
- `@brain-pkg/transport` — OK (0 errors, dependente de Plan 01 para DedupCache)
- `@brain-pkg/core` — OK (0 errors, 2 warnings não-bloqueantes para non-null assertions intencionais)

## Self-Check: PASSED

Verificações:
- `package.json` contém `@typescript-eslint/parser` e `@typescript-eslint/eslint-plugin` ✓
- 7 pacotes com script lint ✓
- `find packages/ -name '.eslintrc.js'` retorna 0 ✓
- `turbo run lint` → Tasks: 7 successful ✓
- Commits `9704e5a` e `10dbd63` existem no histórico ✓
