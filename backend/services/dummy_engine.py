"""
Dummy TTS Engine Implementation

A test engine for frontend development that doesn't require GPU or real TTS models.
Instead of generating audio, it copies a template WAV file for each segment.

Perfect for:
- Frontend development without GPU
- Testing UI/UX features
- Fast iteration cycles
- CI/CD testing

Author: Audiobook Maker
Date: 2025-10-18
"""
import shutil
import time
from pathlib import Path
from typing import Dict, List, Any
from loguru import logger

from .base_tts_engine import BaseTTSEngine
from config import DUMMY_TEMPLATE_AUDIO, OUTPUT_DIR


DUMMY_LANGUAGES = [
    "en", "fr", "de", "it", "hi"
]


class DummyEngine(BaseTTSEngine):
    """
    Dummy TTS Engine for frontend development

    Features:
    - No GPU required
    - Instant "generation" (file copy)
    - Supports all languages
    - Uses template WAV file
    - Full BaseTTSEngine compliance
    """

    def __init__(
        self,
        device: str = "cpu",
        output_folder: str = OUTPUT_DIR,
        silent: bool = False,
        template_audio: str = DUMMY_TEMPLATE_AUDIO,
        **kwargs
    ):
        """
        Initialize Dummy Engine

        Args:
            device: Ignored (always uses CPU)
            output_folder: Path for generated audio files
            silent: If True, suppress initialization logs
            template_audio: Path to template WAV file to copy
            **kwargs: Additional parameters (ignored)
        """
        super().__init__(
            device="cpu",
            output_folder=output_folder,
            silent=silent
        )

        self.template_audio = Path(template_audio)
        self.model_version = "dummy"

        self.template_audio.parent.mkdir(parents=True, exist_ok=True)

        if not silent:
            logger.info(
                f"[Dummy Engine] Initialized (template: {self.template_audio})"
            )


    @classmethod
    def get_engine_name_static(cls) -> str:
        """Return engine identifier"""
        return "dummy"

    @classmethod
    def get_display_name_static(cls) -> str:
        """Return human-readable name"""
        return "Dummy TTS (DEV)"

    @classmethod
    def get_supported_languages_static(cls) -> List[str]:
        """Return supported languages (all!)"""
        return DUMMY_LANGUAGES

    @classmethod
    def get_default_parameters_static(cls) -> Dict[str, Any]:
        """Return default generation parameters"""
        return {
            "temperature": 0.75,
            "speed": 1.0,
            "simulate_delay": 0.5
        }

    @classmethod
    def get_parameter_schema_static(cls) -> Dict[str, Any]:
        """Return parameter schema with UI metadata for settings configuration"""
        return {
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
            },
            'simulate_delay': {
                'type': 'float',
                'default': 0.5,
                'min': 0.0,
                'max': 5.0,
                'step': 0.1,
                'label': 'settings.tts.simulateDelay',
                'description': 'settings.tts.simulateDelayDesc',
                'category': 'generation'
            }
        }

    @classmethod
    def get_generation_constraints_static(cls) -> Dict[str, Any]:
        """
        Return generation constraints

        Dummy engine is very permissive for testing
        """
        return {
            "min_text_length": 5,
            "max_text_length": 1500,
            "sample_rate": 24000,
            "audio_format": "wav",
            "supports_streaming": False,
            "requires_punctuation": False
        }

    @classmethod
    def get_available_models_static(cls, models_base_path: Path) -> List[Dict[str, Any]]:
        """
        Return available dummy models

        Dummy engine only has one "model": dummy
        """
        engine_path = models_base_path / "dummy"

        return [
            {
                "model_name": "dummy",
                "display_name": "Dummy Model",
                "path": str(engine_path / "dummy"),
                "version": "1.0.0",
                "description": "Test model for frontend development",
                "size_mb": 0.0,
                "created_at": "2025-10-18"
            }
        ]


    def load_model(self, model_path: Path) -> None:
        """
        Load dummy model (no-op)

        Args:
            model_path: Ignored (no actual model, accepts any path)

        Note:
            Dummy engine doesn't need real model files.
            This method always succeeds regardless of model_path.
        """
        if not self.silent:
            logger.info(f"[Dummy Engine] Loading model from {model_path}...")
            logger.info("[Dummy Engine] (Dummy engine ignores model path - using template audio)")
            time.sleep(0.2)
            logger.success("[Dummy Engine] Model loaded successfully")

        self.model_loaded = True

    def unload_model(self) -> None:
        """Unload dummy model (no-op)"""
        if not self.silent:
            logger.info("[Dummy Engine] Unloading model...")

        self.model_loaded = False


    def generate(
        self,
        text: str,
        language: str,
        speaker_name: str,
        output_path: str,
        **kwargs
    ) -> str:
        """
        Generate dummy audio by copying template file

        Args:
            text: Text to "synthesize" (logged but not used)
            language: Language code (validated but not used)
            speaker_name: Speaker name (validated but not used)
            output_path: Path to save generated audio
            **kwargs: Additional parameters (simulate_delay, etc.)

        Returns:
            Path to generated audio file

        Raises:
            ValueError: If language not supported or speaker not found
            RuntimeError: If model not loaded or template file missing
        """
        if not self.model_loaded:
            raise RuntimeError("[Dummy Engine] Model not loaded. Call load_model() first.")

        if language not in self.get_supported_languages():
            raise ValueError(f"[Dummy Engine] Language '{language}' not supported")

        speaker_path = self.get_speaker_path(speaker_name)
        if not speaker_path:
            raise ValueError(f"[Dummy Engine] Speaker '{speaker_name}' not found")

        if not self.template_audio.exists():
            raise RuntimeError(
                f"[Dummy Engine] Template audio not found: {self.template_audio}\n"
                f"Please place a WAV file at this location for dummy generation."
            )

        simulate_delay = kwargs.get("simulate_delay", 0.5)
        if simulate_delay > 0:
            if not self.silent:
                logger.info(
                    f"[Dummy Engine] Generating audio for '{text[:50]}...' | "
                    f"lang={language}, speaker={speaker_name}, "
                    f"temperature={kwargs.get('temperature', 0.75)}, "
                    f"speed={kwargs.get('speed', 1.0)}, "
                    f"simulate_delay={simulate_delay}s"
                )
            time.sleep(simulate_delay)

        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        shutil.copy2(self.template_audio, output_file)

        if not self.silent:
            logger.success(f"[Dummy Engine] Generated: {output_file}")

        return str(output_file)

    def __repr__(self) -> str:
        """String representation"""
        return (
            f"<DummyEngine "
            f"template={self.template_audio} "
            f"loaded={self.model_loaded}>"
        )
