# Phase 18: Build and Publish Docker Image via DockGate - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Criar o pipeline de CI/CD (GitHub Actions) que builda a imagem Docker do `brain-sdr` e publica via DockGate — o registry Docker auto-hospedado do projeto, com API sobre MinIO.

**Escopo:**
1. Workflow GitHub Actions `.github/workflows/publish-brain-sdr.yml` disparado por tag git (`v*.*.*`)
2. Build da imagem Docker com contexto da raiz do monorepo
3. Export da imagem para `.tar` + cálculo de sha256 e tamanho
4. Upload via URL presignada do DockGate → MinIO
5. Publicação da versão como `latest` via API DockGate

**Fora de escopo:** subir ou configurar a infraestrutura do DockGate (já está no ar); publicar o `brain-echo` (fase futura); alterar os Dockerfiles existentes.

</domain>

<decisions>
## Implementation Decisions

### DockGate — O que é e como funciona

- **D-01:** DockGate é um registry Docker auto-hospedado pelo projeto, com API própria sobre MinIO. Não é Docker Hub, Harbor, nem Gitea Registry — é uma solução própria.
- **D-02:** Fluxo de publicação em 3 etapas:
  1. `POST /apps/:name/upload?version=X` com Bearer token → retorna `{ "url": "..." }` (presigned MinIO PUT URL, válida 900s)
  2. `PUT <presigned_url>` com o arquivo `.tar` diretamente no MinIO (sem Authorization header — credenciais já estão na URL)
  3. `PUT /apps/:name/latest` com `{ version, sha256, size }` → atualiza o ponteiro "latest" no MinIO (verifica existência do `.tar` antes de escrever — anti-phantom)
- **D-03:** Autenticação: `DOCKGATE_URL` e `DOCKGATE_UPLOAD_TOKEN` como GitHub Secrets (Bearer token no header das chamadas à API DockGate). URL e credenciais já existem — não precisam ser criadas.
- **D-04:** `APP_NAME` no DockGate = `brain-sdr`. Sem prefixo de org nesta fase.
- **D-05:** Usar `docker save` (não `docker export`) para exportar a imagem — preserva todas as layers e metadata necessários para `docker load` no cliente.
- **D-06:** `size` no payload do PUT /latest deve ser **integer JSON** (não string) — `$SIZE` sem aspas no JSON. Erro 400 se vier como string.

### Trigger do Pipeline

- **D-07:** GitHub Actions, disparado por tag git `v*.*.*` (ex: `v1.4.0`).
- **D-08:** A versão enviada ao DockGate é o conteúdo da tag **sem o prefixo "v"**: tag `v1.4.0` → version `1.4.0`. Extraído via `${GITHUB_REF#refs/tags/v}`.
- **D-09:** Um workflow por Brain: `.github/workflows/publish-brain-sdr.yml`. Workflows independentes — publicar o SDR não rebuildea outros Brains.
- **D-10:** Build com contexto da raiz do monorepo: `docker build -f apps/brain-sdr/Dockerfile .` — igual ao que está no `docker-compose.yml` existente.

### Estratégia de Tagging

- **D-11:** Tag git é compartilhada por todo o monorepo. A tag `v1.4.0` publica `brain-sdr:1.4.0` (e futuramente `brain-echo:1.4.0` etc.).
- **D-12:** `IMAGE_NAME` usado localmente no build: `brain-sdr` (sem org prefix). Só o DockGate precisa saber o nome — não é publicado em Docker Hub.

### Escopo de Brains

- **D-13:** Fase 18 cobre **apenas o `brain-sdr`**. `brain-echo` será adicionado ao pipeline em fase futura.
- **D-14:** O workflow deve ser estruturado de forma que adicionar `brain-echo` no futuro seja trivial (copiar + ajustar `APP_NAME` e `IMAGE_NAME`).

### Claude's Discretion

- Nome exato do workflow file: `publish-brain-sdr.yml` em `.github/workflows/`
- Step de checkout: `actions/checkout@v4` (versão mais recente estável)
- Tempo estimado de build (ubuntu-latest): sem cache de layers — o agente decide se vale adicionar cache de layers do Docker (buildx cache) ou deixar simples para começar
- `IMAGE_NAME` no build local pode ser apenas `brain-sdr` sem org prefix (o tar vai direto ao MinIO, não a um registry Docker padrão)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### DockGate API (workflow de referência fornecido pelo usuário)

O usuário forneceu um workflow CI/CD de referência que documenta a API completa do DockGate. Esse workflow é a fonte canônica do contrato da API — ler antes de implementar:

- Endpoints: `POST /apps/:name/upload?version=X`, `PUT /apps/:name/latest`
- Auth: Bearer token em `Authorization` header (apenas nas chamadas à API DockGate, não no upload MinIO)
- Payload do PUT /latest: `{ version: string, sha256: string, size: number }` — `size` é integer, não string

### Dockerfiles existentes

- `apps/brain-sdr/Dockerfile` — Dockerfile multi-stage (node:22-slim builder + oven/bun:1 runner); contexto de build é a raiz do monorepo
- `apps/brain-sdr/docker-compose.yml` — referência para flags de build e variáveis de ambiente

### Infraestrutura existente

- `DOCKGATE_URL` e `DOCKGATE_UPLOAD_TOKEN` — secrets já configurados no GitHub repo (não precisam ser criados)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `apps/brain-sdr/Dockerfile` — pronto para uso; build multi-stage validado em v1.0 (Phase 4)
- `apps/brain-sdr/docker-compose.yml` — mostra flags de build corretos (contexto raiz, dockerfile explícito)

### Established Patterns

- Build context sempre na raiz do monorepo: `docker build -f apps/<brain>/Dockerfile .`
- Cada Brain tem seu próprio Dockerfile independente em `apps/<brain>/`
- Secrets de infraestrutura vêm de variáveis de ambiente (padrão do projeto desde v1.0)

### Integration Points

- `.github/workflows/` — diretório a ser criado para o workflow CI
- `MIGRATIONS_FOLDER` ENV já está no Dockerfile como `ENV MIGRATIONS_FOLDER=/app/migrations` — não precisa ser passado no CI

</code_context>

<specifics>
## Specific Ideas

### Workflow de referência (fornecido pelo usuário)

O usuário compartilhou um workflow GitHub Actions completo que documenta o contrato da API DockGate. Pontos-chave para a implementação:

```yaml
# Triggered on version tag pushes (e.g., v1.2.3)
on:
  push:
    tags:
      - 'v*.*.*'

env:
  APP_NAME: brain-sdr
  IMAGE_NAME: brain-sdr

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      # Extract version: "v1.4.0" → "1.4.0"
      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      # Build com contexto da raiz do monorepo
      - name: Build Docker image
        run: docker build -f apps/brain-sdr/Dockerfile -t $IMAGE_NAME:${{ steps.version.outputs.VERSION }} .

      # docker save (não docker export) — preserva layers
      - name: Export image to tar
        run: docker save $IMAGE_NAME:${{ steps.version.outputs.VERSION }} -o image.tar

      # sha256 + size (size como integer no payload)
      - name: Calculate sha256 and size
        id: integrity
        run: |
          echo "SHA256=$(sha256sum image.tar | awk '{ print $1 }')" >> $GITHUB_OUTPUT
          echo "SIZE=$(stat -c%s image.tar)" >> $GITHUB_OUTPUT

      # POST para obter presigned URL
      - name: Request upload URL from DockGate
        id: upload_url
        env:
          DOCKGATE_URL: ${{ secrets.DOCKGATE_URL }}
          DOCKGATE_UPLOAD_TOKEN: ${{ secrets.DOCKGATE_UPLOAD_TOKEN }}
        run: |
          RESPONSE=$(curl -sf -X POST \
            -H "Authorization: Bearer $DOCKGATE_UPLOAD_TOKEN" \
            "$DOCKGATE_URL/apps/$APP_NAME/upload?version=${{ steps.version.outputs.VERSION }}")
          echo "URL=$(echo $RESPONSE | jq -r .url)" >> $GITHUB_OUTPUT

      # Upload direto ao MinIO — sem Authorization header
      - name: Upload image to MinIO
        run: |
          curl -sf -X PUT \
            -H "Content-Type: application/octet-stream" \
            --upload-file image.tar \
            "${{ steps.upload_url.outputs.URL }}"

      # PUT /latest — size como integer (sem aspas)
      - name: Publish latest version via DockGate
        env:
          DOCKGATE_URL: ${{ secrets.DOCKGATE_URL }}
          DOCKGATE_UPLOAD_TOKEN: ${{ secrets.DOCKGATE_UPLOAD_TOKEN }}
        run: |
          curl -sf -X PUT \
            -H "Authorization: Bearer $DOCKGATE_UPLOAD_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"version\":\"${{ steps.version.outputs.VERSION }}\",\"sha256\":\"${{ steps.integrity.outputs.SHA256 }}\",\"size\":${{ steps.integrity.outputs.SIZE }}}" \
            "$DOCKGATE_URL/apps/$APP_NAME/latest"
```

</specifics>

<deferred>
## Deferred Ideas

- **brain-echo no pipeline DockGate** — ficou fora do escopo desta fase; adicionar em fase futura (cópia do workflow com `APP_NAME: brain-echo`)
- **Cache de layers Docker** — `docker/build-push-action` com cache para reduzir tempo de build; deixado para o agente decidir se vale a complexidade
- **Rollback automático** — mecanismo para apontar `latest` de volta para versão anterior se deploy falhar; fora de escopo por ora

</deferred>

---

*Phase: 18-build-and-publish-docker-image-via-dockgate*
*Context gathered: 2026-06-18*
