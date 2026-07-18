---
task: 260718-x2p
type: quick
title: Bump brain-sdr compose para v1.6.2 (força redeploy do fix passive-declare)
status: complete
commit: b105f9f
completed: 2026-07-18
files_changed:
  - apps/brain-sdr/docker-compose.yml
  - apps/brain-sdr/docker-compose.portainer.yml
  - apps/brain-sdr/docker-compose.local.yml
  - .planning/STATE.md
---

# Task 260718-x2p: Bump brain-sdr compose para v1.6.2 — Summary

Os 3 compose files do brain-sdr passam a referenciar `brain-sdr:1.6.2`. A v1.6.1 já
carregava o fix `queueOptions: { passive: true }` (commit a1e6338), mas a imagem
`brain-sdr:1.6.1` em produção estava **stale** — o erro `PRECONDITION_FAILED -
inequivalent arg 'durable'` persistia porque o container rodava código antigo (declare
ativo `durable:false`). Usar uma tag **inédita** força o CI/CD a buildar imagem limpa e
o host a baixar sem risco de cache. Bump patch; nenhuma lógica de aplicação tocada.

## Files Changed

| File | Change |
| ---- | ------ |
| `apps/brain-sdr/docker-compose.yml` | `image: brain-sdr:1.6.1` → `1.6.2` (seção `build:` intacta) |
| `apps/brain-sdr/docker-compose.portainer.yml` | `image: brain-sdr:1.6.1` → `1.6.2` + cabeçalho |
| `apps/brain-sdr/docker-compose.local.yml` | `image: brain-sdr:1.6.1` → `1.6.2` + cabeçalho |
| `.planning/STATE.md` | linha na tabela Quick Tasks + Last activity |

Env, ports, extra_hosts e networks intactos em todos os arquivos.

## Verification

- `grep -rn 'brain-sdr:1.6.1' apps/brain-sdr/` → vazio (exit 1). PASSED
- `grep -rc 'brain-sdr:1.6.2' apps/brain-sdr/docker-compose*.yml` → yml:1, local:2, portainer:2. PASSED

## Deviations from Plan

None.

## Ops Handoff (fora do escopo de edição de repo — Docker/git remote indisponíveis aqui)

1. Criar e pushar a tag para disparar o CI:
   ```
   git tag v1.6.2
   git push origin master --tags
   ```
2. Aguardar o workflow `publish-brain-sdr` publicar `brain-sdr:1.6.2` no DockGate.
3. No host/Portainer: Pull `brain-sdr:1.6.2` + Recreate a stack (não apenas restart).
4. Validar: logs do consumer RabbitMQ sem `PRECONDITION_FAILED - inequivalent arg 'durable'`.

## Self-Check: PASSED
- 3 compose files apontam para 1.6.2, nenhum 1.6.1 restante — confirmed.
- STATE.md atualizado com a linha 260718-x2p — confirmed.
