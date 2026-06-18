---
phase: 18
slug: build-and-publish-docker-image-via-dockgate
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-18
audited: 2026-06-18
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
| 18-01-01 | 01 | 1 | Criar `.github/workflows/` + `publish-brain-sdr.yml` | T-18-01 (token leak) | Secrets referenciados via `${{ secrets.X }}`, não hardcoded | Lint | `test -f .github/workflows/publish-brain-sdr.yml && echo "OK"` | ✅ | ✅ green |
| 18-01-02 | 01 | 1 | Trigger correto: `on: push: tags: v*.*.*` | — | Workflow dispara apenas em tags semver | Static | `grep -A3 'on:' .github/workflows/publish-brain-sdr.yml \| grep 'v\*\.\*\.\*'` | ✅ | ✅ green |
| 18-01-03 | 01 | 1 | Extração de versão sem prefixo "v" | — | VERSION=${GITHUB_REF#refs/tags/v} — bash built-in | Static | `grep 'GITHUB_REF#refs/tags/v' .github/workflows/publish-brain-sdr.yml` | ✅ | ✅ green |
| 18-01-04 | 01 | 1 | Build com contexto na raiz do monorepo | — | `docker build -f apps/brain-sdr/Dockerfile .` | Static | `grep 'apps/brain-sdr/Dockerfile' .github/workflows/publish-brain-sdr.yml` | ✅ | ✅ green |
| 18-01-05 | 01 | 1 | `docker save` (não `docker export`) | — | Preserva layers para `docker load` | Static | `grep 'docker save' .github/workflows/publish-brain-sdr.yml` | ✅ | ✅ green |
| 18-01-06 | 01 | 1 | Upload MinIO sem Authorization header | T-18-02 (auth dupla) | `curl --upload-file` sem `-H "Authorization:"` no step MinIO | Static | `test $(grep -A5 "Upload image to MinIO" .github/workflows/publish-brain-sdr.yml \| grep -c "Authorization") -eq 0 && echo OK` | ✅ | ✅ green |
| 18-01-07 | 01 | 1 | `size` como integer JSON no PUT /latest | — | `"size":${{ steps.integrity.outputs.SIZE }}` sem aspas | Static | `grep 'size.*:.*\${{' .github/workflows/publish-brain-sdr.yml` | ✅ | ✅ green |
| 18-01-08 | 01 | 1 | `permissions: contents: read` no job | T-18-03 (menor privilégio) | Job declara permissões mínimas | Static | `grep 'permissions' .github/workflows/publish-brain-sdr.yml` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `.github/workflows/` directory — criado junto com o arquivo do workflow

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

- [x] Arquivo `publish-brain-sdr.yml` existe em `.github/workflows/`
- [x] Todos os checks estáticos da tabela acima passam (grep commands)
- [x] Pipeline real executado com push de tag de teste (run ID 27777439427)
- [x] Logs do GitHub Actions confirmam todos os 9 steps verdes (3m18s)
- [x] Versão 0.0.1 publicada no DockGate verificada (tag v0.0.1)
- [x] Secrets mascarados nos logs (não aparecem em texto claro)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-06-18 — E2E verificado via run 27777439427

---

## Validation Audit 2026-06-18

| Metric | Count |
|--------|-------|
| Gaps encontrados | 2 |
| Resolvidos (correção de grep) | 2 |
| Escalados para manual-only | 0 |

**Gaps resolvidos:**
- 18-01-06: `grep -A10 ... \| grep -v` substituído por `test $(grep -A5 ... \| grep -c) -eq 0` — janela reduzida para não capturar o step seguinte
- 18-01-07: `grep '"size":\${{' ` substituído por `grep 'size.*:.*\${{' ` — padrão que efetivamente corresponde ao conteúdo do arquivo YAML
