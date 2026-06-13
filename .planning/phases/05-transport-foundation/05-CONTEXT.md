# Phase 5: Transport Foundation - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 corrige três lacunas estruturais deixadas pelo v1.0:
1. BrainEvent schema padronizado para `{Name, Message, Numero, IDLead}` — alinhado com payload do WhatsApp/CRM
2. WebhookTransport.start() corrigido com runner injection via construtor (GAP-1)
3. ESLint ativado com script `lint` em todos os 7 pacotes do monorepo

Esta fase não adiciona novas funcionalidades — é uma fase de correção e padronização antes do RabbitMQ e Leads (Phases 6-7).

</domain>

<decisions>
## Implementation Decisions

### BrainEvent Schema
- **D-01:** Novos campos: `{Name: string, Message: string, Numero: string, IDLead: string}` — todos string. IDLead vem como string do WhatsApp/CRM (não number).
- **D-02:** Campos antigos completamente removidos: `conversationId`, `stepIndex`, `userId`, `content`, `metadata` — sem compat shim, sem deprecation warning.
- **D-03:** Dedup por X-Request-Id **removido** — o sistema cliente (WhatsApp/CRM) não envia esse header. Handler fica sem verificação de duplicate request.
- **D-04:** Zod schema do BrainEvent é `z.object({ Name, Message, Numero, IDLead })` — quatro campos obrigatórios, sem metadata opcional.

### Runner Injection (GAP-1 Fix)
- **D-05:** Runner injetado via **construtor**: `new WebhookTransport(runner)`. ITransport interface não muda (`start(port?): Promise<void>`).
- **D-06:** Runner é parâmetro opcional no construtor (TypeScript: `runner?: IBrainRunnerLike`), mas `start()` **lança ConfigurationError** se runner não foi injetado — fail-fast, não silent accept.
- **D-07:** Factory `createTransport(runner?)` atualizada para passar runner ao construtor: `new WebhookTransport(runner)`. Sem runner = WebhookTransport com runner undefined (falhará em start()).
- **D-08:** `IBrainRunnerLike` local em handler.ts mantida (duck typing, evita circular dep com core).
- **D-09:** O padrão de construtor será reutilizado pelo RabbitMQ transport na Phase 7 (`new RabbitMQTransport(runner)`).

### Lint Setup (INFRA-02)
- **D-10:** Ferramenta: **ESLint v8** — já instalado no root, manter consistência. Não migrar para Biome nesta fase.
- **D-11:** Deps faltando a instalar no root: `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` — root `.eslintrc.js` já os referencia mas não os declara em devDeps.
- **D-12:** Cada pacote adiciona script `"lint": "eslint src/"` no package.json. Pacotes herdam root `.eslintrc.js` automaticamente (já tem `root: true`). Sem `.eslintrc.js` por pacote.
- **D-13:** Cobertura: `src/` apenas — testes excluídos do lint nesta fase. Sete pacotes: shared, database, observability, ai, memory, transport, core.
- **D-14:** `turbo run lint` já está definido em turbo.json — após adicionar scripts nos pacotes, o comando raiz passa a funcionar.

### Testes
- **D-15:** Fixtures de teste do webhook (`handler.test.ts`) atualizadas para o novo schema — `validEvent` passa de `{conversationId, stepIndex, userId, content}` para `{Name, Message, Numero, IDLead}`.
- **D-16:** DedupCache e os testes de dedup (`duplicate X-Request-Id returns 409`) são removidos junto com a feature.

### Claude's Discretion
- Ordem exata de remoção de campos no Zod schema (tudo numa PR)
- Mensagem de erro do ConfigurationError quando runner ausente em start()
- Versão exata de `@typescript-eslint/parser` e `@typescript-eslint/eslint-plugin` a instalar

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fase e Requirements
- `.planning/ROADMAP.md` §Phase 5 — Goal, success criteria, requirements TRP-02 e INFRA-02
- `.planning/REQUIREMENTS.md` §TRP-02, §INFRA-02 — definição formal dos requirements

### Código existente a modificar
- `packages/transport/src/webhook/events.ts` — BrainEvent schema atual (a ser substituído)
- `packages/transport/src/webhook/handler.ts` — WebhookTransport e createWebhookApp (runner injection + schema update)
- `packages/transport/src/webhook/dedup.ts` — DedupCache a ser removido
- `packages/transport/src/factory.ts` — createTransport() a receber runner
- `packages/transport/src/interface.ts` — ITransport interface (NÃO muda)
- `packages/transport/src/webhook/handler.test.ts` — testes a atualizar para novo schema
- `packages/transport/src/webhook/dedup.test.ts` — testes de dedup a remover
- `package.json` (root) — adicionar @typescript-eslint/parser + plugin em devDeps
- `packages/*/package.json` (7 pacotes) — adicionar script lint

### Audit v1.0 (contexto do GAP-1 e lint no-op)
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md` — documenta GAP-1 e Lint pipeline no-op

### Convenções do projeto
- `CLAUDE.md` — constraints de runtime (Bun), convenções de teste, paths

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/transport/src/webhook/handler.ts`: `createWebhookApp(runner?)` já aceita runner opcional — padrão a manter; só atualizar o schema e remover dedup
- `packages/transport/src/interface.ts`: `ITransport` interface não muda — `start(port?)` permanece igual
- `packages/shared/src/errors/index.ts`: `ConfigurationError` já existe — usar para fail-fast quando runner ausente em start()
- `turbo.json`: task `lint` já definida com `inputs: ["src/**", ".eslintrc.js"]` — apenas falta os scripts nos packages

### Established Patterns
- Zod `z.object()` + `safeParse` para validação do body — padrão mantido, só mudam os campos
- Duck typing com interface local (`IBrainRunnerLike`) para evitar circular dep — manter em handler.ts
- `ConfigurationError` para problemas de configuração em startup — padrão já usado no factory

### Integration Points
- `packages/transport/src/factory.ts`: `createTransport()` é o ponto de entrada — precisa aceitar `runner?` e passar ao construtor
- `apps/brain-echo/src/server.ts`: usa `createWebhookApp(runner)` diretamente (bypass do WebhookTransport) — esse padrão continua válido e não precisa mudar
- Tests em `handler.test.ts`: `validEvent` objeto literal precisa ser atualizado para novos campos

</code_context>

<specifics>
## Specific Ideas

- O campo `IDLead` vem do sistema WhatsApp/CRM como string (ex: "123"), não como number — tratar como string no Zod schema
- X-Request-Id é um header HTTP padrão em integradores como Evolution API e N8N, mas o cliente deste projeto não vai enviar — remover sem deprecation
- O padrão de construtor para runner injection prepara a base para Phase 7 (RabbitMQ): `new RabbitMQTransport(runner)` vai seguir o mesmo design

</specifics>

<deferred>
## Deferred Ideas

- Migração para Biome (lint + format) — pode ser feito em v1.2 quando houver necessidade de formatação consistente além do lint
- Lint cobrindo testes — avaliar em fase futura quando o setup estiver estável

</deferred>

---

*Phase: 05-transport-foundation*
*Context gathered: 2026-06-13*
