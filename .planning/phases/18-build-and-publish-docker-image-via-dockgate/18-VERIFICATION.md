---
phase: 18-build-and-publish-docker-image-via-dockgate
verified: 2026-06-18T17:41:36Z
status: human_needed
score: 8/8
overrides_applied: 0
human_verification:
  - test: "Confirmar que GitHub Actions run 27777439427 existe e todos os 9 steps estão verdes"
    expected: "Run ID 27777439427, status SUCCESS, duração 3m18s, versão 0.0.1 publicada"
    why_human: "Verificação programática do estado de runs externos do GitHub Actions não é possível sem gh CLI autenticado ou token de acesso ao repo"
  - test: "Confirmar que GET $DOCKGATE_URL/apps/brain-sdr/latest retorna versão 0.0.1 no registry"
    expected: "Resposta JSON com campo version: '0.0.1' e campos sha256 e size preenchidos"
    why_human: "Requer acesso à URL interna do DockGate registry — serviço externo sem acesso programático"
  - test: "Confirmar que os secrets DOCKGATE_URL e DOCKGATE_URL aparecem mascarados como *** nos logs do run"
    expected: "Nenhum valor real dos secrets visível — apenas *** nos logs"
    why_human: "Logs de execução do GitHub Actions requerem autenticação para leitura"
---

# Phase 18: Build and Publish Docker Image via DockGate — Verification Report

**Phase Goal:** Criar o pipeline de CI/CD (GitHub Actions) que builda a imagem Docker do brain-sdr e publica via DockGate — o registry Docker auto-hospedado do projeto, com API sobre MinIO. Disparado por push de tag semver v*.*.*.
**Verified:** 2026-06-18T17:41:36Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | O arquivo `.github/workflows/publish-brain-sdr.yml` existe no repositório | VERIFIED | Arquivo presente em `/root/Brain/.github/workflows/publish-brain-sdr.yml`, 79 linhas |
| 2 | O workflow dispara exclusivamente em push de tags `v*.*.*` | VERIFIED | `on: push: tags: - 'v*.*.*'` na linha 7-9; sem trigger de branches |
| 3 | A versão enviada ao DockGate não tem o prefixo 'v' (tag v1.4.0 → version 1.4.0) | VERIFIED | `VERSION=${GITHUB_REF#refs/tags/v}` na linha 27 — strip explícito do prefixo v |
| 4 | A imagem é exportada com `docker save` (não `docker export`) | VERIFIED | `docker save $IMAGE_NAME:${{ steps.version.outputs.VERSION }} -o image.tar` na linha 44 |
| 5 | O upload MinIO usa `curl --upload-file` sem `Authorization` header | VERIFIED | Step "Upload image to MinIO" (linhas 63-67): apenas `curl -f --show-error -X PUT --upload-file image.tar` — sem nenhum header |
| 6 | O campo `size` no PUT /latest é integer JSON (sem aspas) | VERIFIED | Linha 77: `\"size\":${{ steps.integrity.outputs.SIZE }}` — o valor não está entre aspas (confirmado via análise de bytes do arquivo) |
| 7 | Nenhum secret aparece hardcoded — todos via `${{ secrets.X }}` | VERIFIED | `${{ secrets.DOCKGATE_URL }}` e `${{ secrets.DOCKGATE_UPLOAD_TOKEN }}` — grep para tokens hardcoded retornou vazio |
| 8 | O job declara `permissions: contents: read` (menor privilégio) | VERIFIED | `permissions: contents: read` na linha 19 |

**Score:** 8/8 truths verified

---

### Deferred Items

Nenhum item diferido.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.github/workflows/publish-brain-sdr.yml` | Pipeline CI/CD completo para build e publicação do brain-sdr | VERIFIED | Arquivo existe, 79 linhas, YAML válido (python3 yaml.safe_load sem erros). Contém todos os elementos esperados: trigger semver, APP_NAME/IMAGE_NAME env, docker save, curl PUT /apps/brain-sdr/latest |

**Nota sobre desvio documentado:** O plano original especificava `Content-Type: application/octet-stream` no step de upload MinIO. Durante a execução real (run 27777439427), o MinIO rejeitou o upload com esse header (conflito de assinatura HMAC em URLs presignadas). O header foi removido — o step agora usa `curl -f --show-error -X PUT --upload-file image.tar` sem nenhum header adicional. O SUMMARY documenta esse fix como decisão D-02 revisada. O comportamento real está correto.

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| step: Request upload URL from DockGate | step: Upload image to MinIO | `steps.upload_url.outputs.URL` | WIRED | Linha 67: `"${{ steps.upload_url.outputs.URL }}"` — step `upload_url` (id definido na linha 53) passa a URL presignada diretamente para o curl PUT |
| step: Calculate sha256 and size | step: Publish latest version via DockGate | `steps.integrity.outputs.SHA256` + `steps.integrity.outputs.SIZE` | WIRED | Linha 77: `"sha256\":\"${{ steps.integrity.outputs.SHA256 }}\",\"size\":${{ steps.integrity.outputs.SIZE }}"` — step `integrity` (id definido na linha 47) fornece ambos os valores ao payload PUT /latest |

---

### Data-Flow Trace (Level 4)

N/A — fase produce exclusivamente um arquivo de infraestrutura CI (YAML). Não há componentes que renderizam dados dinâmicos. Level 4 não se aplica.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| YAML sintaticamente válido | `python3 -c "import yaml; yaml.safe_load(open('/root/Brain/.github/workflows/publish-brain-sdr.yml'))"` | Sem erros | PASS |
| Trigger exclusivo em tags (não branches) | `grep -n "branches" .github/workflows/publish-brain-sdr.yml` | Sem resultado (linha 38 é `push: false` do buildx) | PASS |
| Step IDs necessários definidos | IDs: `version`, `integrity`, `upload_url` | Encontrados nas linhas 26, 47, 53 respectivamente | PASS |
| Execução real no GitHub Actions | Run ID 27777439427 — requer acesso externo | Não verificável programaticamente | SKIP (human) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DOCKER-BUILD-01 | 18-01-PLAN.md | Build da imagem Docker do brain-sdr | SATISFIED | `docker/build-push-action@v6` com `context: .` e `file: apps/brain-sdr/Dockerfile` (linhas 33-41) |
| DOCKER-EXPORT-01 | 18-01-PLAN.md | Exportar imagem para arquivo tar | SATISFIED | `docker save $IMAGE_NAME:... -o image.tar` (linha 44) |
| DOCKGATE-UPLOAD-01 | 18-01-PLAN.md | Upload da imagem para o storage MinIO via presigned URL | SATISFIED | Step "Request upload URL from DockGate" (POST /upload) + step "Upload image to MinIO" (PUT presigned URL sem Authorization header) — linhas 52-67 |
| DOCKGATE-PUBLISH-01 | 18-01-PLAN.md | Publicar versão no registry DockGate via PUT /latest | SATISFIED | Step "Publish latest version via DockGate" com payload `{version, sha256, size: integer}` — linhas 69-78 |

**REQUIREMENTS.md:** O arquivo `.planning/REQUIREMENTS.md` não existe no repositório. Os IDs de requisito são rastreados exclusivamente via frontmatter do PLAN e do ROADMAP.md. Todos os 4 IDs declarados no PLAN (`requirements: [DOCKER-BUILD-01, DOCKER-EXPORT-01, DOCKGATE-UPLOAD-01, DOCKGATE-PUBLISH-01]`) têm implementação verificável no arquivo de workflow.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | — |

Nenhum anti-pattern encontrado. Sem TODOs, FIXMEs, retornos vazios, ou secrets hardcoded.

---

### Human Verification Required

#### 1. GitHub Actions Run Confirmado

**Test:** Acessar GitHub → Actions → "Publish brain-sdr" → localizar run ID 27777439427
**Expected:** Run com status SUCCESS, duração 3m18s, 9 steps verdes, versão publicada como 0.0.1 (tag v0.0.1)
**Why human:** Verificação de execuções de CI externas requer autenticação no GitHub — não possível via grep/file checks

#### 2. DockGate Registry Confirma Latest

**Test:** `curl -s $DOCKGATE_URL/apps/brain-sdr/latest` (substituindo DOCKGATE_URL pelo valor real)
**Expected:** JSON com `{"version":"0.0.1","sha256":"<hex>","size":<integer>}`
**Why human:** DOCKGATE_URL é um secret — não está disponível no ambiente de verificação estática

#### 3. Secrets Mascarados nos Logs

**Test:** Abrir logs do run 27777439427 no GitHub Actions e verificar steps que usam `DOCKGATE_URL` e `DOCKGATE_UPLOAD_TOKEN`
**Expected:** Valores dos secrets aparecem como `***` nos logs — nunca em texto claro
**Why human:** Logs de execução do GitHub Actions requerem autenticação para leitura

---

### Gaps Summary

Nenhum gap encontrado. Todos os 8 must-haves passaram na verificação estática. O workflow implementa o fluxo completo de 3 etapas do DockGate conforme especificado, com todos os requisitos de segurança atendidos (menor privilégio, sem secrets hardcoded, sem Authorization header no upload MinIO, size como integer JSON).

Os 3 itens de human verification são de natureza operacional (execução real de CI e acesso ao registry externo) — não indicam falha de implementação.

---

_Verified: 2026-06-18T17:41:36Z_
_Verifier: Claude (gsd-verifier)_
