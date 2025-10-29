"""
XTTS Engine Implementation

Refactored from tts_service.py to implement the BaseTTSEngine interface.
Supports XTTS v2.0.x models with voice cloning capabilities.

Author: Multi-TTS Engine Architecture
Date: 2025-10-15
"""
import torch
import torchaudio
import time
import re
import functools
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from loguru import logger

from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts

from .base_tts_engine import BaseTTSEngine
from config import OUTPUT_DIR

try:
    torch.serialization.add_safe_globals([XttsConfig, Xtts])
    logger.info("Added XTTS classes to PyTorch safe globals")
except AttributeError:
    logger.info("PyTorch < 2.6 detected, safe_globals not needed")
except Exception as e:
    logger.warning(f"Could not add safe globals: {e}")


XTTS_LANGUAGES = [
    "ar",
    "pt",
    "zh-cn",
    "cs",
    "nl",
    "en",
    "fr",
    "de",
    "it",
    "pl",
    "ru",
    "es",
    "tr",
    "ja",
    "ko",
    "hu",
    "hi"
]


class XTTSEngine(BaseTTSEngine):
    """
    XTTS v2.0.x TTS Engine

    Features:
    - Cross-lingual text-to-speech with voice cloning
    - 17 supported languages
    - Speaker embeddings from 6+ second audio samples
    - Low VRAM mode (CPU/GPU switching)
    - Latent caching for performance
    """

    def __init__(
        self,
        model_version: str = "v2.0.2",
        device: str = "cuda",
        lowvram: bool = False,
        output_folder: str = OUTPUT_DIR,
        silent: bool = False,
        **kwargs
    ):
        """
        Initialize XTTS Engine

        Args:
            model_version: XTTS model version (v2.0.3, v2.0.2, etc.)
            device: Device to use (cuda or cpu)
            lowvram: Enable low VRAM mode (switches model between CPU/GPU)
            output_folder: Path for generated audio files
            silent: If True, suppress initialization logs (for metadata-only instances)
            **kwargs: Additional engine parameters
        """
        super().__init__(
            device=device,
            output_folder=output_folder,
            silent=silent
        )

        self.model_version = model_version
        self.lowvram = lowvram
        self.cuda = device

        cuda_available = torch.cuda.is_available()
        if not silent:
            if cuda_available:
                logger.info(f"CUDA is available! GPU: {torch.cuda.get_device_name(0)}")
                logger.info(f"CUDA version: {torch.version.cuda}")
            else:
                logger.warning("CUDA is NOT available. Running on CPU (this will be slow!)")
                logger.warning("To enable GPU acceleration:")
                logger.warning("1. Install NVIDIA drivers")
                logger.warning("2. Install PyTorch with CUDA support:")
                logger.warning("   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118")

        self.device = 'cpu' if lowvram else (
            self.cuda if cuda_available else "cpu"
        )

        if not silent:
            logger.info(f"XTTS Engine initialized on device: {self.device}")

        self.model: Optional[Xtts] = None

        self.latents_cache: Dict[str, tuple] = {}

    @classmethod
    def get_engine_name_static(cls) -> str:
        """Return engine identifier (class method)"""
        return "xtts"

    def get_engine_name(self) -> str:
        """Return engine identifier (instance method for compatibility)"""
        return self.get_engine_name_static()

    @classmethod
    def get_display_name_static(cls) -> str:
        """Return human-readable name (class method)"""
        return "XTTS"

    def get_display_name(self) -> str:
        """Return human-readable name (instance method for compatibility)"""
        return self.get_display_name_static()

    @classmethod
    def get_supported_languages_static(cls) -> List[str]:
        """Return list of supported languages (class method)"""
        return XTTS_LANGUAGES.copy()

    def get_supported_languages(self) -> List[str]:
        """Return list of supported languages (instance method for compatibility)"""
        return self.get_supported_languages_static()

    @classmethod
    def get_generation_constraints_static(cls) -> Dict[str, Any]:
        """
        Return XTTS-specific constraints (class method)

        XTTS has language-specific text length limits based on
        empirical testing for best quality.
        """
        return {
            'min_text_length': 10,
            'max_text_length': 250,
            'max_text_length_by_lang': {
                'de': 250,
                'en': 250,  
                'fr': 250,
                'es': 250,
                'it': 250,
                'pt': 250,
                'zh-cn': 250,
                'ja': 250,
                'ko': 250
            },
            'sample_rate': 24000,
            'audio_format': 'wav',
            'supports_streaming': False,
            'requires_punctuation': True
        }

    def get_generation_constraints(self) -> Dict[str, Any]:
        """Return XTTS-specific constraints (instance method for compatibility)"""
        return self.get_generation_constraints_static()

    @classmethod
    def get_default_parameters_static(cls) -> Dict[str, Any]:
        """Return default generation parameters (class method)"""
        return {
            'temperature': 0.75,
            'length_penalty': 1.0,
            'repetition_penalty': 5.0,
            'top_k': 50,
            'top_p': 0.85,
            'speed': 1.0
        }

    def get_default_parameters(self) -> Dict[str, Any]:
        """Return default generation parameters (instance method for compatibility)"""
        return self.get_default_parameters_static()

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
            'length_penalty': {
                'type': 'float',
                'default': 1.0,
                'min': 0.5,
                'max': 2.0,
                'step': 0.1,
                'label': 'settings.tts.lengthPenalty',
                'description': 'settings.tts.lengthPenaltyDesc',
                'category': 'advanced'
            },
            'repetition_penalty': {
                'type': 'float',
                'default': 5.0,
                'min': 1.0,
                'max': 10.0,
                'step': 0.5,
                'label': 'settings.tts.repetitionPenalty',
                'description': 'settings.tts.repetitionPenaltyDesc',
                'category': 'advanced'
            },
            'top_k': {
                'type': 'int',
                'default': 50,
                'min': 1,
                'max': 100,
                'step': 1,
                'label': 'settings.tts.topK',
                'description': 'settings.tts.topKDesc',
                'category': 'advanced'
            },
            'top_p': {
                'type': 'float',
                'default': 0.85,
                'min': 0.1,
                'max': 1.0,
                'step': 0.05,
                'label': 'settings.tts.topP',
                'description': 'settings.tts.topPDesc',
                'category': 'advanced'
            }
        }

    @classmethod
    def get_available_models_static(cls, models_base_path: Path) -> List[Dict[str, Any]]:
        """
        Get list of available XTTS models (class method)

        Scans backend/models/xtts/ for model directories.
        Each subdirectory is treated as a model (v2.0.2, v2.0.3, custom names, etc.)

        Args:
            models_base_path: Base path to models directory (e.g., backend/models/)

        Returns:
            List of model dictionaries with metadata
        """
        engine_models_path = models_base_path / 'xtts'
        models = []

        if not engine_models_path.exists():
            logger.warning(f"XTTS models directory not found: {engine_models_path}")
            return models

        for model_dir in engine_models_path.iterdir():
            if not model_dir.is_dir():
                continue

            config_file = model_dir / 'config.json'
            if not config_file.exists():
                logger.debug(f"Skipping {model_dir.name}: no config.json found")
                continue

            model_name = model_dir.name
            is_version = model_name.startswith('v') and any(c.isdigit() for c in model_name)

            display_name = f"XTTS {model_name} (Official)" if is_version else f"{model_name} (Custom)"

            try:
                size_bytes = sum(f.stat().st_size for f in model_dir.rglob('*') if f.is_file())
                size_mb = size_bytes / (1024 * 1024)
            except Exception as e:
                logger.debug(f"Could not calculate size for {model_name}: {e}")
                size_mb = 0

            models.append({
                'model_name': model_name,
                'display_name': display_name,
                'path': str(model_dir),
                'version': model_name if is_version else 'custom',
                'size_mb': round(size_mb, 2)
            })

        logger.info(f"Found {len(models)} XTTS models: {[m['model_name'] for m in models]}")
        return models

    def get_available_models(self, models_base_path: Path) -> List[Dict[str, Any]]:
        """Get list of available XTTS models (instance method for compatibility)"""
        return self.get_available_models_static(models_base_path)

    def load_model(self, model_path: Path) -> None:
        """
        Load XTTS model from disk

        Args:
            model_path: Path to models directory (e.g., models/v2.0.2/)

        Raises:
            FileNotFoundError: If model files not found
            RuntimeError: If model loading fails
        """
        if self.model_loaded:
            logger.info("XTTS model already loaded")
            return

        logger.info(f"Loading XTTS model {self.model_version}...")

        config_path = model_path / 'config.json'
        checkpoint_dir = model_path
        speaker_file = model_path / 'speakers_xtts.pth'

        if not config_path.exists():
            raise FileNotFoundError(
                f"Model config not found: {config_path}. "
                f"Please ensure XTTS model {self.model_version} is downloaded."
            )

        if not speaker_file.exists():
            logger.info("No speaker file found")
            speaker_file = None

        config = XttsConfig()
        config.load_json(str(config_path))

        self.model = Xtts.init_from_config(config)

        try:
            self.model.load_checkpoint(
                config,
                use_deepspeed=False,
                speaker_file_path=str(speaker_file) if speaker_file else None,
                checkpoint_dir=str(checkpoint_dir)
            )
        except Exception as e:
            if "weights_only" in str(e) or "WeightsUnpickler" in str(e):
                logger.warning("PyTorch 2.6+ weights_only error detected. Applying workaround...")
                original_load = torch.load

                @functools.wraps(original_load)
                def patched_load(*args, **kwargs):
                    kwargs['weights_only'] = False
                    return original_load(*args, **kwargs)

                torch.load = patched_load

                try:
                    self.model = Xtts.init_from_config(config)
                    self.model.load_checkpoint(
                        config,
                        use_deepspeed=False,
                        speaker_file_path=str(speaker_file) if speaker_file else None,
                        checkpoint_dir=str(checkpoint_dir)
                    )
                    logger.info("Successfully loaded model with weights_only=False workaround")
                finally:
                    torch.load = original_load
            else:
                raise

        self.model.to(self.device)
        self.model_loaded = True

        logger.info(f"XTTS model loaded successfully on {self.device}")


    def unload_model(self) -> None:
        """Unload model and free VRAM"""
        self.model = None
        self.model_loaded = False
        self.latents_cache.clear()

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        logger.info("XTTS model unloaded")


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
            language: Language code (de, en, etc.)
            speaker_name: Name of the speaker voice
            output_path: Path to save audio file
            **kwargs: Generation parameters (temperature, speed, etc.)

        Returns:
            Path to generated audio file

        Raises:
            RuntimeError: If model not loaded
            ValueError: If speaker not found or language not supported
        """
        if not self.model_loaded:
            raise RuntimeError("XTTS model not loaded. Call load_model() first.")

        if not self.validate_language(language):
            raise ValueError(
                f"Language '{language}' not supported by XTTS. "
                f"Supported: {', '.join(self.get_supported_languages())}"
            )

        speaker_wav = self.get_speaker_path(speaker_name)
        if speaker_wav is None:
            raise ValueError(f"Speaker '{speaker_name}' not found")

        clean_text = self._clean_text(text)

        params = self.get_default_parameters()
        params.update(kwargs)

        logger.info(
            f"[XTTS] Generating audio for '{clean_text[:50]}...' | "
            f"lang={language}, speaker={speaker_name}, "
            f"temperature={params['temperature']}, "
            f"length_penalty={params['length_penalty']}, "
            f"repetition_penalty={params['repetition_penalty']}, "
            f"top_k={params['top_k']}, "
            f"top_p={params['top_p']}, "
            f"speed={params['speed']}"
        )

        self._switch_model_device()

        start_time = time.time()

        gpt_cond_latent, speaker_embedding = self._get_or_create_latents(
            speaker_name, speaker_wav
        )

        out = self.model.inference(
            clean_text,
            language,
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
            temperature=params['temperature'],
            length_penalty=params['length_penalty'],
            repetition_penalty=params['repetition_penalty'],
            top_k=params['top_k'],
            top_p=params['top_p'],
            enable_text_splitting=False,
            speed=params['speed']
        )

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        torchaudio.save(
            str(output_path),
            torch.tensor(out["wav"]).unsqueeze(0),
            24000
        )

        elapsed_time = time.time() - start_time
        logger.info(f"Generated audio in {elapsed_time:.2f}s: {output_path}")

        self._switch_model_device()

        return str(output_path)


    def _clean_text(self, text: str) -> str:
        """
        Clean text for TTS generation

        Args:
            text: Input text

        Returns:
            Cleaned text
        """
        text = re.sub(r'[\*\r\n]', '', text)
        text = re.sub(r'"\s?(.*?)\s?"', r"'\1'", text)
        return text

    def _get_or_create_latents(
        self,
        speaker_name: str,
        speaker_wav: Union[str, List[str]]
    ) -> tuple:
        """
        Get or create latents for a speaker

        Args:
            speaker_name: Name of the speaker
            speaker_wav: Path(s) to speaker WAV file(s)

        Returns:
            Tuple of (gpt_cond_latent, speaker_embedding)
        """
        if speaker_name not in self.latents_cache:
            logger.info(f"Creating latents for speaker: {speaker_name}")
            gpt_cond_latent, speaker_embedding = self.model.get_conditioning_latents(
                speaker_wav
            )
            self.latents_cache[speaker_name] = (gpt_cond_latent, speaker_embedding)

        return self.latents_cache[speaker_name]

    def _create_latents_for_all(self):
        """Pre-create latents for all available speakers"""
        speakers = self.get_speakers()

        for speaker in speakers:
            self._get_or_create_latents(
                speaker['speaker_name'],
                speaker['speaker_wav']
            )

        logger.info(f"Latents pre-created for {len(speakers)} speakers")

    def _switch_model_device(self):
        """Switch model between CPU and GPU (for lowvram mode)"""
        if self.lowvram and torch.cuda.is_available() and self.cuda != "cpu":
            with torch.no_grad():
                if self.device == self.cuda:
                    self.device = "cpu"
                else:
                    self.device = self.cuda

                self.model.to(self.device)

            if self.device == 'cpu':
                torch.cuda.empty_cache()
                logger.debug("Switched model to CPU, VRAM cleared")
            else:
                logger.debug("Switched model to GPU")



_xtts_engine: Optional[XTTSEngine] = None


def get_xtts_engine(
    model_version: str = "v2.0.2",
    device: str = "cuda",
    lowvram: bool = False,
    output_folder: str = OUTPUT_DIR
) -> XTTSEngine:
    """
    Get or create global XTTS engine instance

    Args:
        model_version: XTTS model version
        device: Device to use
        lowvram: Enable low VRAM mode
        output_folder: Path for output

    Returns:
        XTTSEngine instance
    """
    global _xtts_engine

    if _xtts_engine is None:
        _xtts_engine = XTTSEngine(
            model_version=model_version,
            device=device,
            lowvram=lowvram,
            output_folder=output_folder
        )

    return _xtts_engine
