"""
Segment Validation Service

Validates segment text length against engine constraints to prevent
generation failures due to text exceeding engine limits.
"""

from typing import Dict, Optional
from loguru import logger


class SegmentValidator:
    """
    Validates segments against engine constraints.

    Primary use cases:
    1. During markdown import (mark too-long segments as 'failed' immediately)
    2. Before TTS generation (skip too-long segments with clear error)
    """

    @staticmethod
    def validate_text_length(
        text: str,
        engine_name: str,
        language: str,
        constraints: Dict
    ) -> Dict[str, any]:
        """
        Validate segment text length against engine constraints.

        Args:
            text: Segment text to validate
            engine_name: TTS engine name (e.g., 'xtts')
            language: Language code (e.g., 'en', 'de')
            constraints: Engine constraints dict from engine.yaml
                Must contain: 'max_text_length' and optionally 'max_text_length_by_lang'

        Returns:
            Dict with validation result:
            {
                'is_valid': bool,
                'text_length': int,
                'max_length': int,
                'error_message': Optional[str]
            }

        Example:
            >>> from loguru import logger
            >>> constraints = {'max_text_length': 250, 'max_text_length_by_lang': {'de': 300}}
            >>> result = SegmentValidator.validate_text_length(
            ...     "Long text...",
            ...     "xtts",
            ...     "de",
            ...     constraints
            ... )
            >>> if not result['is_valid']:
            ...     logger.error(result['error_message'])
        """
        text_length = len(text)

        # Get max length for this language
        # Priority: language-specific > default
        max_length_by_lang = constraints.get('max_text_length_by_lang') or {}
        max_length = max_length_by_lang.get(language, constraints.get('max_text_length', 500))

        is_valid = text_length <= max_length

        error_message = None
        if not is_valid:
            error_message = (
                f"Text length {text_length} exceeds max_text_length {max_length} "
                f"for engine '{engine_name}' (language: {language}). "
                f"Edit segment to shorten text or switch to engine with higher limit."
            )

        return {
            'is_valid': is_valid,
            'text_length': text_length,
            'max_length': max_length,
            'error_message': error_message
        }

    @staticmethod
    def get_engine_constraints(engine_manager, engine_name: str) -> Optional[Dict]:
        """
        Get engine constraints from engine manager.

        Args:
            engine_manager: EngineManager instance
            engine_name: Engine name (e.g., 'xtts')

        Returns:
            Constraints dict or None if engine not found
        """
        try:
            engine_info = engine_manager.get_engine_info(engine_name)
            if engine_info and len(engine_info) > 0:
                return engine_info[0].get('constraints') or {}
            return None
        except Exception as e:
            logger.error(f"Failed to get constraints for engine '{engine_name}': {e}")
            return None
