# Phase 29: Brain Suporte Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 29-brain-suporte-core
**Areas discussed:** Tools de gestão, MCP dinâmico, isolamento de banco, persona/prompt, execução técnica das tools, confirmação final

---

## Tools de gestão do Brain Suporte

| Option | Description | Selected |
|--------|-------------|----------|
| pause_session + finish_conversation apenas | Reaproveita as duas tools genéricas do SDR, sem equivalente de "qualify" | ✓ |
| pause_session + finish_conversation + escalate_to_human | Adiciona tool de escalonamento para humano | |
| Descrever fluxo específico | Usuário descreve um fluxo próprio (ticket, pedido, etc.) | |

**User's choice:** pause_session + finish_conversation apenas
**Notes:** qualify_lead é conceito de venda (SDR), não se aplica a suporte. SUP-03 menciona "qualify" como artefato de cópia da lista de tools do SDR.

---

## Onde vive o servidor MCP das management tools

| Option | Description | Selected |
|--------|-------------|----------|
| Novo MCP server neste repo | Server MCP dentro do monorepo expondo as mesmas factories | |
| MCP externo (n8n) mantido pelo usuário | Brain Suporte só consome via MCP_URL | ✓ (inicialmente) |

**User's choice (inicial):** MCP externo (n8n)
**Notes:** Essa resposta foi reconsiderada no follow-up de execução técnica abaixo — ver seção seguinte.

---

## Execução técnica: quem muta o Postgres quando a tool é chamada

| Option | Description | Selected |
|--------|-------------|----------|
| brain-support expõe endpoint HTTP p/ n8n chamar | Endpoints protegidos por token; n8n só dispara a chamada HTTP | |
| n8n conecta direto no Postgres do cliente | Servidor n8n executa o UPDATE diretamente | |

**User's choice (texto livre):** "soube as tools vai ser o padrão do mesmo que está no brain de sdr só que não vai ter o qualify" — interpretado como: pause_session/finish_conversation devem seguir o MESMO padrão hardcoded do SDR (closures nativas sobre `sql`), não vir de MCP externo.
**Notes:** Esta resposta contradiz a escolha anterior de "MCP externo" para essas duas tools especificamente — motivou a pergunta de confirmação abaixo.

---

## Confirmação: hardcode vs MCP para pause_session/finish_conversation

| Option | Description | Selected |
|--------|-------------|----------|
| Confirmado — hardcode igual SDR, sem qualify | pause_session/finish_conversation nativas; MCP dinâmico genérico disponível mas não usado pra essas duas; reinterpretação de SUP-03 documentada no CONTEXT.md | ✓ |
| Não, quero repensar | Reconsiderar a decisão | |

**User's choice:** Confirmado — hardcode igual SDR, sem qualify
**Notes:** Resolve a contradição — D-02 no CONTEXT.md documenta explicitamente que isso reinterpreta a letra de SUP-03.

---

## Isolamento de banco entre Brains do mesmo cliente

| Option | Description | Selected |
|--------|-------------|----------|
| Banco separado por Brain | cliente_x_sdr e cliente_x_suporte, DATABASE_NAME distinto | ✓ |
| Mesmo banco do cliente para os dois Brains | DATABASE_NAME compartilhado, EMBEDDING_DIMENSIONS teria que ser igual | |

**User's choice (texto livre):** "no caso vai ser outra img dkcer que vai conete com mesmo postfes so que outro db" — outra imagem Docker, mesmo servidor Postgres, banco (DATABASE_NAME) diferente.
**Notes:** Confirma que SUP-04 (dimensões de embedding independentes) funciona estruturalmente.

---

## Persona / prompt inicial do Brain Suporte

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder genérico agora, refino depois | Prompt simples carregado do banco, editável depois via /reload-prompts | ✓ |
| Quero definir agora | Usuário descreve tom/políticas agora | |

**User's choice:** Placeholder genérico agora, refino depois

---

## Fechamento

| Option | Description | Selected |
|--------|-------------|----------|
| Pronto para o CONTEXT.md | Decisões suficientes para pesquisa e planejamento | ✓ |
| Quero explorar mais alguma área | Ainda há algo em aberto | |

**User's choice:** Pronto para o CONTEXT.md

## Claude's Discretion

- Mecanismo exato de bypass do filtro `enabledTools` para `search_knowledge` (garantir SUP-02).
- Conteúdo final do prompt de sistema além do placeholder genérico.
- Endpoint de ingest da base de conhecimento do Suporte (reaproveitar `/api/v1/ingest` vs. rota dedicada).
- Nomes de collections default para RAG do Suporte.

## Deferred Ideas

- Tool de escalonamento explícito (`escalate_to_human`) — descartada para esta fase.
- MCP externo (n8n) servindo tools de gestão via callback HTTP — avaliado e rejeitado em favor do hardcode.
- Múltiplos Brains compartilhando o mesmo banco de um cliente — fora de escopo.
