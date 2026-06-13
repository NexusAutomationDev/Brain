---
plan: "02-03"
phase: "02-domain-packages"
subsystem: packages/ai
status: complete
wave: 3
completed_at: "2026-06-11"
tags: [ai, llm, embeddings, factory, env-config]
dependency_graph:
  requires: ["02-02"]
  provides: ["createLLM", "createEmbeddings", "packages/ai barrel"]
  affects: ["packages/core (Phase 3)", "Brain implementations"]
tech_stack:
  added: ["@langchain/openai (ChatOpenAI, OpenAIEmbeddings)", "@langchain/anthropic (ChatAnthropic)", "@langchain/google-genai (ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings)"]
  patterns: ["env-driven provider factory", "dynamic import switch", "mock.module TDD"]
key_files:
  created:
    - packages/ai/src/llm/factory.ts
    - packages/ai/src/embeddings/factory.ts
  modified:
    - packages/ai/src/llm/factory.test.ts
    - packages/ai/src/embeddings/factory.test.ts
    - packages/ai/src/index.ts
decisions:
  - "createLLM is async to support dynamic import per provider (avoids bundling all providers)"
  - "createEmbeddings derives provider from LLM_PROVIDER env, defaulting to openai"
  - "API_KEY never included in ConfigurationError context — only {provider} or {model: 'missing'}"
metrics:
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 3
  completed_date: "2026-06-11"
requirements_satisfied: [AI-04, AI-05]
---

# Phase 2 Plan 03: LLM Factory & Embeddings Factory Summary

**One-liner:** Env-driven LLM and embeddings factories for 4 providers (OpenAI, Anthropic, Gemini, OpenRouter) with ConfigurationError on missing env and complete packages/ai barrel export.

## O que foi implementado

### Task 1: createLLM factory (AI-05, D-06, D-07, D-08)

**`packages/ai/src/llm/factory.ts`** — criado do zero.

- `createLLM(options?)` é `async` para suportar dynamic import por provider (evita bundle de todos os providers)
- Lê `LLM_PROVIDER`, `LLM_MODEL`, `API_KEY` do `process.env` — zero defaults hardcoded
- Suporta 4 providers via switch:
  - `openai` → `ChatOpenAI` de `@langchain/openai`
  - `anthropic` → `ChatAnthropic` de `@langchain/anthropic`
  - `gemini` → `ChatGoogleGenerativeAI` de `@langchain/google-genai`
  - `openrouter` → `ChatOpenAI` com `baseURL: "https://openrouter.ai/api/v1"` (OpenAI-compatible)
- Throws `ConfigurationError("LLM_PROVIDER env var is required")` quando ausente (D-07)
- Throws `ConfigurationError("Unknown LLM_PROVIDER: {x}")` para valor desconhecido
- `API_KEY` nunca aparece em mensagens de erro ou contexto (T-2-03)

**`packages/ai/src/llm/factory.test.ts`** — stubs `.todo` substituídos por 8 testes reais:
- Missing `LLM_PROVIDER` → `ConfigurationError`
- Mensagem de erro correta
- Provider desconhecido → `ConfigurationError` com "Unknown LLM_PROVIDER"
- 4 testes de provider (openai, anthropic, gemini, openrouter) com `mock.module`
- API_KEY não vaza em erro (T-2-03)

### Task 2: createEmbeddings factory + barrel export (AI-04)

**`packages/ai/src/embeddings/factory.ts`** — criado do zero.

- `createEmbeddings()` lê `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `API_KEY` do `process.env`
- `dimensions` lido via `parseInt(process.env.EMBEDDING_DIMENSIONS, 10)` — sem hardcoded 1536
- Provider derivado de `LLM_PROVIDER` env (default `openai`):
  - `gemini` → `GoogleGenerativeAIEmbeddings`
  - default (openai/openrouter) → `OpenAIEmbeddings`
- Throws `ConfigurationError("EMBEDDING_MODEL env var is required")` quando ausente
- `API_KEY` nunca em contexto de erro

**`packages/ai/src/embeddings/factory.test.ts`** — stubs substituídos por 5 testes reais:
- Missing `EMBEDDING_MODEL` → `ConfigurationError`
- Mensagem de erro correta
- Retorna instância quando configurado (mocked)
- `EMBEDDING_DIMENSIONS=10` → vetor de 10 elementos
- `FakeEmbeddings` funciona (valida infra de teste para D-11)

**`packages/ai/src/index.ts`** — placeholder `export {}` substituído por barrel completo:
- Exporta 6 símbolos públicos: `BrainStateAnnotation`, `BrainState`, `createCheckpointer`, `createLLM`, `LLMOptions`, `createEmbeddings`

## Commits

| Hash | Arquivo | Descrição |
|------|---------|-----------|
| `3d7034c` | `llm/factory.ts`, `llm/factory.test.ts` | feat: createLLM factory com suporte a 4 providers (AI-05) |
| `fc34a6f` | `embeddings/factory.ts`, `embeddings/factory.test.ts`, `index.ts` | feat: createEmbeddings factory e barrel export completo (AI-04) |

## Invariantes verificadas

- Nenhum model string hardcoded em `factory.ts` (`"gpt-4o"`, `"claude-"`, `"text-embedding-"` como literais de valor)
- `API_KEY` nunca em `ConfigurationError` context ou mensagem
- `EMBEDDING_DIMENSIONS` lido do env, nunca defaultado para `1536` no código
- Barrel exporta exatamente os 6 símbolos especificados no plano

## Dependências satisfeitas para Wave 4+

Wave 4 (memory package e demais) podem agora importar de `@brain-pkg/ai`:
```typescript
import { BrainStateAnnotation, BrainState, createCheckpointer, createLLM, LLMOptions, createEmbeddings } from "@brain-pkg/ai";
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — todas as factories estão completamente implementadas e wired ao env.

## Threat Flags

Nenhum novo surface de segurança além do documentado no `<threat_model>` do plano:
- T-2-03-01: API_KEY em erros do createLLM → mitigado (context contém apenas `{ provider }`)
- T-2-03-02: API_KEY em erros do createEmbeddings → mitigado (context contém apenas `{ model: "missing" }`)
- T-2-03-03: LLM_PROVIDER allowlist → mitigado (switch com default `ConfigurationError`)

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/ai/src/llm/factory.ts | FOUND |
| packages/ai/src/embeddings/factory.ts | FOUND |
| packages/ai/src/index.ts | FOUND |
| .planning/phases/02-domain-packages/02-03-SUMMARY.md | FOUND |
| commit 3d7034c (createLLM factory) | FOUND |
| commit fc34a6f (createEmbeddings + barrel) | FOUND |
