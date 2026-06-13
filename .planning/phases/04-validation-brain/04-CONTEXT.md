# Phase 4: Validation Brain - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 cria `apps/brain-echo` — o primeiro app concreto que usa o Brain SDK end-to-end. O Echo Brain implementa `IBrain`, é empacotado em uma imagem Docker multi-stage, e prova via integration tests que toda a infraestrutura funciona: transport → BrainRunner → LangGraph → memória em 3 camadas → resposta. Ao final desta fase, o projeto v1 está completo e distribuível.

</domain>

<decisions>
## Implementation Decisions

### Echo Brain (IBrain implementation)
- **D-01:** O EchoBrain usa LLM real + system prompt carregado da tabela `prompts` (`brain_type='echo'`, `key='system'`). Recebe a mensagem do usuário, aplica o system prompt do banco, invoca o LLM e retorna a resposta. Prova o fluxo completo: DB prompts → LangGraph → LLM → resposta.
- **D-02:** `EchoBrain.tools = []` — sem tools na fase de validação. Tools concretas (ex: busca de CRM, agenda) vêm nas implementações de Brain v2 (SDR, Suporte). `ToolsRegistry` ainda é exercitado com lista vazia.
- **D-03:** `buildGraph()` cria um nó de LLM que: (1) constrói o histórico de mensagens com o system prompt de `ctx.prompts['system']`, (2) chama `ctx.llm.invoke()`, (3) adiciona a resposta ao state. Retorna `StateGraph` não compilado (BrainRunner chama `.compile({ checkpointer })`).

### App Server Assembly
- **D-04:** Único Hono app em `apps/brain-echo/src/server.ts` montando os 3 sub-apps via `app.route('/')`:
  - `createHealthApp(sql)` → `GET /health`
  - `createWebhookApp(runner)` → `POST /api/v1/webhook`
  - `createCoreApp(runner)` → `POST /reload-prompts`
  Um único `Bun.serve` na mesma porta serve todos os endpoints.
- **D-05:** Startup sequencial no entrypoint `apps/brain-echo/src/index.ts`:
  1. `runMigrations(sql)` — aplica migrations + seed de prompts (falha com exit 1 se falhar)
  2. `runner.init()` — carrega prompts do banco + compila graph (falha com exit 1 se prompt faltando)
  3. `Bun.serve({ fetch: app.fetch })` — só sobe após os dois passos anteriores com sucesso

### Seed de Prompts
- **D-06:** System prompt do EchoBrain seedado via migration SQL embutida na migration sequence (`INSERT INTO prompts (brain_type, key, content) VALUES ('echo', 'system', '...') ON CONFLICT (brain_type, key) DO NOTHING`). Roda no startup junto com as migrations — container sobe com tudo pronto, sem passos manuais.

### Dockerfile
- **D-07:** 2 estágios Docker:
  - `builder`: `oven/bun:1`, copia monorepo, instala todas as deps com `pnpm install --frozen-lockfile`, compila TypeScript (`pnpm build`)
  - `runner`: `oven/bun:1`, copia apenas artefatos compilados (`dist/`) + node_modules de produção do builder. Imagem final menor, sem devDeps.
- **D-08:** Dockerfile fica em `apps/brain-echo/Dockerfile`. Build context é a raiz do monorepo: `docker build -f apps/brain-echo/Dockerfile .` — necessário para o builder acessar todos os `packages/`.

### Testes de Integração
- **D-09:** SC-3 (restart persistence): bun test em `apps/brain-echo/src/__tests__/integration/` usando `Bun.spawn` para rodar docker CLI (`docker restart`). Automatizado, roda em CI com Docker disponível. Testa que turno 2 referencia contexto do turno 1 após restart.
- **D-10:** SC-4 (10 tenants simultâneos): bun test direto contra `TenantPoolManager` (sem Docker). Instancia 10 pools com `DATABASE_NAME` diferentes, faz queries concorrentes, consulta `pg_stat_activity` para confirmar contagem de conexões abaixo do LRU cap (max 20 × pool size).
- **D-11:** Todos os testes de integração em `apps/brain-echo/src/__tests__/integration/`. Testes unitários do EchoBrain (se houver) em `apps/brain-echo/src/__tests__/unit/`. Segue convenção já estabelecida no projeto.

### Claude's Discretion
- Conteúdo exato do system prompt do Echo Brain (ex: "Você é um assistente útil. Responda as perguntas do usuário de forma clara e concisa.")
- Porta padrão do servidor (sugestão: 3000, configurável via `PORT` env)
- Estrutura interna do nó LLM no `buildGraph()` (usar `HumanMessage` + `SystemMessage` ou messages array com roles)
- Nome do arquivo de migration para o seed de prompts

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Architecture
- `.planning/REQUIREMENTS.md` — Requirement INFRA-03 (Docker multi-stage com Bun runtime)
- `.planning/PROJECT.md` — Core value, constraints (Bun, Hono, Drizzle, LangGraph), key decisions
- `CLAUDE.md` — Stack decisions, critical risks (postgres.js driver, pnpm over bun workspaces, oven/bun:1 image)
- `.planning/ROADMAP.md` — Phase 4 goal, success criteria SC-1 a SC-4

### Prior Phase Contexts (padrões a seguir)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-06/D-07/D-08: migrations forward-only, seed no startup, container exit 1 em falha
- `.planning/phases/02-domain-packages/02-CONTEXT.md` — D-03: DedupCache in-memory, D-04: path `/api/v1/webhook`, D-09/D-10: padrões de teste
- `.planning/phases/03-brain-sdk/03-CONTEXT.md` — D-01 a D-12: IBrain interface, BrainRunner lifecycle, ToolsRegistry, prompts table schema

### Existing Code — Padrões a Seguir
- `packages/core/src/brain/interface.ts` — `IBrain` e `BrainBuildContext` (EchoBrain implementa isso)
- `packages/core/src/runner/runner.ts` — `BrainRunner` lifecycle (init → run → refreshPrompts)
- `packages/core/src/server.ts` — `createCoreApp(runner)` expõe `/reload-prompts`
- `packages/core/src/index.ts` — exports públicos de packages/core
- `packages/observability/src/server.ts` — `createHealthApp(sql)` e `startServer()` (padrão de servidor Hono)
- `packages/transport/src/webhook/handler.ts` — `createWebhookApp(runner?)` já suporta BrainRunner
- `packages/database/src/migrate.ts` — padrão de migration usado nas fases anteriores
- `packages/database/src/pool-manager.ts` — `TenantPoolManager` (D-10: usado no teste SC-4)
- `packages/ai/src/graph/state.ts` — `BrainStateAnnotation` (EchoBrain usa sem extensão)
- `packages/core/src/__tests__/` — exemplo de estrutura de testes para apps

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createHealthApp(sql)` (`packages/observability`) — montado diretamente no Hono app principal
- `createWebhookApp(runner)` (`packages/transport`) — já aceita BrainRunner via duck typing
- `createCoreApp(runner)` (`packages/core`) — endpoint `/reload-prompts` já implementado
- `BrainRunner` + `ToolsRegistry` (`packages/core`) — entrypoint de apps/brain-echo instancia e inicializa
- `TenantPoolManager` (`packages/database`) — fornece `Sql` por tenant; usado no teste SC-4
- `runMigrations` / `migrate.ts` (`packages/database`) — pattern de startup migration já testado
- `IBrain` + `BrainBuildContext` (`packages/core`) — EchoBrain implementa diretamente
- `BrainStateAnnotation` (`packages/ai`) — estado base, sem extensão em v1

### Established Patterns
- `app.route('/', subApp)` no Hono — padrão de composição de apps
- Container exit 1 em erro de configuração (migrate falha, prompt faltando)
- `postgres.js` como driver Drizzle (nunca `bun:sql`)
- `pnpm install --frozen-lockfile` no Docker (não `bun install` — regressão Jan 2026)
- Testes em `src/__tests__/unit/` e `src/__tests__/integration/`
- Barrel export em `src/index.ts`

### Integration Points
- `apps/brain-echo` → consome `packages/core`, `packages/observability`, `packages/transport`, `packages/database`
- `apps/brain-echo/Dockerfile` → build context = raiz do monorepo (acesso a `packages/`)
- Tabela `prompts` (`packages/database`) → seed do system prompt do Echo Brain na migration
- `pg_stat_activity` (PostgreSQL) → consultada no teste SC-4 para contar conexões

</code_context>

<specifics>
## Specific Ideas

### EchoBrain implementation sketch
```typescript
// apps/brain-echo/src/brain.ts
import { StateGraph } from "@langchain/langgraph";
import { BrainStateAnnotation } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";

export const echoBrain: IBrain = {
  id: "brain-echo",
  brainType: "echo",
  promptKeys: ["system"],
  tools: [],
  buildGraph(ctx: BrainBuildContext) {
    const graph = new StateGraph(BrainStateAnnotation);
    
    graph.addNode("llm", async (state) => {
      const response = await ctx.llm.invoke([
        { role: "system", content: ctx.prompts["system"] },
        ...state.messages,
      ]);
      return { messages: [...state.messages, response] };
    });
    
    graph.addEdge("__start__", "llm");
    graph.addEdge("llm", "__end__");
    
    return graph;  // NOT compiled — BrainRunner calls .compile({ checkpointer })
  },
};
```

### Entrypoint de apps/brain-echo
```typescript
// apps/brain-echo/src/index.ts
async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  
  // 1. Migrate + seed prompts
  await runMigrations(sql);
  
  // 2. Init runner (exit 1 se prompt faltando)
  const toolsRegistry = new ToolsRegistry();
  const runner = new BrainRunner({ brain: echoBrain, sql, toolsRegistry });
  await runner.init();
  
  // 3. Assemble Hono app
  const app = new Hono();
  app.route("/", createHealthApp(sql));
  app.route("/", createWebhookApp(runner));
  app.route("/", createCoreApp(runner));
  
  const port = parseInt(process.env.PORT || "3000", 10);
  Bun.serve({ port, fetch: app.fetch });
}
main();
```

### Dockerfile multi-stage (2 estágios)
```dockerfile
# apps/brain-echo/Dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/brain-echo/ ./apps/brain-echo/
RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN pnpm build

FROM oven/bun:1 AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/*/dist ./packages/*/dist/
COPY --from=builder /app/apps/brain-echo/dist ./apps/brain-echo/dist/
ENV PORT=3000
CMD ["bun", "apps/brain-echo/dist/index.js"]
```

### Success Criteria Traceability
1. SC-1: `docker build` → imagem válida + container sobe sem erros → D-07, D-08
2. SC-2: POST /api/v1/webhook → transport → BrainRunner → LangGraph → 3 memory layers → reply → D-01, D-04, D-05
3. SC-3: Container restart → PostgresSaver preserva estado → D-09 (bun test + docker CLI)
4. SC-4: 10 tenants simultâneos abaixo do LRU cap → D-10 (bun test + pg_stat_activity)

</specifics>

<deferred>
## Deferred Ideas

- Tools concretas no Echo Brain (ex: getCurrentDate, getSystemInfo) → Brain SDR/Suporte v2
- RabbitMQ transport → v2 (ITransport interface já pronta, só plugar)
- Checkpoint table pruning → v2

</deferred>

---

*Phase: 04-validation-brain*
*Context gathered: 2026-06-13*
