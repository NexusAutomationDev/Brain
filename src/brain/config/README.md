# brain.config

## Owns

All environment-driven configuration: the Pydantic `Settings` aggregate (nested sub-models per D-03: `PostgresSettings`, `RabbitMQSettings`, `QdrantSettings`, `LangfuseSettings`, `AuthSettings`), the `get_settings()` cached accessor, the structlog configuration (canonical fields per D-14), and the `schema_version` validator helper that future request models attach via Pydantic `field_validator` (FOUND-11 / D-16).

## Public surface (as of Phase 1)

Empty stub. Plan 01-03 lands `Settings` + `get_settings()`; Plan 01-04 lands `validate_schema_version` + structlog config.

## Filled by

- Phase 1 (Plan 01-03): `Settings`, `get_settings()`, sub-models with `env_nested_delimiter="__"`, `BRAIN_*` env prefix.
- Phase 1 (Plan 01-04): `validate_schema_version`, structlog `configure_logging()` with `contextvars`, `BRAIN_SUPPORTED_SCHEMA_VERSIONS` parser, `BRAIN_SHUTDOWN_GRACE_SECONDS` typed setting.

## Do NOT

- scatter os.getenv() across modules; all env access flows through brain.config.settings.get_settings().
- Hardcode endpoints — every URL/DSN is env-driven (PROJECT.md constraint).
- Reach into `pydantic.v1` shims; Pydantic v2 only (STACK.md §10).
