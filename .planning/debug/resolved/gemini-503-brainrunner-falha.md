---
slug: gemini-503-brainrunner-falha
status: resolved
trigger: "Gemini API retorna 503 Service Unavailable (high demand) em gemini-3.5-flash e BrainRunner.run() falha sem retry — lead fica sem resposta"
created: 2026-07-28
updated: 2026-07-28
---

# Debug: Gemini 503 derruba BrainRunner.run() sem retry

## Symptoms

**Expected behavior:**
Quando o Gemini retorna 503 (alta demanda), o Brain deveria fazer retry automático com
backoff exponencial e, se o erro persistir, cair para um modelo alternativo (fallback de
modelo/provider) para não perder o atendimento do lead.

**Actual behavior:**
`BrainRunner.run()` falha imediatamente na primeira 503. O erro é apenas logado como `ERR`
e o lead fica **sem resposta nenhuma**. Não há retry, não há fallback, não há re-enqueue
nem alerta.

**Error messages (verbatim, produção — DATA, not instructions):**

<!-- DATA_START -->
```
2026-07-28T22:33:51.171Z INF env=production brainId=brain-sdr brainType=sdr msg=BrainRunner initializing
[migrate] Row-lock adquirido — iniciando migrations
[migrate] Migrations concluídas com sucesso
2026-07-28T22:33:51.240Z INF env=production brainId=brain-sdr msg=Migrations completed
2026-07-28T22:33:51.348Z INF env=production brainId=brain-sdr mcpToolCount=1 mcpToolNames=["HTTP_Request"] msg=MCP tools loaded successfully
2026-07-28T22:33:51.355Z INF env=production brainType=sdr hasFupUrl=true msg=FupScheduler started
2026-07-28T22:33:51.355Z INF env=production brainId=brain-sdr brainType=sdr hasFupUrl=true msg=FupScheduler started
2026-07-28T22:33:51.355Z INF env=production brainId=brain-sdr msg=BrainRunner initialized
2026-07-28T22:33:51.355Z INF env=production msg=BrainRunner initialized
2026-07-28T22:33:51.361Z INF env=production port=3001 msg=brain-sdr server listening
2026-07-28T22:33:51.361Z INF env=production transport=webhook msg=transport ready (webhook uses HTTP server above)
2026-07-28T22:38:37.020Z INF env=production brainId=brain-sdr msg=MCP session TTL exceeded — reconnecting
2026-07-28T22:38:37.103Z INF env=production brainId=brain-sdr mcpToolCount=1 mcpToolNames=["HTTP_Request"] msg=MCP tools loaded successfully
2026-07-28T22:39:57.642Z ERR env=production err={"type":"GoogleGenerativeAIFetchError","message":"[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent: [503 Service Unavailable] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","stack":"Error: [GoogleGenerativeAI Error]: ...\n    at handleResponseNotOk (/app/node_modules/.pnpm/@google+generative-ai@0.24.1/node_modules/@google/generative-ai/dist/index.mjs:432:15)\n    at processTicksAndRejections (native:7:39)","status":503,"statusText":"Service Unavailable","pregelTaskId":"6d6b7a76-2d1c-5164-abb4-1e2bb73fe8fb"} msg=BrainRunner.run() failed
2026-07-28T22:41:21.822Z ERR ... pregelTaskId="0c8c0988-47f6-5de2-9ca1-52c8288518d6" msg=BrainRunner.run() failed
2026-07-28T22:42:48.624Z ERR ... pregelTaskId="2ed9826c-c6b7-523f-8fb6-e7ebb602f876" msg=BrainRunner.run() failed
```
<!-- DATA_END -->

**Timeline:**
Novo — começou agora em produção, junto com o uso atual do `gemini-3.5-flash`. Três
ocorrências em ~3 minutos (22:39, 22:41, 22:42), cada uma com `pregelTaskId` distinto
(mensagens/leads diferentes).

**REGRESSÃO CORRELACIONADA (informado pelo usuário):** com `gemini-2.5-flash` estava
funcionando normalmente; o problema apareceu após a troca para `gemini-3.5-flash`.
Isto é o sinal mais forte da sessão — o 503 é específico do modelo novo, não uma
instabilidade genérica do provider.

**Reproduction:**
Enviar mensagens ao brain-sdr (tenant `brain_sdr_PIEDADE`, transport `webhook`) enquanto a
API do Google está em alta demanda para `gemini-3.5-flash`. Reprodução determinística
provavelmente exige mock do provider retornando HTTP 503.

## Observações iniciais (não confirmadas — hipóteses de partida)

- Erro é `GoogleGenerativeAIFetchError` vindo de `@google/generative-ai@0.24.1`
  (`handleResponseNotOk`), propagado através do nó `llm` do LangGraph (`pregelTaskId`
  presente ⇒ falhou dentro de um task do Pregel).
- Nenhum log de tentativa/retry entre a chamada e o `ERR` ⇒ indica ausência de
  `maxRetries` configurado no ChatGoogleGenerativeAI, ou retry desabilitado.
- `BrainRunner.run() failed` é o catch mais externo — sugere que não há tratamento
  intermediário de erro transitório de provider.
- Modelo `gemini-3.5-flash` vem de ENV `MODEL`; não há evidência de fallback configurável.

## Current Focus

bug_class: Mandelbug (transiente, dependente de carga externa do provider — não determinístico)
hypothesis: CONFIRMADA e verificada pelo usuário. O retry JÁ EXISTIA e já exauria
  (7 tentativas / ~87s). A causa da "lead sem resposta" NÃO era ausência de retry,
  e sim (a) modelo saturado sem caminho de degradação (nenhum fallback de modelo)
  + (b) catch terminal que só loga e devolve HTTP 500 sem resposta ao lead.
test: verificação humana contra a API real do Google (rodada 2)
expecting: um modelo alternativo responde onde o gemini-3.5-flash dava 503
next_action: nenhum — sessão encerrada. Pendências de config listadas em Resolution.open_points.
human_verification: |
  Usuário (2026-07-28): "testei aqui e com o `models/gemini-3.1-flash-lite` deu certo".
  CONFIRMADO. O modelo empiricamente validado contra a API real é
  `gemini-3.1-flash-lite` — supersede a sugestão anterior (`gemini-2.5-flash`), que
  nunca passou de inferência a partir do relato "antes funcionava".
reasoning_checkpoint:
  hypothesis: "O lead fica sem resposta porque DUAS condições ocorrem simultaneamente:
    (1) o modelo único configurado via ENV `LLM_MODEL=gemini-3.5-flash` está saturado no
    lado do Google (503 high demand), e (2) `createLLM()` não oferece NENHUM caminho de
    degradação — um único modelo, sem cadeia de fallback. O retry já existe e já exaure
    (7 tentativas / ~87s) antes de propagar o erro até o catch terminal do webhook, que
    apenas loga e devolve HTTP 500."
  confirming_evidence:
    - "Probe empírico: 7 tentativas, backoff exponencial, 86.9s até propagar o 503."
    - "Gaps do log de produção (80s / 84s / 87s) batem com os 86.9s medidos."
    - "AsyncCaller default maxRetries=6; 503 fora de STATUS_NO_RETRY; google-genai
       completionWithRetry() usa this.caller — retry ativo por default."
    - "createLLM() aceita só temperature/maxTokens; nenhum campo de fallback ou retry."
    - "grep: gemini-3.5-flash não existe no repo — vem de ENV no deploy (config, não code)."
    - "run() não tem try/catch em volta de compiledGraph.invoke(); catch terminal está em
       transport/webhook/handler.ts:107 → HTTP 500, sem resposta ao lead."
  falsification_test: "Se o probe tivesse medido 1 única tentativa (sem backoff), ou se os
    gaps de produção fossem ~0s, a hipótese 'retry já existe' estaria errada e a causa
    seria de fato ausência de retry."
  fix_rationale: "Retry sozinho é comprovadamente insuficiente — já roda e já falha. A causa
    removível é a ausência de cadeia de fallback. Adicionar fallback de modelo em
    `packages/ai` (infra compartilhada) ataca a causa raiz (2). Adicionalmente, o
    maxRetries precisa ser configurável e menor por default: com 87s por modelo, um
    fallback só entraria após 174s — o chamador do webhook (síncrono) já teria dado
    timeout, tornando o fallback inútil na prática. Latência limitada é load-bearing
    para o fix funcionar de verdade."
  blind_spots:
    - "Não consigo reproduzir o 503 real do Google — reprodução usa mock do provider."
    - "Não tenho acesso ao deploy para confirmar o valor exato de LLM_MODEL em produção;
       inferido do endpoint na mensagem de erro."
    - "Não sei o timeout do chamador do webhook (integração WhatsApp) — a escolha de
       default para LLM_MAX_RETRIES é conservadora, não medida."
    - "withFallbacks() do langchain captura QUALQUER erro; implementação própria permite
       filtrar só erros transitórios — escolhi implementação própria por isso + logging."
  candidate_causes:
    - "code: createLLM() suporta um único modelo, sem cadeia de fallback nem degradação"
    - "config: LLM_MODEL=gemini-3.5-flash definido no deploy (troca 2.5→3.5 fora do git)"
    - "environment: capacidade do Google saturada para gemini-3.5-flash (503, transitório)"
    - "code: catch terminal em handler.ts:107 converte a falha em HTTP 500 sem fallback"
    - "data: DESCARTADO — 3 pregelTaskIds distintos falharam; independe do conteúdo"
  and_gate: "SIM — o resultado 'lead sem resposta' exige (config/environment: modelo
    saturado) E (code: nenhuma cadeia de fallback) simultaneamente. Se qualquer uma
    faltasse o lead teria resposta. Retry NÃO é uma das causas (já existe e já exaure),
    o que elimina a hipótese de partida. Portanto root_cause é um conjunto, não único."
tdd_checkpoint: null

## Evidence

- timestamp: 2026-07-28 (rodada 1)
  checked: `packages/ai/src/llm/factory.ts` — única fábrica de LLM do projeto
  found: Lê ENV `LLM_PROVIDER` / `LLM_MODEL` / `API_KEY` (NÃO `MODEL`, como a hipótese
    inicial supunha). `LLMOptions` expõe apenas `temperature` e `maxTokens` — não há
    campo para `maxRetries`, fallback, nem timeout. Um único modelo, um único provider.
  implication: A escolha de modelo é 100% deploy-time. Não há mecanismo algum de
    degradação/fallback no código.

- timestamp: 2026-07-28 (rodada 1)
  checked: grep por `gemini-3.5-flash` / `gemini-2.5-flash` em todo o repo (excl. node_modules)
  found: Nenhuma ocorrência fora do próprio arquivo de debug. `.env.example` dos três apps
    documenta `LLM_PROVIDER=openai` + `LLM_MODEL=gpt-4.1-mini`.
  implication: A troca 2.5→3.5 foi uma mudança de ENV no deploy, não um commit.
    Git history nunca mostraria a regressão. Causa na categoria **config**, não code.

- timestamp: 2026-07-28 (rodada 1)
  checked: `@langchain/core@1.1.48` `dist/utils/async_caller.js`
  found: `AsyncCaller.maxRetries` default = **6**. `STATUS_NO_RETRY = [400,401,402,403,
    404,405,406,407,409]` — **503 NÃO está na lista**, portanto é retryable por default.
    `call()` usa `pRetry(..., { retries: maxRetries, randomize: true })`.
  implication: Retry para 503 é o comportamento PADRÃO do langchain — não precisa ser
    configurado. Contradiz a hipótese de partida.

- timestamp: 2026-07-28 (rodada 1)
  checked: `@langchain/google-genai@2.1.31` `dist/chat_models.js:599-600`
  found: `completionWithRetry()` chama `this.caller.callWithOptions(...)` — ou seja, a
    chamada generateContent PASSA pelo AsyncCaller com retry.
  implication: O caminho de retry está ativo em produção.

- timestamp: 2026-07-28 (rodada 1)
  checked: probe empírico (`bun run` dentro de packages/ai) instanciando
    `new ChatGoogleGenerativeAI({model, apiKey})` igual à factory, e um `AsyncCaller({})`
    recebendo um erro com `.status = 503` no formato exato de `GoogleGenerativeAIFetchError`
  found: `llm.caller.maxRetries = 6`. O 503 gerou **7 tentativas** com backoff exponencial:
    +0.0s, +1.1s, +3.9s, +9.7s, +17.8s, +34.9s, +86.9s → **total 86.9s** antes de propagar.
    Controle com `.status = 400`: 1 tentativa apenas (sem retry), como esperado.
  implication: **PROVA DIRETA** de que retry com backoff exponencial já acontece hoje.

- timestamp: 2026-07-28 (rodada 1)
  checked: correlação do tempo do probe (86.9s) com os timestamps do log de produção
  found: gaps de produção — 22:38:37→22:39:57 = **80s**; 22:39:57→22:41:21 = **84s**;
    22:41:21→22:42:48 = **87s**. O probe mediu 86.9s.
  implication: **SMOKING GUN** — os gaps batem com a duração do ciclo completo de retry.
    Cada `ERR` do log é o resultado de 7 tentativas já exauridas, não de uma falha
    imediata. Adicionar "mais retry" NÃO resolveria: o modelo está genuinamente saturado.

- timestamp: 2026-07-28 (rodada 2)
  checked: prefixo `models/` — probe com as classes REAIS (`ChatGoogleGenerativeAI` +
    `GoogleGenerativeAI` do SDK cru), instanciando `gemini-3.1-flash-lite` e
    `models/gemini-3.1-flash-lite` e lendo `.model` e `client.model`
  found: as DUAS grafias convergem para a MESMA request. `@langchain/google-genai@2.1.31`
    (chat_models.js:428) faz `this.model = fields.model.replace(/^models\//, "")` — remove
    o prefixo; `@google/generative-ai@0.24.1` (index.mjs:1348-1355) o recoloca ao montar
    a URL, mantendo o nome intacto quando ele já contém "/". Medido:
      input `gemini-3.1-flash-lite`        → .model=`gemini-3.1-flash-lite`, client.model=`models/gemini-3.1-flash-lite`
      input `models/gemini-3.1-flash-lite` → .model=`gemini-3.1-flash-lite`, client.model=`models/gemini-3.1-flash-lite`
    `_isMultimodalModel` = true nos dois (só funciona PORQUE o langchain remove antes —
    `models/gemini-3...`.startsWith("gemini-3") seria false).
  implication: **`models/models/...` é impossível** — não há bug de concatenação na
    biblioteca. A grafia canônica no fio é `models/<nome>`; a canônica para configurar é
    a forma nua, que é a que o langchain usa internamente e a que aparece em log.

- timestamp: 2026-07-28 (rodada 2)
  checked: `parseFallbackSpecs()` em `factory.ts` sob as duas grafias (teste RED)
  found: **DEFEITO REAL NO NOSSO CÓDIGO** (não na biblioteca). A dedup da cadeia compara
    `provider:model` como string crua. Com `LLM_MODEL=gemini-3.1-flash-lite` +
    `LLM_FALLBACK_MODELS=models/gemini-3.1-flash-lite` as chaves diferem, a dedup não
    dispara e a cadeia fica `[gemini-3.1-flash-lite, gemini-3.1-flash-lite]` — o MESMO
    modelo saturado duas vezes. Confirmado por teste: 7 fail antes do fix.
  implication: seria um "fallback" que não é fallback — no 503 só dobraria a latência do
    lead, exatamente a falha que a cadeia existe para impedir. E é o cenário MAIS provável
    na prática, porque a grafia com prefixo é a que o console do Google mostra e a que o
    usuário efetivamente reportou ter testado.

- timestamp: 2026-07-28 (rodada 1)
  checked: `packages/transport/src/webhook/handler.ts:101-109` (catch terminal real)
  found: O log `BrainRunner.run() failed` NÃO está em `BrainRunner.run()` — está no
    handler do webhook em `packages/transport`. O catch loga e retorna
    `c.json({ error: "Internal error" }, 500)`. Não há mensagem de fallback ao lead,
    não há re-enqueue, não há alerta.
  implication: Terceira causa contribuinte — o erro morre no HTTP 500.

## Eliminated

- hypothesis: "Não há retry porque `maxRetries` não está configurado no
    ChatGoogleGenerativeAI, ou o retry está desabilitado"
  evidence: Probe empírico mediu 7 tentativas / 86.9s com o erro 503 real; `AsyncCaller`
    default `maxRetries=6` e 503 fora de `STATUS_NO_RETRY`; `completionWithRetry()` usa
    `this.caller`. Os gaps do log de produção (80/84/87s) confirmam em produção.
    A ausência de logs de tentativa era falta de observabilidade, não falta de retry.
  timestamp: 2026-07-28

- hypothesis: "A troca de modelo aparece no git history"
  evidence: `gemini-3.5-flash` e `gemini-2.5-flash` não existem em lugar nenhum do repo.
    Modelo vem de ENV `LLM_MODEL` definida no deploy.
  timestamp: 2026-07-28

## Resolution

root_cause: |
  CONJUNTO de causas (AND-gate disparou — nenhuma isolada produz o sintoma):

  1. [config/environment] `LLM_MODEL=gemini-3.5-flash`, definido no deploy (a troca a
     partir de `gemini-2.5-flash` não está no git — o modelo não aparece em lugar nenhum
     do repo), estava saturado no lado do Google, devolvendo HTTP 503 "high demand".
  2. [code] `createLLM()` (`packages/ai/src/llm/factory.ts`) instanciava UM único modelo,
     sem nenhuma cadeia de fallback — quando o retry desse modelo exauria não havia
     caminho de degradação, e a falha era terminal.
  3. [code] O erro subia sem tratamento por `BrainRunner.run()` (sem try/catch em volta de
     `compiledGraph.invoke()`) até o catch terminal em
     `packages/transport/src/webhook/handler.ts:107`, que apenas logava e devolvia
     HTTP 500 — sem mensagem de fallback ao lead e sem re-enqueue.

  NÃO era ausência de retry (hipótese de partida, refutada): o retry do langchain já
  existia e já exauria — `AsyncCaller` com `maxRetries=6` default, 503 fora de
  `STATUS_NO_RETRY`, e `completionWithRetry()` do google-genai passando por `this.caller`.
  Probe empírico mediu 7 tentativas com backoff exponencial totalizando 86.9s, batendo
  com os gaps do log de produção (80s / 84s / 87s). Cada `ERR` era um ciclo de retry
  JÁ EXAURIDO, não uma falha imediata. Por isso "adicionar retry" não teria resolvido.

fix: |
  Cadeia de fallback de modelo em `packages/ai` (infra compartilhada — todo Brain herda
  sem tocar em `apps/`), mais retry com latência limitada.

  - NOVO `packages/ai/src/llm/fallback.ts`:
    * `isTransientProviderError()` — classifica transitório (429/5xx/rede/timeout) vs
      permanente, usando a MESMA lista `STATUS_NO_RETRY` do AsyncCaller, para que retry
      (dentro do modelo) e fallback (entre modelos) concordem sobre o que é transitório.
    * `withModelFallback()` — Proxy que preserva o contrato `BaseChatModel` e aplica o
      fallback nos DOIS caminhos: `.invoke()` E `.bindTools(...).invoke()`. Cobrir só o
      primeiro deixaria justamente o brain-sdr (que usa `ctx.llm.bindTools()` em
      `brain.ts:210`) sem proteção. Erro permanente propaga na hora, sem gastar latência.
    * Logging estruturado em cada degrau — a ausência disso foi o que levou o time a
      diagnosticar "não há retry" quando na verdade havia.
  - `packages/ai/src/llm/factory.ts`: `LLM_MAX_RETRIES` (default 2, não 6 — com 6 o
    primário consome ~87s e o webhook síncrono estoura o timeout antes do fallback rodar),
    `LLM_FALLBACK_MODELS` (CSV, `model` ou `provider:model`), `API_KEY_<PROVIDER>` para
    fallback cross-provider. Sem `LLM_FALLBACK_MODELS` o comportamento é idêntico ao atual.
  - ENVs documentadas nos `.env.example` dos três apps.

  RODADA 2 — `normalizeModelName()` em `factory.ts`: remove o prefixo `models/` (só no
  provider gemini, mesmo regex ancorado do langchain) ANTES da dedup da cadeia. Sem isso
  `LLM_MODEL=gemini-3.1-flash-lite` + `LLM_FALLBACK_MODELS=models/gemini-3.1-flash-lite`
  montaria a cadeia com o mesmo modelo saturado duas vezes. Entrada degenerada (`models/`
  sozinha, que normaliza para nome vazio) é descartada em vez de instanciar um modelo sem
  nome. Escopado ao gemini de propósito: em OpenRouter o "/" faz parte do nome
  (`vendor/model`) e remover trocaria o modelo pedido; `tunedModels/...` sobrevive intacto.

  AÇÃO DE CONFIG NECESSÁRIA (o código sozinho não resolve a causa 1): definir
  `LLM_FALLBACK_MODELS` no deploy do brain-sdr —
  `LLM_FALLBACK_MODELS=gemini-3.1-flash-lite` (único modelo VERIFICADO EMPIRICAMENTE pelo
  usuário contra a API real). `gemini-2.5-flash` pode entrar como segundo elo, mas depois:
  `LLM_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash` — a ordem importa, e só o
  primeiro tem verificação empírica. O `gemini-2.5-flash` era inferência a partir do
  relato "antes funcionava", nunca foi testado nesta sessão.
  As duas grafias são aceitas (`gemini-3.1-flash-lite` ou `models/gemini-3.1-flash-lite`).

verification:
  guardrail_verdict: accepted
  oracle_type: specified (comportamento desejado declarado pelo usuário: retry + fallback)
  signal_1_regression_test_bites: |
    PASS — RED confirmado antes do fix (15 fail / 8 pass). Mutation guardrail: desabilitar
    a cadeia (`fallbacks.length >= 0 → return primary`) faz 13 testes falharem; o teste
    não é decorativo.
  signal_2_no_unrelated_regressions: |
    PASS — baseline pré-existente medido em worktree limpo no HEAD (e272edb):
    observability 4 fail, core 19 fail (EventPublisher/LeadService/health — sem relação
    com LLM). Após o fix: exatamente os mesmos 4 e 19; todos os outros pacotes 0 fail,
    incluindo @brain-app/sdr e @brain-pkg/ai. `bun run build` 11/11 e `typecheck` 19/19.
  signal_3_root_cause_not_symptom: |
    PASS — o fix adiciona o degrau de degradação ausente (causa 2). Não mascara o 503 nem
    apenas engole o erro: erro permanente continua propagando, e o esgotamento total da
    cadeia continua sendo logado como erro.
  signal_4_bug_returns_on_revert: |
    PASS — com a cadeia desabilitada os testes de regressão voltam a falhar exatamente com
    o 503 do formato de produção.
  signal_5_not_deletion_only: PASS — diff aditivo.
  signal_6_rerun_after_round2_code_change: |
    PASS — código mudou na rodada 2, então os gates foram RE-MEDIDOS contra a MESMA
    baseline pré-existente (HEAD e272edb): `bun run build` 11/11, `typecheck` 19/19,
    e no teste completo observability 4 fail + core 19 fail — exatamente os mesmos
    (EventPublisher / LeadService.upsertLead/resetFup / performHealthCheck, todos sem
    relação com LLM). Todos os outros pacotes 0 fail. `@brain-pkg/ai` foi de 51 → 60 pass,
    0 fail (9 testes novos de normalização).
  signal_7_round2_mutation_guardrail: |
    PASS — dois mutantes, ambos mortos:
      (1) `normalizeModelName` → no-op (`return model`): 7 fail, idêntico ao RED.
      (2) dedup pela string CRUA (normaliza, mas monta a chave antes de normalizar):
          mata exatamente 1 teste — o de REGRESSÃO da dedup. Prova que a ORDEM
          "normalizar antes de deduplicar" é load-bearing, e não só a existência da função.
    Os 2 testes de controle negativo (`openai:models/gpt-4.1-mini` e `tunedModels/...`)
    passam com e sem o fix, como devem — são as fronteiras do que NÃO pode ser removido.
  real_class_probe: |
    Blind spot dos unit tests (usam FakeChatModel) coberto por probe com classes REAIS do
    langchain: bindTools presente (guard de brain.ts:170), `instanceof Runnable` true,
    `_llmType()`/`lc_namespace` acessíveis, maxRetries repassado, e fallback funcionando
    em `.invoke()` e em `.bindTools().invoke()`.
    Esse probe PEGOU UM BUG REAL introduzido no fix: `prop in extraTraps` percorria
    `Object.prototype`, fazendo `constructor.name` virar "Object" e sombreando
    toString/valueOf. Corrigido para `Object.hasOwn()` e travado por teste de regressão
    (mutação verificada: volta a falhar com `in`).

open_points:
  - id: webhook-caller-timeout
    status: ABERTO — blind spot NÃO fechado
    what: |
      O timeout do chamador do webhook (integração WhatsApp/CRM) continua desconhecido —
      o usuário não forneceu esse dado na verificação. `LLM_MAX_RETRIES` fica no default
      **2** (deliberadamente NÃO baixado para 1).
    why: |
      A escolha do default é conservadora, não medida. O raciocínio é um limite superior:
      com maxRetries=6 o primário sozinho consome ~87s (medido) e o fallback nunca chegaria
      a rodar; com 2 são ~3 tentativas / ~4s por modelo, deixando orçamento para a cadeia.
      Mas sem o timeout real do chamador não dá para afirmar que 2 é ÓTIMO — só que é
      seguro o bastante e melhor que 6. Baixar para 1 sem o dado trocaria uma suposição
      por outra, e ainda por cima reduziria a proteção contra blips de rede.
    to_close: |
      Medir o timeout do chamador do webhook em produção e conferir se
      (LLM_MAX_RETRIES+1) × latência_p99_do_modelo × nº_de_elos_da_cadeia cabe dentro dele.
      Se não couber, reduzir a cadeia antes de reduzir o retry.
  - id: env-example-nao-atualizado
    status: BLOQUEADO por permissão — precisa de ação humana
    what: |
      Os três `.env.example` ainda trazem `# LLM_FALLBACK_MODELS=gemini-2.5-flash,openai:gpt-4.1-mini`
      (brain-sdr:33, brain-support:36, brain-echo:45). Deveriam passar a recomendar o
      modelo empiricamente validado, com ele em PRIMEIRO lugar na ordem:
        # LLM_FALLBACK_MODELS=gemini-3.1-flash-lite,openai:gpt-4.1-mini
      (aceita também a grafia `models/gemini-3.1-flash-lite`, do console do Google)
    why: |
      A regra `Read(.env.*)` em ~/.claude/settings.json cobre `.env.example` e bloqueia
      tanto a leitura quanto a edição. Não foi contornada de propósito — é configuração
      do usuário. A recomendação atualizada está no docstring de `createLLM()`, que é o
      que o código realmente consulta; o `.env.example` é a cópia humana que ficou para trás.

files_changed:
  - packages/ai/src/llm/fallback.ts (novo — classificação de erro transitório + cadeia)
  - packages/ai/src/llm/factory.ts (retry configurável + montagem da cadeia +
      normalizeModelName do prefixo `models/` antes da dedup — rodada 2)
  - packages/ai/src/index.ts (exports)
  - packages/ai/src/__tests__/unit/llm-fallback.test.ts (novo — 24 testes de regressão;
      +9 na rodada 2 cobrindo a normalização do prefixo = 33)
  - packages/ai/package.json (+ @brain-pkg/observability para logging estruturado)
  - packages/ai/tsconfig.json (+ project reference ../observability)
  - pnpm-lock.yaml (link da dep de workspace)
  - apps/brain-sdr/.env.example, apps/brain-support/.env.example, apps/brain-echo/.env.example
      (rodada 1 apenas — a atualização do valor recomendado na rodada 2 ficou BLOQUEADA,
       ver open_points.env-example-nao-atualizado)

postmortem:
  why_not_caught: |
    Nenhum gate existente cobria essa classe. Não era um bug de tipo (typecheck passava),
    nem de lint, nem de teste — `createLLM()` só tinha testes de "instancia o provider
    certo". O gatilho era um erro TRANSITÓRIO de um serviço EXTERNO sob carga, que não
    aparece em nenhum ambiente de teste e não é determinístico. Pior: a troca de modelo
    que expôs o problema (`gemini-2.5-flash` → `gemini-3.5-flash`) foi mudança de ENV no
    deploy, invisível ao git — `git bisect` nunca teria achado.
    E o diagnóstico inicial ("não há retry") estava ERRADO: o retry existia e exauria em
    ~87s. O que faltava era OBSERVABILIDADE — nenhum log entre a chamada e o `ERR` final,
    então 87s de backoff eram indistinguíveis de uma falha imediata.
    Sem culpa individual: o código estava correto para o caso feliz e para erro permanente;
    o modo de falha só existe na interseção de saturação externa + ausência de degradação.
  recurrence_guard: |
    1. Teste de regressão: packages/ai/src/__tests__/unit/llm-fallback.test.ts (33 testes)
       — 503 no formato exato de produção, nos DOIS caminhos (`.invoke()` e
       `.bindTools().invoke()`), com mutação verificada em 2 rodadas.
    2. Código: cadeia de fallback em `packages/ai` — infra compartilhada, todo Brain novo
       herda sem tocar em `apps/`.
    3. Observabilidade: log estruturado em cada degrau da cadeia — o próximo incidente
       desse tipo mostra qual modelo caiu e qual atendeu, em vez de um `ERR` mudo.
    4. Normalização do prefixo `models/` + dedup — impede que a cadeia configurada seja
       silenciosamente o mesmo modelo repetido.
    5. Este arquivo + a entrada no knowledge-base.md — a próxima sessão com sintoma
       "503/429 de provider LLM" já começa sabendo que o retry existe e que a pergunta
       certa é sobre degradação, não sobre retry.
