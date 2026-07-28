import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createLogger } from "@brain-pkg/observability";

const logger = createLogger();

/**
 * Status HTTP que NÃO devem acionar retry nem fallback — a requisição está errada e
 * repeti-la (no mesmo modelo ou em outro) só desperdiça latência do lead.
 *
 * Mesma lista de `STATUS_NO_RETRY` do `AsyncCaller` do @langchain/core, mantida em
 * sincronia de propósito: o retry (dentro do modelo) e o fallback (entre modelos) devem
 * concordar sobre o que é transitório. Note que 408 e 429 NÃO estão aqui — timeouts e
 * rate limits são transitórios.
 */
const PERMANENT_HTTP_STATUS = new Set([400, 401, 402, 403, 404, 405, 406, 407, 409]);

/** Extrai o status HTTP de um erro de provider, seja em `.status` ou `.response.status`. */
function extractHttpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;

  const direct = (err as { status?: unknown }).status;
  if (typeof direct === "number") return direct;

  const response = (err as { response?: unknown }).response;
  if (typeof response === "object" && response !== null) {
    const nested = (response as { status?: unknown }).status;
    if (typeof nested === "number") return nested;
  }
  return undefined;
}

/**
 * Classifica um erro de provider como transitório (vale tentar outro modelo) ou permanente.
 *
 * Transitório: 429/500/502/503/504, timeouts, e erros de rede sem status HTTP
 *   (ECONNRESET, ETIMEDOUT, socket hang up...). É o caso do 503 "high demand" do Gemini.
 * Permanente: 4xx de requisição malformada/auth/not-found — trocar de modelo não ajuda.
 * Cancelamento (AbortError) nunca é transitório: o chamador desistiu de propósito.
 */
export function isTransientProviderError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  const name = (err as { name?: unknown }).name;
  if (typeof name === "string" && name === "AbortError") return false;

  const message = (err as { message?: unknown }).message;
  if (
    typeof message === "string" &&
    (message.startsWith("Cancel") || message.startsWith("AbortError"))
  ) {
    return false;
  }

  const status = extractHttpStatus(err);
  // Sem status HTTP = falha de rede/transporte — transitório por definição.
  if (status === undefined) return true;

  return !PERMANENT_HTTP_STATUS.has(status);
}

/** Um elo da cadeia de fallback: um modelo com o rótulo usado em log. */
export interface FallbackCandidate {
  /** Rótulo legível — `provider:model`. Usado só para observabilidade. */
  label: string;
  model: BaseChatModel;
}

/** Alvo mínimo de invocação — cobre tanto BaseChatModel quanto o Runnable de bindTools(). */
interface Invocable {
  label: string;
  invoke: (input: unknown, options?: unknown) => Promise<unknown>;
}

/**
 * Percorre a cadeia de modelos até um responder.
 *
 * Cada modelo já faz seu próprio retry com backoff exponencial internamente
 * (`AsyncCaller` do langchain). Esta função entra DEPOIS que o retry de um modelo
 * exauriu: é o degrau de degradação que faltava e por causa do qual o lead ficava
 * sem nenhuma resposta quando o modelo primário estava saturado.
 */
async function invokeChain(
  candidates: Invocable[],
  input: unknown,
  options: unknown,
): Promise<unknown> {
  const primaryLabel = candidates[0]?.label;
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    try {
      const result = await candidate.invoke(input, options);
      if (i > 0) {
        logger.warn(
          { model: candidate.label, primaryModel: primaryLabel, fallbackIndex: i },
          "LLM fallback model answered — primary was unavailable",
        );
      }
      return result;
    } catch (err) {
      lastError = err;

      if (!isTransientProviderError(err)) {
        // Erro permanente: trocar de modelo não muda nada — propagar já.
        logger.error(
          { model: candidate.label, err },
          "LLM call failed with a non-transient error — not falling back",
        );
        throw err;
      }

      const next = candidates[i + 1];
      if (!next) {
        logger.error(
          { model: candidate.label, attempted: candidates.map((c) => c.label), err },
          "All LLM models exhausted — lead will not receive an answer",
        );
        throw err;
      }

      logger.warn(
        { model: candidate.label, nextModel: next.label, err },
        "LLM model unavailable (transient) — falling back to next model",
      );
    }
  }

  throw lastError;
}

/**
 * Proxy que preserva o objeto alvo, trocando apenas `invoke` pela versão com fallback.
 *
 * Métodos são religados ao alvo real (`value.bind(target)`) e não ao proxy — modelos do
 * langchain usam campos privados, que quebrariam se `this` fosse o proxy. `constructor`
 * é deixado intacto para não virar "bound Class" e alterar `constructor.name`.
 */
function proxyWithInvoke<T extends object>(
  target: T,
  buildInvoke: () => (input: unknown, options?: unknown) => Promise<unknown>,
  extraTraps: Record<string | symbol, unknown> = {},
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === "invoke") return buildInvoke();
      // Object.hasOwn — NÃO `prop in extraTraps`: `in` percorre Object.prototype e faria
      // `constructor`, `toString`, `valueOf`... resolverem para membros de Object,
      // quebrando `constructor.name` e a introspecção do LangGraph sobre o modelo.
      if (Object.hasOwn(extraTraps, prop)) return extraTraps[prop as string];

      const value = Reflect.get(obj, prop, obj);
      if (typeof value === "function" && prop !== "constructor") {
        return value.bind(obj);
      }
      void receiver;
      return value;
    },
  });
}

/**
 * Envolve o modelo primário numa cadeia de fallback, preservando o contrato
 * `BaseChatModel` — inclusive `bindTools()`, que é o caminho usado pelos Brains
 * (`ctx.llm.bindTools(tools)` em `buildGraph()`).
 *
 * O fallback é aplicado nos DOIS caminhos:
 *   - `llm.invoke(...)`            — qualifier, FupScheduler
 *   - `llm.bindTools(t).invoke()`  — nó `llm` do grafo (brain-sdr, brain-support)
 *
 * Cobrir só o primeiro deixaria justamente o Brain que quebrou em produção sem proteção.
 *
 * @returns o próprio modelo primário quando não há fallbacks (zero overhead / zero mudança
 *   de comportamento), ou um proxy com a cadeia ativa.
 */
export function withModelFallback(
  primary: BaseChatModel,
  fallbacks: FallbackCandidate[],
  primaryLabel: string,
): BaseChatModel {
  if (fallbacks.length === 0) return primary;

  const chain: FallbackCandidate[] = [{ label: primaryLabel, model: primary }, ...fallbacks];

  const supportsTools = typeof primary.bindTools === "function";

  const boundToolsTrap = supportsTools
    ? {
        bindTools: (tools: Parameters<NonNullable<BaseChatModel["bindTools"]>>[0], kwargs?: unknown) => {
          // Vincula as tools uma única vez por modelo da cadeia.
          const bound = chain.map((c) => ({
            label: c.label,
            runnable: c.model.bindTools!(tools, kwargs as never),
          }));

          const candidates: Invocable[] = bound.map((b) => ({
            label: b.label,
            invoke: (input: unknown, options?: unknown) =>
              b.runnable.invoke(input as never, options as never) as Promise<unknown>,
          }));

          // O alvo do proxy é o runnable primário já vinculado, preservando qualquer
          // introspecção que o LangGraph faça sobre ele.
          return proxyWithInvoke(bound[0]!.runnable as object, () => (input, options) =>
            invokeChain(candidates, input, options),
          );
        },
      }
    : {};

  return proxyWithInvoke(
    primary,
    () => (input, options) =>
      invokeChain(
        chain.map((c) => ({
          label: c.label,
          invoke: (i: unknown, o?: unknown) => c.model.invoke(i as never, o as never) as Promise<unknown>,
        })),
        input,
        options,
      ),
    boundToolsTrap,
  ) as BaseChatModel;
}
