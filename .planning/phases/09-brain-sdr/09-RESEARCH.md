# Phase 9: Brain SDR - Research

**Researched:** 2026-06-14
**Domain:** LangGraph ReAct agent com tool calling, sub-agente stateless, TenantPoolManager
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** LLM do Brain principal decide quando acionar qualificação via **tool call** — Brain SDR registra a tool `qualify_lead` e o LLM a chama quando julgar o momento adequado.
- **D-02:** Grafo do Brain SDR segue o **padrão ReAct com 2 nós**: `llm` → (condicional: tool call?) → `tools` → `llm` → `__end__`. Após a tool retornar `{qualificado, motivo, proximo_passo}`, o fluxo volta ao nó `llm` que gera a mensagem final para o lead. Não há nó `response` separado.
- **D-03:** Brain SDR tem **apenas uma tool em v1.1**: `qualify_lead(description: string, session_id: string)`. Outras tools ficam para versões futuras.
- **D-04:** Sub-agente é implementado como **LangGraph StateGraph separado** — compilado sem checkpointer (ou MemorySaver in-memory), **stateless por design**. Não persiste nada no banco — apenas analisa e retorna.
- **D-05:** Sub-agente usa o **mesmo LLM do ENV** (`createLLM()` padrão) — sem ENVs extras, sem LLM separado.
- **D-06:** O histórico é buscado pelo **sub-agente diretamente via PostgresSaver** usando o `session_id` recebido. O sub-agente cria seu próprio PostgresSaver, carrega o checkpoint pelo thread_id (`session_id`), extrai todas as mensagens e separa em mensagens da IA (AIMessage) vs mensagens do lead (HumanMessage) antes de invocar o grafo de análise.
- **D-07:** A tool `qualify_lead` recebe dois parâmetros do LLM: `description` (breve contexto do momento da conversa) e `session_id` (thread_id do lead = lead.uniqueId). A tool executa o sub-agente e retorna `{qualificado: boolean, motivo: string, proximo_passo: string}`.
- **D-08:** `promptKeys = ["system", "qualification"]` — duas chaves obrigatórias no banco.
  - `system`: prompt do Brain principal (como conduzir a conversa de atendimento SDR com o lead)
  - `qualification`: prompt do sub-agente (como analisar o histórico e decidir se o lead é qualificado)
- **D-09:** Prompts inseridos no banco via **seed SQL na própria migration** — INSERT com conteúdo padrão. Cliente substitui via API/update direto no banco se necessário. Zero prompts hardcoded no código.
- **D-10:** TenantPoolManager ativado **no entrypoint do app** (`apps/brain-sdr/src/index.ts`) — zero mudança no SDK (packages/core). Entrypoint cria o TenantPoolManager, obtém o pool via `DATABASE_NAME` ENV e passa o `sql` resultante ao `new BrainRunner({..., sql})`.
- **D-11:** **1 instância = 1 cliente** — `DATABASE_NAME` é fixo por instância Docker via ENV. TenantPoolManager gerencia o pool de conexões mas não roteia entre tenants dinamicamente.
- **D-12:** ENVs necessárias no entrypoint: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` (para TenantPoolManager) — além do `DATABASE_URL` ainda usado pelo PostgresSaver no BrainRunner.

### Claude's Discretion

- Nome exato do arquivo do sub-agente (`qualifier.ts`, `qualification-agent.ts`, etc.)
- Estrutura exata do StateGraph do sub-agente (quantos nós, como o prompt é aplicado)
- Formato do output do BrainSDR (seguir padrão do EchoBrain: `{ id, brainType, promptKeys, tools, buildGraph }`)
- Conteúdo padrão dos prompts `system` e `qualification` no seed SQL (Claude pode escolher conteúdo plausível de SDR)
- Tratamento de `QUALIFIER_TIMEOUT` ou erro no sub-agente (ConfigurationError vs fallback)

### Deferred Ideas (OUT OF SCOPE)

- Tool `transfer_to_human` — transferir atendimento para humano quando necessário (pós v1.1)
- Tool `schedule_followup` — agendar follow-up no CRM (pós v1.1)
- Classificação de qualificação mais granular (SPIN/BANT completo) — pós v1.1
- Roteamento dinâmico de tenant (1 instância → múltiplos bancos) — quando escala demandar
- Sub-agente com persistência/histórico próprio — desnecessário para o caso de uso de qualificação
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SDR-01 | Brain SDR recebe mensagem, recupera contexto do lead e conduz conversa de atendimento inicial seguindo prompt do banco | BrainRunner.run() já implementa upsert, ia_ativada gate, thread_id, invoke(). Brain SDR herda tudo via IBrain + buildGraph() ReAct. |
| SDR-02 | Brain SDR nunca processa lead com `ia_ativada=false` (via LeadService compartilhado) | LeadService.upsertLead() + gate `if (!lead.iaAtivada) return null` já implementado em runner.ts. Brain SDR herda automaticamente — sem código extra. |
| SDR-03 | Todas as interações do Brain SDR são registradas no banco | PostgresSaver checkpointer (criado em `_compileGraph()`) persiste todas as mensagens automaticamente. Brain SDR herda via BrainRunner. |
| SDR-04 | Prompts do Brain SDR armazenados no banco, zero hardcode, atualizáveis sem deploy | `loadPrompts(sql, "sdr", ["system", "qualification"])` chamado em `runner.init()`. Migration SQL insere prompts padrão. ctx.prompts["system"] e ctx.prompts["qualification"] usados nos nós — zero hardcode. |
| SDR-05 | Sub-agente de qualificação acionado via tool call, busca histórico via session_id, retorna {qualificado, motivo, proximo_passo} | ToolNode + toolsCondition (prebuilt LangGraph). tool() helper de @langchain/core. PostgresSaver.getTuple() para buscar checkpoint. Separação AIMessage vs HumanMessage por _getType(). |
| INFRA-01 | TenantPoolManager ativado em produção no Brain SDR — seleção de banco via `DATABASE_NAME` ENV | TenantPoolManager.getPool(DATABASE_NAME) no entrypoint. Objeto Sql passado ao BrainRunner. DATABASE_URL ainda necessário para PostgresSaver interno. |
</phase_requirements>

---

## Summary

Phase 9 entrega o primeiro Brain real (`apps/brain-sdr/`) sobre a infraestrutura completa das fases 5-8. O ponto central desta fase é a implementação do padrão ReAct com tool calling no Brain SDR, e o sub-agente de qualificação que usa PostgresSaver para buscar o histórico existente.

A grande maioria do comportamento de negócio (ia_ativada gate, thread_id derivado de lead.uniqueId, histórico via PostgresSaver, prompts do banco, LeadService, transports) já está implementada no BrainRunner e é herdada automaticamente pelo Brain SDR simplesmente implementando a interface IBrain. O Brain SDR adiciona: (1) grafo ReAct com ToolNode, (2) tool `qualify_lead` que aciona sub-agente, (3) sub-agente stateless que lê checkpoint e classifica o lead, (4) migration com seed dos prompts SDR, (5) ativação do TenantPoolManager no entrypoint.

A fase é implementação de produto, não de infraestrutura. O risco principal é garantir que o fluxo `qualify_lead` → `PostgresSaver.getTuple()` → extração de mensagens → sub-agente → retorno funcione corretamente com o formato real do checkpoint.

**Primary recommendation:** Copiar brain-echo como template, adicionar ToolNode + toolsCondition do `@langchain/langgraph/prebuilt` para o ReAct, usar `tool()` de `@langchain/core/tools` com zod para `qualify_lead`, e usar `PostgresSaver.getTuple()` para leitura do checkpoint no sub-agente.

---

## Standard Stack

### Core (já instalado no monorepo)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/langgraph` | 1.4.1 | StateGraph, ToolNode, toolsCondition | Já instalado; ToolNode disponível em `/prebuilt` |
| `@langchain/core` | 1.1.48 | `tool()` helper, StructuredTool, AIMessage, HumanMessage | Já instalado; `tool()` aceita Zod schema |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.3 | PostgresSaver.getTuple() para ler checkpoint no sub-agente | Já instalado; getTuple() disponível |
| `zod` | 3.x | Schema da tool `qualify_lead` | Já usado pelo ecossistema LangChain |
| `postgres` | 3.x | Driver para TenantPoolManager | Já instalado; padrão do projeto |

[VERIFIED: node_modules/.bun inspection]

### Importações Chave

```typescript
// ReAct prebuilt
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";

// Tool definition
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Mensagens
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

// Sub-agente
import { StateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Packages internos
import { createLLM, createCheckpointer, BrainStateAnnotation } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";
```

[VERIFIED: dist/prebuilt/tool_node.d.ts, dist/prebuilt/index.d.ts, pacote @langchain/core tools]

---

## Architecture Patterns

### Estrutura de Arquivos

```
apps/brain-sdr/
├── src/
│   ├── __tests__/
│   │   ├── unit/
│   │   │   └── brain.test.ts          # IBrain contract + ToolNode + grafo ReAct
│   │   └── integration/
│   │       └── qualify.test.ts         # E2E: tool call → sub-agente → {qualificado, motivo, proximo_passo}
│   ├── brain.ts                        # BrainSDR: IBrain implementando ReAct + qualify_lead
│   ├── qualifier.ts                    # Sub-agente: StateGraph stateless + PostgresSaver.getTuple()
│   ├── index.ts                        # Entrypoint: TenantPoolManager + BrainRunner
│   └── server.ts                       # Hono server (copiar de brain-echo)
├── package.json
├── tsconfig.json
└── Dockerfile

packages/database/src/migrations/
└── 0005_brain_sdr_prompts.sql          # Migration com seed dos prompts SDR
```

### Pattern 1: ReAct Graph com ToolNode

O Brain SDR usa `ToolNode` (prebuilt LangGraph) em vez de node customizado. O `toolsCondition` substitui a função `shouldContinue` manual.

```typescript
// Source: dist/prebuilt/tool_node.d.ts (verificado no node_modules)
import { StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { BrainStateAnnotation } from "@brain-pkg/ai";
import type { BrainBuildContext } from "@brain-pkg/core";

export const sdrBrain: IBrain = {
  id: "brain-sdr",
  brainType: "sdr",
  promptKeys: ["system", "qualification"],
  tools: [qualifyLeadTool],   // instância criada em qualifier.ts
  buildGraph(ctx: BrainBuildContext) {
    // ctx.llm.bindTools() ativa tool calling no LLM
    const llmWithTools = ctx.llm.bindTools(ctx.tools);

    const contextWindowSize = () => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40;
    };

    return new StateGraph(BrainStateAnnotation)
      .addNode("llm", async (state) => {
        const messagesForLLM = state.messages.slice(-contextWindowSize());
        const response = await llmWithTools.invoke([
          { role: "system", content: ctx.prompts["system"] },
          ...messagesForLLM,
        ]);
        return { messages: [...state.messages, response] };
      })
      .addNode("tools", new ToolNode(ctx.tools))
      .addEdge("__start__", "llm")
      .addConditionalEdges("llm", toolsCondition, ["tools", "__end__"])
      .addEdge("tools", "llm");
    // NUNCA chamar .compile() aqui — BrainRunner é responsável (anti-pattern documentado)
  },
};
```

[VERIFIED: ToolNode e toolsCondition disponíveis em @langchain/langgraph/prebuilt — dist/prebuilt/tool_node.d.ts]

### Pattern 2: Tool `qualify_lead` com Zod Schema

```typescript
// Source: @langchain/core/tools — tool() helper verificado no dist
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const qualifyLeadTool = tool(
  async ({ description, session_id }) => {
    // Aciona o sub-agente — retorna string JSON para o LLM interpretar
    const result = await runQualificationAgent(description, session_id);
    return JSON.stringify(result);
    // Formato: '{"qualificado":true,"motivo":"...","proximo_passo":"..."}'
  },
  {
    name: "qualify_lead",
    description: "Aciona o sub-agente de qualificação do lead. Use quando o lead demonstrou interesse suficiente para avaliar fit. Recebe: description (breve contexto da conversa) e session_id (ID da sessão do lead).",
    schema: z.object({
      description: z.string().describe("Breve descrição do momento da conversa e comportamento do lead"),
      session_id: z.string().describe("ID da sessão do lead (thread_id) para buscar histórico completo"),
    }),
  }
);
```

[VERIFIED: tool() aceita ZodObjectV3 retornando DynamicStructuredTool — dist/tools/index.d.ts]

### Pattern 3: Sub-agente lendo checkpoint via PostgresSaver.getTuple()

O sub-agente usa `PostgresSaver.getTuple()` para ler o checkpoint do lead sem afetar o estado:

```typescript
// Source: @langchain/langgraph-checkpoint-postgres dist/index.d.ts (verificado)
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

export async function runQualificationAgent(
  description: string,
  sessionId: string
): Promise<{ qualificado: boolean; motivo: string; proximo_passo: string }> {
  // 1. Criar PostgresSaver e buscar checkpoint
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  // NÃO chamar setup() aqui — tabelas já existem; setup() é idempotente mas tem overhead
  const tuple = await checkpointer.getTuple({
    configurable: { thread_id: sessionId },
  });

  // 2. Extrair mensagens do checkpoint
  const allMessages: BaseMessage[] =
    (tuple?.checkpoint?.channel_values?.messages as BaseMessage[]) ?? [];

  // 3. Separar IA vs lead por _getType() — padrão estabelecido no runner.ts
  const aiMessages = allMessages.filter((m) => m._getType() === "ai");
  const humanMessages = allMessages.filter((m) => m._getType() === "human");

  // 4. Invocar sub-agente StateGraph stateless
  const llm = await createLLM();
  const qualificationPrompt = /* carregado via parâmetro ou ENV */;

  const subGraph = buildQualificationGraph(llm, qualificationPrompt);
  const compiled = subGraph.compile(); // sem checkpointer — stateless por design (D-04)

  const result = await compiled.invoke({
    description,
    aiMessages,
    humanMessages,
  });

  return {
    qualificado: result.qualificado,
    motivo: result.motivo,
    proximo_passo: result.proximo_passo,
  };
}
```

[VERIFIED: getTuple(config) → Promise<CheckpointTuple | undefined>. checkpoint.channel_values.messages confirmed via Checkpoint interface in @langchain/langgraph-checkpoint dist/base.d.ts]

### Pattern 4: Sub-agente StateGraph Próprio

O sub-agente tem seu próprio StateAnnotation (não BrainStateAnnotation) pois precisa de campos específicos:

```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";

const QualificationAnnotation = Annotation.Root({
  description: Annotation<string>({ default: () => "", reducer: (_, next) => next }),
  aiMessages: Annotation<BaseMessage[]>({ default: () => [], reducer: (_, next) => next }),
  humanMessages: Annotation<BaseMessage[]>({ default: () => [], reducer: (_, next) => next }),
  qualificado: Annotation<boolean | null>({ default: () => null, reducer: (_, next) => next }),
  motivo: Annotation<string>({ default: () => "", reducer: (_, next) => next }),
  proximo_passo: Annotation<string>({ default: () => "", reducer: (_, next) => next }),
});

// Sub-grafo tem um único nó de análise
function buildQualificationGraph(llm: BaseChatModel, prompt: string) {
  return new StateGraph(QualificationAnnotation)
    .addNode("analyze", async (state) => {
      const historyText = buildHistoryText(state.aiMessages, state.humanMessages);
      const response = await llm.invoke([
        { role: "system", content: prompt },
        { role: "human", content: `Descrição: ${state.description}\n\nHistórico:\n${historyText}\n\nResponda em JSON: {"qualificado": bool, "motivo": "...", "proximo_passo": "..."}` },
      ]);
      // Parse JSON da resposta
      const content = typeof response.content === "string" ? response.content : "";
      const parsed = JSON.parse(extractJSON(content));
      return { qualificado: parsed.qualificado, motivo: parsed.motivo, proximo_passo: parsed.proximo_passo };
    })
    .addEdge("__start__", "analyze")
    .addEdge("analyze", "__end__");
}
```

[VERIFIED: pattern derivado do subgraph.test.ts existente em packages/ai/src/graph/subgraph.test.ts e StateGraph API confirmada via node_modules]

### Pattern 5: TenantPoolManager no Entrypoint (D-10)

```typescript
// apps/brain-sdr/src/index.ts
import { TenantPoolManager } from "@brain-pkg/database";
import { BrainRunner, ToolsRegistry } from "@brain-pkg/core";

async function main() {
  // Validar ENVs obrigatórias do TenantPoolManager (D-12)
  const { DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME } = process.env;
  if (!DATABASE_HOST || !DATABASE_PORT || !DATABASE_USER || !DATABASE_PASSWORD || !DATABASE_NAME) {
    logger.error({}, "Missing required DATABASE_* env vars for TenantPoolManager");
    process.exit(1);
  }

  // Criar pool para o tenant via DATABASE_NAME (D-11: 1 instância = 1 cliente)
  const tenantPoolManager = new TenantPoolManager({
    host: DATABASE_HOST,
    port: parseInt(DATABASE_PORT, 10),
    username: DATABASE_USER,
    password: DATABASE_PASSWORD,
    max: 10,
    idle_timeout: 300,
  });
  const sql = tenantPoolManager.getPool(DATABASE_NAME);

  // DATABASE_URL ainda necessário para PostgresSaver interno do BrainRunner
  if (!process.env.DATABASE_URL) {
    logger.error({}, "DATABASE_URL not set — required for PostgresSaver");
    process.exit(1);
  }

  const toolsRegistry = new ToolsRegistry();
  toolsRegistry.enableTool("sdr", "qualify_lead");
  const runner = new BrainRunner({ brain: sdrBrain, sql, toolsRegistry });
  await runner.init();

  const app = createServer(sql, runner);
  Bun.serve({ port: parseInt(process.env.PORT || "3000", 10), fetch: app.fetch });
}
```

[VERIFIED: TenantPoolManager.getPool(databaseName) retorna Sql — packages/database/src/pool-manager.ts lido diretamente]

### Pattern 6: Migration com Seed SQL (D-09)

A próxima migration é `0005_brain_sdr_prompts.sql` (idx 5, após idx 4 = leads table):

```sql
-- Seed: prompts do Brain SDR
-- ON CONFLICT DO NOTHING garante idempotência

INSERT INTO prompts (brain_type, key, content)
VALUES (
  'sdr',
  'system',
  'Você é um assistente de vendas especializado em qualificação de leads...'
)
ON CONFLICT (brain_type, key) DO NOTHING;

INSERT INTO prompts (brain_type, key, content)
VALUES (
  'sdr',
  'qualification',
  'Você é um especialista em análise de leads para qualificação comercial...'
)
ON CONFLICT (brain_type, key) DO NOTHING;
```

[VERIFIED: padrão idêntico ao 0002_echo_brain_seed.sql — lido diretamente]

### Anti-Patterns a Evitar

- **NUNCA chamar `.compile()` dentro de `buildGraph()`** — BrainRunner é o responsável. Anti-pattern documentado em runner.ts e interface.ts.
- **NUNCA usar `ctx.llm.invoke()` diretamente no nó llm do Brain SDR** — usar `ctx.llm.bindTools(ctx.tools).invoke()`. Sem `bindTools()`, o LLM não inclui tool schemas no request e nunca gera tool_calls.
- **NUNCA re-injetar historicalMessages no invoke()** — provoca duplicação de mensagens. Pitfall documentado em runner.ts linha 174. O slice é feito no nó, não no invoke().
- **NUNCA usar `instanceof AIMessage`** — usar `m._getType() === "ai"`. Cross-module identity issue documentado em runner.ts linha 223.
- **NUNCA chamar `checkpointer.setup()` no sub-agente** — tabelas já existem; cada chamada faz DDL contra o banco. Usar `PostgresSaver.fromConnString()` diretamente.
- **NUNCA usar MemorySaver em produção** — violaria AI-01 constraint documentada em checkpointer.ts. Sub-agente stateless: compilar `.compile()` sem argumento (sem checkpointer).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Routing condicional tool call / fim | Função `shouldContinue` manual | `toolsCondition` de `@langchain/langgraph/prebuilt` | Já verifica `tool_calls` no último AIMessage; handles edge cases de arrays vazios |
| Executar tools do LLM | Node customizado que itera tool_calls | `ToolNode` de `@langchain/langgraph/prebuilt` | Executa em paralelo, trata erros, retorna ToolMessages com tool_call_id correto |
| Definir tool com schema | Classe extendendo `StructuredTool` | `tool()` de `@langchain/core/tools` | Menos boilerplate; aceita Zod schema diretamente; retorna DynamicStructuredTool |
| Ler histórico para sub-agente | Queries SQL diretas na tabela checkpoint | `PostgresSaver.getTuple()` | API pública da biblioteca; isola da estrutura interna das tabelas checkpoint |
| Separar mensagens IA vs lead | Checar `instanceof AIMessage` | `m._getType() === "ai"` | Evita cross-module identity bug documentado em runner.ts |

---

## Common Pitfalls

### Pitfall 1: LLM nunca gera tool_calls — bindTools() esquecido

**What goes wrong:** O Brain SDR funciona como o EchoBrain, sem nunca acionar a ferramenta de qualificação.
**Why it happens:** `ctx.llm.invoke()` (sem bindTools) não inclui tool schemas no request ao provider. O LLM não sabe que as tools existem.
**How to avoid:** No nó `llm`, usar `const llmWithTools = ctx.llm.bindTools(ctx.tools)` e invocar `llmWithTools.invoke(...)`. Fazer isso no início de `buildGraph()` e reutilizar no closure do nó.
**Warning signs:** Nenhuma mensagem com `tool_calls` aparece no log; grafo sempre termina no primeiro passo.

### Pitfall 2: `ctx.tools` vazio quando ToolsRegistry não registra `qualify_lead`

**What goes wrong:** `BrainRunner._compileGraph()` chama `toolsRegistry.getTools("sdr", brain.tools)` — se `qualify_lead` não estiver na whitelist do brainType "sdr", `ctx.tools = []`. `bindTools([])` não ajuda.
**Why it happens:** ToolsRegistry lança `ConfigurationError` se brainType não estiver registrado. Se brainType está registrado mas a tool não está na whitelist, retorna array vazio silenciosamente.
**How to avoid:** No entrypoint, chamar `toolsRegistry.enableTool("sdr", "qualify_lead")` explicitamente antes de `new BrainRunner(...)`.
**Warning signs:** ConfigurationError no init, ou llmWithTools sem tools no debug.

### Pitfall 3: Duplicação de mensagens — historicalMessages injetadas no invoke()

**What goes wrong:** Mensagens aparecem duplicadas no histórico, corrompendo o contexto da conversa.
**Why it happens:** BrainRunner já injeta `messages: [{ role: "human", content: event.Message }]` no invoke(). Se o nó do grafo também reinjeta histórico, o PostgresSaver soma as duas listas.
**How to avoid:** O slice do histórico é feito no nó (`state.messages.slice(-N)`), nunca no invoke(). Padrão documentado em runner.ts (linha 174) e brain-echo/brain.ts.
**Warning signs:** Teste HIST-01/02 falha com mensagens repetidas; contagem de mensagens cresce mais rápido que o esperado.

### Pitfall 4: setup() chamado toda vez que sub-agente executa

**What goes wrong:** Cada invocação da tool `qualify_lead` executa DDL (CREATE TABLE IF NOT EXISTS) contra o banco, adicionando latência e warnings.
**Why it happens:** Copiar o padrão de `createCheckpointer()` do packages/ai — que chama setup() — para dentro da tool function executada por request.
**How to avoid:** No sub-agente, usar `PostgresSaver.fromConnString(DATABASE_URL)` diretamente (sem setup()). As tabelas foram criadas pelo checkpointer principal no BrainRunner.init().
**Warning signs:** Logs de DDL por request; latência da tool anormalmente alta (>200ms) mesmo com histórico pequeno.

### Pitfall 5: JSON parsing da resposta do sub-agente falha

**What goes wrong:** Sub-agente retorna `{qualificado: null, motivo: "", proximo_passo: ""}` por erro silencioso de parse.
**Why it happens:** LLMs às vezes envolvem o JSON em markdown (```json ... ```) ou adicionam texto antes. JSON.parse() falha silenciosamente se não tratado.
**How to avoid:** Implementar `extractJSON(text)` que usa regex para encontrar o primeiro `{...}` no conteúdo. Ou usar `structured_output` do LLM se disponível no provider. Logar o conteúdo raw antes do parse em dev.
**Warning signs:** Resultado sempre `qualificado: false` com motivo vazio; ou `JSON.parse` exception não capturada.

### Pitfall 6: promptKey "qualification" ausente causa process.exit(1) no init

**What goes wrong:** BrainRunner.init() chama process.exit(1) se qualquer promptKey não existir no banco.
**Why it happens:** A migration que insere os prompts SDR não rodou (banco vazio, ou migration falhou), ou brainType errado na seed.
**How to avoid:** Garantir que a migration `0005_brain_sdr_prompts.sql` usa `brain_type = 'sdr'` (não `'brain-sdr'`) — deve bater com `brainType: "sdr"` do IBrain.
**Warning signs:** Erro `Missing prompt key` nos logs no startup; process.exit(1) imediato após migrations.

### Pitfall 7: `toolsCondition` não encontrado se importado do path errado

**What goes wrong:** `import { toolsCondition } from "@langchain/langgraph"` → symbol não encontrado.
**Why it happens:** `toolsCondition` está no subpath `/prebuilt`, não no barrel principal.
**How to avoid:** Sempre importar de `@langchain/langgraph/prebuilt`.
**Warning signs:** TypeScript error `Module has no exported member 'toolsCondition'`.

---

## Code Examples

### Exemplo Completo: buildGraph() com ToolNode

```typescript
// Source: padrão verificado em dist/prebuilt/tool_node.d.ts + brain-echo/brain.ts
import { StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { BrainStateAnnotation } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";
import { qualifyLeadTool } from "./qualifier.js";

export const sdrBrain: IBrain = {
  id: "brain-sdr",
  brainType: "sdr",
  promptKeys: ["system", "qualification"],
  tools: [qualifyLeadTool],
  buildGraph(ctx: BrainBuildContext): any {
    // CRITICAL: bindTools() aqui — sem isso, LLM não gera tool_calls
    const llmWithTools = ctx.llm.bindTools(ctx.tools);

    const getContextWindow = () => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40;
    };

    return new StateGraph(BrainStateAnnotation)
      .addNode("llm", async (state) => {
        const messagesForLLM = state.messages.slice(-getContextWindow());
        const response = await llmWithTools.invoke([
          { role: "system", content: ctx.prompts["system"] },
          ...messagesForLLM,
        ]);
        return { messages: [...state.messages, response] };
      })
      .addNode("tools", new ToolNode(ctx.tools))
      .addEdge("__start__", "llm")
      .addConditionalEdges("llm", toolsCondition, ["tools", "__end__"])
      .addEdge("tools", "llm");
    // NUNCA .compile() aqui
  },
};
```

### Exemplo Completo: PostgresSaver.getTuple() para ler checkpoint

```typescript
// Source: @langchain/langgraph-checkpoint-postgres dist/index.d.ts (verificado)
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { BaseMessage } from "@langchain/core/messages";

async function getHistoryFromCheckpoint(sessionId: string) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  // fromConnString sem setup() — tabelas já existem
  const saver = PostgresSaver.fromConnString(dbUrl);
  const tuple = await saver.getTuple({
    configurable: { thread_id: sessionId },
  });

  // tuple pode ser undefined se a sessão não tem checkpoint ainda
  const messages: BaseMessage[] =
    (tuple?.checkpoint?.channel_values?.messages as BaseMessage[]) ?? [];

  // _getType() em vez de instanceof — evita cross-module identity bug
  const aiMessages = messages.filter((m) => m._getType() === "ai");
  const humanMessages = messages.filter((m) => m._getType() === "human");

  return { aiMessages, humanMessages };
}
```

### Exemplo: ToolsRegistry no entrypoint do brain-sdr

```typescript
// apps/brain-sdr/src/index.ts
const toolsRegistry = new ToolsRegistry();
// Registrar o brainType E habilitar a tool — ambas as chamadas necessárias
toolsRegistry.enableTool("sdr", "qualify_lead");
// enableTool() cria o brainType se não existir — registerBrainType() é opcional aqui
```

---

## Estado da Arte

| Abordagem Antiga | Abordagem Atual | Quando Mudou | Impacto |
|-----------------|-----------------|--------------|---------|
| Implementar shouldContinue manual | `toolsCondition` do prebuilt | LangGraph 1.x | Menos código; handles edge cases |
| Criar classe extendendo StructuredTool | `tool()` helper de @langchain/core | @langchain/core 0.2+ | Zod direto; menos boilerplate |
| `instanceof AIMessage` | `m._getType() === "ai"` | Sempre foi recomendado | Evita cross-module identity bugs em monorepos pnpm |
| Subgraph como node no parent graph | Tool function assíncrona | Depende do caso | Sub-agente stateless via tool é mais simples que subgraph quando não precisa de estado compartilhado |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | TenantPoolManager, PostgresSaver, migrations | Deve estar disponível (infra fases 1-8) | 16.x | Nenhum — bloqueante |
| `@langchain/langgraph` | Brain SDR, sub-agente | ✓ | 1.4.1 | — |
| `@langchain/core` | tool(), messages | ✓ | 1.1.48 | — |
| `@langchain/langgraph-checkpoint-postgres` | PostgresSaver.getTuple() | ✓ | 1.0.3 | — |
| `zod` | Schema da tool qualify_lead | ✓ | 3.25.76 | — |
| `postgres` | TenantPoolManager | ✓ | 3.x | — |
| LLM Provider (API_KEY) | createLLM() | Depende de ENV | — | ConfigurationError no init |

[VERIFIED: todos os pacotes encontrados em node_modules/.bun/]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, versão Bun 1.x) |
| Config file | Nenhum — padrão Bun descobre `__tests__/` |
| Quick run command | `bun test src/__tests__/unit` |
| Full suite command | `bun test src/__tests__` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SDR-01 | sdrBrain.id, brainType, promptKeys, buildGraph() retorna StateGraph com ToolNode | unit | `bun test src/__tests__/unit/brain.test.ts` | ❌ Wave 0 |
| SDR-01 | ToolNode presente no grafo; toolsCondition como conditional edge | unit | `bun test src/__tests__/unit/brain.test.ts` | ❌ Wave 0 |
| SDR-02 | ia_ativada=false → null (herdado de BrainRunner — não testar aqui, já coberto) | — | herdado | ✓ (runner) |
| SDR-03 | Histórico persistido via PostgresSaver (herdado de BrainRunner — já testado em Phase 8) | — | herdado | ✓ (HIST-01/02) |
| SDR-04 | promptKeys = ["system", "qualification"]; ctx.prompts usado nos nós | unit | `bun test src/__tests__/unit/brain.test.ts` | ❌ Wave 0 |
| SDR-05 | qualify_lead tool: schema zod com description+session_id; retorna {qualificado, motivo, proximo_passo} | unit | `bun test src/__tests__/unit/brain.test.ts` | ❌ Wave 0 |
| SDR-05 | PostgresSaver.getTuple() → extração de mensagens → sub-agente → resultado correto | integration | `bun test src/__tests__/integration` (requer DB real) | ❌ Wave 0 |
| INFRA-01 | TenantPoolManager.getPool(DATABASE_NAME) → Sql passado ao BrainRunner | unit | `bun test src/__tests__/unit/brain.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Por task commit:** `bun test src/__tests__/unit`
- **Por wave merge:** `bun test src/__tests__`
- **Phase gate:** Full suite green antes do `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — cobre SDR-01, SDR-04, SDR-05 (tool schema), INFRA-01
- [ ] `apps/brain-sdr/src/__tests__/integration/qualify.test.ts` — cobre SDR-05 end-to-end (requer PostgreSQL + LLM real)
- [ ] `apps/brain-sdr/package.json` — scripts `test` e `test:integration`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `PostgresSaver.getTuple()` retorna `checkpoint.channel_values.messages` como `BaseMessage[]` | Pattern 3, Code Examples | Sub-agente não consegue extrair histórico; precisaria de abordagem alternativa (ex: `list()`) |
| A2 | `tool()` retorna objeto compatível com `StructuredTool[]` esperado por `IBrain.tools` | Pattern 2 | TypeScript error; precisaria usar `DynamicStructuredTool` diretamente ou cast |
| A3 | Compilar sub-agente sem checkpointer (`.compile()` sem args) é válido no LangGraph 1.4.1 | Pattern 4 | Precisaria usar `MemorySaver` — mas AI-01 proíbe em produção; sub-agente precisaria de alternativa |

> A1: Confidence HIGH — `Checkpoint.channel_values: Record<string, unknown>` confirmado + BrainStateAnnotation usa `messages` como channel key; já usado em runner.ts via `snapshot.values.messages`. `getTuple()` é a leitura direta do checkpoint.

> A2: Confidence HIGH — `tool()` com ZodObjectV3 retorna `DynamicStructuredTool` que estende `StructuredToolInterface`. ToolsRegistry usa `StructuredTool[]` mas o type check é structurally compatible.

> A3: Confidence MEDIUM — LangGraph StateGraph.compile() aceita `undefined` como checkpointer em todos os exemplos da documentação oficial. Sub-agente stateless é um padrão documentado.

---

## Open Questions

1. **Conteúdo dos prompts SDR padrão no seed**
   - What we know: Claude's Discretion (CONTEXT.md)
   - What's unclear: Nível de detalhe esperado (genérico vs específico para o produto do cliente)
   - Recommendation: Usar prompts genéricos mas plausíveis de SDR B2B; cliente substitui via update no banco sem deploy

2. **Tratamento de erro no sub-agente (timeout, parse JSON falha, DB indisponível)**
   - What we know: Claude's Discretion — escolher entre ConfigurationError vs fallback
   - What's unclear: Se falha silenciosa com `{qualificado: false, motivo: "erro interno", proximo_passo: "..."}` é preferível ao throw
   - Recommendation: Retornar fallback `{qualificado: false, motivo: "Não foi possível analisar no momento", proximo_passo: "Continue a conversa normalmente"}` em vez de throw — evita que uma falha do sub-agente derrube a conversa principal

3. **Estrutura exata do nó "analyze" do sub-agente — forçar structured output ou parse JSON manual**
   - What we know: LLMs às vezes envolvem JSON em markdown
   - What's unclear: Se o LLM configurado suporta `.withStructuredOutput()` (OpenAI, Anthropic: sim; outros: variável)
   - Recommendation: Parse JSON manual com regex `extractJSON()` é mais portável entre providers; `.withStructuredOutput()` pode ser uma melhoria futura

---

## Project Constraints (from CLAUDE.md)

- **Runtime**: Bun — todos os scripts e testes devem rodar com Bun
- **Framework HTTP**: Hono — server.ts usa Hono (copiar de brain-echo)
- **ORM**: Drizzle — não usar bun:sql como driver; usar postgres.js
- **AI**: LangGraph/LangChain — padrão do projeto; sem alternativas
- **DB**: PostgreSQL + PGVector — já existente
- **Testes**: `bun test` — em `__tests__/unit/` e `__tests__/integration/` APENAS; sufixo `.test.ts`
- **Arquivos de teste manual**: `manual/` na raiz do repo; NUNCA na raiz de packages ou apps
- **Documentação**: em `docs/` — não criar .md na raiz
- **Commits**: Conventional Commits com emojis (ex: `✨ feat(brain-sdr): implement ReAct graph`)
- **Anti-pattern crítico**: NUNCA chamar `.compile()` dentro de `buildGraph()` — documentado no IBrain interface

---

## Sources

### Primary (HIGH confidence)
- `packages/core/src/runner/runner.ts` — padrões de thread_id, ia_ativada gate, invoke(), context window, _getType()
- `packages/core/src/brain/interface.ts` — IBrain contract verificado
- `packages/core/src/tools/registry.ts` — ToolsRegistry.enableTool() verificado
- `packages/database/src/pool-manager.ts` — TenantPoolManager.getPool() verificado
- `packages/ai/src/graph/checkpointer.ts` — createCheckpointer(), PostgresSaver.fromConnString()
- `packages/ai/src/graph/state.ts` — BrainStateAnnotation, channel_values structure
- `packages/ai/src/graph/subgraph.test.ts` — padrão StateGraph separado verificado
- `apps/brain-echo/src/brain.ts` — template ReAct base verificado
- `apps/brain-echo/src/index.ts` — padrão entrypoint verificado
- `apps/brain-echo/Dockerfile` — padrão Docker para brain-sdr
- `node_modules/.bun/@langchain+langgraph@1.4.1.../dist/prebuilt/tool_node.d.ts` — ToolNode, toolsCondition API
- `node_modules/.bun/@langchain+core@1.1.48.../dist/tools/index.d.ts` — tool() helper API
- `node_modules/.bun/@langchain+langgraph-checkpoint-postgres@1.0.3.../dist/index.d.ts` — getTuple() API
- `node_modules/.bun/@langchain+langgraph-checkpoint@1.1.0.../dist/base.d.ts` — CheckpointTuple, Checkpoint.channel_values

### Secondary (MEDIUM confidence)
- `packages/database/src/migrations/0002_echo_brain_seed.sql` — padrão de seed SQL com ON CONFLICT
- `packages/database/src/migrations/0004_even_rick_jones.sql` — migration leads table; próxima será 0005

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — todas as versões verificadas em node_modules
- Architecture: HIGH — padrões extraídos diretamente do código existente (brain-echo, runner, checkpointer)
- Pitfalls: HIGH — identificados a partir de comentários existentes no código (runner.ts, interface.ts, checkpointer.ts)
- Sub-agente checkpoint read: MEDIUM (A1) — API verificada mas comportamento de `channel_values.messages` baseado em inferência da estrutura

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (stack estável; dependências pinadas)
