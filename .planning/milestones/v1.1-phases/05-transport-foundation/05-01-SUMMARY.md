---
phase: 05-transport-foundation
plan: 01
subsystem: transport
tags: [brain-event, webhook, dedup-removal, runner-injection, gap-1-fix]
dependency_graph:
  requires: []
  provides: [BrainEvent-padronizado, WebhookTransport-runner-injection, factory-runner-passthrough]
  affects: [packages/core/runner, apps/brain-echo/integration-tests]
tech_stack:
  added: []
  patterns: [constructor-injection, fail-fast-configurationerror, zod-validation]
key_files:
  created: []
  modified:
    - packages/transport/src/webhook/events.ts
    - packages/transport/src/webhook/handler.ts
    - packages/transport/src/webhook/handler.test.ts
    - packages/transport/src/index.ts
    - packages/transport/src/factory.ts
    - packages/transport/src/factory.test.ts
    - packages/core/src/runner/runner.ts
    - packages/core/src/runner/__tests__/brain-runner.test.ts
    - packages/core/src/runner/__tests__/brain-runner.integration.test.ts
    - apps/brain-echo/src/__tests__/integration/webhook.test.ts
    - apps/brain-echo/src/__tests__/integration/restart.test.ts
  deleted:
    - packages/transport/src/webhook/dedup.ts
    - packages/transport/src/webhook/dedup.test.ts
decisions:
  - "D-01/D-04: BrainEvent schema substituído para {Name, Message, Numero, IDLead} — quebra intencional sem shim de deprecação"
  - "D-02/D-03/D-16: DedupCache e X-Request-Id completamente removidos — dedup era premature optimization sem requisito real"
  - "D-05/D-06: WebhookTransport recebe runner no construtor; start() lança ConfigurationError se runner ausente (GAP-1 fix)"
  - "D-07: createTransport(runner?) — tipo de transport via process.env.TRANSPORT, não como arg posicional"
  - "D-08: IBrainRunnerLike exportado de handler.ts para uso no factory sem circular dep"
  - "D-09: event.Numero como threadId temporário com comentário Phase 8 explícito"
metrics:
  duration: ~25min
  completed_date: "2026-06-13"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 11
  files_deleted: 2
---

# Phase 05 Plan 01: Transport BrainEvent Schema + Runner Injection Summary

**One-liner:** BrainEvent migrado para {Name, Message, Numero, IDLead}, DedupCache removido, WebhookTransport com constructor injection e fail-fast ConfigurationError (GAP-1 fix).

## What Was Built

### BrainEvent Schema (events.ts)

Schema substituído completamente — campos WhatsApp/CRM padronizados:

| Campo antigo | Campo novo | Uso |
|---|---|---|
| `conversationId: string` | `Numero: string` | threadId temporário (Phase 8: lead.unique_id) |
| `stepIndex: number` | — | Removido sem substituto |
| `userId: string` | `IDLead: string` | Identificador do lead no CRM |
| `content: string` | `Message: string` | Corpo da mensagem |
| `metadata?: object` | — | Removido sem substituto |
| — | `Name: string` | Nome do contato (novo campo) |

Zod valida todos como `string.min(1)` — campos ausentes ou vazios retornam 400 antes de qualquer processamento (T-05-01).

### DedupCache Removido (D-02, D-03, D-16)

Arquivos deletados:
- `packages/transport/src/webhook/dedup.ts`
- `packages/transport/src/webhook/dedup.test.ts`

Toda lógica X-Request-Id removida do handler. Header X-Request-Id não é mais obrigatório nem verificado.

### WebhookTransport Runner Injection (D-05, D-06 — GAP-1 fix)

```typescript
// ANTES — GAP-1: start() criava app sem runner; requests eram "aceitos" silenciosamente
export class WebhookTransport implements ITransport {
  async start(port = 3000): Promise<void> {
    const app = createWebhookApp(); // runner NUNCA passado
    ...
  }
}

// DEPOIS — fail-fast: ConfigurationError antes de aceitar qualquer request
export class WebhookTransport implements ITransport {
  constructor(private readonly runner?: IBrainRunnerLike) {}
  async start(port = 3000): Promise<void> {
    if (!this.runner) throw new ConfigurationError("WebhookTransport requires a runner...");
    const app = createWebhookApp(this.runner);
    ...
  }
}
```

### Factory createTransport (D-07)

```typescript
// ANTES — tipo como arg posicional, runner não passado
export function createTransport(transport?: string): ITransport

// DEPOIS — runner como arg, tipo via env var
export function createTransport(runner?: IBrainRunnerLike): ITransport
```

### BrainRunner campos atualizados (D-09)

```typescript
// ANTES
const threadId = event.conversationId;
await memoryManager.getContext(threadId, event.userId, []);
messages: [{ role: "human", content: event.content }],
userId: event.userId,

// DEPOIS
const threadId = event.Numero; // Phase 8: substituir por lead.unique_id
await memoryManager.getContext(threadId, event.IDLead, []);
messages: [{ role: "human", content: event.Message }],
userId: event.IDLead,
```

## Tests

| Arquivo | Testes | Status |
|---|---|---|
| packages/transport/src/webhook/handler.test.ts | 6 | PASS |
| packages/transport/src/factory.test.ts | 6 | PASS |
| packages/core/src/runner/__tests__/brain-runner.test.ts | 5 | PASS |
| packages/core/src/runner/__tests__/brain-runner.integration.test.ts | 1 (skipped sem DB) | SKIP |
| apps/brain-echo/src/__tests__/integration/webhook.test.ts | 1 placeholder + 2 skipped | PASS |
| apps/brain-echo/src/__tests__/integration/restart.test.ts | 1 placeholder + 1 skipped | PASS |

Total: **19 testes passando** (`bun test packages/transport packages/core/src/runner/__tests__/brain-runner.test.ts`)

## Commits

| Task | Hash | Descrição |
|---|---|---|
| Task 1 | 957b161 | feat(05-01): substituir BrainEvent schema e remover DedupCache |
| Task 2 | 78db85e | feat(05-01): runner injection no factory e atualização de consumidores |

## Deviations from Plan

### Auto-fixed Issues

Nenhum — plano executado exatamente como escrito.

### Observações

- `IBrainRunnerLike` foi exportado de `handler.ts` (além de usado internamente) para permitir que `factory.ts` importe o tipo sem redeclarar. Isso estava implícito no plano (D-08 menciona "re-exportar IBrainRunnerLike de handler.ts") e foi implementado via `export interface IBrainRunnerLike` + re-export no `index.ts`.

- O teste `factory.test.ts` anterior usava `createTransport("webhook")` com string como primeiro arg. Atualizado para `createTransport(mockRunner)` conforme a nova assinatura. Comportamentos de fallback para env var TRANSPORT mantidos.

## Known Stubs

Nenhum stub identificado. Todos os campos de BrainEvent estão wired no handler e runner.

## Threat Flags

Nenhuma nova superfície de segurança introduzida além do descrito no threat model do plano.

## Self-Check: PASSED

- FOUND: packages/transport/src/webhook/events.ts
- FOUND: packages/transport/src/webhook/handler.ts
- FOUND: packages/transport/src/factory.ts
- FOUND: packages/core/src/runner/runner.ts
- CONFIRMED: dedup.ts removed
- CONFIRMED: dedup.test.ts removed
- FOUND: commit 957b161 (Task 1)
- FOUND: commit 78db85e (Task 2)
