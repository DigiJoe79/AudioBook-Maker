"""
XTTS Engine Server

Standalone FastAPI server for XTTS TTS engine.
Runs in separate VENV with XTTS-specific dependencies.
"""
from pathlib import Path
from typing import Dict, Any, Union, List, Optional
import torch
import torchaudio
from loguru import logger
from fastapi import HTTPException
import sys
import io

# Add parent directory to path to import base_server
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from base_tts_server import BaseTTSServer, ModelInfo

# XTTS imports
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts
import TTS
TTS_VERSION = getattr(TTS, '__version__', 'unknown')


class XTTSServer(BaseTTSServer):
    """XTTS TTS Engine Server"""

    def __init__(self):
        # XTTS-specific state (before super().__init__ which logs)
        self.model: Optional[Xtts] = None
        self.latents_cache: Dict[str, tuple] = {}
        self.models_base_path = Path(__file__).parent / "models"

        super().__init__(
            engine_name="xtts",
            display_name="XTTS v2"
        )

        # Set device after super().__init__
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    # XTTS v2 supported languages (all models support these)
    SUPPORTED_LANGUAGES = [
        "ar", "pt", "zh-cn", "cs", "nl", "en", "fr", "de",
        "it", "pl", "ru", "es", "tr", "ja", "ko", "hu", "hi"
    ]

    def get_available_models(self) -> List[ModelInfo]:
        """Return available XTTS models from models/ directory"""
        models = []

        if not self.models_base_path.exists():
            return models

        for model_dir in self.models_base_path.iterdir():
            if not model_dir.is_dir():
                continue

            # Check if it looks like a valid XTTS model (has config.json)
            config_path = model_dir / "config.json"
            if not config_path.exists():
                continue

            models.append(ModelInfo(
                name=model_dir.name,
                display_name=model_dir.name.replace("_", " ").title(),
                languages=self.SUPPORTED_LANGUAGES  # All XTTS models are multilingual
            ))

        return models

    def load_model(self, model_name: str) -> None:
        """Load XTTS model into memory"""
        model_path = self.models_base_path / model_name

        if not model_path.exists():
            raise FileNotFoundError(f"Model not found: {model_path}")

        config_path = model_path / "config.json"
        if not config_path.exists():
            raise FileNotFoundError(f"Config not found: {config_path}")

        # Load config
        config = XttsConfig()
        config.load_json(str(config_path))

        # Initialize model
        self.model = Xtts.init_from_config(config)

        # Load checkpoint
        self.model.load_checkpoint(
            config,
            use_deepspeed=False,
            checkpoint_dir=str(model_path)
        )

        # Move to device
        self.model.to(self.device)

        # Clear latents cache (new model = new latents)
        self.latents_cache.clear()

    def generate_audio(
        self,
        text: str,
        language: str,
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """Generate TTS audio with XTTS"""
        if not self.model:
            raise RuntimeError("Model not loaded")

        # Get or create latents for speaker
        speaker_key = speaker_wav if isinstance(speaker_wav, str) else str(speaker_wav)

        if speaker_key not in self.latents_cache:
            try:
                gpt_cond_latent, speaker_embedding = self.model.get_conditioning_latents(
                    speaker_wav
                )
                self.latents_cache[speaker_key] = (gpt_cond_latent, speaker_embedding)
            except Exception as e:
                logger.error(f"Failed to create latents for speaker {speaker_wav}: {e}")
                raise RuntimeError(f"Failed to create speaker latents: {e}")

        gpt_cond_latent, speaker_embedding = self.latents_cache[speaker_key]

        # Extract parameters with defaults (explicit type conversion for safety)
        temperature = float(parameters.get('temperature', 0.75))
        speed = float(parameters.get('speed', 1.0))
        length_penalty = float(parameters.get('length_penalty', 1.0))
        repetition_penalty = float(parameters.get('repetition_penalty', 5.0))
        top_k = int(parameters.get('top_k', 50))
        top_p = float(parameters.get('top_p', 0.85))

        # Generate with CUDA OOM error handling
        try:
            out = self.model.inference(
                text,
                language,
                gpt_cond_latent=gpt_cond_latent,
                speaker_embedding=speaker_embedding,
                temperature=temperature,
                length_penalty=length_penalty,
                repetition_penalty=repetition_penalty,
                top_k=top_k,
                top_p=top_p,
                enable_text_splitting=False,
                speed=speed
            )
        except RuntimeError as e:
            error_msg = str(e).lower()
            if "out of memory" in error_msg or "cuda" in error_msg:
                logger.error(f"[{self.engine_name}] CUDA OOM during generation: {e}")
                # Try to recover GPU memory
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                raise HTTPException(
                    status_code=503,
                    detail="[TTS_GPU_OOM]GPU out of memory. Try shorter text or restart engine."
                )
            raise  # Re-raise other RuntimeErrors

        # Convert to WAV bytes
        buffer = io.BytesIO()
        torchaudio.save(
            buffer,
            torch.tensor(out["wav"]).unsqueeze(0),
            24000,
            format="wav"
        )

        return buffer.getvalue()

    def unload_model(self) -> None:
        """Unload model and free VRAM"""
        had_model = self.model is not None

        # 1. Clear latents cache with explicit tensor deletion
        if hasattr(self, 'latents_cache') and self.latents_cache:
            for key in list(self.latents_cache.keys()):
                latents = self.latents_cache.get(key)
                if latents is not None:
                    del latents
            self.latents_cache.clear()

        # 2. Explicitly delete model before setting to None
        if self.model is not None:
            del self.model
            self.model = None

        # 3. Force GPU memory cleanup
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()

        self.current_model = None

        if had_model:
            logger.info(f"[{self.engine_name}] Model unloaded and GPU memory cleared")

    def get_package_version(self) -> str:
        """Return TTS package version for health endpoint"""
        return TTS_VERSION


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="XTTS Engine Server")
    parser.add_argument("--port", type=int, required=True, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")

    args = parser.parse_args()

    server = XTTSServer()
    server.run(port=args.port, host=args.host)
