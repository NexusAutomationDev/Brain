# Phase 18: Build and Publish Docker Image via DockGate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 18-build-and-publish-docker-image-via-dockgate
**Areas discussed:** O que é DockGate, Trigger do Pipeline, Estratégia de Tagging, Escopo de Brains

---

## O que é DockGate

| Option | Description | Selected |
|--------|-------------|----------|
| Registry privado para clientes | DockGate é um serviço de registro Docker privado de terceiros | |
| Plataforma que faz o build | CI/CD externo que builda + publica | |
| Nosso registry auto-hospedado | Registry Docker auto-hospedado pelo projeto | ✓ |
| Tool/CLI para publicar imagens | CLI/API que abstrai push para múltiplos registries | |

**User's choice:** Nosso registry auto-hospedado  
**Notes:** Tecnologia ainda não definida (respondeu "Outro / Não sei ainda"). O registry já está no ar — fase 18 não inclui subir a infra, apenas o pipeline de build+push. Credenciais (DOCKGATE_URL + DOCKGATE_UPLOAD_TOKEN) já existem como GitHub Secrets.

O usuário forneceu um workflow de referência completo que documentou a API DockGate:
- `POST /apps/:name/upload?version=X` → presigned MinIO URL
- Upload direto ao MinIO via presigned URL (sem auth header)
- `PUT /apps/:name/latest` com `{ version, sha256, size }` — size é integer

---

## Trigger do Pipeline

| Option | Description | Selected |
|--------|-------------|----------|
| Tag de versão no git | Tag v1.4.0 dispara build+push automaticamente | ✓ |
| Push para main/master | Qualquer push para main dispara | |
| Trigger manual no CI | workflow_dispatch — acionado manualmente | |
| Script manual local | Script local sem CI | |

**User's choice:** Tag de versão no git  
**Notes:** GitHub Actions como plataforma. Um workflow por Brain (não matrix). Build na raiz do monorepo.

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions | Workflow em .github/workflows/ | ✓ |
| Gitea / Forgejo Actions | CI embutido do Gitea | |
| Script local + Makefile | Sem CI externo | |

| Option | Description | Selected |
|--------|-------------|----------|
| Um workflow por Brain | publish-brain-sdr.yml separado por Brain | ✓ |
| Um workflow para todos | Matrix com todos os Brains | |

| Option | Description | Selected |
|--------|-------------|----------|
| Build na raiz do repo | docker build -f apps/brain-sdr/Dockerfile . | ✓ |
| Mudar estrutura do Dockerfile | Ajustar antes de publicar | |

---

## Estratégia de Tagging

| Option | Description | Selected |
|--------|-------------|----------|
| APP_NAME = brain-sdr / brain-echo | Nome simples, sem prefixo org | ✓ |
| APP_NAME com prefixo org | ex: expertintegrado/brain-sdr | |

**User's choice:** APP_NAME = brain-sdr  
**Notes:** Tag compartilhada do monorepo (v1.4.0 → brain-sdr:1.4.0 e brain-echo:1.4.0 no futuro).

| Option | Description | Selected |
|--------|-------------|----------|
| Tag única do monorepo | Uma tag v1.4.0 = todos os Brains | ✓ |
| Tags independentes por Brain | Cada Brain com suas próprias tags | |

---

## Escopo de Brains

| Option | Description | Selected |
|--------|-------------|----------|
| Apenas brain-sdr | Brain de produção, começar por ele | ✓ |
| Ambos: brain-sdr e brain-echo | Publicar os dois | |
| Apenas brain-echo (testes primeiro) | Pipeline de teste primeiro | |

**User's choice:** Apenas brain-sdr  
**Notes:** brain-echo fica para fase futura. Workflow deve ser estruturado para facilitar adição futura.

---

## Claude's Discretion

- Nome do arquivo do workflow: `publish-brain-sdr.yml`
- Versão do action checkout: `actions/checkout@v4`
- Decisão sobre cache de layers Docker (buildx): deixado para o agente planejar

## Deferred Ideas

- brain-echo no pipeline DockGate — fase futura
- Cache de layers Docker (buildx) — complexidade extra, decidida pelo agente
- Rollback automático — fora de escopo por ora
