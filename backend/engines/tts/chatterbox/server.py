"""
Chatterbox Multilingual TTS Engine Server

Supports 23 languages with high-quality voice cloning and multilingual TTS.
Based on Chatterbox by Resemble AI.
"""
from pathlib import Path
from typing import Dict, Any, Union, List
import sys
import io
import warnings
import logging  # Only for suppressing third-party library logs
import os
import gc
import numpy as np
import torch

# Suppress ALL warnings (library deprecations, FutureWarnings, etc.)
warnings.filterwarnings('ignore')

# Suppress transformers/diffusers specific warnings
os.environ['TRANSFORMERS_VERBOSITY'] = 'error'
os.environ['DIFFUSERS_VERBOSITY'] = 'error'

# Suppress chatterbox internal warnings (token repetition, alignment, etc.)
# NOTE: Using standard logging module ONLY for suppressing third-party library logs
logging.getLogger('chatterbox').setLevel(logging.ERROR)
logging.getLogger('chatterbox.models.t3.inference.alignment_stream_analyzer').setLevel(logging.ERROR)

# Suppress perth watermarker output
logging.getLogger('perth').setLevel(logging.ERROR)

# Add parent directory to path to import base_server
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from base_tts_server import BaseTTSServer, ModelInfo  # noqa: E402

# Import Chatterbox (after warnings/logging suppression)
import contextlib  # noqa: E402
import chatterbox  # noqa: E402
from chatterbox.mtl_tts import ChatterboxMultilingualTTS  # noqa: E402

# Chatterbox package version (for health endpoint)
CHATTERBOX_VERSION = getattr(chatterbox, '__version__', 'unknown')


def audio_to_wav_bytes(audio_array: np.ndarray, sample_rate: int) -> bytes:
    """Convert numpy audio array to WAV bytes"""
    import scipy.io.wavfile

    # Normalize audio to int16 range
    if audio_array.dtype == np.float32 or audio_array.dtype == np.float64:
        # Ensure audio is in [-1, 1] range
        audio_array = np.clip(audio_array, -1.0, 1.0)
        # Convert to int16
        audio_array = (audio_array * 32767).astype(np.int16)

    # Write to bytes buffer
    wav_buffer = io.BytesIO()
    scipy.io.wavfile.write(wav_buffer, sample_rate, audio_array)
    wav_buffer.seek(0)
    return wav_buffer.read()


class ChatterboxServer(BaseTTSServer):
    """Chatterbox Multilingual TTS Engine"""

    def __init__(self):
        # Engine state (before super().__init__)
        self.model = None

        super().__init__(
            engine_name="chatterbox",
            display_name="Chatterbox"
        )

        # Set device after super().__init__
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        from loguru import logger
        logger.info(f"[chatterbox] Running on device: {self.device}")

    # Chatterbox supported languages (23 languages)
    SUPPORTED_LANGUAGES = [
        "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja",
        "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"
    ]

    def get_available_models(self) -> List[ModelInfo]:
        """Return available Chatterbox models (only 'multilingual' supported)"""
        return [
            ModelInfo(
                name="multilingual",
                display_name="Multilingual (Pretrained)",
                languages=self.SUPPORTED_LANGUAGES
            )
        ]

    def load_model(self, model_name: str) -> None:
        """Load Chatterbox TTS model"""
        from loguru import logger

        # Validate model name (Chatterbox only supports 'multilingual' pretrained model)
        if model_name != "multilingual":
            raise ValueError(f"Unknown model '{model_name}'. Chatterbox only supports 'multilingual'")

        logger.info(f"[chatterbox] Loading Chatterbox Multilingual model on {self.device}...")

        # Suppress huggingface_hub download progress bar and PerthNet output
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.model = ChatterboxMultilingualTTS.from_pretrained(self.device)

        # Ensure model is on correct device
        if hasattr(self.model, 'to') and str(getattr(self.model, 'device', None)) != self.device:
            self.model.to(self.device)

        logger.info(f"[chatterbox] Model loaded successfully. Sample rate: {self.model.sr} Hz")

    def generate_audio(
        self,
        text: str,
        language: str,
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """Generate TTS audio using Chatterbox"""
        from loguru import logger

        if self.model is None:
            raise RuntimeError("Model not loaded")

        # Extract parameters with defaults
        exaggeration = parameters.get("exaggeration", 0.5)
        temperature = parameters.get("temperature", 0.8)
        cfg_weight = parameters.get("cfg_weight", 0.5)
        seed = parameters.get("seed", 0)

        # Set random seed if specified
        if seed != 0:
            torch.manual_seed(int(seed))
            if self.device == "cuda":
                torch.cuda.manual_seed(int(seed))
                torch.cuda.manual_seed_all(int(seed))
            import random
            random.seed(int(seed))
            np.random.seed(int(seed))

        logger.debug(f"[chatterbox] Generating: '{text[:50]}...' (lang={language})")

        # Prepare audio prompt (speaker_wav can be str or list)
        audio_prompt_path = None
        if speaker_wav:
            if isinstance(speaker_wav, list):
                audio_prompt_path = speaker_wav[0] if speaker_wav else None
            else:
                audio_prompt_path = speaker_wav if speaker_wav.strip() else None

        # Generate kwargs
        generate_kwargs = {
            "exaggeration": exaggeration,
            "temperature": temperature,
            "cfg_weight": cfg_weight,
        }

        if audio_prompt_path:
            generate_kwargs["audio_prompt_path"] = audio_prompt_path
            logger.debug(f"[chatterbox] Using audio prompt: {audio_prompt_path}")
        else:
            logger.debug("[chatterbox] No audio prompt (using default voice)")

        # Generate audio (limit to 300 characters as per Chatterbox recommendations)
        # Suppress progress bar and warnings during generation
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            wav_tensor = self.model.generate(
                text[:300],
                language_id=language,
                **generate_kwargs
            )

        # Convert tensor to numpy array
        wav_array = wav_tensor.squeeze(0).cpu().numpy()

        # Convert to WAV bytes
        wav_bytes = audio_to_wav_bytes(wav_array, self.model.sr)

        logger.debug(f"[chatterbox] Generated {len(wav_bytes)} bytes")
        return wav_bytes

    def unload_model(self) -> None:
        """Free resources"""
        from loguru import logger

        if self.model is not None:
            logger.info("[chatterbox] Unloading model...")
            # Explicit cleanup for GPU memory
            del self.model
            self.model = None
            if torch.cuda.is_available():
                torch.cuda.synchronize()
                torch.cuda.empty_cache()
            gc.collect()

    def get_package_version(self) -> str:
        """Return Chatterbox package version for health endpoint"""
        return CHATTERBOX_VERSION


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Chatterbox Multilingual Engine Server")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    server = ChatterboxServer()
    server.run(port=args.port, host=args.host)
