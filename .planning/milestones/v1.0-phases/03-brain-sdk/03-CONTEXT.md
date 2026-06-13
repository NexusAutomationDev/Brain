# Phase 3: Brain SDK - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 cria `packages/core` — a camada de integração que conecta todos os domain packages (ai, memory, transport, database) em um contrato coeso para Brains. Ao final desta fase, qualquer Brain implementando `IBrain` pode ser registrado no `BrainRegistry`, executado pelo `BrainRunner`, e ter seus prompts carregados do banco. A fase entrega: `IBrain` interface, `BrainRunner`, `BrainRegistry`, `ToolsRegistry`, e uma nova tabela `prompts` no schema.

</domain>

<decisions>
## Implementation Decisions

### IBrain Interface (SDK-01)
- **D-01:** `buildGraph(ctx: BrainBuildContext)` recebe dependências injetadas pelo BrainRunner — `{ llm: BaseChatModel, prompts: Record<string, string>, tools: StructuredTool[] }`. Brain foca exclusivamente em montar nós e arestas do grafo.
- **D-02:** `buildGraph()` retorna `StateGraph` **não compilado**. BrainRunner chama `.compile({ checkpointer })` com o `PostgresSaver` correto. Runner controla a política de checkpointing.
- **D-03:** `tools[]` em `IBrain` são instâncias `StructuredTool` (LangChain) já construídas — não strings. `ToolsRegistry` filtra quais são permitidas por `brainType` antes de injetar no `BrainBuildContext`.
- **D-04:** Estado base fixo no v1 — todos os Brains usam `BrainStateAnnotation` sem extensão de campos customizados. Extensão de estado (ex: `qualificationResult` no SDR Brain) é v2.

### BrainRunner (SDK-02)
- **D-05:** `BrainRunner.run(event: BrainEvent)` retorna `{ reply: string }` — apenas o texto da última mensagem do LLM. Estado interno do LangGraph não vaza para o transport layer.
- **D-06:** `BrainRunner` tem lifecycle explícito de 2 etapas:
  1. `new BrainRunner({ brain, db, ... })` — construção síncrona
  2. `await runner.init()` — carrega prompts do banco, falha com exit 1 se qualquer `promptKey` do Brain não existir
- **D-07:** Endpoint `POST /reload-prompts` força reload dos prompts do banco sem restart do container. `BrainRunner` expõe método `refreshPrompts()` para ser chamado pelo handler. Endpoint requer autenticação (mecanismo a definir no plano — scope: simples para v1).

### prompts Table Schema (SDK-04)
- **D-08:** Chave scoped por `(brain_type, key)` — UNIQUE constraint em `(brain_type, key)`. Sub-agentes são Brain types separados (ex: `brain_type = 'sdr-qualification'`) com seus próprios `promptKeys[]`.
- **D-09:** Sem coluna de version no v1 — UPDATE direto no content, histórico via git.
- **D-10:** Sem coluna de locale no v1 — suporte a i18n é v2.
- **D-11:** Schema da tabela: `id (uuid PK)`, `brain_type (text NOT NULL)`, `key (text NOT NULL)`, `content (text NOT NULL)`, `created_at`, `updated_at`. UNIQUE(brain_type, key).

### ToolsRegistry (SDK-03)
- **D-12:** `ToolsRegistry` é keyed por `brainType` (string) → lista de `StructuredTool` permitidas. Enable/disable acontece no momento do `buildGraph(ctx)` — Runner filtra `brain.tools[]` via Registry antes de passar no `ctx.tools`.

### Claude's Discretion
- Mecanismo de autenticação do endpoint `/reload-prompts` — simples para v1 (ex: header `X-Admin-Token` via env var).
- Estrutura interna do `BrainRegistry` — como mapeia `brainId` → `IBrain` instance.
- Como `ToolsRegistry` é inicializado — na construção do `BrainRunner` ou singleton global no `packages/core`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Architecture
- `.planning/REQUIREMENTS.md` — Requirements SDK-01, SDK-02, SDK-03, SDK-04 (tabela prompts, IBrain, BrainRunner, ToolsRegistry)
- `.planning/PROJECT.md` — Core value, constraints (Bun, Hono, Drizzle, LangGraph), key decisions
- `CLAUDE.md` — Stack decisions, critical risks (postgres.js driver, pnpm over bun workspaces)
- `.planning/ROADMAP.md` — Phase 3 goal, success criteria SC-1 a SC-4

### Prior Phase Contexts (padrões a seguir)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-06/D-08: migrations forward-only, container falha no startup se migration falhar (alinha com D-06 desta fase)
- `.planning/phases/02-domain-packages/02-CONTEXT.md` — D-01/D-02: Langfuse via CallbackHandler (BrainRunner deve injetar callbacks no .compile()); D-09/D-10: padrões de teste

### Existing Code — Padrões a Seguir
- `packages/ai/src/graph/state.ts` — `BrainStateAnnotation` (estado base que todos os Brains usam)
- `packages/ai/src/graph/checkpointer.ts` — `createCheckpointer()` (BrainRunner usa para criar PostgresSaver)
- `packages/ai/src/llm/factory.ts` — `createLLM()` (BrainRunner injeta no BrainBuildContext)
- `packages/ai/src/index.ts` — exports do packages/ai (BrainStateAnnotation, createCheckpointer, createLLM, createEmbeddings)
- `packages/memory/src/manager.ts` — `MemoryManager` (BrainRunner usa para hydrate/persist de memória)
- `packages/transport/src/webhook/events.ts` — `BrainEvent` (tipo que BrainRunner.run() recebe)
- `packages/transport/src/interface.ts` — `ITransport` (padrão de interface abstrata)
- `packages/database/src/schema/tables.ts` — Schema existente (adicionar tabela `prompts` aqui via nova migration)
- `packages/database/src/pool-manager.ts` — `TenantPoolManager` (BrainRunner obtém DB por tenant)
- `packages/observability/src/server.ts` — Servidor Hono existente (endpoint /reload-prompts pode ser adicionado aqui)
- `packages/shared/src/errors/index.ts` — `BrainError`, `ConfigurationError` (base de erros para SDK)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BrainStateAnnotation` (`packages/ai`) — estado base para todos os Brains; sem modificação em v1
- `createCheckpointer()` (`packages/ai`) — BrainRunner chama para obter `PostgresSaver`
- `createLLM()` (`packages/ai`) — BrainRunner injeta como `ctx.llm` no buildGraph()
- `MemoryManager` (`packages/memory`) — BrainRunner usa `getContext()` antes do run e `saveContext()` após
- `BrainEvent` / `BrainEventSchema` (`packages/transport`) — tipo de entrada do BrainRunner.run()
- `TenantPoolManager` (`packages/database`) — fornece conexão Drizzle por tenant para BrainRunner
- `createLogger()` (`packages/observability`) — todos os componentes de packages/core usam para logging estruturado
- `BrainError` / `ConfigurationError` (`packages/shared`) — base de erros para SDK
- `tables.ts` (`packages/database`) — adicionar `prompts` table aqui; gerar nova migration via `drizzle-kit`

### Established Patterns
- Barrel exports em `src/index.ts` — `packages/core` segue mesmo padrão
- `@brain-pkg/core` alias — adicionar no `tsconfig.base.json`
- Testes unitários com `bun test` + `mock.module()` para deps externas
- `postgres.js` como driver Drizzle (nunca `bun:sql`)
- Container falha startup (exit 1) em erros de configuração — D-06/D-11 desta fase alinha com esse padrão
- Webhook handler (`packages/transport`) já retorna `{ status: "accepted" }` — Phase 3 muda para `{ status: "ok", reply: string }`

### Integration Points
- `packages/core` → consome todos os domain packages (ai, memory, transport, database, observability)
- `packages/transport/webhook/handler.ts` — `const _event: BrainEvent = parsed.data` está esperando Phase 3 para wiring completo (comentário "Event dispatching will be wired in Phase 3 (BrainRunner)")
- Nova migration para tabela `prompts` — adicionar em `packages/database/src/schema/tables.ts` + `drizzle-kit generate`

</code_context>

<specifics>
## Specific Ideas

### BrainBuildContext type
```typescript
interface BrainBuildContext {
  llm: BaseChatModel;                    // createLLM() result
  prompts: Record<string, string>;       // loaded from prompts table: { [key]: content }
  tools: StructuredTool[];               // brain.tools[] filtered by ToolsRegistry
}
```

### IBrain contract
```typescript
interface IBrain {
  id: string;
  brainType: string;                     // used for ToolsRegistry lookup + prompts scoping
  promptKeys: string[];                  // keys to load from prompts table (this brain_type)
  tools: StructuredTool[];               // full tool list; Runner filters via ToolsRegistry
  buildGraph(ctx: BrainBuildContext): StateGraph<typeof BrainStateAnnotation>;
}
```

### prompts table migration (nova)
```typescript
// packages/database/src/schema/tables.ts — adicionar:
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

### BrainRunner lifecycle
```typescript
const runner = new BrainRunner({ brain, db, llm, checkpointer });
await runner.init();  // carrega prompts; exit 1 se key faltando
await runner.run(event);  // { reply: string }
await runner.refreshPrompts();  // hot-reload via /reload-prompts endpoint
```

### Sub-agentes como Brain types separados
- SDR Brain: `brain_type = 'sdr'`, `promptKeys = ['sdr-system', 'sdr-greeting']`
- SDR Qualification sub-agent: `brain_type = 'sdr-qualification'`, `promptKeys = ['sdr-qualification-probe']`
- Cada sub-agente é um `IBrain` separado registrado no `BrainRegistry`

### Success Criteria Traceability
1. SC-1: IBrain com `id, promptKeys[], tools[], buildGraph()` → registrado e resolvido por ID no BrainRegistry → D-01, D-03
2. SC-2: BrainRunner.run(event) → hydrate memory → invoke graph → persist memory → `{ reply: string }` → D-05, D-06
3. SC-3: ToolsRegistry enable para "echo", disable para "other" → D-12
4. SC-4: Prompts carregados do DB via promptKeys no startup → D-06, D-07, D-08

</specifics>

<deferred>
## Deferred Ideas

- Extensão de estado por Brain (ex: `qualificationResult` para SDR) → v2 quando Brain SDR for implementado
- Locale/i18n na tabela `prompts` → v2
- Versionamento de prompts → v2
- Mecanismo de licenciamento (`LICENSE_KEY`) → v2 (já em REQUIREMENTS.md)
- RBAC de tools por instância (não só por tipo) → fora de escopo v1

</deferred>

---

*Phase: 03-brain-sdk*
*Context gathered: 2026-06-12*
