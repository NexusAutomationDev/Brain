---
phase: 03-brain-sdk
plan: "04"
subsystem: core
tags: [barrel-export, api-surface, reload-prompts, webhook-wiring, security]
dependency_graph:
  requires:
    - 03-03  # BrainRunner lifecycle (SDK-02)
    - 03-02  # loadPrompts (SDK-04)
    - 03-01  # IBrain, BrainRegistry, ToolsRegistry (SDK-01, SDK-03)
  provides:
    - packages/core public API barrel export
    - POST /reload-prompts management endpoint
    - WebhookHandler wired with BrainRunner
  affects:
    - packages/transport (handler.ts modified)
    - packages/core (index.ts, server.ts added)
tech_stack:
  added:
    - hono: ^4.12.0 added as direct dep of @brain-pkg/core (server.ts needs it)
  patterns:
    - Barrel export with explicit named exports (no export * — T-3-04-04)
    - Local interface (IBrainRunnerLike) for duck typing to avoid circular dep (T-3-04-03)
    - Fail-closed 503 when ADMIN_TOKEN not configured (T-3-04-02)
key_files:
  created:
    - packages/core/src/index.ts
    - packages/core/src/server.ts
  modified:
    - packages/transport/src/webhook/handler.ts
    - packages/core/package.json
    - .env.example
decisions:
  - "IBrainRunnerLike local interface used in handler.ts instead of importing BrainRunner from @brain-pkg/core to prevent circular dependency"
  - "createCoreApp returns 503 (not 401) when ADMIN_TOKEN env var is absent — fail closed on misconfiguration"
  - "createWebhookApp keeps runner as optional parameter for backward compatibility with existing tests"
metrics:
  duration: ~25 minutes
  completed: 2026-06-12
  tasks_completed: 2
  files_changed: 5
---

# Phase 3 Plan 04: Barrel Export, /reload-prompts, Transport Wiring Summary

**One-liner:** packages/core barrel export + authenticated /reload-prompts endpoint + WebhookHandler wired with BrainRunner via duck-typed local interface.

## What Was Built

### Task 1: Barrel export packages/core e endpoint /reload-prompts

**`packages/core/src/index.ts`** — public API barrel export:
- Exports `IBrain`, `BrainBuildContext` (SDK-01)
- Exports `BrainRegistry` (SDK-01)
- Exports `BrainRunner`, `BrainRunnerOptions`, `BrainRunResult` (SDK-02)
- Exports `ToolsRegistry` (SDK-03)
- Exports `loadPrompts` (SDK-04)
- Explicit named exports only — no `export *` (T-3-04-04)

**`packages/core/src/server.ts`** — management HTTP server:
- `createCoreApp(runner: BrainRunner): Hono`
- POST `/reload-prompts` protected by `X-Admin-Token` header vs `ADMIN_TOKEN` env var
- Returns 401 when token absent or incorrect (no timing distinction — T-3-04-01)
- Returns 503 when `ADMIN_TOKEN` env var not configured (fail closed — T-3-04-02)
- Returns 200 + calls `runner.refreshPrompts()` on valid token

**Commits:** `0a17fde`

### Task 2: Completar wiring do WebhookHandler com BrainRunner

**`packages/transport/src/webhook/handler.ts`** — Phase 3 wiring completed:
- `createWebhookApp(runner?: IBrainRunnerLike)` — optional runner parameter
- When runner present: `runner.run(event)` called, returns `{ status: "ok", reply: result.reply }`
- Without runner: fallback to `{ status: "accepted" }` (backward compatibility)
- `IBrainRunnerLike` local interface avoids circular dep (T-3-04-03):
  `packages/core → @brain-pkg/transport → @brain-pkg/core` cycle prevented

**Commits:** `3a37ae6`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Arquivos perdidos pelo git reset --soft**
- **Found during:** Após commit da Task 1
- **Issue:** O `git reset --soft` para rebasear a branch ao commit base deixou arquivos dos planos anteriores (runner.ts, loader.ts, migrations) no staging como "deletados". O commit da Task 1 os removeu inadvertidamente.
- **Fix:** Restaurados via `git show <hash>:<path>` e commitados em fix commit separado.
- **Files modified:** `packages/core/src/runner/runner.ts`, `packages/core/src/prompts/loader.ts`, `packages/database/src/migrations/0001_lazy_deathstrike.sql`, `packages/database/src/migrations/meta/0001_snapshot.json`, `.planning/phases/03-brain-sdk/03-02-SUMMARY.md`, `.planning/phases/03-brain-sdk/03-03-SUMMARY.md`
- **Commit:** `16c0fec`

**2. [Rule 2 - Missing Dependency] hono não listado como dependência direta do core**
- **Found during:** Verificação de typecheck pós-Task 1
- **Issue:** `packages/core/src/server.ts` importa `Hono` de `hono`, mas `hono` não estava em `dependencies` do `packages/core/package.json`. O package recebia hono transitivamente via outros packages mas dependências transitivas não são garantidas.
- **Fix:** Adicionado `hono: ^4.12.0` como dependência direta. Também adicionados `drizzle-orm` e `postgres` que já eram usados em `loader.ts` e `runner.ts`.
- **Files modified:** `packages/core/package.json`
- **Commit:** `c80336d`

**3. [Rule 1 - Bug] Tipo implícito any no .map() de loadPrompts**
- **Found during:** Verificação de typecheck pós-Task 1
- **Issue:** `rows.map((r) => ...)` em `loader.ts` tinha `r` com tipo implícito any com strict mode.
- **Fix:** Anotado explicitamente: `rows.map((r: { key: string; content: string }) => ...)`
- **Files modified:** `packages/core/src/prompts/loader.ts`
- **Commit:** `c80336d`

## Test Results

```
bun test packages/core
 8 pass, 8 todo, 0 fail  (16 tests across 4 files)

bun test packages/transport
 15 pass, 0 fail  (15 tests across 4 files)

Total: 23 pass, 8 todo, 0 fail
```

## Known Stubs

None. The barrel export wires real implementations. The `/reload-prompts` calls real `runner.refreshPrompts()`. The WebhookHandler calls real `runner.run(event)`.

## Threat Flags

No new threat surface introduced beyond what was planned in the plan's threat model.

## Self-Check: PASSED

- [x] `packages/core/src/index.ts` exists and exports all 5 symbols
- [x] `packages/core/src/server.ts` exists with 401/503 security checks
- [x] `packages/transport/src/webhook/handler.ts` contains `runner.run(` and `reply`
- [x] No `@brain-pkg/core` import in handler.ts (no circular dep)
- [x] Commits exist: `0a17fde`, `16c0fec`, `3a37ae6`, `c80336d`
- [x] All tests pass: 23 pass, 8 todo, 0 fail
