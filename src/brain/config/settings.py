"""Pydantic Settings — the single source of truth for env-driven config.

D-03: Nested sub-models per concern (Postgres / RabbitMQ / Qdrant / Langfuse /
Auth / Shutdown) aggregated by `Settings(BaseSettings)`.
D-04: Required external secrets (auth token, provider keys) have no defaults.
FOUND-04: every connection / queue / auth / embedding setting flows through here.
FOUND-05: fail-fast — missing required vars raise `pydantic.ValidationError`.
PITFALL 6 / T-03-04: unknown `BRAIN_*` env vars are rejected at startup via a
model validator (pydantic-settings' env source silently drops names that don't
match a field, so `extra="forbid"` alone isn't enough — we walk `os.environ`).
AUTH-03: this module is the ONLY place under `src/brain/` allowed to reference
provider API key env names (`OPENAI_API_KEY`, `GEMINI_API_KEY`).
"""
from __future__ import annotations

import functools
import os
from typing import Annotated, Any

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class PostgresSettings(BaseModel):
    """Brain transactional store — LangGraph checkpointer + brain.* schema."""

    dsn: str
    pool_min: int = 2
    pool_max: int = 10


class RabbitMQSettings(BaseModel):
    """AMQP ingress/egress; Phase 8 wires the consumer."""

    url: str
    prefetch: int = 1


class QdrantSettings(BaseModel):
    """Vector store; Phase 7 wires retrieval."""

    url: str
    api_key: str | None = None


class LangfuseSettings(BaseModel):
    """Brain-side Langfuse SDK — disabled in Phase 1 (Phase 4 turns it on)."""

    host: str = "http://langfuse-web:3000"
    public_key: str = ""
    secret_key: str = ""
    enabled: bool = False


class AuthSettings(BaseModel):
    """Static bearer token (AUTH-01). NO default — startup fails fast if absent."""

    token: str  # required; no default — see T-03-02


class ShutdownSettings(BaseModel):
    """Graceful-shutdown grace window (D-13, FOUND-09)."""

    grace_seconds: int = 30


# Known top-level + nested env keys (computed at module import). Anything else
# under the `BRAIN_` prefix raises at startup so typos like `BRAIN_POSTGERS__DSN`
# can't silently disable a field.
_BRAIN_PREFIX = "BRAIN_"


def _known_brain_env_keys() -> set[str]:
    """Enumerate every `BRAIN_*` env name that maps to a Settings field."""
    nested_models: dict[str, type[BaseModel]] = {
        "POSTGRES": PostgresSettings,
        "RABBITMQ": RabbitMQSettings,
        "QDRANT": QdrantSettings,
        "LANGFUSE": LangfuseSettings,
        "AUTH": AuthSettings,
        "SHUTDOWN": ShutdownSettings,
    }
    keys: set[str] = {
        "BRAIN_ENV",
        "BRAIN_LOG_FORMAT",
        "BRAIN_LOG_LEVEL",
        "BRAIN_SUPPORTED_SCHEMA_VERSIONS",
    }
    for prefix, model in nested_models.items():
        for field_name in model.model_fields:
            keys.add(f"BRAIN_{prefix}__{field_name.upper()}")
    return keys


class Settings(BaseSettings):
    """Top-level aggregate. Read from env via `BRAIN_*` with `__` delimiter.

    Provider API keys live on the OS env (no `BRAIN_` prefix) because the
    upstream LangChain SDKs read them directly. We expose them here so that
    every other module fetches them via `get_settings().openai_api_key` /
    `.gemini_api_key` rather than reaching into `os.environ` directly (AUTH-03).
    """

    model_config = SettingsConfigDict(
        env_prefix="BRAIN_",
        env_nested_delimiter="__",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="forbid",
    )

    env: str = "development"
    log_format: str = "json"  # json | console
    log_level: str = "INFO"
    # NoDecode keeps pydantic-settings from JSON-decoding the env string;
    # _parse_versions_csv below splits "1,2,3" into [1, 2, 3].
    supported_schema_versions: Annotated[list[int], NoDecode] = [1]

    postgres: PostgresSettings
    rabbitmq: RabbitMQSettings
    qdrant: QdrantSettings
    langfuse: LangfuseSettings = Field(default_factory=LangfuseSettings)
    auth: AuthSettings
    shutdown: ShutdownSettings = Field(default_factory=ShutdownSettings)

    # Provider keys — populated from process env (no `BRAIN_` prefix).
    # AUTH-03 enforces that *these env names* appear in this file only.
    openai_api_key: str | None = None
    gemini_api_key: str | None = None

    @field_validator("supported_schema_versions", mode="before")
    @classmethod
    def _parse_versions_csv(cls, v: Any) -> Any:
        """Accept ``"1,2,3"`` from env and ``[1, 2, 3]`` from code alike."""
        if isinstance(v, str):
            cleaned = [part.strip() for part in v.split(",") if part.strip()]
            return [int(part) for part in cleaned]
        return v

    @model_validator(mode="before")
    @classmethod
    def _reject_unknown_brain_env(cls, data: Any) -> Any:
        """Fail fast on `BRAIN_*` env vars that don't map to a known field.

        pydantic-settings' EnvSettingsSource only loads matching names — stray
        keys are silently ignored — so a typo like ``BRAIN_POSTGERS__DSN`` would
        slip past `extra="forbid"`. We walk `os.environ` and raise.
        """
        allowed = _known_brain_env_keys()
        offenders: list[str] = []
        for key in os.environ:
            upper = key.upper()
            if not upper.startswith(_BRAIN_PREFIX):
                continue
            if upper not in allowed:
                offenders.append(key)
        if offenders:
            raise ValueError(
                "Extra inputs are not permitted (extra='forbid'): "
                f"unknown BRAIN_* env vars: {sorted(offenders)!r}"
            )
        return data

    def model_post_init(self, __context: object) -> None:  # type: ignore[override]
        """Pick up provider keys from their canonical env names if unset."""
        if self.openai_api_key is None:
            value = os.environ.get("OPENAI_API_KEY")
            if value:
                object.__setattr__(self, "openai_api_key", value)
        if self.gemini_api_key is None:
            value = os.environ.get("GEMINI_API_KEY")
            if value:
                object.__setattr__(self, "gemini_api_key", value)


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide cached `Settings` accessor.

    First call validates env; subsequent calls return the memoized instance.
    Tests clear the cache via `reload_settings()`.
    """
    return Settings()  # type: ignore[call-arg]  # all fields populated from env


def reload_settings() -> None:
    """Clear the cached `Settings` — used by tests after `monkeypatch.setenv`."""
    get_settings.cache_clear()
