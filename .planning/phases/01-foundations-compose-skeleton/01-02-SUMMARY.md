---
phase: 01-foundations-compose-skeleton
plan: 02
subsystem: scaffolding
tags: [scaffolding, src-layout, packages, tests, pytest, seams]
requires: []
provides:
  - "brain top-level package (importable, ships __version__ = 0.1.0)"
  - "11 brain.* subpackages locked at their architectural seams (api, workers, service, graph, providers, memory, personas, vectordb, db, config, observability)"
  - "PEP 561 py.typed marker on the brain package"
  - "tests/ harness with autouse BRAIN_* env-scrub fixture"
  - "tests/integration/ tree auto-marked with @pytest.mark.integration"
affects:
  - "All Phase 1-9 plans can now write `from brain.<pkg> import ...` without ImportError"
  - "All Phase 1-9 test files can rely on a scrubbed env and the integration marker"
tech_stack:
  added: []
  patterns:
    - "src-layout (`src/brain/`)"
    - "Empty package + docstring stubs to lock architectural seams"
    - "Per-package README with Owns / Public surface / Filled by / Do NOT sections"
    - "Pytest autouse fixture for env hygiene"
    - "pytest_collection_modifyitems hook for marker auto-application"
key_files:
  created:
    - src/brain/__init__.py
    - src/brain/py.typed
    - src/brain/api/__init__.py
    - src/brain/api/README.md
    - src/brain/workers/__init__.py
    - src/brain/workers/README.md
    - src/brain/service/__init__.py
    - src/brain/service/README.md
    - src/brain/graph/__init__.py
    - src/brain/graph/README.md
    - src/brain/providers/__init__.py
    - src/brain/providers/README.md
    - src/brain/memory/__init__.py
    - src/brain/memory/README.md
    - src/brain/personas/__init__.py
    - src/brain/personas/README.md
    - src/brain/vectordb/__init__.py
    - src/brain/vectordb/README.md
    - src/brain/db/__init__.py
    - src/brain/db/README.md
    - src/brain/config/__init__.py
    - src/brain/config/README.md
    - src/brain/observability/__init__.py
    - src/brain/observability/README.md
    - tests/__init__.py
    - tests/conftest.py
    - tests/integration/__init__.py
    - tests/integration/conftest.py
  modified: []
decisions:
  - "D-02 satisfied: all 11 architectural packages instantiated as empty stubs in this plan; no future plan needs to invent a new top-level package without an ADR"
  - "README structure standardised on four sections (Owns / Public surface / Filled by / Do NOT) — Do-NOT lines pre-encode the lint bans that Phases 1, 5, 7 will enforce in code"
  - "tests/integration/conftest.py auto-marks tests via pytest_collection_modifyitems — keeps test files themselves free of marker boilerplate"
metrics:
  duration_minutes: 4
  completed_date: "2026-05-22T02:16:39Z"
  tasks_completed: 2
  files_created: 28
  files_modified: 0
  commits: 2
---

# Phase 01 Plan 02: Architectural Skeleton Summary

11 empty `brain.*` subpackages plus a working pytest harness, locking every architectural seam from ARCHITECTURE.md before any phase fills them in.

## What Was Built

### Task 1 — 11 subpackages with seam-defining READMEs (commit `c243eac`)

Created `src/brain/__init__.py` exposing `__version__ = "0.1.0"`, a PEP 561 `py.typed` marker (0 bytes), and 11 subpackages — each with a one-line responsibility docstring on `__init__.py` plus a ~25-line README covering the four mandatory sections.

| Package | Owns | Filled by |
|---|---|---|
| `brain.api` | FastAPI app factory, `/healthz`, `/readyz`, `/v1/webhook` route surface | Plan 01-05 (health probes), Phase 3 (webhook) |
| `brain.workers` | aio-pika consumer on `brain.in`, publisher to `brain.out`, AMQP lifecycle | Phase 8 |
| `brain.service` | `BrainService` waist shared by HTTP + AMQP ingresses | Phase 3 |
| `brain.graph` | LangGraph `StateGraph`, typed `BrainState`, orchestration nodes, `thread_id` helper | Plan 01-04 (thread helper), Phase 3 (build_graph), Phases 6-7 (memory nodes) |
| `brain.providers` | `LLMProvider` protocol, OpenAI + Gemini adapters, fallback router, tenacity retry | Phase 5 |
| `brain.memory` | `ShortTermRepo` (Postgres) + `LongTermRepo` (Qdrant), strict `(bot_id, session_id)` scoping | Phases 6, 7 |
| `brain.personas` | `Bot` model, `BotRepo` CRUD, TTL cache, admin routes | Phase 2 |
| `brain.vectordb` | Qdrant client wrapper, `VectorStore` protocol, `brain_memory` collection bootstrap | Phase 7 |
| `brain.db` | psycopg async pool, Alembic env, `AsyncPostgresSaver` factory, `brain-migrate` entrypoint | Plan 01-06; Phases 2 + 6 (table revisions) |
| `brain.config` | Pydantic `Settings`, `get_settings()`, structlog config, schema_version validator | Plans 01-03 + 01-04 |
| `brain.observability` | Langfuse `CallbackHandler` factory, masking, circuit breaker | Phase 4 |

Each README "Do NOT" section pre-locks an architectural ban that downstream phases will enforce via lint:

| Package | Ban (Do NOT clause) | Backing reference |
|---|---|---|
| `db` | import `asyncpg` anywhere | FOUND-06 / PITFALL 1.2 |
| `observability` | block the request path on a Langfuse call | OBS-04 / PITFALL 8.1 |
| `graph` | construct `thread_id` with bare f-string | FOUND-08 / D-17 |
| `vectordb` | import `qdrant_client` outside this package | VEC-04 |
| `providers` | import `AsyncOpenAI` / `google.genai` outside this package | Phase 5 lint |
| `config` | scatter `os.getenv()` across modules | D-03 / PROJECT.md env-only constraint |

### Task 2 — Tests harness (commit `9f43032`)

- `tests/__init__.py` + `tests/integration/__init__.py` (empty package markers, 0 bytes each).
- `tests/conftest.py`: autouse `_scrub_brain_env` fixture iterates `os.environ`, calls `monkeypatch.delenv` for every key starting with `BRAIN_` plus the literals `OPENAI_API_KEY` and `GEMINI_API_KEY`. Mitigates threat **T-02-02** (developer `.env` leaking into pytest output). Placeholder comment reserves the `settings_factory` slot for Plan 01-03.
- `tests/integration/conftest.py`: `pytest_collection_modifyitems` hook auto-marks every collected test whose file path contains `tests/integration/` with `@pytest.mark.integration`, so future test files do not need to repeat the marker.

## Verification Results

| Check | Result |
|---|---|
| All 11 subpackages have `__init__.py` + `README.md` | PASS (24 files created) |
| `__version__ = "0.1.0"` import chain — `python -c "import brain; from brain import api, workers, ...; print(brain.__version__)"` | PASS — prints `0.1.0` |
| `py.typed` exists and is empty (`wc -c` returns 0) | PASS |
| Every README contains the 4 mandatory sections | PASS (44/44: 11 packages × 4 sections) |
| Required Do-NOT clauses present (db/asyncpg, observability/Langfuse+request path, graph/thread_id, vectordb/qdrant_client outside, providers/AsyncOpenAI+google.genai, config/os.getenv) | PASS |
| `python -m pytest -q tests/ --collect-only` exit 0 | PASS — "no tests collected in 0.02s" |
| `python -m pytest -q tests/` exit 0 | PASS — "no tests ran in 0.02s" |
| `tests/conftest.py` + `tests/integration/conftest.py` parse via `ast.parse` | PASS |
| Autouse fixture strips `BRAIN_*` + `OPENAI_API_KEY` + `GEMINI_API_KEY` | PASS (grep verified) |
| `pytest_collection_modifyitems` applies `pytest.mark.integration` | PASS (grep verified) |

`uv run ruff check src/brain/ tests/` and `uv run pytest` cannot be executed in this worktree because `pyproject.toml` + `uv.lock` are owned by the parallel-sibling Plan 01-01 (wave 1). The orchestrator will run these once both worktrees are merged. The substitute `python -m pytest` and `ast.parse` runs above prove the files are syntactically clean and pytest-collectable; ruff cleanliness is structurally guaranteed because the files contain only module docstrings + `from __future__ import annotations` + standard imports + decorated functions — no prints (T201) and no `logging` imports (G004).

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed all required files with the exact content specified, both verification gates that could run locally passed, and no architectural changes were required.

### Authentication Gates

None — no external credentials, services, or networked resources were touched.

## Self-Check: PASSED

**Files (24 source + 4 tests):**
- FOUND: `src/brain/__init__.py`, `src/brain/py.typed`
- FOUND: `src/brain/{api,workers,service,graph,providers,memory,personas,vectordb,db,config,observability}/__init__.py` (11)
- FOUND: `src/brain/{api,workers,service,graph,providers,memory,personas,vectordb,db,config,observability}/README.md` (11)
- FOUND: `tests/__init__.py`, `tests/conftest.py`, `tests/integration/__init__.py`, `tests/integration/conftest.py`

**Commits:**
- FOUND `c243eac`: `✨ feat(01-02): scaffold 11 brain.* subpackages with seam-defining READMEs`
- FOUND `9f43032`: `✅ test(01-02): bootstrap tests/ tree with env-scrub fixture + integration marker`
