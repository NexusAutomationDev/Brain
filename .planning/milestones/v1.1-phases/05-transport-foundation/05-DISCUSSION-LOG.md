# Phase 5: Transport Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 05-transport-foundation
**Areas discussed:** BrainEvent schema, Runner injection pattern, Lint tool

---

## BrainEvent Schema

| Option | Description | Selected |
|--------|-------------|----------|
| Todos string | Name, Message, Numero, IDLead todos como string | ✓ |
| IDLead como number | IDLead como inteiro | |

**User's choice:** Todos string — IDLead vem do WhatsApp/CRM como string.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Remove tudo | Remover conversationId, stepIndex, userId, content, metadata | ✓ |
| Mantém metadata opcional | Manter campo metadata?: Record<string, unknown> | |

**User's choice:** Remove tudo — BrainEvent fica limpo com apenas os 4 novos campos.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, manter X-Request-Id | Dedup por header continua | |
| Não — remover dedup | Handler sem verificação de duplicate request | ✓ |
| Tornar opcional | Header optional, dedup só quando presente | |

**User's choice:** Remover dedup — cliente (WhatsApp/CRM) não envia X-Request-Id.
**Notes:** Usuário perguntou o que é X-Request-Id. Após explicação, decidiu remover: o sistema cliente não vai enviar esse header, logo a feature não tem valor prático.

---

## Runner Injection Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Construtor | new WebhookTransport(runner) — ITransport não muda | ✓ |
| Parâmetro em start() | start(port, runner) — muda ITransport interface | |

**User's choice:** Construtor — mais limpo, ITransport interface intacta.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Lança erro no start() | ConfigurationError se runner não injetado | ✓ |
| Runner obrigatório no construtor | TypeScript non-optional parameter | |

**User's choice:** Lança erro em start() — fail-fast sem falha em compile time.

---

## Lint Tool

| Option | Description | Selected |
|--------|-------------|----------|
| Biome | Mais rápido, Bun-nativo, lint + format | |
| Corrigir ESLint | Instalar deps faltando, adicionar scripts | ✓ |

**User's choice:** Corrigir ESLint — manter consistência com o que já existe.

---

| Option | Description | Selected |
|--------|-------------|----------|
| src/ apenas | Lint só em código de produção | ✓ |
| src/ e testes | Lint em todo TypeScript | |

**User's choice:** src/ apenas.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Pacotes herdam root .eslintrc.js | Só adicionar script lint por pacote | ✓ |
| Cada pacote tem seu .eslintrc.js | Controle por pacote | |

**User's choice:** Herdar root — zero duplicação.

---

## Claude's Discretion

- Mensagem exata do ConfigurationError quando runner ausente
- Versão de @typescript-eslint/parser + plugin a instalar
- Ordem das mudanças no PR (schema → runner → lint)

## Deferred Ideas

- Migração para Biome — v1.2 quando houver necessidade de formatação
- Lint cobrindo testes — avaliar futuramente
