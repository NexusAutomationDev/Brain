---
phase: 30-brain-suporte-docker
verified: 2026-07-01T22:16:31Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "apps/brain-support/docker-compose.yml provides: Local dev/test convenience: Postgres (pgvector) + brain-support service together (contains 'pgvector/pgvector')"
    reason: "Plan 30-02 originally designed docker-compose.yml to bundle a disposable pgvector/pgvector Postgres service for local dev/test convenience. After Wave 1 completed, the user explicitly flagged that this diverged from the established production deployment model (documented in CLAUDE.md: '1 banco por cliente' — each client runs their own external Postgres, shared across Brain instances, connected via host.docker.internal + traefikNet). The file was intentionally rewritten (commit 3abf253) to mirror apps/brain-sdr/docker-compose.yml's production pattern exactly: no bundled Postgres, extra_hosts host-gateway, traefikNet external network. This is a deliberate, user-directed architectural correction documented in 30-02-SUMMARY.md's 'Orchestrator Correction (post-Wave-1)' section, not a stub or incomplete implementation. All roadmap Success Criteria (build succeeds, container migrates + /health ok, webhook round-trip works) remain independently verified true against the corrected file."
    accepted_by: "biellil (via orchestrator correction, documented in 30-02-SUMMARY.md)"
    accepted_at: "2026-07-01T21:50:51Z"
---

# Phase 30: Brain Suporte Docker Verification Report

**Phase Goal:** `apps/brain-support` tem imagem Docker independente que sobe, migra e atende mensagens — pronto para entrega a clientes
**Verified:** 2026-07-01T22:16:31Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `docker build -f apps/brain-support/Dockerfile .` completes without error — multi-stage functional image | ✓ VERIFIED | Independently re-ran `docker build -f apps/brain-support/Dockerfile . -t brain-support-verify` from repo root; completed successfully, image `sha256:e9f0818ac734...`, 441MB, matches SUMMARY's independently-claimed build |
| 2 | Container runs `runMigrations()` with advisory lock and exposes `GET /health` with status `ok` | ✓ VERIFIED | Booted container against a fresh, isolated `pgvector/pgvector:pg14` container; logs show `[migrate] Row-lock adquirido` → `[migrate] Migrations concluídas com sucesso` → `BrainRunner initialized`; `curl /health` returned `{"status":"ok","checks":{"db":"connected","transport":"connected"},...}` |
| 3 | Container processes a test webhook message and returns valid `BrainOutput` without depending on brain-sdr files | ✓ VERIFIED | `POST /api/v1/webhook` with real `IDLead`/`Numero`/`Name`/`Message` payload and real OpenAI credentials returned HTTP 200 with `{"status":"ok","fullResponse":"...","responseMode":"undefined","tokenUsage":{...}}` — `fullResponse` present and non-empty; `grep -ic "brain-sdr" apps/brain-support/Dockerfile` = 0 |
| 4 | `.dockerignore` exists at repo root and excludes secrets/git/node_modules for all Brain build contexts | ✓ VERIFIED | `/root/Brain/.dockerignore` exists; contains `node_modules`, `.env.*`+`!.env.example`, `.git`, `dist`/`.turbo` exclusions |
| 5 | `apps/brain-sdr/Dockerfile` embeddings gap fixed (retroactive, D-03) | ✓ VERIFIED | `packages/embeddings` build step present before `core`; runner COPY blocks for dist/package.json/node_modules present; zero brain-support/brain-echo references |
| 6 | CI/CD publish workflow exists and mirrors `publish-brain-sdr.yml` | ✓ VERIFIED | `.github/workflows/publish-brain-support.yml` exists; `diff` against `publish-brain-sdr.yml` (name fields filtered) shows only comment-line differences, zero structural differences; `file: apps/brain-support/Dockerfile`, `APP_NAME`/`IMAGE_NAME: brain-support`, cache `scope=brain-support` all present |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.dockerignore` | Root build-context exclusions for all Brains | ✓ VERIFIED | Exists, contains all required exclusion patterns |
| `apps/brain-sdr/Dockerfile` | Fixed to build+copy `packages/embeddings` | ✓ VERIFIED | Embeddings build step + 3 COPY lines present, correct order (before core) |
| `apps/brain-support/Dockerfile` | Independent multi-stage build, includes embeddings from the start | ✓ VERIFIED | Builds successfully (re-verified live); non-root `USER bun` confirmed via `docker inspect`; zero brain-sdr/brain-echo references |
| `apps/brain-support/docker-compose.yml` | Local dev/test convenience stack | ⚠️ OVERRIDDEN | Original plan specified a bundled `pgvector/pgvector` Postgres service; superseded post-Wave-1 by a deliberate correction to mirror brain-sdr's production pattern (external host Postgres via `host.docker.internal`+`traefikNet`, no bundled DB) — see override above. `docker compose config` validates without error |
| `.github/workflows/publish-brain-support.yml` | CI/CD publish pipeline mirroring `publish-brain-sdr.yml` | ✓ VERIFIED | Structurally identical (diff-confirmed); correct `file:`, `APP_NAME`, cache scope |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `apps/brain-sdr/Dockerfile` builder stage | `packages/embeddings/dist` | `RUN pnpm --filter @brain-pkg/embeddings build` + `COPY --from=builder` | ✓ WIRED | Confirmed present, ordered before `core` build |
| `apps/brain-support/Dockerfile` builder stage | `packages/embeddings/dist`, `packages/core/dist` | `RUN pnpm --filter @brain-pkg/embeddings build` before `core` | ✓ WIRED | Confirmed in file and via successful build |
| `apps/brain-support/Dockerfile` runner stage | `packages/database/src/migrations` | `COPY --from=builder ... ./migrations` + `ENV MIGRATIONS_FOLDER=/app/migrations` | ✓ WIRED | Confirmed via live run: migrations applied successfully inside container |
| `.github/workflows/publish-brain-support.yml` | `apps/brain-support/Dockerfile` | `docker/build-push-action` with `file: apps/brain-support/Dockerfile` | ✓ WIRED | Confirmed via grep + diff against brain-sdr's equivalent workflow |
| `.github/workflows/publish-brain-support.yml` | DockGate MinIO upload | `secrets.DOCKGATE_URL` + `secrets.DOCKGATE_UPLOAD_TOKEN` (reused) | ✓ WIRED | Confirmed reused as-is, no new secrets created |

### Data-Flow Trace (Level 4)

Not applicable in the traditional sense (this phase produces infrastructure artifacts — Dockerfiles, compose files, CI workflows — not UI components rendering dynamic data). The equivalent check performed here is the live behavioral round-trip below, which traces real data through the full stack: HTTP request → BrainRunner → LangGraph → LLM → structured `BrainOutput` response.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Docker image builds | `docker build -f apps/brain-support/Dockerfile . -t brain-support-verify` | Exit success, image `441MB`, `sha256:e9f0818ac734...` | ✓ PASS |
| Non-root user | `docker inspect brain-support-verify --format '{{.Config.User}}'` | `bun` | ✓ PASS |
| Migrations run with advisory lock | Container logs against fresh isolated Postgres | `[migrate] Row-lock adquirido` → `Migrations concluídas com sucesso` | ✓ PASS |
| `GET /health` returns ok | `curl -sf http://localhost:13002/health` | `{"status":"ok","checks":{"db":"connected","transport":"connected"},...}` | ✓ PASS |
| `POST /api/v1/webhook` returns valid `BrainOutput` | `curl -X POST .../api/v1/webhook` with real `IDLead`/`Numero`/`Name`/`Message` and real LLM credentials | HTTP 200, `{"status":"ok","fullResponse":"Para verificar o status do seu pedido...","responseMode":"undefined","tokenUsage":{...}}` | ✓ PASS (note: `responseMode` value is literal string `"undefined"` rather than a concrete mode — see anti-pattern note below; the key is present and structurally the response matches `BrainOutput`) |
| Teardown leaves zero trace | `docker ps -a`, `docker network ls`, `docker ps --filter name=db_postgres` | No `brain-verify-*` residue; `db_postgres` container ID unchanged (`d510a9ef2a50`), `Up 2 days` throughout | ✓ PASS |

All spot-checks executed live against the real Docker daemon in this environment, independently of the SUMMARY's own reported validation — results corroborate the SUMMARY's claims.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SUP-06 | 30-01, 30-02, 30-03 | `Dockerfile` multi-stage independente e funcional para `apps/brain-support` | ✓ SATISFIED | All three roadmap Success Criteria independently verified true (build succeeds, migrate+health ok, webhook round-trip valid). **Documentation gap:** `.planning/REQUIREMENTS.md` still shows SUP-06 as `[ ]` unchecked and "Pending" in its traceability table, and `.planning/STATE.md`'s "Current Position"/"v1.5 Phases" sections still say "Phase 29 (not started)" and "SUP-06 Pending" — both stale relative to ROADMAP.md, which correctly shows Phase 30 complete (2026-07-01). This is a bookkeeping/documentation sync gap, not a functional gap; the underlying deliverable is proven to work. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.github/workflows/publish-brain-support.yml` | 63 | Unquoted `$RESPONSE` in `jq` pipe | ℹ️ Info | Inherited unchanged from `publish-brain-sdr.yml`; not a regression introduced by this phase (already flagged in 30-REVIEW.md IN-01) |
| `.github/workflows/publish-brain-support.yml` | 63-69 | No validation that `jq -r .url` returned non-null before upload | ℹ️ Info | Inherited unchanged from `publish-brain-sdr.yml` (already flagged in 30-REVIEW.md IN-02) |
| `apps/brain-sdr/docker-compose.yml` | 6 | Hardcoded host port `3002` colliding with `brain-support`'s own default `3002` if both compose stacks run with defaults on the same host | ⚠️ Warning | Pre-existing brain-sdr file, out of this phase's file scope (flagged in 30-REVIEW.md WR-01); does not block SUP-06 but is a latent operational risk worth a follow-up ticket |
| Live webhook response | — | `responseMode` field returned literal string `"undefined"` instead of a concrete mode value in the spot-check run | ℹ️ Info | Not a Docker/infra defect — likely reflects application-layer behavior for a lead with no prior session/qualification state; the field is present and the response is structurally valid `BrainOutput`. Outside SUP-06's Docker-packaging scope; worth a separate ticket against brain-support's runtime logic if this recurs for real leads. |

None of the anti-patterns found are blockers to Phase 30's goal — they are either pre-existing, out-of-scope, or informational.

### Human Verification Required

None. All must-haves were verified programmatically, including live, real end-to-end execution against the actual Docker daemon (build, ephemeral isolated Postgres, migrate, `/health`, real webhook round-trip with real LLM credentials, and clean teardown with zero trace on host production infrastructure).

### Gaps Summary

No blocking gaps. One must-have (`docker-compose.yml` containing `pgvector/pgvector`) technically fails a literal string match against the original plan's frontmatter, but this reflects an intentional, user-directed architectural correction (documented in `30-02-SUMMARY.md`) that aligns `brain-support`'s deployment pattern with the project's actual production model (`CLAUDE.md`: "1 banco por cliente", external Postgres shared across Brain instances) and with the existing `brain-sdr/docker-compose.yml` precedent. This is recorded as an accepted override rather than a gap.

A non-blocking documentation sync issue was found: `REQUIREMENTS.md` and `STATE.md` still show SUP-06/Phase 29-30 as pending/not-started, while `ROADMAP.md` correctly reflects Phase 30 as complete. Recommend the orchestrator update `REQUIREMENTS.md`'s checkbox/table and `STATE.md`'s "Current Position" section to reflect Phase 30's actual completion, consistent with how `SUP-01`–`SUP-05`/`07`/`08` were marked `Complete` after Phase 29.

---

*Verified: 2026-07-01T22:16:31Z*
*Verifier: Claude (gsd-verifier)*
