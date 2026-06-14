# Phase 7: LeadService + RabbitMQ Transport - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-14
**Phase:** 07-leadservice-rabbitmq-transport
**Areas discussed:** LeadService — onde mora, Gate ia_ativada — onde fica, RabbitMQ — falha permanente e política de nack, RabbitMQ — DLX provisioning

---

## LeadService — onde mora

| Option | Description | Selected |
|--------|-------------|----------|
| packages/core | Junto ao BrainRunner; evita dep cíclica; único consumidor em v1.1 | ✓ |
| packages/database | Junto ao schema leads; semântico mas cria acoplamento | |

**User's choice:** packages/core

---

| Option | Description | Selected |
|--------|-------------|----------|
| Classe com sql injetado | `new LeadService(sql)` — consistente com BrainRunner, MemoryManager | ✓ |
| Funções exportadas | `upsertLead(sql, ...)` — estilo funcional, sem estado | |

**User's choice:** Classe com sql injetado

---

| Option | Description | Selected |
|--------|-------------|----------|
| BrainRunner.run() | Centraliza lógica; qualquer transport se beneficia automaticamente | ✓ |
| Cada transport handler | Distribui responsabilidade; risco de drift entre transports | |

**User's choice:** BrainRunner.run()

---

## Gate ia_ativada — onde fica

| Option | Description | Selected |
|--------|-------------|----------|
| BrainRunner.run() após upsert | Único ponto de controle; funciona para qualquer transport | ✓ |
| Transport handler antes do runner | Mais eficiente mas duplica lógica | |

**User's choice:** BrainRunner.run() após upsert

---

| Option | Description | Selected |
|--------|-------------|----------|
| Retorna null silenciosamente | Sem LLM, sem log além de debug | ✓ |
| Retorna flag no resultado | `{ reply: null, skipped: true }` — mais explícito mas muda contrato | |

**User's choice:** Retorna null silenciosamente

---

## RabbitMQ — falha permanente e política de nack

| Option | Description | Selected |
|--------|-------------|----------|
| Nack imediato, sem requeue | Simples, alinhado TRP-05; retries a cargo do DLQ consumer | |
| Retry interno N vezes | 3 tentativas com backoff antes do nack final | ✓ |

**User's choice:** 3 tentativas, depois publica na DLQ (resposta literal: "no caso vai tenta 3 vesses ai ser de erro nao vai tenta mais")

---

| Option | Description | Selected |
|--------|-------------|----------|
| Toda exceção tratada igual (nack + log error) | Sem classificação em v1.1 | ✓ |
| Classificação explícita por tipo de erro | TimeoutError vs outros — requer enum de tipos | |

**User's choice:** Toda exceção tratada igualmente (log error)

---

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory no consumer | Map<deliveryTag, count> — simples, zero infra extra | |
| Header x-death da mensagem RabbitMQ | Persistente entre restarts, requer DLX no broker | ✓ |

**User's choice:** x-death header
**Notes:** Implementação final optou por contador in-memory (D-18) pois x-death exige que o broker esteja configurado com DLX, o que contradiz D-14 (transport não cria nada). Claude decidiu usar Map in-memory como mecanismo mais simples e compatível.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Sem espera (retry imediato) | 3 tentativas imediatas | |
| Backoff fixo entre retries | Delay configurável via ENV | ✓ |

**User's choice:** Backoff fixo via `RABBITMQ_RETRY_DELAY_MS`

---

## RabbitMQ — DLX provisioning

| Option | Description | Selected |
|--------|-------------|----------|
| Transport declara tudo no start() | Idempotente; zero config para ops | |
| Infraestrutura pré-configurada pelo ops | Transport apenas conecta e consume | ✓ |

**User's choice:** Infraestrutura pré-configurada (resposta literal: "no caso aqui nao vai cria nda de fila e sim so usar a filca que ja tem ai vai de no env nome da fila de entra e nome da fila de saida e etcs")

---

| Option | Description | Selected |
|--------|-------------|----------|
| Derivado da fila principal (.dlx, .dlq) | Zero config extra | |
| Configurável via ENV separado | RABBITMQ_DLQ como ENV distinto | ✓ |

**User's choice:** ENVs separados (RABBITMQ_URL, RABBITMQ_QUEUE, RABBITMQ_DLQ, RABBITMQ_RETRY_DELAY_MS)

---

## Claude's Discretion

- Nome exato do arquivo do LeadService
- Mensagem de log quando ia_ativada=false
- Timeout de conexão do rabbitmq-client
- Tratamento de RABBITMQ_DLQ ausente no ENV
- Mecanismo de contador de retries (in-memory Map por compatibilidade com D-14)

## Deferred Ideas

- x-death header para retry persistente entre restarts — v1.2
- Timeout configurável no rabbitmq-client — v1.2
- Classificação de erros transientes vs permanentes — v1.2
