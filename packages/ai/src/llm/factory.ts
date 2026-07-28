import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ConfigurationError } from "@brain-pkg/shared";
import { withModelFallback, type FallbackCandidate } from "./fallback.js";

/**
 * Options for LLM configuration.
 * All required config (provider, model, API key) comes from env vars — not these options.
 */
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
}

const SUPPORTED_PROVIDERS = new Set(["openai", "anthropic", "gemini", "openrouter"]);

/**
 * Retries por modelo antes de acionar o próximo da cadeia de fallback.
 *
 * O default do `AsyncCaller` do langchain é 6, o que dá ~87s até o erro propagar
 * (medido: tentativas em +0s, +1.1s, +3.9s, +9.7s, +17.8s, +34.9s, +86.9s). Com o
 * transport webhook — que é síncrono — o chamador estoura o timeout muito antes disso,
 * e o fallback nunca chegaria a rodar. 2 retries (3 tentativas, ~4s) mantêm a proteção
 * contra blips e deixam orçamento de latência para a cadeia de fallback.
 */
const DEFAULT_MAX_RETRIES = 2;

/** Lê LLM_MAX_RETRIES; valores ausentes/inválidos caem no default (nunca vira NaN). */
function resolveMaxRetries(): number {
  const raw = process.env.LLM_MAX_RETRIES?.trim();
  if (!raw) return DEFAULT_MAX_RETRIES;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_MAX_RETRIES;
  return parsed;
}

/**
 * Resolve a API key do provider.
 *
 * `API_KEY_<PROVIDER>` (ex.: API_KEY_OPENAI) tem precedência, permitindo fallback
 * cross-provider. Sem ela, usa `API_KEY` — comportamento inalterado para quem só usa
 * um provider. T-2-03: o valor nunca é logado nem incluído em erros.
 */
function resolveApiKey(provider: string): string {
  const scoped = process.env[`API_KEY_${provider.toUpperCase()}`];
  return (scoped ?? process.env.API_KEY) as string;
}

/** Instancia o chat model de um provider. Não valida env — quem chama já validou. */
async function instantiateModel(
  provider: string,
  model: string,
  options: LLMOptions,
  maxRetries: number,
): Promise<BaseChatModel> {
  // T-2-03: apiKey é lida do env e nunca logada ou lançada em erro
  const apiKey = resolveApiKey(provider);
  const common = { model, apiKey, maxRetries, ...options };

  switch (provider) {
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI(common) as unknown as BaseChatModel;
    }
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic(common) as unknown as BaseChatModel;
    }
    case "gemini": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return new ChatGoogleGenerativeAI(common) as unknown as BaseChatModel;
    }
    case "openrouter": {
      const { ChatOpenAI } = await import("@langchain/openai");
      // D-08: OpenRouter is OpenAI-compatible with a custom baseURL
      return new ChatOpenAI({
        ...common,
        configuration: { baseURL: "https://openrouter.ai/api/v1" },
      }) as unknown as BaseChatModel;
    }
    default:
      // T-2-03: Do NOT include apiKey in error context
      throw new ConfigurationError(`Unknown LLM_PROVIDER: ${provider}`, { provider });
  }
}

interface ModelSpec {
  provider: string;
  model: string;
}

/**
 * Remove o prefixo `models/` dos nomes de modelo do Google.
 *
 * O console do Google exibe o modelo como `models/gemini-3.1-flash-lite`, e é essa a
 * grafia que normalmente se cola na ENV. Probe com as classes reais mostrou que as duas
 * grafias produzem a MESMA request — não existe risco de `models/models/...`:
 *   - `@langchain/google-genai@2.1.31` (chat_models.js:428) remove o prefixo:
 *     `this.model = fields.model.replace(/^models\//, "")`;
 *   - `@google/generative-ai@0.24.1` (index.mjs:1348-1355) o recoloca ao montar a URL,
 *     mantendo o nome como está quando ele já contém "/".
 *
 * Normalizar aqui, então, NÃO é cosmético — é a dedup da cadeia que depende disso.
 * `parseFallbackSpecs` deduplica por `provider:model` comparando strings; sem normalizar,
 * `LLM_MODEL=gemini-3.1-flash-lite` + `LLM_FALLBACK_MODELS=models/gemini-3.1-flash-lite`
 * montaria uma cadeia com o MESMO modelo saturado duas vezes — um "fallback" que só
 * dobra a latência do lead durante o 503, exatamente a falha que a cadeia existe para
 * evitar. Também mantém os labels de log em uma grafia só (a observabilidade ruim foi o
 * que levou o time a diagnosticar "não há retry" quando havia).
 *
 * Escopado ao gemini de propósito: `models/` é convenção de nome do Google. Em outros
 * providers o "/" faz parte do nome (OpenRouter usa `vendor/model`) e remover trocaria o
 * modelo pedido. O regex é o mesmo do langchain — ancorado em `^models/` e aplicado uma
 * única vez —, então `tunedModels/...` (caminho válido do SDK) sobrevive intacto.
 */
function normalizeModelName(provider: string, model: string): string {
  if (provider !== "gemini" || typeof model !== "string") return model;
  return model.replace(/^models\//, "");
}

/**
 * Faz o parse de LLM_FALLBACK_MODELS (CSV).
 *
 * Cada entrada é `model` (mesmo provider do primário) ou `provider:model` (cross-provider).
 * O prefixo só é tratado como provider quando é um provider conhecido — assim nomes de
 * modelo que contenham ":" não são quebrados por engano.
 * Entradas vazias e duplicatas do primário são descartadas.
 */
function parseFallbackSpecs(raw: string | undefined, primary: ModelSpec): ModelSpec[] {
  if (!raw?.trim()) return [];

  const seen = new Set([`${primary.provider}:${primary.model}`]);
  const specs: ModelSpec[] = [];

  for (const entry of raw.split(",").map((e) => e.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    let provider = primary.provider;
    let model = entry;

    if (separator > 0) {
      const maybeProvider = entry.slice(0, separator).trim().toLowerCase();
      const maybeModel = entry.slice(separator + 1).trim();
      if (SUPPORTED_PROVIDERS.has(maybeProvider) && maybeModel) {
        provider = maybeProvider;
        model = maybeModel;
      }
    }

    // Normaliza ANTES de deduplicar — é o que faz `models/x` e `x` contarem como um só elo.
    const spec: ModelSpec = { provider, model: normalizeModelName(provider, model) };
    // Entrada degenerada (`models/` sozinho) vira nome vazio: descarta em vez de
    // instanciar um modelo sem nome e só descobrir isso na hora do 503.
    if (!spec.model) continue;

    const key = `${spec.provider}:${spec.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    specs.push(spec);
  }

  return specs;
}

/**
 * AI-05, D-06, D-07: Creates an LLM instance configured from env vars.
 *
 * Required env vars:
 *   LLM_PROVIDER — one of: openai | anthropic | gemini | openrouter
 *   LLM_MODEL    — model name (e.g., gpt-4o, claude-sonnet-4-6, gemini-2.0-flash)
 *   API_KEY      — provider API key (NEVER logged — T-2-03)
 *
 * Optional env vars (resiliência a erro transitório de provider):
 *   LLM_MAX_RETRIES     — retries por modelo antes do fallback (default: 2)
 *   LLM_FALLBACK_MODELS — CSV de modelos de fallback: `model` ou `provider:model`
 *                         ex.: LLM_FALLBACK_MODELS=gemini-3.1-flash-lite
 *   API_KEY_<PROVIDER>  — key por provider, para fallback cross-provider
 *
 * Nomes de modelo do gemini aceitam as duas grafias — `gemini-3.1-flash-lite` e
 * `models/gemini-3.1-flash-lite` (a do console do Google). São normalizadas para a forma
 * sem prefixo, que é a que o `@langchain/google-genai` usa internamente.
 *
 * D-07: Throws ConfigurationError if LLM_PROVIDER is not set.
 * D-08: Supports openai, anthropic, gemini, openrouter.
 * Security (T-2-03): API_KEY is read but NEVER included in error messages, logs, or context.
 *
 * Resiliência: quando LLM_FALLBACK_MODELS está definida, o modelo retornado percorre a
 * cadeia em erro TRANSITÓRIO do provider (503 "high demand", 429, 5xx, falha de rede),
 * tanto em `.invoke()` quanto em `.bindTools(...).invoke()`. Erros permanentes (4xx de
 * requisição/auth) propagam imediatamente, sem desperdiçar latência do lead.
 */
export async function createLLM(options: LLMOptions = {}): Promise<BaseChatModel> {
  const provider = process.env.LLM_PROVIDER;
  const model = process.env.LLM_MODEL;

  if (!provider) {
    throw new ConfigurationError("LLM_PROVIDER env var is required", { provider: "missing" });
  }

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    // T-2-03: Do NOT include apiKey in error context
    throw new ConfigurationError(`Unknown LLM_PROVIDER: ${provider}`, { provider });
  }

  // model may be undefined — the provider SDK surfaces its own validation error.
  // normalizeModelName preserva `undefined` (guard de typeof), então esse contrato não muda.
  const modelStr = normalizeModelName(provider, model as string);
  const maxRetries = resolveMaxRetries();
  const primarySpec: ModelSpec = { provider, model: modelStr };

  const primary = await instantiateModel(provider, modelStr, options, maxRetries);

  const fallbackSpecs = parseFallbackSpecs(process.env.LLM_FALLBACK_MODELS, primarySpec);
  if (fallbackSpecs.length === 0) return primary;

  const fallbacks: FallbackCandidate[] = [];
  for (const spec of fallbackSpecs) {
    fallbacks.push({
      label: `${spec.provider}:${spec.model}`,
      model: await instantiateModel(spec.provider, spec.model, options, maxRetries),
    });
  }

  return withModelFallback(primary, fallbacks, `${primarySpec.provider}:${primarySpec.model}`);
}
