# Phase 3: Brain SDK - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-12
**Phase:** 03-brain-sdk
**Areas discussed:** IBrain.buildGraph() injection, prompts table schema, BrainRunner.run() return, Prompt loading timing

---

## IBrain.buildGraph() injection

### buildGraph() signature

| Option | Description | Selected |
|--------|-------------|----------|
| Deps injetados pelo Runner | buildGraph(ctx) recebe llm, prompts, tools do BrainRunner | ✓ |
| Puramente declarativo | Brain sem buildGraph(); Runner constrói grafo genérico | |

**User's choice:** Deps injetados pelo Runner (Recommended)

---

### State extension

| Option | Description | Selected |
|--------|-------------|----------|
| Estado base fixo, extensão no v2 | Phase 3 usa BrainStateAnnotation base sem campos customizados | ✓ |
| IBrain declara extensão de estado | IBrain inclui stateSchema opcional, Runner mescla com base | |

**User's choice:** Estado base fixo — SDR Brain extende em v2 quando for implementado

---

### tools[] type

| Option | Description | Selected |
|--------|-------------|----------|
| Instâncias StructuredTool | tools[] são instâncias LangChain já construídas | ✓ |
| Nomes (strings) resolvidos pelo Registry | tools[] são strings, Registry mapeia para implementações | |

**User's choice:** Instâncias StructuredTool (Recommended)

---

### buildGraph() return type

| Option | Description | Selected |
|--------|-------------|----------|
| StateGraph não compilado, Runner compila | buildGraph() retorna StateGraph; Runner chama .compile({ checkpointer }) | ✓ |
| CompiledStateGraph pelo Brain | Brain recebe checkpointer no ctx e retorna grafo compilado | |

**User's choice:** StateGraph não compilado, Runner compila (Recommended)

---

## prompts table schema

### Chave de prompt

| Option | Description | Selected |
|--------|-------------|----------|
| Chave global única | key único globalmente (ex: 'sdr-system') | |
| Chave escopada por (key, brainType) | UNIQUE(brain_type, key) — mesma key pode existir em diferentes Brains | ✓ |

**User's choice:** Chave escopada por (brain_type, key)
**Notes:** Sub-agentes também são Brain types separados com seus próprios promptKeys. Cada sub-agente que souber seus prompts terá `brain_type` próprio (ex: 'sdr-qualification').

---

### Versionamento

| Option | Description | Selected |
|--------|-------------|----------|
| Sem versão no v1 | Apenas key + content + timestamps | ✓ |
| Versão (version int) | Coluna version integer, incrementa no UPDATE | |

**User's choice:** Sem versão no v1

---

### Locale

| Option | Description | Selected |
|--------|-------------|----------|
| Sem locale no v1 | Prompts em português por padrão | ✓ |
| Com coluna locale | UNIQUE(brain_type, key, locale) | |

**User's choice:** Sem locale no v1

---

## BrainRunner.run() return

| Option | Description | Selected |
|--------|-------------|----------|
| { reply: string } | Apenas o texto da resposta do LLM | ✓ |
| { reply: string, state: BrainState } | Resposta + estado completo do grafo | |

**User's choice:** { reply: string } (Recommended)

---

## Prompt loading timing

### Estratégia de carregamento

| Option | Description | Selected |
|--------|-------------|----------|
| Startup único via init() | BrainRunner.init() carrega prompts antes do primeiro run() | ✓ |
| Lazy + cache (primeira chamada) | Primeiro run() carrega e cacheia | |
| UPDATE no banco + endpoint /reload-prompts | Endpoint para hot-reload sem restart | ✓ |

**User's choice:** Startup via init() + endpoint /reload-prompts para hot-reload sem restart

---

### Comportamento quando promptKey falta no banco

| Option | Description | Selected |
|--------|-------------|----------|
| Falha o startup (exit 1) | Alinha com Phase 1: container falha se configuração inválida | ✓ |
| Falha na primeira requisição | Startup permissivo, falha no run() | |

**User's choice:** Falha o startup (exit 1) (Recommended)

---

## Claude's Discretion

- Mecanismo de autenticação do endpoint `/reload-prompts` — simples para v1 (ex: header `X-Admin-Token`)
- Estrutura interna do `BrainRegistry`
- Inicialização do `ToolsRegistry` (construção do BrainRunner ou singleton)

## Deferred Ideas

- Extensão de estado por Brain (qualificationResult, etc.) → v2
- Locale/i18n na tabela prompts → v2
- Versionamento de prompts → v2
