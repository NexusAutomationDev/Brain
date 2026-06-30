---
phase: quick-260630-ssd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - CLAUDE.md
autonomous: true
requirements: [QUICK-01]

must_haves:
  truths:
    - "CLAUDE.md's Git Commit Guidelines section documents scope format (optional, kebab-case, package/app name)"
    - "CLAUDE.md's Git Commit Guidelines section documents the BREAKING CHANGE rule (footer and/or `!` after type/scope) with the 💥 emoji"
    - "CLAUDE.md's Git Commit Guidelines section documents body/title formatting rules (blank line between title and body, imperative mood title, title length limit)"
    - "CLAUDE.md's Git Commit Guidelines section states the commit message language convention matching actual repo history (English titles)"
    - "The existing emoji-per-type table and existing examples remain intact and unreplaced"
  artifacts:
    - path: "CLAUDE.md"
      provides: "Updated Git Commit Guidelines section with Conventional Commits rigor"
      contains: "BREAKING CHANGE"
  key_links: []
---

<objective>
Tighten the "Git Commit Guidelines" section of `/root/Brain/CLAUDE.md` so it follows the Conventional Commits spec (https://www.conventionalcommits.org/) more rigorously, while keeping the existing Gitmoji emoji-per-type convention untouched. Add explicit rules for: scope format, BREAKING CHANGE footer/marker with 💥 emoji, body/title formatting, and commit message language — all derived from and consistent with this repo's actual git history.

Purpose: The current section states the format but is loose on scope conventions, omits BREAKING CHANGE handling entirely, and doesn't specify title/body formatting rules or language convention — causing inconsistency risk as the team scales commit authorship (including Claude executors).

Output: Updated `## Git Commit Guidelines` section in CLAUDE.md only. No tooling changes (no husky, no commitlint, no package.json edits).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md

Confirmed via `git log --oneline -30` that commit subjects are written in English with kebab-case
scopes referencing package/app/phase names, e.g.:
- `🐛 fix(27): rebuild stale dist artifacts and fix fup-e2e migrations path`
- `✨ feat(27-03): expand health check with transport status and rewire brain-sdr startup`
- `🔧 chore(core): add rabbitmq-client as explicit dependency — fix Docker build`

(Note: a handful of `docs(phase-N)` commits have Portuguese body content, but titles are
consistently English across the history — this confirms the language rule to document.)

Monorepo packages (valid scope examples): ai, core, database, memory, observability, shared, transport
Monorepo apps (valid scope examples): brain-echo, brain-sdr

<interfaces>
Current section to be edited verbatim as the base (CLAUDE.md lines 1-60, everything before the
`<!-- GSD:project-start -->` marker on line 62) — preserve the table and examples exactly,
insert new subsections between `### Examples` and `### Important Rules`:

```markdown
## Git Commit Guidelines

**MANDATORY**: All commits must follow the Conventional Commits specification with emojis.

### Commit Message Format

```
<emoji> <type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types with Emojis

| Emoji | Type | When to use |
|-------|------|-------------|
| ✨ | **feat** | A new feature |
| 🐛 | **fix** | A bug fix |
| 📝 | **docs** | Documentation only changes |
| 💄 | **style** | Code style/formatting (whitespace, semicolons, etc) |
| ♻️ | **refactor** | Code change that neither fixes a bug nor adds a feature |
| ⚡️ | **perf** | Performance improvements |
| ✅ | **test** | Adding or updating tests |
| 🔧 | **chore** | Changes to build process or auxiliary tools |
| 🏗️ | **build** | Changes that affect the build system or dependencies |
| 🤖 | **ci** | Changes to CI configuration files and scripts |
| ⏪️ | **revert** | Reverts a previous commit |
| 🔒️ | **security** | Security improvements or fixes |

### Examples

```bash
✨ feat: add endpoint to search chats by botIdentifier

🐛 fix(mongodb): resolve connection timeout in service

📝 docs: update API endpoint examples in README

♻️ refactor(database): simplify database iteration logic

⚡️ perf: optimize message query improving time by 30%

✅ test: add unit tests for authentication service

🔧 chore: configure lint-staged and husky for pre-commit

🏗️ build: adjust GitHub Actions workflow for production

🔒️ security: validate JWT tokens before processing requests
```

### Important Rules

**NEVER** include these lines in commits:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend Git Commit Guidelines with scope, breaking-change, formatting, and language rules</name>
  <files>CLAUDE.md</files>
  <action>
Edit the `## Git Commit Guidelines` section in `/root/Brain/CLAUDE.md` (currently lines 1-60, ending right before the `<!-- GSD:project-start -->` HTML comment on line 62). Keep the existing `### Commit Message Format` code block, the full `### Types with Emojis` table (all 12 rows, unchanged), and the full `### Examples` code block (all unchanged) exactly as they are today — do not remove, reorder, or reword any existing row or example.

Insert four new subsections, in this order, immediately AFTER `### Examples` and BEFORE the existing `### Important Rules`:

1. **`### Scope`**
   - Scope is optional, written in parentheses immediately after the type: `<type>(<scope>):`
   - Scope MUST be kebab-case
   - Scope should name the affected package or app from the monorepo (e.g. `core`, `database`, `transport`, `memory`, `observability`, `shared`, `ai`, `brain-sdr`, `brain-echo`), or a phase/feature identifier when the change spans a GSD phase (e.g. `27`, `27-01`) — cite 2-3 real examples already used in this repo's history: `fix(mongodb)`, `refactor(database)`, `feat(27-01)`
   - Omit scope entirely when the change is repo-wide or doesn't map to a single package/app

2. **`### Breaking Changes`**
   - A breaking change is indicated EITHER by appending `!` immediately after the type/scope and before the colon (e.g. `feat(core)!: change IBrain interface signature`), OR by a `BREAKING CHANGE:` footer, OR both together
   - Standardize on using 💥 as the commit's leading emoji whenever the commit contains a `BREAKING CHANGE:` footer or `!` marker — replacing the type-specific emoji for that commit
   - The `BREAKING CHANGE:` footer must describe what breaks and the migration path. Example:
     ```
     💥 feat(core)!: remove deprecated TenantPoolManager.getPool() sync method

     BREAKING CHANGE: getPool() is now async. Update all callers to `await pool.getPool()`.
     ```
   - Breaking changes trigger a MAJOR version bump per semver — flag this explicitly when reviewing such a commit

3. **`### Title and Body Formatting`**
   - One blank line MUST separate the title line from the body
   - Title (the `<description>` part) MUST be written in the imperative mood ("add", "fix", "change" — not "added", "fixes", "changing")
   - Title MUST NOT exceed 72 characters (emoji + type + scope + description combined)
   - Title MUST NOT end with a period
   - Body (when present) explains the *why* behind the change, not just the *what*; wrap body lines at ~100 characters for readability
   - Footer(s) (when present) come after a blank line following the body, used for `BREAKING CHANGE:`, issue references, etc.

4. **`### Commit Message Language`**
   - Commit message titles (the `<description>` part) are written in **English**, matching the existing examples in this guide and the project's actual commit history (verified via `git log`)
   - This applies regardless of whether the surrounding code/comments are in Portuguese or English
   - Body text, when present, may use Portuguese for internal/process-oriented commits (e.g. `docs(phase-N)` summaries) but titles must stay in English for consistency with `git log` searchability and the emoji-type table above

Keep `### Important Rules` (the NEVER block about "Generated with Claude Code" / "Co-Authored-By") as the final subsection, unchanged.

Do not touch any other section of CLAUDE.md (Project, Technology Stack, Conventions, Architecture, Project Skills, GSD Workflow Enforcement, Developer Profile) — only the Git Commit Guidelines section (everything between the start of the file and the `<!-- GSD:project-start -->` marker) is in scope.

Do not install husky, commitlint, or any tooling. Do not modify package.json or any build configuration.
  </action>
  <verify>
    <automated>grep -q "### Scope" /root/Brain/CLAUDE.md && grep -q "### Breaking Changes" /root/Brain/CLAUDE.md && grep -q "### Title and Body Formatting" /root/Brain/CLAUDE.md && grep -q "### Commit Message Language" /root/Brain/CLAUDE.md && grep -q "BREAKING CHANGE" /root/Brain/CLAUDE.md && grep -q "kebab-case" /root/Brain/CLAUDE.md && grep -q "💥" /root/Brain/CLAUDE.md && grep -q "A new feature" /root/Brain/CLAUDE.md && grep -q "validate JWT tokens before processing requests" /root/Brain/CLAUDE.md && echo PASS</automated>
  </verify>
  <done>CLAUDE.md's Git Commit Guidelines section contains the original table/examples unchanged, plus four new subsections (Scope, Breaking Changes, Title and Body Formatting, Commit Message Language) inserted before "### Important Rules". No other section of CLAUDE.md is modified. No build/tooling files touched.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|--------------|
| N/A | Documentation-only change to CLAUDE.md; no code execution, no input parsing, no trust boundary crossed |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|--------------|------------------|
| T-quick260630-01 | N/A | CLAUDE.md | accept | Documentation-only change; no executable code, no external input, no attack surface introduced |
</threat_model>

<verification>
1. `grep -n "^## Git Commit Guidelines"` confirms section header still present and is still the first content in the file.
2. `grep -n "### "` within the section confirms subsection order: Commit Message Format, Types with Emojis, Examples, Scope, Breaking Changes, Title and Body Formatting, Commit Message Language, Important Rules.
3. Diff the rest of CLAUDE.md (from `<!-- GSD:project-start -->` onward) against git history to confirm zero changes outside the Git Commit Guidelines section: `git diff CLAUDE.md` should show only additions within the guidelines section, no deletions of the emoji table or examples, no changes after line ~62 (pre-edit numbering).
4. Confirm no `package.json`, `husky`, or `commitlint` files were created or modified: `git status --short` should show only `CLAUDE.md` as modified.
</verification>

<success_criteria>
- CLAUDE.md's Git Commit Guidelines section now documents: scope format, breaking change convention (💥 emoji + `!`/footer), title/body formatting rules, and commit message language convention.
- The existing emoji-per-type table (12 rows) and existing examples block remain word-for-word identical to before the edit.
- `git status --short` shows only `CLAUDE.md` modified — no tooling, package.json, or config files touched.
- The language rule documented matches verified repo convention (English titles), not an assumption.
</success_criteria>

<output>
After completion, create `.planning/quick/260630-ssd-melhorar-a-secao-git-commit-guidelines-d/260630-ssd-SUMMARY.md`
</output>
