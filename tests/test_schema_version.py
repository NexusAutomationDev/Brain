"""Tests for brain.config.schema_version (Plan 01-03, FOUND-11)."""
from __future__ import annotations

import pytest


def _seed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BRAIN_AUTH__TOKEN", "test-token-test-token-test-token")
    monkeypatch.setenv(
        "BRAIN_POSTGRES__DSN",
        "postgresql://test:test@localhost:5432/test",
    )
    monkeypatch.setenv("BRAIN_RABBITMQ__URL", "amqp://test:test@localhost:5672/")
    monkeypatch.setenv("BRAIN_QDRANT__URL", "http://localhost:6333")


def test_supported_version_returns_true(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_env(monkeypatch)
    from brain.config.settings import reload_settings

    reload_settings()
    from brain.config.schema_version import is_supported_schema_version

    assert is_supported_schema_version(1) is True


def test_unsupported_version_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_env(monkeypatch)
    from brain.config.settings import reload_settings

    reload_settings()
    from brain.config.schema_version import is_supported_schema_version

    assert is_supported_schema_version(99) is False


def test_unsupported_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_env(monkeypatch)
    from brain.config.settings import reload_settings

    reload_settings()
    from brain.config.schema_version import (
        UNSUPPORTED_SCHEMA_VERSION_CODE,
        _validate_schema_version,
    )

    with pytest.raises(ValueError) as exc_info:
        _validate_schema_version(99)
    assert UNSUPPORTED_SCHEMA_VERSION_CODE in str(exc_info.value)


def test_error_code_constant() -> None:
    from brain.config.schema_version import UNSUPPORTED_SCHEMA_VERSION_CODE

    assert UNSUPPORTED_SCHEMA_VERSION_CODE == "UNSUPPORTED_SCHEMA_VERSION"


def test_supports_custom_versions_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_env(monkeypatch)
    monkeypatch.setenv("BRAIN_SUPPORTED_SCHEMA_VERSIONS", "1,2,3")
    from brain.config.settings import reload_settings

    reload_settings()
    from brain.config.schema_version import (
        _validate_schema_version,
        is_supported_schema_version,
    )

    assert is_supported_schema_version(2) is True
    assert _validate_schema_version(3) == 3
    assert is_supported_schema_version(99) is False


def test_validator_passes_supported(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_env(monkeypatch)
    from brain.config.settings import reload_settings

    reload_settings()
    from brain.config.schema_version import _validate_schema_version

    assert _validate_schema_version(1) == 1


def test_schema_version_after_validator_is_exported() -> None:
    """`SchemaVersion` must be importable so Phase 3 can attach via Annotated."""
    from brain.config.schema_version import SchemaVersion

    assert SchemaVersion is not None
    # AfterValidator instances expose the wrapped function under `.func`.
    assert hasattr(SchemaVersion, "func")
