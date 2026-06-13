# Phase 4: Validation Brain - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 04-validation-brain
**Areas discussed:** Echo Brain, Assembly do servidor, Estratégia do Dockerfile, Testes de integração

---

## Echo Brain

| Option | Description | Selected |
|--------|-------------|----------|
| LLM real + system prompt do banco | buildGraph() cria nó que chama LLM com system prompt carregado da tabela prompts. Prova fluxo completo. | ✓ |
| Nó de passagem sem LLM | buildGraph() retorna o input diretamente. Zero custo de API, mas não prova integração LLM. | |
| LLM real + prompt hardcoded | LLM real mas prompt no código. Viola SDK-04 (prompts devem estar no banco). | |

**User's choice:** LLM real + system prompt do banco
**Notes:** Usuário descreveu: recebe msg do usuário, pega o prompt do banco, e com base nisso o agente responde. Alinha com opção 1.

---

## Echo Brain — Tools

| Option | Description | Selected |
|--------|-------------|----------|
| Sem tools | EchoBrain.tools = []. ToolsRegistry ainda é exercitado com lista vazia. | ✓ |
| Tool de exemplo simples | Uma tool dummy só para provar ToolsRegistry habilitando/desabilitando. | |

**User's choice:** Sem tools
**Notes:** Usuário perguntou "por que não colocar tools já?" mas ao entender que Phase 4 é só validação, confirmou sem tools por ora.

---

## Assembly do Servidor

| Option | Description | Selected |
|--------|-------------|----------|
| Um Hono app com route mounting | app.route('/') para cada sub-app. Um único Bun.serve. | ✓ |
| Factory em packages/core | createBrainApp() extrai o padrão para reuse futuro. Mais indireção agora. | |

**User's choice:** Um Hono app com route mounting
**Notes:** Simplicidade preferida para a fase de validação.

---

## Entrypoint / Ordem de Inicialização

| Option | Description | Selected |
|--------|-------------|----------|
| Sequencial: migrate → init → serve | Alinha com padrão fail-fast de phases 1-3. | ✓ |
| Só init → serve (sem migrate no startup) | Migration responsabilidade do CI/CD. Container mais simples. | |

**User's choice:** Sequencial: migrate → init → serve
**Notes:** Mantém consistência com o padrão já estabelecido.

---

## Seed de Prompts

| Option | Description | Selected |
|--------|-------------|----------|
| Seed SQL embutido no migrate | INSERT ... ON CONFLICT DO NOTHING na migration sequence. | ✓ |
| Script seed separado | bun run seed rodado manualmente antes do primeiro start. | |

**User's choice:** Seed SQL embutido no migrate
**Notes:** Nenhum passo manual necessário — container sobe pronto.

---

## Dockerfile

| Option | Description | Selected |
|--------|-------------|----------|
| 2 estágios: builder + runner | Stage builder compila; stage runner só com artefatos + prod deps. Imagem menor. | ✓ |
| 1 estágio simples | Copia monorepo e roda TS direto com Bun. Mais simples, imagem maior. | |

**User's choice:** 2 estágios: builder + runner

---

## Build Context do Docker

| Option | Description | Selected |
|--------|-------------|----------|
| Dockerfile em apps/brain-echo, build da raiz | docker build -f apps/brain-echo/Dockerfile . — acesso a todos os packages/. | ✓ |
| Dockerfile na raiz, parametrizado por APP | Genérico mas mistura concerns de múltiplas apps. | |

**User's choice:** Dockerfile em apps/brain-echo, build da raiz

---

## SC-3 — Restart do Container

| Option | Description | Selected |
|--------|-------------|----------|
| Bun test com docker CLI | Bun.spawn rodando docker commands. Automatizado, roda em CI. | ✓ |
| Verificação manual documentada | Runbook em docs/guides/validation.md. Não automatizado. | |

**User's choice:** Bun test com docker CLI

---

## SC-4 — 10 Tenants Simultâneos

| Option | Description | Selected |
|--------|-------------|----------|
| Bun test direto contra o pool | TenantPoolManager + pg_stat_activity. Rápido, sem Docker. | ✓ |
| Via HTTP com 10 containers | Mais fiel ao uso real, mas muito mais lento e complexo. | |

**User's choice:** Bun test direto contra o pool

---

## Localização dos Testes de Integração

| Option | Description | Selected |
|--------|-------------|----------|
| apps/brain-echo/src/__tests__/integration/ | Segue convenção do projeto. | ✓ |
| packages/core/src/__tests__/integration/ | Menos acoplado à app específica, mas lugar errado para testes que precisam do Docker do brain-echo. | |

**User's choice:** apps/brain-echo/src/__tests__/integration/

---

## Claude's Discretion

- Conteúdo exato do system prompt do Echo Brain
- Porta padrão (3000 via PORT env)
- Estrutura interna do nó LLM no buildGraph()
- Nome do arquivo de migration para o seed de prompts

## Deferred Ideas

- Tools concretas no Echo Brain → Brain SDR/Suporte v2
- RabbitMQ transport → v2
- Checkpoint table pruning → v2
