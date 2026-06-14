---
phase: 07-leadservice-rabbitmq-transport
plan: "01"
subsystem: core/leads + core/runner + transport/webhook
tags: [lead-service, ia-ativada-gate, brain-runner, webhook-transport, tdd, upsert]
dependency_graph:
  requires:
    - "06-leads-schema-migration (leads table + uniqueIndex on numero)"
    - "05-transport-foundation (BrainEvent schema, WebhookTransport, IBrainRunnerLike)"
  provides:
    - "LeadService.upsertLead() — atomic upsert by numero, uniqueId never overwritten"
    - "BrainRunner.run() → Promise<BrainRunResult | null> — null when iaAtivada=false"
    - "WebhookTransport null-safe — { status: 'ignored' } when runner returns null"
  affects:
    - "07-02 (RabbitMQ transport — will call same BrainRunner.run() getting gate automatically)"
tech_stack:
  added: []
  patterns:
    - "Drizzle insert().onConflictDoUpdate() — atomic upsert by unique column"
    - "mock.module() at top of test file before imports — bun:test pattern for dependency mocking"
    - "mockImplementationOnce() — per-test override of shared mock"
    - "describe.skip when env var absent — graceful integration test skipping"
key_files:
  created:
    - packages/core/src/leads/lead-service.ts
    - packages/core/src/leads/__tests__/lead-service.test.ts
  modified:
    - packages/core/src/runner/runner.ts
    - packages/core/src/runner/__tests__/brain-runner.test.ts
    - packages/core/src/runner/__tests__/brain-runner.integration.test.ts
    - packages/core/src/index.ts
    - packages/transport/src/webhook/handler.ts
    - packages/transport/src/webhook/handler.test.ts
decisions:
  - "LeadService instanciado no construtor do BrainRunner (não em _compileGraph) — disponível imediatamente antes do init()"
  - "mock.module path relativo ao arquivo de teste: ../../leads/lead-service.js (do diretório __tests__/)"
  - "Integration test: substituir throw por describe.skip quando POSTGRES_URL ausente — evita crash silencioso do test runner"
metrics:
  duration: "817s (~14 min)"
  completed_date: "2026-06-14"
  tasks_completed: 3
  files_changed: 8
---

# Phase 7 Plan 01: LeadService + ia_ativada Gate Summary

**One-liner:** LeadService com upsert atômico por numero (uniqueId preservado), gate ia_ativada no BrainRunner retornando null, WebhookTransport tratando null com status "ignored".

## What Was Built

### LeadService (LEAD-02)

Classe `packages/core/src/leads/lead-service.ts`:
- `upsertLead(numero, uniqueId, nome?)` — INSERT com `onConflictDoUpdate` por `leads.numero`; `uniqueId` presente no `values()` mas ausente do `set` (T-07-05: nunca sobrescrito em updates)
- `getByNumero(numero)` — SELECT + WHERE eq + LIMIT 1, retorna `null` se não encontrado
- `Lead` type exportado como `typeof leads.$inferSelect` (Drizzle-inferred)

### Gate ia_ativada no BrainRunner (LEAD-03)

Modificações em `packages/core/src/runner/runner.ts`:
- `run()` agora retorna `Promise<BrainRunResult | null>`
- Antes de qualquer processamento LLM: `this.leadService.upsertLead(event.Numero, event.IDLead, event.Name)`
- Se `lead.iaAtivada === false`: log debug + `return null` (sem chamar LangGraph)
- `LeadService` instanciado no construtor com `options.sql`

### WebhookTransport null-safe (TRP-01)

Modificações em `packages/transport/src/webhook/handler.ts`:
- `IBrainRunnerLike.run()` atualizado para retornar `Promise<{ reply: string } | null>`
- Handler: `if (result === null) return c.json({ status: "ignored" }, 200)` — T-07-03: sem expor razão interna

### Testes

| Arquivo | Cobertura |
|---------|-----------|
| `packages/core/src/leads/__tests__/lead-service.test.ts` | LEAD-02: upsertLead campos, onConflictDoUpdate sem uniqueId no set, updatedAt presente |
| `packages/core/src/runner/__tests__/brain-runner.test.ts` | LEAD-03: run() null quando iaAtivada=false, run() reply quando true, upsertLead chamado com args corretos |
| `packages/transport/src/webhook/handler.test.ts` | TRP-01: POST sem IDLead retorna 400 "Invalid BrainEvent" |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `be63678` | test | Add RED stubs for LEAD-02 and TRP-01 |
| `a9cce0e` | feat | Implement LeadService with upsertLead and getByNumero |
| `1b24453` | feat | Integrate LeadService in BrainRunner + ia_ativada gate |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed silent crash in brain-runner.integration.test.ts**
- **Found during:** Task 2 — ao rodar `bun test src/runner/__tests__/brain-runner.test.ts`, o processo terminava com exit 1 sem output
- **Issue:** `throw new Error(...)` no nível do módulo (linha 18) quando `POSTGRES_URL` não está definido mata o processo Bun silenciosamente antes de qualquer output — impedia rodar testes unitários quando o DB não está disponível
- **Fix:** Substituir `throw` por `describeOrSkip = TEST_DB_URL ? describe : describe.skip` — comportamento gracioso, testes de integração são skipped ao invés de crashar o processo
- **Files modified:** `packages/core/src/runner/__tests__/brain-runner.integration.test.ts`
- **Commit:** `1b24453`

**2. [Rule 3 - Blocking] Corrigido path de mock do LeadService**
- **Found during:** Task 2 — mock inicial usava `../leads/lead-service.js` (relativo a `runner/__tests__/`)
- **Issue:** Path incorreto — do diretório `__tests__/`, o LeadService está em `../../leads/lead-service.js`
- **Fix:** Atualizado para `../../leads/lead-service.js`
- **Files modified:** `packages/core/src/runner/__tests__/brain-runner.test.ts`
- **Commit:** `1b24453`

## Mock Pattern for Future Plans

O padrão de mock do `LeadService` usado neste plano (para Plan 02 ou outros que importem BrainRunner):

```typescript
// No TOPO do arquivo de teste, antes dos imports
const mockUpsertLead = mock(async () => ({
  id: "uuid-1",
  uniqueId: "lead-abc",
  numero: "5511999990001",
  nome: "Test User",
  iaAtivada: true, // default ativo; usar mockImplementationOnce para cenários negativos
  fullpp: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

mock.module("../../leads/lead-service.js", () => ({
  LeadService: mock(function () {
    return { upsertLead: mockUpsertLead, getByNumero: mock(async () => null) };
  }),
}));

// Em teste específico para iaAtivada=false:
mockUpsertLead.mockImplementationOnce(async () => ({ ...lead, iaAtivada: false }));
```

**Nota importante sobre path:** O path `../../leads/lead-service.js` é relativo ao arquivo de teste em `src/runner/__tests__/`. Se um novo arquivo de teste estiver em outro diretório, ajustar o path correspondentemente.

## Threat Flags

Nenhuma nova superfície de segurança introduzida além do previsto no threat model do plano.

## Known Stubs

Nenhum stub — todos os dados fluem do banco via Drizzle (upsert real), sem valores hardcoded.

## Self-Check

### Files Exist
- `packages/core/src/leads/lead-service.ts` — FOUND
- `packages/core/src/leads/__tests__/lead-service.test.ts` — FOUND
- `packages/core/src/runner/runner.ts` (modified) — FOUND
- `packages/transport/src/webhook/handler.ts` (modified) — FOUND

### Commits Exist
- `be63678` — FOUND (test: RED stubs)
- `a9cce0e` — FOUND (feat: LeadService)
- `1b24453` — FOUND (feat: BrainRunner gate)

### Acceptance Criteria
- `export class LeadService` em lead-service.ts — VERIFIED
- `export type Lead = typeof leads.$inferSelect` — VERIFIED
- `onConflictDoUpdate` sem `uniqueId` no set — VERIFIED
- `getByNumero` implementado — VERIFIED
- `export { LeadService }` em core/index.ts — VERIFIED
- `Promise<BrainRunResult | null>` em runner.ts — VERIFIED
- `leadService.upsertLead` em runner.ts — VERIFIED
- `ia_ativada=false` em runner.ts (log) — VERIFIED
- `return null` no gate em runner.ts — VERIFIED
- `from '../leads/lead-service.js'` (import) — VERIFIED
- `status.*ignored` em handler.ts — VERIFIED
- `IBrainRunnerLike.run` retorna `| null` em handler.ts — VERIFIED
- `ia_ativada` em brain-runner.test.ts — VERIFIED
- `IDLead` e `TRP-01` em handler.test.ts — VERIFIED (adicionado no Task W0)

## Self-Check: PASSED
