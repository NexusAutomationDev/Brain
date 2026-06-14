---
phase: 09-brain-sdr
reviewed: 2026-06-14T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - apps/brain-sdr/package.json
  - apps/brain-sdr/src/__tests__/unit/brain.test.ts
  - apps/brain-sdr/src/__tests__/integration/qualify.test.ts
  - packages/database/src/migrations/0005_brain_sdr_prompts.sql
  - apps/brain-sdr/src/brain.ts
  - apps/brain-sdr/src/qualifier.ts
  - apps/brain-sdr/src/index.ts
  - apps/brain-sdr/src/server.ts
  - apps/brain-sdr/tsconfig.json
  - apps/brain-sdr/Dockerfile
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-06-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Brain SDR implementa um agente ReAct em LangGraph com uma tool `qualify_lead` que aciona um sub-agente stateless para avaliar qualificação de leads. A arquitetura é correta — separação entre `qualifyLeadTool` (contrato IBrain estático) e `boundQualifyTool` (closure com prompt do banco injetado em `buildGraph()`) é bem documentada e resolve o problema de zero-hardcode do prompt.

O maior problema encontrado é um bug de deploy crítico no Dockerfile: o `apps/brain-sdr/package.json` não é copiado para o stage `runner`, o que vai causar falha em runtime ao resolver o módulo principal. Além disso, há três problemas de nível Warning: a connection pool do `PostgresSaver` em `qualifier.ts` é criada a cada invocação da tool sem ser fechada (resource leak por design), o `qualificationGraph` é compilado no escopo do módulo em tempo de import (efeito colateral), e a integração E2E no teste de integração está toda sob `test.skip` sem nenhum teste que execute de verdade. A revisão não encontrou vulnerabilidades de segurança nem lógica errada de roteamento no grafo.

## Critical Issues

### CR-01: `apps/brain-sdr/package.json` ausente no stage `runner` do Dockerfile

**File:** `apps/brain-sdr/Dockerfile:84-85`

**Issue:** O stage `runner` copia `apps/brain-sdr/dist` e `apps/brain-sdr/node_modules` mas **não** copia `apps/brain-sdr/package.json`. O runtime Bun/Node usa `package.json` para resolver o campo `"main"` e o campo `"type": "module"` — sem ele, o processo pode falhar com `Cannot find module` ou tratar os arquivos `.js` como CommonJS em vez de ESM. O mesmo padrão correto é aplicado para todos os workspace packages (linhas 60-72), mas foi esquecido para o app em si.

**Fix:**
```dockerfile
# App brain-sdr compilado + node_modules do app
COPY --from=builder /app/apps/brain-sdr/dist ./apps/brain-sdr/dist
COPY --from=builder /app/apps/brain-sdr/package.json ./apps/brain-sdr/package.json
COPY --from=builder /app/apps/brain-sdr/node_modules ./apps/brain-sdr/node_modules
```

## Warnings

### WR-01: `PostgresSaver` criado sem fechar a conexão a cada chamada de `qualify_lead`

**File:** `apps/brain-sdr/src/qualifier.ts:172-174`

**Issue:** `runQualificationAgent()` chama `PostgresSaver.fromConnString(dbUrl)` a cada invocação da tool, criando uma nova pool de conexões PG que nunca é fechada (`saver.end()` não é chamado). Em produção, com múltiplos leads simultâneos sendo qualificados, isso acumulará conexões abertas até esgotar o limite do banco. `PostgresSaver.fromConnString` usa `pg` (node-postgres) internamente, que abre conexões ao primeiro uso.

**Fix:** Mover a criação do `PostgresSaver` para escopo de módulo (singleton), ou passar o checkpointer já criado pelo `BrainRunner` via parâmetro. A abordagem mais limpa é criar o saver uma vez e reutilizar:

```typescript
// Escopo de módulo — criado uma vez, reutilizado por todas as invocações
let _qualificationSaver: PostgresSaver | null = null;

function getQualificationSaver(): PostgresSaver {
  if (!_qualificationSaver) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL not set");
    _qualificationSaver = PostgresSaver.fromConnString(dbUrl);
  }
  return _qualificationSaver;
}
```

Alternativa mais limpa para v2: passar o `checkpointer` já existente como parâmetro de `runQualificationAgent()` para evitar a segunda pool completamente.

### WR-02: `qualificationGraph.compile()` executado no escopo do módulo em tempo de import

**File:** `apps/brain-sdr/src/qualifier.ts:131`

**Issue:** `qualificationGraph.compile()` é chamado no nível do módulo (linha 131, fora de qualquer função). Isso significa que o grafo é compilado no momento em que o módulo é importado pela primeira vez — incluindo durante os testes unitários de `brain.test.ts` que importam `qualifier.js`. Se `compile()` lançar um erro (ex: validação interna do LangGraph), o import inteiro falha silenciosamente no contexto de teste, e os erros serão atribuídos ao import e não à causa raiz. Além disso, efectua work desnecessário em cada processo que importa o módulo.

**Fix:** Usar inicialização lazy via função:

```typescript
let _compiledQualificationGraph: ReturnType<typeof qualificationGraph.compile> | null = null;

function getCompiledGraph() {
  if (!_compiledQualificationGraph) {
    _compiledQualificationGraph = qualificationGraph.compile();
  }
  return _compiledQualificationGraph;
}

// Em runQualificationAgent:
const result = await getCompiledGraph().invoke({ ... });
```

### WR-03: Testes de integração são 100% `test.skip` — nenhum teste exercita código real

**File:** `apps/brain-sdr/src/__tests__/integration/qualify.test.ts:8,24,39`

**Issue:** Todos os três testes no arquivo de integração estão sob `test.skip`. O segundo `test.skip` em linha 24 documenta o comportamento esperado quando `runQualificationAgent` recebe um `sessionId` sem checkpoint — mas esse comportamento nunca é verificado automaticamente. Como o código de fallback em `qualifier.ts:151-155` é a rota mais importante para confiabilidade (fallback gracioso), a ausência de qualquer teste que execute esse caminho é um risco. O arquivo atualmente não adiciona valor como suite de testes.

**Fix:** Ao menos o teste de fallback (linha 24) pode ser desskipado com um mock do `PostgresSaver.getTuple` que retorna `undefined`, sem necessitar de banco real:

```typescript
import { mock } from "bun:test";

test("runQualificationAgent retorna fallback quando getTuple retorna undefined", async () => {
  // Mock PostgresSaver para não precisar de DB real
  mock.module("@langchain/langgraph-checkpoint-postgres", () => ({
    PostgresSaver: {
      fromConnString: () => ({
        getTuple: async () => undefined,
      }),
    },
  }));
  process.env.DATABASE_URL = "postgres://mock";
  const { runQualificationAgent } = await import("../../qualifier.js");
  const result = await runQualificationAgent("contexto", "session-inexistente");
  expect(result.qualificado).toBe(false);
  expect(typeof result.motivo).toBe("string");
});
```

## Info

### IN-01: `extractJSON` não trata arrays JSON, apenas objetos

**File:** `apps/brain-sdr/src/qualifier.ts:56-64`

**Issue:** A regex `\{[\s\S]*\}` extrai apenas objetos JSON. Se o LLM retornar o JSON dentro de um array (ex: `[{"qualificado": true, ...}]`) ou com texto antes do `{`, o fallback genérico retornará o texto raw para `JSON.parse`, que vai lançar e cair no fallback de qualificação. O código está correto para o caso esperado (objeto JSON), mas vale documentar essa limitação explicitamente.

**Fix:** Documentar no comentário que arrays não são suportados e o LLM é instruído via prompt a retornar exclusivamente um objeto. Sem mudança de código necessária — apenas claridade de intenção.

### IN-02: `buildHistoryText` lista mensagens AI e Human separadamente sem ordem cronológica

**File:** `apps/brain-sdr/src/qualifier.ts:67-84`

**Issue:** O comentário na linha 71 explica que "intercalar em ordem cronológica não é possível sem timestamps". Isso é verdade para a estrutura atual, mas o LangGraph `checkpoint.channel_values.messages` já mantém as mensagens em ordem cronológica no array original. O código filtra em `aiMessages` e `humanMessages` (perdendo a ordem), e depois lista separado, o que pode prejudicar o raciocínio do LLM de qualificação sobre o fluxo da conversa.

**Fix (sugestão):** Em vez de filtrar e listar separado, usar o array `allMessages` diretamente preservando a ordem, e prefixar cada mensagem com o tipo:

```typescript
function buildHistoryText(allMessages: BaseMessage[]): string {
  return allMessages
    .filter(m => m._getType() === "ai" || m._getType() === "human")
    .map((m, i) => {
      const role = m._getType() === "human" ? "Lead" : "IA";
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `[${i + 1}] ${role}: ${content}`;
    })
    .join("\n");
}
```

Isso requer atualizar a assinatura de `buildHistoryText` e o `QualificationAnnotation` (passar `allMessages` em vez de `aiMessages`/`humanMessages` separados).

### IN-03: `@brain-pkg/memory` referenciado no `tsconfig.json` mas não no `package.json`

**File:** `apps/brain-sdr/tsconfig.json:14`

**Issue:** O `tsconfig.json` lista `{ "path": "../../packages/memory" }` nas referências de projeto (linha 14), mas `@brain-pkg/memory` não aparece nas `dependencies` do `package.json`. Se nenhum import em `brain-sdr/src/` usar `@brain-pkg/memory` diretamente, a referência no tsconfig é redundante e pode causar confusão. Se no futuro um import for adicionado, a dep no `package.json` vai estar faltando.

**Fix:** Verificar se algum arquivo em `src/` importa `@brain-pkg/memory`. Se não, remover a referência do `tsconfig.json`. Se sim, adicionar `"@brain-pkg/memory": "workspace:*"` ao `package.json`.

---

_Reviewed: 2026-06-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
