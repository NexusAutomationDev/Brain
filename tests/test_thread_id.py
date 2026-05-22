"""Tests for `brain.graph.thread.thread_id` (FOUND-08 / D-17 / PITFALL 10.1).

The helper is the ONLY sanctioned way to construct a LangGraph thread_id.
Bare `f"{bot}:{session}"` construction is forbidden and enforced by
`scripts/lint/ban-raw-thread-id.sh` (see `tests/test_lint_bans.py`).
"""

from __future__ import annotations

import pytest


def test_happy_path() -> None:
    from brain.graph.thread import thread_id

    assert thread_id("wa-vendas", "session-42") == "wa-vendas:session-42"


def test_empty_bot_id_raises() -> None:
    from brain.graph.thread import thread_id

    with pytest.raises(ValueError):
        thread_id("", "x")


def test_empty_session_id_raises() -> None:
    from brain.graph.thread import thread_id

    with pytest.raises(ValueError):
        thread_id("x", "")


def test_separator_in_bot_id_raises() -> None:
    from brain.graph.thread import thread_id

    with pytest.raises(ValueError) as exc:
        thread_id("a:b", "c")
    assert ":" in str(exc.value)


def test_separator_in_session_id_raises() -> None:
    from brain.graph.thread import thread_id

    with pytest.raises(ValueError) as exc:
        thread_id("a", "b:c")
    assert ":" in str(exc.value)


def test_round_trip_is_string() -> None:
    from brain.graph.thread import thread_id

    result = thread_id("bot", "session")
    assert isinstance(result, str)


def test_reexported_from_package() -> None:
    """`brain.graph.__init__` must re-export the helper."""
    from brain.graph import thread_id as thread_id_from_pkg
    from brain.graph.thread import thread_id

    assert thread_id_from_pkg is thread_id
