---
phase: 30-brain-suporte-docker
reviewed: 2026-07-01T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - .dockerignore
  - .github/workflows/publish-brain-support.yml
  - apps/brain-sdr/Dockerfile
  - apps/brain-support/Dockerfile
  - apps/brain-support/docker-compose.yml
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-07-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the Docker packaging and CI/CD publishing setup for the new `brain-support` app. The `Dockerfile`, `docker-compose.yml`, and GitHub Actions workflow closely mirror the existing `brain-sdr` counterparts, which is the intended pattern per project conventions (each Brain ships its own Docker image, SDK handles the shared lifecycle). No security or correctness defects were found in the new `brain-support` files themselves.

One pre-existing but currently-unaddressed inconsistency was noted in `apps/brain-sdr/Dockerfile`/`docker-compose.yml` while cross-referencing for parity (see WR-01) — it is not new in this phase, but is directly relevant to verifying that `brain-support`'s docker-compose was correctly modeled after brain-sdr's (it was NOT copied verbatim, and that was the right call). Two minor Info-level observations concern shell-scripting hygiene in the workflow file, both inherited unchanged from the existing `publish-brain-sdr.yml` pattern.

## Warnings

### WR-01: `brain-sdr` docker-compose has a stale/inconsistent port mapping (informational parity check)

**File:** `apps/brain-sdr/docker-compose.yml:6`
**Issue:** While verifying that `brain-support`'s new `docker-compose.yml` (port mapping `"${PORT:-3002}:${PORT:-3002}"`) was modeled correctly, cross-referencing against `apps/brain-sdr/docker-compose.yml` revealed it uses a hardcoded/mismatched mapping: `"3002:${PORT:-3001}"` — the host port is hardcoded to `3002` (which now collides with `brain-support`'s own default port) while the container-side default is `3001`, not `3000`/`3002` consistent with its own Dockerfile `ENV PORT=3000`. This is out of scope for this phase's file list (not listed in `files` to review), but it means the new `brain-support` compose file is more correct than the file it was modeled after, and highlights a latent host-port collision if both `brain-sdr` and `brain-support` compose stacks are run on the same host with defaults.
**Fix:** Not required for this phase's scope (brain-sdr's Dockerfile/docker-compose were not part of the reviewed file set and were not modified here). Flagging so a follow-up ticket can fix `apps/brain-sdr/docker-compose.yml:6` to `"${PORT:-3001}:${PORT:-3001}"` for consistency with its own `ENV PORT=3000` default (currently neither side actually reads `3000`), and to avoid a host-port collision with `brain-support`'s `3002` default.

## Info

### IN-01: Unquoted variable expansion in `jq` pipe (shell hygiene)

**File:** `.github/workflows/publish-brain-support.yml:63`
**Issue:** `echo $RESPONSE | jq -r .url` uses an unquoted `$RESPONSE` variable. If the JSON response ever contains whitespace-significant characters or glob-expandable content, word-splitting/globbing could corrupt the payload before it reaches `jq`. This pattern is copied verbatim from the pre-existing `publish-brain-sdr.yml`, so it is not a regression introduced by this phase, but since the file is in the review scope it is worth flagging for consistency.
**Fix:**
```bash
RESPONSE=$(curl -sf -X POST \
  -H "Authorization: Bearer $DOCKGATE_UPLOAD_TOKEN" \
  "$DOCKGATE_URL/apps/$APP_NAME/upload?version=${{ steps.version.outputs.VERSION }}")
echo "URL=$(echo "$RESPONSE" | jq -r .url)" >> $GITHUB_OUTPUT
```

### IN-02: No validation that `jq -r .url` returned a non-empty/non-null URL before uploading

**File:** `.github/workflows/publish-brain-support.yml:63-69`
**Issue:** If the DockGate `upload` endpoint response is malformed or missing the `url` field, `jq -r .url` silently outputs the literal string `null`, and the subsequent `curl -f --show-error -X PUT --upload-file image.tar "null"` step would fail with a possibly confusing error rather than failing fast with a clear message. Same pattern exists unchanged in `publish-brain-sdr.yml`.
**Fix:** Add a guard after extracting the URL:
```bash
URL=$(echo "$RESPONSE" | jq -r .url)
if [ -z "$URL" ] || [ "$URL" = "null" ]; then
  echo "::error::DockGate did not return a valid upload URL. Response: $RESPONSE"
  exit 1
fi
echo "URL=$URL" >> $GITHUB_OUTPUT
```

---

_Reviewed: 2026-07-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
