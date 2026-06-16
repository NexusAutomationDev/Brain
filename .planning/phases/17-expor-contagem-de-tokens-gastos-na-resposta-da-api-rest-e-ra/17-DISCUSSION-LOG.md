# Phase 17: Expor contagem de tokens - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 17-expor-contagem-de-tokens-gastos-na-resposta-da-api-rest-e-ra
**Areas discussed:** Contrato BrainOutput, Nomenclatura dos campos, Captura e aggregação, Exposição via RabbitMQ

---

## Contrato BrainOutput

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, campo opcional no BrainOutput | Estende BrainOutput: tokenUsage?: { ... }. Validado pelo BrainOutputSchema (Zod). | |
| Não, campo extra só na resposta HTTP | BrainOutput não muda. handler.ts adiciona tokenUsage no JSON separadamente. | ✓ |
| Sim, no BrainOutput mas sem validação Zod | Tipo TypeScript estendido, BrainOutputSchema passa tokenUsage sem validar. | |

**User's choice:** Não — campo extra só na resposta HTTP. BrainOutput permanece inalterado.

**Follow-up — acesso ao tokenUsage no handler.ts:**

| Option | Description | Selected |
|--------|-------------|----------|
| runner.run() retorna wrapper {brainOutput, tokenUsage} | BrainRunner.run() retorna { brainOutput: BrainOutput; tokenUsage?: TokenUsage } \| null | ✓ |
| BrainRunner expõe getLastTokenUsage() | Método separado; handler chama run() e depois getLastTokenUsage() | |

**User's choice:** runner.run() retorna wrapper — IBrainRunnerLike também atualiza.

---

## Nomenclatura dos campos

| Option | Description | Selected |
|--------|-------------|----------|
| camelCase consistente com o projeto | { inputTokens, outputTokens, totalTokens } | ✓ |
| Compatível com OpenAI (promptTokens/completionTokens) | { promptTokens, completionTokens, totalTokens } | |

**User's choice:** camelCase — `{ inputTokens: number; outputTokens: number; totalTokens: number }`.

**Follow-up — fallback quando provider não suporta:**

| Option | Description | Selected |
|--------|-------------|----------|
| Omitir tokenUsage (undefined/ausente) | tokenUsage não aparece no JSON quando sem dados | |
| Retornar zeros | { inputTokens: 0, outputTokens: 0, totalTokens: 0 } | ✓ |

**User's choice:** Retornar zeros explícitos — contrato previsível para o client.

---

## Captura e aggregação

| Option | Description | Selected |
|--------|-------------|----------|
| Somar todos os calls do turno | Acumula todos os LLM calls — custo real para billing | ✓ |
| Só o último call | Captura usage_metadata apenas do último AIMessage | |

**User's choice:** Somar todos os calls do turno.

**Follow-up — onde capturar:**

| Option | Description | Selected |
|--------|-------------|----------|
| Acumulador no BrainState (packages/ai) + BrainRunner extrai | BrainStateAnnotation ganha tokenUsage; nó llm de cada Brain atualiza; BrainRunner extrai após invoke() | ✓ |
| Callback handleLLMEnd no BrainRunner (centralizado) | BrainRunner passa callback; Brains não mudam | |
| Ler AIMessage.usage_metadata após invoke (simples) | BrainRunner soma usage_metadata de todos os AIMessages do state | |

**User's choice:** Acumulador no BrainState — captura semântica, Brains atualizam o acumulador.
**Notes:** Usuário especificou querer algo centralizado nos packages; BrainState em packages/ai é o ponto canônico para estado do grafo.

---

## Exposição via RabbitMQ

| Option | Description | Selected |
|--------|-------------|----------|
| Só logar com Pino | consumer.ts loga tokenUsage com pino.info — zero mudança no broker | ✓ |
| Publicar reply em fila separada (RABBITMQ_REPLY_QUEUE) | consumer.ts publica { IDLead, Numero, tokenUsage } em nova fila | |
| Mesma fila de reply do RabbitMQ (não implementada ainda) | Defer para fase de reply-channel | |

**User's choice:** Só logar com Pino — monitoramento via log aggregation.

---

## Claude's Discretion

- Reducer do acumulador `tokenUsage` em BrainState (soma vs last-write-wins)
- Localização exata do tipo `TokenUsage` em packages/shared/src/types/index.ts
- Tratamento de `response.usage_metadata` null/undefined (contribuição zero)

## Deferred Ideas

- Publicar tokenUsage via RabbitMQ em fila de reply — deferido para canal de resposta async
- Exposição por LLM call (array granular) — aggregação por turno suficiente agora
