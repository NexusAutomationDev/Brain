# Phase 8: BrainRunner + Conversation History - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-14
**Phase:** 08-brainrunner-conversation-history
**Areas discussed:** trimMessages — estratégia e config, Verificação do histórico (HIST-02), Update dos testes (HIST-01)

---

## trimMessages — Estratégia e Config

| Option | Description | Selected |
|--------|-------------|----------|
| Reducer do state graph | Definir trimMessages no MessagesAnnotation — LangGraph aplica antes de salvar checkpoint | |
| Pre-invoke no BrainRunner.run() | Ler checkpoint, slicear mensagens, passar janela ao invoke | ✓ |
| Claude decide | Abordagem tecnicamente mais limpa | |

**User's choice:** Pre-invoke no BrainRunner.run()

---

| Option | Description | Selected |
|--------|-------------|----------|
| Contagem de mensagens | MAX_MESSAGES_HISTORY ENV — simples e previsível | ✓ |
| Token count | MAX_TOKENS_HISTORY — preciso mas exige tokenizer | |
| Claude decide | Abordagem mais simples para v1 | |

**User's choice:** Contagem de mensagens

---

| Option | Description | Selected |
|--------|-------------|----------|
| CONTEXT_WINDOW_MESSAGES=40 | 40 msgs = 20 turnos, histórico completo no banco | ✓ |
| CONTEXT_WINDOW_MESSAGES=20 | 20 msgs = 10 turnos, mais econômico | |
| Outro valor / nome diferente | — | |

**User's clarification (free text):** "nao quero limite de qualva no historion mais quero limite de quando vai busca do historio" — usuário quer histórico completo armazenado, limite apenas no que é enviado ao LLM por chamada.

**Notes:** Decisão crítica: PostgresSaver guarda tudo (ilimitado). `CONTEXT_WINDOW_MESSAGES=40` controla apenas a janela passada ao LLM no invoke. Razão: Phase 9 (SDR-05) vai precisar do histórico completo para o sub-agente de qualificação.

---

## Verificação do Histórico (HIST-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Mesmo runner, segunda chamada recebe histórico | Dois run() com mesmo IDLead em sequência | ✓ |
| Dois runners separados | Mais realista para restart mas mais complexo | |
| Claude decide | Claude escolhe abordagem mais realista | |

**User's choice:** Mesmo runner, segunda chamada recebe histórico

---

## Update dos Testes (HIST-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Confirmar thread_id = lead.uniqueId (IDLead) | Assert explícito + remover comentário Phase 8 | ✓ |
| Apenas atualizar o comentário | Sem assert adicional | |

**User's choice:** Confirmar thread_id = lead.uniqueId com assert explícito

---

## Claude's Discretion

- Implementação exata de getState() para ler checkpoint
- Fallback para CONTEXT_WINDOW_MESSAGES ausente (padrão 40, sem process.exit)
- Estrutura do assertion de HIST-01 no integration test

## Deferred Ideas

- Token-based context window — v1.2
- Dois runners separados para testar persistência entre restarts — complexidade extra sem valor em v1.1
- GET /history/:leadId API — Phase 9+
