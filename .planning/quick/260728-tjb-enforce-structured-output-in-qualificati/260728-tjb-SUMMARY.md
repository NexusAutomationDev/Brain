---
phase: quick-260728-tjb
plan: 01
status: complete
date: 2026-07-28
commits:
  - a11c230  # ✨ feat(ai): extend model fallback to withStructuredOutput
  - 8dfffe0  # ♻️ refactor(brain-sdr): enforce qualification schema via provider
  - d40558e  # 🐛 fix(observability): tolerate malformed LOG_LEVEL instead of crashing
  - b11e370  # ✅ test(observability): run LOG_LEVEL guard tests in a subprocess
files_modified:
  - packages/ai/src/llm/fallback.ts
  - packages/ai/src/__tests__/unit/llm-fallback.test.ts
  - apps/brain-sdr/src/qualifier.ts
  - apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts
  - packages/observability/src/logger.ts
  - packages/observability/src/__tests__/unit/logger-level.test.ts
---

# Quick Task 260728-tjb — Summary

## O que foi entregue

### 1. Fallback de modelo na rota de structured output (`packages/ai`)

**Bloqueador descoberto durante a análise, fora do escopo original.** `withModelFallback()`
devolve um Proxy que só intercepta `invoke` e `bindTools`; qualquer outro método cai em
`value.bind(obj)` e fica ligado ao modelo **primário**. Usar `withStructuredOutput()` sem
tratar isso amarraria o sub-agente ao `gemini-3.5-flash` — o modelo em 503 em 100% das
chamadas — deixando a qualificação **estritamente pior** do que estava: em vez de degradar
para o flash-lite, falharia por completo.

`structuredOutputTrap` foi montado sobre o mesmo array `chain` do `boundToolsTrap`, então
as três rotas (`invoke`, `bindTools`, `withStructuredOutput`) degradam pela mesma sequência
de modelos. Teste de regressão espelha o de `bindTools`.

### 2. Schema imposto pelo provider (`apps/brain-sdr`)

`QualificationOutputSchema` (Zod) passa a ser o contrato de saída, via
`withStructuredOutput(schema, { name: "qualificacao_lead" })`. `extractJSON` e o
`JSON.parse` manual foram removidos.

A instrução `Responda EXCLUSIVAMENTE em JSON: {...}` saiu da mensagem human de propósito:
com structured output o provider já impõe o shape, e mandar o modelo "responder em JSON" o
induz a emitir texto no lugar de preencher o schema — exatamente o caminho que falhou em
produção. As descrições dos campos Zod passaram a carregar essa instrução, indo ao provider
como parte do schema.

Guard defensivo: provider sem `withStructuredOutput` lança e cai no catch → `qualificado:
null`. O contrato tri-state de `quick-260728-suj` está intacto.

`logger.debug` do `history fetched` virou `logger.info`. Sob `LOG_LEVEL=info` (padrão de
produção) a linha nunca era impressa, e sem ela não havia como provar se o sub-agente
recebeu histórico ou analisou o vazio.

### 3. LOG_LEVEL malformado não derruba mais o container (`packages/observability`)

**Incidente reportado pelo usuário durante a execução desta tarefa.** Produção parou com:

```
error: default level:=info must be included in custom levels
    at pino (pino.js:165:3)
    at /app/packages/ai/dist/llm/fallback.js:2:16
```

Causa: `LOG_LEVEL==info` no compose produz o valor `"=info"`. `pino()` lança em nível
desconhecido, e `createLogger()` roda em import time em vários módulos — o container morria
no boot, com stack trace apontando para o pino em vez da ENV.

`resolveLogLevel()` valida contra os níveis do pino, normaliza case/espaços e cai para
`info` com um aviso que **inclui o valor recebido**, para o operador achar o typo. Crash
reproduzido antes do fix e verificado depois.

## Verificação

| Item | Resultado |
|---|---|
| `bun test` (raiz) | 484 pass / 87 fail |
| Baseline em `e272edb` | 463 pass / 86 fail |
| Suítes falhando | Conjunto **idêntico** (20 suítes) — `diff` vazio |
| `llm-fallback.test.ts` isolado | 34 pass / 0 fail |
| `qualifier.unit.test.ts` isolado | 20 pass / 0 fail |
| `logger-level.test.ts` isolado | 6 pass / 0 fail |

**Sobre 86 → 87:** a falha extra é o novo teste `withStructuredOutput` dentro da suíte
`createLLM — fallback de modelo…`, que **já constava do baseline** como falhando por
inteiro. Essa suíte passa 34/34 isolada e quebra no run completo por poluição de
`mock.module` entre arquivos — problema pré-existente do repo, o mesmo que afeta
`EventPublisher`. Nenhuma suíte nova entrou na lista.

O teste de LOG_LEVEL bateu no mesmo problema (6 arquivos fazem
`mock.module("@brain-pkg/observability")`, substituindo `createLogger` por um stub sem
`.level`). Resolvido rodando cada caso em subprocesso — que além de imune à poluição
reproduz literalmente a condição de boot do container.

## Impacto operacional

1. **`LOG_LEVEL==info` no compose precisa virar `LOG_LEVEL=info`.** O fix impede o crash,
   mas o valor segue errado e o aviso vai aparecer no stdout a cada boot.
2. O sub-agente passa a exigir um provider com structured output. Todos os providers do
   `factory.ts` (openai, anthropic, gemini) suportam — `@langchain/core@1.1.48` traz
   implementação default e `@langchain/google-genai@2.1.31` sobrescreve nativamente.
3. Após o deploy, cada qualificação emite uma linha info com `aiCount`/`humanCount` —
   é ela que responde definitivamente se o histórico chegou.

## Pendências herdadas do debug

Continuam em aberto, sem relação com o código deste repo:

- trocar `LLM_MODEL` para o modelo que está de fato respondendo (item 2 do debug
  `qualify-lead-falso-negativo-json-shape`) — hoje cada chamada paga a cadeia de retry
  inteira contra um modelo morto;
- conferir o prompt `qualification` no banco do tenant PIEDADE.
