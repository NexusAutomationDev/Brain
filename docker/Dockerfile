# syntax=docker/dockerfile:1.7
# Multi-stage build for Brain. Three targets:
#   - builder : compiles the venv with uv + cache mounts
#   - dev     : adds dev deps; uvicorn --reload
#   - prod    : non-root, slim, HEALTHCHECK, uvicorn --workers 1
#
# Base image policy (CLAUDE.md §9): python:3.12-slim-bookworm.
#   NOT musl-based images (break psycopg[binary] + ML wheels)
#   NOT python 3 dot 13 (LangGraph ecosystem wheels still lag)
#   NOT floating tags (CLAUDE.md §10 — pin every image tag)

ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.16

# ─────────── Stage 1: builder ───────────
FROM ${PYTHON_IMAGE} AS builder

# Copy uv from the official image (A6 — pin matches CLI version in pyproject)
COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install deps without copying source — cacheable layer keyed on lockfile + pyproject
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

# Now copy source + install the project itself
COPY pyproject.toml uv.lock alembic.ini /app/
COPY src /app/src
COPY alembic /app/alembic

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ─────────── Stage 2: dev ───────────
FROM builder AS dev

# Add dev deps on top of the frozen venv
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen

# Bring in tests (dev image runs pytest from inside the container)
COPY tests /app/tests
COPY scripts /app/scripts

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "brain.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ─────────── Stage 3: prod ───────────
FROM ${PYTHON_IMAGE} AS prod

# Non-root user (DEPLOY-03)
RUN groupadd --system --gid 1001 brain \
 && useradd  --system --uid 1001 --gid brain --home-dir /app --shell /sbin/nologin brain

# Copy only what prod needs — no uv binary, no dev deps, no tests, no scripts/lint
COPY --from=builder --chown=brain:brain /app/.venv          /app/.venv
COPY --from=builder --chown=brain:brain /app/src            /app/src
COPY --from=builder --chown=brain:brain /app/alembic        /app/alembic
COPY --from=builder --chown=brain:brain /app/alembic.ini    /app/alembic.ini
COPY --from=builder --chown=brain:brain /app/pyproject.toml /app/pyproject.toml

WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH="/app/src"

USER brain
EXPOSE 8000

# HEALTHCHECK uses Python stdlib (slim image has no curl/wget). Liveness only — not /readyz.
# /readyz would 503 if MQ/Qdrant flap; using /healthz means container restart triggers
# only when the process itself is unresponsive.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; \
        sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=2).status==200 else 1)"

# Default CMD launches uvicorn. brain-migrate compose service overrides this:
#   command: ["python", "-m", "brain.db.migrate"]
# A4: --workers 1 (in-process lock registry + persona cache; horizontal scale = more containers)
# D-13: --timeout-graceful-shutdown reads BRAIN_SHUTDOWN__GRACE_SECONDS from env at container start
# (`sh -c` because uvicorn's CLI flag doesn't natively expand env vars in argv)
CMD ["sh", "-c", "uvicorn brain.api.app:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-graceful-shutdown ${BRAIN_SHUTDOWN__GRACE_SECONDS:-30}"]
