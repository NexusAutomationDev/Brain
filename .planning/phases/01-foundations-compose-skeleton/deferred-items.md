# Phase 01 — Deferred Items

Items discovered during plan execution that are out-of-scope for the current plan but worth tracking.

## From plan 01-04 (Wave 2a executor)

### 1. Pre-existing ruff E501 in `src/brain/db/__init__.py`

- **Path:** `src/brain/db/__init__.py:1`
- **Issue:** Module docstring is 102 chars; `tool.ruff.line-length = 100`.
- **Cause:** Pre-existing from plan 01-02 (architectural skeleton). Not introduced by 01-04.
- **Severity:** Low — does not affect runtime; only blocks a tree-wide `uv run ruff check src/brain/`.
- **Suggested fix:** Wrap the docstring to two lines, or shorten to fit 100 chars. One-line patch:
  ```python
  """Postgres: psycopg async pool, Alembic, AsyncPostgresSaver factory,
  migrate entrypoint (Phase 1)."""
  ```
- **Owner / Phase:** Pick up in plan 01-06 (database stack lands there) or fold into a `chore(01): ruff cleanup` follow-up before phase verification.

## From plan 01-04 (Wave 2a executor) — non-issues

- Ruff check on the plan's own files (`src/brain/observability/`, `src/brain/api/`, `src/brain/graph/`, the four new test files) passes cleanly.
