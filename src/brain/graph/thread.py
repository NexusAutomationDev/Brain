"""LangGraph thread_id helper.

CRITICAL: `thread_id` must ALWAYS combine bot_id and session_id (PITFALL 10.1).
Bare session_id collides across bots and leaks conversation history.
This module is the ONLY sanctioned way to construct a thread_id; the lint
hook `scripts/lint/ban-raw-thread-id.sh` rejects raw f-string construction
of the canonical `f"{bot}:{session}"` pattern anywhere else under
`src/brain/`.
"""
from __future__ import annotations

_SEP = ":"


def thread_id(bot_id: str, session_id: str) -> str:
    """Return the canonical LangGraph thread_id for a (bot, session) pair.

    Args:
        bot_id: opaque bot identifier (e.g., "wa-vendas").
        session_id: opaque session identifier (e.g., user phone or chat id).

    Returns:
        f"{bot_id}:{session_id}" — used verbatim as the LangGraph thread_id
        and as the lock-registry key (Phase 6).

    Raises:
        ValueError: if either argument is empty or contains the separator.
    """
    if not bot_id or not session_id:
        raise ValueError("bot_id and session_id must both be non-empty")
    if _SEP in bot_id or _SEP in session_id:
        raise ValueError(f"bot_id and session_id must not contain {_SEP!r}")
    return f"{bot_id}{_SEP}{session_id}"
