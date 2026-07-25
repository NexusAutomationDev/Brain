---
phase: quick-260725-gme
plan: 01
subsystem: infra
tags: [github-actions, docker, docker-hub, ci-cd, docker-buildx]

requires: []
provides:
  - "publish-brain-sdr.yml publishes docker.io/biellil/brain-sdr directly on tag push"
  - "publish-brain-support.yml publishes docker.io/biellil/brain-support directly on tag push"
affects: [ci, deployment, docker-images]

tech-stack:
  added: []
  patterns:
    - "docker/login-action@v3 immediately before docker/build-push-action@v6, single 'Build and push Docker image' step with push: true and multi-line tags: (semver + latest)"

key-files:
  created: []
  modified:
    - .github/workflows/publish-brain-sdr.yml
    - .github/workflows/publish-brain-support.yml

key-decisions:
  - "Removed the old DockGate/MinIO artifact-hosting flow (tar export, sha256/size calc, upload-URL request, curl PUT upload, latest publish) entirely in favor of native Docker Hub push"
  - "Kept trigger, env block, Checkout, Extract version, and Buildx setup steps untouched per plan constraint (D-06)"
  - "Both workflows push two tags per build: the semver VERSION extracted from the git tag and latest"

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09]

coverage:
  - id: D1
    description: "publish-brain-sdr.yml builds and pushes docker.io/biellil/brain-sdr via docker/login-action + build-push-action with push: true and version+latest tags, old artifact-hosting flow fully removed"
    requirement: "D-01, D-02, D-03, D-04, D-05, D-06, D-07"
    verification:
      - kind: other
        ref: "python3 yaml.safe_load + grep checks in PLAN.md Task 1 <verify> (executed manually, passed with real GNU grep)"
        status: pass
    human_judgment: false
  - id: D2
    description: "publish-brain-support.yml mirrors the same migration, structurally identical to publish-brain-sdr.yml aside from APP_NAME/IMAGE_NAME/Dockerfile path/cache scope"
    requirement: "D-08"
    verification:
      - kind: other
        ref: "python3 yaml.safe_load + grep checks in PLAN.md Task 2 <verify> (executed manually, passed with real GNU grep)"
        status: pass
    human_judgment: false

duration: 4min
completed: 2026-07-25
status: complete
---

# Quick Task 260725-gme: Migrate GitHub Actions workflows to Docker Hub Summary

**Both publish workflows now build and push straight to docker.io/biellil/* via docker/login-action + build-push-action, tagged with semver version and latest — the old DockGate/MinIO tar-upload flow is gone.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-25T15:05:49Z
- **Completed:** 2026-07-25T15:08:59Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `publish-brain-sdr.yml` migrated to a `docker/login-action@v3` + `docker/build-push-action@v6` flow with `push: true`, tagged `biellil/brain-sdr:<VERSION>` and `biellil/brain-sdr:latest`
- `publish-brain-support.yml` migrated identically, tagged `biellil/brain-support:<VERSION>` and `biellil/brain-support:latest`
- Removed all five steps of the old artifact-hosting flow (tar export, sha256/size calculation, DockGate upload-URL request, MinIO curl PUT, DockGate latest-publish) from both files, including their env vars and secrets references

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrar publish-brain-sdr.yml para publicação direta no Docker Hub** - `0f228de` (ci)
2. **Task 2: Migrar publish-brain-support.yml para publicação direta no Docker Hub** - `cd8a0e3` (ci)

_Note: no test/TDD tasks in this plan — both are single-commit config migrations._

## Files Created/Modified
- `.github/workflows/publish-brain-sdr.yml` - Docker Hub login + build-and-push with version+latest tags; old DockGate/MinIO steps removed
- `.github/workflows/publish-brain-support.yml` - Same migration, mirrors publish-brain-sdr.yml structurally

## Decisions Made
- Kept trigger (`on.push.tags`), `env` block, Checkout, Extract-version, and Buildx-setup steps byte-identical to the pre-migration versions, per plan constraint (D-06) — only the build/push portion changed
- Used the YAML multi-line `tags: |` block form (two lines: version tag + `latest`) instead of a comma-joined single-line string, matching build-push-action's documented multi-tag syntax
- Header comments rewritten to describe the new Docker Hub flow while preserving the existing cross-workflow mirroring note in publish-brain-support.yml

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The interactive shell's `grep` is aliased to a ugrep-based wrapper that mis-evaluates the `${{ ... }}` GitHub Actions template syntax in the plan's verify patterns (false negative on `{{`/`}}` handling). Confirmed via `/usr/bin/grep`/`command grep` (real GNU grep) that all verify patterns match correctly — this is an environment-local tooling quirk, not a content defect. The actual GitHub Actions CI runner uses standard GNU grep/bash and is unaffected.

## User Setup Required

**External services require manual configuration** — not documented in a separate USER-SETUP.md since this is a quick task, but noted here: the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets must exist in GitHub before these workflows can successfully authenticate and push on the next `v*.*.*` tag. If they are not already configured (e.g., if a prior version of these workflows relied only on `DOCKGATE_URL`/`DOCKGATE_UPLOAD_TOKEN`), the next tag push will fail at the "Log in to Docker Hub" step until they are added.

## Next Phase Readiness
- Both workflows are ready to fire on the next `v*.*.*`/`v*.*` tag push
- No blockers, assuming `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets are present in the repo (see User Setup Required above)

---
*Quick task: 260725-gme*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: .github/workflows/publish-brain-sdr.yml
- FOUND: .github/workflows/publish-brain-support.yml
- FOUND: 0f228de
- FOUND: cd8a0e3
