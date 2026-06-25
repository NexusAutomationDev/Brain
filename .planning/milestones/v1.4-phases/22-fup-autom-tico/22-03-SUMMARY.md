---
phase: 22-fup-autom-tico
plan: "03"
subsystem: core/runner + core/leads
tags:
  - fup
  - scheduler
  - brain-runner
  - lead-service
  - integration
dependency_graph:
  requires:
    - 22-01  # fup_failure_count migration
    - 22-02  # FupScheduler implementation
  provides:
    - BrainRunner com FupScheduler integrado ao ciclo de vida (init/run/close)
    - LeadService.resetFup() — cancelamento de FUP ao receber mensagem
    - Barrel export completo: FupScheduler, IFupScheduler, getNextValidSlot
  affects:
    - apps/brain-sdr (usa BrainRunner via packages/core)
tech_stack:
  added: []
  patterns:
    - TDD (RED→GREEN) para LeadService.resetFup()
    - Campo privado checkpointer no BrainRunner para injeção no FupScheduler (Pitfall 6)
    - FUP_WEBHOOK_URL ENV como gate de inicialização do scheduler
key_files:
  created:
    - packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
  modified:
    - packages/core/src/leads/lead-service.ts
    - packages/core/src/runner/runner.ts
    - packages/core/src/index.ts
decisions:
  - "D-04: ciclo de vida do FupScheduler gerenciado pelo BrainRunner (init/close) — consistente com EventPublisher"
  - "D-06: checkpointer salvo como campo privado após _compileGraph() para injeção posterior no FupScheduler"
  - "D-19: resetFup() não toca fupEnabled — lead permanece elegível para novo ciclo após responder"
  - "Schema push aplicado via psql direto (drizzle-kit push requer TTY interativo — contornado pelo operador)"
metrics:
  duration_minutes: 30
  completed_date: "2026-06-24"
  tasks_completed: 3
  files_changed: 4
requirements:
  - FUP-01
  - FUP-02
  - FUP-06
---

# Phase 22 Plan 03: Integração FupScheduler + LeadService.resetFup() Summary

**One-liner:** Conecta FupScheduler (Plan 02) e migration (Plan 01) ao BrainRunner via init/run/close, com LeadService.resetFup() para cancelar FUPs quando lead responde.

## What Was Built

### Task 1: LeadService.resetFup() (TDD)

Método `resetFup(uniqueId: string): Promise<void>` adicionado ao `LeadService` após `touchLastMessage()`.

Comportamento (FUP-06/D-19):
- Seta `fupNextAt = null` e `fupStep = 0` via Drizzle ORM
- `fupEnabled` **intencionalmente ausente** do set — lead permanece elegível para novo ciclo FUP se silenciar novamente
- Update sem rows é noop (Drizzle não lança erro)

Testes unitários (3 casos):
- Verifica chain `update().set().where()` chamado
- Verifica payload `{ fupNextAt: null, fupStep: 0 }` sem `fupEnabled` nem `iaAtivada`
- Verifica que uniqueId inexistente não lança erro

**Commit:** `35e90dd`

### Task 2: FupScheduler integrado ao BrainRunner

Modificações em `packages/core/src/runner/runner.ts`:

| Ponto de inserção | O que foi adicionado |
|-------------------|----------------------|
| Imports | `IFupScheduler`, `FupScheduler` de `../fup/fup-scheduler.js` |
| Campos privados | `fupScheduler: IFupScheduler \| null` e `checkpointer: any \| null` |
| `_compileGraph()` | `this.checkpointer = checkpointer` após `createCheckpointer()` (D-12/Pitfall 6) |
| `init()` após EventPublisher | `new FupScheduler({...})` + `start()` se `FUP_WEBHOOK_URL` presente |
| `run()` após `touchLastMessage()` | `await this.leadService.resetFup(lead.uniqueId)` (FUP-06/D-19) |
| `close()` após EventPublisher | `await this.fupScheduler.stop()` (FUP-04/D-04) |

Modificações em `packages/core/src/index.ts`:
- Adicionados exports: `IFupScheduler`, `FupScheduler`, `getNextValidSlot`

**Commit:** `cf6eeab`

### Task 3: Schema push (aprovado pelo operador)

`fup_failure_count | integer | not null | default 0` aplicado ao banco `brain_sdr` em `127.0.0.1:5432` via psql direto (drizzle-kit push requer TTY interativo — contornado pelo operador conforme checkpoint).

## Decisions Made

**D-04:** FupScheduler segue o mesmo padrão de ciclo de vida do EventPublisher — `start()` em `init()`, `stop()` em `close()`. Consistência arquitetural no BrainRunner.

**D-06 (Pitfall 6):** `checkpointer` salvo como campo privado imediatamente após `createCheckpointer()` em `_compileGraph()`. Necessário porque `init()` cria o FupScheduler após `_compileGraph()` retornar — sem o campo, o checkpointer estaria fora de escopo.

**D-19:** `resetFup()` seta apenas `fupNextAt=null` e `fupStep=0`. `fupEnabled` permanece `true` — design intencional: o lead pode silenciar novamente e um novo ciclo de FUP deve iniciar naturalmente sem intervenção manual.

**Schema push via psql:** drizzle-kit push requer TTY interativo, não executável em ambiente automatizado. Operador aplicou o SQL diretamente via psql, que é equivalente e igualmente idempotente.

## Verification Results

```
bun test packages/core/src/__tests__/unit/fup/ --bail
→ 19 pass, 0 fail (3 arquivos: fup-scheduler, fup-business-hours, lead-service-fup)
```

TypeScript: erros pré-existentes (`lastMessageAt`, `fupNextAt` no schema Drizzle, `TokenUsage` em shared) — presentes antes desta fase, fora do escopo deste plano.

## Requirements Covered

| Req | Description | Status |
|-----|-------------|--------|
| FUP-01 | FupScheduler exportado pelo barrel core | ✅ |
| FUP-02 | FupScheduler integrado ao BrainRunner.init() | ✅ |
| FUP-06 | resetFup() chamado em run() após touchLastMessage() | ✅ |

## Deviations from Plan

None — plano executado exatamente como especificado.

## Auth Gates

| Task | Gate | Resolution |
|------|------|------------|
| Task 3 | Schema push requer acesso ao PostgreSQL | Operador aplicou via psql direto — drizzle-kit push requer TTY interativo |

## Known Stubs

None — todas as integrações estão funcionais e conectadas.

## Threat Flags

Nenhum novo surface introduzido além do mapeado no threat model do plano:
- T-22-09 mitigado: `hasFupUrl: true` logado, nunca a URL completa
- T-22-10 aceito: Drizzle prepared statements, uniqueId validado upstream
- T-22-11 aceito: schema push idempotente
- T-22-12 aceito: URL controlada pelo operador via ENV

## Self-Check: PASSED
