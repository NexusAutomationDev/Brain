# Phase 12: Brain SDR Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 12-brain-sdr-integration
**Areas discussed:** Resposta do webhook, Binding das standard tools, Prompts SDR, Testes pós-migração

---

## Resposta do webhook

| Option | Description | Selected |
|--------|-------------|----------|
| BrainOutput completo | Retorna { status: 'ok', fullResponse, responseMode, mediaType?, mediaUrl? } — downstream pode tomar decisões por responseMode | ✓ |
| Manter reply apenas | Retorna { status: 'ok', reply: fullResponse } — como está hoje, sem breaking change | |
| Ambos (backward-compat) | Retorna reply + fullResponse + responseMode — duplicado mas sem quebrar clientes | |

**User's choice:** BrainOutput completo
**Notes:** O campo `reply` é removido intencionalmente — alinhado com a política de breaking changes do projeto. O downstream deve usar `fullResponse` diretamente.

### RabbitMQ

| Option | Description | Selected |
|--------|-------------|----------|
| Sim (alinha com Criterion 1) | RabbitMQ também deve lidar com BrainOutput completo quando/se publicar | ✓ |
| RabbitMQ é out of scope em v1.2 | Apenas consome, não publica de volta — Criterion 1 interpretado como runner retornando BrainOutput | |

**User's choice:** Alinha com Criterion 1
**Notes:** RabbitMQ não publica de volta (fora de escopo). Criterion 1 satisfeito porque `BrainRunner.run()` retorna `BrainOutput | null` — o transport usa internamente.

---

## Binding das standard tools

| Option | Description | Selected |
|--------|-------------|----------|
| Bound direto no buildGraph, sem stubs | createPauseSessionTool(ctx.sql) criada com closure — mesma pattern do boundQualifyTool. sdrBrain.tools[] não muda | ✓ |
| Stubs em tools[] + bound no buildGraph | Stubs sem sql em sdrBrain.tools[] para BRAIN_TOOLS poder filtrar standard tools | |

**User's choice:** Bound direto no buildGraph, sem stubs
**Notes:** Mantém consistência com o padrão existente do boundQualifyTool. BRAIN_TOOLS filtering para standard tools é adiado para v1.3.

---

## Prompts SDR

| Option | Description | Selected |
|--------|-------------|----------|
| Atualizar system prompt | Adicionar instruções sobre quando usar pause/finish via migration seed | |
| Confiar apenas na tool description | LLM aprende via name/description das factories — zero mudança nos prompts | ✓ |
| Você decide | Deixar para o planejador/executor | |

**User's choice:** Confiar apenas na tool description
**Notes:** Sem alterações nos prompts do banco nesta fase.

---

## Testes pós-migração

| Option | Description | Selected |
|--------|-------------|----------|
| Unit tests atualizados | Mock de ctx.sql, verificar 3 tools no ToolNode, brainOutput no estado — sem DB real | ✓ |
| Unit + Integration test de POST | Unit + POST real ao webhook com DB ativo — satisfaz Criterion 3 literalmente | |

**User's choice:** Unit tests atualizados
**Notes:** Success Criterion 3 validado via build/typecheck + unit tests com mock do sql. Integration com DB real é deferida.

---

## Claude's Discretion

- Ordem dos bound tools no array passado ao ToolNode e ao bindTools()
- Mensagem de erro no teste quando ctx.sql é mock — verificar que buildGraph() não lança

## Deferred Ideas

- Stubs de pause_session/finish_conversation em sdrBrain.tools[] — v1.3+
- Integration tests do POST /webhook com DB real — pós v1.2
- Atualização dos prompts SDR com instruções explícitas sobre pause/finish — deferido
