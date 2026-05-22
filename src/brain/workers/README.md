# brain.workers

## Owns

The RabbitMQ ingress surface: the `aio-pika` async consumer that drains `brain.in`, dispatches the payload through `brain.service.BrainService`, and publishes the response to `brain.out` with publisher confirms. Owns the AMQP connection lifecycle (`connect_robust`, reconnect policy, prefetch tuning, graceful drain on shutdown).

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 8: `BrainConsumer` (aio-pika consumer), `BrainPublisher`, `register_drain_handler()` integration with the FastAPI lifespan from Phase 1, retry/DLQ wiring, `RABBIT_PREFETCH` env honoring (TS-18).

## Do NOT

- Import `pika` (sync). Async-only: `aio-pika` 9.6.x (PITFALL 6.x, STACK.md §6).
- Bypass `brain.service.BrainService` — the AMQP path and the HTTP path share the same waist (D-01 / ARCHITECTURE.md).
- Hold the AMQP connection across forks; pool/connection lives in `lifespan` and is owned by the worker module.
