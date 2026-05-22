"""Tests for brain.config.settings (Plan 01-03).

Verifies:
  * happy path: every required env var present → typed Settings object.
  * fail-fast: missing required vars raise ValidationError (FOUND-05).
  * typo guard: unknown BRAIN_* vars raise via extra='forbid' (PITFALL 6 / T-03-04).
  * nested delimiter: BRAIN_POSTGRES__POOL_MIN parses to settings.postgres.pool_min.
  * comma-separated parsing: supported_schema_versions list.
  * AUTH-03: provider keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`) only referenced
    in src/brain/config/settings.py — nowhere else under src/brain/.
  * No hardcoded endpoints / ports outside comments/docstrings.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_BRAIN = REPO_ROOT / "src" / "brain"
SETTINGS_PY = SRC_BRAIN / "config" / "settings.py"


def _minimal_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BRAIN_AUTH__TOKEN", "test-token-test-token-test-token")
    monkeypatch.setenv(
        "BRAIN_POSTGRES__DSN",
        "postgresql://test:test@localhost:5432/test",
    )
    monkeypatch.setenv("BRAIN_RABBITMQ__URL", "amqp://test:test@localhost:5672/")
    monkeypatch.setenv("BRAIN_QDRANT__URL", "http://localhost:6333")


def test_loads_with_all_env_set(monkeypatch: pytest.MonkeyPatch) -> None:
    _minimal_env(monkeypatch)
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    s = get_settings()
    assert s.auth.token == "test-token-test-token-test-token"
    assert s.postgres.dsn == "postgresql://test:test@localhost:5432/test"
    assert s.rabbitmq.url == "amqp://test:test@localhost:5672/"
    assert s.qdrant.url == "http://localhost:6333"


def test_missing_auth_token_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "BRAIN_POSTGRES__DSN", "postgresql://test:test@localhost:5432/test"
    )
    monkeypatch.setenv("BRAIN_RABBITMQ__URL", "amqp://test:test@localhost:5672/")
    monkeypatch.setenv("BRAIN_QDRANT__URL", "http://localhost:6333")
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    with pytest.raises(ValidationError) as exc_info:
        get_settings()
    assert "auth" in str(exc_info.value).lower() or "token" in str(exc_info.value).lower()


def test_missing_postgres_dsn_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BRAIN_AUTH__TOKEN", "test-token-test-token-test-token")
    monkeypatch.setenv("BRAIN_RABBITMQ__URL", "amqp://test:test@localhost:5672/")
    monkeypatch.setenv("BRAIN_QDRANT__URL", "http://localhost:6333")
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    with pytest.raises(ValidationError) as exc_info:
        get_settings()
    assert "postgres" in str(exc_info.value).lower() or "dsn" in str(exc_info.value).lower()


def test_unknown_var_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _minimal_env(monkeypatch)
    monkeypatch.setenv("BRAIN_NONSENSE", "foo")
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    with pytest.raises(ValidationError) as exc_info:
        get_settings()
    msg = str(exc_info.value).lower()
    assert "extra" in msg or "nonsense" in msg or "forbidden" in msg


def test_nested_delimiter_parses(monkeypatch: pytest.MonkeyPatch) -> None:
    _minimal_env(monkeypatch)
    monkeypatch.setenv("BRAIN_POSTGRES__POOL_MIN", "5")
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    s = get_settings()
    assert s.postgres.pool_min == 5


def test_supported_schema_versions_parses_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    _minimal_env(monkeypatch)
    monkeypatch.setenv("BRAIN_SUPPORTED_SCHEMA_VERSIONS", "1,2,3")
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    s = get_settings()
    assert s.supported_schema_versions == [1, 2, 3]


def test_supported_schema_versions_default(monkeypatch: pytest.MonkeyPatch) -> None:
    _minimal_env(monkeypatch)
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    s = get_settings()
    assert s.supported_schema_versions == [1]


def test_no_hardcoded_endpoints_in_settings_source() -> None:
    """Audit settings.py for hardcoded URLs/ports outside comments and docstrings."""
    source = SETTINGS_PY.read_text(encoding="utf-8")
    # Strip docstrings (triple-quoted) and # comments before scanning.
    no_triple = re.sub(r'""".*?"""', "", source, flags=re.DOTALL)
    no_triple = re.sub(r"'''.*?'''", "", no_triple, flags=re.DOTALL)
    lines = []
    for line in no_triple.splitlines():
        # Drop everything after a # (naive but acceptable for this lint).
        stripped = line.split("#", 1)[0]
        lines.append(stripped)
    scrubbed = "\n".join(lines)

    forbidden_patterns = [
        r"http://localhost",
        r"127\.0\.0\.1",
        r":5432",
        r":5672",
        r":6333",
    ]
    for pat in forbidden_patterns:
        assert not re.search(pat, scrubbed), (
            f"Hardcoded endpoint {pat!r} found in settings.py source "
            f"outside comments/docstrings"
        )


def test_provider_keys_not_in_src() -> None:
    """AUTH-03: OPENAI_API_KEY/GEMINI_API_KEY may appear only in settings.py."""
    pattern = re.compile(r"OPENAI_API_KEY|GEMINI_API_KEY")
    offenders: list[str] = []
    for py in SRC_BRAIN.rglob("*.py"):
        rel = py.relative_to(REPO_ROOT)
        if py == SETTINGS_PY:
            continue
        text = py.read_text(encoding="utf-8")
        if pattern.search(text):
            offenders.append(str(rel))
    assert offenders == [], (
        f"Provider API keys leaked outside settings.py (AUTH-03): {offenders}"
    )


def test_shutdown_grace_default(monkeypatch: pytest.MonkeyPatch) -> None:
    _minimal_env(monkeypatch)
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    s = get_settings()
    assert s.shutdown.grace_seconds == 30


def test_langfuse_enabled_default_false(monkeypatch: pytest.MonkeyPatch) -> None:
    _minimal_env(monkeypatch)
    from brain.config.settings import get_settings, reload_settings

    reload_settings()
    s = get_settings()
    assert s.langfuse.enabled is False


def test_env_prefix_and_nested_delimiter_configured() -> None:
    from brain.config.settings import Settings

    cfg = Settings.model_config
    assert cfg.get("env_prefix") == "BRAIN_"
    assert cfg.get("env_nested_delimiter") == "__"
    assert cfg.get("extra") == "forbid"


def test_auth_token_has_no_default() -> None:
    """AuthSettings.token must NOT have a default value (T-03-02)."""
    from pydantic_core import PydanticUndefined

    from brain.config.settings import AuthSettings

    field = AuthSettings.model_fields["token"]
    assert field.default is PydanticUndefined
    assert field.is_required()


def test_env_scrub_fixture_works() -> None:
    """The autouse fixture in conftest scrubs BRAIN_* env vars."""
    assert "BRAIN_AUTH__TOKEN" not in os.environ
    assert "OPENAI_API_KEY" not in os.environ
    assert "GEMINI_API_KEY" not in os.environ
