---
phase: 16-dynamic-responsemode
verified: 2026-06-16T15:52:30Z
status: human_needed
score: 6/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Disparar mensagem de voz (ex: 'me fala sobre isso') para o Brain SDR com provider OpenAI real e verificar que brainOutput.responseMode === 'audio'"
    expected: "LLM invoca a respond tool com responseMode='audio' no contexto de pedido de resposta por áudio"
    why_human: "SC#1 do ROADMAP requer comportamento LLM em runtime com provider real — não testável com mocks unitários"
  - test: "Disparar mensagem de voz para o Brain SDR com provider Anthropic real e verificar que brainOutput.responseMode está preenchido corretamente"
    expected: "Mesmo código de grafo produz BrainOutput válido com responseMode correto em Anthropic — sem branching por provider"
    why_human: "SC#3 requer multi-provider em runtime — os testes unitários usam mocks de LLM, não providers reais"
---

# Phase 16: Dynamic responseMode Verification Report

**Phase Goal:** LLM escolhe responseMode (text/audio/image) dinamicamente via schema-as-tool — sem valor hardcoded no código, funcionando em OpenAI e Anthropic
**Verified:** 2026-06-16T15:52:30Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                    | Status      | Evidence                                                                                                                          |
|----|--------------------------------------------------------------------------------------------------------------------------|-------------|-----------------------------------------------------------------------------------------------------------------------------------|
| 1  | createRespondTool() retorna tool LangChain com nome 'respond' e schema Zod com fullResponse, responseMode, mediaType, mediaUrl | ✓ VERIFIED | `packages/core/src/tools/respond.ts` exporta factory; bun test respond.test.ts → 10 pass; spot-check: `t.name === "respond"` |
| 2  | ResponseMode type em packages/shared inclui 'undefined' como valor válido                                               | ✓ VERIFIED  | `packages/shared/src/types/index.ts` linha 13: `"undefined" \| "text" \| "image" \| "audio" \| "video" \| "document"`          |
| 3  | ResponseModeSchema Zod em packages/core inclui 'undefined' no enum                                                      | ✓ VERIFIED  | `packages/core/src/output/schema.ts` linha 9: `"undefined"` no enum; schema.test.ts → 13 pass                                   |
| 4  | BrainOutputSchema.parse() aceita responseMode: 'undefined' sem lançar ZodError                                          | ✓ VERIFIED  | Testado em schema.test.ts; `BrainOutputSchema.parse({ fullResponse: "oi", responseMode: "undefined" })` → não lança              |
| 5  | createRespondTool está exportada pelo barrel packages/core/src/index.ts                                                  | ✓ VERIFIED  | `packages/core/src/index.ts` linha 33: `export { createRespondTool } from "./tools/respond.js"`                                  |
| 6  | brain-sdr não tem responseMode hardcoded — nó llm usa responseMode: 'undefined' no fallback D-10                        | ✓ VERIFIED  | `grep "responseMode.*text.*as const" apps/brain-sdr/src/brain.ts` → 0 ocorrências; fallback em linha 120: `"undefined" as const` |
| 7  | LLM retorna responseMode "audio" ou "image" quando o contexto exige (SC#1 ROADMAP)                                      | ? UNCERTAIN | Mecanismo implementado (schema suporta "audio", "image" via mediaType+mediaUrl); comportamento real com LLM requer verificação humana |

**Score:** 6/7 truths verified

**Nota sobre SC#1:** O ROADMAP menciona "audio ou image" — o design D-03 (documentado em 16-CONTEXT.md) optou por colocar apenas `["undefined", "text", "audio"]` no `responseMode` da tool, tratando "image" via `mediaType+mediaUrl`. Esta é uma decisão de arquitetura intencional e documentada, não uma omissão. A capacidade técnica de sinalizar "audio" dinamicamente está verificada por testes. O comportamento em runtime com LLM real requer verificação humana (SC#1 e SC#3).

### Deferred Items

Nenhum item diferido — todos os must-haves são escopo desta fase.

### Required Artifacts

| Artifact                                                      | Esperado                                              | Status      | Detalhes                                                                         |
|---------------------------------------------------------------|-------------------------------------------------------|-------------|----------------------------------------------------------------------------------|
| `packages/core/src/tools/respond.ts`                          | Factory createRespondTool() com schema Zod v4         | ✓ VERIFIED  | 86 linhas; superRefine; z.string().url(); PITFALL-6 na description               |
| `packages/core/src/tools/__tests__/respond.test.ts`           | 10 testes unitários RESP-01 e RESP-02                | ✓ VERIFIED  | 10 pass, 0 fail                                                                  |
| `packages/core/src/__tests__/unit/output/schema.test.ts`      | Casos "undefined" no BrainOutputSchema               | ✓ VERIFIED  | 13 pass (11 existentes + 2 novos)                                                |
| `apps/brain-sdr/src/brain.ts`                                 | Grafo com routeAfterLlm + nó respond                 | ✓ VERIFIED  | routeAfterLlm (6 ocorrências); ToolMessage; addEdge respond→__end__              |
| `apps/brain-echo/src/brain.ts`                                | Grafo idêntico com hasMcpTools guard                 | ✓ VERIFIED  | hasMcpTools (5 ocorrências); routeAfterLlm (5 ocorrências); ToolMessage          |
| `apps/brain-sdr/src/__tests__/unit/brain.test.ts`             | 16 testes (14 atualizados + 2 novos)                 | ✓ VERIFIED  | 16 pass — inclui toHaveLength(4), toBe("undefined"), routeAfterLlm tests         |
| `apps/brain-echo/src/__tests__/unit/brain.test.ts`            | 15 testes (10 existentes + 5 novos)                  | ✓ VERIFIED  | 15 pass — inclui guarda ToolNode vazio, audio responseMode                       |
| `docs/guides/response-format-prompt.md`                       | Documentação schema-as-tool com createRespondTool()  | ✓ VERIFIED  | "schema-as-tool" (10 ocorrências), hasMcpTools, PITFALL-6, createRespondTool     |

### Key Link Verification

| From                              | To                                   | Via                                 | Status      | Detalhes                                                                         |
|-----------------------------------|--------------------------------------|-------------------------------------|-------------|----------------------------------------------------------------------------------|
| `packages/core/src/index.ts`      | `packages/core/src/tools/respond.ts` | `export { createRespondTool }`      | ✓ WIRED     | Linha 33 do barrel; pattern confirmado                                           |
| `apps/brain-sdr/src/brain.ts`     | `@brain-pkg/core`                    | `import { createRespondTool }`      | ✓ WIRED     | Linha 15: `createPauseSessionTool, createFinishConversationTool, createRespondTool` |
| `apps/brain-echo/src/brain.ts`    | `@brain-pkg/core`                    | `import { createRespondTool }`      | ✓ WIRED     | Linha 12: `import { createRespondTool } from "@brain-pkg/core"`                  |
| nó llm (brain-sdr)                | brainOutput fallback                 | `responseMode: "undefined" as const` | ✓ WIRED   | Linha 120: fallback D-10 com warn PITFALL-6                                      |
| nó respond (brain-sdr)            | brainOutput                          | `ToolMessage` + extração de args    | ✓ WIRED     | Linhas 141-175: lê respondCall.args, emite ToolMessage, seta brainOutput         |
| `packages/core/src/output/schema.ts` | `packages/shared/src/types/index.ts` | re-export ResponseMode type       | ✓ WIRED     | Linha 14 do schema.ts: `export type { ResponseMode } from "@brain-pkg/shared"`   |

### Data-Flow Trace (Level 4)

| Artifact                          | Variável de Dados     | Fonte                                  | Produz Dados Reais | Status     |
|-----------------------------------|-----------------------|----------------------------------------|--------------------|------------|
| `apps/brain-sdr/src/brain.ts` nó respond | `brainOutput.responseMode` | `respondCall.args.responseMode` (de `state.messages`) | Sim — lê do estado LangGraph | ✓ FLOWING |
| `apps/brain-echo/src/brain.ts` nó respond | `brainOutput.responseMode` | `respondCall.args.responseMode` (de `state.messages`) | Sim — lê do estado LangGraph | ✓ FLOWING |
| `apps/brain-sdr/src/brain.ts` nó llm (fallback D-10) | `brainOutput.responseMode` | `"undefined" as const` (literal) | Intencional — fallback hardcoded | ✓ FLOWING (por design) |

### Behavioral Spot-Checks

| Comportamento                                          | Comando                                                                        | Resultado              | Status   |
|--------------------------------------------------------|--------------------------------------------------------------------------------|------------------------|----------|
| createRespondTool exporta tool funcional com nome correto | `bun -e "import { createRespondTool }...; console.log(t.name)"` | `respond`              | ✓ PASS   |
| respond.test.ts — 10 testes unitários                  | `bun test packages/core/src/tools/__tests__/respond.test.ts`                  | 10 pass, 0 fail        | ✓ PASS   |
| schema.test.ts — casos "undefined"                     | `bun test packages/core/src/__tests__/unit/output/schema.test.ts`             | 13 pass, 0 fail        | ✓ PASS   |
| brain-sdr unit tests — 16 testes (responde + fallback D-10) | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts`              | 16 pass, 0 fail        | ✓ PASS   |
| brain-echo unit tests — 15 testes (guarda ToolNode vazio) | `bun test apps/brain-echo/src/__tests__/unit/brain.test.ts`               | 15 pass, 0 fail        | ✓ PASS   |
| packages/core suite completa                           | `bun test packages/core/`                                                      | 98 pass, 2 fail (pré-existentes: brain-runner.integration DB indisponível) | ✓ PASS (pré-existentes) |
| responseMode "text" as const removido de brain-sdr e brain-echo | `grep -rn "responseMode.*text.*as const" apps/`                   | 0 ocorrências          | ✓ PASS   |
| toolsCondition removido de ambos os brains             | `grep -rn "toolsCondition" apps/brain-sdr/.../brain.ts apps/brain-echo/.../brain.ts` | 0 ocorrências (exceto comentários) | ✓ PASS |
| Commits do SUMMARY existem no git                     | `git log --oneline \| grep 61faf77\|5c76749\|b995f39\|c6a79dd`               | 4 commits encontrados  | ✓ PASS   |

### Requirements Coverage

| Requisito | Plano | Descrição                                                                                     | Status       | Evidência                                                                                    |
|-----------|-------|-----------------------------------------------------------------------------------------------|--------------|----------------------------------------------------------------------------------------------|
| RESP-01   | 16-01, 16-02 | LLM escolhe responseMode dinamicamente como parte do BrainOutput — sem valor hardcoded    | ✓ SATISFIED  | createRespondTool() + routeAfterLlm + nó respond em brain-sdr e brain-echo                   |
| RESP-02   | 16-01, 16-02 | Conteúdo de fullResponse não é alterado pelo mecanismo de seleção de formato               | ✓ SATISFIED  | Nó respond passa `args.fullResponse` diretamente ao brainOutput sem reprocessamento; testado  |
| RESP-03   | 16-01, 16-02 | responseMode dinâmico funciona com OpenAI e Anthropic sem branching de código por provider | ? NEEDS HUMAN | bindTools() é API agnóstica de provider (RESP-03 comment em respond.ts); nenhum branching no código; comportamento real requer provider em runtime |

### Anti-Patterns Found

Nenhum anti-pattern encontrado. Varredura realizada em:
- `packages/core/src/tools/respond.ts`
- `apps/brain-sdr/src/brain.ts`
- `apps/brain-echo/src/brain.ts`
- `apps/brain-sdr/src/__tests__/unit/brain.test.ts`
- `apps/brain-echo/src/__tests__/unit/brain.test.ts`

Sem TODO, FIXME, placeholder, `return null`, ou implementações vazias. O único `return {}` é no caminho de erro do nó respond (`respondCall` não encontrado — estado inconsistente), o que é comportamento defensivo intencional.

### Human Verification Required

#### 1. SC#1 — LLM escolhe responseMode "audio" em runtime

**Test:** Enviar mensagem de voz ou solicitar explicitamente resposta em áudio (ex: "me responde em áudio, por favor") ao Brain SDR configurado com provider OpenAI real.
**Expected:** `brainOutput.responseMode === "audio"` — o LLM invoca a respond tool com o valor correto sem instrução explícita adicional no prompt além da description da tool.
**Why human:** SC#1 do ROADMAP ("LLM retorna responseMode 'audio' quando o contexto exige") requer comportamento LLM em runtime. Os testes unitários usam mocks de AIMessage com `tool_calls` pré-definidos — eles confirmam que o grafo PROCESSA corretamente um respond call com "audio", mas não testam se o LLM REAL escolhe "audio".

#### 2. SC#3 — Multi-provider: OpenAI e Anthropic

**Test:** Configurar Brain SDR com `LLM_PROVIDER=anthropic` e enviar mensagem idêntica. Comparar brainOutput com provider OpenAI.
**Expected:** Em ambos os providers, `brainOutput.responseMode` é preenchido corretamente (não fica hardcoded "text" nem undefined incorretamente). Mesmo código de grafo sem branching.
**Why human:** RESP-03 requer comportamento em runtime com Anthropic real. O código não tem branching por provider (verificado), mas o comportamento real do Anthropic com `bindTools()` e tool calling precisa ser confirmado em runtime.

### Gaps Summary

Não há gaps que bloqueiem o objetivo da fase. A implementação está completa e todos os artefatos verificados programaticamente passam.

Os 2 itens de verificação humana (SC#1 e SC#3) são verificações de comportamento LLM em runtime com providers reais — não podem ser cobertos por testes unitários com mocks. Eles confirmam que o mecanismo funciona de ponta a ponta em produção, não que foi implementado incorretamente.

Os 2 failures na suite `packages/core/` são pré-existentes (brain-runner.integration — banco de dados indisponível em ambiente de teste), documentados desde o 16-01-SUMMARY.md e não relacionados a esta fase.

---

_Verified: 2026-06-16T15:52:30Z_
_Verifier: Claude (gsd-verifier)_
