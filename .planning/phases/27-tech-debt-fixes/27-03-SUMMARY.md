---
phase: 27-tech-debt-fixes
plan: "03"
requirements-completed: [TECH-03]
subsystem: transport,observability,brain-sdr
tags: [tech-debt, health-check, transport-status, obs-02, tech-03]
dependency_graph:
  requires: []
  provides: [transport-status-in-health, getStatus-interface]
  affects: [brain-sdr-startup, health-endpoint]
tech_stack:
  added: []
  patterns:
    - ITransportLike duck typing in observability (avoids circular dependency with transport package)
    - TransportStatus snapshot on getStatus() (no-arg, always synchronous)
    - HTTP 503 for transport disconnected (degraded state)
key_files:
  created:
    - packages/transport/src/__tests__/unit/transport-status.test.ts
    - packages/observability/src/__tests__/unit/health-transport.test.ts
  modified:
    - packages/transport/src/interface.ts
    - packages/transport/src/index.ts
    - packages/transport/src/webhook/handler.ts
    - packages/transport/src/rabbitmq/consumer.ts
    - packages/observability/src/health.ts
    - packages/observability/src/index.ts
    - packages/observability/src/server.ts
    - apps/brain-sdr/src/server.ts
    - apps/brain-sdr/src/index.ts
decisions:
  - ITransportLike defined locally in observability/health.ts (duck typing) to avoid circular dependency: transport→observability→transport
  - TransportStatus mirrored in observability/health.ts — identical shape to transport's TransportStatus
  - WebhookTransport.start() NOT called in brain-sdr/index.ts (mode webhook) — Bun.serve above already serves /api/v1/webhook; transport created only for getStatus() in /health
  - HTTP 503 for status 'degraded' (transport disconnected) — Brain not processing messages = critical failure
metrics:
  duration_minutes: 32
  completed_date: "2026-06-30"
  tasks_completed: 2
  files_changed: 9
---

# Phase 27 Plan 03: Transport Status in GET /health Summary

OBS-02 corrigido: GET /health agora expõe TransportStatus (type + connected) refletindo estado real da conexão, retornando HTTP 503 quando o transport está desconectado.

## What Was Built

### Task 1: TransportStatus + getStatus() na interface e implementações (commits: 4999127)

Adicionado `TransportStatus` type e `ITransport.getStatus()` na interface do transport package, com implementações em `WebhookTransport` e `RabbitMQTransport`.

**Novos contratos:**

```typescript
// packages/transport/src/interface.ts
export interface TransportStatus {
  type: 'webhook' | 'rabbitmq';
  connected: boolean;
}

export interface ITransport {
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
  getStatus(): TransportStatus;  // NOVO — TECH-03
}
```

- `WebhookTransport.getStatus()` sempre retorna `{ type: 'webhook', connected: true }` — HTTP server não tem estado de conexão separado
- `RabbitMQTransport`: novo campo `private connected = false`; setado para `true` no evento `'connection'` do rabbitmq-client; `false` no `stop()`
- `RabbitMQTransport.getStatus()` retorna estado real: `{ type: 'rabbitmq', connected: this.connected }`

### Task 2: HealthCheckResult expandido + createHealthApp() com transport + brain-sdr rewired (commit: 4dfcee5)

**HealthCheckResult expandido (backward compatible):**

```typescript
// packages/observability/src/health.ts
export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  checks: {
    db: 'connected' | 'failed';
    transport?: 'connected' | 'disconnected';  // NOVO
  };
  transport?: TransportStatus;  // NOVO — { type, connected }
  version?: string;
  timestamp: string;
}
```

**performHealthCheck() expandida:**

```typescript
export async function performHealthCheck(sql: Sql, transport?: ITransportLike): Promise<HealthCheckResult>
```

Lógica de status:
- `'ok'` — db ok + transport ok (ou sem transport)
- `'degraded'` — db ok + transport desconectado
- `'error'` — db falhou (mais grave)

**createHealthApp() expandida:**

```typescript
export function createHealthApp(sql: Sql, transport?: ITransportLike): Hono
```

HTTP status mapping:
- `200` — status 'ok'
- `503` — status 'degraded' OU db failed
- `500` — status 'error' (internal)

**brain-sdr/src/server.ts:**

```typescript
export function createServer(sql: Sql, runner: BrainRunner, transport?: ITransport): Hono
```

Passa `transport` para `createHealthApp(sql, transport)`.

**Novo startup sequence em brain-sdr/src/index.ts:**

```typescript
// ANTES: transport criado apenas para rabbitmq, APÓS createServer()
// DEPOIS: transport criado ANTES de createServer() em ambos os modos

const transport = createTransport(runner);        // 1. criar transport (webhook ou rabbitmq)
const app = createServer(sql, runner, transport); // 2. montar app com transport para /health
Bun.serve({ port, fetch: app.fetch });            // 3. subir HTTP server

// 4. iniciar transport (apenas rabbitmq precisa de start() explícito)
if (transportType === "rabbitmq") {
  await transport.start();
}
```

## Exemplo de Resposta GET /health

**Modo webhook (conectado):**
```json
{
  "status": "ok",
  "checks": {
    "db": "connected",
    "transport": "connected"
  },
  "transport": {
    "type": "webhook",
    "connected": true
  },
  "version": "abc1234",
  "timestamp": "2026-06-30T13:39:55.000Z"
}
```

**Modo rabbitmq (desconectado):**
```json
{
  "status": "degraded",
  "checks": {
    "db": "connected",
    "transport": "disconnected"
  },
  "transport": {
    "type": "rabbitmq",
    "connected": false
  },
  "version": "abc1234",
  "timestamp": "2026-06-30T13:39:55.000Z"
}
```
HTTP status: `503`

**Sem transport (brain-echo — backward compat):**
```json
{
  "status": "ok",
  "checks": {
    "db": "connected"
  },
  "version": "abc1234",
  "timestamp": "2026-06-30T13:39:55.000Z"
}
```
HTTP status: `200`

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `ITransportLike` duck typing em observability | `@brain-pkg/transport` depende de `@brain-pkg/observability` (createLogger). Importar transport em observability criaria ciclo circular. Duck typing com shape idêntico resolve sem nova dependência. |
| `TransportStatus` mirrored em health.ts | Consequência do duck typing — type definido localmente. Shape idêntico garante compatibilidade estrutural TypeScript. |
| WebhookTransport.start() não chamado em modo webhook no index.ts | `WebhookTransport.start()` cria um `Bun.serve()` próprio. Em brain-sdr, `Bun.serve()` já está rodando com o app completo (inclui /api/v1/webhook via createWebhookApp). Chamar start() causaria dois servidores na mesma porta. Transport criado apenas para `getStatus()` no /health. |
| HTTP 503 para transport desconectado | Brain sem transport não processa mensagens — estado crítico operacional. Load balancer / k8s deve remover pod do pool de requests. |

## Deviations from Plan

### Auto-resolved Issues

**1. [Rule 1 - Bug] Dependência circular transport ↔ observability**
- **Found during:** Task 2, ao tentar `import type { ITransport } from "@brain-pkg/transport"` em observability/health.ts
- **Issue:** transport depende de observability (createLogger). observability importar de transport criaria ciclo: transport→observability→transport
- **Fix:** Definir `ITransportLike` e `TransportStatus` localmente em health.ts com duck typing — shape idêntico ao definido em transport/interface.ts
- **Files modified:** packages/observability/src/health.ts
- **Commit:** 4dfcee5

**2. [Rule 1 - Bug] WebhookTransport.start() conflitaria com Bun.serve() de brain-sdr**
- **Found during:** Task 2, ao analisar WebhookTransport.start() antes de modificar index.ts
- **Issue:** O plano original sugeria `await transport.start(port)` incondicionalmente. WebhookTransport.start() chama `Bun.serve()` internamente — dois servidores na mesma porta em modo webhook.
- **Fix:** Condicionar `transport.start()` apenas para modo rabbitmq. Transport webhook ainda é criado antes de createServer() para que getStatus() funcione no /health.
- **Files modified:** apps/brain-sdr/src/index.ts
- **Commit:** 4dfcee5

## Tests

| File | Tests | Status |
|------|-------|--------|
| packages/transport/src/__tests__/unit/transport-status.test.ts | 5 | PASS |
| packages/observability/src/__tests__/unit/health-transport.test.ts | 5 | PASS |

## Threat Surface Scan

Nenhuma nova superfície de segurança introduzida além do previsto no threat model do plano:
- T-27-03-01 mitigado: TransportStatus expõe apenas `type` (webhook/rabbitmq) e `connected` (boolean) — nenhuma credencial, URL ou stack trace
- T-27-03-04 mitigado: `transport?` é opcional — backward compatible confirmado por testes

## Self-Check: PASSED

- [x] packages/transport/src/__tests__/unit/transport-status.test.ts existe
- [x] packages/observability/src/__tests__/unit/health-transport.test.ts existe
- [x] commit 4999127 existe
- [x] commit 4dfcee5 existe
- [x] `grep "TransportStatus" packages/transport/src/interface.ts` retorna definição
- [x] `grep "getStatus" packages/transport/src/interface.ts` retorna assinatura
- [x] `bun build apps/brain-sdr/src/index.ts --target=bun` termina sem erros
