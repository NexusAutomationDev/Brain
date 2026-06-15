# Phase 11: Tool Contracts SDK - Research

**Researched:** 2026-06-15
**Domain:** LangGraph tool contracts, ToolsRegistry ENV whitelist, LeadService extensions, BrainBuildContext injection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `BrainBuildContext` ganha campo `sql?: Sql` — opcional para não quebrar brain-echo e outros Brains que não usam tools de DB.
- **D-02:** O `buildGraph()` do Brain recebe `ctx.sql` e é responsável por criar as tools "bound" com acesso ao banco, seguindo o mesmo padrão de `boundQualifyTool` (closure sobre `ctx.prompts` no Brain SDR).
- **D-03:** `BrainRunner._compileGraph()` já tem `this.sql` — passa para `BrainBuildContext` como `sql: this.sql`.
- **D-04:** Tools leem o `thread_id` do `RunnableConfig` recebido como segundo argumento — padrão LangChain: `tool(async (args, config) => { const threadId = config?.configurable?.thread_id; ... })`.
- **D-05:** `thread_id` = `lead.uniqueId` (IDLead canonical), conforme estabelecido pelo BrainRunner. A tool usa esse valor como `unique_id` na query ao banco — sem risco de alucinação do LLM.
- **D-06:** Tools **não** recebem `lead_id` como parâmetro do LLM — o schema das tools não inclui identificador de lead.
- **D-07:** `ToolsRegistry.enableTool()` lê `process.env.BRAIN_TOOLS` no momento da chamada. Se `BRAIN_TOOLS` está definido e a tool **não** está na lista, ignora silenciosamente sem lançar erro.
- **D-08:** Se `BRAIN_TOOLS` está **ausente**, `enableTool()` funciona exatamente como antes — zero impacto em brain-echo e brain-sdr existentes (TOOLS-ENV-02).
- **D-09:** `BRAIN_TOOLS` é uma whitelist CSV: ex. `BRAIN_TOOLS=pause_session,finish_conversation`. Parse: `process.env.BRAIN_TOOLS?.split(",").map(s => s.trim())`.
- **D-10:** Fase 11 **apenas disponibiliza** as tools no SDK. Fase 12 é responsável por habilitar `pause_session` e `finish_conversation` no Brain SDR via `enableTool()` (TOOLS-STD-03 é req da Fase 12).
- **D-11:** O formato de export das tools (instâncias prontas vs factories) fica a critério do planejador — desde que `pause_session` e `finish_conversation` estejam em `packages/core/tools` e funcionem com `ctx.sql` via `BrainBuildContext`.

### Claude's Discretion

- Formato de export das standard tools: instâncias StructuredTool vs factories `createPauseSessionTool(sql)` — planejador decide o que melhor se encaixa com o padrão LangChain/BrainBuildContext.
- Localização dos arquivos de tool: `packages/core/src/tools/pause-session.ts`, `finish-conversation.ts` (ou similar).
- Métodos adicionais no `LeadService` para `setFullpp()` e `setIaAtivada()` — planejador define a API.
- Mensagem de retorno das tools quando bem-sucedidas (string de status para o LLM).

### Deferred Ideas (OUT OF SCOPE)

- `BRAIN_TOOLS_DISABLED` (lista de exclusão / blacklist) — decidido que whitelist (`BRAIN_TOOLS`) é suficiente para v1.2.
- Auto-registration de standard tools para todos os brainTypes — opt-in explícito (enableTool()) preferido.
- BrainRunner auto-registrando tools via BRAIN_TOOLS no init() — responsabilidade mantida no Brain/Fase 12.
- Métodos `LeadService.setFullpp()` e `LeadService.setIaAtivada()` com retry/circuit breaker — overshooting para v1.2.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TOOLS-ENV-01 | O SDK suporta `BRAIN_TOOLS` como whitelist de tools habilitadas em runtime | `ToolsRegistry.enableTool()` é o único ponto de entrada — adicionar guard ENV ali |
| TOOLS-ENV-02 | Quando `BRAIN_TOOLS` está ausente, comportamento padrão do `enableTool()` é mantido sem alteração | Guard só ativa se `process.env.BRAIN_TOOLS` está definido; `undefined` = bypass |
| TOOLS-STD-01 | Tool `pause_session` disponível para todos os Brains — altera `leads.fullpp` para `false` | LeadService precisa de método `setFullpp(uniqueId, value)` + tool wrapper com `ctx.sql` |
| TOOLS-STD-02 | Tool `finish_conversation` disponível para todos os Brains — altera `leads.ia_ativada` e `leads.fullpp` para `false` | LeadService precisa de método `setIaAtivada(uniqueId, value)` + tool wrapper combinando ambas as alterações |
</phase_requirements>

---

## Summary

A Fase 11 tem escopo preciso e bem delimitado: (1) adicionar campo `sql?: Sql` ao `BrainBuildContext`, (2) passar `this.sql` ao contexto no `BrainRunner._compileGraph()`, (3) adicionar guard ENV na `ToolsRegistry.enableTool()`, (4) criar dois métodos no `LeadService` (`setFullpp` e `setIaAtivada`), (5) criar dois arquivos de tool em `packages/core/src/tools/` usando o padrão factory/closure, e (6) exportar tudo pelo barrel `packages/core/src/index.ts`.

O padrão de implementação é idêntico ao `boundQualifyTool` do Brain SDR: factory function que recebe `sql: Sql` e retorna uma `StructuredTool` via `tool()` do `@langchain/core/tools`, com closure sobre o `sql` para acesso ao banco. O `thread_id` é extraído do `RunnableConfig` (segundo argumento da tool) para identificar o lead — sem parâmetro de identificador no schema da tool.

Não há quebra de backward compatibility: `BrainBuildContext.sql` é opcional, `BRAIN_TOOLS` ausente = sem filtro, e brain-echo/brain-sdr existentes não chamam as novas tools.

**Primary recommendation:** Factory functions `createPauseSessionTool(sql: Sql)` e `createFinishConversationTool(sql: Sql)` — alinha com o padrão `boundQualifyTool`, não exige instância global do DB, e permite múltiplos tenants.

---

## Project Constraints (from CLAUDE.md)

- **Runtime:** Bun — usar `bun test` (não Vitest/Jest)
- **ORM:** Drizzle com `postgres.js` — usar `drizzle-orm/postgres-js` e tipo `Sql` de `postgres`
- **Testes:** Arquivos de teste em `__tests__/unit/` ou `__tests__/integration/` dentro do pacote, nunca ao lado do código de produção
- **Exports:** Barrel `packages/core/src/index.ts` usa exports nomeados explícitos — sem `export *`
- **Commits:** Conventional Commits com emoji conforme tabela no CLAUDE.md
- **Docs:** Documentação técnica em `docs/`; planejamento em `.planning/` — não criar `.md` avulsos na raiz

---

## Standard Stack

### Core (já na base — apenas usar)

| Library | Versão Atual | Propósito | Status |
|---------|-------------|-----------|--------|
| `@langchain/core/tools` | peer via `@langchain/langgraph` | `tool()` helper para criar StructuredTool com closure | Já instalado — `brain.ts` importa diretamente |
| `drizzle-orm` | 0.45.x | ORM para updates Drizzle no LeadService | Já instalado em `packages/core` |
| `postgres` (postgres.js) | current | Driver Sql para LeadService e tools | Já instalado — tipo `Sql` já usado no LeadService |
| `zod` | v4 via LangGraph | Schema de args da tool (pode ser `z.object({})` — tool sem args do LLM) | Já instalado |
| `@brain-pkg/shared` | workspace | `ConfigurationError` disponível | Já disponível |
| `@brain-pkg/database` | workspace | `leads` table schema para Drizzle queries | Já disponível — usado no LeadService atual |

[VERIFIED: codebase grep — todos os imports acima já existem no projeto]

### Padrão `tool()` do LangChain

```typescript
// Fonte: apps/brain-sdr/src/brain.ts (padrão estabelecido no projeto)
import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";

const myTool = tool(
  async (args: {}, config?: RunnableConfig) => {
    const threadId = config?.configurable?.thread_id as string | undefined;
    // ... lógica com threadId
    return "Status: operação concluída";
  },
  {
    name: "tool_name",
    description: "Descrição para o LLM",
    schema: z.object({}), // sem args de LLM para tools de controle de sessão
  }
);
```

[VERIFIED: codebase — padrão `tool(async (args, config) => {...}, { name, description, schema })` confirmado em `apps/brain-sdr/src/brain.ts` e `apps/brain-sdr/src/qualifier.ts`]

---

## Architecture Patterns

### Estrutura de Arquivos Alvo

```
packages/core/src/
├── brain/
│   └── interface.ts          # BrainBuildContext ganha sql?: Sql  [MODIFICAR]
├── tools/
│   ├── registry.ts           # enableTool() ganha guard BRAIN_TOOLS  [MODIFICAR]
│   ├── pause-session.ts      # NOVO — createPauseSessionTool(sql)
│   ├── finish-conversation.ts # NOVO — createFinishConversationTool(sql)
│   └── __tests__/
│       ├── tools-registry.test.ts    # Adicionar testes BRAIN_TOOLS  [MODIFICAR]
│       ├── pause-session.test.ts     # NOVO
│       └── finish-conversation.test.ts # NOVO
├── leads/
│   ├── lead-service.ts       # setFullpp() + setIaAtivada() NOVOS  [MODIFICAR]
│   └── __tests__/
│       └── lead-service.test.ts      # Adicionar testes novos métodos  [MODIFICAR]
├── runner/
│   └── runner.ts             # _compileGraph() passa sql: this.sql ao ctx  [MODIFICAR]
└── index.ts                  # Exportar createPauseSessionTool, createFinishConversationTool  [MODIFICAR]
```

### Pattern 1: Factory Function para Standard Tools

**O que é:** `createPauseSessionTool(sql: Sql): StructuredTool` — factory que captura `sql` via closure e retorna tool configurada.

**Por que factory, não instância global:**
- O `sql` vem de `BrainBuildContext.sql` — injetado no `buildGraph()` do Brain, não disponível em módulo global
- Segue exatamente o padrão `boundQualifyTool`: `tool(async (args, config) => {...}, { name, description, schema })` com closure sobre dependências externas
- Múltiplos tenants no futuro: cada instância do Brain tem seu próprio `sql`

**Quando usar:** Sempre que a tool precisa de acesso a um recurso externo injetado (DB, HTTP client, etc.)

```typescript
// Source: Padrão estabelecido em apps/brain-sdr/src/brain.ts (D-04)
// packages/core/src/tools/pause-session.ts

import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { leads } from "@brain-pkg/database";
import type { Sql } from "postgres";
import { z } from "zod";

export function createPauseSessionTool(sql: Sql) {
  const db = drizzle(sql);
  return tool(
    async (_args: Record<string, never>, config?: RunnableConfig) => {
      // D-04: thread_id = lead.uniqueId (canonical), set pelo BrainRunner no invoke()
      const threadId = config?.configurable?.thread_id as string | undefined;
      if (!threadId) {
        return "Erro: thread_id não disponível na configuração";
      }
      await db.update(leads)
        .set({ fullpp: false, updatedAt: new Date() })
        .where(eq(leads.uniqueId, threadId));
      return "Sessão pausada com sucesso — atendimento humano ativado";
    },
    {
      name: "pause_session",
      description: "Pausa a sessão atual e transfere para atendimento humano. Use quando o usuário pede para falar com um humano ou quando a conversa requer intervenção manual.",
      schema: z.object({}),
    }
  );
}
```

[VERIFIED: codebase — padrão closure/factory confirmado no brain.ts; `eq`, `drizzle`, `leads` import confirmados no lead-service.ts; `leads.fullpp` confirmado em tables.ts]

### Pattern 2: Guard ENV em `enableTool()`

**O que é:** Verificação de whitelist CSV no momento de `enableTool()` — se `BRAIN_TOOLS` está definido e a tool não está na lista, a chamada é silenciosamente ignorada.

**Ponto de inserção:** Início do método `enableTool()`, antes de qualquer mutação do registry.

```typescript
// packages/core/src/tools/registry.ts — modificação em enableTool()
// D-07: Whitelist ENV — ignorar silenciosamente se tool não está na lista
// D-08: BRAIN_TOOLS ausente = sem filtro = comportamento atual inalterado
enableTool(brainType: string, toolName: string): void {
  // D-09: Parse CSV — process.env.BRAIN_TOOLS?.split(",").map(s => s.trim())
  const envWhitelist = process.env.BRAIN_TOOLS?.split(",").map((s) => s.trim());
  if (envWhitelist !== undefined && !envWhitelist.includes(toolName)) {
    return; // D-07: silently ignored — sem log, sem erro
  }
  if (!this.registry.has(brainType)) {
    this.registry.set(brainType, new Set());
  }
  this.registry.get(brainType)!.add(toolName);
}
```

[VERIFIED: codebase — `process.env.CONTEXT_WINDOW_MESSAGES` em brain.ts usa padrão ENV parsing idêntico; registry.ts lido diretamente]

### Pattern 3: Novos Métodos no LeadService

**O que é:** `setFullpp(uniqueId: string, value: boolean): Promise<void>` e `setIaAtivada(uniqueId: string, value: boolean): Promise<void>` — métodos que fazem UPDATE por `unique_id`.

**Coluna de lookup:** `leads.uniqueId` (campo `unique_id` no banco) — este é o `thread_id` passado pelo BrainRunner. A tabela `leads` NÃO tem índice explícito em `uniqueId` (apenas em `numero`), mas o campo `unique_id` é `NOT NULL` e o volume por tenant é baixo o suficiente para scan sem índice ser aceitável em v1.2.

```typescript
// packages/core/src/leads/lead-service.ts — novos métodos

async setFullpp(uniqueId: string, value: boolean): Promise<void> {
  await this.db
    .update(leads)
    .set({ fullpp: value, updatedAt: new Date() })
    .where(eq(leads.uniqueId, uniqueId));
}

async setIaAtivada(uniqueId: string, value: boolean): Promise<void> {
  await this.db
    .update(leads)
    .set({ iaAtivada: value, updatedAt: new Date() })
    .where(eq(leads.uniqueId, uniqueId));
}
```

[VERIFIED: codebase — `leads.iaAtivada` e `leads.fullpp` confirmados em tables.ts; `leads.uniqueId` é coluna `unique_id` TEXT NOT NULL; padrão `drizzle.update().set().where(eq())` confirmado no lead-service.ts existente]

### Pattern 4: Modificação do BrainBuildContext

**O que é:** Adicionar `sql?: Sql` ao interface `BrainBuildContext` em `packages/core/src/brain/interface.ts` — opcional para não quebrar brain-echo.

**Ponto de passagem:** `BrainRunner._compileGraph()` já tem `this.sql` — basta adicionar `sql: this.sql` ao objeto `ctx`.

**Uso no Brain:** O `buildGraph()` do Brain recebe `ctx.sql` e passa para as factories das standard tools:

```typescript
// Exemplo de uso no Brain (Fase 12 — referência apenas)
const pauseTool = createPauseSessionTool(ctx.sql!);
const finishTool = createFinishConversationTool(ctx.sql!);
```

[VERIFIED: codebase — runner.ts linha 283-287 confirma montagem do `ctx`; interface.ts lido diretamente]

### Anti-Patterns a Evitar

- **Parâmetro `lead_id` no schema da tool:** D-06 proíbe — o schema da tool não inclui identificador de lead. Usar `thread_id` do `RunnableConfig` é mais seguro (sem alucinação do LLM).
- **Tool com dependência de módulo global:** Não criar instância de `drizzle(sql)` fora da factory — quebraria multi-tenant futuro.
- **`enableTool()` lançando erro quando BRAIN_TOOLS filtra:** D-07 exige silêncio. Nenhum `throw`, `console.warn`, ou logger call.
- **Instância de tool sem sql:** Não exportar `pauseSessionTool` como instância pronta (semelhante a `qualifyLeadTool`) — essa tool precisa de `sql` para funcionar. Exportar apenas a factory.
- **`setIaAtivada` e `setFullpp` chamados separadamente em `finish_conversation`:** Fazer em uma única chamada `.set({ iaAtivada: false, fullpp: false })` para atomicidade.

---

## Don't Hand-Roll

| Problema | Não Construir | Usar em Vez | Razão |
|---------|---------------|-------------|-------|
| Tool calling com args + config | Custom dispatch | `tool()` de `@langchain/core/tools` | Padrão LangChain — garante compatibilidade com ToolNode e LangGraph |
| DB update em tool | SQL raw string | Drizzle ORM `update().set().where()` | Já no stack; type-safe; padrão do projeto |
| Parse de ENV CSV | `split + filter` customizado | `process.env.BRAIN_TOOLS?.split(",").map(s => s.trim())` | Idioma já usado em `CONTEXT_WINDOW_MESSAGES` no brain.ts |
| Identificação do lead na tool | Parâmetro de LLM | `config?.configurable?.thread_id` | D-04/D-05 — padrão LangChain, sem risco de alucinação |

---

## Common Pitfalls

### Pitfall 1: `finish_conversation` fazendo dois updates separados

**O que dá errado:** Duas chamadas `.update()` separadas — se a segunda falha, `ia_ativada` fica `false` mas `fullpp` não é atualizado (inconsistência).

**Por que acontece:** Tentar reaproveitar `setFullpp()` + `setIaAtivada()` do LeadService dentro da tool.

**Como evitar:** A tool `finish_conversation` faz um único UPDATE: `.set({ iaAtivada: false, fullpp: false, updatedAt: new Date() })` — atomicidade garantida. Os métodos do LeadService são usados para outros contextos; a tool não os chama.

**Sinais de alerta:** Ver dois `await db.update(leads)` dentro da mesma tool.

### Pitfall 2: `thread_id` não disponível no `RunnableConfig`

**O que dá errado:** `config?.configurable?.thread_id` retorna `undefined` — update usa `undefined` como `where`, afetando todos os leads (ou nenhum).

**Por que acontece:** Teste unitário da tool não passa `config` corretamente, ou contexto de invocação do LangGraph não inclui `thread_id`.

**Como evitar:** Guard explícito: `if (!threadId) return "Erro: thread_id não disponível"`. Em testes, sempre passar `{ configurable: { thread_id: "test-lead-id" } }` como segundo argumento da tool.

**Sinais de alerta:** Update sem `where` clause; ausência de guard no início da tool.

### Pitfall 3: `BrainBuildContext.sql` não-opcional quebrando brain-echo

**O que dá errado:** Adicionar `sql: Sql` (não-opcional) ao `BrainBuildContext` — brain-echo não tem sql nem usa tools de DB, falha na compilação TypeScript.

**Por que acontece:** Esquecer que brain-echo é um Brain de validação sem DB tools.

**Como evitar:** D-01 — campo DEVE ser `sql?: Sql` (opcional). brain-echo nunca recebe `sql` e nunca chama `createPauseSessionTool`.

**Sinais de alerta:** `tsc` falhando em `apps/brain-echo/src/`.

### Pitfall 4: Exportar instância de tool sem sql no barrel

**O que dá errado:** `export { pauseSessionTool }` (instância) — tool tenta usar `sql` que é `undefined` em runtime.

**Por que acontece:** Seguir o padrão de `qualifyLeadTool` que é uma instância (serve apenas como contrato de schema, não executa DB calls).

**Como evitar:** Exportar `createPauseSessionTool` e `createFinishConversationTool` (factories). O Brain chama `createPauseSessionTool(ctx.sql!)` dentro do `buildGraph()`.

**Sinais de alerta:** Export de `pauseSessionTool` como `StructuredTool` diretamente no `index.ts`.

### Pitfall 5: Lógica BRAIN_TOOLS em `getTools()` em vez de `enableTool()`

**O que dá errado:** Filtrar no momento de `getTools()` — o registry ficaria populado com tools que nunca deveriam entrar, e o comportamento seria confuso (tool no registry mas filtrada na saída).

**Por que acontece:** `getTools()` é onde a filtragem final acontece — tentação de adicionar o filtro ENV ali.

**Como evitar:** D-07 é explícito: o guard fica em `enableTool()`. O registry só contém o que realmente foi permitido.

**Sinais de alerta:** Lógica `BRAIN_TOOLS` em `getTools()` ao invés de `enableTool()`.

### Pitfall 6: Testes de ToolsRegistry quebrando por leitura de `process.env`

**O que dá errado:** Testes existentes de `ToolsRegistry` passam a falhar porque `enableTool()` lê `process.env.BRAIN_TOOLS` — e o ambiente de teste pode tê-lo definido de um teste anterior.

**Por que acontece:** `process.env` é global — testes sem isolamento de ENV contaminam uns aos outros.

**Como evitar:** Nos novos testes de BRAIN_TOOLS, usar `beforeEach`/`afterEach` para setar e limpar `process.env.BRAIN_TOOLS`. Garantir que testes existentes rodem com `BRAIN_TOOLS` não definido (verificar se o CI exporta essa variável).

**Sinais de alerta:** Testes de registry falhando intermitentemente dependendo da ordem de execução.

---

## Code Examples

### Modificação de `BrainBuildContext` (interface.ts)

```typescript
// Source: packages/core/src/brain/interface.ts — MODIFICAR
import type { Sql } from "postgres";

export interface BrainBuildContext {
  llm: BaseChatModel;
  prompts: Record<string, string>;
  tools: StructuredTool[];
  /** D-01: sql opcional — injetado pelo BrainRunner para tools de DB. Brains sem DB tools ignoram. */
  sql?: Sql;
}
```

### Modificação de `_compileGraph()` (runner.ts)

```typescript
// Source: packages/core/src/runner/runner.ts — linha ~283
// ANTES:
const ctx: BrainBuildContext = {
  llm,
  prompts: this.prompts,
  tools: filteredTools,
};

// DEPOIS (D-03):
const ctx: BrainBuildContext = {
  llm,
  prompts: this.prompts,
  tools: filteredTools,
  sql: this.sql,  // D-03: passa sql para tools de DB via buildGraph()
};
```

### Modificação de `enableTool()` (registry.ts)

```typescript
// Source: packages/core/src/tools/registry.ts — MODIFICAR
enableTool(brainType: string, toolName: string): void {
  // D-07/D-08/D-09: BRAIN_TOOLS whitelist — ausente = sem filtro
  const envWhitelist = process.env.BRAIN_TOOLS
    ?.split(",")
    .map((s) => s.trim());
  if (envWhitelist !== undefined && !envWhitelist.includes(toolName)) {
    return; // silently ignored (D-07)
  }
  if (!this.registry.has(brainType)) {
    this.registry.set(brainType, new Set());
  }
  this.registry.get(brainType)!.add(toolName);
}
```

### `finish_conversation` — update atômico

```typescript
// packages/core/src/tools/finish-conversation.ts
export function createFinishConversationTool(sql: Sql) {
  const db = drizzle(sql);
  return tool(
    async (_args: Record<string, never>, config?: RunnableConfig) => {
      const threadId = config?.configurable?.thread_id as string | undefined;
      if (!threadId) {
        return "Erro: thread_id não disponível na configuração";
      }
      // TOOLS-STD-02: ia_ativada=false E fullpp=false em um único UPDATE (atomicidade)
      await db.update(leads)
        .set({ iaAtivada: false, fullpp: false, updatedAt: new Date() })
        .where(eq(leads.uniqueId, threadId));
      return "Conversa encerrada — IA desativada para este lead";
    },
    {
      name: "finish_conversation",
      description: "Encerra definitivamente a conversa automatizada. Use quando o usuário solicita explicitamente encerrar o atendimento ou quando a conversa está concluída.",
      schema: z.object({}),
    }
  );
}
```

### Pattern de teste para tool com `RunnableConfig`

```typescript
// packages/core/src/tools/__tests__/pause-session.test.ts
import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock drizzle e leads ANTES do import
const mockUpdate = mock(() => ({ set: mockSet }));
const mockSet = mock(() => ({ where: mockWhere }));
const mockWhere = mock(async () => []);
const mockDb = { update: mockUpdate };

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => mockDb),
}));
mock.module("drizzle-orm", () => ({
  eq: mock((col: unknown, val: unknown) => ({ col, val })),
}));
mock.module("@brain-pkg/database", () => ({
  leads: { uniqueId: "leads.unique_id", fullpp: "leads.fullpp", updatedAt: "leads.updated_at" },
}));

import { createPauseSessionTool } from "../pause-session.js";

describe("createPauseSessionTool (TOOLS-STD-01)", () => {
  test("invoca update com fullpp=false quando thread_id está no config", async () => {
    const tool = createPauseSessionTool({} as never);
    const result = await tool.invoke(
      {},
      { configurable: { thread_id: "lead-abc" } }
    );
    expect(result).toContain("pausada");
    expect(mockUpdate).toHaveBeenCalled();
  });

  test("retorna erro quando thread_id ausente no config", async () => {
    const tool = createPauseSessionTool({} as never);
    const result = await tool.invoke({}, {});
    expect(result).toContain("thread_id não disponível");
  });
});
```

### Barrel export (`index.ts`)

```typescript
// packages/core/src/index.ts — adicionar ao final
// SDK-07: Standard Tools — factories para tools de controle de sessão
export { createPauseSessionTool } from "./tools/pause-session.js";
export { createFinishConversationTool } from "./tools/finish-conversation.js";
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in Bun 1.x) |
| Config file | Nenhum — `bun test` usa padrão de descoberta |
| Quick run command | `bun test packages/core/src/tools/__tests__/` |
| Full suite command | `bun test packages/core/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Arquivo Existe? |
|--------|----------|-----------|-------------------|----------------|
| TOOLS-ENV-01 | `enableTool()` filtra tool não listada em `BRAIN_TOOLS` | unit | `bun test packages/core/src/tools/__tests__/tools-registry.test.ts` | Parcial — arquivo existe, novos casos a adicionar |
| TOOLS-ENV-02 | `enableTool()` sem `BRAIN_TOOLS` = comportamento atual | unit | `bun test packages/core/src/tools/__tests__/tools-registry.test.ts` | Parcial — arquivo existe, verificar que casos existentes passam |
| TOOLS-STD-01 | `pause_session` invocada: `leads.fullpp=false` via `thread_id` | unit | `bun test packages/core/src/tools/__tests__/pause-session.test.ts` | Nao — Wave 0 |
| TOOLS-STD-02 | `finish_conversation` invocada: `leads.ia_ativada=false` e `leads.fullpp=false` | unit | `bun test packages/core/src/tools/__tests__/finish-conversation.test.ts` | Nao — Wave 0 |

### Sampling Rate

- **Por task commit:** `bun test packages/core/src/tools/__tests__/`
- **Por wave merge:** `bun test packages/core/`
- **Phase gate:** `bun test packages/core/` verde antes de `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/tools/__tests__/pause-session.test.ts` — cobre TOOLS-STD-01
- [ ] `packages/core/src/tools/__tests__/finish-conversation.test.ts` — cobre TOOLS-STD-02
- [ ] Casos adicionais em `tools-registry.test.ts` — cobre TOOLS-ENV-01 e TOOLS-ENV-02
- [ ] Casos adicionais em `lead-service.test.ts` — cobre `setFullpp()` e `setIaAtivada()`

---

## Runtime State Inventory

> Fase de adição de código novo — sem rename/refactor. Esta seção é incluída brevemente para confirmação.

| Categoria | Itens Encontrados | Ação Necessária |
|-----------|------------------|-----------------|
| Stored data | `leads.fullpp` nullable em banco existente — `finish_conversation` escreverá `false` neste campo | Nenhuma migração necessária — coluna já existe como `boolean nullable` |
| Live service config | brain-echo e brain-sdr em execução NÃO usam `BRAIN_TOOLS` — ENV ausente = comportamento inalterado | Nenhuma — D-08 garante backward compatibility |
| OS-registered state | Nenhum — phase code-only | Nenhuma |
| Secrets/env vars | `BRAIN_TOOLS` é variável nova (opcional) — não há conflito com variáveis existentes | Nenhuma — ausência = sem filtro |
| Build artifacts | `packages/core/dist/` precisa ser reconstruído após modificações | `bun run build` em `packages/core` |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `bun test` | Testes unitários | Verificado — runtime do projeto | Bun 1.x | Nenhum — é o runner padrão |
| `@langchain/core/tools` | `tool()` helper | Verificado — já importado em brain.ts | peer de langgraph | Nenhum — já instalado |
| `drizzle-orm/postgres-js` | Queries nas tools | Verificado — já usado no LeadService | 0.45.x | Nenhum — já instalado |
| `postgres` (postgres.js) | Tipo `Sql` | Verificado — já usado em runner.ts e lead-service.ts | current | Nenhum — já instalado |
| `@brain-pkg/database` (`leads`) | Schema Drizzle nas tools | Verificado — já importado no lead-service.ts | workspace | Nenhum |

Nenhuma dependência nova — toda a fase usa bibliotecas já presentes no projeto.

---

## Open Questions

1. **Mensagem de retorno das tools para o LLM**
   - O que sabemos: As tools devem retornar string (padrão `tool()` do LangChain)
   - O que está em aberto: Texto exato (Claude's Discretion — planejador decide)
   - Recomendação: Strings curtas e descritivas em pt-BR: `"Sessão pausada com sucesso"` / `"Conversa encerrada — IA desativada"`. O LLM usa esse retorno para confirmar a ação ao usuário.

2. **`uniqueId` não tem índice explícito na tabela leads**
   - O que sabemos: `leads.numero` tem `uniqueIndex`; `leads.uniqueId` é `NOT NULL` mas sem índice (confirmado em tables.ts linha 96-99)
   - O que está em aberto: Performance é aceitável para v1.2? (Volume baixo por tenant)
   - Recomendação: Para v1.2 volume, seq scan em `unique_id` é aceitável. Criar índice seria uma melhoria de v1.3 — **não está no escopo desta fase**.

3. **`invoke()` vs chamada direta da tool em testes**
   - O que sabemos: O LangGraph invoca tools via `ToolNode` internamente; em testes unitários chamamos `tool.invoke(args, config)` diretamente
   - O que está em aberto: `tool.invoke()` recebe `config` como segundo argumento ou deve ser encapsulado?
   - Recomendação: `tool.invoke(args, config)` é o padrão LangChain para chamada direta — confirmado pelo padrão do brain-sdr onde `boundQualifyTool` é invocado via `ToolNode` em produção.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `tool.invoke(args, config)` passa `config` corretamente para o segundo argumento do handler | Code Examples (testes) | Testes unitários poderiam passar mas tools falhariam em produção — baixo risco dado padrão LangChain estabelecido |
| A2 | `unique_id` sem índice tem performance aceitável para volume v1.2 | Open Questions | Lento em produção com muitos leads — mitigado pelo escopo por tenant |
| A3 | `createPauseSessionTool` chamada dentro de `buildGraph()` após Fase 12 — não testado em integração nesta fase | Architecture Patterns | Integração incorreta na Fase 12 — detectado na Fase 12 pelos seus próprios testes |

**Claims verificados (sem necessidade de confirmação do usuário):** Todos os outros claims foram verificados via leitura direta do codebase.

---

## Sources

### Primary (HIGH confidence)

- `packages/core/src/tools/registry.ts` — código atual de `enableTool()`, `getTools()`, padrão interno
- `packages/core/src/brain/interface.ts` — `BrainBuildContext` atual sem campo `sql`
- `packages/core/src/leads/lead-service.ts` — padrão Drizzle update, tipo `Sql`
- `packages/core/src/runner/runner.ts` — `_compileGraph()` com `this.sql`, montagem do `ctx`
- `packages/database/src/schema/tables.ts` — schema `leads`: `fullpp boolean nullable`, `iaAtivada boolean NOT NULL default true`, `uniqueId text NOT NULL`
- `apps/brain-sdr/src/brain.ts` — padrão `boundQualifyTool` (closure factory), `tool()` import, `CONTEXT_WINDOW_MESSAGES` ENV parse
- `packages/core/src/index.ts` — barrel de exports atual
- `packages/core/src/tools/__tests__/tools-registry.test.ts` — padrão de teste atual do ToolsRegistry

### Secondary (MEDIUM confidence)

- Padrão `RunnableConfig` / `config?.configurable?.thread_id` — inferido do padrão LangChain documentado em CONTEXT.md D-04 e confirmado pela forma como BrainRunner passa `thread_id` em `runner.ts` linha ~204

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — tudo já está instalado e em uso no projeto
- Architecture: HIGH — padrões verificados diretamente no codebase existente
- Pitfalls: HIGH — derivados de análise do código real e das decisões do CONTEXT.md

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stack estável — sem dependências externas novas)
