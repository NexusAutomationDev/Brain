---
phase: 03-brain-sdk
plan: "00"
subsystem: core-scaffold
tags: [scaffold, schema, test-stubs, nyquist]
dependency_graph:
  requires: []
  provides:
    - "@brain-pkg/core workspace package"
    - "tabela prompts no schema do banco"
    - "stubs de teste Wave 0 para SDK-01 a SDK-04"
  affects:
    - packages/database (nova tabela prompts)
    - tsconfig.base.json (novo alias @brain-pkg/core)
tech_stack:
  added: []
  patterns:
    - "Workspace package com 6 referências de projeto no tsconfig"
    - "Nyquist Wave 0: test.todo stubs antes da implementação"
    - "uniqueIndex no Drizzle para constraint de unicidade composta"
key_files:
  created:
    - packages/core/package.json
    - packages/core/tsconfig.json
    - packages/core/src/brain/__tests__/brain-registry.test.ts
    - packages/core/src/runner/__tests__/brain-runner.test.ts
    - packages/core/src/tools/__tests__/tools-registry.test.ts
    - packages/core/src/prompts/__tests__/loader.test.ts
  modified:
    - packages/database/src/schema/tables.ts
    - tsconfig.base.json
decisions:
  - "Incluiu uniqueIndex em (brain_type, key) na tabela prompts — mitiga T-3-00-01 (inserção de prompts duplicados causaria comportamento não-determinístico)"
  - "project references declaradas no tsconfig.json de core para todos os 6 packages — mitiga T-3-00-02 (imports de módulos não declarados)"
metrics:
  duration: "~2 minutos"
  completed_date: "2026-06-12"
  tasks_completed: 2
  files_changed: 8
---

# Phase 3 Plan 00: Core Scaffold e Schema Summary

Scaffold do `packages/core` como workspace package `@brain-pkg/core`, adição da tabela `prompts` ao schema Drizzle com constraint de unicidade, e criação dos 4 stubs de teste Nyquist Wave 0 para SDK-01 a SDK-04.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold packages/core e tabela prompts | d17d133 | packages/core/package.json, packages/core/tsconfig.json, packages/database/src/schema/tables.ts, tsconfig.base.json |
| 2 | Stubs de teste Wave 0 (Nyquist) | 5960bcb | 4 arquivos __tests__/ em packages/core/src/ |

## What Was Built

**packages/core workspace package:** Configurado como `@brain-pkg/core` com 6 workspace dependencies (`@brain-pkg/ai`, `@brain-pkg/memory`, `@brain-pkg/database`, `@brain-pkg/transport`, `@brain-pkg/observability`, `@brain-pkg/shared`). O `tsconfig.json` estende `../../tsconfig.base.json` e declara project references para todos os 6 packages dependency.

**Tabela prompts no schema:** Adicionada ao final de `packages/database/src/schema/tables.ts` com colunas `id` (UUID PK), `brain_type` (text), `key` (text), `content` (text), `created_at` e `updated_at` (timestamp). UNIQUE INDEX em `(brain_type, key)` garante que cada brain type tenha no máximo um valor por chave de prompt.

**Stubs de teste Nyquist Wave 0:** 4 arquivos com `test.todo` documentando os comportamentos esperados de cada requisito SDK. `bun test` retorna 16 todo, 0 fail — ambiente pronto para implementação nos Planos 01-03.

## Deviations from Plan

None — plano executado exatamente como escrito.

## Known Stubs

Nenhum stub de dado. Os `test.todo` são stubs de teste intencionais do padrão Nyquist Wave 0, não stubs de implementação. Os planos 01-03 irão implementar os módulos que esses testes exercitam.

## Threat Flags

Nenhuma superfície de segurança nova introduzida. A tabela `prompts` não expõe endpoint de rede — é apenas definição de schema Drizzle.

## Self-Check: PASSED

Arquivos verificados:
- FOUND: packages/core/package.json
- FOUND: packages/core/tsconfig.json
- FOUND: packages/core/src/brain/__tests__/brain-registry.test.ts
- FOUND: packages/core/src/runner/__tests__/brain-runner.test.ts
- FOUND: packages/core/src/tools/__tests__/tools-registry.test.ts
- FOUND: packages/core/src/prompts/__tests__/loader.test.ts
- FOUND: "@brain-pkg/core" em tsconfig.base.json
- FOUND: prompts_brain_type_key_idx em tables.ts

Commits verificados:
- d17d133: ✨ feat(03-00): scaffold packages/core e adicionar tabela prompts ao schema
- 5960bcb: ✅ test(03-00): adicionar stubs de teste Wave 0 para SDK-01 a SDK-04

bun test: 16 todo, 0 fail — OK
