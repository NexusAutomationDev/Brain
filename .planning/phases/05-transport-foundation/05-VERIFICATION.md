---
phase: 05-transport-foundation
verified: 2026-06-13T22:00:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "POST /api/v1/webhook com payload {Name, Message, Numero, IDLead} válido em brain-echo rodando retorna { status: 'ok', reply: string } com resposta real da LLM"
    expected: "HTTP 200 com reply não-vazio retornado pelo BrainRunner real (não mock)"
    why_human: "Requer container brain-echo rodando com banco, LLM configurada e ECHO_URL apontando para o servidor. Testes de integração em webhook.test.ts e restart.test.ts são skipped sem ECHO_URL."
---

# Phase 5: Transport Foundation — Verification Report

**Phase Goal:** WebhookTransport funciona corretamente com runner injetado, BrainEvent tem campos padronizados e todos os pacotes do monorepo têm lint configurado
**Verified:** 2026-06-13T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /api/v1/webhook com payload {Name, Message, Numero, IDLead} invoca o Brain e retorna resposta LLM — sem silent accept sem processamento | VERIFIED | handler.test.ts: "POST /api/v1/webhook with runner injected returns 200 { status: 'ok', reply: string }" — PASS (mock runner). End-to-end com runner real requer human verification (container). |
| 2 | WebhookTransport.start() injetado via construtor resolve o runner corretamente, não lança exceção nem retorna vazio | VERIFIED | handler.ts: `constructor(private readonly runner?)` + `if (!this.runner) throw new ConfigurationError(...)` antes de aceitar requests. factory.test.ts: "WebhookTransport.start() without runner throws ConfigurationError" — PASS. |
| 3 | bun run lint passa sem erros em todos os pacotes do monorepo (shared, database, observability, ai, memory, transport, core) | VERIFIED | Todos os 7 pacotes: `eslint src/ --ext .ts` exit 0. Nota: `.bin/eslint` wrapper carece de permissão exec neste ambiente (pnpm symlink issue); ESLint funciona via invocação direta do módulo. Scripts corretos, config correta, deps corretas. |
| 4 | Fixtures de teste do webhook atualizadas para o novo schema de campos — todos os testes existentes passam com os novos nomes de campo | VERIFIED | 19 testes passando: handler.test.ts(6), factory.test.ts(6), brain-runner.test.ts(5), apps integration(2 placeholders). Todos usam {Name, Message, Numero, IDLead}. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/transport/src/webhook/events.ts` | BrainEvent Zod schema com {Name, Message, Numero, IDLead} | VERIFIED | Contém `z.object({ Name, Message, Numero, IDLead })`, todos `string.min(1)`. Campos antigos ausentes. |
| `packages/transport/src/webhook/handler.ts` | WebhookTransport com runner injection no construtor + ConfigurationError em start() | VERIFIED | `class WebhookTransport`, `constructor(private readonly runner?)`, `if (!this.runner) throw new ConfigurationError(...)` antes de `Bun.serve`. |
| `packages/transport/src/factory.ts` | createTransport(runner?) passa runner ao WebhookTransport constructor | VERIFIED | `return new WebhookTransport(runner)`. Type selection via `process.env.TRANSPORT`. |
| `packages/transport/src/webhook/handler.test.ts` | Testes atualizados para novo schema e sem dedup | VERIFIED | `Name: "João Silva"`, `Message: "..."`, sem `conversationId`, sem X-Request-Id tests. 6 testes passando. |
| `packages/transport/src/webhook/dedup.ts` | NÃO deve existir | VERIFIED | Arquivo removido: `test ! -f packages/transport/src/webhook/dedup.ts` confirma. |
| `packages/transport/src/webhook/dedup.test.ts` | NÃO deve existir | VERIFIED | Arquivo removido. |
| `package.json` | devDependencies com @typescript-eslint/parser e @typescript-eslint/eslint-plugin | VERIFIED | `"@typescript-eslint/parser": "^5.62.0"`, `"@typescript-eslint/eslint-plugin": "^5.62.0"` presentes. |
| `packages/shared/package.json` | script lint: eslint src/ --ext .ts | VERIFIED | `"lint": "eslint src/ --ext .ts"`. |
| `packages/transport/package.json` | script lint: eslint src/ --ext .ts | VERIFIED | `"lint": "eslint src/ --ext .ts"`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/transport/src/factory.ts` | `packages/transport/src/webhook/handler.ts` | `new WebhookTransport(runner)` | WIRED | `return new WebhookTransport(runner)` encontrado em factory.ts |
| `packages/transport/src/webhook/handler.ts` | `packages/shared/src/errors/index.ts` | ConfigurationError import | WIRED | `import { ConfigurationError } from "@brain-pkg/shared"` + usado em start() |
| `packages/core/src/runner/runner.ts` | `packages/transport/src/webhook/events.ts` | BrainEvent fields | WIRED | `event.Message` (linha 144), `event.IDLead` (4 ocorrências), `event.Numero` (linha 129) |
| `turbo.json (lint task)` | `packages/*/package.json (lint script)` | turbo run lint delegates | WIRED | lint script presente em todos os 7 pacotes (`grep -r '"lint"' packages/*/package.json \| wc -l` = 7) |
| `packages/*/package.json (lint script)` | `.eslintrc.js (root)` | ESLint config inheritance (root: true) | WIRED | `.eslintrc.js` tem `root: true`, `extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended']`. Nenhum `.eslintrc.js` por pacote (`find packages/ -name '.eslintrc.js' \| wc -l` = 0). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `packages/transport/src/webhook/handler.ts` | `event` (BrainEvent) | `BrainEventSchema.safeParse(body)` de HTTP request | Sim — Zod parse de corpo real da requisição | FLOWING |
| `packages/core/src/runner/runner.ts` | `event.Message`, `event.IDLead`, `event.Numero` | Passado pelo handler via `runner.run(event)` | Sim — campos reais do BrainEvent chegam ao LangGraph como `messages: [{ role: "human", content: event.Message }]` | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| BrainEventSchema rejeita payload antigo | handler.test.ts: "old payload returns 400" | PASS (exit 0, 6 tests) | PASS |
| WebhookTransport.start() sem runner lança ConfigurationError | factory.test.ts: "WebhookTransport.start() without runner throws ConfigurationError" | PASS (exit 0, 6 tests) | PASS |
| BrainRunner usa event.Message como conteúdo LangGraph | `grep "event.Message" runner.ts` | `messages: [{ role: "human", content: event.Message }]` — linha 144 | PASS |
| ESLint passa em todos os 7 pacotes | `node .../eslint.js src/ --ext .ts` por pacote | 7/7 exit 0, 0 erros | PASS |
| Todos os testes de transport + core passam | `bun test packages/transport ...brain-runner.test.ts` | 19 pass, 0 fail | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TRP-02 | 05-01-PLAN.md | WebhookTransport.start() injeta runner corretamente (correção GAP-1) | SATISFIED | handler.ts: constructor injection + ConfigurationError fail-fast. factory.ts: `new WebhookTransport(runner)`. 12 testes cobrindo runner injection. |
| INFRA-02 | 05-02-PLAN.md | Lint configurado em todos os pacotes do monorepo | SATISFIED | 7 scripts lint adicionados, @typescript-eslint deps no root, .eslintrc.js com recommended config. ESLint passa 0 erros em todos os 7 pacotes. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/transport/dist/webhook/events.js` | 1-20 | dist/ stale (schema antigo {conversationId, stepIndex...}) | INFO | Pré-existente. O dist foi reconstruído com `bun run build` e agora reflete o schema novo. O CI deve incluir build antes de deploy. |
| `packages/transport/src/webhook/handler.ts` | 51 | `runner.run()` sem try/catch | INFO | Se runner.run() lança, Hono retorna 500 sem mensagem de erro customizada. Não bloqueia o objetivo da fase — tratamento de erro do runner é escopo de fase futura. |

### Human Verification Required

#### 1. End-to-end webhook com Brain real

**Test:** Iniciar brain-echo com runner real (`OPENAI_API_KEY`, `DATABASE_URL` configurados) e fazer:
```bash
curl -X POST http://localhost:3000/api/v1/webhook \
  -H "Content-Type: application/json" \
  -d '{"Name":"Test","Message":"Olá, qual é 2+2?","Numero":"5511999990001","IDLead":"lead-001"}'
```
**Expected:** HTTP 200 com `{ "status": "ok", "reply": "<resposta da LLM com algum conteúdo>" }`. Reply deve ser não-vazio.
**Why human:** Requer runner real (LLM + banco configurados). O teste de integração `apps/brain-echo/src/__tests__/integration/webhook.test.ts` cobre este caso mas está skipped sem `ECHO_URL`. Não é possível verificar programaticamente sem container rodando.

---

## Gaps Summary

Nenhum gap bloqueador encontrado. Todos os 4 success criteria do ROADMAP foram verificados contra o código real.

O status `human_needed` reflete que o SC-1 ("invoca o Brain e retorna resposta LLM") foi verificado com mock runner via testes unitários, mas a verificação end-to-end com runner real requer container rodando. Isso é esperado e normal para fases de transport — o caminho de código está correto.

**Commits verificados:**
- `957b161` — feat(05-01): substituir BrainEvent schema e remover DedupCache
- `78db85e` — feat(05-01): runner injection no factory e atualização de consumidores
- `9704e5a` — chore(05-02): add @typescript-eslint deps and lint scripts to all 7 packages
- `10dbd63` — feat(05-02): activate lint pipeline - turbo run lint passes 7/7 packages

---

_Verified: 2026-06-13T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
