# Phase 2: Domain Packages - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 02-domain-packages
**Areas discussed:** Observability backend, Idempotência do Webhook, Estratégia de testes, Escopo do LLM provider

---

## Observability backend

| Option | Description | Selected |
|--------|-------------|----------|
| Langfuse | Segue REQUIREMENTS.md e SC-4. Self-hostable, sem AsyncLocalStorage. | ✓ |
| LangSmith | CLAUDE.md recomenda. Blocker de AsyncLocalStorage no Bun. | |
| Ambos (dual export) | Wrapper que suporta os dois via env. Over-engineering para v1. | |

**User's choice:** Langfuse

**Follow-up: Modo de integração**

| Option | Description | Selected |
|--------|-------------|----------|
| LangChain callback handler | CallbackHandler() passado nas invocações, auto-capture. | ✓ |
| SDK direto (manual tracing) | langfuse.trace()/span() em cada nó. Mais controle, mais verboso. | |

**User's choice:** LangChain callback handler

---

## Idempotência do Webhook

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory TTL cache | Map<requestId, timestamp> com TTL. Zero infra extra. Perde no restart. | ✓ |
| PostgreSQL (tabela de dedup) | Durável após restart. Precisa migração e query extra por request. | |

**User's choice:** In-memory TTL cache
**Notes:** Usuário pediu explicação mais detalhada antes de decidir. Após explicação das implicações (perda de estado no restart vs query adicional), confirmou in-memory.

**Follow-up: Path do endpoint**

| Option | Description | Selected |
|--------|-------------|----------|
| /webhook | Path simples padrão. | |
| /api/v1/webhook | Versionado. | ✓ |
| Configurável via env (WEBHOOK_PATH) | Flexível, adiciona complexidade. | |

**User's choice:** /api/v1/webhook

---

## Estratégia de testes (embeddings/LLM)

| Option | Description | Selected |
|--------|-------------|----------|
| Mock completo via bun test | mock.module() para LLM/embeddings. Determinístico, zero custo. | ✓ |
| Fake embeddings determinísticos | Vetores via hash do texto. Testa pipeline com PG real. | |
| API real com chave de teste | Lento, custa dinheiro, flake por rate limit. | |

**User's choice:** Mock completo via bun test

**Follow-up: Integração PostgresSaver**

| Option | Description | Selected |
|--------|-------------|----------|
| PostgreSQL real | PG local via TEST_DATABASE_URL. Valida SC-1 corretamente. | ✓ |
| MemorySaver para simular | Viola AI-01 e o espírito do requisito. | |

**User's choice:** PostgreSQL real

---

## Escopo do LLM provider

| Option | Description | Selected |
|--------|-------------|----------|
| Interface genérica + OpenAI como default | createLLM() retorna BaseChatModel. Multi-provider via env. | |
| OpenAI hardcoded | Simples, viola AI-05. | |

**User's choice:** Nenhuma das opções padrão — resposta livre:
> "não é para de openai como default, e qual llm vai ser via env: `LLM_PROVIDER=openai|anthropic|gemini|openrouter`, `LLM_MODEL=`, `LLM_MODEL_EMBEDDING=`"

**Resolved:** Factory completamente env-driven, sem default. Suporte a 4 providers. Falha com ConfigurationError se LLM_PROVIDER ausente.

**Follow-up: Nome do env var de embedding**

| Option | Description | Selected |
|--------|-------------|----------|
| Manter EMBEDDING_MODEL | Já no schema Phase 1 e REQUIREMENTS.md AI-04. | ✓ |
| Renomear para LLM_MODEL_EMBEDDING | Consistência com LLM_MODEL. Quebra AI-04. | |

**User's choice:** Manter EMBEDDING_MODEL

---

## Claude's Discretion

- TTL exato do in-memory dedup cache
- Estrutura interna do MemoryManager (composição vs herança)
- Como expor o Langfuse CallbackHandler (singleton ou factory por request)

## Deferred Ideas

- RabbitMQ transport — v2
- OpenTelemetry self-hosted — v2
- Checkpoint pruning job — v2
