"""
Text Engine Manager - Text processing engine management

Manages text processing engine servers as separate processes.
Inherits common process management from BaseEngineManager.

This is the Text-specific implementation that handles:
- Text segmentation (segment_with_engine)
- Text processing operations (future: normalization, transformation, etc.)

Architecture:
    TextEngineManager (extends BaseEngineManager)
    ├── Text Segmentation (segment_with_engine)
    ├── Text Processing (future extensions)
    └── Language-Aware Processing

Usage:
    from backend.core.text_engine_manager import get_text_engine_manager

    manager = get_text_engine_manager()

    # Ensure engine is ready
    await manager.ensure_engine_ready('spacy', 'default')

    # Segment text via HTTP
    segments = await manager.segment_with_engine(
        'spacy',
        text='This is a long text to segment. It has multiple sentences.',
        language='en',
        parameters={'max_length': 500}  # Flattened into payload root
    )

Author: Multi-Engine Architecture Refactoring
Date: 2025-11-23
"""

from pathlib import Path
from typing import Dict, List, Optional, Any
import httpx
from loguru import logger

from core.base_engine_manager import BaseEngineManager
from core.text_engine_discovery import TextEngineDiscovery
from core.engine_exceptions import EngineClientError, EngineLoadingError, EngineServerError


class TextEngineManager(BaseEngineManager):
    """
    Text Engine Manager - Manages text processing engine servers

    Extends BaseEngineManager with text-specific functionality:
    - Text segmentation via HTTP (segment_with_engine)
    - Language-aware text processing
    - Future: Normalization, transformation, etc.

    Features:
    - Automatic engine discovery from engines/text_processing/ directory
    - Process lifecycle management (start/stop servers)
    - HTTP client for engine communication
    - Health monitoring and auto-recovery

    Attributes:
        Inherited from BaseEngineManager:
        - engine_type: 'text'
        - engines_base_path: Path to engines/text_processing/ subdirectory
        - engine_endpoints: Running engine endpoints (subprocess and Docker)
        - engine_ports: Assigned ports
        - active_engine: Currently loaded engine
        - http_client: Async HTTP client
    """

    def __init__(self):
        """
        Initialize Text Engine Manager

        Note: Use get_text_engine_manager() instead of direct instantiation
        to ensure singleton pattern.
        """
        from config import BACKEND_ROOT

        # Text engines are in engines/text_processing/ subdirectory
        engines_base_path = Path(BACKEND_ROOT) / 'engines' / 'text_processing'
        super().__init__(engines_base_path=engines_base_path, engine_type='text')

    def discover_local_engines(self) -> Dict[str, Dict[str, Any]]:
        """
        Discover text processing engines from engines/text_processing/ directory

        Uses TextEngineDiscovery to scan for engine servers.
        Returns discovered engine metadata directly.

        Returns:
            Dictionary mapping engine_name -> engine_metadata
        """
        try:
            discovery = TextEngineDiscovery(self.engines_base_path)
            discovered = discovery.discover_all()

            if not discovered:
                logger.info("No local text processing engines found (subprocess)")
            else:
                logger.debug(
                    f"Auto-discovered {len(discovered)} subprocess text processing engines: "
                    f"{list(discovered.keys())}"
                )
            return discovered
        except Exception as e:
            logger.error(f"Text engine discovery failed: {e}")
            return {}

    async def segment_with_engine(
        self,
        engine_name: str,
        text: str,
        language: str,
        parameters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Call text engine's /segment endpoint to segment text

        Args:
            engine_name: Engine identifier (e.g., 'spacy')
            text: Text to segment
            language: Language code (e.g., 'en', 'de')
            parameters: Engine-specific segmentation parameters (optional)

        Returns:
            List of segment dictionaries with metadata:
            - text: Segment text
            - start: Start position in original text
            - end: End position in original text
            - metadata: Additional metadata (sentence_type, etc.)

        Raises:
            RuntimeError: If engine not running or segmentation fails
        """
        base_url = self.get_engine_base_url(engine_name)
        if not base_url:
            raise RuntimeError(f"Text engine {engine_name} not running")

        url = f"{base_url}/segment"

        # Build payload with parameters flattened into root level
        # (SegmentRequest expects max_length, min_length etc. at root, not nested)
        payload = {
            "text": text,
            "language": language,
            **(parameters or {})  # Flatten parameters into payload root
        }

        logger.debug(f"Segmenting text with {engine_name}: {text[:50]}...")

        try:
            response = await self.http_client.post(url, json=payload)
            response.raise_for_status()
        except httpx.RequestError as e:
            raise EngineServerError(f"HTTP request to {engine_name} failed: {e}")
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            detail = e.response.text[:200]

            if status_code in (400, 404):
                raise EngineClientError(f"{engine_name} rejected request ({status_code}): {detail}")
            elif status_code == 503:
                raise EngineLoadingError(f"{engine_name} is loading: {detail}")
            else:
                raise EngineServerError(f"{engine_name} error ({status_code}): {detail}")

        try:
            segments = response.json()
        except ValueError as e:
            raise EngineServerError(f"Invalid JSON response from {engine_name}: {e}")

        logger.debug(f"Generated {len(segments)} segments")

        # Record activity for auto-stop tracking
        self.record_activity(engine_name)

        return segments


# ==================== Singleton Factory ====================

_text_engine_manager: Optional[TextEngineManager] = None


def get_text_engine_manager() -> TextEngineManager:
    """
    Get or create the global TextEngineManager singleton instance

    This is the recommended way to access the TextEngineManager.
    Ensures only one manager instance exists across the application.

    Returns:
        TextEngineManager singleton instance

    Example:
        from backend.core.text_engine_manager import get_text_engine_manager

        manager = get_text_engine_manager()
        engines = manager.list_available_engines()
    """
    global _text_engine_manager

    if _text_engine_manager is None:
        _text_engine_manager = TextEngineManager()

    return _text_engine_manager


async def reset_text_engine_manager() -> None:
    """
    Reset the TextEngineManager singleton (for testing)

    WARNING: This will stop all engines and reset the manager.
    Only use in test scenarios or explicit cleanup.
    """
    global _text_engine_manager

    if _text_engine_manager is not None:
        await _text_engine_manager.cleanup()
        _text_engine_manager = None
        logger.info("TextEngineManager singleton reset")
