# brain-topology-init (DEPLOY-06 placeholder)

Phase 1 declares this service as an alpine `true` no-op so DEPLOY-06's "init
container slot reserved" requirement is satisfied and Brain's compose
`depends_on` graph has a stable target.

Phase 8 replaces image + command with a small `aio-pika` script that declares:

  - exchanges: `brain.dlx` (DLX)
  - queues: `brain.in` (with `x-dead-letter-exchange=brain.dlx`), `brain.dlq`,
    `brain.out`
  - bindings as documented in `.planning/research/ARCHITECTURE.md` (queue layout
    section, to be added in Phase 8 research)

When Phase 8 lands, runtime consumers (in `src/brain/workers/`) declare the
same queues with `passive=True` so a missing topology fails fast rather than
silently re-declaring.

DO NOT delete this entry — Brain's `depends_on` (added in Phase 8) keys off
the service name `brain-topology-init`.

## Phase 1 — current shape

In both `docker-compose.yml` and `docker-compose.lite.yml`:

```yaml
brain-topology-init:
  image: alpine:3.20
  command: ["true"]
  restart: "no"
  networks: [brain-net]
```

Pinned to `alpine:3.20` (not `:latest`) per CLAUDE.md §10 and threat T-08-11.

## Phase 8 — planned shape

```yaml
brain-topology-init:
  build:
    context: .
    dockerfile: compose/brain-topology-init/Dockerfile   # added in Phase 8
  env_file: .env
  command: ["python", "-m", "brain.workers.declare_topology"]
  depends_on:
    rabbitmq:
      condition: service_healthy
  restart: "no"
  networks: [brain-net]
```

And Brain's `depends_on` gains:

```yaml
brain-topology-init:
  condition: service_completed_successfully
```

so Brain only starts after the queues + DLX exist.

## Why a placeholder instead of waiting for Phase 8

Reserving the service name in Phase 1 means:

1. DEPLOY-06 is satisfiable end-to-end at Phase 1 boundary (no requirement bleed).
2. Plan 01-09's `scripts/check-compose-parity.sh` can lock the shared service
   list between lite and full from day one.
3. Phase 8 is a swap of image + command + Brain's depends_on entry — no
   service-name rename or downstream contract churn.
