# Quick Task 260614-u9h Summary

## O que foi feito

### Task 1: Fix no nó `llm` em `brain.ts`
**Arquivo:** `apps/brain-sdr/src/brain.ts`

Antes:
```ts
return { messages: [...state.messages, response] };
```
Depois:
```ts
return { messages: [response] };  // padrão LangGraph — retorna só o delta
```

**Por quê:** `messagesStateReducer` faz o merge por ID automaticamente. Retornar o array completo é não-standard e pode causar duplicação ou comportamento inesperado ao salvar o checkpoint no PostgresSaver. O padrão correto é retornar só a mensagem nova (delta).

### Task 2: Salvar mensagem do usuário em `saveContext()` — `runner.ts`
**Arquivo:** `packages/core/src/runner/runner.ts`

Antes:
```ts
profileValue: { lastReply: reply, conversationId: threadId }
```
Depois:
```ts
profileValue: { lastUserMessage: event.Message, lastReply: reply, conversationId: threadId }
```

**Por quê:** Ambos os lados da conversa (usuário + IA) agora ficam na tabela `memories` para consulta direta.

## Arquitetura explicada

O histórico completo da conversa (mensagens humanas + respostas da IA) fica nas **tabelas de checkpoint do LangGraph** (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`) criadas pelo `PostgresSaver.setup()`. Essas tabelas são gerenciadas automaticamente via `thread_id`.

A tabela `memories` é para dados de perfil de longo prazo. Com a correção, ela agora tem `{ lastUserMessage, lastReply, conversationId }` — ambos os lados do último turno.

## Status
- ✅ Build: 16/16 passando
- ✅ Testes: 30 testes passando
