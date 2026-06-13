---
plan: "02-02"
phase: "02-domain-packages"
status: complete
wave: 2
completed_at: "2026-06-11"
---

# Summary: Wave 2 — AI-core Graph State & Checkpointer

## O que foi implementado

### Task 1: BrainStateAnnotation (AI-03)

**`packages/ai/src/graph/state.ts`** — criado do zero.

- `BrainStateAnnotation` definido com `Annotation.Root` do LangGraph
- Campos:
  - `schema_version: number` — reducer last-write-wins (`(_, next) => next`)
  - `messages: BaseMessage[]` — reducer `messagesStateReducer` (acumulativo)
  - `userId: string` — reducer last-write-wins
  - `sessionId: string` — reducer last-write-wins
- Todos os campos são primitivos JSON-safe (sem `Set`, `Map`, `Date`, `Buffer`)
- `BrainState` exportado como type alias de `typeof BrainStateAnnotation.State`

**`packages/ai/src/graph/state.test.ts`** — stubs `.todo` substituídos por testes reais:
- Verifica presença de todos os campos via `BrainStateAnnotation.spec`
- Testa reducer last-write-wins para `schema_version` via `StateGraph`
- Testa acumulação de mensagens via `messagesStateReducer`
- Valida exportação do type `BrainState`

### Task 2: createCheckpointer + Subgraph Pattern (AI-01, AI-02, MEM-01)

**`packages/ai/src/graph/checkpointer.ts`** — criado do zero.

- `createCheckpointer(connectionString: string): Promise<PostgresSaver>`
- Usa `PostgresSaver.fromConnString()` da lib `@langchain/langgraph-checkpoint-postgres`
- Chama `setup()` internamente — callers não precisam chamar separadamente
- `MemorySaver` **nunca importado** — constraint AI-01 respeitado

**`packages/ai/src/graph/checkpointer.test.ts`** — stubs substituídos por testes de integração:
- Skip automático quando `TEST_DATABASE_URL` não está definido (`describe.skip`)
- Testa instância `PostgresSaver`, idempotência do `setup()`, e persistência SC-1 (dois invokes no mesmo `thread_id` acumulam estado)

**`packages/ai/src/graph/subgraph.test.ts`** — stubs substituídos por testes unitários:
- Child graph compilado usado como node em parent graph
- Resultado do child propagado de volta ao estado do parent
- Sem dependência de banco de dados

## Commits

| Hash | Arquivo | Descrição |
|------|---------|-----------|
| `f7f1c32` | `state.ts` | feat: BrainStateAnnotation schema (AI-03) |
| `1044b80` | `state.test.ts` | test: real assertions para state |
| `89f5439` | `checkpointer.ts` | feat: createCheckpointer factory (AI-01, MEM-01) |
| `9b13cc3` | `checkpointer.test.ts` | test: integration tests (SC-1) |
| `9430f8e` | `subgraph.test.ts` | test: subgraph pattern unit tests (AI-02) |

## Invariantes verificadas

- `MemorySaver` ausente de todos os arquivos não-test em `packages/ai/src/graph/`
- Nenhum campo `Set | Map | Date | Buffer` em `state.ts`
- `createCheckpointer` chama `setup()` antes de retornar
- Testes de integração fazem skip gracioso sem `TEST_DATABASE_URL`

## Dependências satisfeitas para Wave 3

Wave 3 (memory package) pode agora importar:
- `BrainStateAnnotation` e `BrainState` de `packages/ai/src/graph/state.ts`
- `createCheckpointer` de `packages/ai/src/graph/checkpointer.ts`
