# brain.observability

## Owns

The Langfuse integration surface: the `CallbackHandler` factory (`langfuse 4.x` SDK, OpenTelemetry-based), the secret-masking helpers that scrub the `Authorization` header and provider API keys before traces ship (PITFALL 5.1), the fire-and-forget submission wrapper, and the circuit-breaker that disables traces when Langfuse is unhealthy so the request path never blocks (OBS-04/05 / PITFALL 8.1).

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 4: `make_callback_handler(settings)`, masking config, fire-and-forget submission, breaker with cooldown, `metadata` stamping (`bot_id`, `session_id`, `provider`, `model`, `request_id`).

## Do NOT

- block the request path on a Langfuse call (PITFALL 8.1 / OBS-04). Callbacks are fire-and-forget; failures degrade observability, never the response.
- Put Langfuse in Brain's compose `depends_on` (D-11 — observability is allowed to be down).
- Ship `Authorization` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `BRAIN_AUTH_TOKEN` values into traces (PITFALL 5.1 — mask at the handler boundary).
