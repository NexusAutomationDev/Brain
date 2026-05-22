"""Assert .env.example documents every Settings env-var key (and vice-versa).

Promotes T-09-07 from accept -> mitigate. Walks Settings.model_fields
recursively (BaseSettings v2 idiom), handling nested sub-models with the
configured ``env_nested_delimiter`` ('``__``'). Asserts both-direction equality
against the parsed .env.example key set.

This test is the source of truth for drift detection going forward; the
``scripts/check-env-example.sh`` shell helper remains as a CI convenience but
piggybacks on ``brain.config.settings._known_brain_env_keys`` rather than
re-implementing the walk.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, get_args, get_origin

from pydantic import BaseModel
from pydantic_settings import BaseSettings


def _unwrap_basemodel(annotation: Any) -> type[BaseModel] | None:
    """Return the underlying ``BaseModel`` class for ``annotation`` (or None).

    Handles bare ``Model``, ``Optional[Model]``, ``Annotated[Model, ...]``, etc.
    """
    try:
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            return annotation
    except TypeError:
        pass
    for arg in get_args(annotation) or ():
        cls = _unwrap_basemodel(arg)
        if cls is not None:
            return cls
    if get_origin(annotation) is None:
        return None
    return None


def _walk(cls: type[BaseModel], prefix: str, delim: str) -> set[str]:
    """Recursively enumerate env-var names rooted at ``prefix``."""
    keys: set[str] = set()
    for name, field in cls.model_fields.items():
        full = f"{prefix}{delim}{name.upper()}"
        nested = _unwrap_basemodel(field.annotation)
        if (
            nested is not None
            and issubclass(nested, BaseModel)
            and not issubclass(nested, BaseSettings)
        ):
            keys |= _walk(nested, full, delim)
        else:
            keys.add(full)
    return keys


# Fields populated from canonical (non-BRAIN_-prefixed) env vars via
# Settings.model_post_init. They live as top-level Settings attributes for
# AUTH-03 (single point of import) but skip the env_prefix machinery.
_NON_PREFIXED_FIELDS: dict[str, str] = {
    "openai_api_key": "OPENAI_API_KEY",
    "gemini_api_key": "GEMINI_API_KEY",
}


def _settings_keys() -> set[str]:
    from brain.config.settings import Settings

    env_prefix = (Settings.model_config.get("env_prefix") or "").rstrip("_")
    delim = Settings.model_config.get("env_nested_delimiter") or "__"
    base_prefix = env_prefix or ""
    keys: set[str] = set()
    for name, field in Settings.model_fields.items():
        if name in _NON_PREFIXED_FIELDS:
            # Provider keys: read directly from os.environ in model_post_init.
            keys.add(_NON_PREFIXED_FIELDS[name])
            continue
        nested = _unwrap_basemodel(field.annotation)
        if (
            nested is not None
            and issubclass(nested, BaseModel)
            and not issubclass(nested, BaseSettings)
        ):
            # Nested sub-models use the configured delimiter (typically '__').
            nested_prefix = f"{base_prefix}_{name.upper()}" if base_prefix else name.upper()
            keys |= _walk(nested, nested_prefix, delim)
        else:
            # Top-level scalar — single-underscore join with the prefix.
            top_key = f"{base_prefix}_{name.upper()}" if base_prefix else name.upper()
            keys.add(top_key)
    return keys


def _env_example_brain_keys() -> set[str]:
    text = Path(".env.example").read_text(encoding="utf-8")
    keys: set[str] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key.startswith("BRAIN_"):
            keys.add(key)
    return keys


def _provider_keys_in_settings() -> set[str]:
    """The non-BRAIN_-prefixed env names Settings reads from os.environ."""
    return {"OPENAI_API_KEY", "GEMINI_API_KEY"}


def test_every_settings_brain_field_appears_in_env_example():
    """Every BRAIN_* field declared by Settings must have a .env.example row.

    Provider keys (``OPENAI_API_KEY`` / ``GEMINI_API_KEY``) are tested
    separately — they live as top-level Settings attributes but use canonical
    env names (no ``BRAIN_`` prefix), so they shouldn't appear in the
    BRAIN_-only walker output.
    """
    # Restrict to BRAIN_-prefixed names (excludes the provider-key escape hatch).
    expected = {k for k in _settings_keys() if k.startswith("BRAIN_")}
    declared = _env_example_brain_keys()
    missing = expected - declared
    assert not missing, f"Settings fields with no .env.example entry: {sorted(missing)}"


def test_every_env_example_brain_key_maps_to_a_settings_field():
    expected = {k for k in _settings_keys() if k.startswith("BRAIN_")}
    declared = _env_example_brain_keys()
    extra = declared - expected
    assert not extra, (
        ".env.example declares BRAIN_* keys with no Settings field "
        f"(typo or stale): {sorted(extra)}"
    )


def test_provider_keys_documented_in_env_example():
    """Provider keys live outside the BRAIN_* namespace but must still be
    documented in .env.example so operators know to fill them.
    """
    text = Path(".env.example").read_text(encoding="utf-8")
    for key in _provider_keys_in_settings():
        assert f"{key}=" in text, (
            f"Provider key {key} is read by Settings but missing from .env.example"
        )
