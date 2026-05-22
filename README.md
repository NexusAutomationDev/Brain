# Brain

Centralized LangGraph-based AI orchestration service for conversational bots.

Brain receives `{ botId, sessionId, conteudo }` payloads from bot frontends
(WhatsApp, Telegram, etc.) and returns coherent, persona-correct, memory-aware
replies — regardless of which LLM provider answers behind the scenes.

See `.planning/PROJECT.md` for the full project description and
`.planning/ROADMAP.md` for the delivery plan.

## Quick start

```bash
uv sync --group dev
uvx pre-commit install --install-hooks
```

`<REPLACE_ME>` placeholders in `.env.example` are intentionally allowlisted by
the gitleaks ruleset; replace them with real secrets in your local `.env`
(never committed).
