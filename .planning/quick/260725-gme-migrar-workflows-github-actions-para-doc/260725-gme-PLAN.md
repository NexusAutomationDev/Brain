---
phase: quick-260725-gme
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .github/workflows/publish-brain-sdr.yml
  - .github/workflows/publish-brain-support.yml
autonomous: true
requirements: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09]
must_haves:
  truths:
    - "Pushing a v*.*.* tag builds the app image and publishes it straight to docker.io/biellil/<IMAGE_NAME> — no intermediate tar export, upload-URL request, or artifact-hosting PUT calls happen anywhere in the job"
    - "The published image carries two tags: the semver version extracted from the git tag and latest, so both `docker pull biellil/brain-sdr:1.2.3` and `docker pull biellil/brain-sdr:latest` resolve to the same build"
    - "Authentication to the registry happens via docker/login-action@v3 with DOCKERHUB_USERNAME/DOCKERHUB_TOKEN secrets, and runs before the build/push step in job order"
    - "No leftover reference to the old artifact-hosting service, its secrets, its upload token, or the tar/checksum steps remains in either workflow file"
    - "publish-brain-sdr.yml and publish-brain-support.yml stay structurally identical aside from APP_NAME/IMAGE_NAME/Dockerfile path/cache scope"
  artifacts:
    - .github/workflows/publish-brain-sdr.yml
    - .github/workflows/publish-brain-support.yml
  key_links:
    - "docker/login-action@v3 step precedes docker/build-push-action@v6 in the job's steps list, so credentials exist before the push is attempted"
    - "build-push-action's tags: input references both steps.version.outputs.VERSION (from the existing 'Extract version from tag' step) and the literal latest tag"
    - "push: true replaces push: false/load: true so the built image actually reaches the registry instead of only living in the local Docker daemon"
---

<objective>
Migrar `publish-brain-sdr.yml` e `publish-brain-support.yml` do fluxo antigo de publicação (export para tar, cálculo de sha256/size, upload via serviço de artefatos + MinIO) para publicação direta no Docker Hub, sob o namespace `biellil`.

Purpose: O fluxo anterior dependia de um serviço de hospedagem de artefatos próprio (URLs de upload, token dedicado, MinIO como storage) que está sendo descontinuado. Docker Hub como registry padrão remove essa dependência de infraestrutura customizada e usa um mecanismo de autenticação/push nativo das GitHub Actions oficiais da Docker.

Output: Os dois workflows reescritos para logar no Docker Hub via `docker/login-action@v3` e publicar a imagem via `docker/build-push-action@v6` com `push: true`, taggeada com a versão semver extraída da tag git e `latest`. Nenhum vestígio do fluxo antigo (steps, env vars, secrets) permanece.
</objective>

<context>
@.planning/STATE.md
@.github/workflows/publish-brain-sdr.yml
@.github/workflows/publish-brain-support.yml

# Os dois arquivos são quase espelhos — só diferem em APP_NAME/IMAGE_NAME, no
# caminho do Dockerfile e no scope do cache. Aplicar a MESMA transformação aos dois.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migrar publish-brain-sdr.yml para publicação direta no Docker Hub</name>
  <files>.github/workflows/publish-brain-sdr.yml</files>
  <action>
Reescrever o comentário de cabeçalho (linhas 1-3) para descrever o novo fluxo: o workflow builda a imagem e publica direto em docker.io/biellil/brain-sdr autenticando via docker/login-action e publicando via docker/build-push-action, com tags da versão semver extraída da tag git e latest (per D-01, D-07). Remover qualquer menção ao fluxo antigo de hospedagem de artefatos do comentário.

Manter inalterados: o trigger `on.push.tags` (v*.*.*, v*.*), o bloco `env` (APP_NAME/IMAGE_NAME = brain-sdr), o step "Checkout" (actions/checkout@v4), o step "Extract version from tag" (que produz `steps.version.outputs.VERSION`) e o step "Set up Docker Buildx" (docker/setup-buildx-action@v3) — per D-06.

Inserir um novo step chamado "Log in to Docker Hub" usando `docker/login-action@v3` logo após o step de Buildx e antes do step de build, com `username: ${{ secrets.DOCKERHUB_USERNAME }}` e `password: ${{ secrets.DOCKERHUB_TOKEN }}` (per D-02, D-06).

Renomear o step de build para "Build and push Docker image" (mantendo `docker/build-push-action@v6`, `context: .` e `file: apps/brain-sdr/Dockerfile`). Trocar o `tags:` single-line pelo bloco multi-linha com dois valores: `biellil/${{ env.IMAGE_NAME }}:${{ steps.version.outputs.VERSION }}` e `biellil/${{ env.IMAGE_NAME }}:latest` (per D-01, D-04). Trocar a flag que hoje só builda localmente para publicar de fato no registry (per D-05) — manter `cache-from: type=gha,scope=brain-sdr` e `cache-to: type=gha,mode=max,scope=brain-sdr` exatamente como estão.

Deletar por completo todos os steps que vêm depois do step de build: o step que exporta a imagem para um arquivo de artefato local, o step que calcula seu hash/tamanho, o step que solicita uma URL de upload ao serviço de hospedagem de artefatos antigo, o step que faz o upload desse artefato via curl PUT, e o step que publica a versão "latest" nesse mesmo serviço — incluindo todas as env vars, chamadas curl e parsing associados a eles (per D-03). Nenhum resquício do serviço antigo, de suas secrets ou do seu token de upload deve permanecer no arquivo.
  </action>
  <verify>
    <automated>cd /root/Brain && python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/publish-brain-sdr.yml && ! grep -qi 'dockgate' .github/workflows/publish-brain-sdr.yml && ! grep -qi 'minio' .github/workflows/publish-brain-sdr.yml && ! grep -qi 'sha256sum' .github/workflows/publish-brain-sdr.yml && ! grep -q 'load: true' .github/workflows/publish-brain-sdr.yml && grep -q 'docker/login-action@v3' .github/workflows/publish-brain-sdr.yml && grep -q 'push: true' .github/workflows/publish-brain-sdr.yml && grep -q 'biellil/${{ env.IMAGE_NAME }}:latest' .github/workflows/publish-brain-sdr.yml && grep -q 'biellil/${{ env.IMAGE_NAME }}:${{ steps.version.outputs.VERSION }}' .github/workflows/publish-brain-sdr.yml && echo OK</automated>
  </verify>
  <done>publish-brain-sdr.yml builda e publica docker.io/biellil/brain-sdr via login-action + build-push-action com tags de versão semver e latest; nenhum passo do fluxo antigo de hospedagem de artefatos permanece; YAML válido.</done>
</task>

<task type="auto">
  <name>Task 2: Migrar publish-brain-support.yml para publicação direta no Docker Hub</name>
  <files>.github/workflows/publish-brain-support.yml</files>
  <action>
Aplicar a MESMA transformação do Task 1 a `publish-brain-support.yml`, trocando apenas os valores específicos deste arquivo (per D-08): `APP_NAME`/`IMAGE_NAME` = brain-support, `file: apps/brain-support/Dockerfile`, `scope: brain-support` em cache-from/cache-to, tags `biellil/${{ env.IMAGE_NAME }}:${{ steps.version.outputs.VERSION }}` e `biellil/${{ env.IMAGE_NAME }}:latest`.

Reescrever o comentário de cabeçalho (linhas 1-4) para o novo fluxo de Docker Hub (per D-01, D-07) — mas preservar a nota existente sobre o espelhamento com publish-brain-sdr.yml e sobre a tag v*.*.* disparar os dois workflows simultaneamente (comportamento intencionalmente aceito); só a parte que descreve o fluxo antigo de hospedagem de artefatos deve ser substituída.

Manter inalterados: o trigger `on.push.tags`, o bloco `env`, o step "Checkout" (actions/checkout@v4), o step "Extract version from tag" e o step "Set up Docker Buildx" (per D-06).

Inserir o step "Log in to Docker Hub" (`docker/login-action@v3`) antes do step de build, com `username: ${{ secrets.DOCKERHUB_USERNAME }}` e `password: ${{ secrets.DOCKERHUB_TOKEN }}` (per D-02, D-06).

Renomear o step de build para "Build and push Docker image", trocar a flag que hoje só builda localmente para publicar de fato no registry (per D-05), aplicar o `tags:` multi-linha com os dois valores acima (per D-04), mantendo `cache-from`/`cache-to` inalterados.

Deletar por completo os mesmos cinco steps do fluxo antigo descritos no Task 1 (export para artefato local, cálculo de hash/tamanho, solicitação de URL de upload, upload via curl PUT, publicação da versão "latest") — incluindo env vars, secrets e chamadas curl/jq associadas (per D-03).
  </action>
  <verify>
    <automated>cd /root/Brain && python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/publish-brain-support.yml && ! grep -qi 'dockgate' .github/workflows/publish-brain-support.yml && ! grep -qi 'minio' .github/workflows/publish-brain-support.yml && ! grep -qi 'sha256sum' .github/workflows/publish-brain-support.yml && ! grep -q 'load: true' .github/workflows/publish-brain-support.yml && grep -q 'docker/login-action@v3' .github/workflows/publish-brain-support.yml && grep -q 'push: true' .github/workflows/publish-brain-support.yml && grep -q 'biellil/${{ env.IMAGE_NAME }}:latest' .github/workflows/publish-brain-support.yml && grep -q 'biellil/${{ env.IMAGE_NAME }}:${{ steps.version.outputs.VERSION }}' .github/workflows/publish-brain-support.yml && echo OK</automated>
  </verify>
  <done>publish-brain-support.yml builda e publica docker.io/biellil/brain-support via login-action + build-push-action com tags de versão semver e latest; nenhum passo do fluxo antigo de hospedagem de artefatos permanece; YAML válido; arquivo continua espelhando publish-brain-sdr.yml estruturalmente.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GitHub Actions runner → Docker Hub | Runner authenticates with long-lived account credentials and pushes an artifact to a public registry namespace |
| Repo secrets → workflow env | `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` cross from GitHub encrypted secrets into the job's process environment |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-260725-gme-01 | Information Disclosure | DOCKERHUB_TOKEN consumed by docker/login-action@v3 | high | mitigate | Token stays a GitHub encrypted secret referenced only as `${{ secrets.DOCKERHUB_TOKEN }}`; login-action masks the value in logs automatically; no step prints or persists it |
| T-quick-260725-gme-02 | Tampering | docker/login-action@v3, docker/build-push-action@v6, docker/setup-buildx-action@v3 | medium | accept | All three are official Docker-maintained GitHub Actions already pinned to major version tags; build-push-action was already in use pre-migration, login-action is the same publisher — no new third-party action introduced |
| T-quick-260725-gme-03 | Spoofing | Push destination docker.io/biellil/* | low | accept | Namespace is the developer's own Docker Hub account; no shared/public org registry involved |
| T-quick-260725-gme-SC | Tampering | GitHub Actions marketplace installs | high | mitigate | This change introduces no new npm/pip/cargo package installs — only the official `docker/login-action@v3`, already the same publisher/trust tier as the pre-existing `docker/build-push-action@v6` and `docker/setup-buildx-action@v3`; no blocking human-verify checkpoint required since nothing here is [ASSUMED]/[SUS] |
</threat_model>

<verification>
- `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/publish-brain-sdr.yml` and the same for `publish-brain-support.yml` both parse without error
- Neither file contains any case-insensitive reference to the old artifact-hosting service or its storage backend, nor to `sha256sum`, nor to `load: true`
- Both files contain `docker/login-action@v3`, `push: true`, and both the semver-version and `latest` tags in the build-push step
- `git diff --stat .github/workflows/publish-brain-sdr.yml .github/workflows/publish-brain-support.yml` shows only these two files changed
</verification>

<success_criteria>
- Pushing a `v*.*.*` tag builds and pushes `docker.io/biellil/brain-sdr` and `docker.io/biellil/brain-support` directly, tagged with both the semver version and `latest`
- Authentication uses `docker/login-action@v3` with `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets, no other credential path
- Zero remaining steps, env vars, or secrets tied to the old artifact-hosting/tar-upload flow in either file
- Both workflow files remain structurally mirrored (only per-app values differ)
- Commit message follows CLAUDE.md convention: `🤖 ci: ...` (per D-09)
</success_criteria>

<output>
Create `.planning/quick/260725-gme-migrar-workflows-github-actions-para-doc/260725-gme-SUMMARY.md` when done
</output>

