# Phase 15: MCP Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 15-mcp-integration
**Areas discussed:** Injeção de MCP tools no grafo, SIGTERM — onde chamar runner.close(), MCP_TOOLS vazio / wildcard, Safe ToolNode para PITFALL-2

---

## Injeção de MCP tools no grafo

| Option | Description | Selected |
|--------|-------------|----------|
| ctx.mcpTools[] separado no BrainBuildContext | Novo campo em BrainBuildContext; Brain SDR espalha explicitamente | ✓ |
| BrainRunner augmenta ctx.tools[] com MCP tools | MCP tools merged no ctx.tools[] existente — criaria ambiguidade | |
| Brain é responsável — MCP tools via ENV no buildGraph() | Brain chama MultiServerMCPClient diretamente — quebra lifecycle único | |

**User's choice:** ctx.mcpTools[] separado no BrainBuildContext
**Notes:** ctx.tools[] é ignorado propositalmente pelo brain-sdr (usa bound tools com closure); ctx.mcpTools[] é um campo limpo sem ambiguidade

---

| Option | Description | Selected |
|--------|-------------|----------|
| Array vazio [] | Sem MCP_URL, ctx.mcpTools = [] — spread vazio é no-op | ✓ |
| Campo opcional (mcpTools?: StructuredTool[]) | undefined quando sem MCP_URL — Brain precisaria de guard | |

**User's choice:** Array vazio []
**Notes:** Sem condicional nos Brains — spread de array vazio é seguro

---

| Option | Description | Selected |
|--------|-------------|----------|
| Sim — ambos os Brains recebem MCP tools | brain-sdr e brain-echo incluem ctx.mcpTools | ✓ |
| Apenas brain-sdr por enquanto | brain-echo é apenas Echo Brain para testes | |

**User's choice:** Sim — ambos os Brains recebem MCP tools
**Notes:** Estabelece o padrão para futuros Brains

---

## SIGTERM — onde chamar runner.close()

| Option | Description | Selected |
|--------|-------------|----------|
| No index.ts de cada Brain | brain-sdr e brain-echo registram SIGTERM explicitamente | |
| BrainRunner.init() auto-registra o handler | SDK cuida do shutdown transparentemente | ✓ |

**User's choice:** BrainRunner.init() auto-registra o handler
**Notes:** Preferência por encapsulamento no SDK; apps não precisam gerenciar lifecycle do MCP client

---

| Option | Description | Selected |
|--------|-------------|----------|
| Não — close() fica só em BrainRunner concreto | IBrainRunnerLike permanece com run() e refresh() | ✓ |
| Sim — IBrainRunnerLike ganha close() | Transporte não precisa de close() | |

**User's choice:** Não — close() fica só em BrainRunner concreto
**Notes:** Transporte não é responsável pelo lifecycle do cliente MCP

---

## MCP_TOOLS vazio / wildcard

| Option | Description | Selected |
|--------|-------------|----------|
| Carregar todas as tools do servidor MCP | MCP_URL + MCP_TOOLS ausente/vazio → todas as tools | ✓ |
| Carregar nenhuma tool — MCP_TOOLS é obrigatório | Opt-in explícito requerido | |

**User's choice:** Carregar todas as tools do servidor MCP
**Notes:** Comportamento pragmático — se definiu MCP_URL, quer as tools

---

| Option | Description | Selected |
|--------|-------------|----------|
| Não — ausente/vazio já significa 'todas' | Sem wildcard '*' extra | ✓ |
| Sim — suportar '*' como wildcard | Redundante com ausente/vazio | |

**User's choice:** Não — ausente/vazio já significa 'todas'
**Notes:** Simples, sem ambiguidade

---

## Safe ToolNode para PITFALL-2

| Option | Description | Selected |
|--------|-------------|----------|
| ToolNode({ handleToolErrors: true }) do LangGraph | Built-in do LangGraph — zero código extra | ✓ |
| Wrapper por tool com timeout | AbortController + try/catch por tool — mais granular mas mais código | |
| ToolNode customizado com catch centralizado | Subclasse do ToolNode — desnecessário dado o built-in | |

**User's choice:** ToolNode({ handleToolErrors: true })
**Notes:** Usa o que o LangGraph já oferece; PITFALL-2 resolvido sem código extra

---

| Option | Description | Selected |
|--------|-------------|----------|
| Adicionar MCP_URL e MCP_TOOLS ao .env.example | Documentar ENVs com exemplos e comentários | ✓ |
| Atualizar .env reais de dev/test | Requer URL de servidor MCP de teste | |

**User's choice:** Adicionar ao .env.example
**Notes:** Inclui também MCP_AUTH_TOKEN

---

| Option | Description | Selected |
|--------|-------------|----------|
| MCP_AUTH_TOKEN | ENV separada, explícita — Authorization: Bearer | ✓ |
| Embutido no MCP_URL | Pode vazar token em logs de URL | |

**User's choice:** MCP_AUTH_TOKEN
**Notes:** Mais seguro e explícito

---

## Claude's Discretion

- Timeout para chamadas MCP: AbortSignal com timeout (ex: 15s) se handleToolErrors: true não for suficiente para timeouts de rede
- Campo `private mcpClient: MultiServerMCPClient | null = null` no BrainRunner
- Package name exato dos adapters MCP do LangGraph (verificar em execução)

## Deferred Ideas

- Múltiplos MCP servers simultâneos — MCP-F01, pós v1.3
- MCP tools globais para todos os Brains — MCP-F02, pós v1.3
- Reload de MCP tools em runtime — MCP-F03, pós v1.3
