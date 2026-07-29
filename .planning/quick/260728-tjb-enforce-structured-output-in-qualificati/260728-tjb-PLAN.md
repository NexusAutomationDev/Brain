---
phase: quick-260728-tjb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/ai/src/llm/fallback.ts
  - packages/ai/src/__tests__/unit/llm-fallback.test.ts
  - apps/brain-sdr/src/qualifier.ts
  - apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts
autonomous: true
requirements: [D-1, D-2, D-3, D-4]
must_haves:
  truths:
    - "withModelFallback intercepta withStructuredOutput e devolve um runnable que percorre a MESMA cadeia de fallback — o modelo primário indisponível degrada para o próximo em vez de derrubar a chamada"
    - "O nó analyze do sub-agente obtém {qualificado, motivo, proximo_passo} via withStructuredOutput com schema Zod — sem extractJSON, sem JSON.parse manual"
    - "Resposta que não satisfaz o schema continua caindo no catch e devolvendo qualificado: null (contrato tri-state de quick-260728-suj preservado)"
    - "A contagem de mensagens do histórico é logada em nível info, visível com LOG_LEVEL=info, provando quantas mensagens o sub-agente recebeu"
  artifacts:
    - packages/ai/src/llm/fallback.ts
    - apps/brain-sdr/src/qualifier.ts
  key_links:
    - "structuredOutputTrap é montado a partir do mesmo array `chain` que boundToolsTrap, então as duas rotas compartilham a mesma cadeia de modelos"
    - "qualifier.ts chama llm.withStructuredOutput(...) no objeto devolvido por createLLM() — que é o proxy, não o modelo cru"
---

<objective>
Fazer o sub-agente de qualificação obter seu resultado via structured output (schema Zod
imposto pelo provider) em vez de pedir JSON por prompt e parsear na mão, e tornar visível
em produção quantas mensagens de histórico ele recebeu.

Purpose: o debug `qualify-lead-falso-negativo-json-shape` mostrou que o modelo respondeu,
o `JSON.parse` teve sucesso, mas o objeto não tinha os campos esperados — e isso passou
silenciosamente como `qualificado: false`. O contrato de saída existia só como texto no
prompt; nenhum modelo era obrigado a cumpri-lo. Com 100% do tráfego caindo no
`gemini-3.1-flash-lite` (primário em 503 constante), um modelo fraco bastou para quebrar
o contrato. Além disso o log que diria se o histórico chegou é `debug`, invisível sob
`LOG_LEVEL=info`.

Output: schema imposto pelo provider + observabilidade do histórico em nível info.
</objective>

<context>
@.planning/debug/qualify-lead-falso-negativo-json-shape.md
@packages/ai/src/llm/fallback.ts
@apps/brain-sdr/src/qualifier.ts

# BLOQUEADOR DESCOBERTO NA ANÁLISE — motivo do Task 1:
# withModelFallback() devolve um Proxy que só intercepta `invoke` e `bindTools`
# (fallback.ts:139-160, 187-209). Qualquer outro método cai no ramo
# `return value.bind(obj)` e fica ligado ao modelo PRIMÁRIO.
# Portanto `llm.withStructuredOutput(...)` hoje devolveria um runnable preso ao
# gemini-3.5-flash — o modelo que está em 503 em 100% das chamadas. Usar structured
# output sem o Task 1 deixaria a qualificação ESTRITAMENTE PIOR do que está hoje:
# em vez de degradar para o flash-lite, falharia por completo.
# O próprio arquivo já documenta esse raciocínio para o bindTools (linhas 167-172):
# "Cobrir só o primeiro deixaria justamente o Brain que quebrou em produção sem proteção."

# Decisões travadas:
# D-1  Trap de withStructuredOutput em packages/ai — espelha exatamente o boundToolsTrap.
# D-2  Sub-agente usa withStructuredOutput com schema Zod; extractJSON e JSON.parse saem.
# D-3  Contrato tri-state de quick-260728-suj intacto: falha → qualificado: null.
# D-4  Log de histórico vira info, com aiCount/humanCount. Sem PII além do sessionId,
#      que já aparece em outra linha info (brain.ts:120).

# Testes rodam com `bun test`. Commits seguem CLAUDE.md.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Preservar a cadeia de fallback em withStructuredOutput (packages/ai)</name>
  <files>packages/ai/src/llm/fallback.ts, packages/ai/src/__tests__/unit/llm-fallback.test.ts</files>
  <action>
Em `packages/ai/src/llm/fallback.ts`, dentro de `withModelFallback`, adicionar um
`structuredOutputTrap` construído exatamente como o `boundToolsTrap` já existente:

- guardar `const supportsStructuredOutput = typeof primary.withStructuredOutput === "function"`;
- quando suportado, o trap expõe `withStructuredOutput(outputSchema, config)` que mapeia o
  array `chain` (o MESMO usado pelo boundToolsTrap — é isso que garante que as duas rotas
  compartilham a cadeia) para `{label, runnable: c.model.withStructuredOutput(outputSchema, config)}`,
  converte para `Invocable[]` e devolve `proxyWithInvoke(bound[0].runnable, ...)` chamando
  `invokeChain(candidates, input, options)`;
- passar `{ ...boundToolsTrap, ...structuredOutputTrap }` como `extraTraps` na chamada final
  de `proxyWithInvoke`.

Atualizar o JSDoc de `withModelFallback` para listar as três rotas cobertas
(`invoke`, `bindTools().invoke()`, `withStructuredOutput().invoke()`) e registrar por que:
método não interceptado fica preso ao primário via `value.bind(obj)`.

Em `packages/ai/src/__tests__/unit/llm-fallback.test.ts`, adicionar `withStructuredOutput`
ao `FakeChatModel` (mesmo formato de `bindTools`: devolve um objeto com `invoke` delegando
a `this.invoke`, para que `INVOCATIONS` registre qual modelo atendeu) e um teste de
regressão espelhando o de `bindTools` (linha ~113): com o primário em 503, o runnable de
`withStructuredOutput` deve ser atendido pelo fallback e `INVOCATIONS` deve conter os dois
modelos na ordem certa.
  </action>
  <verify>
    <automated>cd /root/Brain && grep -q "structuredOutputTrap" packages/ai/src/llm/fallback.ts && bun test packages/ai/src/__tests__/unit/llm-fallback.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>withStructuredOutput() no objeto devolvido por createLLM() percorre a cadeia de fallback; teste de regressão prova que o fallback atende quando o primário está em 503.</done>
</task>

<task type="auto">
  <name>Task 2: Structured output e log de histórico no sub-agente (brain-sdr)</name>
  <files>apps/brain-sdr/src/qualifier.ts</files>
  <action>
Definir `QualificationOutputSchema` com `z.object({ qualificado: z.boolean(), motivo:
z.string(), proximo_passo: z.string() })`, cada campo com `.describe(...)` em português
descrevendo o que o modelo deve preencher — as descrições viram parte do schema enviado ao
provider e substituem a instrução textual que existia no prompt.

Reescrever o `try` do nó `analyze`:
- guard defensivo: se `typeof llm.withStructuredOutput !== "function"`, lançar Error
  descritivo (cai no catch existente → `qualificado: null`, comportamento seguro);
- `const structuredLlm = llm.withStructuredOutput(QualificationOutputSchema, { name: "qualificacao_lead" })`;
- invocar com as mesmas duas mensagens (system = `state.qualificationPrompt`, human =
  descrição + histórico), mas **remover do human message o trecho
  `Responda EXCLUSIVAMENTE em JSON: {...}`**. Comentar o motivo: com structured output o
  provider já impõe o shape, e mandar o modelo "responder em JSON" o induz a emitir JSON
  como texto em vez de preencher a tool/schema — exatamente o caminho que falhou.
- usar o objeto retornado diretamente (já validado pelo schema), mantendo os defaults de
  string vazia para `motivo`/`proximo_passo`.

Manter o `catch` como está (log + `{ ...ANALYSIS_FAILED }`) — o contrato tri-state de
quick-260728-suj não muda.

Remover a função `extractJSON` e seu comentário: vira código morto. Conferir antes com
grep que ela não é usada em nenhum outro ponto do repo.

Trocar o `logger.debug` de `"Qualification agent: history fetched"` (linha ~219) por
`logger.info`, mantendo `{ sessionId, aiCount, humanCount }`. Comentar que o nível é info
de propósito: sob `LOG_LEVEL=info` (padrão de produção, `.env.example:68`) o debug nunca
aparece, e sem essa linha não há como provar se o sub-agente recebeu histórico — lacuna
identificada no debug `qualify-lead-falso-negativo-json-shape`.
  </action>
  <verify>
    <automated>cd /root/Brain && grep -q "withStructuredOutput" apps/brain-sdr/src/qualifier.ts && ! grep -q "extractJSON" apps/brain-sdr/src/qualifier.ts && ! grep -q "JSON.parse" apps/brain-sdr/src/qualifier.ts && grep -q 'logger.info' apps/brain-sdr/src/qualifier.ts && bun build apps/brain-sdr/src/qualifier.ts --target=bun --outdir=/tmp/qcheck2 >/dev/null && echo OK</automated>
  </verify>
  <done>O nó analyze obtém o resultado via schema imposto pelo provider; extractJSON/JSON.parse removidos; contagem de histórico logada em info.</done>
</task>

<task type="auto">
  <name>Task 3: Atualizar testes do qualifier</name>
  <files>apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts</files>
  <action>
O bloco de análise estática "qualifier.ts — análise estática de anti-patterns" checa
padrões que mudaram. Revisar cada asserção contra o novo arquivo e ajustar só o que
quebrou, preservando a intenção original de cada teste (Pitfall 4, CR-01, PGB-TD01 seguem
válidos e não devem ser afetados).

Adicionar testes de análise estática para as garantias novas:
- `withStructuredOutput` presente e `JSON.parse` ausente no código de produção — trava a
  regressão para o parse manual que causou o falso negativo;
- o log de `history fetched` usa `logger.info`, não `logger.debug`.

Rodar `bun test` e comparar o total de falhas com o baseline atual (86 falhas
pré-existentes, 20 suítes — testes de integração que exigem Postgres/credenciais reais).
Nenhuma suíte nova pode entrar nessa lista.
  </action>
  <verify>
    <automated>cd /root/Brain && bun test 2>&1 | tail -8</automated>
  </verify>
  <done>`bun test` sem regressão contra o baseline; novos testes travam structured output e o nível do log.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Saída do LLM → estado de negócio | Resposta do modelo vira veredito de qualificação |
| Log de produção → operador | Linha nova em nível info, agregada por coletor de logs |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-260728-tjb-01 | Tampering | Schema Zod imposto ao provider | low | mitigate | O schema é definido no servidor, constante de módulo; nada nele vem de input do lead ou do prompt do tenant. Saída fora do schema é rejeitada pelo langchain e cai no catch → `null` |
| T-quick-260728-tjb-02 | Information Disclosure | `logger.info` com aiCount/humanCount | low | mitigate | Loga apenas contadores e `sessionId` — nunca conteúdo de mensagem. `sessionId` já é logado em info por `brain.ts:120`, então não amplia a superfície |
| T-quick-260728-tjb-03 | Denial of Service | Trap de withStructuredOutput instanciando N runnables | low | accept | Um runnable por modelo da cadeia, criado uma vez por chamada — mesmo custo já aceito no boundToolsTrap |
| T-quick-260728-tjb-SC | Tampering | Supply chain | low | accept | Nenhuma dependência nova; `withStructuredOutput` já existe em `@langchain/core@1.1.48` e é sobrescrito nativamente por `@langchain/google-genai@2.1.31` |
</threat_model>

<verification>
- `bun test packages/ai/src/__tests__/unit/llm-fallback.test.ts` passa, incluindo o novo teste de regressão
- `grep -q "JSON.parse" apps/brain-sdr/src/qualifier.ts` NÃO casa
- `bun test` na raiz não adiciona nenhuma suíte à lista de falhas pré-existentes
- `git diff --stat` mostra apenas os arquivos de `files_modified`
</verification>

<success_criteria>
- O provider impõe o shape do resultado da qualificação; prompt deixa de ser o único contrato
- Fallback de modelo continua valendo na rota de structured output
- Falha de schema continua produzindo `qualificado: null`, sem gravar em memories e sem evento
- Operador consegue ver, com LOG_LEVEL=info, quantas mensagens o sub-agente recebeu
- Commits: `✨ feat(ai): ...` e `♻️ refactor(brain-sdr): ...`, título em inglês, ≤72 chars
</success_criteria>

<output>
Create `.planning/quick/260728-tjb-enforce-structured-output-in-qualificati/260728-tjb-SUMMARY.md` when done
</output>
