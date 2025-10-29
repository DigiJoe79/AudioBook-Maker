"""
Abstract Base Class for TTS Engines

This module defines the interface that all TTS engines must implement.
Enables pluggable TTS backends (XTTS, Dummy, and future engines).
See ROADMAP.md for planned integrations.

Architecture:
    BaseTTSEngine (ABC)
    ├── XTTSEngine
    ├── DummyEngine
    └── Future engines...

Usage:
    from backend.services.base_tts_engine import BaseTTSEngine

    class MyEngine(BaseTTSEngine):
        def get_engine_name(self) -> str:
            return "my_engine"
"""
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional, Union
from pathlib import Path
from loguru import logger

from config import OUTPUT_DIR


class BaseTTSEngine(ABC):
    """
    Abstract base class for Text-to-Speech engines

    All TTS engines must inherit from this class and implement
    the required abstract methods.

    Attributes:
        device (str): Device to use ('cuda' or 'cpu')
        output_folder (Path): Path for generated audio files
        model_loaded (bool): Whether model is loaded in memory
    """

    def __init__(
        self,
        device: str = "cuda",
        output_folder: str = OUTPUT_DIR,
        silent: bool = False,
        **kwargs
    ):
        """
        Initialize TTS engine

        Args:
            device: Device to use ('cuda' or 'cpu')
            output_folder: Path for output audio files
            silent: If True, suppress initialization logs (for metadata-only instances)
            **kwargs: Engine-specific parameters
        """
        self.device = device
        self.output_folder = Path(output_folder)
        self.model_loaded = False
        self.silent = silent

        self._ensure_directories()

        if not silent:
            logger.info(
                f"Initialized {self.get_engine_name()} engine "
                f"(device={device})"
            )

    def _ensure_directories(self) -> None:
        """Create necessary directories"""
        self.output_folder.mkdir(parents=True, exist_ok=True)

    @classmethod
    @abstractmethod
    def get_engine_name_static(cls) -> str:
        """
        Return unique engine identifier (class method for metadata queries)

        Returns:
            Engine name (e.g., 'xtts', 'dummy')
        """
        pass

    def get_engine_name(self) -> str:
        """
        Return unique engine identifier (instance method for compatibility)

        Returns:
            Engine name (e.g., 'xtts', 'dummy')
        """
        return self.get_engine_name_static()

    @classmethod
    @abstractmethod
    def get_display_name_static(cls) -> str:
        """
        Return human-readable engine name (class method for metadata queries)

        Returns:
            Display name (e.g., 'XTTS v2.0.2', 'Dummy TTS')
        """
        pass

    def get_display_name(self) -> str:
        """
        Return human-readable engine name (instance method for compatibility)

        Returns:
            Display name (e.g., 'XTTS v2.0.2', 'Dummy TTS')
        """
        return self.get_display_name_static()

    @classmethod
    @abstractmethod
    def get_supported_languages_static(cls) -> List[str]:
        """
        Return list of supported language codes (class method for metadata queries)

        Returns:
            List of ISO language codes (e.g., ['en', 'de', 'fr'])
        """
        pass

    def get_supported_languages(self) -> List[str]:
        """
        Return list of supported language codes (instance method for compatibility)

        Returns:
            List of ISO language codes (e.g., ['en', 'de', 'fr'])
        """
        return self.get_supported_languages_static()

    @abstractmethod
    def load_model(self, model_path: Path) -> None:
        """
        Load TTS model into memory

        Args:
            model_path: Path to model files

        Raises:
            FileNotFoundError: If model files not found
            RuntimeError: If model loading fails
        """
        pass

    @abstractmethod
    def unload_model(self) -> None:
        """
        Unload model and free resources

        Should free GPU/CPU memory and clear caches
        """
        pass


    @abstractmethod
    def generate(
        self,
        text: str,
        language: str,
        speaker_name: str,
        output_path: str,
        **kwargs
    ) -> str:
        """
        Generate TTS audio from text

        Args:
            text: Text to synthesize
            language: Language code (e.g., 'en', 'de')
            speaker_name: Name of speaker voice
            output_path: Path to save generated audio (WAV format)
            **kwargs: Engine-specific generation parameters

        Returns:
            Path to generated audio file

        Raises:
            ValueError: If language not supported or speaker not found
            RuntimeError: If model not loaded or generation fails
        """
        pass

    @classmethod
    @abstractmethod
    def get_default_parameters_static(cls) -> Dict[str, Any]:
        """
        Get default generation parameters for this engine (class method for metadata queries)

        Returns:
            Dictionary of parameter names and default values
            Example: {'temperature': 0.75, 'speed': 1.0}
        """
        pass

    def get_default_parameters(self) -> Dict[str, Any]:
        """
        Get default generation parameters for this engine (instance method for compatibility)

        Returns:
            Dictionary of parameter names and default values
            Example: {'temperature': 0.75, 'speed': 1.0}
        """
        return self.get_default_parameters_static()

    @classmethod
    @abstractmethod
    def get_parameter_schema_static(cls) -> Dict[str, Any]:
        """
        Return parameter schema with UI metadata for settings configuration

        This method provides comprehensive parameter definitions including UI hints,
        validation constraints, and i18n keys for the Settings dialog.

        Returns:
            Dictionary with parameter definitions including:
            - type: 'float', 'int', 'string', 'boolean', 'select'
            - default: Default value
            - min/max: For numeric types
            - step: For sliders
            - options: For select types
            - label: UI label (i18n key)
            - description: Help text (i18n key)
            - category: Parameter grouping (e.g., 'generation', 'advanced', 'limits')
            - readonly: If True, parameter cannot be changed by user

        Example:
            {
                'temperature': {
                    'type': 'float',
                    'default': 0.75,
                    'min': 0.1,
                    'max': 1.0,
                    'step': 0.05,
                    'label': 'settings.tts.temperature',
                    'description': 'settings.tts.temperatureDesc',
                    'category': 'generation'
                },
                'speed': {
                    'type': 'float',
                    'default': 1.0,
                    'min': 0.5,
                    'max': 2.0,
                    'step': 0.1,
                    'label': 'settings.tts.speed',
                    'description': 'settings.tts.speedDesc',
                    'category': 'generation'
                }
            }

        Note: Segment length limits are defined in get_generation_constraints(), not here.
        """
        pass

    def get_parameter_schema(self) -> Dict[str, Any]:
        """
        Get parameter schema with UI metadata (instance method for compatibility)

        Returns:
            Dictionary with parameter definitions
        """
        return self.get_parameter_schema_static()

    @classmethod
    @abstractmethod
    def get_available_models_static(cls, models_base_path: Path) -> List[Dict[str, Any]]:
        """
        Get list of available models for this engine (class method for metadata queries)

        Scans the engine's model directory and returns metadata about available models.
        Each engine can have multiple models (e.g., XTTS has v2.0.2, v2.0.3, custom models).

        Args:
            models_base_path: Base path to models directory (e.g., backend/models/)

        Returns:
            List of model dictionaries with format:
            [{
                'model_name': str,
                'display_name': str,
                'path': Path,
                'version': str,
                'description': str,
                'size_mb': float,
                'created_at': str,
            }]
        """
        pass

    def get_available_models(self, models_base_path: Path) -> List[Dict[str, Any]]:
        """
        Get list of available models for this engine (instance method for compatibility)

        Returns:
            List of model dictionaries
        """
        return self.get_available_models_static(models_base_path)

    @classmethod
    @abstractmethod
    def get_generation_constraints_static(cls) -> Dict[str, Any]:
        """
        Get engine-specific generation constraints and capabilities (class method for metadata queries)

        These constraints are critical for text segmentation and UI validation.
        The frontend uses these to segment text appropriately before generation.

        Returns:
            Dictionary with constraint information:
            {
                'min_text_length': int,
                'max_text_length': int,
                'max_text_length_by_lang': {
                    'en': 400,
                    'de': 250,
                    ...
                },
                'sample_rate': int,
                'audio_format': str,
                'supports_streaming': bool,
                'max_duration_seconds': float,
                'requires_punctuation': bool,
            }

        Example (XTTS):
            {
                'min_text_length': 10,
                'max_text_length': 250,
                'max_text_length_by_lang': {'de': 250, 'en': 400},
                'sample_rate': 24000,
                'audio_format': 'wav',
                'supports_streaming': False,
                'requires_punctuation': True
            }

        Example (Dummy):
            {
                'min_text_length': 1,
                'max_text_length': 10000,
                'sample_rate': 24000,
                'audio_format': 'wav',
                'supports_streaming': False,
                'requires_punctuation': False
            }
        """
        pass

    def get_generation_constraints(self) -> Dict[str, Any]:
        """
        Get engine-specific generation constraints and capabilities (instance method for compatibility)

        Returns:
            Dictionary with constraint information
        """
        return self.get_generation_constraints_static()

    def validate_language(self, language: str) -> bool:
        """
        Check if language is supported by this engine

        Args:
            language: Language code to validate

        Returns:
            True if supported, False otherwise
        """
        supported = self.get_supported_languages()
        return language.lower() in [lang.lower() for lang in supported]

    def get_speaker_path(self, speaker_name: str) -> Optional[Union[str, List[str]]]:
        """
        Get path(s) to speaker voice sample(s) from the speaker service

        Args:
            speaker_name: Name of the speaker

        Returns:
            Path to WAV file, list of paths for multi-sample, or None if not found
        """
        conn = None
        try:
            from services.speaker_service import SpeakerService
            from db.database import get_db_connection_simple

            conn = get_db_connection_simple()
            speaker_service = SpeakerService(conn)

            logger.debug(f"Looking for speaker: '{speaker_name}'")
            speaker = speaker_service.get_speaker_by_name(speaker_name)

            if not speaker:
                all_speakers = speaker_service.list_speakers()
                available_names = [s['name'] for s in all_speakers]
                logger.error(f"Speaker '{speaker_name}' not found. Available speakers: {available_names}")
                return None

            if speaker.get('samples'):
                sample_paths = []
                for sample in speaker['samples']:
                    sample_path = Path(sample['filePath'])
                    if sample_path.exists():
                        sample_paths.append(str(sample_path))
                    else:
                        logger.warning(f"Sample file not found: {sample_path}")

                if sample_paths:
                    logger.debug(f"Found {len(sample_paths)} sample(s) for speaker '{speaker_name}'")
                    return sample_paths[0] if len(sample_paths) == 1 else sample_paths
                else:
                    logger.error(f"Speaker '{speaker_name}' has no valid sample files")
            else:
                logger.error(f"Speaker '{speaker_name}' has no samples")

        except Exception as e:
            logger.error(f"Could not get speaker from speaker service: {e}")
        finally:
            if conn:
                conn.close()

        return None

    def get_max_text_length(self, language: Optional[str] = None) -> int:
        """
        Get maximum text length for a specific language

        Helper method to get the appropriate max length based on language.
        Falls back to general max_text_length if language-specific not available.

        Args:
            language: Language code (e.g., 'de', 'en') or None for default

        Returns:
            Maximum text length in characters
        """
        constraints = self.get_generation_constraints()

        if language and 'max_text_length_by_lang' in constraints:
            lang_specific = constraints['max_text_length_by_lang']
            if language in lang_specific:
                return lang_specific[language]

        return constraints['max_text_length']

    def get_min_text_length(self) -> int:
        """
        Get minimum text length

        Returns:
            Minimum text length in characters
        """
        return self.get_generation_constraints()['min_text_length']

    def validate_text_length(self, text: str, language: Optional[str] = None) -> bool:
        """
        Validate if text length is within engine constraints

        Args:
            text: Text to validate
            language: Language code for language-specific constraints

        Returns:
            True if text length is valid, False otherwise
        """
        length = len(text)
        min_length = self.get_min_text_length()
        max_length = self.get_max_text_length(language)

        return min_length <= length <= max_length

    def get_info(self) -> Dict[str, Any]:
        """
        Get comprehensive engine information

        Returns:
            Dictionary with engine metadata, including constraints
        """
        return {
            'name': self.get_engine_name(),
            'display_name': self.get_display_name(),
            'supported_languages': self.get_supported_languages(),
            'default_parameters': self.get_default_parameters(),
            'constraints': self.get_generation_constraints(),
            'model_loaded': self.model_loaded,
            'device': self.device
        }

    def __repr__(self) -> str:
        """String representation"""
        return (
            f"<{self.__class__.__name__} "
            f"engine={self.get_engine_name()} "
            f"loaded={self.model_loaded} "
            f"device={self.device}>"
        )
