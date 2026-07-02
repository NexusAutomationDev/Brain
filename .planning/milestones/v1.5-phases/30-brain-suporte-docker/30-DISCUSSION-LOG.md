# Phase 30: Brain Suporte Docker - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 30-brain-suporte-docker
**Areas discussed:** Gap no Dockerfile do brain-sdr, Validação end-to-end e isolamento, Localização das migrations, Convenções de entrega ao cliente, CI/CD

---

## Gap no Dockerfile do brain-sdr

| Option | Description | Selected |
|--------|-------------|----------|
| Corrigir agora, mesma fase | Aplicar o fix (build+copy de packages/embeddings) junto do Dockerfile do brain-support, mesmo padrão | ✓ |
| Backlog separado | Manter Phase 30 estritamente sobre brain-support; abrir item de backlog para o fix do brain-sdr | |

**User's choice:** Corrigir agora, mesma fase.
**Notes:** Descoberta feita durante scout de código — `apps/brain-sdr/Dockerfile` nunca builda/copia `packages/embeddings`, apesar do código importar desde a Phase 28. Provável quebra em produção hoje.

---

## Validação end-to-end e isolamento

| Option | Description | Selected |
|--------|-------------|----------|
| Round-trip completo, Postgres efêmero isolado | build+run+webhook real (LLM real) contra Postgres descartável, sem tocar produção | ✓ |
| Build + run + /health apenas, Postgres isolado | Mais leve, não comprova criterio 3 (BrainOutput via webhook) | |
| Só docker build, sem executar container | Como a Phase 9 validou originalmente (revisão de código/grep) | |

**User's choice:** Round-trip completo, Postgres efêmero isolado.
**Notes:** Ambiente tem Docker daemon ativo e Postgres de produção real (pgvector) rodando no mesmo host Swarm junto com outros serviços live (traefik, dockgate, webhookgateway). Validação deve isolar completamente da infraestrutura de produção.

---

## Localização das migrations

| Option | Description | Selected |
|--------|-------------|----------|
| Manter compartilhado (como brain-sdr) | packages/database/src/migrations continua servindo todos os Brains | ✓ |
| Isolar migrations por Brain agora | Alinha com CLAUDE.md documentado, mas expande escopo bastante | |

**User's choice:** Manter compartilhado (como brain-sdr).
**Notes:** Divergência conhecida entre `CLAUDE.md` (§"Como Criar um Novo Brain", documenta migrations por-Brain) e a prática real em produção (compartilhada). Isolamento anotado como ideia deferida.

---

## Convenções de entrega ao cliente

### .dockerignore

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, só para brain-support | Escopado ao build do brain-support | |
| Sim, para todos os Brains | Corrige brain-sdr e brain-echo também | ✓ |
| Não adicionar agora | Mantém foco estrito | |

**User's choice:** Sim, para todos os Brains.
**Notes:** Nenhum Brain tem `.dockerignore` hoje; contexto de build (`.`) inclui `node_modules`, `.env`, `.git`. Um único arquivo na raiz do repo cobre os 3 Brains, já que todos buildam a partir do mesmo contexto.

### docker-compose para teste local

| Option | Description | Selected |
|--------|-------------|----------|
| Não precisa | brain-sdr não tem hoje; manter consistência | |
| Sim, criar docker-compose.yml | Facilita reproduzir a validação e2e localmente | ✓ |

**User's choice:** Sim, criar docker-compose.yml.
**Notes:** Conveniência nova (nenhum outro Brain tem), aprovada explicitamente para simplificar a reprodução da validação e2e (Postgres + brain-support juntos).

---

## CI/CD

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, espelhar exatamente (mesma tag v*.*.*) | Mesmo trigger do brain-sdr | ✓ (revisado) |
| Espelhar mas com tag própria | Mesmo padrão, prefixo de tag diferente para não colidir | (escolha inicial, revertida) |

**User's choice (revisado):** Espelhar exatamente, mesma tag `v*.*.*`/`v*.*` do brain-sdr.
**Notes:** Usuário pediu explicitamente ("também coloca o CI/CD da mesma forma que o brain-sdr está") — escopo novo em relação ao roadmap original da Phase 30 (que só cobria SUP-06/Dockerfile), aprovado inline durante a discussão. Workflow encontrado: `.github/workflows/publish-brain-sdr.yml` (build → DockGate upload). Escolha inicial de follow-up foi um prefixo próprio (`brain-support-v*.*.*`), mas o usuário revisou depois e confirmou manter o mesmo trigger do brain-sdr — um push de tag `v1.0.0` passa a disparar ambos os workflows simultaneamente, comportamento aceito intencionalmente.

---

## Claude's Discretion

- Path exato do `docker-compose.yml` (raiz vs `apps/brain-support/`)
- Nome do container/serviço no compose, portas expostas
- Se o fix do brain-sdr é commit/plano separado do Dockerfile do brain-support
- Estratégia exata de provisionamento do Postgres efêmero de teste

## Deferred Ideas

- Isolar migrations por Brain (alinhar `CLAUDE.md` documentado com a prática real) — refatoração maior, fora de escopo de SUP-06.
