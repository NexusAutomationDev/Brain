---
phase: "04-validation-brain"
plan: "02"
subsystem: "database, apps/brain-echo, packages/memory, packages/ai, packages/core, packages/transport"
tags: ["docker", "migration", "seed", "build-fix", "tsconfig"]
dependency_graph:
  requires:
    - "04-01 (apps/brain-echo workspace, runMigrations exportável)"
    - "04-00 (pnpm-lock.yaml atualizado)"
  provides:
    - "packages/database/src/migrations/0002_echo_brain_seed.sql (seed do system prompt echo/system)"
    - "apps/brain-echo/Dockerfile (imagem Docker multi-stage construível)"
    - "brain-echo-test Docker image (SC-1 verificado)"
  affects:
    - "packages/ai/src/llm/factory.ts (fix strict TS)"
    - "packages/ai/tsconfig.json (references para shared)"
    - "packages/core/src/index.ts (export createCoreApp)"
    - "packages/memory/src/manager.ts (import CheckpointTuple correto)"
    - "packages/memory/src/short-term.ts (import CheckpointTuple correto)"
    - "packages/memory/src/semantic.ts (fix embedding type)"
    - "packages/memory/package.json (@langchain/langgraph como dep)"
    - "packages/memory/tsconfig.json (references para ai/database/observability)"
    - "packages/transport/tsconfig.json (references para shared)"
    - "pnpm-lock.yaml (atualizado com @langchain/langgraph em memory)"
tech_stack:
  added: []
  patterns:
    - "Migration SQL idempotente via ON CONFLICT (brain_type, key) DO NOTHING"
    - "Dockerfile multi-stage: node:22-slim builder + oven/bun:1 runner"
    - "Compilação sequencial por package via pnpm --filter (resolve tsconfig paths issue)"
    - "TypeScript project references (composite) para monorepo cross-package"
key_files:
  created:
    - "packages/database/src/migrations/0002_echo_brain_seed.sql"
    - "apps/brain-echo/Dockerfile"
  modified:
    - "packages/ai/src/llm/factory.ts"
    - "packages/ai/tsconfig.json"
    - "packages/core/src/index.ts"
    - "packages/memory/src/manager.ts"
    - "packages/memory/src/short-term.ts"
    - "packages/memory/src/semantic.ts"
    - "packages/memory/package.json"
    - "packages/memory/tsconfig.json"
    - "packages/transport/tsconfig.json"
    - "pnpm-lock.yaml"
decisions:
  - "Builder stage usa node:22-slim em vez de oven/bun:1 — oven/bun:1 não tem npm, necessário para pnpm CLI"
  - "Compilação sequencial via pnpm --filter ao invés de turbo — tsconfig.base.json paths causam TS6059 com turbo"
  - "buildGraph() retorna any em brain.ts — StateGraph acumula tipos genéricos após addNode que não são assignables ao IBrain sem cast"
metrics:
  duration: "~45 minutos"
  completed_date: "2026-06-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 10
---

# Phase 4 Plan 02: Migration Seed + Dockerfile Multi-stage Summary

**One-liner:** Migration SQL 0002 semeia o system prompt echo/system de forma idempotente; Dockerfile multi-stage (node:22-slim builder + oven/bun:1 runner) constrói imagem distribuível com migrations SQL copiadas explicitamente.

## What Was Built

### Task 1: Migration SQL de seed do system prompt (D-06)

**packages/database/src/migrations/0002_echo_brain_seed.sql** criado com:

- `INSERT INTO prompts (brain_type, key, content)` com `brain_type='echo'`, `key='system'`
- Prompt em português: "Você é um assistente útil. Responda às perguntas do usuário de forma clara e concisa. Se não souber a resposta, diga isso honestamente."
- `ON CONFLICT (brain_type, key) DO NOTHING` — idempotente (seguro rodar múltiplas vezes)
- Usa a constraint do UNIQUE INDEX criado em `0001_lazy_deathstrike.sql`

### Task 2: Dockerfile multi-stage (D-07, D-08)

**apps/brain-echo/Dockerfile** criado com 2 estágios:

**Stage 1 (builder — `node:22-slim`):**
- Copia workspace manifests + tsconfig + turbo.json
- `pnpm install --frozen-lockfile` — reprodutível
- Compilação sequencial por package (shared → database → observability → ai → transport → memory → core → brain-echo)

**Stage 2 (runner — `oven/bun:1`):**
- Copia `dist/` de cada package individualmente (resolve symlinks pnpm — Pitfall 3)
- Copia `node_modules/` por package (deps externas não-workspace)
- Copia migrations SQL para `/app/migrations/` explicitamente (Pitfall 1 — não estão em dist/)
- `ENV MIGRATIONS_DIR=/app/migrations` — entrypoint usa essa env var
- `USER bun` — segurança (não-root)
- `CMD ["bun", "apps/brain-echo/dist/index.js"]`

**Resultado do docker build:**
```
#43 exporting to image
#43 writing image sha256:ec30f12049c3... done
#43 naming to docker.io/library/brain-echo-test
brain-echo-test:latest — 419MB
```

**Migrations SQL na imagem:**
```
docker run --rm brain-echo-test ls /app/migrations/
0000_lyrical_scrambler.sql
0001_lazy_deathstrike.sql
0002_echo_brain_seed.sql
meta/
```

## Commits

| Task | Hash | Mensagem |
|------|------|----------|
| Task 1 | `27376b4` | ✨ feat(database): add echo brain system prompt seed migration (04-02) |
| Restore (worktree reset) | `cae51d1` | 🔧 chore(brain-echo): restore 04-01 files after worktree reset |
| Task 2 | `b920261` | ✨ feat(brain-echo): add Dockerfile multi-stage + fix TypeScript build errors (04-02) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] builder stage usa node:22-slim em vez de oven/bun:1**
- **Found during:** Task 2 — primeiro docker build
- **Issue:** `oven/bun:1` não tem `npm` disponível (`npm: not found`). O RESEARCH especificava `npm install -g pnpm` mas oven/bun:1 (Debian 13 trixie) não tem npm nos repositórios e não tem curl/wget para instalar via script
- **Fix:** Mudar o builder stage para `node:22-slim` que tem npm. O runner stage permanece `oven/bun:1` (conforme D-07). `bun install -g pnpm` foi testado como alternativa mas o pnpm CLI exige `node:sqlite` que o Bun não implementa
- **Files modified:** `apps/brain-echo/Dockerfile`

**2. [Rule 1 - Bug] pnpm build (turbo) falha com TS6059 rootDir violation**
- **Found during:** Task 2 — segundo docker build após fix do builder stage
- **Issue:** O `tsconfig.base.json` define `paths` que mapeiam `@brain-pkg/*` para `packages/*/src`. Quando turbo compila cada package individualmente, o tsc resolve esses paths e inclui arquivos `.ts` de outros packages no rootDir do package atual, violando `rootDir: ./src`
- **Fix:** Substituir `pnpm build` (turbo) por compilação sequencial via `pnpm --filter @brain-pkg/xxx build` na ordem de dependência. Adicionado `references` nos tsconfigs de `transport`, `ai` e `memory` para corretude do project references
- **Files modified:** `apps/brain-echo/Dockerfile`, `packages/ai/tsconfig.json`, `packages/memory/tsconfig.json`, `packages/transport/tsconfig.json`

**3. [Rule 1 - Bug] `@langchain/langgraph-checkpoint` não existe como dep direta de memory**
- **Found during:** Task 2 — build de `packages/memory`
- **Issue:** `manager.ts` e `short-term.ts` importavam `CheckpointTuple` de `@langchain/langgraph-checkpoint` (pacote transitivo, não declarado). No Docker, apenas deps declaradas são instaladas
- **Fix:** Trocar import para `@langchain/langgraph` (que re-exporta `CheckpointTuple`). Adicionado `@langchain/langgraph` como dep direta de `packages/memory`. Movido `@langchain/langgraph-checkpoint-postgres` de devDependencies para dependencies
- **Files modified:** `packages/memory/src/manager.ts`, `packages/memory/src/short-term.ts`, `packages/memory/package.json`, `pnpm-lock.yaml`

**4. [Rule 1 - Bug] `embedding: input.embedding as unknown as string` — tipo incorreto**
- **Found during:** Task 2 — build de `packages/memory`
- **Issue:** `semantic.ts` fazia cast de `number[]` para `string` para contornar o tipo do drizzle pgvector. O drizzle `vector()` aceita `number[]` diretamente — o cast era incorreto e gerava erro TS2769
- **Fix:** Remover o cast incorreto — passar `number[]` diretamente
- **Files modified:** `packages/memory/src/semantic.ts`

**5. [Rule 1 - Bug] `createCoreApp` não exportada de `@brain-pkg/core`**
- **Found during:** Task 2 — build de `@brain-app/echo`
- **Issue:** `server.ts` importava `createCoreApp` de `@brain-pkg/core`, mas a função existia em `packages/core/src/server.ts` sem estar no barrel `index.ts`
- **Fix:** Adicionar `export { createCoreApp } from "./server.js"` ao `packages/core/src/index.ts`
- **Files modified:** `packages/core/src/index.ts`

**6. [Rule 1 - Bug] `createLLM` em `packages/ai` falha com TS2769 para Gemini**
- **Found during:** Task 2 — build de `packages/ai`
- **Issue:** `ChatGoogleGenerativeAI` exige `model: string` (não `string | undefined`). Com TypeScript strict, `process.env.LLM_MODEL` é `string | undefined`
- **Fix:** Adicionar casts locais `model as string` e `apiKey as string` com comentário explicando que a validação fica com o SDK do provider
- **Files modified:** `packages/ai/src/llm/factory.ts`

**7. [Rule 1 - Bug] `buildGraph()` retorna tipo incompatível com `IBrain`**
- **Found during:** Task 2 — build de `@brain-app/echo`
- **Issue:** `StateGraph` acumula tipos genéricos após `addNode("llm")` — o tipo inferido `StateGraph<..., Set<[("__start__" | "llm")[], ...]>>` não é assignable ao `StateGraph<typeof BrainStateAnnotation>` da interface `IBrain`
- **Fix:** Declarar `buildGraph(): any` no echoBrain (local, não na interface). Comentário explica a razão
- **Files modified:** `apps/brain-echo/src/brain.ts`

## Known Stubs

Nenhum stub de dados introduzido neste plano. O system prompt é funcional (não placeholder).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: supply-chain | apps/brain-echo/Dockerfile | Builder stage usa node:22-slim (registry Docker Hub). Risk: supply chain attack no node image — aceito para v1; considerar image pinning por digest em produção |

## Self-Check: PASSED

- [x] `packages/database/src/migrations/0002_echo_brain_seed.sql` existe
- [x] Arquivo contém `INSERT INTO prompts (brain_type, key, content)`
- [x] Arquivo contém `'echo'` como brain_type
- [x] Arquivo contém `'system'` como key
- [x] Arquivo contém `ON CONFLICT (brain_type, key) DO NOTHING`
- [x] Arquivo NÃO contém `DO UPDATE`
- [x] `apps/brain-echo/Dockerfile` existe com `FROM node:22-slim AS builder`
- [x] Dockerfile contém `FROM oven/bun:1 AS runner`
- [x] Dockerfile contém `pnpm install --frozen-lockfile`
- [x] Dockerfile contém `COPY --from=builder /app/packages/database/src/migrations ./migrations`
- [x] Dockerfile contém `ENV MIGRATIONS_DIR=/app/migrations`
- [x] Dockerfile contém `CMD ["bun", "apps/brain-echo/dist/index.js"]`
- [x] Dockerfile contém `USER bun`
- [x] `docker build` completou com exit code 0
- [x] `docker images brain-echo-test` mostra a imagem criada (419MB)
- [x] `docker run --rm brain-echo-test ls /app/migrations/` lista os 3 arquivos SQL + meta/
- [x] Commits `27376b4`, `cae51d1`, `b920261` existem no histórico
