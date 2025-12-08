"""
Kani TTS Engine Server

German-only TTS engine based on LiquidAI's LFM2 backbone and NVIDIA NanoCodec.
Supports two built-in speakers: "bert" and "thorsten".

Note: This engine does NOT support external speaker cloning.
Speaker selection is done via the speaker_id parameter.
"""
from pathlib import Path
from typing import Dict, Any, Union, List
import sys
import io
import warnings
import os
import gc

# Suppress warnings
warnings.filterwarnings('ignore')
os.environ['TRANSFORMERS_VERBOSITY'] = 'error'

# Add parent directory to path to import base_server
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from base_tts_server import BaseTTSServer, ModelInfo  # noqa: E402


def audio_to_wav_bytes(audio_array, sample_rate: int) -> bytes:
    """Convert audio array to WAV bytes"""
    import scipy.io.wavfile
    import numpy as np

    # Convert to numpy if needed
    if hasattr(audio_array, 'numpy'):
        audio_array = audio_array.numpy()

    # Ensure numpy array
    audio_array = np.asarray(audio_array)

    # Handle multi-dimensional arrays
    if audio_array.ndim > 1:
        audio_array = audio_array.squeeze()

    # Normalize audio to int16 range
    if audio_array.dtype in (np.float32, np.float64):
        # Ensure audio is in [-1, 1] range
        audio_array = np.clip(audio_array, -1.0, 1.0)
        # Convert to int16
        audio_array = (audio_array * 32767).astype(np.int16)

    # Write to bytes buffer
    wav_buffer = io.BytesIO()
    scipy.io.wavfile.write(wav_buffer, sample_rate, audio_array)
    wav_buffer.seek(0)
    return wav_buffer.read()


class KaniServer(BaseTTSServer):
    """Kani TTS Engine - German TTS with built-in speakers"""

    # HuggingFace model ID
    MODEL_ID = "nineninesix/kani-tts-400m-de"

    # Output sample rate
    SAMPLE_RATE = 22000

    # Built-in speakers
    SPEAKERS = ["bert", "thorsten"]

    def __init__(self):
        # Engine state (before super().__init__)
        self.model = None
        self._kani_version = None

        super().__init__(
            engine_name="kani",
            display_name="Kani TTS"
        )

        from loguru import logger
        logger.info("[kani] Kani TTS Engine initialized")

    def get_available_models(self) -> List[ModelInfo]:
        """Return available Kani models"""
        return [
            ModelInfo(
                name="400m-de",
                display_name="Kani 400M German",
                languages=["de"]
            )
        ]

    def load_model(self, model_name: str) -> None:
        """Load Kani TTS model from HuggingFace"""
        from loguru import logger

        # Validate model name
        if model_name != "400m-de":
            raise ValueError(f"Unknown model '{model_name}'. Kani only supports '400m-de'")

        logger.info(f"[kani] Loading Kani TTS model from {self.MODEL_ID}...")

        # Import kani_tts
        try:
            from kani_tts import KaniTTS
        except ImportError:
            raise ImportError(
                "kani-tts package not installed. "
                "Run: pip install kani-tts transformers==4.57.1"
            )

        # Get version
        try:
            import kani_tts
            self._kani_version = getattr(kani_tts, '__version__', 'unknown')
        except Exception:
            self._kani_version = 'unknown'

        # Load model
        self.model = KaniTTS(self.MODEL_ID)

        logger.info(f"[kani] Model loaded successfully (version: {self._kani_version})")

    def generate_audio(
        self,
        text: str,
        language: str,
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """
        Generate TTS audio using Kani TTS.

        Note: speaker_wav is ignored - Kani uses built-in speakers only.
        Use parameters['speaker_id'] to select 'bert' or 'thorsten'.
        """
        from loguru import logger

        if self.model is None:
            raise RuntimeError("Model not loaded")

        # Extract parameters with defaults
        temperature = parameters.get("temperature", 0.7)
        top_p = parameters.get("top_p", 0.9)
        max_tokens = parameters.get("max_tokens", 2000)
        repetition_penalty = parameters.get("repetition_penalty", 1.2)
        speaker_id = parameters.get("speaker_id", "thorsten")

        # Validate speaker_id
        if speaker_id not in self.SPEAKERS:
            logger.warning(f"[kani] Unknown speaker '{speaker_id}', using 'thorsten'")
            speaker_id = "thorsten"

        # Log if speaker_wav was provided (it will be ignored)
        if speaker_wav:
            logger.debug("[kani] Note: speaker_wav ignored - using built-in speaker")

        logger.debug(
            f"[kani] Generating: '{text[:50]}...' | "
            f"speaker={speaker_id} | temp={temperature} | top_p={top_p}"
        )

        # Generate audio
        # KaniTTS returns (audio, text) tuple
        audio, _ = self.model(
            text,
            speaker_id=speaker_id,
            temperature=temperature,
            top_p=top_p,
            max_new_tokens=max_tokens,
            repetition_penalty=repetition_penalty
        )

        # Convert to WAV bytes
        wav_bytes = audio_to_wav_bytes(audio, self.SAMPLE_RATE)

        logger.debug(f"[kani] Generated {len(wav_bytes)} bytes")
        return wav_bytes

    def unload_model(self) -> None:
        """Free resources"""
        from loguru import logger

        if self.model is not None:
            logger.info("[kani] Unloading model...")
            del self.model
            self.model = None

            # Try to free GPU memory if torch is available
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.synchronize()
                    torch.cuda.empty_cache()
            except ImportError:
                pass

            gc.collect()

    def get_package_version(self) -> str:
        """Return Kani TTS package version for health endpoint"""
        return self._kani_version or 'unknown'


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Kani TTS Engine Server")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    server = KaniServer()
    server.run(port=args.port, host=args.host)
