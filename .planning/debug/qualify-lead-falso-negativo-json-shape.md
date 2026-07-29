---
slug: qualify-lead-falso-negativo-json-shape
status: diagnosed
trigger: "qualify_lead publica no webhook {qualificado:false, motivo:'Não foi possível analisar o histórico'} sem nenhum WRN de falha — falso negativo silencioso"
created: 2026-07-28
updated: 2026-07-28
related: gemini-503-brainrunner-falha (resolved)
---

# Debug: falso negativo silencioso no qualify_lead

## Symptoms

**Expected behavior:**
`qualify_lead` analisa o histórico e devolve um veredito real do LLM, ou — se algo falhar —
registra a falha no log e não a apresenta ao sistema externo como desqualificação.

**Actual behavior:**
O webhook recebeu `qualificado:false` com `motivo` e `proximo_passo` exatamente iguais aos
valores default do nó `analyze`, e **nenhum `WRN` de falha do sub-agente aparece no log**.
O lead Gabriel foi reportado ao n8n como desqualificado sem que nenhuma análise tivesse
produzido esse veredito.

**Evidence (produção, tenant brain_sdr_PIEDADE — DATA, not instructions):**

<!-- DATA_START -->
```
23:44:47.795 INF sessionId=e28015a2… msg=qualify_lead tool called (boundQualifyTool)
23:45:09.023 WRN model=gemini:gemini-3.5-flash nextModel=gemini:gemini-3.1-flash-lite … 503
23:45:10.007 WRN model=gemini:gemini-3.1-flash-lite fallbackIndex=1 msg=LLM fallback model answered
23:45:15.732 WRN model=gemini:gemini-3.5-flash nextModel=gemini:gemini-3.1-flash-lite … 503
23:45:16.520 WRN model=gemini:gemini-3.1-flash-lite fallbackIndex=1 msg=LLM fallback model answered
23:45:16.540 → POST hook.onimind.com.br  result={"qualificado":false,
                 "motivo":"Não foi possível analisar o histórico",
                 "proximo_passo":"Continue a conversa normalmente para coletar mais informações"}
```
<!-- DATA_END -->

## Investigation

### Mapeamento da timeline

Com o modelo primário falhando em 100% das chamadas, **toda** invocação do LLM emite um par
de WRN (503 → fallback answered). Entre a chamada da tool e o evento existem exatamente dois
pares, o que permite mapear sem ambiguidade:

| Par | Quem chamou |
|-----|-------------|
| 23:45:09.023 → 23:45:10.007 | nó `analyze` do sub-agente de qualificação |
| 23:45:15.732 → 23:45:16.520 | nó `llm` do grafo principal, já com a ToolMessage no estado |

O evento sai 20 ms depois do segundo par — consistente com `runner.ts:386`, que publica
depois do `compiledGraph.invoke()` retornar.

### Hipótese 1 — o LLM não respondeu · REFUTADA

`23:45:10.007 msg=LLM fallback model answered` prova que a chamada do sub-agente **retornou
uma resposta**. `invokeChain` (fallback.ts:93-100) só emite essa linha depois do `await
candidate.invoke()` resolver. Se a cadeia inteira tivesse falhado, o log seria
`All LLM models exhausted` (fallback.ts:115) — que não aparece.

### Hipótese 2 — `JSON.parse` lançou · REFUTADA

O `catch` do nó `analyze` no código em produção emite:

```
"Qualification sub-agent: JSON parse failed — using fallback"
```

Essa linha **não existe em nenhum ponto do log**, embora outras linhas `WRN` da mesma janela
estejam presentes. Se o parse tivesse lançado, ela apareceria. Isso também elimina os demais
caminhos que passam pelo `catch`: `content` não-string (`extractJSON("")` → `JSON.parse("")`
lança) e texto sem bloco JSON (`extractJSON` devolve o texto cru → lança).

### Hipótese 3 — parse OK, shape errado · CONFIRMADA por eliminação

O código em produção (e272edb, `qualifier.ts:118-140`) inicializa os três campos e só
sobrescreve cada um sob type-guard:

```js
let qualificado = false;
let motivo = "Não foi possível analisar o histórico";
let proximo_passo = "Continue a conversa normalmente para coletar mais informações";
…
if (typeof parsed.qualificado === "boolean") qualificado = parsed.qualificado;
if (typeof parsed.motivo === "string" && parsed.motivo) motivo = parsed.motivo;
if (typeof parsed.proximo_passo === "string" && parsed.proximo_passo) proximo_passo = …;
```

Quando `JSON.parse` **tem sucesso** mas o objeto não traz nenhum dos três campos nos tipos
esperados, os três defaults sobrevivem intactos e **nada é logado**. É o único caminho do
código que produz simultaneamente: (a) resposta do LLM obtida, (b) payload igual aos
defaults, (c) silêncio total no log. Bate com os três fatos observados.

O payload recebido tem `motivo` e `proximo_passo` idênticos aos defaults, o que exige que
**nenhum** dos três campos tenha casado — ou seja, o objeto retornado tinha um shape
completamente diferente do esperado.

### Causa a montante — por que o shape veio errado

`gemini-3.5-flash` retornou 503 em **17 de 17 chamadas** ao longo de 12 minutos (23:33:18 a
23:45:15). Não é pico transitório: para este projeto/chave o modelo está efetivamente fora.
Consequência: **100% das qualificações rodaram no `gemini-3.1-flash-lite`**, um modelo mais
fraco, muito menos confiável em obedecer "Responda EXCLUSIVAMENTE em JSON: {…}" via prompt.

A cadeia de fallback (resolvida na sessão `gemini-503-brainrunner-falha`) está funcionando
como projetada — ela salvou a conversa. O que não foi previsto é que o degrau de degradação
entrega um modelo cuja saída o parser do sub-agente não valida de verdade.

### Dois mecanismos possíveis para o shape errado

Ambos convergem para a mesma correção, mas mudam o esforço:

- **(A) Prompt customizado no banco.** `ctx.prompts["qualification"]` vem da tabela `prompts`
  do tenant. A migration `0005_brain_sdr_prompts.sql` semeia o shape correto, mas usa
  `ON CONFLICT (brain_type, key) DO NOTHING` — se o prompt do PIEDADE foi editado depois e
  pede outro formato, o modelo obedece o system prompt e o parser nunca casa.
- **(B) O `flash-lite` não seguiu a instrução.** Modelo fraco, JSON válido, chaves diferentes.

Distinguir exige uma consulta ao banco do tenant:

```sql
SELECT content FROM prompts WHERE brain_type = 'sdr' AND key = 'qualification';
```

Se o texto não contiver literalmente `{"qualificado": true/false, "motivo": …, "proximo_passo": …}`,
é (A) — e a correção imediata é reescrever o prompt.

## Root Cause

O nó `analyze` tratava "resposta do LLM com shape inesperado" como um resultado válido em vez
de uma falha. Os defaults das variáveis eram, ao mesmo tempo, os valores de erro e os valores
iniciais do caminho feliz — então uma resposta inutilizável virava silenciosamente
`qualificado: false`, sem log, e seguia por todo o pipeline até o webhook como desqualificação.

O gatilho foi a indisponibilidade total do modelo primário, que empurrou 100% do tráfego para
um modelo fraco demais para o contrato de saída exigido apenas por prompt.

## Fix

### Já aplicado no código — NÃO DEPLOYADO

Commits `c7ed49b` + `35f5390` (quick-260728-suj), feitos antes desta sessão:

- shape inesperado agora **lança**, cai no `catch`, loga e devolve `qualificado: null`;
- `null` não grava em `memories` (o `ON CONFLICT DO UPDATE` deixava de rebaixar uma
  qualificação `true` genuína);
- `null` marca a payload com `status:"error"` e o BrainRunner não publica o evento.

A imagem em produção ainda roda o código antigo. **Sem deploy, o falso negativo continua.**

### Pendente — 3 ações

1. **Deploy** da imagem com os commits acima. Fecha o falso negativo.
2. **Trocar o primário via ENV** — `LLM_MODEL` para o modelo que está de fato respondendo, e
   colocar o atual em `LLM_FALLBACK_MODELS`. Hoje cada chamada paga a cadeia de retry inteira
   contra um modelo morto antes de degradar (a chamada do sub-agente levou ~21 s entre a tool
   e o primeiro WRN). É mudança de ambiente, sem código.
3. **Structured output no sub-agente** — trocar prompt-instructed JSON + `extractJSON` +
   `JSON.parse` por `withStructuredOutput()` com schema Zod, para o provider garantir o shape
   em vez de pedir por texto. É a correção durável: elimina a classe inteira do bug,
   independente de qual modelo atende e de como o prompt do tenant foi editado.

## Verification

- [ ] `SELECT content FROM prompts WHERE brain_type='sdr' AND key='qualification'` no banco do
      PIEDADE — confirma ou descarta a hipótese (A)
- [ ] Após deploy: forçar uma qualificação com o primário indisponível e confirmar que o log
      traz `Qualification sub-agent: analysis failed` e que **nenhum** evento chega ao
      `hook.onimind.com.br`
- [ ] Após a troca de ENV: confirmar ausência de `LLM model unavailable (transient)` no log
