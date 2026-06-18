# Phase 18: Build and Publish Docker Image via DockGate - Research

**Researched:** 2026-06-18
**Domain:** GitHub Actions CI/CD — Docker build, export, and publish to custom registry (DockGate/MinIO)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** DockGate é um registry Docker auto-hospedado pelo projeto, com API própria sobre MinIO.
- **D-02:** Fluxo de publicação em 3 etapas: POST /apps/:name/upload?version=X → PUT presigned_url → PUT /apps/:name/latest
- **D-03:** Autenticação: `DOCKGATE_URL` e `DOCKGATE_UPLOAD_TOKEN` como GitHub Secrets (Bearer token). Secrets já existem.
- **D-04:** `APP_NAME` no DockGate = `brain-sdr`. Sem prefixo de org nesta fase.
- **D-05:** Usar `docker save` (não `docker export`) para exportar a imagem.
- **D-06:** `size` no payload do PUT /latest deve ser **integer JSON** (não string) — `$SIZE` sem aspas no JSON.
- **D-07:** GitHub Actions, disparado por tag git `v*.*.*`.
- **D-08:** A versão enviada ao DockGate é a tag **sem o prefixo "v"**: tag `v1.4.0` → version `1.4.0`. Extraído via `${GITHUB_REF#refs/tags/v}`.
- **D-09:** Um workflow por Brain: `.github/workflows/publish-brain-sdr.yml`.
- **D-10:** Build com contexto da raiz do monorepo: `docker build -f apps/brain-sdr/Dockerfile .`
- **D-11:** Tag git é compartilhada por todo o monorepo.
- **D-12:** `IMAGE_NAME` usado localmente no build: `brain-sdr` (sem org prefix).
- **D-13:** Fase 18 cobre **apenas o `brain-sdr`**.
- **D-14:** O workflow deve ser estruturado de forma que adicionar `brain-echo` no futuro seja trivial.

### Claude's Discretion

- Nome exato do workflow file: `publish-brain-sdr.yml` em `.github/workflows/`
- Step de checkout: `actions/checkout@v4` (versão mais recente estável)
- Tempo estimado de build (ubuntu-latest): sem cache de layers — o agente decide se vale adicionar cache de layers do Docker (buildx cache) ou deixar simples para começar
- `IMAGE_NAME` no build local pode ser apenas `brain-sdr` sem org prefix

### Deferred Ideas (OUT OF SCOPE)

- **brain-echo no pipeline DockGate** — fase futura
- **Cache de layers Docker** — deixado para o agente decidir
- **Rollback automático** — fora de escopo
</user_constraints>

---

## Summary

Esta fase consiste em criar um único arquivo YAML de GitHub Actions (`.github/workflows/publish-brain-sdr.yml`) que automatiza o pipeline de empacotamento e publicação do `brain-sdr`. O workflow dispara em push de tag `v*.*.*`, builda a imagem Docker multi-stage existente com contexto na raiz do monorepo, exporta via `docker save`, calcula sha256 e tamanho, e publica no DockGate em 3 chamadas de API via `curl`.

O workflow de referência fornecido pelo usuário no CONTEXT.md já é o contrato canônico da API DockGate e um template quase completo. A pesquisa confirma que todos os padrões shell usados (`sha256sum`, `stat -c%s`, `${GITHUB_REF#refs/tags/v}`, `jq -r .url`) são idiomáticos e corretos para ubuntu-latest. A decisão sobre usar buildx cache (deixada a critério do agente) foi pesquisada — recomendação: adicionar cache gha com scope para reduzir rebuild de layers entre tags consecutivas.

O único artefato a criar nesta fase é o diretório `.github/workflows/` (não existe ainda no repositório) e o arquivo `publish-brain-sdr.yml` dentro dele.

**Primary recommendation:** Criar `.github/workflows/publish-brain-sdr.yml` seguindo fielmente o workflow de referência do CONTEXT.md, adicionando opcionalmente `docker/setup-buildx-action@v3` + cache `type=gha,scope=brain-sdr` para builds mais rápidos em tags subsequentes.

---

## Standard Stack

### Core Actions

| Action | Version recomendada | Purpose | Why Standard |
|--------|---------------------|---------|--------------|
| `actions/checkout` | `@v4` | Checkout do repositório | Versão estável atual; v5 existe mas v4 é amplamente usada [VERIFIED: WebSearch] |
| `docker/setup-buildx-action` | `@v3` | Habilita BuildKit + driver docker-container | Necessário para cache GHA; v4 disponível mas requer runner v2.327.1+ [VERIFIED: WebSearch] |
| Shell built-ins (`curl`, `jq`, `sha256sum`, `stat`) | ubuntu-latest built-in | HTTP, parse JSON, hash, tamanho | Pré-instalados no ubuntu-latest — sem install steps extras [VERIFIED: conhecimento confirmado por contexto] |

### Suporte Opcional (Cache)

| Recurso | Quando usar | Tradeoff |
|---------|-------------|----------|
| `cache-from/cache-to type=gha,scope=brain-sdr` | Se build time > 5min | Reduz rebuild de layers Bun/pnpm; 10 GB cache limite por repo [VERIFIED: Docker Docs] |
| `docker/build-push-action@v6` | Se usar buildx push para registry padrão | Não necessário — este projeto usa export manual para DockGate |

**Instalação:** Nenhum pacote npm a instalar. O workflow opera apenas com comandos shell (`docker`, `curl`, `jq`) pré-instalados no runner `ubuntu-latest`.

---

## Architecture Patterns

### Estrutura de Arquivos a Criar

```
.github/
└── workflows/
    └── publish-brain-sdr.yml    # único artefato desta fase
```

O diretório `.github/workflows/` ainda NÃO existe no repositório (confirmado via `ls`). Precisa ser criado.

### Pattern 1: Tag-Based Release Trigger

**What:** Workflow disparado exclusivamente por push de tags semver.
**When to use:** Releases de produto — tag = versão publicada.

```yaml
# Source: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
on:
  push:
    tags:
      - 'v*.*.*'
```

**Pitfall:** `on: push` sem filtro `tags:` ou com `branches:` incluso também dispara em branches. O CONTEXT.md já especifica a forma correta — só `tags`.

### Pattern 2: Extração de Versão sem Prefixo

**What:** Remover o "v" da tag para gerar a versão semântica enviada ao DockGate.
**When to use:** Sempre que a tag segue `vX.Y.Z` e a API espera `X.Y.Z`.

```yaml
# Source: workflow de referência do usuário (CONTEXT.md)
- name: Extract version from tag
  id: version
  run: echo "VERSION=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT
```

`${GITHUB_REF#refs/tags/v}` é substituição de prefixo nativa do bash — sem dependência de `sed` ou `cut`. [VERIFIED: idioma bash padrão]

### Pattern 3: docker save + sha256 + stat

**What:** Exportar imagem local para `.tar`, calcular integridade e tamanho como inteiros.
**When to use:** Publicação em registry não-padrão (DockGate/MinIO) via presigned URL.

```yaml
# Source: workflow de referência do usuário (CONTEXT.md)
- name: Export image to tar
  run: docker save $IMAGE_NAME:${{ steps.version.outputs.VERSION }} -o image.tar

- name: Calculate sha256 and size
  id: integrity
  run: |
    echo "SHA256=$(sha256sum image.tar | awk '{ print $1 }')" >> $GITHUB_OUTPUT
    echo "SIZE=$(stat -c%s image.tar)" >> $GITHUB_OUTPUT
```

`stat -c%s` retorna o tamanho em bytes como inteiro puro — sem trailing spaces ou nome de arquivo. [VERIFIED: Linux man page / WebSearch]

### Pattern 4: Upload MinIO via Presigned URL (sem Authorization)

**What:** PUT direto ao MinIO usando a URL presignada — as credenciais estão embutidas na URL.
**Pitfall crítico:** NÃO adicionar `Authorization` header no step de upload MinIO. O header de auth vai apenas nas chamadas à API DockGate. Adicionar auth na chamada MinIO causará erro 403 (assinatura dupla). [CITED: D-02 em CONTEXT.md]

```yaml
# Source: workflow de referência do usuário (CONTEXT.md)
- name: Upload image to MinIO
  run: |
    curl -sf -X PUT \
      -H "Content-Type: application/octet-stream" \
      --upload-file image.tar \
      "${{ steps.upload_url.outputs.URL }}"
```

### Pattern 5: PUT /latest com size como integer JSON

**What:** Publicar o ponteiro "latest" no DockGate com metadados de integridade.
**Pitfall crítico:** `size` DEVE ser integer JSON, não string. `$SIZE` sem aspas no JSON. [CITED: D-06 em CONTEXT.md]

```yaml
# Source: workflow de referência do usuário (CONTEXT.md)
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

### Anti-Patterns to Avoid

- **`docker export` em vez de `docker save`:** `docker export` extrai o filesystem do container, não a imagem com layers. `docker load` não consegue carregar um arquivo gerado por `docker export`. Usar sempre `docker save`. [CITED: D-05 em CONTEXT.md]
- **`size` como string JSON:** `"size": "$SIZE"` causa HTTP 400 no DockGate. O campo espera integer. [CITED: D-06 em CONTEXT.md]
- **Authorization header no PUT MinIO:** URLs presignadas do MinIO incorporam as credenciais na assinatura da URL. Adicionar `Authorization` header conflita com a assinatura e resulta em 403.
- **`$GITHUB_OUTPUT` via `set-output`:** O comando `::set-output::` foi deprecated. Usar `>> $GITHUB_OUTPUT` (já correto no workflow de referência). [VERIFIED: GitHub Changelog 2022]
- **Contexto de build errado:** `docker build apps/brain-sdr/` (contexto no app) falha — o Dockerfile faz `COPY packages/` que não existe relativo ao app. Contexto DEVE ser a raiz: `docker build -f apps/brain-sdr/Dockerfile .` [CITED: D-10 + docker-compose.yml existente]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Extração de versão da tag | Custom parsing com `sed`/`cut` | `${GITHUB_REF#refs/tags/v}` (bash built-in) | Mais simples, sem subprocesso, sem dependência |
| Cálculo de sha256 | Implementação própria | `sha256sum` (GNU coreutils pré-instalado) | Disponível em todo ubuntu-latest |
| Tamanho do arquivo | `ls -la \| awk` | `stat -c%s` | Retorna integer limpo, sem parsing |
| Parse da URL presignada | String manipulation | `jq -r .url` | Robusto para URLs com caracteres especiais |
| Upload para MinIO | Código Python/Node custom | `curl --upload-file` | Zero dependência, confiável, retry-safe com `-f` |

**Key insight:** Todo o pipeline de 3 etapas do DockGate é implementável com shell puro (`curl`, `jq`, `sha256sum`, `stat`, `docker`) — nenhuma Action de terceiro é necessária além do `checkout`.

---

## Runtime State Inventory

Esta fase é greenfield (criação de arquivo YAML novo). Sem estado de runtime a migrar.

**Nothing found in category:** Verificado — nenhum workflow GitHub Actions existe ainda no repositório (`ls .github/` retornou NOT FOUND).

---

## Common Pitfalls

### Pitfall 1: Authorization Header no Upload MinIO

**What goes wrong:** Adicionar `Authorization: Bearer $DOCKGATE_UPLOAD_TOKEN` no step de `curl --upload-file` retorna 403 do MinIO.
**Why it happens:** URLs presignadas do MinIO incluem credenciais assinadas na própria URL (query params `X-Amz-Signature`, `X-Amz-Credential` etc.). Um header `Authorization` adicional conflita com a assinatura pre-calculada.
**How to avoid:** O header `Authorization` vai APENAS nas chamadas à API DockGate (POST /upload e PUT /latest). O PUT para a URL presignada não leva Authorization header.
**Warning signs:** HTTP 403 com body `SignatureDoesNotMatch` no step de upload.

### Pitfall 2: size como String em vez de Integer

**What goes wrong:** `curl -d "{\"size\":\"$SIZE\"}"` (com aspas ao redor de `$SIZE`) retorna HTTP 400 do DockGate.
**Why it happens:** O DockGate valida o schema do payload e espera `size` como number JSON, não string.
**How to avoid:** Omitir aspas ao redor de `$SIZE` na string JSON: `"size":${{ steps.integrity.outputs.SIZE }}`.
**Warning signs:** HTTP 400 no step "Publish latest version via DockGate".

### Pitfall 3: Contexto de Build Incorreto

**What goes wrong:** `docker build apps/brain-sdr/` — o Dockerfile referencia `COPY packages/` relativo ao contexto, que não existe dentro de `apps/brain-sdr/`.
**Why it happens:** O Dockerfile multi-stage copia toda a pasta `packages/` do monorepo para o builder.
**How to avoid:** Sempre usar contexto na raiz: `docker build -f apps/brain-sdr/Dockerfile .`
**Warning signs:** `COPY failed: file not found in build context`.

### Pitfall 4: Disco Insuficiente no Runner

**What goes wrong:** Build falha com `no space left on device` durante `docker build` ou `docker save`.
**Why it happens:** `ubuntu-latest` começa com ~22 GB livres (x64). Uma imagem multi-stage pnpm com Bun pode gerar 2-4 GB de layers + 1-2 GB para o `.tar`. Se o runner já carregou imagens Docker pré-instaladas, o espaço pode ser limitado.
**How to avoid:** Para esta fase simples (imagem estimada < 2 GB), o espaço padrão deve ser suficiente. Se falhar, adicionar step de limpeza antes do build:
```yaml
- name: Free disk space
  run: docker system prune -af
```
**Warning signs:** `no space left on device` nos logs do step de build ou save.

### Pitfall 5: Presigned URL expirada (900s)

**What goes wrong:** O step de upload falha com `403 Request has expired` se o intervalo entre o POST /upload e o PUT presigned exceder 900 segundos.
**Why it happens:** A URL presignada é válida por 900s (15 minutos). Um build Docker lento pode ultrapassar esse limite.
**How to avoid:** Obter a presigned URL APÓS o build e save estarem completos (como no workflow de referência). Não pré-obter a URL antes do build. O workflow de referência já está correto neste ponto.
**Warning signs:** HTTP 403 no step de upload com `RequestTimeTooSkewed` ou `Request has expired`.

---

## Code Examples

### Workflow Completo (baseado no workflow de referência do CONTEXT.md)

```yaml
# Source: workflow de referência do usuário (CONTEXT.md) — contrato canônico da API DockGate
name: Publish brain-sdr

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
    permissions:
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      - name: Build Docker image
        run: docker build -f apps/brain-sdr/Dockerfile -t $IMAGE_NAME:${{ steps.version.outputs.VERSION }} .

      - name: Export image to tar
        run: docker save $IMAGE_NAME:${{ steps.version.outputs.VERSION }} -o image.tar

      - name: Calculate sha256 and size
        id: integrity
        run: |
          echo "SHA256=$(sha256sum image.tar | awk '{ print $1 }')" >> $GITHUB_OUTPUT
          echo "SIZE=$(stat -c%s image.tar)" >> $GITHUB_OUTPUT

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

      - name: Upload image to MinIO
        run: |
          curl -sf -X PUT \
            -H "Content-Type: application/octet-stream" \
            --upload-file image.tar \
            "${{ steps.upload_url.outputs.URL }}"

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

### Variante com Cache Docker (opcional — Claude's Discretion)

Se o planner decidir adicionar cache de layers para reduzir tempo de rebuild:

```yaml
# Source: https://docs.docker.com/build/ci/github-actions/cache/
# Inserir ANTES do step de build:
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

# Substituir o step de build por:
- name: Build Docker image
  uses: docker/build-push-action@v6
  with:
    context: .
    file: apps/brain-sdr/Dockerfile
    tags: ${{ env.IMAGE_NAME }}:${{ steps.version.outputs.VERSION }}
    push: false
    load: true
    cache-from: type=gha,scope=brain-sdr
    cache-to: type=gha,mode=max,scope=brain-sdr
```

**Tradeoff:** Adiciona 2 steps + ~30s de setup; economiza ~3-5min em builds subsequentes se as layers do builder (node:22-slim + pnpm) não mudaram. Recomendado se build time > 5min.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `::set-output::` | `>> $GITHUB_OUTPUT` | Set/2022 | set-output deprecated; usar nova sintaxe |
| `actions/checkout@v3` | `actions/checkout@v4` | Nov/2023 | v4 usa Node 20; v3 usa Node 16 (deprecated) |
| `docker/setup-buildx-action@v2` | `@v3` (ou `@v4`) | 2024/2025 | v3 estável; v4 requer runner 2.327.1+ |

**Deprecated/outdated:**
- `::set-output name=FOO::bar`: Substituído por `echo "FOO=bar" >> $GITHUB_OUTPUT`
- `actions/checkout@v2/v3`: Node 16/18 sendo removidos progressivamente dos runners

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ubuntu-latest` tem ~22 GB livres; imagem brain-sdr < 2 GB — espaço suficiente sem limpeza prévia | Common Pitfalls #4 | Build pode falhar com `no space left on device`; mitigação: adicionar `docker system prune -af` antes do build |
| A2 | `docker/setup-buildx-action@v3` é compatível com o runner `ubuntu-latest` atual | Standard Stack | Se runner exigir v4, ajustar versão — impacto mínimo |
| A3 | A URL presigned retornada pelo DockGate está no campo `.url` do JSON response | Code Examples | Se o campo tiver nome diferente, o `jq -r .url` retornará `null` e o upload falhará com URL inválida |

**Nota:** A3 é baseado no workflow de referência fornecido pelo próprio usuário — probabilidade de estar errado é mínima.

---

## Open Questions

1. **Adicionar cache de layers Docker?**
   - What we know: A decisão foi deixada a critério do agente (Claude's Discretion)
   - What's unclear: Tempo estimado de build sem cache (depende de pnpm install + tsc de 7 packages)
   - Recommendation: Adicionar `docker/setup-buildx-action@v3` + `cache-from/cache-to type=gha,scope=brain-sdr` desde o início. O overhead de setup é ~30s mas economiza 3-5 min em cada push de tag subsequente. Como é um detalhe de implementação no mesmo arquivo YAML, não aumenta a complexidade do plano.

2. **`permissions` explícitos no workflow?**
   - What we know: O GITHUB_TOKEN padrão no repositório pode ter permissões amplas ou restritivas dependendo da configuração da organização
   - What's unclear: Configuração atual de permissões do repositório
   - Recommendation: Adicionar `permissions: contents: read` explícito no job para seguir princípio de menor privilégio. O workflow só precisa ler o código — não faz push para GitHub Packages nem cria releases.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `docker` CLI | Build + save da imagem | — (runner, não local) | ubuntu-latest: 29.x | — |
| `curl` | Chamadas à API DockGate e MinIO | Pré-instalado ubuntu-latest | — | — |
| `jq` | Parse da URL presignada | Pré-instalado ubuntu-latest | — | `python3 -c "import json,sys; print(json.load(sys.stdin)['url'])"` |
| `sha256sum` | Hash da imagem | Pré-instalado ubuntu-latest (GNU coreutils) | — | `openssl dgst -sha256` |
| `stat -c%s` | Tamanho do arquivo | Pré-instalado ubuntu-latest (GNU coreutils) | — | `wc -c < image.tar` |
| GitHub Secrets: `DOCKGATE_URL`, `DOCKGATE_UPLOAD_TOKEN` | Auth + endpoint | Confirmado (já configurados) | — | — |
| `.github/workflows/` directory | Arquivo do workflow | Ausente — criar junto com o arquivo | — | — |

**Missing dependencies with no fallback:** Nenhuma — todos os tools são pré-instalados no runner ubuntu-latest.

**Nota:** As verificações de disponibilidade acima são para o runner de CI (ubuntu-latest), não para a máquina local. O runner é o ambiente de execução real desta fase.

---

## Validation Architecture

O arquivo YAML criado nesta fase não tem testes unitários automatizados aplicáveis via `bun test`. A validação é funcional:

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Como Validar |
|-----|----------|-----------|--------------|
| Build | Imagem buildada com sucesso | Smoke (manual) | Push de tag `v*.*.*` no GitHub e verificar Actions run |
| Export | `.tar` gerado com sha256 e size corretos | Smoke (manual) | Verificar steps no log do workflow |
| Upload | Upload presigned bem-sucedido (HTTP 200) | Smoke (manual) | Verificar step "Upload image to MinIO" no log |
| Publish | DockGate retorna 200 no PUT /latest | Smoke (manual) | Verificar step "Publish latest version" no log |

**Nota:** `workflow.nyquist_validation` está habilitado no config.json, mas esta fase cria apenas infraestrutura CI (arquivo YAML). Não há código TypeScript a testar com `bun test`. A validação ocorre via execução real do workflow no GitHub Actions.

### Wave 0 Gaps

- [ ] `.github/workflows/` directory — criar junto com o arquivo do workflow

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | sim | Bearer token via GitHub Secrets — nunca hardcoded |
| V4 Access Control | sim | `permissions: contents: read` — princípio do menor privilégio |
| V5 Input Validation | não | Workflow não processa input externo não-confiável |
| V6 Cryptography | sim | sha256 para integridade da imagem — algoritmo padrão, não hand-rolled |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leak nos logs | Information Disclosure | Usar `env:` block para secrets — GitHub Actions mascara automaticamente valores de secrets nos logs |
| Supply chain (Actions de terceiros) | Tampering | Fixar versões das Actions com `@v4`, `@v3` — evitar `@main` ou SHA flutuante |
| Tag forgery (trigger indevido) | Spoofing | Trigger restrito a `tags: v*.*.*` — apenas quem tem permissão de push de tags no repo pode disparar |

---

## Sources

### Primary (HIGH confidence)
- Workflow de referência fornecido pelo usuário em CONTEXT.md — contrato canônico da API DockGate
- `/root/Brain/apps/brain-sdr/Dockerfile` — Dockerfile multi-stage validado
- `/root/Brain/apps/brain-sdr/docker-compose.yml` — confirma contexto de build na raiz

### Secondary (MEDIUM confidence)
- [GitHub Actions Workflow Syntax Docs](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions) — sintaxe de triggers e permissions
- [Docker Build CI GitHub Actions](https://docs.docker.com/build/ci/github-actions/) — padrões de build com buildx
- [Docker GHA Cache Docs](https://docs.docker.com/build/ci/github-actions/cache/) — cache type=gha scope

### Tertiary (LOW confidence — contexto adicional)
- WebSearch: disk space ubuntu-latest runners (~22 GB livres confirmado por múltiplas fontes)
- WebSearch: actions/checkout@v4, docker/setup-buildx-action@v3 versões atuais confirmadas

---

## Metadata

**Confidence breakdown:**
- Workflow de referência: HIGH — fornecido pelo próprio usuário, é a fonte de verdade
- Shell commands (sha256sum, stat, docker save): HIGH — comandos padrão Linux verificados
- Versões das Actions: MEDIUM — confirmadas por WebSearch, podem ter versão maior disponível
- Tempo de build estimado: LOW — depende do estado das layers no runner

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (GitHub Actions actions/@versions mudam ocasionalmente; lógica shell é estável)
