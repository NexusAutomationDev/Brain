# Phase 10: Output Parser SDK - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

O SDK define e aplica um contrato de saída estruturado. Após essa fase, todo Brain retorna `BrainOutput` com `fullResponse` e `responseMode` obrigatórios — string plana deixa de ser output válido. A validação é feita pelo BrainRunner via Zod e falha em runtime com erro explícito.

Scope: mudanças em `packages/core` (schema + runner), `packages/ai` (BrainStateAnnotation), e migração do `brain-echo`. Brain SDR é migrado na Fase 12.

</domain>

<decisions>
## Implementation Decisions

### responseMode — Valores do enum

- **D-01:** `responseMode` representa o **tipo de mídia** da resposta, não o estado da conversa nem o modo de entrega.
- **D-02:** Valores válidos: `"text" | "image" | "audio" | "document"` (Zod enum).
- **D-03:** Quando `responseMode !== "text"`, os campos `mediaType` e `mediaUrl` passam a ser obrigatórios (validação condicional no Zod schema via `.refine()`).
- **D-04:** `mediaType` é **string livre** (MIME type, ex: `"image/jpeg"`, `"audio/ogg"`, `"application/pdf"`). Não é um enum — os tipos MIME são numerosos e a integração downstream (WhatsApp Business API) define os tipos aceitos.
- **D-05:** `mediaUrl` é string contendo URL externa. Upload direto (base64) está fora de escopo em v1.2.

### Origem do JSON estruturado

- **D-06:** O **nó do grafo** é responsável por montar o `BrainOutput` manualmente após invocar o LLM. Sem `.withStructuredOutput()` — o LLM retorna string, o nó wraps em BrainOutput.
- **D-07:** Fluxo dentro do nó: `llm.invoke([...])` → extrai `content` como string → monta `{ fullResponse: content, responseMode: "text" }` → seta `state.brainOutput`.

### BrainStateAnnotation — novo campo

- **D-08:** `BrainStateAnnotation` (em `packages/ai/src/graph/state.ts`) ganha o campo `brainOutput: BrainOutput | null`.
- **D-09:** Reducer: last-write wins (`(_, b) => b`). Default: `() => null`.
- **D-10:** `BrainOutput` é importado de `@brain-pkg/core` no `BrainStateAnnotation` — core exporta o tipo/schema, ai o usa no state.

### API pública — retorno do BrainRunner

- **D-11:** `BrainRunner.run()` passa a retornar `Promise<BrainOutput | null>` diretamente (sem wrapper). `null` quando `ia_ativada = false`.
- **D-12:** O tipo `BrainRunResult` (`{ reply: string }`) é **removido** do SDK. Breaking change controlado — apenas `handler.ts` dos Brains consome esse tipo.
- **D-13:** Após `compiledGraph.invoke()`, BrainRunner lê `result.brainOutput` e valida com `BrainOutputSchema.parse()`. Se inválido (null ou schema mismatch), **lança erro** — nunca retorna silenciosamente.

### Claude's Discretion

- Localização do schema: `packages/core/src/output/schema.ts`
- Classe de erro na validação: usar `ConfigurationError` existente (de `@brain-pkg/shared`) ou criar `BrainOutputValidationError` — a critério do planejador
- Exportação no barrel do core: `BrainOutputSchema`, `BrainOutput`, `ResponseMode`
- brain-echo migration: o nó `"llm"` existente recebe extensão que seta `brainOutput` no estado retornado

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §PARSER-01, §PARSER-02 — requirements mapeados para esta fase

### Roadmap
- `.planning/ROADMAP.md` §Phase 10 — success criteria definitivos (4 critérios com checagem exata)

### Core SDK (arquivos a modificar)
- `packages/core/src/brain/interface.ts` — IBrain atual (buildGraph, BrainBuildContext)
- `packages/core/src/runner/runner.ts` — BrainRunner.run() atual retorna { reply: string }; BrainRunResult a ser removido
- `packages/core/src/index.ts` — barrel de exports do core; BrainOutputSchema/BrainOutput devem ser adicionados

### AI Package (arquivo a modificar)
- `packages/ai/src/graph/state.ts` — BrainStateAnnotation atual; ganha campo brainOutput

### Brain Echo (a ser migrado)
- `apps/brain-echo/src/brain.ts` — único Brain migrado na Fase 10; nó "llm" deve setar state.brainOutput

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConfigurationError` em `@brain-pkg/shared` — candidato a reutilizar para erros de validação de BrainOutput
- `BrainStateAnnotation` em `packages/ai/src/graph/state.ts` — padrão `Annotation.Root({ ... })` já estabelecido
- `packages/core/src/runner/runner.ts` linhas 225-229 — extração da última AIMessage (padrão a ser substituído por leitura de `result.brainOutput`)

### Established Patterns
- Zod está presente indiretamente via LangGraph/LangChain; verificar se é dependência direta do `packages/core`
- Exportações explícitas no barrel (`index.ts`) — padrão do projeto, sem `export *`
- `last-write wins` reducer já usado em outros campos do BrainStateAnnotation — seguir mesmo padrão

### Integration Points
- `BrainRunner.run()` é o ponto de entrada único dos transports (webhook e RabbitMQ) — a mudança de retorno afeta `handler.ts` do brain-echo e brain-sdr (brain-sdr migra na Fase 12)
- `packages/ai/src/index.ts` — verificar se precisa re-exportar o tipo `BrainOutput` ou se só `BrainStateAnnotation` é suficiente

</code_context>

<specifics>
## Specific Ideas

- Campo `fullResponse` é sempre obrigatório mesmo quando há mídia — contém texto de acompanhamento ou legenda
- A validação condicional `mediaType`/`mediaUrl` deve usar Zod `.refine()` ou `.superRefine()` para checagem cruzada de campos
- O nó do brain-echo deve setar `responseMode: "text"` como default (só texto por ora)

</specifics>

<deferred>
## Deferred Ideas

- Suporte a `video` como valor de `responseMode` — avaliado pós-v1.2 se necessário
- `mediaType` como enum restrito — futuro se precisarmos validar MIME types aceitos pelo WhatsApp
- Upload base64 (mediaUrl com conteúdo embutido) — fora de escopo em v1.2
- `responseMode: "end" | "pause"` ligado ao estado da conversa — decidido que isso pertence às tools da Fase 11

</deferred>

---

*Phase: 10-output-parser-sdk*
*Context gathered: 2026-06-14*
