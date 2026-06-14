# Phase 9: Brain SDR - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — este log preserva as alternativas consideradas.

**Date:** 2026-06-14
**Phase:** 09-brain-sdr
**Areas discussed:** Acionamento do sub-agente, promptKeys do Brain SDR, TenantPoolManager (INFRA-01), Estrutura do grafo SDR

---

## Acionamento do sub-agente

| Option | Description | Selected |
|--------|-------------|----------|
| Tool call (LLM decide) | O LLM chama uma tool `qualify_lead(description, session_id)` quando julga o momento certo. Grafo: nó LLM → nó tools (condicional) → nó LLM (resposta final). | ✓ |
| Trigger programático | Código detecta intenção (keyword, contador de turnos, flag no estado) e chama o sub-agente via TypeScript puro. LLM não decide o momento. | |
| Híbrido: tool call mas acionar é obrigatório após N turnos | LLM pode acionar via tool call a qualquer momento, mas o código força a qualificação após um número fixo de turnos como fallback. | |

**User's choice:** Tool call (LLM decide)
**Notes:** O LLM decide quando qualificar — alinhado com o padrão LangGraph ReAct.

---

## Sub-agente: implementação

| Option | Description | Selected |
|--------|-------------|----------|
| Novo LangGraph graph (StateGraph) | Sub-agente é um StateGraph separado, compilado com checkpointer próprio. Máximo de contexto e controle. | ✓ |
| Chamada direta ao LLM (sem grafo) | Função TypeScript que chama `llm.invoke([...historico...])` diretamente. Simples, sem overhead. | |
| Você decide | Claude escolhe a abordagem mais simples que satisfaça SDR-05. | |

**User's choice:** Novo LangGraph graph (StateGraph)
**Notes:** Mas stateless por design — sem persistência no banco, sem checkpointer de produção.

---

## Sub-agente: LLM

| Option | Description | Selected |
|--------|-------------|----------|
| Mesmo LLM (recebido via BrainBuildContext) | Reutiliza `ctx.llm` — mesmo modelo e configuração do Brain principal. Simples, sem ENVs extras. | ✓ |
| LLM independente (suas próprias ENVs) | Sub-agente cria seu próprio LLM com ENVs separadas (ex: `QUALIFIER_MODEL`). | |
| Você decide | Claude escolhe o padrão mais simples para v1.1. | |

**User's choice:** Mesmo LLM do ENV
**Notes:** Sub-agente usa `createLLM()` padrão — sem ENVs extras. Também confirmado: sub-agente não salva memória no banco, apenas avalia qualificação.

---

## Sub-agente: acesso ao histórico

| Option | Description | Selected |
|--------|-------------|----------|
| compiledGraph.getState(thread_id) no BrainRunner | O próprio BrainRunner lê o checkpoint pelo thread_id e separa mensagens IA vs lead antes de chamar a tool. | |
| PostgresSaver direto no sub-agente | O sub-agente recebe o session_id e usa um PostgresSaver próprio para buscar o checkpoint. | ✓ |
| Você decide | Claude escolhe a abordagem mais simples que não crie acoplamento desnecessário. | |

**User's choice:** PostgresSaver direto no sub-agente
**Notes:** Sub-agente recebe `session_id`, cria seu próprio PostgresSaver, carrega o checkpoint e separa IA vs lead.

---

## promptKeys do Brain SDR

| Option | Description | Selected |
|--------|-------------|----------|
| system + qualification | `system` = prompt do Brain principal. `qualification` = prompt do sub-agente. 2 chaves. | ✓ |
| system + qualification + objection_handling | Adiciona `objection_handling` para lidar com objeções. 3 chaves. | |
| Apenas system (qualification hardcoded) | Sub-agente tem prompt hardcoded. Apenas `system` no banco. | |
| Você decide | Claude define as chaves adequadas para satisfazer SDR-04. | |

**User's choice:** system + qualification
**Notes:** 2 chaves obrigatórias no banco — zero hardcode.

---

## Seed de prompts

| Option | Description | Selected |
|--------|-------------|----------|
| Seed SQL na migration (migration insere prompts padrão) | A migration do Brain SDR já inclui um INSERT dos prompts com conteúdo padrão. | ✓ |
| Script de seed separado (bun run seed) | Migration cria tabelas, seed script separado insere prompts. | |
| Você decide | Claude escolhe o padrão mais simples e consistente com o que já existe. | |

**User's choice:** Seed SQL na migration
**Notes:** INSERT inline na migration — cliente substitui via API se necessário.

---

## TenantPoolManager: ativação

| Option | Description | Selected |
|--------|-------------|----------|
| No entrypoint do app (brain-sdr/index.ts) | O `apps/brain-sdr/index.ts` cria o TenantPoolManager, obtém o pool via `DATABASE_NAME` ENV. Zero mudança no SDK. | ✓ |
| Modificar BrainRunner para aceitar TenantPoolManager | BrainRunner ganha opção de receber TenantPoolManager no construtor. Mais centralizado mas muda o SDK core. | |
| Você decide | Claude escolhe a abordagem menos invasiva para v1.1. | |

**User's choice:** No entrypoint do app (brain-sdr/index.ts)
**Notes:** Zero mudança no SDK — apenas o entrypoint do app gerencia o TenantPoolManager.

---

## TenantPoolManager: suporte a multi-tenant simultâneo

| Option | Description | Selected |
|--------|-------------|----------|
| Não — 1 instância = 1 cliente (DATABASE_NAME fixo por instância) | Cada instância Docker usa um DATABASE_NAME fixo via ENV. TenantPoolManager gerencia o pool mas não roteia entre tenants. | ✓ |
| Sim — 1 instância pode rotear entre múltiplos bancos | A instância recebe DATABASE_NAME no payload/header e usa TenantPoolManager para rotear. | |

**User's choice:** Não — 1 instância = 1 cliente
**Notes:** DATABASE_NAME é ENV fixa por instância. TenantPoolManager gerencia o pool de conexões.

---

## Estrutura do grafo SDR

| Option | Description | Selected |
|--------|-------------|----------|
| 2 nós: llm + tools (padrão ReAct) | Nó `llm` gera resposta ou chama tool. Nó `tools` executa `qualify_lead`. Roteamento condicional. | |
| 3 nós: llm + tools + response | Adiciona nó `response` separado para formatar a resposta final após qualificação. | (revertido) |
| 1 nó (como EchoBrain) | Grafo simples com 1 nó LLM que usa tool calling nativo. | |

**User's choice:** 2 nós (llm + tools) — padrão ReAct
**Notes:** O usuário inicialmente escolheu "3 nós" mas confirmou na pergunta de follow-up que o nó `llm` já gera a mensagem final após a tool retornar — nó `response` separado é redundante. Padrão ReAct com 2 nós.

---

## Tools do Brain SDR

| Option | Description | Selected |
|--------|-------------|----------|
| Não — apenas qualify_lead em v1.1 | A única tool do SDR é `qualify_lead`. Outras ficam para versões futuras. | ✓ |
| Sim — pelo menos 1 tool adicional | SDR precisa de mais tools em v1.1 além de qualificação. | |

**User's choice:** Não — apenas qualify_lead em v1.1
**Notes:** scope mantido mínimo para v1.1.

---

## Claude's Discretion

- Nome exato do arquivo do sub-agente
- Estrutura interna do StateGraph do sub-agente
- Conteúdo padrão dos prompts `system` e `qualification` no seed SQL
- Tratamento de erro no sub-agente (timeout, falha do PostgresSaver)
- Decisão sobre checkpointer do sub-agente (MemorySaver vs sem checkpointer)

## Deferred Ideas

- Tool `transfer_to_human` — pós v1.1
- Tool `schedule_followup` — pós v1.1
- Classificação SPIN/BANT completa — pós v1.1
- Roteamento dinâmico de tenant — quando escala demandar
