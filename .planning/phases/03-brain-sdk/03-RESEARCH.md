# Phase 3: Brain SDK - Research

**Researched:** 2026-06-12
**Domain:** SDK de agentes — IBrain contract, BrainRunner, BrainRegistry, ToolsRegistry, prompts table
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### IBrain Interface (SDK-01)
- **D-01:** `buildGraph(ctx: BrainBuildContext)` recebe dependências injetadas pelo BrainRunner — `{ llm: BaseChatModel, prompts: Record<string, string>, tools: StructuredTool[] }`. Brain foca exclusivamente em montar nós e arestas do grafo.
- **D-02:** `buildGraph()` retorna `StateGraph` **não compilado**. BrainRunner chama `.compile({ checkpointer })` com o `PostgresSaver` correto. Runner controla a política de checkpointing.
- **D-03:** `tools[]` em `IBrain` são instâncias `StructuredTool` (LangChain) já construídas — não strings. `ToolsRegistry` filtra quais são permitidas por `brainType` antes de injetar no `BrainBuildContext`.
- **D-04:** Estado base fixo no v1 — todos os Brains usam `BrainStateAnnotation` sem extensão de campos customizados.

#### BrainRunner (SDK-02)
- **D-05:** `BrainRunner.run(event: BrainEvent)` retorna `{ reply: string }` — apenas o texto da última mensagem do LLM.
- **D-06:** `BrainRunner` tem lifecycle explícito de 2 etapas: (1) `new BrainRunner(...)` síncrono, (2) `await runner.init()` que carrega prompts do banco e falha com exit 1 se qualquer `promptKey` não existir.
- **D-07:** Endpoint `POST /reload-prompts` força reload dos prompts sem restart. `BrainRunner` expõe `refreshPrompts()`.

#### prompts Table Schema (SDK-04)
- **D-08:** Chave scoped por `(brain_type, key)` — UNIQUE constraint em `(brain_type, key)`.
- **D-09:** Sem coluna de version no v1.
- **D-10:** Sem coluna de locale no v1.
- **D-11:** Schema: `id (uuid PK)`, `brain_type (text NOT NULL)`, `key (text NOT NULL)`, `content (text NOT NULL)`, `created_at`, `updated_at`. UNIQUE(brain_type, key).

#### ToolsRegistry (SDK-03)
- **D-12:** `ToolsRegistry` keyed por `brainType` → lista de `StructuredTool` permitidas. Filtering acontece no `buildGraph(ctx)` — Runner filtra `brain.tools[]` via Registry antes de passar no ctx.

### Claude's Discretion
- Mecanismo de autenticação do endpoint `/reload-prompts` — simples para v1 (ex: header `X-Admin-Token` via env var).
- Estrutura interna do `BrainRegistry` — como mapeia `brainId` → `IBrain` instance.
- Como `ToolsRegistry` é inicializado — na construção do `BrainRunner` ou singleton global no `packages/core`.

### Deferred Ideas (OUT OF SCOPE)
- Extensão de estado por Brain (ex: `qualificationResult` para SDR) → v2
- Locale/i18n na tabela `prompts` → v2
- Versionamento de prompts → v2
- Mecanismo de licenciamento (`LICENSE_KEY`) → v2
- RBAC de tools por instância (não só por tipo) → fora de escopo v1
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SDK-01 | Interface `IBrain` com contrato mínimo: `id`, `promptKeys[]`, `tools[]`, `buildGraph()` | Padrão de interface abstrata confirmado em `packages/transport/src/interface.ts` (ITransport). `BrainBuildContext` com `BaseChatModel`, `Record<string,string>`, `StructuredTool[]` mapeado diretamente a APIs LangGraph existentes. |
| SDK-02 | `BrainRunner` — host que gerencia wiring de memory, checkpointer, tools, transport | `MemoryManager`, `createCheckpointer()`, `createLLM()`, `TenantPoolManager`, `createTracingCallbacks()` já exportados e prontos para uso. Wiring ponto-a-ponto confirmado via inspeção do código. |
| SDK-03 | `ToolsRegistry` — registro de tools com enable/disable por tipo de Brain | Pattern: `Map<brainType, Set<toolName>>` + filter sobre `StructuredTool[]`. Sem nova dependência — pura lógica TypeScript. |
| SDK-04 | Todos os prompts armazenados no banco de dados via `promptKeys` — sem prompts hardcoded | Migration pattern confirmado: drizzle-kit generate → `0001_*.sql` em `packages/database/src/migrations/`. `drizzle-orm/postgres-js` com `postgres.js` Sql é o driver correto. |
</phase_requirements>

---

## Summary

A Phase 3 entrega o `packages/core` — a camada de integração que conecta todos os domain packages já implementados (ai, memory, transport, database, observability) em um contrato coeso para Brains. O trabalho é essencialmente de **composição**: todos os blocos de construção já existem como APIs estáveis (createCheckpointer, createLLM, MemoryManager, TenantPoolManager, createTracingCallbacks, BrainEvent). A fase cria as interfaces que os orquestram.

A integração mais crítica é o `BrainRunner.run()`: receber um `BrainEvent`, embutir contexto de memória nas mensagens iniciais, invocar o grafo LangGraph compilado com `PostgresSaver` e callbacks Langfuse, extrair a última `AIMessage` do estado final como `{ reply: string }`, e persistir memória de longo prazo. O padrão exato de como LangGraph retorna o estado final e como extrair a última mensagem foi verificado contra a API `StateGraph.compile().invoke()`.

A nova tabela `prompts` segue o padrão Drizzle já estabelecido: adicionar definição em `tables.ts`, rodar `drizzle-kit generate` para criar o arquivo `0001_*.sql` em `src/migrations/`, e o container aplicará automaticamente na próxima inicialização via `migrate.ts`. Não há nova infraestrutura — o padrão é replicar exatamente o que Phase 1 fez para as outras tabelas.

**Primary recommendation:** Criar `packages/core` como novo workspace package seguindo o padrão de barrel export dos outros packages. Todos os componentes (IBrain, BrainRunner, BrainRegistry, ToolsRegistry) ficam em `packages/core/src/`. A nova migration de `prompts` fica em `packages/database` (não em `packages/core`).

---

## Standard Stack

### Core (já instalado no projeto — sem novas dependências necessárias)

| Library | Versão instalada | Purpose | Origem |
|---------|-----------------|---------|--------|
| `@langchain/langgraph` | ^1.4.1 | `StateGraph`, `.compile()`, `.invoke()` | `packages/ai/package.json` [VERIFIED: npm registry] |
| `@langchain/core` | ^1.1.48 | `BaseChatModel`, `StructuredTool`, `AIMessage` | `packages/ai/package.json` [VERIFIED: npm registry] |
| `@langchain/langgraph-checkpoint-postgres` | ^1.0.3 | `PostgresSaver` — o único checkpointer em produção | `packages/ai/package.json` [VERIFIED: npm registry] |
| `drizzle-orm` | ^0.45.2 | Query da tabela `prompts` | `packages/database/package.json` [VERIFIED: npm registry] |
| `postgres` | ^3.4.9 | Driver para queries Drizzle | `packages/database/package.json` [VERIFIED: npm registry] |
| `hono` | ^4.12.25 | Endpoint `/reload-prompts` | `packages/observability/package.json` [VERIFIED: npm registry] |
| `pino` | ^10.3.1 | Logging estruturado | `packages/observability/package.json` [VERIFIED: npm registry] |

### Novos packages necessários para `packages/core/package.json`

`packages/core` declara como `dependencies` workspace:
```json
{
  "@brain-pkg/ai": "workspace:*",
  "@brain-pkg/memory": "workspace:*",
  "@brain-pkg/database": "workspace:*",
  "@brain-pkg/transport": "workspace:*",
  "@brain-pkg/observability": "workspace:*",
  "@brain-pkg/shared": "workspace:*"
}
```

Sem novas dependências externas — apenas composição dos workspace packages existentes. [VERIFIED: inspeção do código]

### Instalação
```bash
# Criar workspace package (sem npm install adicional)
mkdir -p packages/core/src
# Todas as deps já estão nos workspace packages
```

---

## Architecture Patterns

### Estrutura recomendada para `packages/core`

```
packages/core/
├── package.json                   # @brain-pkg/core, deps = todos os workspace packages
├── tsconfig.json                  # extends ../../tsconfig.base.json
├── src/
│   ├── index.ts                   # barrel export: IBrain, BrainRunner, BrainRegistry, ToolsRegistry
│   ├── brain/
│   │   ├── interface.ts           # IBrain, BrainBuildContext types
│   │   ├── registry.ts            # BrainRegistry — Map<string, IBrain>
│   │   └── registry.test.ts       # unit test: register + resolve
│   ├── runner/
│   │   ├── runner.ts              # BrainRunner class
│   │   └── runner.test.ts         # unit test com MemorySaver (apenas em test)
│   ├── tools/
│   │   ├── registry.ts            # ToolsRegistry — Map<brainType, StructuredTool[]>
│   │   └── registry.test.ts       # unit test: enable/disable por brainType
│   └── prompts/
│       ├── loader.ts              # loadPrompts(db, brainType, keys) → Record<string, string>
│       └── loader.test.ts         # unit test com mock do db
```

### Pattern 1: IBrain Interface e BrainBuildContext

**O que é:** Contrato que qualquer Brain implementa — define identidade, chaves de prompt, tools, e factory de grafo.

**Quando usar:** Toda implementação de Brain (SDR, Suporte, CS) implementa este contrato.

```typescript
// Source: CONTEXT.md D-01, D-02, D-03 [VERIFIED: inspeção do código]
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredTool } from "@langchain/core/tools";
import type { StateGraph } from "@langchain/langgraph";
import type { BrainStateAnnotation } from "@brain-pkg/ai";

export interface BrainBuildContext {
  llm: BaseChatModel;
  prompts: Record<string, string>;   // { [key]: content } do banco
  tools: StructuredTool[];           // filtrado por ToolsRegistry
}

export interface IBrain {
  id: string;
  brainType: string;                 // para lookup no ToolsRegistry e scoping de prompts
  promptKeys: string[];              // chaves a carregar da tabela prompts para este brainType
  tools: StructuredTool[];           // lista completa — Runner filtra via ToolsRegistry
  buildGraph(ctx: BrainBuildContext): StateGraph<typeof BrainStateAnnotation>;
}
```

### Pattern 2: BrainRunner — lifecycle e run()

**O que é:** Host que orquestra o ciclo completo de um turno de conversa.

**Lifecycle crítico (D-06):** Construção síncrona → `init()` async → `run()` por request.

```typescript
// Source: CONTEXT.md D-05, D-06, D-07 + inspeção de checkpointer.ts, tracing.ts [VERIFIED]
import { createCheckpointer, createLLM, BrainStateAnnotation } from "@brain-pkg/ai";
import { MemoryManager } from "@brain-pkg/memory";
import { createTracingCallbacks } from "@brain-pkg/observability";
import { AIMessage } from "@langchain/core/messages";
import type { BrainEvent } from "@brain-pkg/transport";
import type { IBrain } from "./interface.js";
import { ToolsRegistry } from "../tools/registry.js";
import { loadPrompts } from "../prompts/loader.js";

export class BrainRunner {
  private brain: IBrain;
  private memoryManager: MemoryManager;
  private toolsRegistry: ToolsRegistry;
  private prompts: Record<string, string> = {};
  private compiledGraph: ReturnType<ReturnType<IBrain["buildGraph"]>["compile"]> | null = null;
  // ...deps injetadas no constructor

  // D-06: init() carrega prompts; falha com exit 1 se key faltando
  async init(): Promise<void> {
    this.prompts = await loadPrompts(this.db, this.brain.brainType, this.brain.promptKeys);
    // Valida que TODAS as keys foram encontradas
    for (const key of this.brain.promptKeys) {
      if (!(key in this.prompts)) {
        // Alinha com padrão: container falha startup em config error
        console.error(`Missing prompt key: ${key} for brainType: ${this.brain.brainType}`);
        process.exit(1);
      }
    }
    // Compila o grafo com checkpointer e tools filtrados
    const filteredTools = this.toolsRegistry.getTools(this.brain.brainType, this.brain.tools);
    const ctx: BrainBuildContext = {
      llm: this.llm,
      prompts: this.prompts,
      tools: filteredTools,
    };
    this.compiledGraph = this.brain.buildGraph(ctx).compile({
      checkpointer: this.checkpointer,
    });
  }

  // D-07: hot-reload de prompts sem restart
  async refreshPrompts(): Promise<void> {
    this.prompts = await loadPrompts(this.db, this.brain.brainType, this.brain.promptKeys);
  }

  // D-05: retorna { reply: string } — estado interno do LangGraph não vaza
  async run(event: BrainEvent): Promise<{ reply: string }> {
    const threadId = event.conversationId;
    
    // 1. Hydrate memory (MEM-04)
    const memCtx = await this.memoryManager.getContext(threadId, event.userId, []);
    
    // 2. Invoke graph com thread_id + callbacks Langfuse
    const callbacks = createTracingCallbacks({
      sessionId: threadId,
      userId: event.userId,
      brainId: this.brain.id,
    });
    const result = await this.compiledGraph!.invoke(
      { messages: [{ role: "human", content: event.content }], userId: event.userId, sessionId: threadId },
      { configurable: { thread_id: threadId }, callbacks }
    );
    
    // 3. Extrair última AIMessage do estado final
    const messages: BaseMessage[] = result.messages;
    const lastAI = [...messages].reverse().find((m) => m instanceof AIMessage);
    const reply = typeof lastAI?.content === "string" ? lastAI.content : "";
    
    // 4. Persist memory (long-term)
    await this.memoryManager.saveContext({
      userId: event.userId,
      profileKey: "context",
      profileValue: { lastReply: reply, conversationId: threadId },
    });
    
    return { reply };
  }
}
```

**IMPORTANTE — extração da última mensagem:** `result.messages` é `BaseMessage[]`. A última `AIMessage` é obtida com `[...messages].reverse().find(m => m instanceof AIMessage)`. O `content` pode ser `string | MessageContentComplex[]` — para v1 com respostas de texto simples, cast para `string` é correto. [ASSUMED — padrão de extração não verificado via Context7, mas alinha com o tipo `BrainState` confirmado no código]

### Pattern 3: ToolsRegistry

**O que é:** Map de brainType → lista de StructuredTool permitidas. Filter no momento de `buildGraph`.

```typescript
// Source: CONTEXT.md D-12 [VERIFIED: inspeção do código]
import type { StructuredTool } from "@langchain/core/tools";

export class ToolsRegistry {
  // brainType → nomes de tools permitidas (whitelist)
  private registry = new Map<string, Set<string>>();

  enableTool(brainType: string, toolName: string): void {
    if (!this.registry.has(brainType)) {
      this.registry.set(brainType, new Set());
    }
    this.registry.get(brainType)!.add(toolName);
  }

  disableTool(brainType: string, toolName: string): void {
    this.registry.get(brainType)?.delete(toolName);
  }

  // Filtra a lista de tools do Brain retornando apenas as permitidas para o brainType
  getTools(brainType: string, brainTools: StructuredTool[]): StructuredTool[] {
    const allowed = this.registry.get(brainType);
    if (!allowed) return []; // brainType não registrado = nenhuma tool
    return brainTools.filter((t) => allowed.has(t.name));
  }
}
```

### Pattern 4: BrainRegistry

**O que é:** Map simples de `brainId` → instância `IBrain`. Registrada uma vez no startup.

```typescript
// Source: CONTEXT.md (Claude's Discretion — estrutura interna) [ASSUMED: implementação mais simples]
export class BrainRegistry {
  private registry = new Map<string, IBrain>();

  register(brain: IBrain): void {
    if (this.registry.has(brain.id)) {
      throw new ConfigurationError(`Brain already registered: ${brain.id}`, { brainId: brain.id });
    }
    this.registry.set(brain.id, brain);
  }

  resolve(brainId: string): IBrain {
    const brain = this.registry.get(brainId);
    if (!brain) {
      throw new ConfigurationError(`Brain not found: ${brainId}`, { brainId });
    }
    return brain;
  }
}
```

### Pattern 5: Prompts Loader

**O que é:** Função que carrega prompts da tabela `prompts` para um `brainType` dado.

```typescript
// Source: CONTEXT.md D-11, padrão drizzle-orm existente [VERIFIED: inspeção de tables.ts + pool-manager.ts]
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, inArray } from "drizzle-orm";
import { prompts } from "@brain-pkg/database"; // tabela adicionada em Phase 3

export async function loadPrompts(
  sql: Sql,
  brainType: string,
  keys: string[]
): Promise<Record<string, string>> {
  const db = drizzle(sql);
  const rows = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.brainType, brainType), inArray(prompts.key, keys)));
  
  return Object.fromEntries(rows.map((r) => [r.key, r.content]));
}
```

**Nota:** A tabela `prompts` é adicionada em `packages/database/src/schema/tables.ts` e exportada pelo barrel de `packages/database/src/index.ts`. `packages/core` consome via `@brain-pkg/database`. [VERIFIED: inspeção do padrão de index.ts do database package]

### Pattern 6: Endpoint /reload-prompts

**O que é:** Handler Hono que chama `runner.refreshPrompts()`. Autenticação via `X-Admin-Token` header (D-07, Claude's Discretion).

```typescript
// Source: CONTEXT.md D-07 + server.ts pattern [VERIFIED: inspeção de server.ts]
// Adicionado ao Hono app existente em packages/observability/src/server.ts OU
// em um novo server em packages/core (decisão a ser feita no PLAN)

app.post("/reload-prompts", async (c) => {
  const token = c.req.header("X-Admin-Token");
  const expectedToken = process.env.ADMIN_TOKEN;
  
  if (!expectedToken || token !== expectedToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  
  await runner.refreshPrompts();
  return c.json({ status: "ok" });
});
```

### Pattern 7: Migration da tabela `prompts`

**Processo confirmado (VERIFIED: inspeção de migrate.ts + drizzle.config.ts + migrations/):**

1. Adicionar definição em `packages/database/src/schema/tables.ts`
2. Rodar `drizzle-kit generate` → gera `0001_*.sql` em `packages/database/src/migrations/`
3. Migration é aplicada automaticamente no startup via `migrate.ts` (já usa `./src/migrations` como pasta)
4. NUNCA editar o arquivo SQL gerado — editar apenas `tables.ts`

```typescript
// Adicionar em packages/database/src/schema/tables.ts:
import { uniqueIndex } from 'drizzle-orm/pg-core';

export const prompts = pgTable('prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  brainType: text('brain_type').notNull(),
  key: text('key').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  brainTypeKeyIdx: uniqueIndex('prompts_brain_type_key_idx').on(table.brainType, table.key),
}));
```

### Anti-Patterns a Evitar

- **MemorySaver em qualquer código de produção:** `AI-01` é categórico — `MemorySaver` NUNCA em produção. Testes unitários de BrainRunner que não precisam de DB podem usar `MemorySaver` apenas nos arquivos `*.test.ts`. [VERIFIED: comentário explícito em checkpointer.ts]
- **Prompts hardcoded em código:** Qualquer string de system prompt em arquivos `.ts` viola SDK-04. Todos os prompts vêm da tabela `prompts` via `loadPrompts()`.
- **Chamar `.compile()` dentro de `buildGraph()`:** `buildGraph()` retorna `StateGraph` não compilado (D-02). Compilação com `PostgresSaver` é responsabilidade do `BrainRunner`.
- **Usar `bun:sql` como driver Drizzle:** Sempre usar `postgres.js` (pacote `postgres`). `bun:sql` tem bug de conexão presa após constraint errors. [VERIFIED: CLAUDE.md Critical Risks]
- **Logs ou mensagens de erro incluindo API keys:** `T-2-03` — `API_KEY`, `LANGFUSE_SECRET_KEY`, `DATABASE_URL` nunca aparecem em logs ou respostas. [VERIFIED: factory.ts + tracing.ts comentários]
- **Recompilar o grafo por request:** Compilação acontece uma vez em `init()`. Invocar o grafo já compilado em `run()`.

---

## Don't Hand-Roll

| Problema | Não construir | Usar em vez disso | Por quê |
|----------|--------------|-------------------|---------|
| Checkpointing de estado LangGraph | Custom state persistence | `PostgresSaver` via `createCheckpointer()` | Já implementado, testado; edge cases em serialização de `BaseMessage` são complexos |
| Memory hydration/persistence | Custom memory queries | `MemoryManager.getContext()` + `saveContext()` | Já implementado em Phase 2; garante os 3 layers corretamente |
| LLM factory + provider switching | Switch/case por provider | `createLLM()` de `@brain-pkg/ai` | Já suporta openai/anthropic/gemini/openrouter; T-2-03 compliance embutido |
| Logging estruturado | `console.log` direto | `createLogger()` de `@brain-pkg/observability` | Pino com JSON format, contexto de Brain, tenant |
| Langfuse callbacks | Instrumentação manual de nós | `createTracingCallbacks()` | Zero-code tracing; silent no-op quando vars ausentes |
| Validação de BrainEvent | Parser manual | `BrainEventSchema.safeParse()` | Zod schema já em uso; ASVS V5 compliance embutido |
| Connection pooling por tenant | Pool manual | `TenantPoolManager.getPool(dbName)` | LRU cache, cleanup correto, já testado |

---

## Common Pitfalls

### Pitfall 1: Compilar o grafo dentro de buildGraph()

**O que dá errado:** Brain chama `.compile({ checkpointer })` dentro de `buildGraph()`, mas não tem acesso ao checkpointer — levando a usar `MemorySaver` ou `undefined`.

**Por que acontece:** Confusão sobre quem controla checkpointing.

**Como evitar:** `buildGraph()` retorna `StateGraph` "cru". O único lugar onde `.compile({ checkpointer })` é chamado é `BrainRunner.init()`, que injeta o `PostgresSaver` correto. [VERIFIED: D-02 explícito]

**Warning sign:** Qualquer `import { MemorySaver }` em arquivos fora de `*.test.ts`.

### Pitfall 2: init() não verifica TODAS as promptKeys antes de start

**O que dá errado:** BrainRunner inicia, mas prompt keys que faltam só causam erro em runtime no primeiro request — em vez de falhar no startup.

**Por que acontece:** Verificação parcial (só checa se array não-vazio, não verifica cada key individualmente).

**Como evitar:** Loop explícito sobre `brain.promptKeys` após `loadPrompts()`. Para cada key não presente no resultado, chamar `process.exit(1)`. Alinha com o padrão estabelecido em `migrate.ts` e `factory.ts`. [VERIFIED: D-06 + padrão de startup fail-fast confirmado em migrate.ts]

### Pitfall 3: refreshPrompts() não recompila o grafo

**O que dá errado:** `/reload-prompts` atualiza `this.prompts` mas o grafo já compilado ainda usa as tools/context da compilação anterior. Prompts são passados no `BrainBuildContext` no momento do `buildGraph()` — não são referências vivas.

**Por que acontece:** `buildGraph(ctx)` recebe um snapshot de `prompts`. A closure dentro dos nós do grafo captura o valor no momento da compilação.

**Como evitar:** `refreshPrompts()` deve: (1) recarregar prompts do banco, (2) reconstruir `BrainBuildContext`, (3) chamar `buildGraph()` novamente, (4) recompilar com `.compile({ checkpointer })` e substituir `this.compiledGraph`. Thread safety: se houver requests concorrentes durante o refresh, o grafo antigo ainda está válido até ser substituído atomicamente. [ASSUMED: análise do padrão — não verificado via Context7]

**Warning sign:** Teste de `/reload-prompts` que não verifica se a próxima chamada a `run()` usa os novos prompts.

### Pitfall 4: Extrair reply de result.messages incorretamente

**O que dá errado:** `result.messages[result.messages.length - 1].content` pode não ser `AIMessage` se o último nó adiciona outros tipos de mensagem. Ou `content` pode ser `MessageContentComplex[]` para modelos com tool calls/vision.

**Por que acontece:** `messagesStateReducer` acumula todas as mensagens — human, ai, tool. A última mensagem nem sempre é do LLM.

**Como evitar:** Filtrar por `instanceof AIMessage` e pegar o último. Para v1 (texto simples), verificar que `typeof content === "string"` antes de usar. [ASSUMED: inferido do tipo `BrainState` e `messagesStateReducer` — confirmar ao implementar]

### Pitfall 5: ToolsRegistry permite tools de brainType não registrado

**O que dá errado:** Brain do tipo "echo" não tem nenhuma entry no ToolsRegistry — mas `getTools()` retorna `[]` silenciosamente em vez de erro. Brain roda sem tools sem avisar.

**Por que acontece:** Map.get() retorna `undefined` para key inexistente.

**Como evitar:** Distinguir entre "brainType registrado com 0 tools" (legítimo) e "brainType não registrado" (erro de configuração). Opção: lançar `ConfigurationError` se brainType não está no Map. [ASSUMED: decisão de design — D-12 não especifica comportamento de brainType não registrado]

### Pitfall 6: addRoute para /reload-prompts em servidor separado vs. servidor existente

**O que dá errado:** `/reload-prompts` é adicionado em porta diferente da `/health`, criando dois servidores Hono em vez de um.

**Por que acontece:** `packages/observability/src/server.ts` já tem `createHealthApp()`. Se `packages/core` cria seu próprio servidor, temos dois `Bun.serve()` com portas diferentes.

**Como evitar:** Duas opções (a definir no PLAN): (a) extender `createHealthApp()` para aceitar um `BrainRunner` opcional e adicionar `/reload-prompts` condicionalmente, ou (b) criar `createCoreApp(runner)` em `packages/core` que inclui ambas as rotas. [ASSUMED: análise do padrão — decisão é Claude's Discretion]

---

## Runtime State Inventory

> Step 2.5: Esta fase é greenfield (novo package `packages/core`), não rename/refactor.

Não aplicável — nenhuma renomeação ou migração de dados existentes. A nova migration `prompts` cria uma tabela nova (não renomeia existente). Sem runtime state afetado.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `bun` | Runtime + test runner | Detectado via `@types/bun` nas deps | 1.x | — |
| `postgres` (npm) | Drizzle driver + prompts query | ✓ (instalado) | ^3.4.9 | — |
| `drizzle-kit` | Gerar migration da tabela prompts | ✓ (instalado em packages/database) | ^0.31.10 | — |
| `drizzle-orm` | Queries da tabela prompts | ✓ (instalado) | ^0.45.2 | — |
| `@langchain/langgraph` | StateGraph, compile, invoke | ✓ (instalado) | ^1.4.1 | — |
| `@langchain/core` | BaseChatModel, StructuredTool, AIMessage | ✓ (instalado) | ^1.1.48 | — |
| `hono` | Endpoint /reload-prompts | ✓ (instalado) | ^4.12.25 | — |
| PostgreSQL (runtime) | BrainRunner.init() + prompts query | Requerido em runtime — não disponível em unit tests | 16.x | MemorySaver apenas em *.test.ts |

[VERIFIED: inspeção de todos os package.json dos workspace packages]

**Missing dependencies com no fallback:** Nenhuma — todas as dependências já estão instaladas nos workspace packages existentes.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, Jest-compatible API) |
| Config file | Nenhum — bun test auto-descobre `*.test.ts` |
| Quick run command | `bun test packages/core/src` |
| Full suite command | `bun test packages/core/src && bun test packages/database/src` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Existe? |
|--------|----------|-----------|-------------------|-------------|
| SDK-01 | IBrain pode ser registrado no BrainRegistry e resolvido por ID | unit | `bun test packages/core/src/brain/registry.test.ts` | ❌ Wave 0 |
| SDK-02 | BrainRunner.run(event) hydrata memória, invoca grafo, persiste, retorna `{ reply: string }` | unit (MemorySaver) | `bun test packages/core/src/runner/runner.test.ts` | ❌ Wave 0 |
| SDK-02 | BrainRunner.init() falha com exit 1 se promptKey ausente | unit | `bun test packages/core/src/runner/runner.test.ts` | ❌ Wave 0 |
| SDK-03 | ToolsRegistry enable para "echo", disable para "other" | unit | `bun test packages/core/src/tools/registry.test.ts` | ❌ Wave 0 |
| SDK-04 | loadPrompts() carrega do DB via promptKeys; nenhuma string de prompt em código fonte | unit (mock db) | `bun test packages/core/src/prompts/loader.test.ts` | ❌ Wave 0 |
| SDK-04 | Migration `prompts` table aplicada corretamente | integration | `TEST_DATABASE_URL=$TEST_DATABASE_URL bun test packages/database/src/migrate.test.ts` | ❌ Wave 0 |

**Nota sobre SDK-02 e MemorySaver em testes:** `AI-01` permite `MemorySaver` apenas em `*.test.ts` para testes unitários sem PostgreSQL. O teste de `BrainRunner` deve usar `MemorySaver` para checkpointing — não `PostgresSaver`. Isso está alinhado com o padrão estabelecido em `packages/ai/src/graph/state.test.ts`. [VERIFIED: comentário em checkpointer.ts]

### Sampling Rate
- **Por task commit:** `bun test packages/core/src --passWithNoTests`
- **Por wave merge:** `bun test packages/core/src && bun test packages/database/src`
- **Phase gate:** Suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/core/src/brain/registry.test.ts` — cobre SDK-01
- [ ] `packages/core/src/runner/runner.test.ts` — cobre SDK-02
- [ ] `packages/core/src/tools/registry.test.ts` — cobre SDK-03
- [ ] `packages/core/src/prompts/loader.test.ts` — cobre SDK-04 (unit)
- [ ] `packages/database/src/migrate.test.ts` — já existe; pode precisar de caso de teste para tabela `prompts`
- [ ] `packages/core/package.json` — arquivo de configuração do workspace package
- [ ] `packages/core/tsconfig.json` — extends tsconfig.base.json
- [ ] `tsconfig.base.json` — adicionar alias `@brain-pkg/core`

---

## Code Examples

### Exemplo: Compilação do grafo com checkpointer + callbacks

```typescript
// Source: packages/ai/src/graph/checkpointer.ts + packages/observability/src/tracing.ts [VERIFIED]
// Padrão de como BrainRunner compila o grafo em init():

const checkpointer = await createCheckpointer(process.env.DATABASE_URL!);
const callbacks = createTracingCallbacks({ sessionId: threadId, userId, brainId: brain.id });

const graph = brain.buildGraph(ctx).compile({ checkpointer });

// Durante run():
const result = await graph.invoke(input, {
  configurable: { thread_id: threadId },
  callbacks,
});
```

### Exemplo: Drizzle query com postgres.js

```typescript
// Source: packages/database/src/pool-manager.ts + packages/memory/src/long-term.ts pattern [VERIFIED]
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, inArray } from "drizzle-orm";
import type { Sql } from "postgres";

export async function loadPrompts(
  sql: Sql,
  brainType: string,
  keys: string[]
): Promise<Record<string, string>> {
  const db = drizzle(sql);
  const rows = await db
    .select({ key: prompts.key, content: prompts.content })
    .from(prompts)
    .where(and(eq(prompts.brainType, brainType), inArray(prompts.key, keys)));
  return Object.fromEntries(rows.map((r) => [r.key, r.content]));
}
```

### Exemplo: Barrel export pattern (seguir packages existentes)

```typescript
// Source: packages/ai/src/index.ts, packages/memory/src/index.ts [VERIFIED]
// packages/core/src/index.ts:
export { IBrain, BrainBuildContext } from "./brain/interface.js";
export { BrainRegistry } from "./brain/registry.js";
export { BrainRunner } from "./runner/runner.js";
export { ToolsRegistry } from "./tools/registry.js";
export { loadPrompts } from "./prompts/loader.js";
```

### Exemplo: tsconfig.json de novo workspace package

```json
// Source: padrão dos outros packages [VERIFIED: inspeção de packages/ai, packages/memory]
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" },
    { "path": "../ai" },
    { "path": "../memory" },
    { "path": "../database" },
    { "path": "../transport" },
    { "path": "../observability" }
  ]
}
```

### Exemplo: Adicionar alias no tsconfig.base.json

```json
// Source: tsconfig.base.json paths section [VERIFIED: inspeção do arquivo]
// Adicionar à seção "paths":
"@brain-pkg/core": ["packages/core/src"]
```

---

## State of the Art

| Abordagem Antiga | Abordagem Atual | Quando Mudou | Impacto |
|------------------|-----------------|--------------|---------|
| `MemorySaver` para checkpointing | `PostgresSaver` exclusivo em produção | AI-01 (Phase 2) | MemorySaver só em *.test.ts — nunca em código de produção |
| Prompts hardcoded em código | Tabela `prompts` no banco | SDK-04 (Phase 3) | Toda string de system prompt vem do banco |
| Transport retorna `{ status: "accepted" }` | Retorna `{ status: "ok", reply: string }` | Phase 3 | handler.ts está esperando Phase 3 para wiring completo |

---

## Assumptions Log

| # | Claim | Section | Risk se Errado |
|---|-------|---------|----------------|
| A1 | Extração da última AIMessage: `[...messages].reverse().find(m => m instanceof AIMessage)` funciona para texto simples em v1 | Pattern 2 (run()) | Resposta vazia ou erro de tipo — verificar ao implementar |
| A2 | `refreshPrompts()` deve recompilar o grafo (não apenas recarregar prompts) porque buildGraph() recebe snapshot | Pitfall 3 | Hot-reload não funciona para prompts se grafo não for recompilado |
| A3 | Comportamento quando brainType não está no ToolsRegistry deve lançar ConfigurationError (não retornar [] silenciosamente) | Pitfall 5 | Testes SC-3 podem passar mesmo com lógica incorreta |
| A4 | Endpoint `/reload-prompts` vai no mesmo servidor Hono que `/health` (não cria servidor separado) | Pitfall 6 | Dois servidores com portas diferentes — confusão operacional |

---

## Open Questions

1. **Onde fica o servidor Hono com `/reload-prompts`?**
   - O que sabemos: `packages/observability/src/server.ts` tem `createHealthApp()` que retorna app Hono. O endpoint `/reload-prompts` precisa de acesso ao `BrainRunner` — que é do `packages/core`.
   - O que está incerto: Criar dependência circular (observability → core → observability) ou criar o servidor em `packages/core`?
   - Recomendação: Criar `createCoreApp(runner, sql)` em `packages/core/src/server.ts` que monta `/reload-prompts` + delega `/health` para `performHealthCheck`. O app em `packages/core` unifica os dois endpoints. `packages/observability` não precisa conhecer `packages/core`.

2. **Onde BrainRunner obtém o `sql` (Sql instance) para `loadPrompts`?**
   - O que sabemos: `TenantPoolManager.getPool(dbName)` retorna `Sql`. `BrainRunner` precisa de um `Sql` para queries de prompts.
   - O que está incerto: Se BrainRunner recebe o `Sql` diretamente no constructor (como `MemoryManager` recebe `db`) ou se recebe o `TenantPoolManager` e resolve o tenant.
   - Recomendação: Para v1 (um tenant por container — `DATABASE_NAME` env), injetar `Sql` diretamente no constructor do BrainRunner. Isso alinha com o padrão de `MemoryManager({ db, checkpointer })`.

---

## Project Constraints (from CLAUDE.md)

| Constraint | Enforcement |
|------------|-------------|
| Runtime: Bun | Todos os scripts usam `bun` — sem `node` direto |
| ORM: Drizzle com `postgres.js` driver | NUNCA usar `bun:sql` como driver Drizzle |
| Testing: `bun test` (built-in) | NUNCA usar Vitest ou Jest |
| LangGraph/LangChain para orquestração | NUNCA usar Mastra ou Vercel AI SDK |
| `MemorySaver` proibido em produção | Apenas em `*.test.ts` |
| Commits: Conventional Commits com emoji | Formato: `✨ feat(core): ...` |
| NUNCA incluir `Co-Authored-By: Claude` nos commits | Proibido explicitamente em CLAUDE.md |
| Segurança: API keys, secrets NUNCA em logs/respostas | `API_KEY`, `LANGFUSE_SECRET_KEY`, `DATABASE_URL` |
| `postgres.js` como driver Drizzle | não `bun:sql` — bug de conexão presa documentado |

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | sim (endpoint /reload-prompts) | Header `X-Admin-Token` vs env var `ADMIN_TOKEN` |
| V3 Session Management | não (LangGraph gerencia via thread_id) | — |
| V4 Access Control | sim (ToolsRegistry por brainType) | Whitelist de tools — deny by default |
| V5 Input Validation | sim (BrainEvent) | `BrainEventSchema.safeParse()` — já implementado |
| V6 Cryptography | não | — |

### Known Threat Patterns para este stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via content field | Tampering | `BrainEventSchema` valida estrutura antes do processamento; prompts carregados do banco (não de input) |
| API key leak em logs de erro | Information Disclosure | Seguir padrão de `factory.ts`: nunca incluir `API_KEY` em mensagens de erro ou logs |
| Unauthorized prompt reload | Elevation of Privilege | `X-Admin-Token` header validado antes de `refreshPrompts()` |
| BrainType spoofing via BrainEvent | Tampering | `brainType` vem do `IBrain` registrado — não do `BrainEvent` recebido |

---

## Sources

### Primary (HIGH confidence)
- `/root/Brain/packages/ai/src/graph/state.ts` — `BrainStateAnnotation` API verificada
- `/root/Brain/packages/ai/src/graph/checkpointer.ts` — `createCheckpointer()`, PostgresSaver pattern
- `/root/Brain/packages/ai/src/llm/factory.ts` — `createLLM()`, ConfigurationError pattern
- `/root/Brain/packages/memory/src/manager.ts` — `MemoryManager` API completa
- `/root/Brain/packages/transport/src/webhook/events.ts` — `BrainEvent` type
- `/root/Brain/packages/transport/src/webhook/handler.ts` — comentário Phase 3 wiring point
- `/root/Brain/packages/database/src/schema/tables.ts` — schema pattern para nova migration
- `/root/Brain/packages/database/drizzle.config.ts` — configuração de migrations
- `/root/Brain/packages/database/src/migrate.ts` — padrão de fail-fast no startup
- `/root/Brain/packages/observability/src/tracing.ts` — `createTracingCallbacks()` API
- `/root/Brain/packages/observability/src/server.ts` — Hono server pattern
- `/root/Brain/packages/shared/src/errors/index.ts` — `ConfigurationError` base class
- `/root/Brain/tsconfig.base.json` — path aliases pattern

### Secondary (MEDIUM confidence)
- `/root/Brain/CLAUDE.md` — project constraints, critical risks (postgres.js, amqplib-bun, MemorySaver)
- `/root/Brain/.planning/phases/03-brain-sdk/03-CONTEXT.md` — locked decisions D-01 to D-12

### Tertiary (LOW confidence, marcados como [ASSUMED])
- Extração de `AIMessage` do `result.messages` — inferido do tipo `BrainState`, não verificado via Context7
- Necessidade de recompilar grafo no `refreshPrompts()` — análise do padrão de closure do buildGraph()
- Comportamento de ToolsRegistry para brainType não registrado — D-12 não especifica

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — todos os packages já instalados e verificados via package.json
- Architecture: HIGH — padrões confirmados via inspeção direta do código existente
- BrainRunner run() extração de AIMessage: MEDIUM — inferido de tipos, não testado
- Pitfalls: HIGH para os verificados, MEDIUM/LOW para os assumidos

**Research date:** 2026-06-12
**Valid until:** 2026-07-12 (stack estável, sem moving targets)
