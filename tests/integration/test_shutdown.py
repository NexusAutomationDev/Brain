"""Integration test for lifespan + SIGTERM graceful shutdown (FOUND-09 / D-13).

Scope — realistic for Phase 1:
  - Boot a real uvicorn subprocess running `python -m brain.api.main`.
  - Wait for `/healthz` to respond 200 (lifespan opened the deps successfully).
  - Send SIGTERM and assert:
      * the process exits with rc=0 within `grace_seconds + 5` seconds
        (NOT killed by SIGKILL — that would be rc=-9),
      * captured stdout contains a structured `"shutdown_complete"` log line.

What this test does NOT do:
  - Prove that an in-flight long request fully drains across SIGTERM. A real
    long endpoint does not exist until Phase 3; plan 01-09's smoke-up.sh covers
    the container-level drain via `docker compose down`.

Skip conditions:
  - Docker daemon unavailable (testcontainers can't boot Postgres).
  - The `testcontainers` extras for Postgres are not installed.

NOTE: this test requires a working `BRAIN_*` env (Postgres DSN from the
testcontainer, plus stubbed rabbit/qdrant URLs). The lifespan opens
`aio_pika.connect_robust` and `AsyncQdrantClient` lazily / robustly enough that
unreachable broker / qdrant URLs do not raise at startup; only `/readyz`
(NOT called in this test, only `/healthz`) would surface the dep failures.
"""
from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path


pytestmark = pytest.mark.integration


def _docker_available() -> bool:
    """Cheap probe: does `docker info` succeed?"""
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=5,
            check=False,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(port: int, timeout: float) -> bool:
    """Poll http://127.0.0.1:{port}/healthz until 200 or timeout."""
    deadline = time.monotonic() + timeout
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(  # noqa: S310 — localhost only
                f"http://127.0.0.1:{port}/healthz",
                timeout=1.0,
            ) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last_err = e
        time.sleep(0.2)
    if last_err is not None:
        print(f"[test_shutdown] last /healthz error: {last_err!r}", file=sys.stderr)
    return False


@pytest.fixture(scope="module")
def project_root() -> Path:
    from pathlib import Path

    return Path(__file__).resolve().parents[2]


@pytest.fixture
def brain_subprocess(
    project_root: Path,
    postgres_container,  # noqa: ANN001 — pytest fixture injected by conftest
) -> Iterator[tuple[subprocess.Popen[bytes], int]]:
    """Launch `python -m brain.api.main` against a real testcontainer Postgres."""
    port = _free_port()

    dsn = postgres_container.get_connection_url()
    # testcontainers returns `postgresql+psycopg2://...`; strip the driver
    # qualifier so psycopg v3 picks it up natively.
    dsn = dsn.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgresql+psycopg://", "postgresql://"
    )

    env = os.environ.copy()
    env.update(
        {
            "BRAIN_AUTH__TOKEN": "test-token-test-token-test-token",
            "BRAIN_POSTGRES__DSN": dsn,
            # Unreachable URLs are fine — /healthz is dep-free and we never
            # call /readyz in this test. aio_pika.connect_robust is robust to
            # broker-not-yet-up at startup; AsyncQdrantClient is lazy.
            "BRAIN_RABBITMQ__URL": "amqp://test:test@127.0.0.1:1/",
            "BRAIN_QDRANT__URL": "http://127.0.0.1:1",
            "BRAIN_LOG_FORMAT": "json",
            "BRAIN_LOG_LEVEL": "INFO",
            "BRAIN_SHUTDOWN__GRACE_SECONDS": "5",
            # uvicorn bind override via env: we monkey-patch by spawning a
            # tiny wrapper instead — see UVICORN_PORT below.
            "UVICORN_PORT": str(port),
            "PYTHONUNBUFFERED": "1",
        }
    )

    # We can't easily change the host/port baked into brain.api.main without
    # editing it, so spawn uvicorn directly with the same flags main() uses.
    # This still exercises the lifespan + RequestIDMiddleware + health router.
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "brain.api.app:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--workers",
        "1",
        "--timeout-graceful-shutdown",
        env["BRAIN_SHUTDOWN__GRACE_SECONDS"],
    ]
    proc = subprocess.Popen(  # noqa: S603 — fixed argv from this test
        cmd,
        cwd=str(project_root),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        yield proc, port
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


@pytest.mark.skipif(not _docker_available(), reason="docker daemon unavailable")
def test_sigterm_drains_and_exits_cleanly(
    brain_subprocess: tuple[subprocess.Popen[bytes], int],
) -> None:
    """Process boots, /healthz green, SIGTERM → rc=0 within grace_seconds + 5.

    Captured stdout includes a structlog `shutdown_complete` line, proving the
    lifespan finally-block executed.
    """
    proc, port = brain_subprocess

    # 1. Wait for the app to be ready (lifespan opened deps successfully).
    assert _wait_for_health(port, timeout=30), "uvicorn did not become healthy"

    # 2. SIGTERM.
    grace = 5  # matches BRAIN_SHUTDOWN__GRACE_SECONDS in fixture env
    proc.send_signal(signal.SIGTERM)
    try:
        rc = proc.wait(timeout=grace + 5)
    except subprocess.TimeoutExpired:
        proc.kill()
        pytest.fail("uvicorn did not exit within grace_seconds + 5")

    # rc=0 = clean exit. rc=-SIGKILL (-9) would mean uvicorn ignored SIGTERM.
    assert rc == 0, f"clean shutdown expected, got rc={rc}"

    # 3. Captured stdout must contain a structured `shutdown_complete` line.
    assert proc.stdout is not None
    stdout_bytes = proc.stdout.read() or b""
    stdout = stdout_bytes.decode("utf-8", errors="replace")
    print(f"[test_shutdown] captured stdout:\n{stdout}")  # surfaces in pytest -s

    found_shutdown = False
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "shutdown_complete":
            found_shutdown = True
            break

    assert found_shutdown, "structlog 'shutdown_complete' line not found in stdout"
