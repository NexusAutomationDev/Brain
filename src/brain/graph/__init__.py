"""LangGraph orchestration: StateGraph build + nodes + thread_id helper (Phases 1, 3, 6, 7).

Plan 01-04 (Phase 1) publishes only the `thread_id` helper; the StateGraph
build and nodes land in later phases.
"""
from brain.graph.thread import thread_id

__all__ = ["thread_id"]
