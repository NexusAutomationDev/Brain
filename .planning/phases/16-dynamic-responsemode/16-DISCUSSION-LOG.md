# Phase 16: Dynamic responseMode - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 16-dynamic-responsemode
**Areas discussed:** Router customizado no brain-sdr, Schema da respond tool, Localização de createRespondTool, PITFALL-6: texto plano

---

## Router customizado no brain-sdr

| Option | Description | Selected |
|--------|-------------|----------|
| Router customizado substitui toolsCondition | Inspeciona tool_calls: 'respond' → nó respond; outras → tools; nenhuma → __end__ | ✓ |
| respond tool processada no próprio nó llm | Detecta tool_calls 'respond' inline, seta brainOutput, sem nó separado | |
| Dois ToolNodes separados | ToolNode 'respond_node' + ToolNode 'tools' com router entre eles | |

**User's choice:** Router customizado substitui toolsCondition

---

| Option | Description | Selected |
|--------|-------------|----------|
| Não — nó respond só seta brainOutput, sem ToolMessage | Menos ruído no histórico do LangGraph | |
| Sim — nó respond executa via ToolNode (ToolMessage vai para messages) | Consistência AIMessage/ToolMessage no PostgresSaver | ✓ |

**User's choice:** ToolMessage vai para messages para consistência LangGraph

---

## Schema da respond tool

| Option | Description | Selected |
|--------|-------------|----------|
| Schema mínimo: fullResponse + responseMode apenas | text/audio/image sem URL | |
| Schema completo com mediaType + mediaUrl opcionais | Espelha BrainOutput | ✓ |

**User's choice:** Schema completo definido pelo usuário (ver schema JSON em CONTEXT.md `<specifics>`)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Mapear 'undefined' → 'text' no nó respond | BrainOutput inalterado | |
| Adicionar 'undefined' ao ResponseMode no BrainOutput | Contrato público muda | ✓ |

**User's choice:** Adicionar "undefined" ao ResponseMode em packages/shared

---

| Option | Description | Selected |
|--------|-------------|----------|
| 'file' → mapeado para 'document' no nó respond | Sem nova migration, compatibilidade com BrainOutput | ✓ |
| Adicionar 'file' ao ResponseMode em shared/types | Alias de 'document' | |
| Remover 'file' do schema da tool — usar 'document' | Sem mapeamento | |

**User's choice:** Mapear 'file' → 'document' no nó respond

---

## Localização de createRespondTool

| Option | Description | Selected |
|--------|-------------|----------|
| packages/core | Padrão estabelecido com createPauseSessionTool | ✓ |
| packages/ai | Mais próximo de BrainStateAnnotation | |

**User's choice:** packages/core

---

## PITFALL-6: texto plano

| Option | Description | Selected |
|--------|-------------|----------|
| Fallback: texto plano → responseMode 'undefined' | Degraded behavior, não erro | ✓ |
| BrainOutputValidationError | Falha explícita | |
| Retry automático com remind | Máx 1 retry | |

**User's choice:** Fallback silencioso com responseMode 'undefined'

---

| Option | Description | Selected |
|--------|-------------|----------|
| Nova migration SQL para system prompt | UPDATE em banco existente | |
| Editar seed existente | Sem migration | |

**User's choice:** System prompt NÃO precisa de atualização — tool description em bindTools() é suficiente. docs/guides/response-format-prompt.md será RECRIADO.

---

## Claude's Discretion

- Pattern de validação de mediaUrl (regex vs z.string().url())
- Lógica exata do fallback PITFALL-6 quando content vazio
- Nomenclatura interna do router customizado (`routeAfterLlm`)

## Deferred Ideas

- `splitResponse`: divisão em múltiplos balões — mencionada em docs existente, fora de escopo
- `responseMode: "image"` com geração de imagem via URL — integração com gerador futuro
- Canal de resposta RabbitMQ com responseMode + mediaUrl (RESP-F02)
