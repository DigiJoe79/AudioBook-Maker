"""
VibeVoice TTS Engine Server

Microsoft VibeVoice - Expressive, long-form, multi-speaker conversational audio synthesis.
Supports VibeVoice-1.5B and VibeVoice-7B models with voice cloning.

Features:
- Voice cloning from audio samples (10-60 seconds recommended)
- Multi-speaker support (up to 4 speakers)
- Long-form audio generation (up to 90 min for 1.5B, 45 min for 7B)

Languages:
- Stable: English (en), Chinese (zh)
- Experimental: German (de), French (fr), Italian (it), Japanese (ja),
                Korean (ko), Dutch (nl), Polish (pl), Portuguese (pt), Spanish (es)

NOTE: Requires the vibevoice package from the community fork:
  pip install git+https://github.com/vibevoice-community/VibeVoice.git
"""
from pathlib import Path
from typing import Dict, Any, Union, List
import sys
import io
import warnings
import logging
import os
import gc
import numpy as np
import torch

# Suppress ALL warnings (library deprecations, FutureWarnings, etc.)
warnings.filterwarnings('ignore')

# Suppress transformers/diffusers specific warnings
os.environ['TRANSFORMERS_VERBOSITY'] = 'error'
os.environ['DIFFUSERS_VERBOSITY'] = 'error'

# Suppress potential VibeVoice internal warnings
logging.getLogger('vibevoice').setLevel(logging.ERROR)
logging.getLogger('transformers').setLevel(logging.ERROR)
logging.getLogger('diffusers').setLevel(logging.ERROR)

# Add parent directory to path to import base_server
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from base_tts_server import BaseTTSServer, ModelInfo  # noqa: E402


def normalize_audio(audio_array: np.ndarray, target_db: float = -3.0) -> np.ndarray:
    """Normalize audio to target dB level for consistent volume"""
    # Calculate current peak level
    peak = np.max(np.abs(audio_array))
    if peak < 1e-6:  # Silence
        return audio_array

    # Calculate target peak (in linear scale)
    target_peak = 10 ** (target_db / 20)

    # Apply gain
    gain = target_peak / peak
    normalized = audio_array * gain

    return normalized


def audio_to_wav_bytes(audio_array: np.ndarray, sample_rate: int, normalize: bool = True) -> bytes:
    """Convert numpy audio array to WAV bytes"""
    import scipy.io.wavfile

    # Normalize audio to int16 range
    if audio_array.dtype == np.float32 or audio_array.dtype == np.float64:
        # Normalize volume for consistency
        if normalize:
            audio_array = normalize_audio(audio_array, target_db=-3.0)

        # Ensure audio is in [-1, 1] range
        audio_array = np.clip(audio_array, -1.0, 1.0)
        # Convert to int16
        audio_array = (audio_array * 32767).astype(np.int16)

    # Write to bytes buffer
    wav_buffer = io.BytesIO()
    scipy.io.wavfile.write(wav_buffer, sample_rate, audio_array)
    wav_buffer.seek(0)
    return wav_buffer.read()


class VibeVoiceServer(BaseTTSServer):
    """VibeVoice TTS Engine - Microsoft's expressive multi-speaker TTS with voice cloning"""

    # Sample rate for VibeVoice output
    SAMPLE_RATE = 24000

    # Supported languages
    # Stable: en, zh
    # Experimental: de, fr, it, ja, ko, nl, pl, pt, es
    SUPPORTED_LANGUAGES = [
        "en", "zh",  # Stable
        "de", "fr", "it", "ja", "ko", "nl", "pl", "pt", "es"  # Experimental
    ]

    def __init__(self):
        # Engine state (before super().__init__)
        self.model = None
        self.processor = None

        super().__init__(
            engine_name="vibevoice",
            display_name="VibeVoice"
        )

        # Set device after super().__init__
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # Models directory (for downloaded models)
        self.models_dir = Path(__file__).parent / "models"
        self.models_dir.mkdir(exist_ok=True)

        from loguru import logger
        logger.info(f"[vibevoice] Running on device: {self.device}")
        logger.info(f"[vibevoice] Models directory: {self.models_dir}")

    def get_available_models(self) -> List[ModelInfo]:
        """Return available VibeVoice models (1.5B and 7B with voice cloning)"""
        return [
            ModelInfo(
                name="1.5B",
                display_name="VibeVoice 1.5B (~3GB VRAM)",
                languages=self.SUPPORTED_LANGUAGES,
                fields=[
                    {"key": "vram_gb", "value": 3, "field_type": "number"},
                    {"key": "max_audio_minutes", "value": 90, "field_type": "number"},
                    {"key": "parameters", "value": "1.5B", "field_type": "string"},
                    {"key": "voice_cloning", "value": True, "field_type": "boolean"},
                ]
            ),
            ModelInfo(
                name="7B",
                display_name="VibeVoice 7B (~18GB VRAM)",
                languages=self.SUPPORTED_LANGUAGES,
                fields=[
                    {"key": "vram_gb", "value": 18, "field_type": "number"},
                    {"key": "max_audio_minutes", "value": 45, "field_type": "number"},
                    {"key": "parameters", "value": "9B", "field_type": "string"},
                    {"key": "voice_cloning", "value": True, "field_type": "boolean"},
                ]
            )
        ]

    def load_model(self, model_name: str) -> None:
        """Load VibeVoice model (1.5B or 7B)"""
        from loguru import logger

        # Normalize model name (handle display names like "VibeVoice-1.5B" -> "1.5B")
        valid_models = ["1.5B", "7B"]
        normalized_name = model_name
        if model_name.startswith("VibeVoice-"):
            normalized_name = model_name.replace("VibeVoice-", "")

        if normalized_name not in valid_models:
            raise ValueError(f"Unknown model '{model_name}'. Valid models: {valid_models}")

        model_name = normalized_name

        # Map to HuggingFace model ID
        model_id = f"microsoft/VibeVoice-{model_name}"
        model_path = self.models_dir / f"VibeVoice-{model_name}"

        logger.info(f"[vibevoice] Loading {model_id} on {self.device}...")

        # Determine dtype based on device
        if self.device == "cuda":
            load_dtype = torch.bfloat16
        else:
            load_dtype = torch.float32

        try:
            # Import VibeVoice classes for 1.5B/7B models
            from vibevoice.modular import VibeVoiceForConditionalGenerationInference
            from vibevoice.processor import VibeVoiceProcessor

            # Download model if not present
            if not model_path.exists():
                logger.info(f"[vibevoice] Downloading model to {model_path}...")
                from huggingface_hub import snapshot_download
                snapshot_download(model_id, local_dir=str(model_path))

            logger.info(f"[vibevoice] Loading model with dtype={load_dtype}...")

            # Loading strategies to try in order
            # Note: device_map='cuda' works better than 'auto' for VibeVoice 7B
            # (avoids 'speech_bias_factor doesn't have any device set' error)
            load_configs = [
                # Strategy 1: Flash attention with device_map="cuda"
                {"attn_implementation": "flash_attention_2", "device_map": "cuda"},
                # Strategy 2: SDPA with device_map="cuda"
                {"attn_implementation": "sdpa", "device_map": "cuda"},
                # Strategy 3: SDPA with device_map=None (manual .to(device))
                {"attn_implementation": "sdpa", "device_map": None},
                # Strategy 4: Eager attention (fallback)
                {"attn_implementation": "eager", "device_map": None},
            ]

            last_error = None
            for config in load_configs:
                try:
                    logger.info(f"[vibevoice] Trying: attn={config['attn_implementation']}, device_map={config['device_map']}")
                    self.model = VibeVoiceForConditionalGenerationInference.from_pretrained(
                        str(model_path),
                        torch_dtype=load_dtype,
                        device_map=config["device_map"],
                        attn_implementation=config["attn_implementation"],
                    )
                    logger.info(f"[vibevoice] Successfully loaded with {config}")
                    break
                except Exception as e:
                    last_error = e
                    logger.warning(f"[vibevoice] Failed with {config}: {e}")
                    continue
            else:
                # All strategies failed
                raise RuntimeError(f"Failed to load model with any strategy. Last error: {last_error}")

            # Load processor
            self.processor = VibeVoiceProcessor.from_pretrained(str(model_path))

            # Set DDPM inference steps (10 is recommended for quality/speed balance)
            if hasattr(self.model, 'set_ddpm_inference_steps'):
                self.model.set_ddpm_inference_steps(num_steps=10)

            # Move to device if not using device_map
            if self.model.device.type == "meta" or (hasattr(self.model, 'hf_device_map') and not self.model.hf_device_map):
                logger.info(f"[vibevoice] Moving model to {self.device}...")
                self.model = self.model.to(self.device)
            elif self.device == "cuda" and hasattr(self.model, 'to') and not hasattr(self.model, 'hf_device_map'):
                self.model = self.model.to(self.device)

            logger.info(f"[vibevoice] Model {model_name} loaded successfully")

        except ImportError as e:
            logger.error(f"[vibevoice] VibeVoice package not installed: {e}")
            logger.error("[vibevoice] Install with: pip install git+https://github.com/vibevoice-community/VibeVoice.git")
            raise RuntimeError(
                "VibeVoice package not installed. "
                "Install with: pip install git+https://github.com/vibevoice-community/VibeVoice.git"
            )
        except Exception as e:
            logger.error(f"[vibevoice] Failed to load model: {e}")
            import traceback
            logger.error(traceback.format_exc())
            # Clean up on failure
            self.model = None
            self.processor = None
            raise

    def generate_audio(
        self,
        text: str,
        language: str,
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """Generate TTS audio using VibeVoice with voice cloning"""
        from loguru import logger
        from fastapi import HTTPException

        if self.model is None:
            raise RuntimeError("Model not loaded")

        # Extract parameters with defaults
        # cfg_scale: 1.3 is recommended (higher values like 2.0 can be "unhinged")
        # do_sample: False is recommended for stable, production-quality output
        cfg_scale = float(parameters.get("cfg_scale", 1.3))
        do_sample = bool(parameters.get("do_sample", False))  # Default: deterministic
        temperature = float(parameters.get("temperature", 0.95)) if do_sample else 1.0
        top_p = float(parameters.get("top_p", 0.95)) if do_sample else 1.0

        logger.debug(
            f"[vibevoice] Generating: '{text[:50]}...' "
            f"(lang={language}, cfg_scale={cfg_scale})"
        )

        try:
            # Prepare voice samples for cloning
            voice_samples = []
            if speaker_wav:
                # Handle single path or list of paths
                paths = speaker_wav if isinstance(speaker_wav, list) else [speaker_wav]
                for path in paths:
                    if path and path.strip() and Path(path).exists():
                        voice_samples.append(path)
                        logger.debug(f"[vibevoice] Using voice sample: {path}")

            if not voice_samples:
                logger.warning("[vibevoice] No voice samples provided, using default voice")

            # VibeVoice expects text in "Speaker X: text" format
            # Note: Newlines are already removed by SegmentRepository.create()
            formatted_text = f"Speaker 1: {text.strip()}"
            logger.info(f"[vibevoice] Formatted text ({len(formatted_text)} chars): {formatted_text[:200]}...")

            # Prepare inputs using processor
            # IMPORTANT: text must be a list, and voice_samples must be wrapped in a list
            inputs = self.processor(
                text=[formatted_text],  # Must be a list!
                voice_samples=[voice_samples] if voice_samples else None,
                padding=True,
                return_tensors="pt",
                return_attention_mask=True,
            )

            # Debug: log what the processor produced
            logger.info(f"[vibevoice] Processor output keys: {list(inputs.keys())}")
            for k, v in inputs.items():
                if isinstance(v, torch.Tensor):
                    logger.info(f"[vibevoice] {k}: shape={v.shape}, dtype={v.dtype}")
                else:
                    logger.info(f"[vibevoice] {k}: type={type(v).__name__}, len={len(v) if hasattr(v, '__len__') else 'N/A'}")

            # Separate tensor inputs from non-tensor metadata
            device = next(self.model.parameters()).device
            tensor_inputs = {}
            for k, v in inputs.items():
                if isinstance(v, torch.Tensor):
                    tensor_inputs[k] = v.to(device)
                else:
                    logger.debug(f"[vibevoice] Skipping non-tensor input: {k} (type: {type(v).__name__})")

            # Generate audio with voice cloning (is_prefill=True enables cloning)
            # max_new_tokens controls how much audio is generated
            # VibeVoice uses 7.5 Hz frame rate, so 7.5 tokens = 1 second of audio
            # Default to 4096 tokens (~9 minutes) to allow long-form generation
            max_tokens = int(parameters.get("max_new_tokens", 4096))

            with torch.no_grad():
                # Build generation config
                # Default: do_sample=False for stable, deterministic output
                gen_config = {'do_sample': do_sample}
                if do_sample:
                    gen_config['temperature'] = temperature
                    gen_config['top_p'] = top_p

                outputs = self.model.generate(
                    **tensor_inputs,
                    cfg_scale=cfg_scale,
                    tokenizer=self.processor.tokenizer,
                    max_new_tokens=max_tokens,
                    generation_config=gen_config,
                    verbose=True,
                    is_prefill=len(voice_samples) > 0,  # Enable voice cloning if samples provided
                )

            # Extract audio from outputs
            logger.info(f"[vibevoice] Output type: {type(outputs)}")
            # Try all ways to inspect the object
            if hasattr(outputs, '__dict__'):
                logger.info(f"[vibevoice] Output __dict__: {list(outputs.__dict__.keys())}")
            if hasattr(outputs, '__slots__'):
                logger.info(f"[vibevoice] Output __slots__: {outputs.__slots__}")
            # List all non-private attributes
            all_attrs = [a for a in dir(outputs) if not a.startswith('_')]
            logger.info(f"[vibevoice] Output public attrs: {all_attrs}")

            # Check if max step was reached (indicates truncation)
            if hasattr(outputs, 'reach_max_step_sample'):
                logger.info(f"[vibevoice] reach_max_step_sample: {outputs.reach_max_step_sample}")
                if outputs.reach_max_step_sample:
                    logger.warning("[vibevoice] Audio generation hit max token limit - output may be truncated!")

            if hasattr(outputs, 'speech_outputs'):
                audio_data = outputs.speech_outputs
                logger.info(f"[vibevoice] Found outputs.speech_outputs, type: {type(audio_data)}")
                if isinstance(audio_data, (list, tuple)) and len(audio_data) > 0:
                    logger.info(f"[vibevoice] speech_outputs is list/tuple with {len(audio_data)} elements, first type: {type(audio_data[0])}")
            elif hasattr(outputs, 'audio'):
                audio_data = outputs.audio
                logger.debug(f"[vibevoice] Found outputs.audio, type: {type(audio_data)}")
            elif isinstance(outputs, dict) and 'speech_outputs' in outputs:
                audio_data = outputs['speech_outputs']
                logger.debug(f"[vibevoice] Found outputs['speech_outputs'], type: {type(audio_data)}")
            elif isinstance(outputs, dict) and 'audio' in outputs:
                audio_data = outputs['audio']
                logger.debug(f"[vibevoice] Found outputs['audio'], type: {type(audio_data)}")
            elif isinstance(outputs, torch.Tensor):
                audio_data = outputs
                logger.debug(f"[vibevoice] Output is tensor, shape: {audio_data.shape}")
            elif isinstance(outputs, tuple) and len(outputs) > 0:
                # Some models return (audio, sample_rate) or similar tuple
                audio_data = outputs[0]
                logger.debug(f"[vibevoice] Output is tuple, first element type: {type(audio_data)}")
            else:
                audio_data = outputs
                logger.debug("[vibevoice] Using raw output")

            # Convert to numpy array
            if isinstance(audio_data, torch.Tensor):
                audio_array = audio_data.squeeze().cpu().float().numpy()
                logger.debug(f"[vibevoice] Tensor -> numpy, shape: {audio_array.shape}, dtype: {audio_array.dtype}")
            elif isinstance(audio_data, np.ndarray):
                audio_array = audio_data.squeeze()
                logger.debug(f"[vibevoice] Already numpy, shape: {audio_array.shape}, dtype: {audio_array.dtype}")
            elif isinstance(audio_data, list):
                # Handle list of arrays or nested structure
                if len(audio_data) > 0 and isinstance(audio_data[0], (torch.Tensor, np.ndarray)):
                    audio_array = audio_data[0]
                    if isinstance(audio_array, torch.Tensor):
                        audio_array = audio_array.squeeze().cpu().float().numpy()
                    logger.debug(f"[vibevoice] List of tensors/arrays, first shape: {audio_array.shape}")
                else:
                    audio_array = np.array(audio_data, dtype=np.float32).squeeze()
                    logger.debug(f"[vibevoice] List -> numpy, shape: {audio_array.shape}")
            else:
                logger.warning(f"[vibevoice] Unknown audio format: {type(audio_data)}")
                audio_array = np.array(audio_data, dtype=np.float32).squeeze()

            # Log audio duration
            audio_duration = len(audio_array) / self.SAMPLE_RATE
            logger.info(f"[vibevoice] Generated audio: {len(audio_array)} samples, {audio_duration:.2f}s at {self.SAMPLE_RATE}Hz")

            # Convert to WAV bytes
            wav_bytes = audio_to_wav_bytes(audio_array, self.SAMPLE_RATE)

            logger.debug(f"[vibevoice] Generated {len(wav_bytes)} bytes")
            return wav_bytes

        except RuntimeError as e:
            # Handle GPU OOM
            if "out of memory" in str(e).lower():
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                logger.error(f"[vibevoice] GPU out of memory: {e}")
                raise HTTPException(
                    status_code=503,
                    detail="[TTS_GPU_OOM]GPU out of memory. Try shorter text or use smaller model."
                )
            raise
        except Exception as e:
            logger.error(f"[vibevoice] Generation failed: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise

    def unload_model(self) -> None:
        """Free resources and GPU memory"""
        from loguru import logger

        if self.model is not None or self.processor is not None:
            logger.info("[vibevoice] Unloading model...")

            # Delete model
            if self.model is not None:
                del self.model
                self.model = None

            # Delete processor
            if self.processor is not None:
                del self.processor
                self.processor = None

            # GPU cleanup
            if torch.cuda.is_available():
                torch.cuda.synchronize()
                torch.cuda.empty_cache()

            # Force garbage collection
            gc.collect()

            logger.info("[vibevoice] Model unloaded")

    def get_package_version(self) -> str:
        """Return VibeVoice package version for health endpoint"""
        try:
            import vibevoice
            return f"vibevoice {getattr(vibevoice, '__version__', 'unknown')}"
        except ImportError:
            return "vibevoice not installed"


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="VibeVoice TTS Engine Server")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    server = VibeVoiceServer()
    server.run(port=args.port, host=args.host)
