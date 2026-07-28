# GSD Debug Knowledge Base

Sessões de debug resolvidas. Usado pelo `gsd-debugger` para levantar hipóteses de padrão
conhecido logo no início de uma investigação nova.

---

## gemini-503-brainrunner-falha — 503 "high demand" do Gemini deixava o lead sem resposta nenhuma
- **Date:** 2026-07-28
- **Error patterns:** GoogleGenerativeAIFetchError, 503 Service Unavailable, "This model is currently experiencing high demand", BrainRunner.run() failed, pregelTaskId, generativelanguage.googleapis.com, handleResponseNotOk
- **Root cause(s):** [config/environment] `LLM_MODEL=gemini-3.5-flash` (trocado no deploy, fora do git) estava saturado no lado do Google, devolvendo 503; **E** [code] `createLLM()` instanciava um único modelo, sem nenhuma cadeia de fallback — sem caminho de degradação quando o retry daquele modelo exauria; **E** [code] o erro subia sem tratamento até o catch terminal em `packages/transport/src/webhook/handler.ts:107`, que só logava e devolvia HTTP 500, sem resposta ao lead nem re-enqueue. AND-gate: nenhuma isolada produz o sintoma.
- **NÃO era:** ausência de retry (hipótese de partida, refutada). O retry do langchain já existia e já exauria — `AsyncCaller` default `maxRetries=6`, 503 fora de `STATUS_NO_RETRY`, `completionWithRetry()` passando por `this.caller`. Probe mediu 7 tentativas / 86.9s, batendo com os gaps do log de produção (80s/84s/87s). Cada `ERR` era um ciclo de retry JÁ EXAURIDO.
- **Fix:** cadeia de fallback de modelo em `packages/ai` (infra compartilhada): `isTransientProviderError()` (429/5xx/rede = transitório; 4xx de request/auth = permanente, propaga na hora) + `withModelFallback()` via Proxy, cobrindo `.invoke()` E `.bindTools(...).invoke()`. ENVs novas: `LLM_FALLBACK_MODELS` (CSV, `model` ou `provider:model`), `LLM_MAX_RETRIES` (default 2, não 6 — com 6 o webhook síncrono estoura antes do fallback rodar), `API_KEY_<PROVIDER>`. `normalizeModelName()` remove o prefixo `models/` (só no gemini) antes da dedup da cadeia.
- **Files changed:** packages/ai/src/llm/fallback.ts, packages/ai/src/llm/factory.ts, packages/ai/src/index.ts, packages/ai/src/__tests__/unit/llm-fallback.test.ts, packages/ai/package.json, packages/ai/tsconfig.json, pnpm-lock.yaml, apps/{brain-sdr,brain-support,brain-echo}/.env.example
- **Why not caught:** Nenhum gate existia para esta classe. Não era erro de tipo, lint ou teste — os testes de `createLLM()` só cobriam "instancia o provider certo". O gatilho era erro TRANSITÓRIO de serviço EXTERNO sob carga, não determinístico e ausente de qualquer ambiente de teste. A mudança que expôs o bug foi de ENV no deploy (`gemini-2.5-flash` → `gemini-3.5-flash`), invisível ao git — `git bisect` não acharia. E a falta de observabilidade fez 87s de backoff parecerem falha imediata, levando ao diagnóstico errado de "não há retry".
- **Recurrence guard:** teste de regressão `packages/ai/src/__tests__/unit/llm-fallback.test.ts` (33 testes, 503 no formato exato de produção, nos dois caminhos de invocação, mutação verificada); cadeia de fallback em `packages/ai` herdada por todo Brain novo; log estruturado em cada degrau da cadeia; normalização+dedup do prefixo `models/`; esta entrada de KB.
- **Padrão reutilizável:** ao ver 503/429/5xx de provider LLM, NÃO assuma ausência de retry — o langchain já faz retry com backoff por default. Meça primeiro (os gaps entre erros no log revelam o ciclo de retry). A pergunta certa é sobre **degradação** (existe fallback?), não sobre retry.
---
