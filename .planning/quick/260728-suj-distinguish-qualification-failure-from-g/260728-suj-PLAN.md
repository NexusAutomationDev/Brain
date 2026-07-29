---
phase: quick-260728-suj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/brain-sdr/src/qualifier.ts
  - apps/brain-sdr/src/brain.ts
  - packages/core/src/events/event-publisher.ts
  - packages/core/src/runner/runner.ts
  - packages/core/src/index.ts
  - apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts
  - apps/brain-sdr/src/__tests__/integration/qualify.test.ts
  - packages/core/src/events/__tests__/unit/event-publisher.test.ts
autonomous: true
requirements: [D-1, D-2, D-3, D-4, D-5]
must_haves:
  truths:
    - "runQualificationAgent devolve qualificado: boolean | null — null significa 'não foi possível analisar', e ambos os caminhos de falha (catch do nó analyze e catch externo/DATABASE_URL ausente) produzem null, nunca false"
    - "Quando qualificado é null, saveQualificationToMemories() não é chamada — a linha memories (user_id, key='qualification') do lead permanece exatamente como estava antes da falha"
    - "Quando qualificado é null, a ToolMessage serializada carrega status: \"error\" e o BrainRunner não publica esse evento no canal de saída (webhook ou RabbitMQ)"
    - "Quando qualificado é boolean, a payload serializada permanece byte-idêntica à atual — sem campo status — e o evento continua sendo publicado normalmente"
    - "A ToolMessage devolvida ao loop ReAct em caso de falha diz explicitamente que a qualificação não foi realizada e que o lead não deve ser tratado como desqualificado"
    - "isErrorToolResult é uma regra genérica em packages/core, aplicável a qualquer tool de qualquer Brain, não um special-case de qualify_lead"
  artifacts:
    - apps/brain-sdr/src/qualifier.ts
    - packages/core/src/events/event-publisher.ts
    - packages/core/src/runner/runner.ts
  key_links:
    - "brain.ts boundQualifyTool e qualifier.ts qualifyLeadTool usam o MESMO serializeQualificationResult — nenhum dos dois monta a string JSON à mão"
    - "runner.ts importa isErrorToolResult de ../events/event-publisher.js e o consulta dentro do loop de construção de ToolEvent, antes do toolEvents.push()"
    - "O guard de persistência em qualifier.ts (qualificado !== null) envolve a chamada saveQualificationToMemories já existente — não uma cópia dela"
---

<objective>
Separar falha técnica de desqualificação real no sub-agente de qualificação do brain-sdr.

Purpose: hoje `qualificado: false` significa três coisas indistinguíveis — o LLM decidiu que o lead não serve, o `llm.invoke()`/`JSON.parse()` falhou dentro do nó `analyze`, ou o acesso ao histórico falhou. Isso já causou dano em produção: um evento real chegou ao webhook com `{"qualificado":false,"motivo":"Não foi possível analisar o histórico",...}` para o lead "Gabriel" — nada foi analisado, mas o sistema externo lê como lead desqualificado. Pior, `saveQualificationToMemories()` usa `ON CONFLICT DO UPDATE`, então um erro transitório de LLM sobrescreve uma qualificação `true` genuína já gravada.

Output: um terceiro estado explícito (`null`) que não é persistido, não é publicado como evento, e é comunicado ao LLM principal como "não foi possível qualificar" em vez de "lead rejeitado".
</objective>

<context>
@.planning/STATE.md
@apps/brain-sdr/src/qualifier.ts
@apps/brain-sdr/src/brain.ts
@packages/core/src/runner/runner.ts
@packages/core/src/events/event-publisher.ts

# Decisões travadas com o usuário — não revisitar:
# D-1  Retorno tri-state: qualificado: boolean | null. Ambos os caminhos de falha → null.
# D-2  qualificado === null → não chamar saveQualificationToMemories(). Preserva o valor anterior.
# D-3  qualificado === null → não publicar evento qualify_lead como desqualificação.
#      Seam escolhido: marcador genérico status:"error" na payload + filtro no runner.
#      Justificativa: o nome da tool é a única chave que o whitelist do runner enxerga, então
#      o seam (a) "tool devolve algo que o whitelist reconhece" não existe sem renomear a tool.
#      Filtrar no runner mantém a regra genérica e reusável (packages/), sem hardcode de
#      qualify_lead. brain-support não tem tool de qualificação (brain.ts:103-105), então
#      nenhum outro Brain é afetado hoje; a regra vale para qualquer tool futura.
# D-4  A ToolMessage ainda informa o LLM principal que a qualificação não ocorreu.
# D-5  FORA DE ESCOPO: descobrir POR QUE o LLM falhou. Sem retry, sem mexer em createLLM(),
#      sem tocar em configuração de provider.

# Testes rodam com `bun test`. Commits seguem CLAUDE.md (Conventional Commits + emoji,
# título em inglês, imperativo, ≤72 chars).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Tri-state no qualifier e guard de persistência (brain-sdr)</name>
  <files>apps/brain-sdr/src/qualifier.ts, apps/brain-sdr/src/brain.ts</files>
  <action>
Em `apps/brain-sdr/src/qualifier.ts`:

Exportar uma interface `QualificationResult` com `qualificado: boolean | null`, `motivo: string`, `proximo_passo: string`, documentando que `null` significa "não foi possível analisar" e NÃO é desqualificação (per D-1).

Definir duas constantes de falha no topo do módulo, ambas com `qualificado: null` e textos que dizem explicitamente ao LLM principal que a qualificação não ocorreu e que o lead não deve ser tratado como desqualificado (per D-4):
- uma para a falha do nó `analyze` (falha ao analisar o histórico)
- uma para a falha externa (falha ao acessar o histórico) — esta continua sendo a variável chamada `fallback` dentro de `runQualificationAgent`, retornada via `return fallback`, porque o teste estático em `qualifier.unit.test.ts` casa com `/return fallback/`.

Reescrever o nó `analyze` (linhas ~113-148): em vez de inicializar `qualificado = false` e sobrescrever no sucesso, o bloco `try` retorna o objeto de sucesso e o `catch` retorna a constante de falha. Dentro do `try`, após o `JSON.parse`, se `typeof parsed.qualificado !== "boolean"`, lançar um `Error` descritivo — resposta do modelo sem o campo booleano é resultado inutilizável, não um `false` (per D-1). `motivo` e `proximo_passo` continuam com defaults quando o modelo omite as strings, mas só no caminho de sucesso. Manter o `logger.warn` do catch, ajustando a mensagem para deixar claro que está devolvendo `null` e que isso não é uma desqualificação.

Em `runQualificationAgent` (linhas ~170-251): tipar o retorno como `Promise<QualificationResult>`. Trocar `result.qualificado ?? false` por `result.qualificado ?? null` na montagem de `finalResult`. Envolver a chamada existente de `saveQualificationToMemories(...)` num guard `if (finalResult.qualificado !== null)` (per D-2) — não duplicar a chamada, apenas condicioná-la; no `else`, emitir um `logger.warn` com `sessionId` registrando que o resultado foi indeterminado, que `memories` foi preservado e que nenhum evento será publicado. O caminho de `DATABASE_URL` ausente e o `catch` externo continuam retornando `fallback` — que agora carrega `qualificado: null`.

Adicionar e exportar `serializeQualificationResult(result: QualificationResult): string` — o único lugar que converte o resultado em string de ToolMessage (per D-3). Quando `qualificado === null`, devolve `JSON.stringify({ status: "error", ...result })`. Quando é booleano, devolve `JSON.stringify(result)` sem campo extra, mantendo a payload byte-idêntica à atual para não quebrar o consumidor já integrado ao webhook. Documentar no JSDoc que `status: "error"` é o marcador lido por `isErrorToolResult` em `packages/core/src/events/event-publisher.ts`.

Trocar o `JSON.stringify(result)` do handler de `qualifyLeadTool` (linha ~273) por `serializeQualificationResult(result)`.

Em `apps/brain-sdr/src/brain.ts`: adicionar `serializeQualificationResult` ao import vindo de `./qualifier.js` (linha 19) e trocar o `return JSON.stringify(result)` do `boundQualifyTool` (linha ~126) por `return serializeQualificationResult(result)`. Não alterar nada mais no arquivo.
  </action>
  <verify>
    <automated>cd /root/Brain && grep -q "qualificado: boolean | null" apps/brain-sdr/src/qualifier.ts && grep -q "export function serializeQualificationResult" apps/brain-sdr/src/qualifier.ts && grep -q "finalResult.qualificado !== null" apps/brain-sdr/src/qualifier.ts && grep -q "serializeQualificationResult(result)" apps/brain-sdr/src/brain.ts && ! grep -q "JSON.stringify(result)" apps/brain-sdr/src/brain.ts && grep -q "return fallback" apps/brain-sdr/src/qualifier.ts && bunx tsc --noEmit -p apps/brain-sdr/tsconfig.json 2>/dev/null || bun build apps/brain-sdr/src/qualifier.ts --target=bun --outdir=/tmp/qcheck >/dev/null && echo OK</automated>
  </verify>
  <done>runQualificationAgent devolve `null` em ambos os caminhos de falha; memories só é escrito quando o resultado é booleano; a serialização da ToolMessage passa por serializeQualificationResult nos dois call sites (qualifyLeadTool e boundQualifyTool); payload de sucesso inalterada.</done>
</task>

<task type="auto">
  <name>Task 2: Regra genérica de resultado-com-erro no canal de eventos (packages/core)</name>
  <files>packages/core/src/events/event-publisher.ts, packages/core/src/runner/runner.ts, packages/core/src/index.ts</files>
  <action>
Em `packages/core/src/events/event-publisher.ts`: exportar `isErrorToolResult(content: string): boolean`. Faz `JSON.parse` do conteúdo e devolve `true` somente quando o resultado é um objeto (não-null, não-array) cujo campo `status` é exatamente a string `"error"`. Qualquer erro de parse devolve `false` — conteúdo não-JSON (texto puro) segue sendo publicado normalmente, preservando o comportamento atual de todas as outras tools.

Documentar no JSDoc que é um contrato genérico do SDK, não um special-case de `qualify_lead`: uma tool que devolve `status: "error"` está sinalizando que a operação não foi executada, portanto o resultado não representa um desfecho de negócio e não deve virar evento externo; a ausência do campo `status` significa sucesso, então nenhuma payload existente muda de comportamento.

Em `packages/core/src/runner/runner.ts`: adicionar `isErrorToolResult` ao import de valor já existente na linha 31 (`import { EventPublisher } from "../events/event-publisher.js";`) — o import da linha 30 é `import type` e não serve para funções.

Dentro do loop de construção de `ToolEvent` (linhas ~390-411), depois do teste de whitelist e ANTES do `toolEvents.push(...)`: extrair o conteúdo para uma const (`typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)`), consultar `isErrorToolResult(...)` e, quando verdadeiro, emitir um `this.logger.warn` com o nome da tool e o `threadId` explicando que o resultado está marcado como erro e o evento não será publicado, e então `continue`. Reaproveitar essa mesma const no campo `result` do `toolEvents.push(...)` em vez de repetir a expressão ternária. Não alterar a whitelist, a semântica fire-and-forget, nem qualquer outra parte do bloco.

Em `packages/core/src/index.ts`: adicionar `isErrorToolResult` ao export de valores da linha 48 (`export { EventPublisher, NoopEventPublisher } ...`), e exportar o tipo `QualificationResult`? Não — esse tipo é do brain-sdr, não do core. Apenas `isErrorToolResult`.
  </action>
  <verify>
    <automated>cd /root/Brain && grep -q "export function isErrorToolResult" packages/core/src/events/event-publisher.ts && grep -q "isErrorToolResult" packages/core/src/runner/runner.ts && grep -q "isErrorToolResult" packages/core/src/index.ts && grep -q "continue;" packages/core/src/runner/runner.ts && echo OK</automated>
  </verify>
  <done>isErrorToolResult existe em packages/core, é exportada pelo índice do pacote, e o runner pula a publicação de qualquer resultado de tool marcado com status "error" — sem hardcode do nome qualify_lead e sem alterar o comportamento de resultados não marcados.</done>
</task>

<task type="auto">
  <name>Task 3: Atualizar e ampliar testes</name>
  <files>apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts, apps/brain-sdr/src/__tests__/integration/qualify.test.ts, packages/core/src/events/__tests__/unit/event-publisher.test.ts</files>
  <action>
Em `apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts`:
- No teste "retorna objeto fallback válido quando DATABASE_URL não está definida" (linha ~14), trocar `expect(result.qualificado).toBe(false)` por `expect(result.qualificado).toBeNull()` e renomear o `describe`/`test` para refletir que falha técnica devolve `null`, não `false` (per D-1). Manter as asserções de `motivo`/`proximo_passo` como strings não-vazias.
- Adicionar um `describe` novo para `serializeQualificationResult`, com três testes: (1) resultado com `qualificado: null` produz JSON cujo `status` é `"error"`; (2) resultado com `qualificado: false` produz JSON SEM a chave `status` e com `qualificado === false` — este é o teste que trava a compatibilidade da payload de sucesso; (3) resultado com `qualificado: true` idem, sem `status`.
- Adicionar um teste de análise estática, no mesmo estilo dos já existentes no arquivo, garantindo que `saveQualificationToMemories` está sob um guard de `!== null` no código de produção (per D-2) — casar o texto do guard em `codeLines`.

Em `apps/brain-sdr/src/__tests__/integration/qualify.test.ts` (todos os testes são `test.skip`, manter assim): no segundo teste, `expect(result.qualificado).toBe(false)` (linha ~32) está errado sob o novo contrato — sessão sem checkpoint não é falha, o LLM roda com histórico vazio e decide. Trocar por uma asserção que aceite os três estados (`true`, `false` ou `null`) e ajustar o comentário acima dela. No primeiro teste, `expect(typeof result.qualificado).toBe("boolean")` (linha ~17) idem — aceitar booleano ou null.

Em `packages/core/src/events/__tests__/unit/event-publisher.test.ts`: adicionar um `describe` para `isErrorToolResult` cobrindo — payload com `status: "error"` → `true`; payload sem `status` (usar a fixture existente `'{"qualificado":true}'`) → `false`; payload com `status: "ok"` → `false`; string não-JSON (`"ok"`) → `false`; array JSON (`"[]"`) → `false`; `"null"` → `false`. Importar a função do mesmo módulo já importado na linha 52.

Rodar `bun test` na raiz e garantir zero falhas.
  </action>
  <verify>
    <automated>cd /root/Brain && bun test 2>&1 | tail -20</automated>
  </verify>
  <done>`bun test` passa sem falhas; os testes travam o contrato tri-state, a compatibilidade da payload de sucesso e o comportamento de isErrorToolResult.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| LLM output → parser do sub-agente | Texto gerado pelo modelo atravessa `extractJSON` + `JSON.parse` e vira estado de negócio |
| ToolMessage → EventPublisher → sistema externo | Conteúdo de tool result sai do processo para webhook/RabbitMQ de terceiro |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-260728-suj-01 | Tampering | `isErrorToolResult` lendo `status` de payload derivada de saída de LLM | medium | mitigate | O campo `status` é escrito exclusivamente por `serializeQualificationResult` no servidor, a partir de `qualificado === null` — nunca copiado da resposta do modelo. Um modelo que emita `"status":"error"` no próprio JSON não altera o resultado: o parse só aceita a resposta quando `qualificado` é booleano, e nesse caminho o serializer não adiciona `status`. Pior caso é supressão de um evento, nunca publicação de um falso positivo |
| T-quick-260728-suj-02 | Repudiation | Evento suprimido silenciosamente | low | mitigate | Toda supressão emite `logger.warn` com nome da tool e `threadId`; a falha original já emite `logger.warn` com o `err` — a trilha existe nos logs mesmo sem o evento externo |
| T-quick-260728-suj-03 | Information Disclosure | `logger.warn` da supressão no runner | low | mitigate | Loga apenas `toolName` e `threadId`, nunca a payload — mantém a regra T-20-02 já vigente no arquivo (PII de lead fora dos logs) |
| T-quick-260728-suj-SC | Tampering | Supply chain | low | accept | Nenhuma dependência nova é adicionada — a mudança é inteiramente código local |
</threat_model>

<verification>
- `bun test` na raiz passa sem falhas
- `grep -q "qualificado: boolean | null" apps/brain-sdr/src/qualifier.ts` casa
- Nenhum `JSON.stringify(result)` cru resta em `apps/brain-sdr/src/brain.ts` — a serialização passa por `serializeQualificationResult`
- `grep -rn "qualify_lead" packages/core/src/events/event-publisher.ts` NÃO casa — a regra do canal de eventos é genérica, sem hardcode do brain-sdr
- `git diff --stat` mostra apenas os arquivos listados em `files_modified`
</verification>

<success_criteria>
- Uma falha de LLM ou de banco durante a qualificação devolve `qualificado: null`, não `false`
- A linha de `memories` do lead sobrevive intacta a uma falha de qualificação
- O consumidor do webhook/RabbitMQ não recebe evento algum quando a qualificação falhou — em vez de receber uma desqualificação falsa
- Uma qualificação bem-sucedida (`true` ou `false`) continua sendo persistida e publicada com payload idêntica à atual
- O LLM principal recebe um texto que diz explicitamente que a qualificação não foi realizada e que o lead não deve ser tratado como desqualificado
- Commits seguem CLAUDE.md: `🐛 fix(brain-sdr): ...` e `🐛 fix(core): ...`, título em inglês, ≤72 chars
</success_criteria>

<output>
Create `.planning/quick/260728-suj-distinguish-qualification-failure-from-g/260728-suj-SUMMARY.md` when done
</output>
