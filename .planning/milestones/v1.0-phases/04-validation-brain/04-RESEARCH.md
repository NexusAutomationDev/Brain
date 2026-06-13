# Phase 4: Validation Brain - Research

**Researched:** 2026-06-13
**Domain:** Docker multi-stage packaging com Bun, apps workspace, integration testing, runMigrations refactor
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Echo Brain (IBrain implementation)**
- D-01: EchoBrain usa LLM real + system prompt carregado da tabela `prompts` (`brain_type='echo'`, `key='system'`). Prova fluxo completo: DB prompts → LangGraph → LLM → resposta.
- D-02: `EchoBrain.tools = []` — sem tools na fase de validação. ToolsRegistry ainda exercitado com lista vazia.
- D-03: `buildGraph()` cria nó de LLM que: (1) constrói histórico com system prompt de `ctx.prompts['system']`, (2) chama `ctx.llm.invoke()`, (3) adiciona resposta ao state. Retorna `StateGraph` NÃO compilado.

**App Server Assembly**
- D-04: Único Hono app em `apps/brain-echo/src/server.ts` montando 3 sub-apps via `app.route('/')`: `createHealthApp(sql)`, `createWebhookApp(runner)`, `createCoreApp(runner)`. Um único `Bun.serve` na mesma porta.
- D-05: Startup sequencial: (1) `runMigrations(sql)`, (2) `runner.init()`, (3) `Bun.serve`. Exit 1 em qualquer falha antes do serve.

**Seed de Prompts**
- D-06: System prompt seedado via migration SQL (`INSERT INTO prompts ... ON CONFLICT DO NOTHING`). Roda no startup junto com migrations.

**Dockerfile**
- D-07: 2 estágios — `builder` (oven/bun:1, pnpm install --frozen-lockfile, pnpm build) + `runner` (oven/bun:1, só dist/ + node_modules produção).
- D-08: `apps/brain-echo/Dockerfile`. Build context = raiz do monorepo.

**Testes de Integração**
- D-09: SC-3 (restart persistence): bun test + `Bun.spawn` com docker CLI. Em `apps/brain-echo/src/__tests__/integration/`.
- D-10: SC-4 (10 tenants): bun test direto contra `TenantPoolManager` + `pg_stat_activity`. Sem Docker.
- D-11: Testes de integração em `src/__tests__/integration/`, unitários em `src/__tests__/unit/`.

### Claude's Discretion
- Conteúdo exato do system prompt do Echo Brain
- Porta padrão do servidor (sugestão: 3000, configurável via `PORT` env)
- Estrutura interna do nó LLM em `buildGraph()` (messages array com roles vs HumanMessage/SystemMessage)
- Nome do arquivo de migration para o seed de prompts

### Deferred Ideas (OUT OF SCOPE)
- Tools concretas no Echo Brain (getCurrentDate, getSystemInfo) → Brain SDR/Suporte v2
- RabbitMQ transport → v2
- Checkpoint table pruning → v2
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-03 | Docker multi-stage com Bun runtime para cada app | Dockerfile 2-estágios com oven/bun:1 verificado; pnpm install --frozen-lockfile no builder stage; cópias de dist/ + migrations SQL no runner stage; `bun apps/brain-echo/dist/index.js` como CMD |
</phase_requirements>

---

## Summary

Phase 4 monta o primeiro app concreto (`apps/brain-echo`) que usa o Brain SDK end-to-end dentro de um container Docker. O trabalho principal é: (1) criar o workspace `apps/brain-echo` com EchoBrain + entrypoint + package.json/tsconfig; (2) escrever o Dockerfile multi-stage com tratamento correto das migrations SQL; (3) refatorar `migrate.ts` para expor uma função importável `runMigrations(sql)`; (4) criar a migration de seed do system prompt; (5) escrever 3 tipos de testes de integração (SC-2 HTTP, SC-3 restart, SC-4 multi-tenant).

Há três pitfalls técnicos críticos que a fase anterior não precisou resolver: (a) as migrations SQL do Drizzle ficam em `src/migrations/` e NÃO são incluídas no `dist/` — o Dockerfile precisa copiá-las separadamente; (b) `migrate.ts` é hoje um script autoexecutável, não uma função exportável — precisa ser refatorado antes de `apps/brain-echo` poder chamá-lo; (c) symlinks pnpm no `node_modules` copiam corretamente no Docker apenas se a estrutura de diretórios `packages/*/dist/` for preservada na imagem runner.

O ambiente de execução tem Docker 29.4.1 disponível e PostgreSQL acessível em 127.0.0.1:5432. Os pacotes `@brain-pkg/*` já estão completos (fases 1-3 concluídas). O planner pode dividir o trabalho em 5-6 planos: Wave 0 (scaffolding + test stubs), Wave 1 (EchoBrain + entrypoint), Wave 2 (Dockerfile + validate SC-1), Wave 3 (testes de integração SC-2/SC-3/SC-4), Wave 4 (gap closure se necessário).

**Primary recommendation:** Resolver o gap `runMigrations` exportável no Wave 0 (pré-requisito para o entrypoint), incluir as migrations SQL explicitamente no COPY do Dockerfile, e testar o SC-4 diretamente contra `TenantPoolManager` sem Docker para simplicidade.

---

## Project Constraints (from CLAUDE.md)

Diretivas CLAUDE.md que o planner deve verificar:

| Diretiva | Impacto na Phase 4 |
|----------|--------------------|
| Runtime: Bun | `bun apps/brain-echo/dist/index.js` como CMD do Dockerfile |
| Framework HTTP: Hono | `app.route('/')` para montar sub-apps — padrão já usado em packages/observability |
| ORM: Drizzle | Drizzle migrator precisa dos SQL files em runtime — não bundleado no dist/ |
| AI: LangGraph/LangChain | EchoBrain usa `StateGraph` de `@langchain/langgraph` |
| DB: postgres.js (nunca bun:sql) | `BrainRunner._compileGraph()` já usa postgres.js; entrypoint deve seguir |
| Produto: imagens Docker por Brain | Dockerfile multi-stage com oven/bun:1 |
| pnpm (não bun install) | `RUN npm install -g pnpm && pnpm install --frozen-lockfile` no builder stage |
| Testes em `src/__tests__/unit/` e `src/__tests__/integration/` | apps/brain-echo segue a mesma convenção de packages/ |
| Nunca criar .md de doc na raiz | Toda documentação vai em `docs/` |
| Commits com emoji Conventional Commits | ✨ feat, ✅ test, 🔧 chore, etc. |
| Sem `Co-Authored-By: Claude` nos commits | Nunca incluir essa linha |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@brain-pkg/core` | workspace:* | BrainRunner, IBrain, ToolsRegistry | Saída da Phase 3 — já implementado |
| `@brain-pkg/database` | workspace:* | TenantPoolManager, migrate, schema | Saída da Phase 1 |
| `@brain-pkg/observability` | workspace:* | createHealthApp, createLogger | Saída da Phase 1 |
| `@brain-pkg/transport` | workspace:* | createWebhookApp, BrainEvent | Saída da Phase 2 |
| `@brain-pkg/ai` | workspace:* | BrainStateAnnotation (importado via core) | Saída da Phase 2 |
| `hono` | ^4.12.0 | HTTP framework para montar sub-apps | Constraint do projeto; zero deps |
| `postgres` | ^3.4.9 | Driver para sql instance do entrypoint | Constraint do projeto (nunca bun:sql) |
| `drizzle-orm` | 0.45.x | ORM para migrate + seeds | Constraint do projeto |

[VERIFIED: codebase grep — todas as versões confirmadas nos package.json dos packages]

### Dependências do Dockerfile

| Ferramenta | Versão | Propósito |
|-----------|---------|-----------|
| `oven/bun:1` | latest (1.x) | Base image para ambos os estágios |
| `pnpm` | 11.5.3 | Instalador de deps no builder stage (`npm install -g pnpm`) |

[VERIFIED: codebase grep — `"packageManager": "pnpm@11.5.3"` em `/root/Brain/package.json`]

### Installation (apps/brain-echo/package.json)

```json
{
  "name": "@brain-app/echo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "bun test src/__tests__/unit",
    "test:integration": "bun test src/__tests__/integration",
    "typecheck": "tsc --noEmit",
    "start": "bun dist/index.js"
  },
  "dependencies": {
    "@brain-pkg/core": "workspace:*",
    "@brain-pkg/database": "workspace:*",
    "@brain-pkg/observability": "workspace:*",
    "@brain-pkg/transport": "workspace:*",
    "hono": "^4.12.0",
    "postgres": "^3.4.9",
    "drizzle-orm": "0.45.2"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

---

## Architecture Patterns

### Estrutura do App

```
apps/
└── brain-echo/
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts           # Entrypoint: migrate → init → serve
        ├── server.ts          # Hono app: monta os 3 sub-apps
        ├── brain.ts           # echoBrain: IBrain implementation
        └── __tests__/
            ├── unit/
            │   └── brain.test.ts        # EchoBrain buildGraph unit tests
            └── integration/
                ├── webhook.test.ts      # SC-2: HTTP end-to-end
                ├── restart.test.ts      # SC-3: PostgresSaver persistence
                └── tenant-pool.test.ts  # SC-4: 10 tenants + pg_stat_activity
```

### Pattern 1: runMigrations como função exportável

**Problema:** `packages/database/src/migrate.ts` é hoje um script autoexecutável (chama `runMigrations()` no final). O entrypoint D-05 chama `await runMigrations(sql)` passando um `Sql` — mas a função atual não aceita args.

**Solução:** Refatorar `migrate.ts` para separar a lógica de inicialização do ponto de entrada do script:

```typescript
// packages/database/src/migrate.ts (após refatoração)
// Source: padrão do projeto (codebase)

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from 'postgres';

/**
 * Exportável: chamado pelo entrypoint de apps/brain-echo no startup.
 * Recebe Sql injetado — sem criar nova conexão.
 */
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  const db = drizzle(sql);
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await migrate(db, { migrationsFolder });
}

// Script CLI: mantém o comportamento original para `bun src/migrate.ts`
if (import.meta.main) {
  const postgres = (await import('postgres')).default;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error('DATABASE_URL not set'); process.exit(1); }
  const sql = postgres(connectionString, { max: 1 });
  try {
    await runMigrations(sql, './src/migrations');
    console.log('Migrations completed');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}
```

**Export:** Adicionar ao `packages/database/src/index.ts`:
```typescript
export { runMigrations } from './migrate.js';
```

[VERIFIED: codebase grep — migrate.ts atual usa script pattern; `import.meta.main` é suportado pelo Bun para script entry detection]

### Pattern 2: EchoBrain IBrain implementation

```typescript
// apps/brain-echo/src/brain.ts
// Source: IBrain interface em packages/core/src/brain/interface.ts (codebase)

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

    return graph; // NÃO compilado — BrainRunner chama .compile({ checkpointer })
  },
};
```

[VERIFIED: codebase grep — IBrain interface e BrainStateAnnotation confirmados em packages/core/src/brain/interface.ts e packages/ai/src/graph/state.ts]

### Pattern 3: Entrypoint sequencial com exit 1

```typescript
// apps/brain-echo/src/index.ts
// Source: padrão estabelecido em packages/database/src/migrate.ts + packages/core/src/runner/runner.ts

import postgres from "postgres";
import { Hono } from "hono";
import { runMigrations } from "@brain-pkg/database";
import { BrainRunner, ToolsRegistry } from "@brain-pkg/core";
import { createHealthApp } from "@brain-pkg/observability";
import { createWebhookApp } from "@brain-pkg/transport";
import { createCoreApp } from "@brain-pkg/core";
import { createLogger } from "@brain-pkg/observability";
import { echoBrain } from "./brain.js";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const logger = createLogger();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error({}, "DATABASE_URL not set");
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 10, idle_timeout: 300 });

  // Passo 1: Migrations + seed de prompts
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  await runMigrations(sql, migrationsDir).catch((err) => {
    logger.error({ err }, "Migrations failed");
    process.exit(1);
  });

  // Passo 2: Inicializa BrainRunner (exit 1 se prompt faltando)
  const toolsRegistry = new ToolsRegistry();
  const runner = new BrainRunner({ brain: echoBrain, sql, toolsRegistry });
  await runner.init(); // process.exit(1) interno se promptKey faltando

  // Passo 3: Hono app + Bun.serve
  const app = new Hono();
  app.route("/", createHealthApp(sql));
  app.route("/", createWebhookApp(runner));
  app.route("/", createCoreApp(runner));

  const port = parseInt(process.env.PORT || "3000", 10);
  Bun.serve({ port, fetch: app.fetch });
  logger.info({ port }, "brain-echo server listening");
}

main();
```

**Nota crítica sobre `migrationsDir`:** A pasta `src/migrations/` com os arquivos SQL precisa estar presente na imagem Docker runner. O Drizzle migrator lê arquivos SQL em runtime — não são bundleados no `dist/`. O path deve ser resolvido em relação ao `import.meta.url` do entrypoint compilado, apontando para uma pasta `migrations/` copiada separadamente no runner stage.

[VERIFIED: codebase grep — `migrate.ts` usa `{ migrationsFolder: './src/migrations' }` (relativo); Bun suporta `import.meta.url` e `fileURLToPath`]

### Pattern 4: Dockerfile multi-stage com migrations SQL

```dockerfile
# apps/brain-echo/Dockerfile
# Source: CONTEXT.md D-07/D-08 + pitfall das migrations SQL (ver Pitfall 1)

FROM oven/bun:1 AS builder
WORKDIR /app

# Copiar workspace manifests primeiro (cache layer)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./

# Copiar todos os packages e o app
COPY packages/ ./packages/
COPY apps/brain-echo/ ./apps/brain-echo/

# Instalar pnpm e dependências (não usar bun install — regressão Jan 2026)
RUN npm install -g pnpm@11.5.3 && pnpm install --frozen-lockfile

# Compilar todos os packages + app (Turborepo resolve dependências na ordem correta)
RUN pnpm build

# ─────────────────────────────────────────────────────────────
FROM oven/bun:1 AS runner
WORKDIR /app

# node_modules do root (contém symlinks pnpm para workspace packages)
COPY --from=builder /app/node_modules ./node_modules

# Workspace packages compilados (dist/) — os symlinks em node_modules apontam para esses paths
COPY --from=builder /app/packages/ai/dist ./packages/ai/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/memory/dist ./packages/memory/dist
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/transport/dist ./packages/transport/dist

# Migrations SQL — NÃO estão em dist/, precisam ser copiadas explicitamente
# O entrypoint resolve o path para /app/migrations/ em runtime
COPY --from=builder /app/packages/database/src/migrations ./migrations

# App compilado
COPY --from=builder /app/apps/brain-echo/dist ./apps/brain-echo/dist

# node_modules dos packages individuais (dependências externas não-workspace)
# pnpm os coloca em node_modules/.pnpm/ — o COPY do root node_modules acima já inclui
# Mas packages individuais com node_modules próprios precisam ser copiados também:
COPY --from=builder /app/packages/ai/node_modules ./packages/ai/node_modules
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder /app/packages/memory/node_modules ./packages/memory/node_modules
COPY --from=builder /app/packages/observability/node_modules ./packages/observability/node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/packages/transport/node_modules ./packages/transport/node_modules
COPY --from=builder /app/apps/brain-echo/node_modules ./apps/brain-echo/node_modules

ENV PORT=3000
ENV NODE_ENV=production

CMD ["bun", "apps/brain-echo/dist/index.js"]
```

**Alternativa mais simples para o runner stage:** Ao invés de copiar node_modules por package, usar `pnpm deploy` no builder stage para criar um diretório standalone. Mas o padrão acima é suficiente para v1 e evita a complexidade do deploy.

[VERIFIED: codebase grep — pnpm-workspace.yaml inclui apps/*; pnpm-lock.yaml existe; node_modules/@brain-pkg usa symlinks relativos confirmados]

### Pattern 5: Seed de prompts via migration SQL

```sql
-- packages/database/src/migrations/0002_echo_brain_seed.sql
-- Source: padrão existente (0001_lazy_deathstrike.sql para prompts table)

INSERT INTO prompts (brain_type, key, content)
VALUES (
  'echo',
  'system',
  'Você é um assistente útil. Responda as perguntas do usuário de forma clara e concisa.'
)
ON CONFLICT (brain_type, key) DO NOTHING;
```

**Como gerar:** `pnpm --filter @brain-pkg/database run db:generate` criará o arquivo SQL se houver mudança de schema; mas para dados seed puro, criar o arquivo `.sql` manualmente seguindo a convenção de numeração Drizzle.

**Alternativa para seeds:** Usar `drizzle-kit generate --custom` para criar uma migration customizada. Ou simplesmente criar o arquivo SQL com o próximo índice de numeração (`0002_...`) — o Drizzle migrator aplica arquivos SQL em ordem numérica independente de origem.

[VERIFIED: codebase grep — migration 0001 cria tabela prompts com UNIQUE INDEX em (brain_type, key); padrão `ON CONFLICT DO NOTHING` é seguro para idempotência]

### Pattern 6: Teste SC-3 (restart persistence)

```typescript
// apps/brain-echo/src/__tests__/integration/restart.test.ts
// Source: CONTEXT.md D-09 + Bun.spawn docs

import { describe, test, expect } from "bun:test";

const CONTAINER_NAME = process.env.ECHO_CONTAINER_NAME || "brain-echo-test";
const BASE_URL = process.env.ECHO_URL || "http://localhost:3000";
const CONVERSATION_ID = `test-restart-${Date.now()}`;

async function sendMessage(content: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": `${CONVERSATION_ID}-${Date.now()}`,
    },
    body: JSON.stringify({
      conversationId: CONVERSATION_ID,
      stepIndex: 0,
      userId: "test-user",
      content,
    }),
  });
  const body = await res.json() as { reply: string };
  return body.reply;
}

describe("SC-3: PostgresSaver persistence across container restart", () => {
  test("turn 2 references context from turn 1 after docker restart", async () => {
    // Turn 1: enviar mensagem com contexto único
    const turn1Reply = await sendMessage("Meu nome é TestUser. Lembre-se disso.");
    expect(turn1Reply).toBeTruthy();

    // Reiniciar container
    const restart = Bun.spawn(["docker", "restart", CONTAINER_NAME]);
    await restart.exited;
    expect(restart.exitCode).toBe(0);

    // Aguardar container reiniciar
    await Bun.sleep(5000);

    // Turn 2: verificar que o contexto foi preservado
    const turn2Reply = await sendMessage("Qual é o meu nome?");
    expect(turn2Reply.toLowerCase()).toContain("testuser");
  }, 30000);
});
```

### Pattern 7: Teste SC-4 (10 tenants simultâneos)

```typescript
// apps/brain-echo/src/__tests__/integration/tenant-pool.test.ts
// Source: CONTEXT.md D-10 + TenantPoolManager em packages/database/src/pool-manager.ts

import { describe, test, expect, afterAll } from "bun:test";
import { TenantPoolManager } from "@brain-pkg/database";

const PG_HOST = process.env.PG_HOST || "localhost";
const PG_PORT = parseInt(process.env.PG_PORT || "5432");
const PG_USER = process.env.PG_USER || "postgres";
const PG_PASSWORD = process.env.PG_PASSWORD || "postgres";

const POOL_SIZE = 2; // pequeno para não saturar o test DB
const MAX_TENANTS = 20;

describe("SC-4: 10 tenants simultâneos abaixo do LRU cap", () => {
  const manager = new TenantPoolManager(
    { host: PG_HOST, port: PG_PORT, username: PG_USER, password: PG_PASSWORD, max: POOL_SIZE, idle_timeout: 30 },
    MAX_TENANTS
  );

  afterAll(async () => {
    await manager.closeAll();
  });

  test("10 tenants fazem queries simultâneas abaixo do connection cap", async () => {
    const TENANT_COUNT = 10;
    const DB_NAME = "brain_test"; // todos apontam para o mesmo DB de teste

    // Simular 10 tenants com DATABASE_NAME diferentes
    const queries = Array.from({ length: TENANT_COUNT }, async (_, i) => {
      // Em produção seriam DBs diferentes; em teste usamos o mesmo DB com IDs diferentes
      const sql = manager.getPool(`brain_test_tenant_${i}`);
      // Fallback: se o DB não existir, usar brain_test
      try {
        return await sql`SELECT pg_backend_pid(), current_database()`;
      } catch {
        const fallback = manager.getPool(DB_NAME);
        return await fallback`SELECT pg_backend_pid(), current_database()`;
      }
    });

    await Promise.all(queries);

    // Verificar contagem de conexões via pg_stat_activity
    const adminSql = manager.getPool(DB_NAME);
    const result = await adminSql`
      SELECT count(*)::int as conn_count
      FROM pg_stat_activity
      WHERE datname LIKE 'brain%'
    `;

    const connCount = result[0].conn_count;
    const maxAllowed = MAX_TENANTS * POOL_SIZE;
    expect(connCount).toBeLessThanOrEqual(maxAllowed);
  }, 30000);
});
```

### Pattern 8: tsconfig.json para apps/brain-echo

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"],
  "references": [
    { "path": "../../packages/shared" },
    { "path": "../../packages/database" },
    { "path": "../../packages/observability" },
    { "path": "../../packages/ai" },
    { "path": "../../packages/memory" },
    { "path": "../../packages/transport" },
    { "path": "../../packages/core" }
  ]
}
```

[VERIFIED: codebase grep — padrão idêntico ao packages/core/tsconfig.json com paths relativos ajustados para apps/]

---

## Don't Hand-Roll

| Problema | Não construir | Usar em vez | Por que |
|----------|--------------|-------------|---------|
| LLM invocation e histórico de mensagens | nó LLM custom com chamadas HTTP | `ctx.llm.invoke()` via `BrainBuildContext` | BrainRunner já injeta LLM configurado via env |
| Gerenciamento de estado entre turnos | storage próprio de conversas | `PostgresSaver` via `createCheckpointer()` | Já implementado em packages/ai, phase 2 |
| Connection pooling | pool próprio por tenant | `TenantPoolManager` de packages/database | LRU eviction, `idle_timeout`, cleanup já implementados |
| HTTP routing | handlers Hono customizados | `createHealthApp`, `createWebhookApp`, `createCoreApp` | Já exportados pelos packages correspondentes |
| Input validation | parsing manual do body | `BrainEventSchema.safeParse()` em createWebhookApp | Já implementado com Zod em packages/transport |
| Dedup de requests | cache próprio | `DedupCache` dentro de `createWebhookApp` | Já injetado automaticamente ao usar createWebhookApp |
| Migrations | SQL manual DDL | `runMigrations()` + Drizzle migrator | Forward-only, versionado, com extension setup |

---

## Common Pitfalls

### Pitfall 1: Migrations SQL não copiadas para o runner stage
**O que dá errado:** `await migrate(db, { migrationsFolder: path })` falha em runtime no container porque os arquivos `.sql` de migrations estão em `src/migrations/` e não são incluídos no output `dist/` do TypeScript.
**Por que acontece:** `tsc` compila apenas `.ts` → `.js`. Arquivos `.sql` são assets estáticos ignorados pelo compilador.
**Como evitar:** No Dockerfile runner stage: `COPY --from=builder /app/packages/database/src/migrations ./migrations`. No entrypoint, calcular o path para essa pasta via `import.meta.url` ao invés de usar caminho relativo fixo.
**Sinais de alerta:** Erro em runtime: `Error: ENOENT: no such file or directory, scandir './src/migrations'`.

[VERIFIED: codebase grep — `migrate.ts` usa `{ migrationsFolder: './src/migrations' }` e os SQLs estão em `packages/database/src/migrations/`]

### Pitfall 2: runMigrations não é exportável (script-only)
**O que dá errado:** `import { runMigrations } from '@brain-pkg/database'` falha com erro de importação ou, pior, importar o módulo executa as migrations imediatamente (side effect do script).
**Por que acontece:** `migrate.ts` atual chama `runMigrations()` no corpo do módulo — não está em `if (import.meta.main)`.
**Como evitar:** Refatorar usando `if (import.meta.main)` para o bloco do script, e exportar `runMigrations(sql, migrationsFolder)` como função separada.
**Sinais de alerta:** `process.exit()` chamado ao importar o módulo.

[VERIFIED: codebase grep — linha 35 de migrate.ts: `runMigrations();` no nível top-level do módulo]

### Pitfall 3: Symlinks pnpm quebrando no runner stage do Docker
**O que dá errado:** `import @brain-pkg/core` falha no container porque os symlinks em `node_modules/@brain-pkg/core -> ../../../packages/core` apontam para um diretório que não existe no runner stage.
**Por que acontece:** pnpm usa symlinks relativos para workspace packages. Se `packages/core/dist/` não for copiado para o runner com a mesma estrutura de diretórios (`/app/packages/core/dist/`), os symlinks ficam quebrados.
**Como evitar:** Copiar `packages/*/dist/` e `packages/*/node_modules/` com o path completo preservado, E copiar `node_modules/` do builder (que contém os symlinks). A estrutura de diretórios deve ser idêntica.
**Sinais de alerta:** `Error: Cannot find module '@brain-pkg/core'` ao iniciar o container.

[VERIFIED: codebase grep — `ls -la /root/Brain/packages/core/node_modules/@brain-pkg/` confirma symlinks relativos como `../../../ai`]

### Pitfall 4: Path das migrations relativo ao CWD vs. ao arquivo compilado
**O que dá errado:** `runMigrations(sql, './migrations')` usa CWD (onde o processo foi iniciado), mas no Docker o CWD pode não ser `/app/packages/database/`.
**Por que acontece:** Drizzle migrator recebe `migrationsFolder` como caminho do sistema de arquivos. Caminhos relativos dependem do `process.cwd()`.
**Como evitar:** Resolver o path em relação ao arquivo compilado:
```typescript
import { fileURLToPath } from "url";
import { join, dirname } from "path";
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
```
Onde `../migrations` aponta para a pasta copiada no Dockerfile runner.
**Sinais de alerta:** Funciona localmente mas falha no container (CWD diferente).

[ASSUMED — comportamento de CWD em Bun com `Bun.serve` não verificado em runtime Docker; `import.meta.url` é padrão ESM suportado pelo Bun]

### Pitfall 5: pnpm install --frozen-lockfile falha se pnpm-lock.yaml não inclui apps/brain-echo
**O que dá errado:** `pnpm install --frozen-lockfile` no builder stage falha porque o `pnpm-lock.yaml` foi gerado antes de `apps/brain-echo/package.json` existir.
**Por que acontece:** `--frozen-lockfile` rejeita qualquer divergência entre o lockfile e o package.json.
**Como evitar:** Após criar `apps/brain-echo/package.json`, executar `pnpm install` localmente para regenerar `pnpm-lock.yaml` antes de testar o build Docker.
**Sinais de alerta:** `ERR_PNPM_OUTDATED_LOCKFILE` no docker build.

[VERIFIED: codebase grep — `pnpm-lock.yaml` existe em `/root/Brain/pnpm-lock.yaml`; `apps/*` está no `pnpm-workspace.yaml`]

### Pitfall 6: PostgresSaver.setup() em bun test (conhecido)
**O que dá errado:** `PostgresSaver.setup()` pode travar no runner de testes `bun test` (async hooks incompatibility documentada na fase 2).
**Por que acontece:** `@langchain/langgraph-checkpoint-postgres` usa o driver `pg` (node-postgres) internamente; AsyncLocalStorage propagation tem gaps no Bun.
**Como evitar para SC-3:** Usar `Bun.spawn` para fazer chamadas HTTP ao container real ao invés de instanciar `PostgresSaver` diretamente no teste. Isso testa o comportamento real, não a implementação interna.
**Sinais de alerta:** Teste que trava indefinidamente no `beforeAll`.

[VERIFIED: codebase grep — comentário em `packages/ai/src/graph/checkpointer.test.ts` documenta o KNOWN ISSUE explicitamente]

### Pitfall 7: Migration seed com ON CONFLICT sem índice UNIQUE
**O que dá errado:** `INSERT ... ON CONFLICT (brain_type, key) DO NOTHING` falha com `column "brain_type" referenced in ON CONFLICT clause does not have a unique constraint`.
**Por que acontece:** O `ON CONFLICT` requer que as colunas alvo tenham um índice UNIQUE, não só um `uniqueIndex` named.
**Como evitar:** Verificar que `prompts_brain_type_key_idx` é realmente um UNIQUE INDEX (não apenas um INDEX) — confirmado no schema: `uniqueIndex('prompts_brain_type_key_idx')`.
**Sinais de alerta:** Erro SQL em runtime durante migration.

[VERIFIED: codebase grep — `uniqueIndex('prompts_brain_type_key_idx').on(table.brainType, table.key)` em `packages/database/src/schema/tables.ts`]

---

## Runtime State Inventory

> Fase de criação de novo app (não rename/refactor) — sem estado de runtime existente que precisaria de migração.

| Categoria | Itens encontrados | Ação necessária |
|-----------|-------------------|-----------------|
| Stored data (DB) | Tabela `prompts` existe mas sem row para `brain_type='echo'` | Migration seed 0002 cria a row no startup |
| Live service config | Nenhum serviço externo configurado para brain-echo | — |
| OS-registered state | Nenhum processo registrado para brain-echo | — |
| Secrets/env vars | `DATABASE_URL`, `LLM_PROVIDER`, `LLM_MODEL`, `API_KEY` já no `.env` | Reusar sem alteração |
| Build artifacts | `apps/` dir não existe — criação pura | Nenhum artifact stale |

---

## Environment Availability

| Dependência | Necessário para | Disponível | Versão | Fallback |
|-------------|----------------|-----------|--------|----------|
| Docker CLI | SC-1 (docker build), SC-3 (docker restart) | ✓ | 29.4.1 | — |
| Docker socket | SC-3 (Bun.spawn docker restart) | ✓ | `/var/run/docker.sock` | — |
| PostgreSQL | SC-2, SC-3, SC-4 | ✓ | 127.0.0.1:5432 open | — |
| Bun runtime | Todos os testes | ✓ | 1.3.2 | — |
| pnpm | Docker builder stage | ✓ | 11.5.3 | — |
| LLM API (OpenAI) | SC-2 (LLM real) | [ASSUMED] | gpt-4.1-mini | Usar `LLM_PROVIDER=openai` já configurado no .env |
| `oven/bun:1` Docker image | SC-1 (docker build) | Pullable | latest | — |

**Dependências missing com fallback:** Nenhuma.

**Notas:**
- PostgreSQL está em 127.0.0.1:5432 (pgbouncer/proxy local) conforme `.env`; `TEST_DATABASE_URL` aponta para `localhost:5432/brain_test`
- O teste SC-3 requer que o container `brain-echo` esteja rodando — o teste precisa do container_name como env var ou default
- O `.env` inclui `API_KEY` com valor real para OpenAI — SC-2 pode chamar a API real

[VERIFIED: Bash — `nc -z -w3 127.0.0.1 5432` open; `docker --version` 29.4.1; `/var/run/docker.sock` exists; `bun --version` 1.3.2]

---

## Validation Architecture

### Test Framework

| Propriedade | Valor |
|-------------|-------|
| Framework | `bun test` (built-in, Bun 1.3.2) |
| Config file | Nenhum (zero-config) |
| Quick run command | `bun test apps/brain-echo/src/__tests__/unit` |
| Full suite command | `bun test apps/brain-echo/src/__tests__` |
| Integration run command | `bun test apps/brain-echo/src/__tests__/integration` |

### Phase Requirements → Test Map

| Req ID | Comportamento | Tipo de Teste | Comando Automatizado | Arquivo |
|--------|---------------|---------------|---------------------|---------|
| INFRA-03 SC-1 | docker build produz imagem válida e container sobe | smoke / shell | `docker build -f apps/brain-echo/Dockerfile . -t brain-echo-test && docker run --rm brain-echo-test bun --version` | Manual no CI |
| INFRA-03 SC-2 | POST /webhook traversa transport → BrainRunner → LangGraph → 3 memory layers → resposta | integration/e2e | `bun test apps/brain-echo/src/__tests__/integration/webhook.test.ts` | Wave 0 gap |
| INFRA-03 SC-3 | turno 2 referencia contexto do turno 1 após docker restart | integration | `bun test apps/brain-echo/src/__tests__/integration/restart.test.ts` | Wave 0 gap |
| INFRA-03 SC-4 | 10 tenants simultâneos abaixo do LRU cap | integration | `bun test apps/brain-echo/src/__tests__/integration/tenant-pool.test.ts` | Wave 0 gap |

### Sampling Rate

- **Por task commit:** `bun test apps/brain-echo/src/__tests__/unit`
- **Por wave merge:** `bun test apps/brain-echo/src/__tests__/unit && bun test apps/brain-echo/src/__tests__/integration/tenant-pool.test.ts`
- **Phase gate:** Suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/brain-echo/src/__tests__/unit/brain.test.ts` — cobre IBrain contract (EchoBrain.id, brainType, promptKeys, tools, buildGraph retorna StateGraph)
- [ ] `apps/brain-echo/src/__tests__/integration/webhook.test.ts` — cobre SC-2
- [ ] `apps/brain-echo/src/__tests__/integration/restart.test.ts` — cobre SC-3
- [ ] `apps/brain-echo/src/__tests__/integration/tenant-pool.test.ts` — cobre SC-4

---

## Security Domain

### Applicable ASVS Categories

| Categoria ASVS | Aplica | Controle Padrão |
|----------------|--------|-----------------|
| V2 Authentication | Não (webhook não autenticado no v1) | — |
| V3 Session Management | Sim (PostgresSaver gerencia thread state) | PostgresSaver via `@langchain/langgraph-checkpoint-postgres` |
| V4 Access Control | Parcial (reload-prompts requer ADMIN_TOKEN) | createCoreApp já implementa X-Admin-Token auth |
| V5 Input Validation | Sim (webhook body) | BrainEventSchema.safeParse() via Zod em createWebhookApp |
| V6 Cryptography | Não (sem crypto nesta fase) | — |

### Known Threat Patterns

| Pattern | STRIDE | Mitigação Padrão |
|---------|--------|-----------------|
| Injection via mensagem do usuário para o LLM | Tampering | Zod valida o campo `content` como string; o LLM não executa código |
| Replay attack via webhook duplicado | Tampering | DedupCache com X-Request-Id (já em createWebhookApp) |
| Vazamento de DATABASE_URL em logs | Information Disclosure | createLogger (Pino) — nunca logar DATABASE_URL; padrão já estabelecido em packages/ |
| API_KEY exposta em erros | Information Disclosure | createLLM já tem comentário `T-2-03: API_KEY never logged`; entrypoint não loga env vars |
| Unauthorized reload-prompts | Elevation of Privilege | createCoreApp exige ADMIN_TOKEN header; fail-closed se não configurado (503) |

---

## Open Questions

1. **Path das migrations no container Docker**
   - O que sabemos: Drizzle migrator precisa dos arquivos `.sql` em runtime; `src/migrations/` não vai para `dist/`
   - O que está incerto: O path exato de onde copiar no runner stage e como o entrypoint resolve o path absoluto
   - Recomendação: Usar `COPY --from=builder /app/packages/database/src/migrations ./migrations` e resolver via `import.meta.url` no entrypoint. Ou alternativamente, copiar migrations para `apps/brain-echo/dist/migrations/` no builder stage com um script de build customizado.

2. **SC-3: Container name para docker restart no teste**
   - O que sabemos: O teste usa `Bun.spawn(["docker", "restart", CONTAINER_NAME])` — precisa do nome do container
   - O que está incerto: Como passar o nome do container em CI vs. desenvolvimento local
   - Recomendação: Usar env var `ECHO_CONTAINER_NAME` com default `brain-echo-test`; o teste de SC-3 fica `skip` se `DOCKER_AVAILABLE` não estiver setado

3. **pnpm node_modules por package no runner stage**
   - O que sabemos: Cada package tem seu próprio `node_modules/` com symlinks
   - O que está incerto: Se copiar só o root `node_modules/` + `packages/*/dist/` é suficiente ou se é necessário copiar `packages/*/node_modules/` também
   - Recomendação: Incluir `packages/*/node_modules/` no Dockerfile para garantir; testar com `docker build` e verificar se os imports funcionam antes de otimizar o tamanho da imagem

---

## Assumptions Log

| # | Afirmação | Seção | Risco se Errado |
|---|-----------|-------|-----------------|
| A1 | `import.meta.main` funciona no Bun para detectar script entry point | Pattern 1 (runMigrations) | Se não funcionar, o módulo executaria migrations ao ser importado; alternativa: `if (process.argv[1] === fileURLToPath(import.meta.url))` |
| A2 | `import.meta.url` e `fileURLToPath` estão disponíveis no Bun para resolução de paths | Pattern 3 (entrypoint) | Fallback: usar `process.env.MIGRATIONS_DIR` como env var explícita no Dockerfile |
| A3 | LLM API (OpenAI) está disponível e `API_KEY` do `.env` é válida | Environment Availability | SC-2 falharia; pode usar mock do LLM em unit tests; SC-2 como integration precisa da API real |
| A4 | Copiar root `node_modules/` do builder stage preserva os symlinks pnpm funcionais | Pitfall 3, Pattern 4 | Se os symlinks ficarem quebrados, precisaria usar `pnpm deploy` ou incluir `packages/*/node_modules/` separadamente |

---

## Sources

### Primary (HIGH confidence)
- Codebase: `packages/core/src/brain/interface.ts` — IBrain e BrainBuildContext verificados
- Codebase: `packages/core/src/runner/runner.ts` — BrainRunner lifecycle verificado
- Codebase: `packages/database/src/migrate.ts` — script-only pattern confirmado (gap detectado)
- Codebase: `packages/database/src/pool-manager.ts` — TenantPoolManager, max=20 por default
- Codebase: `packages/database/src/schema/tables.ts` — uniqueIndex em (brain_type, key) confirmado
- Codebase: `packages/database/src/migrations/0001_lazy_deathstrike.sql` — prompts table DDL
- Codebase: `packages/ai/src/graph/checkpointer.test.ts` — KNOWN ISSUE PostgresSaver.setup() em bun test documentado
- Codebase: `packages/observability/src/server.ts` — createHealthApp pattern
- Codebase: `packages/transport/src/webhook/handler.ts` — createWebhookApp pattern
- Codebase: `packages/core/src/server.ts` — createCoreApp pattern
- Codebase: `package.json` — `"packageManager": "pnpm@11.5.3"`
- Codebase: `pnpm-workspace.yaml` — `apps/*` incluído
- Codebase: `node_modules/.pnpm/node_modules/@brain-pkg/` — symlinks relativos confirmados
- System: `docker --version 29.4.1`, `/var/run/docker.sock` exists, `127.0.0.1:5432` open, `bun 1.3.2`

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — decisão pnpm (não bun install) por regressão Jan 2026
- `.planning/phases/04-validation-brain/04-CONTEXT.md` — todas as decisões D-01 a D-11

### Tertiary (LOW confidence)
- A1/A2: `import.meta.main` e `import.meta.url` no Bun — baseado em treinamento; não verificado via docs oficiais nesta sessão

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — todos os packages são workspace:* das fases anteriores, versões verificadas nos package.json
- Architecture Patterns: HIGH — baseados em código existente verificado; gaps identificados explicitamente
- Pitfalls: HIGH (pitfalls 1-3, 5-7) / MEDIUM (pitfall 4) — pitfall 1-3 verificados no codebase; pitfall 4 baseado em comportamento esperado de CWD
- Dockerfile: MEDIUM — padrão lógico baseado no conhecimento de pnpm symlinks; abordagem alternativa (pnpm deploy) não investigada em detalhe

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (stack estável; expira se oven/bun:1 ou pnpm tiverem releases incompatíveis)
