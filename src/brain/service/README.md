# brain.service

## Owns

The single shared "waist" `BrainService` that both ingresses (HTTP webhook and AMQP consumer) call into. Translates ingress-agnostic input (`bot_id`, `session_id`, `conteudo`) into a `graph.ainvoke(...)` call, threads observability metadata, and returns the structured response envelope. This is the seam that keeps `brain.api` and `brain.workers` ignorant of LangGraph internals.

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 3: `BrainService.handle(request: BrainRequest) -> BrainResponse`, `thread_id` construction via `brain.graph.thread`, Langfuse callback attachment (Phase 4 wires the handler), per-`(bot_id, session_id)` `asyncio.Lock` registry (GRAPH-03).

## Do NOT

- Add ingress-specific concerns here (no FastAPI `Request`, no `aio-pika.IncomingMessage`). Translate at the boundary in `brain.api` / `brain.workers`.
- Reach into `brain.db`/`brain.vectordb` directly — go through `brain.graph` nodes.
