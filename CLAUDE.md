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