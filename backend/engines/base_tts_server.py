"""
Base TTS Engine Server - Abstract FastAPI Server for TTS Engines

Extends BaseEngineServer with TTS-specific functionality:
- /generate endpoint for audio synthesis
- generate_audio() abstract method

TTS engine servers inherit from this class and implement:
- load_model(model_name: str)
- get_available_models() -> List[ModelInfo]
- generate_audio(text, language, speaker_wav, parameters) -> bytes
- unload_model()
"""
from fastapi import Response, HTTPException
from typing import Dict, Any, Union, List
from abc import abstractmethod
from loguru import logger
import traceback

from base_server import BaseEngineServer, CamelCaseModel, ModelInfo as ModelInfo


# ============= TTS-Specific Request Model =============

class GenerateRequest(CamelCaseModel):
    """Request to generate TTS audio"""
    text: str
    language: str  # Required (engine can ignore if not needed)
    tts_speaker_wav: Union[str, List[str]]  # Path(s) to speaker sample(s)
    parameters: Dict[str, Any] = {}  # Engine-specific params


# ============= Base TTS Server =============

class BaseTTSServer(BaseEngineServer):
    """
    Abstract base class for TTS engine servers

    Extends BaseEngineServer with:
    - /generate endpoint for audio synthesis
    - generate_audio() abstract method

    TTS engines implement:
    - load_model(model_name) - Load a TTS model
    - get_available_models() - Return available TTS models
    - generate_audio(text, language, speaker_wav, parameters) -> bytes
    - unload_model() - Unload model and free resources
    """

    def __init__(self, engine_name: str, display_name: str):
        """
        Initialize TTS engine server

        Args:
            engine_name: Engine identifier (e.g., "xtts", "chatterbox")
            display_name: Human-readable name (e.g., "XTTS v2", "Chatterbox TTS")
        """
        super().__init__(engine_name, display_name)

        # Setup TTS-specific routes
        self._setup_generate_route()

        logger.info(f"[{self.engine_name}] BaseTTSServer initialized")

    def _setup_generate_route(self):
        """Setup TTS-specific /generate endpoint"""

        @self.app.post("/generate")
        async def generate_endpoint(request: GenerateRequest):
            """Generate TTS audio"""
            try:
                if not self.model_loaded:
                    raise HTTPException(status_code=400, detail="Model not loaded")

                # Format speaker for logging (basename only, not full path)
                if isinstance(request.tts_speaker_wav, str):
                    from pathlib import Path
                    speaker_info = Path(request.tts_speaker_wav).name
                else:
                    speaker_info = f'{len(request.tts_speaker_wav)} samples'

                # Log TTS parameters for debugging (without text content)
                logger.debug(
                    f"🎙️ [{self.engine_name}] Generating audio | "
                    f"Model: {self.current_model} | "
                    f"Language: {request.language} | "
                    f"Speaker: {speaker_info} | "
                    f"Parameters: {request.parameters}"
                )

                self.status = "processing"

                # Call engine-specific implementation
                audio_bytes = self.generate_audio(
                    text=request.text,
                    language=request.language,
                    speaker_wav=request.tts_speaker_wav,
                    parameters=request.parameters
                )

                self.status = "ready"

                # Return binary audio
                return Response(content=audio_bytes, media_type="audio/wav")

            except HTTPException:
                raise
            except Exception as e:
                self.status = "error"
                self.error_message = str(e)
                logger.error(f"[{self.engine_name}] Generation failed: {e}")
                logger.error(traceback.format_exc())
                raise HTTPException(status_code=500, detail=str(e))

    # ============= TTS-Specific Abstract Method =============

    @abstractmethod
    def generate_audio(
        self,
        text: str,
        language: str,
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """
        Generate TTS audio (engine-specific)

        Args:
            text: Text to synthesize
            language: Language code (e.g., "en", "de")
            speaker_wav: Path(s) to speaker sample(s)
            parameters: Engine-specific parameters (temperature, speed, etc.)

        Returns:
            WAV audio as bytes

        Raises:
            Exception: If generation fails
        """
        pass
