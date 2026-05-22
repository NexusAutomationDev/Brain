"""Langfuse callback handler, masking, circuit breaker (Phase 4).

Plan 01-04 (Phase 1) adds the structlog wiring published below; the Langfuse
surface lands in Phase 4.
"""
from brain.observability.logging import configure_logging, get_logger

__all__ = ["configure_logging", "get_logger"]
