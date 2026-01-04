"""
Application Exception Classes

Structured exceptions with error codes for i18n-compatible error handling.
All exceptions are automatically formatted for frontend translation.

Format: [ERROR_CODE]param1:value1;param2:value2

Usage:
    raise ApplicationError("IMPORT_NO_CHAPTERS", status_code=400,
        projectHeading="#",
        chapterHeading="##")

    # Produces: [IMPORT_NO_CHAPTERS]projectHeading:#;chapterHeading:##
"""
from typing import Optional


class ApplicationError(Exception):
    """
    Base exception for all application errors with structured error codes.

    Attributes:
        code: Error code matching frontend i18n key (e.g., "IMPORT_NO_CHAPTERS")
        status_code: HTTP status code (default: 400)
        params: Key-value parameters for i18n interpolation
    """

    def __init__(
        self,
        code: str,
        status_code: int = 400,
        message: Optional[str] = None,
        **params
    ):
        self.code = code
        self.status_code = status_code
        self.params = params
        self._message = message
        super().__init__(str(self))

    def __str__(self) -> str:
        if self.params:
            params_str = ";".join(f"{k}:{v}" for k, v in self.params.items())
            return f"[{self.code}]{params_str}"
        return f"[{self.code}]"

    @property
    def detail(self) -> str:
        """Alias for FastAPI HTTPException compatibility."""
        return str(self)
