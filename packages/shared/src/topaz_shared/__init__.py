"""Shared Pydantic contracts for Topaz CRM."""

from .auth import LinkSalespersonRequest
from .enrollment import EnrollmentRequest
from .recognition import EMBEDDING_DIMENSIONS, RecognitionEvent

__all__ = [
    "EMBEDDING_DIMENSIONS",
    "EnrollmentRequest",
    "LinkSalespersonRequest",
    "RecognitionEvent",
]
