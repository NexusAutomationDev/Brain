# Quick Task 260614-u6j: Summary

**Task:** Ajustar reload-prompts para buscar e upsert prompts do banco de dados
**Date:** 2026-06-15
**Status:** Complete

## O que foi feito

### Novo campo `IBrain.defaultPrompts`

Adicionado campo opcional `defaultPrompts?: Record<string, string>` à interface `IBrain` em `packages/core/src/brain/interface.ts`. Brains que definem esse campo passam a ser a "fonte da verdade" para o conteúdo dos prompts.

### Nova função `upsertPrompts()`

Adicionada em `packages/core/src/prompts/loader.ts`. Faz `INSERT ... ON CONFLICT (brain_type, key) DO UPDATE SET content` — atualiza o conteúdo se o registro já existe, insere se não existe.

### `refreshPrompts()` atualizado

`BrainRunner.refreshPrompts()` agora segue o fluxo:
1. Se `brain.defaultPrompts` está definido → faz upsert ao banco
2. Carrega prompts do banco (`loadPrompts`)
3. Recompila o grafo

### Testes

- Mock de `upsertPrompts` adicionado ao `brain-runner.test.ts`
- 2 novos testes cobrindo: (a) chama `upsertPrompts` quando `defaultPrompts` definido, (b) NÃO chama quando `defaultPrompts` ausente
- 15/15 testes passando

## Fluxo de uso

```bash
# 1. Definir defaultPrompts no Brain (brain.ts)
export const sdrBrain: IBrain = {
  promptKeys: ["system", "qualification"],
  defaultPrompts: {
    system: "Você é um SDR...",
    qualification: "Classifique o lead...",
  },
  ...
}

# 2. Deploy do código atualizado

# 3. Chamar /reload-prompts — upserta ao DB e recarrega em memória
curl -X POST http://localhost:3000/reload-prompts \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```
