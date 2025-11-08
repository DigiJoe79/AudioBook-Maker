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
import sys
import io

# Add parent directory to path to import base_server
sys.path.insert(0, str(Path(__file__).parent.parent))
from base_server import BaseEngineServer

# XTTS imports
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts


class XTTSServer(BaseEngineServer):
    """XTTS TTS Engine Server"""

    def __init__(self):
        super().__init__(
            engine_name="xtts",
            display_name="XTTS v2"
        )

        # XTTS-specific state
        self.model: Optional[Xtts] = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.latents_cache: Dict[str, tuple] = {}
        self.models_base_path = Path(__file__).parent / "models"

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

        # Generate
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
        self.model = None
        self.latents_cache.clear()

        if torch.cuda.is_available():
            torch.cuda.empty_cache()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="XTTS Engine Server")
    parser.add_argument("--port", type=int, required=True, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")

    args = parser.parse_args()

    server = XTTSServer()
    server.run(port=args.port, host=args.host)
