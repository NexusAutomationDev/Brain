---
phase: 1
slug: foundations-compose-skeleton
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-21
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Detailed test→requirement map and Wave 0 gaps live in `01-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.0.3 + pytest-asyncio 1.3.0 (+ testcontainers[postgres,rabbitmq] for integration) |
| **Config file** | `pyproject.toml` `[tool.pytest.ini_options]` — created in Wave 0 |
| **Quick run command** | `uv run pytest -x -q` |
| **Full suite command** | `uv run pytest --cov=brain --cov-fail-under=80 -q` |
| **Estimated runtime** | ~30 seconds unit; ~3 minutes integration (testcontainers) |

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest -x -q` (unit tests only)
- **After every plan wave:** Run `uv run pytest --cov=brain --cov-fail-under=80` + `uv run ruff check .` + `gitleaks protect --staged`
- **Before `/gsd-verify-work`:** Full unit + integration suite green AND `bash scripts/smoke-up.sh lite` green (full-stack smoke runs on nightly CI)
- **Max feedback latency:** 30 seconds (unit); 5 minutes (per-wave including integration)

---

## Per-Task Verification Map

Full per-requirement map in `01-RESEARCH.md` §"Validation Architecture" → "Phase Requirements → Test Map". Summary:

| Requirement | Test Type | Automated Command | File Exists |
|-------------|-----------|-------------------|-------------|
| FOUND-01 | smoke | `python --version \| grep 3.12 && uv lock --check` | ❌ W0 |
| FOUND-02 | smoke | `grep -E '^langgraph(-checkpoint(-postgres)?)?\s*=\s*"==' pyproject.toml \| wc -l \| grep 3` | ❌ W0 |
| FOUND-03 | unit | `uv run pytest tests/test_health.py -x` | ❌ W0 |
| FOUND-04 | unit | `uv run pytest tests/test_settings.py::test_no_hardcoded_endpoints -x` | ❌ W0 |
| FOUND-05 | unit | `uv run pytest tests/test_settings.py::test_missing_required_env_raises -x` | ❌ W0 |
| FOUND-06 | lint | `uv run ruff check src/` + grep ban for asyncpg | ❌ W0 |
| FOUND-07 | integration | `uv run pytest tests/integration/test_migrate.py -x` | ❌ W0 |
| FOUND-08 | unit + lint | `uv run pytest tests/test_thread_id.py -x` + pre-commit hook | ❌ W0 |
| FOUND-09 | integration | `uv run pytest tests/integration/test_shutdown.py -x` | ❌ W0 |
| FOUND-10 | lint | `uv run ruff check --select T201,G004 src/` | ❌ W0 |
| FOUND-11 | unit | `uv run pytest tests/test_schema_version.py -x` | ❌ W0 |
| FOUND-12 | smoke + CI | `git check-ignore .env && gitleaks detect --no-git --source .env.example --config .gitleaks.toml` | ❌ W0 |
| AUTH-03 | lint (manual canary in Phase 4) | `grep -rE 'OPENAI_API_KEY\|GEMINI_API_KEY' src/ \| grep -v config/settings.py` returns empty | ❌ W0 |
| AUTH-04 | unit (helper only; full test in Phase 3) | `uv run pytest tests/test_payload_cap.py -x` | ❌ W0 |
| DEPLOY-01 | smoke (nightly CI) | `bash scripts/smoke-up.sh full` | ❌ W0 |
| DEPLOY-02 | smoke (per-PR CI) | `bash scripts/smoke-up.sh lite` | ❌ W0 |
| DEPLOY-03 | smoke | `docker build --target prod -t brain:test .` | ❌ W0 |
| DEPLOY-04 | smoke | `docker compose config \| yq '.services.[] \| select(.healthcheck == null)'` returns empty | ❌ W0 |
| DEPLOY-05 | integration | `bash scripts/smoke-up.sh lite && docker compose exec brain-postgres psql -U brain -c '\dn' \| grep -E 'brain\|langgraph'` | ❌ W0 |
| DEPLOY-06 | smoke (placeholder; wired in Phase 8) | `grep -A1 brain-topology-init docker-compose.yml \| grep -qE 'image\|build'` | ❌ W0 |
| DEPLOY-07 | smoke | `bash scripts/check-env-example.sh` + `git check-ignore .env` | ❌ W0 |
| DEPLOY-08 | manual smoke | `bash scripts/smoke-readme.sh` | ❌ W0 |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · W0 = created by Wave 0*

---

## Wave 0 Requirements

All test infrastructure must be created in Phase 1's Wave 0 — the repo is greenfield (only `CLAUDE.md` and `.planning/` exist).

- [ ] `pyproject.toml` `[tool.pytest.ini_options]` block (`asyncio_mode = "auto"`, `testpaths = ["tests"]`)
- [ ] `tests/conftest.py` — shared fixtures: `settings_factory`, `monkeypatched_env`, `psycopg_pool` (testcontainers), `qdrant_client`
- [ ] `tests/test_settings.py` — Pydantic Settings happy path + missing env + bad type rejection
- [ ] `tests/test_health.py` — `/healthz` 200; `/readyz` returns per-dep status with cache window respected
- [ ] `tests/test_schema_version.py` — supported version passes; unsupported raises `UNSUPPORTED_SCHEMA_VERSION` with 422 envelope shape
- [ ] `tests/test_thread_id.py` — happy path + empty arg + separator-in-arg edge case
- [ ] `tests/test_payload_cap.py` — body > 32KB rejected pre-parse (helper only)
- [ ] `tests/integration/test_migrate.py` — testcontainers Postgres → run migrate entrypoint → assert both schemas + `langgraph.checkpoints` table + `brain.alembic_version` table present
- [ ] `tests/integration/test_shutdown.py` — start app, send SIGTERM during slow request, assert request completes within grace window
- [ ] `scripts/smoke-up.sh` — bash script that runs `docker compose up -d` (lite | full), waits for all healthchecks, hits `/healthz` + `/readyz`, tears down
- [ ] `scripts/check-env-example.sh` — diff env var names referenced in `src/brain/config/` against `.env.example` keys; fail on drift
- [ ] `scripts/smoke-readme.sh` — execute README "copy-paste quickstart" verbatim in a tmp dir
- [ ] `scripts/check-compose-parity.sh` — assert lite override is a strict subset of full compose (services + image pins agree on shared services)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README quickstart copy-paste works on a fresh clone | DEPLOY-08 | Requires a clean machine state and timing observation that's expensive to script reliably | `scripts/smoke-readme.sh` runs the steps but a human confirms the resulting `curl /healthz` returns 200 within 90s on first run |
| Provider API keys never echoed in any log stream | AUTH-03 (Phase 1 portion) | Full canary-token regression test is Phase 4 (Langfuse trace inspection) — Phase 1 can only assert grep-level absence in source | Reviewer greps `src/` for `OPENAI_API_KEY` / `GEMINI_API_KEY` literals outside `config/settings.py` |
| Langfuse subsystem starts coherently without Brain | DEPLOY-01 (Langfuse subset) | Brain doesn't depend on Langfuse (D-11), so Langfuse boot must be verified independently | `docker compose up langfuse-web` and confirm `http://localhost:3000` loads sign-up page |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (unit) / 5min (integration)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
