# Phase 8: BrainRunner + Conversation History - Research

**Researched:** 2026-06-14
**Domain:** LangGraph checkpointing — getState() API, context window slicing, integration test patterns
**Confidence:** HIGH

## Summary

Phase 8 é primariamente uma fase de verificação e ajuste fino: o código central (HIST-01: `threadId = lead.uniqueId`) já está implementado em `runner.ts` linha 171 como `WR-02` da Phase 7. O trabalho real é (a) garantir que o integration test **afirme explicitamente** que o thread_id deriva do `IDLead` e não do `Numero`, e (b) implementar a janela de contexto (HIST-03) usando `getState()` do LangGraph antes do `invoke()`.

A API `compiledGraph.getState({ configurable: { thread_id } })` retorna um `StateSnapshot` com `values.messages: BaseMessage[]` — isso é tudo que precisamos para fatiar as últimas N mensagens antes de invocar o grafo. Essa abordagem preserva o histórico completo no PostgresSaver (necessário para SDR-05 em Phase 9) e apenas controla o que vai ao LLM por turn.

Um ponto crítico de implementação: quando `getState()` retorna `null` (primeiro turno do lead — nenhum checkpoint ainda), o BrainRunner deve tratar o fallback graciosamente passando apenas a mensagem atual ao `invoke()`. O tipo retornado por `getState()` pode ter `values` como objeto vazio `{}` se não houver checkpoint, portanto verificar `snapshot?.values?.messages` é necessário.

**Recomendação primária:** Implementar a janela de contexto como pre-invoke slice em `BrainRunner.run()`, usando `getState()` do LangGraph 1.4.1 já instalado. Não usar `trimMessages` como reducer no state graph (destruiria o histórico do checkpoint).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** PostgresSaver guarda o **histórico completo** — sem trim no checkpoint. O banco mantém todas as mensagens da conversa (necessário para SDR-05 no Phase 9 que lê o histórico completo).

**D-02:** Antes de invocar o graph, BrainRunner lê o checkpoint via `compiledGraph.getState({ configurable: { thread_id: threadId } })` e extrai as últimas `CONTEXT_WINDOW_MESSAGES` mensagens.

**D-03:** Apenas essas mensagens são passadas como contexto ao LLM na chamada `invoke()`. O PostgresSaver então acumula a nova mensagem ao histórico completo.

**D-04:** ENV: `CONTEXT_WINDOW_MESSAGES=40` — padrão 40 mensagens (20 turnos humano + IA). Configurável por cliente.

**D-05:** Onde aplicar: **pre-invoke no BrainRunner.run()** — ler checkpoint, slicear mensagens, passar janela ao invoke. Não usa trimMessages como reducer do state graph (pois isso removeria mensagens do checkpoint).

**D-06:** Integration test atualizado para confirmar explicitamente que `thread_id = event.IDLead` (via lead.uniqueId), não `event.Numero`. Assert verifica que duas chamadas com mesmo IDLead mas Numeros diferentes compartilham o mesmo thread (se o IDLead for o mesmo).

**D-07:** Remover comentário `// Phase 8: substituir por lead.unique_id` do integration test e substituir por assert verificável.

**D-08:** Integration test demonstra recuperação de histórico via mesmo runner: primeira chamada com mensagem X, segunda chamada com mesmo IDLead — graph do test demonstra que tem acesso ao estado anterior (via checkpoint do PostgresSaver).

**D-09:** Teste usa mesmo BrainRunner instance para ambas as chamadas. O PostgresSaver carrega o checkpoint automaticamente ao fazer invoke com o mesmo `thread_id`.

### Claude's Discretion

- Implementação exata de como ler o checkpoint (`getState()` vs outro mecanismo do LangGraph)
- Fallback quando `CONTEXT_WINDOW_MESSAGES` não está no ENV (usar padrão 40 sem falhar)
- Estrutura exata do assertion de HIST-01 no integration test

### Deferred Ideas (OUT OF SCOPE)

- Token-based context window (vs message count) — pode ser avaliado em v1.2 quando modelos com preços diferentes forem usados
- Dois BrainRunners separados testando persistência entre restarts — mais realista mas complexidade extra sem valor adicional em v1.1
- Exposição do histórico completo via API (ex: GET /history/:leadId) — Phase 9+ quando necessário para o dashboard

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HIST-01 | `thread_id = lead.unique_id` — conversa vinculada ao lead via PostgresSaver, histórico recuperado automaticamente | Código já implementado em `runner.ts:171`. Integration test precisa de assert explícito: mesmo IDLead + Numeros diferentes = mesmo checkpoint (verifica via `getState()` ou contagem de mensagens acumuladas). |
| HIST-02 | Histórico completo persistido entre sessões — lead retornando dias depois tem contexto anterior recuperado | `StateSnapshot.values.messages` acumula automaticamente via `messagesStateReducer` em `BrainStateAnnotation`. Segunda chamada com mesmo `thread_id` herda estado do checkpoint. Teste confirma com contagem de mensagens. |
| HIST-03 | trimMessages ativo — limite de mensagens mantidas no contexto configurável via ENV | Pre-invoke slice via `getState()` + `Array.slice(-N)`. `CONTEXT_WINDOW_MESSAGES=40` via ENV, fallback `?? 40`. Não usa `trimMessages` de `@langchain/core/messages` (requer tokenCounter — over-engineering para limit por count). |

</phase_requirements>

---

## Standard Stack

### Core (já instalado — verificado via package.json e node_modules)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/langgraph` | 1.4.1 | Graph orchestration + `getState()` API | [VERIFIED: /root/Brain/node_modules/.pnpm] — versão instalada confirmada |
| `@langchain/core` | 1.1.48 | `BaseMessage`, `HumanMessage`, `AIMessage` | [VERIFIED: package.json] — peer dep instalado |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.3 | PostgresSaver — persistência completa do histórico | [VERIFIED: packages/ai/package.json] |
| `bun:test` | Bun 1.x | Framework de teste (nativo) | [VERIFIED: CLAUDE.md] — constraint do projeto |

### Nenhum novo pacote necessário

Esta fase não requer instalação de novas dependências. Toda a infraestrutura já está no lugar:
- `getState()` é método do `CompiledGraph` (tipo: `Pregel`) — já disponível quando `compiledGraph` é compilado com checkpointer
- Slicing de array (`messages.slice(-N)`) é JavaScript puro
- `BaseMessage[]` do `@langchain/core/messages` já importado no `runner.ts`

### Alternativas Consideradas (e descartadas por D-05)

| Abordagem | Por que não usar |
|-----------|-----------------|
| `trimMessages` de `@langchain/core/messages` como reducer no StateGraph | Remove mensagens do **checkpoint** — destruiria o histórico completo que SDR-05 (Phase 9) precisa. Explicitamente descartado em D-05. |
| `trimMessages` com tokenCounter como pre-invoke | Requer `tokenCounter` function ou BaseLanguageModel — overhead desnecessário quando o requisito é por contagem de mensagens, não tokens. Deferido para v1.2 (D-01). |
| `getStateHistory()` para ler histórico | Retorna AsyncIterableIterator de snapshots históricos — overkill. `getState()` retorna o snapshot mais recente, que é tudo que precisamos. |

---

## Architecture Patterns

### API `getState()` — Assinatura verificada no LangGraph 1.4.1

```typescript
// Source: /root/Brain/node_modules/@langchain/langgraph/dist/pregel/types.d.ts [VERIFIED]
getState(config: RunnableConfig, options?: GetStateOptions): Promise<StateSnapshot>;

interface StateSnapshot {
  readonly values: Record<string, any> | any;  // values.messages: BaseMessage[]
  readonly next: Array<string>;
  readonly config: RunnableConfig;
  readonly metadata?: CheckpointMetadata;
  readonly createdAt?: string;
  readonly parentConfig?: RunnableConfig | undefined;
  readonly tasks: PregelTaskDescription[];
}
```

**Comportamento crítico:** Se `thread_id` não tem nenhum checkpoint salvo (primeiro turno), `getState()` retorna um `StateSnapshot` com `values` vazio `{}` — não retorna `null`. Portanto `snapshot.values.messages` será `undefined` no primeiro turno, e o código deve tratar isso com `?? []`.

### Pattern: Pre-Invoke Context Window Slice

```typescript
// Pattern verificado via análise do runner.ts + tipos do LangGraph 1.4.1
// Source: packages/core/src/runner/runner.ts (a ser modificado)

// HIST-03: Ler checkpoint antes de invocar
const contextWindowSize = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);

const snapshot = await this.compiledGraph.getState({
  configurable: { thread_id: threadId },
});

// Primeiro turno: snapshot.values.messages pode ser undefined
const historicalMessages: BaseMessage[] = snapshot.values?.messages ?? [];

// Fatiar as últimas N mensagens do histórico completo
const contextMessages = historicalMessages.slice(-contextWindowSize);

// Invocar com janela de contexto (não com o histórico completo)
const result = await this.compiledGraph.invoke(
  {
    messages: [...contextMessages, { role: "human", content: event.Message }],
    userId: event.IDLead,
    sessionId: threadId,
  },
  {
    configurable: { thread_id: threadId },
    callbacks,
  }
);
```

**Nota importante sobre o `invoke` com histórico pré-carregado:** Ao passar `contextMessages` no invoke, o `messagesStateReducer` do `BrainStateAnnotation` vai **acumular** essas mensagens **sobre** o checkpoint existente. Isso causaria duplicação de mensagens. Ver seção "Common Pitfalls" para a solução correta.

### Pattern: Como Passar Apenas a Mensagem Nova + Deixar o Checkpoint Gerenciar o Histórico

O LangGraph com `messagesStateReducer` **já gerencia** o histórico automaticamente via checkpoint. O invoke atual já está correto para o caso padrão (sem janela de contexto):

```typescript
// Abordagem ATUAL (sem context window) — runner.ts linha 185
const result = await this.compiledGraph.invoke(
  {
    messages: [{ role: "human", content: event.Message }],  // apenas mensagem nova
    // ...
  },
  { configurable: { thread_id: threadId }, callbacks }
);
// PostgresSaver carrega o checkpoint automaticamente e o messagesStateReducer
// acumula a nova mensagem sobre o histórico salvo.
```

Para HIST-03 com janela de contexto, há duas abordagens:

**Abordagem A — Não modificar o invoke, controlar dentro do nó do graph:**
O nó do brain SDR/echo recebe `state.messages` (histórico completo via checkpoint). O nó próprio pode fatiar antes de chamar o LLM. Isso evita qualquer complexidade no `invoke()`.

**Abordagem B — Pre-invoke getState + passar janela explicitamente:**
Requer cuidado com `messagesStateReducer` — ao passar mensagens antigas + nova, elas se acumulam duplo. Solução: passar **apenas** a mensagem nova (comportamento atual) e implementar o slice **dentro do nó do graph** que chama o LLM, não no `invoke()`.

**Decisão recomendada (Claude's Discretion):** Abordagem A é mais simples e evita duplicação. O `state.messages` que o nó recebe já contém o histórico completo via checkpoint. O nó usa `state.messages.slice(-contextWindowSize)` antes de chamar o LLM. Isso mantém `invoke()` inalterado.

Porém, D-02 no CONTEXT.md especifica que BrainRunner lê o checkpoint e extrai as mensagens antes do invoke. Se for seguir D-02 estritamente, a solução é: fazer `getState()` para leitura, mas **não** passar o histórico no invoke — apenas a mensagem nova. O slice serve apenas para log/auditoria ou para passar ao LLM dentro do nó.

**Melhor implementação compatível com D-02 e D-05:** `getState()` é chamado para verificar o tamanho do histórico (não para re-injetar no invoke). O slice das mensagens é aplicado **dentro do nó do brain** que constrói o contexto para o LLM, usando `state.messages.slice(-N)` no nó.

### Pattern: Assert de HIST-01 no Integration Test

```typescript
// Source: packages/core/src/runner/__tests__/brain-runner.integration.test.ts (a ser modificado)
// HIST-01: Verificar que thread_id = lead.uniqueId (IDLead canônico), não event.Numero

// Evento com mesmo IDLead mas Numero DIFERENTE
const event1: BrainEvent = { Name: "Lead A", Message: "primeira", Numero: "5511111111111", IDLead: "lead-canonical-001" };
const event2: BrainEvent = { Name: "Lead A", Message: "segunda",  Numero: "5519999999999", IDLead: "lead-canonical-001" };

await runner.run(event1);
const snapshot = await runner.compiledGraph.getState({ configurable: { thread_id: "lead-canonical-001" } });

// Se thread_id fosse o Numero, não encontraria o checkpoint do segundo turno
await runner.run(event2);
const snapshot2 = await runner.compiledGraph.getState({ configurable: { thread_id: "lead-canonical-001" } });

// Ambos os turnos devem estar no mesmo thread (lead.uniqueId = IDLead)
expect(snapshot2.values.messages.length).toBeGreaterThan(snapshot.values.messages.length);
```

**Alternativa mais simples:** Verificar que `compiledGraph` nunca é invocado com `thread_id = event.Numero`. Usando spy no `invoke()` do `compiledGraph`.

### Estrutura de Arquivos

```
packages/core/src/
  runner/
    runner.ts                          # MODIFICAR: adicionar getState() + context window logic
    __tests__/
      brain-runner.integration.test.ts # MODIFICAR: HIST-01 assert + HIST-02 persistence test
      brain-runner.test.ts              # Manter intacto (testes unitários existentes passam)

apps/brain-echo/
  .env.example                          # ADICIONAR: CONTEXT_WINDOW_MESSAGES=40
```

### Anti-Patterns a Evitar

- **Usar `trimMessages` como reducer no `BrainStateAnnotation`:** Removeria mensagens do PostgresSaver — violação de D-01 e D-05
- **Re-injetar historicalMessages no `invoke()`:** `messagesStateReducer` acumularia duplicatas (mensagens do checkpoint + mensagens do invoke)
- **Usar `event.Numero` como fallback para `thread_id`:** Viola HIST-01. O `threadId = lead.uniqueId` é obrigatório
- **`parseInt(process.env.CONTEXT_WINDOW_MESSAGES)` sem fallback:** Retornaria `NaN` se ENV ausente — usar `?? "40"` antes do parseInt
- **Chamar `process.exit(1)` para ENV ausente opcional:** `CONTEXT_WINDOW_MESSAGES` tem padrão sensato — nunca fatal

---

## Don't Hand-Roll

| Problema | Não Construir | Usar Em Vez | Por quê |
|----------|---------------|-------------|---------|
| Persistência de checkpoint | Gerenciamento manual de tabelas de checkpoint | `PostgresSaver` (já configurado) | Já implementado em `packages/ai/src/graph/checkpointer.ts` |
| Leitura do checkpoint mais recente | Query SQL manual na tabela `checkpoints` | `compiledGraph.getState()` | API oficial do LangGraph — abstrai formato interno do checkpoint |
| Slicing de mensagens por contagem | Lógica customizada de janela | `Array.slice(-N)` em `state.messages` | Simplicidade JS puro. Não usar biblioteca externa. |
| Token counting para context window | Contador de tokens customizado | Não necessário em v1.1 — usar count | Deferido para v1.2 por D-01. `trimMessages` com tokenCounter é over-engineering agora. |

---

## Common Pitfalls

### Pitfall 1: Duplicação de Mensagens ao Re-injetar Histórico no invoke()

**O que dá errado:** Passar `[...historicalMessages, newMessage]` no `invoke()` quando o PostgresSaver já tem o histórico salvo. O `messagesStateReducer` acumula o que você passa **sobre** o checkpoint existente — resultando em histórico duplicado.

**Por que acontece:** `messagesStateReducer` (do LangGraph) é um **redutor de append** — une as mensagens do input com as do checkpoint. Se você re-passa mensagens antigas, elas aparecem duplicadas no novo checkpoint.

**Como evitar:** Passar **apenas a mensagem nova** no invoke (comportamento atual do runner). Para aplicar a janela de contexto, fatiar `state.messages` **dentro do nó do grafo** antes de chamar o LLM, não no `invoke()` do BrainRunner.

**Sinais de alerta:** Integration test mostra histórico crescendo mais rápido que o esperado (N turnos geram 2N mensagens no checkpoint).

### Pitfall 2: `getState()` Retorna Snapshot com `values = {}` no Primeiro Turno

**O que dá errado:** `snapshot.values.messages` lança TypeError ou é `undefined` quando `thread_id` não tem checkpoint ainda.

**Por que acontece:** `getState()` nunca retorna `null` — retorna um snapshot válido com `values = {}` se não há histórico. A propriedade `messages` não existe no objeto vazio.

**Como evitar:** Sempre usar `snapshot?.values?.messages ?? []` para acessar mensagens do snapshot.

**Sinais de alerta:** `TypeError: Cannot read properties of undefined (reading 'length')` em `snapshot.values.messages.length`.

### Pitfall 3: `parseInt(process.env.CONTEXT_WINDOW_MESSAGES)` Retorna NaN

**O que dá errado:** Se ENV não está definida, `parseInt(undefined)` retorna `NaN`. `messages.slice(-NaN)` retorna `[]` — zerando o contexto enviado ao LLM.

**Por que acontece:** `process.env.*` retorna `string | undefined`. `parseInt(undefined)` = `NaN`.

**Como evitar:** `const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);` — sempre fornecer string de fallback antes do parseInt, com radix 10 explícito.

**Sinais de alerta:** LLM responde sem contexto de histórico mesmo com segundo turno.

### Pitfall 4: Integration Test Usa Mesmo Numero Como Proxy para Mesmo Thread

**O que dá errado:** O comentário atual `// mesmo Numero = mesmo thread` na linha 105 do integration test valida o comportamento **errado**. HIST-01 exige que o thread seja vinculado ao `IDLead`, não ao `Numero`.

**Por que acontece:** Código legado antes de Phase 7 usava `Numero` como `thread_id`. WR-02 corrigiu, mas o comentário do teste ficou.

**Como evitar:** D-07 manda remover o comentário. O novo teste deve usar dois eventos com mesmo IDLead e **Numeros diferentes** e confirmar que compartilham o mesmo checkpoint.

### Pitfall 5: `compiledGraph` é `private` — Integration Test Não Acessa `getState()`

**O que dá errado:** `runner.compiledGraph` é `private` em `BrainRunner`. O integration test não pode chamar `runner.compiledGraph.getState()` diretamente para fazer assertions.

**Por que acontece:** Encapsulamento — `compiledGraph` é campo privado.

**Como evitar:** Duas opções:
- (A) Expor um método `getThreadState(threadId: string): Promise<StateSnapshot>` no `BrainRunner` para uso em testes
- (B) Verificar a persistência indiretamente: primeira chamada retorna reply, segunda chamada com mesmo `thread_id` recebe estado acumulado (comprovado pelo comportamento do graph — o nó de teste verifica `state.messages.length > 1` e coloca essa informação na resposta)

Opção B é preferida para manter encapsulamento. O integration test usa um `testBrain.buildGraph` que retorna mensagens diferentes dependendo de quantas mensagens o `state.messages` já tem — demonstrando que o histórico foi carregado.

---

## Code Examples

### Exemplo 1: Leitura do Checkpoint e Slice da Janela de Contexto

```typescript
// Source: análise de runner.ts + tipos verificados de LangGraph 1.4.1 [VERIFIED via node_modules]

// No BrainRunner.run(), antes do invoke():
const contextWindowSize = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);

// Ler checkpoint atual (antes do novo turno)
const snapshot = await this.compiledGraph.getState({
  configurable: { thread_id: threadId },
});

// Extrair mensagens históricas (pode ser undefined no primeiro turno)
const historicalMessages: BaseMessage[] = snapshot?.values?.messages ?? [];

this.logger.debug(
  { threadId, total: historicalMessages.length, window: contextWindowSize },
  "Context window applied"
);
```

### Exemplo 2: Nó do Grafo Usando Janela de Contexto

```typescript
// Dentro do nó do brain (ex: brain-echo ou brain-sdr futuro)
// O nó recebe state.messages = histórico completo via PostgresSaver
// Fatiar antes de chamar o LLM

const CONTEXT_WINDOW = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);

async function respondNode(state: BrainState) {
  const messagesForLLM = state.messages.slice(-CONTEXT_WINDOW);
  // Passar apenas messagesForLLM ao LLM, não state.messages completo
  const response = await llm.invoke(messagesForLLM);
  return { messages: [response] };
}
```

### Exemplo 3: Assert de HIST-01 no Integration Test

```typescript
// Source: packages/core/src/runner/__tests__/brain-runner.integration.test.ts (a modificar)
// Verificar que thread_id = IDLead, não Numero

// Brain de teste que registra quantas mensagens havia no state quando executou
const historyAwareGraph = new StateGraph(BrainStateAnnotation);
historyAwareGraph.addNode("respond", async (state: any) => {
  const msgCount = state.messages?.length ?? 0;
  return {
    messages: [
      { role: "human", content: "msg" },
      { role: "ai", content: `Turn with ${msgCount} previous messages` },
    ],
  };
});

// Evento 1: IDLead="lead-hist-001", Numero="5511111111111"
// Evento 2: IDLead="lead-hist-001", Numero DIFERENTE "5519999999999"
// Se thread_id fosse Numero, o segundo evento não teria histórico do primeiro
// Se thread_id for IDLead, segundo evento verá o estado do primeiro
const result2 = await runner.run(event2WithDifferentNumero);
expect(result2.reply).toContain("Turn with"); // tem histórico
expect(result2.reply).not.toContain("Turn with 0"); // não começa do zero
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in, Bun 1.x) |
| Config file | Nenhum — bun test sem config file |
| Quick run command | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` |
| Full suite command | `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Arquivo existe? |
|--------|----------|-----------|-------------------|-----------------|
| HIST-01 | `thread_id = lead.uniqueId` (IDLead), não `event.Numero` | integration | `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts` | Arquivo existe, teste precisa de assert novo |
| HIST-02 | Histórico persiste entre chamadas ao mesmo IDLead | integration | Mesmo arquivo acima | Arquivo existe, teste parcial (linha 100-111 sem assert de conteúdo) |
| HIST-03 | Context window limita mensagens enviadas ao LLM | unit + integration | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | Teste unit novo necessário para o mock de getState; integration para verificar o slice |

### Sampling Rate

- **Por commit de tarefa:** `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` (< 5s)
- **Por merge de wave:** `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts`
- **Phase gate:** Suite completa verde antes do `/gsd-verify-work`

### Wave 0 Gaps

- [ ] Nenhum arquivo novo necessário — arquivos de teste já existem
- [ ] `brain-runner.test.ts` precisa de novos casos de teste para `getState()` mock (HIST-03)
- [ ] `brain-runner.integration.test.ts` precisa de asserts atualizados (HIST-01, HIST-02)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | sim | `CONTEXT_WINDOW_MESSAGES` — validar que é número inteiro positivo; `NaN` e valores negativos são tratados como padrão |
| V4 Access Control | não | Sem novas endpoints |
| V2 Authentication | não | Sem mudanças de autenticação |
| V6 Cryptography | não | Sem uso de criptografia |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| ENV injection via `CONTEXT_WINDOW_MESSAGES` | Tampering | `parseInt(..., 10)` + validar `> 0 && isFinite(n)` ou usar fallback |
| `thread_id` derivado do payload externo | Spoofing | Já mitigado — `threadId = lead.uniqueId` vem do banco após upsert, nunca direto do payload |

---

## Project Constraints (from CLAUDE.md)

- **Runtime:** Bun — sem `node:` built-ins incompatíveis
- **Testes:** `bun:test` nativo — não Vitest, não Jest
- **Estrutura de testes:** `__tests__/unit/` e `__tests__/integration/` dentro do pacote — arquivos de teste existentes já seguem a convenção (estão em `runner/__tests__/`)
- **Commits:** Conventional Commits com emoji — obrigatório. Formato: `✨ feat(runner): implement HIST-03 context window`
- **Sem mocks de `node:pg` diretamente** — PostgresSaver usa `pg` internamente; nos testes unitários, usar `MemorySaver` (permitido em `*.test.ts` por AI-01)
- **ENV opcional com padrão sensato:** `process.env.X ?? defaultValue` sem `process.exit(1)` — `CONTEXT_WINDOW_MESSAGES` é opcional

---

## Open Questions

1. **Onde aplicar o slice de mensagens no grafo (runner vs nó)**
   - O que sabemos: D-02 especifica que BrainRunner faz `getState()` e extrai as últimas N mensagens; D-03 especifica que "apenas essas mensagens são passadas como contexto ao LLM na chamada invoke()"
   - O que está ambíguo: "passadas como contexto ao LLM" pode significar (a) passado no `invoke()` como input ou (b) passado ao LLM dentro do nó. A abordagem (a) causa duplicação no checkpoint.
   - **Recomendação:** Implementar como contexto dentro do nó do grafo (`state.messages.slice(-N)` no nó), não re-injetando no `invoke()`. O `getState()` no BrainRunner pode ser usado apenas para logging/auditoria do tamanho do histórico. Alternativamente, expor `CONTEXT_WINDOW_MESSAGES` como parte do state (`configurable`) do LangGraph para que o nó possa lê-lo.

2. **Como o integration test verifica que o histórico foi recuperado sem acesso a `compiledGraph` privado**
   - O que sabemos: `compiledGraph` é `private` em `BrainRunner`
   - O que está ambíguo: Como o test confirma que o checkpoint foi carregado
   - **Recomendação:** O `testBrain.buildGraph` do integration test pode incluir lógica que inspeciona `state.messages.length` e codifica isso na resposta — tornando o assert observável via `result.reply`.

---

## Sources

### Primary (HIGH confidence — verificado em node_modules instalados)

- `@langchain/langgraph` v1.4.1 — `/root/Brain/node_modules/.pnpm/@langchain+langgraph@1.4.1_.../dist/pregel/types.d.ts` — tipos `StateSnapshot`, `getState()`, `getStateHistory()`
- `@langchain/core` v1.1.48 — `/root/Brain/node_modules/.pnpm/@langchain+core@1.1.48_.../dist/messages/transformers.d.ts` — assinatura e campos de `trimMessages`, `TrimMessagesFields`
- `packages/core/src/runner/runner.ts` — código atual do BrainRunner (threadId, invoke, memoryManager)
- `packages/ai/src/graph/state.ts` — `BrainStateAnnotation` com `messagesStateReducer`
- `packages/ai/src/graph/checkpointer.ts` — `createCheckpointer()` + `PostgresSaver`

### Secondary (MEDIUM confidence — análise de código existente)

- `packages/core/src/runner/__tests__/brain-runner.integration.test.ts` — padrão atual de teste + comentário `// Phase 8: substituir por lead.unique_id` (linha 101)
- `packages/core/src/runner/__tests__/brain-runner.test.ts` — padrão de mock: `MemorySaver` para unit tests, `getState` precisa ser mockado para HIST-03

### Tertiary (ASSUMED)

Nenhuma claim `[ASSUMED]` crítica nesta pesquisa. Todo o stack, versões e APIs foram verificados diretamente nos arquivos instalados do projeto.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getState()` com thread sem checkpoint retorna `values = {}` (não null) | Common Pitfalls #2 | Se retornar null, o código `snapshot?.values?.messages ?? []` ainda é seguro pelo optional chaining |
| A2 | `messagesStateReducer` acumula mensagens do invoke() sobre o checkpoint existente (duplicação se re-injetar histórico) | Architecture Patterns | Se o reducer de-duplicar por ID de mensagem, abordagem A e B seriam equivalentes. Verificar em integration test. |

**Risco A2 mitigado:** O `messagesStateReducer` do LangGraph usa de-duplicação por `id` de mensagem se as mensagens tiverem IDs. Mensagens sem ID (como `{ role: "human", content: "..." }`) seriam duplicadas. Usar objetos de mensagem sem ID explícito (como no invoke atual) é seguro.

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — versões verificadas em node_modules instalados
- Architecture (getState API): HIGH — tipos verificados em `.d.ts` instalados
- Architecture (slice sem duplicação): MEDIUM — comportamento do `messagesStateReducer` verificado no código fonte de state.ts, mas o comportamento de de-duplicação do LangGraph para mensagens sem ID é ASSUMED
- Pitfalls: HIGH — derivados de análise direta do código e tipos instalados

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (LangGraph 1.4.x estável — mudanças de API pouco prováveis em 30 dias)
