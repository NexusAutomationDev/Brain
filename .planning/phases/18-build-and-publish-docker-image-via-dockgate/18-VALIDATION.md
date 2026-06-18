---
phase: 18
slug: build-and-publish-docker-image-via-dockgate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-18
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — fase cria apenas infraestrutura CI (arquivo YAML) |
| **Config file** | N/A |
| **Quick run command** | `yamllint .github/workflows/publish-brain-sdr.yml` (opcional) |
| **Full suite command** | Push de tag `v*.*.*` no GitHub → verificar workflow run |
| **Estimated runtime** | ~15-20 min (build Docker completo no runner ubuntu-latest) |

---

## Sampling Rate

- **After every task commit:** Verificar que o arquivo YAML é válido (sintaxe YAML + estrutura GitHub Actions)
- **After every plan wave:** Revisar o workflow YAML manualmente antes de fazer push de tag
- **Before `/gsd-verify-work`:** Push de tag de teste (ex: `v0.0.1-test`) e verificar execução real no GitHub Actions
- **Max feedback latency:** ~20 minutos (tempo de execução do workflow de CI)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | Criar `.github/workflows/` + `publish-brain-sdr.yml` | T-18-01 (token leak) | Secrets referenciados via `${{ secrets.X }}`, não hardcoded | Lint | `test -f .github/workflows/publish-brain-sdr.yml && echo "OK"` | ❌ W0 | ⬜ pending |
| 18-01-02 | 01 | 1 | Trigger correto: `on: push: tags: v*.*.*` | — | Workflow dispara apenas em tags semver | Static | `grep -A3 'on:' .github/workflows/publish-brain-sdr.yml \| grep 'v\*\.\*\.\*'` | ❌ W0 | ⬜ pending |
| 18-01-03 | 01 | 1 | Extração de versão sem prefixo "v" | — | VERSION=${GITHUB_REF#refs/tags/v} — bash built-in | Static | `grep 'GITHUB_REF#refs/tags/v' .github/workflows/publish-brain-sdr.yml` | ❌ W0 | ⬜ pending |
| 18-01-04 | 01 | 1 | Build com contexto na raiz do monorepo | — | `docker build -f apps/brain-sdr/Dockerfile .` | Static | `grep 'apps/brain-sdr/Dockerfile' .github/workflows/publish-brain-sdr.yml` | ❌ W0 | ⬜ pending |
| 18-01-05 | 01 | 1 | `docker save` (não `docker export`) | — | Preserva layers para `docker load` | Static | `grep 'docker save' .github/workflows/publish-brain-sdr.yml` | ❌ W0 | ⬜ pending |
| 18-01-06 | 01 | 1 | Upload MinIO sem Authorization header | T-18-02 (auth dupla) | `curl --upload-file` sem `-H "Authorization:"` no step MinIO | Static | `grep -A10 'Upload image to MinIO' .github/workflows/publish-brain-sdr.yml \| grep -v 'Authorization'` | ❌ W0 | ⬜ pending |
| 18-01-07 | 01 | 1 | `size` como integer JSON no PUT /latest | — | `"size":${{ steps.integrity.outputs.SIZE }}` sem aspas | Static | `grep '"size":\${{' .github/workflows/publish-brain-sdr.yml` | ❌ W0 | ⬜ pending |
| 18-01-08 | 01 | 1 | `permissions: contents: read` no job | T-18-03 (menor privilégio) | Job declara permissões mínimas | Static | `grep 'permissions' .github/workflows/publish-brain-sdr.yml` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `.github/workflows/` directory — criar junto com o arquivo do workflow (não existe ainda no repositório)

*Esta fase consiste em criar um único arquivo novo. O Wave 0 cobre apenas a criação do diretório pai.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pipeline completo executa sem erro | D-02 (3-step publish flow) | Requer push de tag real no GitHub e runner CI externo | 1. Push tag `v0.0.1-test`; 2. Verificar GitHub Actions run; 3. Confirmar steps: Build ✓, Export ✓, SHA256 ✓, Upload ✓, Publish ✓ |
| Versão aparece no DockGate como latest | D-02 (PUT /latest) | Requer acesso ao DockGate registry | Após pipeline: verificar `GET $DOCKGATE_URL/apps/brain-sdr/latest` retorna versão publicada |
| Secrets não vazam nos logs | T-18-01 | Verificação visual nos logs do GitHub Actions | Confirmar que `DOCKGATE_UPLOAD_TOKEN` e `DOCKGATE_URL` aparecem como `***` nos logs |

---

## Validation Sign-Off

- [ ] Arquivo `publish-brain-sdr.yml` existe em `.github/workflows/`
- [ ] Todos os checks estáticos da tabela acima passam (grep commands)
- [ ] Pipeline real executado com push de tag de teste
- [ ] Logs do GitHub Actions confirmam todos os steps verdes
- [ ] Versão publicada no DockGate verificada
- [ ] Secrets mascarados nos logs (não aparecem em texto claro)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
