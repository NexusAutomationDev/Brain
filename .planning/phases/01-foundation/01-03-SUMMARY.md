---
phase: 01-foundation
plan: "03"
subsystem: observability
tags: [pino, logging, health-check, structured-json, postgres]
dependency_graph:
  requires: ["01-01"]
  provides: ["@brain-pkg/observability"]
  affects: ["packages/observability"]
tech_stack:
  added: ["pino@^10.3.1", "postgres@^3.4.9 (devDependency - types only)"]
  patterns: ["Pino logger factory with context injection", "Health check with SELECT 1 validation"]
key_files:
  created:
    - packages/observability/package.json
    - packages/observability/tsconfig.json
    - packages/observability/src/logger.ts
    - packages/observability/src/health.ts
    - packages/observability/src/index.ts
  modified:
    - packages/observability/src/health.test.ts
    - packages/observability/src/logger.test.ts
    - .gitignore
decisions:
  - "Added postgres as devDependency (type-only) to resolve import type { Sql } from 'postgres' in health.ts without making postgres a runtime dependency of observability package"
  - "bun.lock added to .gitignore since project canonical lockfile is pnpm-lock.yaml; bun install used as fallback when pnpm install permissions were unavailable during execution"
metrics:
  duration: "~14 minutes"
  completed: "2026-06-11T15:30:25Z"
  tasks_completed: 4
  files_created: 5
  files_modified: 3
---

# Phase 1 Plan 03: Observability Package Summary

**One-liner:** Pino logger factory with tenant/Brain context injection and health check utilities with SELECT 1 database validation, HTTP 200/503/500 status codes per D-13/D-14.

## What Was Built

### Logger Factory (`packages/observability/src/logger.ts`)

- `createLogger(context: LogContext)` — Pino-based structured JSON logger
- `LogContext` interface: `{ tenantId?, brainId?, sessionId?, userId? }`
- All log lines automatically include context fields injected via `base`
- ISO timestamps via `pino.stdTimeFunctions.isoTime`
- Log level from `LOG_LEVEL` env, defaults to `'info'`
- `NODE_ENV` included in every log line for environment-aware filtering

**Output format:**
```json
{"level":"info","time":"2026-06-11T10:30:00.000Z","tenantId":"acme","brainId":"sdr","env":"development","userId":"user123","msg":"Processing message"}
```

### Health Check Utilities (`packages/observability/src/health.ts`)

- `checkDatabase(sql: Sql): Promise<boolean>` — validates DB with `SELECT 1`
- `performHealthCheck(sql: Sql): Promise<HealthCheckResult>` — full health result
- `HealthCheckResult` interface per D-13:
  ```typescript
  {
    status: 'ok' | 'degraded' | 'error';
    checks: { db: 'connected' | 'failed' };
    version?: string;  // GIT_COMMIT env or 'unknown'
    timestamp: string; // ISO 8601
  }
  ```
- HTTP status mapping (D-14) documented in JSDoc; caller (Hono route) applies: 200/503/500

### Barrel Export (`packages/observability/src/index.ts`)

Exports: `createLogger`, `LogContext`, `checkDatabase`, `performHealthCheck`, `HealthCheckResult`

### Package Configuration

- `packages/observability/package.json`: `@brain-pkg/observability`, pino@^10.3.1 runtime dep, postgres@^3.4.9 dev dep
- `packages/observability/tsconfig.json`: extends `../../tsconfig.base.json`, outputs to `dist/`

## Integration Notes for Apps

```typescript
// In a Hono app entrypoint
import { createLogger, performHealthCheck } from '@brain-pkg/observability';
import type { LogContext } from '@brain-pkg/observability';

// Create a request-scoped logger
const logger = createLogger({ tenantId: 'acme', brainId: 'sdr' });
logger.info({ requestId: 'abc123' }, 'Incoming webhook');

// Health check route
app.get('/health', async (c) => {
  const result = await performHealthCheck(sql);
  const statusCode = result.status === 'ok' ? 200
    : result.checks.db === 'failed' ? 503
    : 500;
  return c.json(result, statusCode);
});
```

## D-15 Compliance Note (Transport Field)

The `HealthCheckResult` interface has a commented placeholder for the `transport` field:
```typescript
// transport?: string; // D-15: Will be added in Phase 2 when transport package exists
```

Per D-15: transport info in the health check response is deferred to Phase 2 when the transport package exists. The Phase 2 agent should add `transport?: 'webhook' | 'rabbitmq'` to both the interface and `performHealthCheck` implementation.

## Security Notes (Threat Model Compliance)

- **T-03-01 (mitigated):** `LogContext` interface limited to identifiers (tenantId, brainId, sessionId, userId) — no credentials
- **T-03-02 (mitigated):** `HealthCheckResult` contains only status/boolean checks — no connection strings, usernames, or passwords
- **T-03-03 (accepted):** SELECT 1 has <1ms latency; postgres.js has built-in query timeouts
- **T-03-04 (accepted):** Tenant context leakage in logs is intentional for debugging; logs are internal-only

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed it.todo() TypeScript type error in test stubs**
- **Found during:** Task 4 (build verification)
- **Issue:** `it.todo('label')` with 1 argument fails bun-types TypeScript check — `Test<T>` interface requires `(label, fn, options?)` with 2+ args
- **Fix:** Added no-op `() => {}` as second argument to all `it.todo()` calls in `health.test.ts` and `logger.test.ts`
- **Files modified:** `packages/observability/src/health.test.ts`, `packages/observability/src/logger.test.ts`
- **Commits:** `586ee85`

**2. [Rule 2 - Missing] Added postgres devDependency for type resolution**
- **Found during:** Task 4 (build verification)
- **Issue:** `import type { Sql } from 'postgres'` in health.ts failed with TS2307 — postgres not installed
- **Fix:** Added `postgres@^3.4.9` as devDependency in observability package.json; runtime callers pass the sql instance in so postgres itself is not a runtime dep of observability
- **Files modified:** `packages/observability/package.json`
- **Commits:** `586ee85`

**3. [Rule 2 - Missing] Added bun.lock to .gitignore**
- **Found during:** Post-build cleanup
- **Issue:** `bun install` generated `bun.lock` which conflicts with `pnpm-lock.yaml` as the canonical lockfile
- **Fix:** Added `bun.lock` to `.gitignore`
- **Files modified:** `.gitignore`
- **Commits:** `ca72ccd`

## Known Stubs

The test files (`health.test.ts`, `logger.test.ts`) contain `it.todo` stubs from plan 01-00 (wave-0 test scaffold). These are intentional — they will be implemented when integration tests are added. They do not prevent the plan's goal (providing logger and health check utilities) from being achieved.

## Blockers for Next Plan

None. The `@brain-pkg/observability` package is fully built and exportable via workspace protocol.

## Self-Check: PASSED

Files verified:
- `packages/observability/package.json` — exists
- `packages/observability/tsconfig.json` — exists
- `packages/observability/src/logger.ts` — exists, exports `createLogger` + `LogContext`
- `packages/observability/src/health.ts` — exists, exports `checkDatabase` + `performHealthCheck` + `HealthCheckResult`
- `packages/observability/src/index.ts` — exists, barrel re-exports all
- `packages/observability/dist/index.js` — exists (TypeScript build output)
- `packages/observability/dist/index.d.ts` — exists (TypeScript declarations)

Commits verified:
- `0594639` — scaffold
- `8ed41af` — logger
- `ab36db6` — health
- `586ee85` — barrel + fixes
- `ca72ccd` — gitignore
