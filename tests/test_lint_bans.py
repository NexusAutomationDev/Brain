"""Tests for the four pre-commit grep ban scripts (FOUND-06, FOUND-08, FOUND-10).

Each ban-*.sh script is invoked via `subprocess` against tmp files containing
either a forbidden or a clean pattern. The hooks take staged file paths as
positional arguments (pre-commit `pass_filenames: true`) and exit non-zero on
violation.

The scripts decide whether to inspect a file based on its *path* (so they can
allowlist e.g. `alembic/env.py` or `scripts/`). Each test below crafts the
file path under `tmp_path` so the path-based filter triggers correctly.
"""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
LINT_DIR = REPO_ROOT / "scripts" / "lint"


def _run(script: str, file_paths: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    """Invoke a ban script. `file_paths` are relative to `cwd` so that the
    case-pattern allowlists in the scripts (e.g. `src/brain/*.py`) match."""
    return subprocess.run(
        [str(LINT_DIR / script), *file_paths],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.fixture
def fake_repo(tmp_path: Path) -> Path:
    """Build a fake repo root inside `tmp_path` so relative paths like
    `src/brain/foo.py` and `alembic/env.py` resolve correctly."""
    return tmp_path


# ---------- ban-asyncpg.sh ----------


def test_ban_asyncpg_rejects(fake_repo: Path) -> None:
    target_rel = "src/brain/db/bad.py"
    _write(fake_repo / target_rel, "import asyncpg\n")
    result = _run("ban-asyncpg.sh", [target_rel], cwd=fake_repo)
    assert result.returncode != 0, result.stdout + result.stderr
    assert "asyncpg" in (result.stdout + result.stderr).lower()


def test_ban_asyncpg_accepts_clean(fake_repo: Path) -> None:
    target_rel = "src/brain/db/good.py"
    _write(fake_repo / target_rel, "import psycopg\n")
    result = _run("ban-asyncpg.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


def test_ban_asyncpg_ignores_files_outside_src_brain(fake_repo: Path) -> None:
    """The ban only applies to `src/brain/**.py` — other paths are not checked."""
    target_rel = "scripts/foo.py"
    _write(fake_repo / target_rel, "import asyncpg\n")
    result = _run("ban-asyncpg.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------- ban-sync-postgressaver.sh ----------


def test_ban_sync_postgressaver_rejects(fake_repo: Path) -> None:
    target_rel = "src/brain/db/bad.py"
    _write(
        fake_repo / target_rel,
        "from langgraph.checkpoint.postgres import PostgresSaver\n",
    )
    result = _run("ban-sync-postgressaver.sh", [target_rel], cwd=fake_repo)
    assert result.returncode != 0, result.stdout + result.stderr


def test_ban_sync_postgressaver_allows_scripts(fake_repo: Path) -> None:
    target_rel = "scripts/migrate_oneoff.py"
    _write(
        fake_repo / target_rel,
        "from langgraph.checkpoint.postgres import PostgresSaver\n",
    )
    result = _run("ban-sync-postgressaver.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


def test_ban_sync_postgressaver_accepts_async_variant(fake_repo: Path) -> None:
    target_rel = "src/brain/db/good.py"
    _write(
        fake_repo / target_rel,
        "from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver\n",
    )
    result = _run("ban-sync-postgressaver.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------- ban-raw-thread-id.sh ----------


def test_ban_raw_thread_id_rejects(fake_repo: Path) -> None:
    target_rel = "src/brain/graph/build.py"
    _write(
        fake_repo / target_rel,
        'bot = "a"\nsession = "b"\nt = f"{bot}:{session}"\n',
    )
    result = _run("ban-raw-thread-id.sh", [target_rel], cwd=fake_repo)
    assert result.returncode != 0, result.stdout + result.stderr
    msg = (result.stdout + result.stderr).lower()
    assert "thread" in msg


def test_ban_raw_thread_id_allows_helper(fake_repo: Path) -> None:
    """The helper file itself MUST be allowlisted — it owns the canonical
    f-string pattern."""
    target_rel = "src/brain/graph/thread.py"
    _write(
        fake_repo / target_rel,
        'def thread_id(bot, session): return f"{bot}:{session}"\n',
    )
    result = _run("ban-raw-thread-id.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


def test_ban_raw_thread_id_accepts_clean(fake_repo: Path) -> None:
    target_rel = "src/brain/graph/build.py"
    _write(
        fake_repo / target_rel,
        "from brain.graph.thread import thread_id\nt = thread_id(bot, session)\n",
    )
    result = _run("ban-raw-thread-id.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------- ban-stdlib-logging.sh ----------


def test_ban_stdlib_logging_rejects(fake_repo: Path) -> None:
    target_rel = "src/brain/service/bad.py"
    _write(fake_repo / target_rel, "import logging\nlog = logging.getLogger()\n")
    result = _run("ban-stdlib-logging.sh", [target_rel], cwd=fake_repo)
    assert result.returncode != 0, result.stdout + result.stderr


def test_ban_stdlib_logging_rejects_from_import(fake_repo: Path) -> None:
    target_rel = "src/brain/service/bad2.py"
    _write(fake_repo / target_rel, "from logging import getLogger\n")
    result = _run("ban-stdlib-logging.sh", [target_rel], cwd=fake_repo)
    assert result.returncode != 0, result.stdout + result.stderr


def test_ban_stdlib_logging_allows_alembic(fake_repo: Path) -> None:
    target_rel = "alembic/env.py"
    _write(fake_repo / target_rel, "import logging\n")
    result = _run("ban-stdlib-logging.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


def test_ban_stdlib_logging_allows_observability_bridge(fake_repo: Path) -> None:
    target_rel = "src/brain/observability/logging.py"
    _write(fake_repo / target_rel, "import logging\nimport logging.config\n")
    result = _run("ban-stdlib-logging.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


def test_ban_stdlib_logging_accepts_clean(fake_repo: Path) -> None:
    target_rel = "src/brain/service/good.py"
    _write(
        fake_repo / target_rel,
        "from brain.observability import get_logger\nlog = get_logger(__name__)\n",
    )
    result = _run("ban-stdlib-logging.sh", [target_rel], cwd=fake_repo)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------- scripts must be executable ----------


@pytest.mark.parametrize(
    "script",
    [
        "ban-asyncpg.sh",
        "ban-sync-postgressaver.sh",
        "ban-raw-thread-id.sh",
        "ban-stdlib-logging.sh",
    ],
)
def test_ban_script_is_executable(script: str) -> None:
    script_path = LINT_DIR / script
    assert script_path.exists(), f"{script_path} missing"
    mode = script_path.stat().st_mode
    assert mode & stat.S_IXUSR, f"{script_path} not user-executable (mode={oct(mode)})"
    # Sanity: shebang present
    head = script_path.read_text(encoding="utf-8").splitlines()[0]
    assert head.startswith("#!"), f"{script_path} missing shebang: {head!r}"


# Belt-and-braces: ensure tests aren't accidentally exec'd from outside REPO_ROOT.
def test_lint_dir_exists() -> None:
    assert LINT_DIR.is_dir(), f"missing {LINT_DIR}"
