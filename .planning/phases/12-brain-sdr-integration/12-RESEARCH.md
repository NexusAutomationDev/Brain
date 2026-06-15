# Phase 12: Brain SDR Integration — Research

**Researched:** 2026-06-15
**Domain:** Brain SDR — migração para Output Parser v1.2 + Standard Tools (pause_session, finish_conversation)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** O handler do webhook (`packages/transport/src/webhook/handler.ts`) deve ser atualizado para retornar o `BrainOutput` completo ao caller: `{ status: 'ok', fullResponse, responseMode, mediaType?, mediaUrl? }`.

**D-02:** O campo `reply` atual é **removido** da resposta — não é backward-compat shim; o downstream deve usar `fullResponse` diretamente.

**D-03:** RabbitMQ **não publica de volta** — apenas consume. O Success Criterion 1 ("RabbitMQ entrega JSON") é satisfeito porque `BrainRunner.run()` retorna `BrainOutput | null` internamente. Publicação de resposta via RabbitMQ permanece Out of Scope.

**D-04:** `createPauseSessionTool(ctx.sql)` e `createFinishConversationTool(ctx.sql)` são criadas **dentro de `buildGraph()`** com closure sobre `ctx.sql` — mesmo padrão do `boundQualifyTool` com closure sobre `ctx.prompts`.

**D-05:** `sdrBrain.tools[]` **não recebe stubs** das standard tools — permanece `[qualifyLeadTool]`. O campo `tools[]` é informativo para o ToolsRegistry; as standard tools operam via bound direto no ToolNode.

**D-06:** `enableTool("sdr", "pause_session")` e `enableTool("sdr", "finish_conversation")` são chamados em `apps/brain-sdr/src/index.ts` — serve para registrar os nomes no registry (evitar `ConfigurationError`).

**D-07:** O `ToolNode` no `buildGraph()` passa a receber `[boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool]` — 3 tools.

**D-08:** `llmWithTools = ctx.llm.bindTools([boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool])` — o LLM tem acesso às 3 tools.

**D-09:** O nó `llm` do `buildGraph()` do brain-sdr é atualizado para setar `state.brainOutput` após `llmWithTools.invoke()` — mesmo padrão do brain-echo:
```ts
const fullResponse = typeof response.content === "string" ? response.content : "";
return {
  messages: [response],
  brainOutput: { fullResponse, responseMode: "text" as const },
};
```

**D-10:** O reducer `last-write-wins` do `BrainStateAnnotation` garante que o `brainOutput` final é sempre o da última execução do nó `llm`. Nenhum tratamento especial para intermediários com `tool_calls`.

**D-11:** Os prompts do Brain SDR no banco **não são alterados** nesta fase. Zero mudanças em seeds ou migrations de prompts.

**D-12:** Apenas **unit tests** atualizados — sem integração com DB real nesta fase.

**D-13:** `brain.test.ts` é atualizado para verificar:
  - `sdrBrain.tools` ainda tem 1 tool (`qualifyLeadTool`) — `tools[]` não muda
  - `buildGraph(ctx)` com mock de `ctx.sql` cria grafo com 3 tools no ToolNode
  - O nó `llm` retorna `brainOutput: { fullResponse, responseMode: 'text' }` no estado

**D-14:** `ctx.sql` nos testes é um mock simples (objeto vazio ou mock de `Sql`) — não precisa de DB real.

**D-15:** `apps/brain-sdr/package.json` recebe `"lint": "tsc --noEmit"` — resolve INFRA-02 e satisfaz Success Criterion 4.

### Claude's Discretion
- Ordem dos bound tools no array passado ao ToolNode e ao `bindTools()` — qualquer ordem é correta
- Mensagem de erro no teste quando `ctx.sql` é undefined/mock — verificar apenas que `buildGraph()` não lança antes da invocação da tool

### Deferred Ideas (OUT OF SCOPE)
- Stubs de `pause_session` / `finish_conversation` em `sdrBrain.tools[]` para filtração via `BRAIN_TOOLS` — decidido manter `tools[]` apenas com `qualifyLeadTool`; filtragem das standard tools via BRAIN_TOOLS é v1.3+
- Testes de integração do POST /api/v1/webhook com DB real — deferido; unit tests com mock são suficientes
- Atualização dos prompts SDR para instruir o LLM explicitamente sobre pause/finish — deferido; tool description é suficiente
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PARSER-03 | Brain SDR migrado para usar o novo Output Parser — retorna `BrainOutput` estruturado em todas as respostas | Padrão verificado em `brain-echo/src/brain.ts`: nó `llm` seta `state.brainOutput = { fullResponse, responseMode: "text" }`. Webhook handler atualizado para retornar campos completos do `BrainOutput` (D-01, D-02). |
| TOOLS-STD-03 | Brain SDR tem `pause_session` e `finish_conversation` habilitadas por padrão | Factories `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` já exportadas em `packages/core/src/index.ts`. Padrão de bound tool com closure sobre `ctx.sql` idêntico ao `boundQualifyTool` com closure sobre `ctx.prompts`. `enableTool()` em `index.ts` registra os nomes no ToolsRegistry (D-06). |
</phase_requirements>

---

## Summary

A Fase 12 é uma **migração de integração** — nenhuma infraestrutura nova é construída. Todo o código de suporte (BrainOutput schema, BrainStateAnnotation com reducer `last-write-wins`, factories `createPauseSessionTool`/`createFinishConversationTool`, exportações em `packages/core/src/index.ts`) foi entregue nas Fases 10 e 11. O trabalho desta fase é conectar esses componentes no Brain SDR.

Os cinco pontos de mudança são: (1) `apps/brain-sdr/src/brain.ts` — nó `llm` seta `brainOutput`, `buildGraph()` cria 2 bound standard tools e as adiciona ao `ToolNode` e `bindTools()`; (2) `apps/brain-sdr/src/index.ts` — 2 chamadas `enableTool()` para `pause_session` e `finish_conversation`; (3) `packages/transport/src/webhook/handler.ts` — resposta muda de `{ reply }` para `{ fullResponse, responseMode, mediaType?, mediaUrl? }`; (4) `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — testes atualizados para 3 tools e verificação do `brainOutput`; (5) `apps/brain-sdr/package.json` — adição do script `"lint": "tsc --noEmit"`.

O maior risco operacional é a **quebra de contrato na resposta do webhook** (remoção do campo `reply`). Downstream que já consome `reply` quebrará. Isso é uma decisão consciente (D-02 — sem backward-compat shim). O teste `handler.test.ts` tem um case explícito verificando `body.reply` que deve ser **atualizado para verificar `body.fullResponse`**.

**Recomendação primária:** Implementar na ordem — `brain.ts` primeiro (lógica central), depois `index.ts` (registro), depois `handler.ts` (contrato de API), depois testes, depois `package.json` (lint). Executar `bun test` após cada arquivo para ciclo de feedback curto.

---

## Standard Stack

### Core (nenhuma instalação nova necessária)
| Componente | Versão atual | Função nesta fase |
|-----------|-------------|-------------------|
| `@brain-pkg/core` | workspace:* | Exporta `createPauseSessionTool`, `createFinishConversationTool`, `BrainOutputSchema` |
| `@langchain/langgraph` | ^1.4.1 | `ToolNode`, `toolsCondition`, `StateGraph` — já em uso no brain-sdr |
| `@langchain/core/tools` | ^1.x (peer) | `tool()` factory — usada no padrão `boundQualifyTool` existente |
| `bun test` | Bun 1.x | Framework de teste nativo — já configurado no projeto |

Todas as dependências já estão em `apps/brain-sdr/package.json`. **Nenhum `bun add` necessário nesta fase.** [VERIFIED: leitura direta de apps/brain-sdr/package.json]

### Script adicionado
```json
// apps/brain-sdr/package.json — adicionar em "scripts":
"lint": "tsc --noEmit"
```
`turbo.json` já tem a task `"lint"` mapeada. A adição do script em `package.json` é suficiente para que `turbo run lint` inclua brain-sdr. [VERIFIED: leitura direta de turbo.json linha 18-21]

---

## Architecture Patterns

### Padrão 1: Bound Tool com Closure (já estabelecido)

O `boundQualifyTool` em `brain.ts` demonstra o padrão completo que as standard tools seguem:

```typescript
// FONTE VERIFICADA: apps/brain-sdr/src/brain.ts (linhas 33-48)
const boundQualifyTool = tool(
  async ({ description, session_id }) => {
    const result = await runQualificationAgent(
      description,
      session_id,
      ctx.prompts["qualification"]  // closure sobre ctx.prompts
    );
    return JSON.stringify(result);
  },
  {
    name: qualifyLeadTool.name,
    description: qualifyLeadTool.description,
    schema: qualifyLeadTool.schema,
  }
);
```

Para as standard tools, o padrão é mais simples — as factories já criam o tool completo:

```typescript
// FONTE VERIFICADA: packages/core/src/tools/pause-session.ts
// packages/core/src/tools/finish-conversation.ts
// Uso em brain.ts:
const boundPauseSessionTool = createPauseSessionTool(ctx.sql!);
const boundFinishConversationTool = createFinishConversationTool(ctx.sql!);
```

### Padrão 2: Nó `llm` com BrainOutput (referência: brain-echo)

```typescript
// FONTE VERIFICADA: apps/brain-echo/src/brain.ts (linhas 33-49)
.addNode("llm", async (state) => {
  const messagesForLLM = state.messages.slice(-contextWindowSize);
  const response = await ctx.llm.invoke([
    { role: "system", content: ctx.prompts["system"] },
    ...messagesForLLM,
  ]);
  const fullResponse =
    typeof response.content === "string" ? response.content : "";
  return {
    messages: [...state.messages, response],
    brainOutput: {
      fullResponse,
      responseMode: "text" as const,
    },
  };
})
```

**Diferença no brain-sdr:** usa `llmWithTools.invoke()` (não `ctx.llm.invoke()`) e retorna `messages: [response]` sem spread do histórico (padrão ReAct existente no brain-sdr). [VERIFIED: brain-sdr/brain.ts linha 73 usa `return { messages: [response] }` sem spread]

### Padrão 3: ToolNode com múltiplas tools

```typescript
// Extensão do padrão existente (brain-sdr/brain.ts linhas 76-77):
// ANTES:
.addNode("tools", new ToolNode([boundQualifyTool]))
// DEPOIS (D-07):
.addNode("tools", new ToolNode([boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool]))
```

### Padrão 4: Handler webhook retornando BrainOutput completo

```typescript
// packages/transport/src/webhook/handler.ts linha 84 — ANTES:
return c.json({ status: "ok", reply: result.fullResponse });

// DEPOIS (D-01, D-02):
return c.json({
  status: "ok",
  fullResponse: result.fullResponse,
  responseMode: result.responseMode,
  ...(result.mediaType && { mediaType: result.mediaType }),
  ...(result.mediaUrl && { mediaUrl: result.mediaUrl }),
});
```

### Estrutura final de arquivos modificados

```
apps/brain-sdr/
├── src/
│   ├── brain.ts                        # MODIFICAR: bound tools, nó llm com brainOutput
│   ├── index.ts                        # MODIFICAR: 2 novos enableTool()
│   └── __tests__/unit/
│       └── brain.test.ts               # MODIFICAR: testes para 3 tools + brainOutput
└── package.json                        # MODIFICAR: adicionar "lint" script

packages/transport/src/webhook/
├── handler.ts                          # MODIFICAR: resposta { fullResponse, responseMode }
└── handler.test.ts                     # MODIFICAR: assertions de body.reply → body.fullResponse
```

### Anti-Patterns a Evitar

- **Adicionar standard tools em `sdrBrain.tools[]`:** `tools[]` é campo estático/informativo para o ToolsRegistry. Standard tools operam via bind direto no `buildGraph()` — não passam pelo ToolsRegistry (D-05).
- **Chamar `.compile()` em `buildGraph()`:** BrainRunner é o responsável. Já documentado nos comentários do arquivo.
- **Usar `ctx.tools` no ToolNode:** `ctx.tools` vem do ToolsRegistry filtrado e conteria apenas `qualifyLeadTool` sem closure. Usar `boundQualifyTool` diretamente (comentário na linha 50 do brain.ts atual).
- **Manter campo `reply` como shim:** D-02 é explícito — remoção total, sem backward-compat.

---

## Don't Hand-Roll

| Problema | Não construir | Usar | Por quê |
|----------|--------------|------|---------|
| Tool que pausa sessão | Implementação ad-hoc no brain-sdr | `createPauseSessionTool(ctx.sql)` de `@brain-pkg/core` | Factory já existe, testada, usa `thread_id` do `RunnableConfig` de forma segura — nunca do LLM |
| Tool que encerra conversa | Implementação ad-hoc no brain-sdr | `createFinishConversationTool(ctx.sql)` de `@brain-pkg/core` | Update atômico `iaAtivada=false AND fullpp=false` já implementado e seguro contra race condition |
| Formatação da resposta do webhook | Campo customizado | Campos diretos do `BrainOutput` (`fullResponse`, `responseMode`) | `IBrainRunnerLike.run()` já retorna o shape completo — nenhum mapeamento manual necessário |

---

## Runtime State Inventory

> Esta fase é uma migração de código — não há rename/rebrand de strings em runtime.

| Categoria | Itens encontrados | Ação necessária |
|-----------|------------------|-----------------|
| Stored data | Nenhum — prompts não são alterados (D-11); leads.ia_ativada e leads.fullpp existentes não são afetados pela criação das tools | Nenhuma |
| Live service config | Nenhum — nenhuma config de serviço externo referencia nomes das tools | Nenhuma |
| OS-registered state | Nenhum | Nenhuma |
| Secrets/env vars | Nenhum — nenhuma ENV nova; `ctx.sql` vem do mesmo `TenantPoolManager` já configurado | Nenhuma |
| Build artifacts | `apps/brain-sdr/dist/` — `tsc` recompila após modificações de src | Recompilação automática via `turbo run build` |

---

## Common Pitfalls

### Pitfall 1: `ctx.sql` pode ser `undefined` — usar `!` com cuidado
**O que vai errado:** `BrainBuildContext.sql` é tipado como `sql?: Sql` (opcional). Chamar `createPauseSessionTool(ctx.sql)` sem verificação passa `undefined` e o TypeScript aceita se não houver strict null checks.
**Por que acontece:** `IBrain.buildGraph()` recebe `BrainBuildContext` onde `sql` é opcional para Brains que não precisam de DB.
**Como evitar:** Usar `ctx.sql!` (non-null assertion) em `brain.ts` — o Brain SDR sempre recebe `sql` injetado pelo `BrainRunner` (verificado em `apps/brain-sdr/src/index.ts` linha 67: `new BrainRunner({ brain: sdrBrain, sql, toolsRegistry })`). O `!` é correto aqui.
**Sinal de alerta:** TypeScript error "Argument of type 'Sql | undefined' is not assignable to parameter of type 'Sql'" — use `ctx.sql!` para resolver.

### Pitfall 2: `handler.test.ts` tem assertion explícita em `body.reply`
**O que vai errado:** O teste na linha 76-77 de `handler.test.ts` verifica `body.reply` e o campo desaparecerá com D-02.
**Por que acontece:** O handler atual retorna `{ status: "ok", reply: result.fullResponse }` e o teste espera esse shape.
**Como evitar:** Atualizar o test case "with runner injected" para verificar `body.fullResponse` em vez de `body.reply`. O test case deve também verificar `body.responseMode`.
**Sinal de alerta:** Falha de teste "expect(received).toBe(expected) — body.reply is undefined" no suite do handler.

### Pitfall 3: `messages` return no nó `llm` — brain-sdr e brain-echo diferem
**O que vai errado:** brain-echo retorna `messages: [...state.messages, response]` (spread), enquanto brain-sdr retorna `messages: [response]`. O reducer de mensagens do `BrainStateAnnotation` é `append`, então ambos funcionam, mas o comportamento é diferente.
**Por que acontece:** brain-sdr usa ReAct (ToolNode → llm loop), onde o histórico completo já está no `state.messages` — retornar apenas `[response]` é correto para que o `append` reducer adicione só a nova mensagem.
**Como evitar:** Manter `messages: [response]` no brain-sdr (NÃO copiar o spread do brain-echo). Copiar apenas o padrão do `brainOutput`.

### Pitfall 4: Teste de `buildGraph()` com 3 tools requer acesso ao ToolNode interno
**O que vai errado:** `ToolNode` não expõe as tools como propriedade pública. Não há `.tools` para inspecionar diretamente no objeto `StateGraph` compilado.
**Por que acontece:** LangGraph encapsula o ToolNode.
**Como evitar:** Verificar que `buildGraph()` não lança exceção (prova que as factories executam sem erro com `ctx.sql` mock). Para verificar as 3 tools no LLM, inspecionar se `llmWithTools` seria chamado com 3 tools via spy em `ctx.llm.bindTools`. Ver D-13 e D-14 do CONTEXT.md.

### Pitfall 5: `turbo run lint` falha se brain-sdr não tiver o script `"lint"`
**O que vai errado:** Turbo tenta rodar o task `lint` em todos os pacotes — se `package.json` do brain-sdr não tiver o script, Turbo reporta erro ou skipa silenciosamente dependendo da configuração.
**Por que acontece:** INFRA-02 — brain-sdr não tinha `"lint"` script.
**Como evitar:** Adicionar `"lint": "tsc --noEmit"` em `apps/brain-sdr/package.json` scripts (D-15). O `turbo.json` já tem a task mapeada.

---

## Code Examples

### Exemplo 1: brain.ts — buildGraph() completo após migração

```typescript
// Fonte: padrão D-04 (boundQualifyTool) + D-07/D-08 (standard tools) + D-09 (brainOutput)
buildGraph(ctx: BrainBuildContext): any {
  const boundQualifyTool = tool(
    async ({ description, session_id }) => {
      const result = await runQualificationAgent(
        description,
        session_id,
        ctx.prompts["qualification"]
      );
      return JSON.stringify(result);
    },
    {
      name: qualifyLeadTool.name,
      description: qualifyLeadTool.description,
      schema: qualifyLeadTool.schema,
    }
  );

  // D-04: bound com closure sobre ctx.sql (injetado pelo BrainRunner — sempre presente)
  const boundPauseSessionTool = createPauseSessionTool(ctx.sql!);
  const boundFinishConversationTool = createFinishConversationTool(ctx.sql!);

  if (!ctx.llm.bindTools) {
    throw new Error("LLM provider não suporta tool calling ...");
  }
  // D-08: LLM recebe as 3 tools
  const llmWithTools = ctx.llm.bindTools([
    boundQualifyTool,
    boundPauseSessionTool,
    boundFinishConversationTool,
  ]);

  const getContextWindow = (): number => {
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
      // D-09: seta brainOutput — mesmo padrão do brain-echo
      const fullResponse =
        typeof response.content === "string" ? response.content : "";
      return {
        messages: [response],  // ATENÇÃO: não spread — ver Pitfall 3
        brainOutput: { fullResponse, responseMode: "text" as const },
      };
    })
    // D-07: ToolNode com 3 tools
    .addNode("tools", new ToolNode([boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool]))
    .addEdge("__start__", "llm")
    .addConditionalEdges("llm", toolsCondition, ["tools", "__end__"])
    .addEdge("tools", "llm");
}
```

### Exemplo 2: index.ts — 2 novos enableTool()

```typescript
// Fonte: CONTEXT.md D-06 + padrão existente em apps/brain-sdr/src/index.ts linha 65
const toolsRegistry = new ToolsRegistry();
toolsRegistry.enableTool("sdr", "qualify_lead");
// D-06: registrar standard tools no ToolsRegistry para evitar ConfigurationError
toolsRegistry.enableTool("sdr", "pause_session");
toolsRegistry.enableTool("sdr", "finish_conversation");
```

### Exemplo 3: handler.ts — resposta webhook atualizada

```typescript
// Fonte: CONTEXT.md D-01, D-02 + handler.ts linha 84 atual
// ANTES: return c.json({ status: "ok", reply: result.fullResponse });
// DEPOIS:
return c.json({
  status: "ok",
  fullResponse: result.fullResponse,
  responseMode: result.responseMode,
  ...(result.mediaType && { mediaType: result.mediaType }),
  ...(result.mediaUrl && { mediaUrl: result.mediaUrl }),
});
```

### Exemplo 4: brain.test.ts — verificação das 3 tools no ToolNode via buildGraph()

```typescript
// Fonte: CONTEXT.md D-13, D-14 + brain.test.ts existente
test("buildGraph(ctx) com ctx.sql mock cria grafo sem lançar exceção", async () => {
  const mod = await import("../../brain.js");
  const ctx = {
    llm: {
      bindTools: mock(() => ({
        invoke: mock(async () => ({ content: "resposta", tool_calls: [] })),
      })),
    },
    prompts: { system: "prompt sistema", qualification: "prompt qualificacao" },
    tools: [],
    sql: {} as any,  // D-14: mock simples — createXTool(sql) aceita qualquer objeto em construção
  };
  const graph = mod.sdrBrain.buildGraph(ctx as any);
  expect(graph).toBeTruthy();
  // Verificar que bindTools foi chamado com 3 tools
  expect(ctx.llm.bindTools).toHaveBeenCalledTimes(1);
  const callArgs = (ctx.llm.bindTools as any).mock.calls[0][0];
  expect(callArgs).toHaveLength(3);
  expect(callArgs.map((t: any) => t.name)).toContain("qualify_lead");
  expect(callArgs.map((t: any) => t.name)).toContain("pause_session");
  expect(callArgs.map((t: any) => t.name)).toContain("finish_conversation");
});
```

### Exemplo 5: handler.test.ts — test case atualizado para novo contrato

```typescript
// Fonte: handler.test.ts linhas 55-78 — atualizar para D-01/D-02
it("POST /api/v1/webhook with runner injected returns 200 { status: 'ok', fullResponse, responseMode }", async () => {
  const mockRunner = {
    run: async (_event: unknown) => ({
      fullResponse: "Olá! Posso te ajudar.",
      responseMode: "text" as const,
    }),
  };
  const appWithRunner = createWebhookApp(mockRunner);
  const req = new Request("http://localhost/api/v1/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TEST_TOKEN}` },
    body: JSON.stringify(validEvent),
  });
  const res = await appWithRunner.fetch(req);
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, unknown>;
  expect(body.status).toBe("ok");
  expect(typeof body.fullResponse).toBe("string");
  expect(body.fullResponse).toBe("Olá! Posso te ajudar.");
  expect(body.responseMode).toBe("text");
  // D-02: campo 'reply' removido — não deve existir
  expect(body.reply).toBeUndefined();
});
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, Bun 1.x) |
| Config file | Nenhum — `bun test` não requer config |
| Quick run command | `bun test apps/brain-sdr/src/__tests__/unit` |
| Full suite command | `bun test` (todos os workspaces) |

### Phase Requirements → Test Map

| Req ID | Comportamento | Test Type | Automated Command | Arquivo existe? |
|--------|---------------|-----------|-------------------|-----------------|
| PARSER-03 | Nó `llm` do brain-sdr seta `brainOutput` | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | Existe — precisa de novos casos |
| PARSER-03 | Webhook retorna `fullResponse` e `responseMode` | unit | `bun test packages/transport/src/__tests__/unit` (ou path direto do handler) | Existe — precisa atualizar 1 caso |
| TOOLS-STD-03 | `buildGraph()` inclui 3 tools em `bindTools()` | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | Existe — adicionar 1 novo caso |
| TOOLS-STD-03 | `sdrBrain.tools` permanece com 1 tool | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | Existe — caso existente já cobre |

### Sampling Rate
- **Por commit:** `bun test apps/brain-sdr/src/__tests__/unit`
- **Por wave:** `bun test` (workspace completo)
- **Phase gate:** `turbo run build && turbo run lint && bun test` — todos verdes antes do `/gsd-verify-work`

### Wave 0 Gaps
- Nenhum — infraestrutura de teste já existe. Os arquivos de teste a modificar (`brain.test.ts`, `handler.test.ts`) já existem. Nenhum arquivo novo de teste precisa ser criado.

---

## Environment Availability

> Todos os componentes são internos ao workspace — sem dependências externas novas.

| Dependência | Requerido por | Disponível | Versão | Fallback |
|-------------|--------------|-----------|--------|---------|
| `bun` | testes + build | Verificar runtime | 1.x | — |
| `@brain-pkg/core` (workspace) | `createPauseSessionTool`, `createFinishConversationTool` | Sim (Fases 10+11 entregues) | workspace:* | — |
| `@brain-pkg/ai` (workspace) | `BrainStateAnnotation` | Sim | workspace:* | — |
| PostgreSQL | Runtime das tools (não nos testes unitários) | N/A para unit tests | 16.x | Mock em testes |

**Dependências bloqueantes:** Nenhuma. As factories das standard tools requerem `Sql` apenas em tempo de execução (invocação da tool), não na criação. Testes unitários usam mock (D-14).

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Aplica | Controle padrão |
|---------------|--------|-----------------|
| V2 Authentication | Não (sem novas rotas) | — |
| V3 Session Management | Não | — |
| V4 Access Control | Sim (thread_id) | `thread_id` vem do `RunnableConfig` — nunca do LLM (D-04 da Fase 11) |
| V5 Input Validation | Sim | `BrainEventSchema.safeParse()` já presente no handler |
| V6 Cryptography | Não | — |

### Known Threat Patterns

| Pattern | STRIDE | Mitigação padrão |
|---------|--------|-----------------|
| LLM fornece thread_id falso para afetar outro lead | Elevation of Privilege | `thread_id` lido de `config.configurable.thread_id` (LangChain), não dos args da tool — já implementado nas factories |
| Response splitting via `fullResponse` | Tampering | Downstream é responsável por sanitização; `fullResponse` é opaco para o handler |
| `ctx.sql!` non-null assertion causa panic se BrainRunner não injeta sql | Denial of Service | BrainRunner sempre injeta `sql` quando criado com `{ sql }` — verificado em `index.ts` linha 67 |

---

## State of the Art

| Abordagem anterior | Abordagem atual | Mudança |
|-------------------|-----------------|---------|
| Webhook retorna `{ status: "ok", reply: string }` | Webhook retorna `{ status: "ok", fullResponse, responseMode, mediaType?, mediaUrl? }` | D-01/D-02 — breaking change intencional |
| brain-sdr sem brainOutput no estado LangGraph | Nó `llm` seta `state.brainOutput` via reducer `last-write-wins` | D-09/D-10 — alinha com contrato v1.2 |
| brain-sdr com 1 tool (`qualify_lead`) | brain-sdr com 3 tools (`qualify_lead`, `pause_session`, `finish_conversation`) | D-07/D-08 — TOOLS-STD-03 |
| brain-sdr sem script `lint` (INFRA-02) | `"lint": "tsc --noEmit"` em `package.json` | D-15 — tech debt quitado |

---

## Assumptions Log

| # | Claim | Section | Risco se errado |
|---|-------|---------|-----------------|
| A1 | `createPauseSessionTool({} as any)` não lança em construção — apenas em invocação quando o DB é acessado | Pitfall 4, Code Example 4 | Se a factory acessar o DB no `drizzle(sql)` call (improvável — drizzle é lazy), o mock precisaria de shape real de Sql. Verificado pelo padrão do código: `drizzle(sql)` retorna um objeto Drizzle sem conexão imediata. [ASSUMED baseado em comportamento drizzle-orm conhecido] |
| A2 | `ToolNode` aceita array misto de tools de diferentes factories (built-in `tool()` + factories externas) sem restrição de tipo | Architecture Patterns | Se o tipo inferido de `createPauseSessionTool` não for assignable a `StructuredTool[]`, precisaria de cast explícito. [ASSUMED — padrão bem estabelecido em LangGraph.js] |

**Todos os outros claims foram verificados via leitura direta dos arquivos do codebase.**

---

## Open Questions

1. **Verificar onde `handler.test.ts` está localizado no pacote transport**
   - O que sabemos: o arquivo existe em `packages/transport/src/webhook/handler.test.ts` (verificado)
   - O que é incerto: se `turbo run test` para `@brain-pkg/transport` roda tests neste path ou se precisa de ajuste no `test` script do `package.json` do transport
   - Recomendação: verificar `packages/transport/package.json` antes de editar `handler.test.ts` — garantir que o script `test` cobre o path correto

---

## Sources

### Primary (HIGH confidence — leitura direta de arquivos do codebase)
- `apps/brain-sdr/src/brain.ts` — padrão existente de `boundQualifyTool`, `ToolNode`, `bindTools()`
- `apps/brain-sdr/src/index.ts` — sequência de startup e chamadas `enableTool()` existentes
- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — testes existentes que serão atualizados
- `apps/brain-sdr/package.json` — scripts existentes (ausência de `"lint"` confirmada — INFRA-02)
- `apps/brain-echo/src/brain.ts` — padrão de referência do nó `llm` com `brainOutput`
- `packages/core/src/tools/pause-session.ts` — factory `createPauseSessionTool(sql)`
- `packages/core/src/tools/finish-conversation.ts` — factory `createFinishConversationTool(sql)`
- `packages/core/src/index.ts` — exportações SDK-07 confirmadas
- `packages/core/src/brain/interface.ts` — `BrainBuildContext.sql?: Sql` confirmado
- `packages/core/src/output/schema.ts` — `BrainOutputSchema`, campos `fullResponse`, `responseMode`, `mediaType?`, `mediaUrl?`
- `packages/transport/src/webhook/handler.ts` — linha 84 com `reply` a ser substituída
- `packages/transport/src/webhook/handler.test.ts` — linha 76-77 com `body.reply` a ser atualizada
- `turbo.json` — task `lint` já mapeada; script em `package.json` é suficiente
- `.planning/phases/12-brain-sdr-integration/12-CONTEXT.md` — decisões D-01 a D-15

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — PARSER-03 e TOOLS-STD-03 definições
- `.planning/STATE.md` — tech debt INFRA-02 confirmado

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — todas as dependências verificadas nos arquivos do projeto
- Architecture: HIGH — padrões verificados nos arquivos de código existentes
- Pitfalls: HIGH (P1-P3, P5) / MEDIUM (P4) — P4 baseado em comportamento inferido do LangGraph

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stack estável; apenas mudanças internas ao projeto podem invalidar)
