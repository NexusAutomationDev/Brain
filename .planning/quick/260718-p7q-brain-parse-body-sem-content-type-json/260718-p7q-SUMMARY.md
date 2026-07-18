---
task: 260718-p7q
type: quick
title: Consumer RabbitMQ tolerante a body sem content-type application/json
status: complete
commit: fecb8a5
completed: 2026-07-18
files_changed:
  - packages/transport/src/rabbitmq/consumer.ts
  - .planning/STATE.md
---

# Task 260718-p7q — Summary

O consumer RabbitMQ passa a normalizar `msg.body` antes de validar: se vier como
Buffer/string (publisher sem `content-type: application/json`, ex: node RabbitMQ do
n8n), tenta `JSON.parse` com try/catch. Elimina o `Invalid BrainEvent` (`bodyKeys
0..211`) que mandava toda mensagem do n8n pra DLQ. Payload de fato inválido continua
indo pra DLQ.

Deploy: **mesma tag `brain-sdr:1.6.2`** — imagem recompilada com o fix e recarregada na
VPS via `docker save | scp | docker load` (sem bump de compose, para não re-tocar o
stack em produção).

## Files Changed

| File | Change |
| ---- | ------ |
| `packages/transport/src/rabbitmq/consumer.ts` | normaliza body (Buffer/string → JSON.parse) antes do safeParse; log `bodyType` no lugar de `bodyKeys` |
| `.planning/STATE.md` | linha na tabela Quick Tasks + Last activity |

## Commit

- `fecb8a5` — 🐛 fix(transport): parse RabbitMQ body sem content-type application/json

## Deploy (manual, fora do CI)

- Imagem `brain-sdr:1.6.2` recompilada (id novo) e carregada na VPS 2.25.203.216.

## Nota — lado n8n (fora deste repo)

Ainda necessário: Code node remapeando `{message, lead:{...}}` →
`{Name, Message, Numero, IDLead}` (IDLead = lead.hash). O parse tolerante resolve o
content-type; o Code node resolve os nomes de campo. Os dois juntos tiram as mensagens
da DLQ.

## Self-Check: PASSED
- consumer.ts com o parse tolerante — confirmed.
- imagem 1.6.2 rebuilda sem erro de tsc — confirmed (build exit 0).
