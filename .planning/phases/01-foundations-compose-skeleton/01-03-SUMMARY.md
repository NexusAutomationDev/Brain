---
phase: 01-foundations-compose-skeleton
plan: 03
subsystem: brain.config
tags: [config, pydantic, settings, env, schema-version, secrets]
dependency_graph:
  requires:
    - 01-01 (.gitignore + .gitleaks.toml + .env allowlist)
    - 01-02 (src/brain/config package skeleton)
  provides:
    - brain.config.settings.Settings
    - brain.config.settings.get_settings
    - brain.config.settings.reload_settings
    - brain.config.schema_version.SchemaVersion (AfterValidator)
    - brain.config.schema_version.is_supported_schema_version
    - brain.config.schema_version.UNSUPPORTED_SCHEMA_VERSION_CODE
    - brain.config.constants.MAX_REQUEST_BODY_BYTES
    - .env.example (drift-checked against Settings)
    - tests/conftest.settings_factory fixture
  affects:
    - phase 01-04 (structlog config will import get_settings)
    - phase 01-05 (FastAPI app + lifespan reads Settings)
    - phase 01-06 (psycopg pool reads BRAIN_POSTGRES__*)
    - phase 01-07 (Qdrant ready-probe reads BRAIN_QDRANT__URL)
    - phase 03 (BrainRequest attaches SchemaVersion + AUTH-04 middleware uses MAX_REQUEST_BODY_BYTES)
tech_stack:
  added:
    - pydantic 2.13.4 (already in pyproject) — field_validator + model_validator + AfterValidator
    - pydantic-settings 2.14.1 (already in pyproject) — BaseSettings + NoDecode + SettingsConfigDict
  patterns:
    - "Aggregate Settings(BaseSettings) holds 6 nested BaseModel sub-models (D-03)"
    - "env_prefix='BRAIN_' + env_nested_delimiter='__' + extra='forbid' (PITFALL 6)"
    - "model_validator(mode='before') walks os.environ to reject unknown BRAIN_* keys (extra='forbid' alone is insufficient because pydantic-settings' EnvSettingsSource silently drops unmatched names)"
    - "Annotated[list[int], NoDecode] + @field_validator before-mode parses CSV env strings without triggering JSON decode"
    - "lru_cache(maxsize=1) for get_settings(); reload_settings() clears for tests"
key_files:
  created:
    - src/brain/config/settings.py
    - src/brain/config/schema_version.py
    - src/brain/config/constants.py
    - .env.example
    - tests/test_settings.py
    - tests/test_schema_version.py
    - tests/test_payload_cap.py
  modified:
    - src/brain/config/__init__.py
    - tests/conftest.py
decisions:
  - "Reject unknown BRAIN_* env vars via a custom model_validator that walks os.environ. pydantic-settings' env source silently drops keys that don't match a field name, so extra='forbid' alone leaves T-03-04 / PITFALL 6 unmitigated. The validator computes the allowed set by inspecting model_fields of every nested model, so adding a field to any sub-model automatically widens the allowlist with no maintenance."
  - "Use Annotated[list[int], NoDecode] for supported_schema_versions plus a before-mode field_validator that splits on commas. The straight list[int] type would trigger pydantic-settings' JSON decoder and reject '1,2,3'."
  - "Provider keys (OPENAI_API_KEY, GEMINI_API_KEY) live as top-level Settings fields populated in model_post_init from their canonical OS env names (no BRAIN_ prefix). This keeps AUTH-03 satisfied — every other module imports them via get_settings().openai_api_key — without forcing operators to use a synthetic BRAIN_OPENAI_API_KEY env."
metrics:
  duration: "~25 minutes"
  completed: 2026-05-22
  tasks: 2
  files_created: 7
  files_modified: 2
  tests_added: 24
  commits: 3
---

# Phase 01 Plan 03: Pydantic Settings, Schema-Version Helper, Payload-Cap Constant — Summary

One-liner: Typed `Settings` aggregate with 6 nested sub-models + AUTH-03-clean provider-key handling + `.env.example` whose every line maps 1-to-1 to a `Settings` field.

## What Landed

### `Settings` shape (src/brain/config/settings.py)

| Path | Type | Default | Notes |
|------|------|---------|-------|
| `env` | str | "development" | service mode |
| `log_format` | str | "json" | "json" or "console" |
| `log_level` | str | "INFO" | structlog level (Phase 1 plan 04 wires) |
| `supported_schema_versions` | list[int] | [1] | CSV-parsed via NoDecode + before-validator |
| `postgres.dsn` | str | required | LangGraph checkpointer + brain.* schema |
| `postgres.pool_min` | int | 2 | psycopg pool floor (Phase 1 plan 06) |
| `postgres.pool_max` | int | 10 | psycopg pool ceiling |
| `rabbitmq.url` | str | required | AMQP URL (Phase 8 wires consumer) |
| `rabbitmq.prefetch` | int | 1 | consumer prefetch count |
| `qdrant.url` | str | required | vector store base URL |
| `qdrant.api_key` | str \| None | None | optional bearer |
| `langfuse.host` | str | "http://langfuse-web:3000" | docker-network DNS |
| `langfuse.public_key` | str | "" | Phase 4 fills |
| `langfuse.secret_key` | str | "" | Phase 4 fills |
| `langfuse.enabled` | bool | False | OFF by default (D-11, OBS-04) |
| `auth.token` | str | **required, no default** | T-03-02 / AUTH-01 |
| `shutdown.grace_seconds` | int | 30 | D-13 |
| `openai_api_key` | str \| None | None | reads `OPENAI_API_KEY` in post-init |
| `gemini_api_key` | str \| None | None | reads `GEMINI_API_KEY` in post-init |

### Operator-supplied placeholders in `.env.example`

Future operators must fill these seven `<REPLACE_ME>*` values before any real deployment:

1. `BRAIN_AUTH__TOKEN` — webhook bearer token (AUTH-01)
2. `OPENAI_API_KEY` — OpenAI provider credential (Phase 5)
3. `GEMINI_API_KEY` — Google Gemini provider credential (Phase 5)
4. `LANGFUSE_NEXTAUTH_SECRET` — 64-char random for Langfuse NextAuth (Phase 4)
5. `LANGFUSE_SALT` — 64-char random for Langfuse hashing (Phase 4)
6. `LANGFUSE_ENCRYPTION_KEY` — 64-char hex for Langfuse at-rest crypto (Phase 4)
7. `BRAIN_QDRANT__API_KEY` — optional Qdrant bearer (uncommented only if Qdrant
   instance enforces auth; the field accepts `None`/blank)

All other env lines ship working dev defaults (D-04).

### AUTH-03 proof (provider keys outside `settings.py`)

```text
$ grep -rE 'OPENAI_API_KEY|GEMINI_API_KEY' src/brain/ --include='*.py' \
    | grep -v 'src/brain/config/settings.py'
(empty)
```

Provider env names appear only in `src/brain/config/settings.py`. The
`tests/test_settings.py::test_provider_keys_not_in_src` test enforces this on
every CI run.

> Note: `src/brain/observability/README.md` mentions `OPENAI_API_KEY` as an
> example of a value the observability layer must NOT ship to traces (PITFALL
> 5.1). It is documentation, not Python source, and is intentionally
> excluded from the AUTH-03 source scan. Plan 01-09's
> `scripts/check-env-example.sh` covers the documentation drift check.

### Tests added (24, all green)

`tests/test_settings.py` (14):
- happy path + missing token + missing DSN + extra=forbid (unknown BRAIN_* var)
- nested-delimiter parse + comma-separated CSV parse + default list
- no-hardcoded-endpoints audit + AUTH-03 provider-key scan
- shutdown grace default + langfuse-disabled default
- env_prefix/nested_delimiter/extra introspection + auth.token has no default
- env-scrub fixture sanity

`tests/test_schema_version.py` (7):
- supported / unsupported helper + raises with `UNSUPPORTED_SCHEMA_VERSION` code
- error-code constant + custom-versions env round-trip
- validator passes 1 + SchemaVersion AfterValidator export

`tests/test_payload_cap.py` (3):
- value == 32768 + int type + re-export from package

Run: `uv run pytest tests/test_settings.py tests/test_schema_version.py tests/test_payload_cap.py` → 24 passed in 0.19s.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] CSV parsing for `supported_schema_versions`**

- **Found during:** Task 1 GREEN phase
- **Issue:** Plan's note "pydantic-settings 2.x parses `'1,2,3'` automatically"
  is incorrect for `list[int]` typed fields — the env source attempts to JSON-
  decode the string first and raises `SettingsError` before any validator runs.
- **Fix:** Switched the field type to `Annotated[list[int], NoDecode]` and
  added a `@field_validator(mode="before")` that splits on commas.
- **Files modified:** `src/brain/config/settings.py`
- **Commit:** `a892d88`

**2. [Rule 2 — Missing critical functionality] `extra="forbid"` does not block
unknown BRAIN_* env vars**

- **Found during:** Task 1 GREEN phase (test_unknown_var_raises failed)
- **Issue:** `extra="forbid"` blocks unknown keys in the *Pydantic data*
  passed to validation, but pydantic-settings' `EnvSettingsSource` silently
  drops env keys that don't match a field name. A typo like
  `BRAIN_POSTGERS__DSN` would never reach Pydantic's extra check — defeating
  the FOUND-05 / T-03-04 mitigation the plan intended.
- **Fix:** Added a `model_validator(mode="before")` that walks `os.environ`,
  computes the allowed `BRAIN_*` set by introspecting every sub-model's
  `model_fields`, and raises `ValueError` (which Pydantic surfaces as
  `ValidationError`) when a stray `BRAIN_*` key is present. The allowlist is
  generated, not hard-coded — adding a field to any sub-model widens it
  automatically.
- **Files modified:** `src/brain/config/settings.py`
- **Commit:** `a892d88`

**3. [Rule 1 — Lint] `__all__` ordering and import grouping in `__init__.py`**

- **Found during:** Task 1 REFACTOR phase
- **Issue:** Ruff RUF022 + I001 flagged unsorted `__all__` and unsorted
  imports in `src/brain/config/__init__.py`.
- **Fix:** Applied `ruff check --fix`.
- **Commit:** rolled into `a892d88`.

### Deferred Issues

**`gitleaks` binary not present in this sandbox** — the plan's `<verify>` lines for Task 2 (`gitleaks detect --no-git --source .env.example --config .gitleaks.toml`) could not be executed here. The pre-commit hook installed by plan 01-01 (`.pre-commit-config.yaml`) will run gitleaks on every commit on a developer machine, and CI (plan 01-09) will run `gitleaks detect --redact --config .gitleaks.toml` against the full repo. The `.env.example` content uses only allowlisted placeholders (`<REPLACE_ME>`, `<REPLACE_ME_64_CHAR_RANDOM>`, `<REPLACE_ME_64_CHAR_HEX>`) and dev-only credentials (`langfuse`, `minio`/`miniominio`) that don't match any gitleaks rule pattern, so the file is expected to pass cleanly.

**Pre-existing `src/brain/observability/README.md` mention of `OPENAI_API_KEY`** — markdown documentation (not Python source) that warns the observability layer not to ship provider keys into traces. Not in scope for plan 01-03 (introduced by plan 01-02); flagged here as a note for plan 01-09's documentation-drift scan.

**Pre-existing integration test failures** (`tests/integration/test_migrate.py` — `ModuleNotFoundError: psycopg2`) — out of scope; plan 01-06 owns psycopg integration. Not introduced by this plan.

## Notes for Plan 01-09 (`scripts/check-env-example.sh`)

The drift-detection script can use `brain.config.settings._known_brain_env_keys()` directly:

```bash
#!/usr/bin/env bash
# scripts/check-env-example.sh — assert every BRAIN_* key in .env.example
# matches a Settings field and vice versa.
set -euo pipefail
ENV_KEYS=$(grep -oE '^BRAIN_[A-Z_]+(__[A-Z_]+)?' .env.example | sort -u)
SETTINGS_KEYS=$(uv run python -c "
from brain.config.settings import _known_brain_env_keys
print('\n'.join(sorted(_known_brain_env_keys())))
")
diff <(echo "$ENV_KEYS") <(echo "$SETTINGS_KEYS")
```

Exit non-zero on drift.

## Requirements Closed by This Plan

| Req | How |
|-----|-----|
| FOUND-04 | every connection / queue / auth / embedding setting flows through `Settings` |
| FOUND-05 | missing required env raises `pydantic.ValidationError` at startup; tests enforce |
| FOUND-11 | `schema_version` helper + `BRAIN_SUPPORTED_SCHEMA_VERSIONS` env (FOUND-11) |
| AUTH-03 | provider key env names appear only in `settings.py`; CI grep enforced via `test_provider_keys_not_in_src` |
| AUTH-04 | `MAX_REQUEST_BODY_BYTES = 32 * 1024` constant published; Phase 3 wires middleware |
| DEPLOY-07 | `.env.example` documents every Settings field with working dev defaults / `<REPLACE_ME>` placeholders |

FOUND-12 final piece (env in gitignore + gitleaks rules) was landed by plan 01-01; this plan exercises it via the `.env.example`-clean-of-secrets contract.

## Threat Flags

None. No new trust boundaries beyond the ones explicitly modeled in the plan's `<threat_model>` (T-03-01 through T-03-07).

## Self-Check: PASSED

- `src/brain/config/settings.py` — FOUND
- `src/brain/config/schema_version.py` — FOUND
- `src/brain/config/constants.py` — FOUND
- `src/brain/config/__init__.py` — FOUND (modified)
- `.env.example` — FOUND
- `tests/test_settings.py` — FOUND
- `tests/test_schema_version.py` — FOUND
- `tests/test_payload_cap.py` — FOUND
- `tests/conftest.py` — FOUND (modified)
- Commit `64e91dc` (RED tests) — FOUND
- Commit `a892d88` (GREEN impl) — FOUND
- Commit `2480a53` (.env.example) — FOUND
- `uv run pytest tests/test_settings.py tests/test_schema_version.py tests/test_payload_cap.py` — 24 passed
- `uv run ruff check src/brain/config/ tests/test_settings.py tests/test_schema_version.py tests/test_payload_cap.py tests/conftest.py` — clean
- AUTH-03 grep (`.py` only) — empty
- `uv run python -c "from brain.config import MAX_REQUEST_BODY_BYTES; print(MAX_REQUEST_BODY_BYTES)"` → `32768`
