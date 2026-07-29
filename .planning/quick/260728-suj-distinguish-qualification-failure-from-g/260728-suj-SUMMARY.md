---
phase: quick-260728-suj
plan: 01
status: complete
date: 2026-07-28
commits:
  - c7ed49b  # 🐛 fix(brain-sdr): return null when qualification cannot run
  - 35f5390  # 🐛 fix(core): skip publishing tool results marked as errors
  - 6eabe7d  # ✅ test: cover tri-state qualification and error-result filtering
files_modified:
  - apps/brain-sdr/src/qualifier.ts
  - apps/brain-sdr/src/brain.ts
  - packages/core/src/events/event-publisher.ts
  - packages/core/src/runner/runner.ts
  - packages/core/src/index.ts
  - apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts
  - apps/brain-sdr/src/__tests__/integration/qualify.test.ts
  - packages/core/src/events/__tests__/unit/event-publisher.test.ts
---

# Quick Task 260728-suj — Summary

## Problema

O sub-agente de qualificação do brain-sdr colapsava três desfechos diferentes em
`qualificado: false`:

1. o LLM decidiu que o lead não tem fit (veredito real);
2. `llm.invoke()` ou `JSON.parse()` falhou dentro do nó `analyze`;
3. `DATABASE_URL` ausente ou `PostgresSaver.getTuple()` falhou.

Observado em produção — evento entregue ao webhook para o lead "Gabriel":

```json
{"qualificado":false,"motivo":"Não foi possível analisar o histórico",
 "proximo_passo":"Continue a conversa normalmente para coletar mais informações"}
```

Nada foi analisado, mas o sistema externo lê como lead desqualificado. Além disso
`saveQualificationToMemories()` usa `ON CONFLICT (user_id, key) DO UPDATE`, então um
erro transitório de LLM sobrescrevia uma qualificação `true` genuína já gravada.

## O que mudou

**`apps/brain-sdr/src/qualifier.ts`**
- Novo tipo exportado `QualificationResult` com `qualificado: boolean | null`.
- Nó `analyze` reescrito: o `try` devolve o objeto de sucesso, o `catch` devolve
  `ANALYSIS_FAILED` (`qualificado: null`). Resposta do modelo sem o campo booleano
  agora lança e cai no catch — antes virava um `false` que ninguém emitiu.
- `fallback` do caminho externo também passa a carregar `null`.
- `saveQualificationToMemories()` só é chamada quando `finalResult.qualificado !== null`;
  no caso indeterminado emite `logger.warn` e preserva o registro anterior.
- Novo `serializeQualificationResult()` — ponto único de serialização da ToolMessage.
  Falha ganha `status: "error"`; sucesso permanece byte-idêntico ao formato anterior.
- Textos de falha reescritos para dizer ao LLM principal que a qualificação não
  ocorreu e que o lead **não** deve ser tratado como desqualificado.

**`apps/brain-sdr/src/brain.ts`**
- `boundQualifyTool` usa `serializeQualificationResult` em vez de `JSON.stringify` cru.

**`packages/core/src/events/event-publisher.ts`**
- Nova `isErrorToolResult(content)`: `true` apenas para objeto JSON com
  `status === "error"`. Contrato genérico do SDK — sem hardcode de `qualify_lead`.
  Não-JSON, array, `null` e ausência de `status` devolvem `false`, preservando o
  comportamento de todas as tools existentes.

**`packages/core/src/runner/runner.ts`**
- No loop de construção de `ToolEvent`, resultados marcados como erro são pulados com
  `logger.warn` (`toolName` + `threadId` apenas — regra T-20-02 de PII mantida).
- Expressão ternária de extração de conteúdo consolidada numa const reaproveitada.

**`packages/core/src/index.ts`** — `isErrorToolResult` exportada pelo índice do pacote.

## Decisão de design

O seam escolhido para D-3 foi o marcador `status: "error"` + filtro no runner. A
alternativa (fazer a tool devolver algo que o whitelist do runner reconheça) não existe
sem renomear a tool — `TOOL_EVENTS_WHITELIST` só enxerga `msg.name`. Filtrar no runner
mantém a regra genérica e reusável em `packages/`, aplicável a qualquer tool futura.
`brain-support` não tem tool de qualificação (`brain.ts:103-105`), então nenhum outro
Brain é afetado.

Sucesso mantém a payload sem campo `status` de propósito: o consumidor já integrado ao
webhook não vê nenhuma mudança no caminho feliz.

## Verificação

| Item | Resultado |
|---|---|
| `bun test` (raiz) | 473 pass / 86 fail |
| Baseline em `e272edb` | 463 pass / 86 fail |
| Suítes falhando | Conjunto **idêntico** (20 suítes) antes e depois |
| Arquivos tocados, em isolamento | 37 pass / 0 fail |

Zero regressão; +10 testes passando. As 86 falhas são pré-existentes — testes de
integração que exigem PostgreSQL/credenciais de LLM reais, mais poluição de
`mock.module` entre arquivos na execução da suíte inteira (`EventPublisher` passa
isolada e falha no batch, tanto antes quanto depois da mudança).

## Fora de escopo

Diagnosticar **por que** o `llm.invoke()` falhou no caso do Gabriel (rate limit,
credencial, saída malformada) ficou explicitamente de fora — sem retry, sem mexer em
`createLLM()`, sem tocar em configuração de provider. Com o `logger.warn` do catch
(`"Qualification sub-agent: analysis failed"`, que carrega o `err`), os logs do
container no horário do evento dizem qual foi a causa. Candidato a `/gsd-debug`.

## Impacto operacional

Quando a qualificação falhar, o endpoint `TOOL_EVENTS_URL` deixa de receber **qualquer**
evento para aquela chamada — antes recebia uma desqualificação falsa. Se o fluxo do n8n
depende de receber algo em toda invocação de `qualify_lead`, ele precisa tolerar a
ausência; a alternativa (publicar com `status: "error"` para o consumidor filtrar) foi
descartada por decisão do usuário.
