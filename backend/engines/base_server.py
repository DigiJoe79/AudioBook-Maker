"""
Base Engine Server - Abstract FastAPI Server for TTS Engines

All engine servers inherit from this class and only need to implement:
- load_model(model_name: str)
- generate_audio(text: str, language: str, speaker_wav: str|list, parameters: dict) -> bytes
- unload_model()
"""
from fastapi import FastAPI, Response, HTTPException
from pydantic import BaseModel, ConfigDict
from typing import Dict, Any, Union, List, Optional
from abc import ABC, abstractmethod
import uvicorn
from loguru import logger
import traceback
import sys
import asyncio


# ============= Configure Loguru (same format as main backend) =============
# Remove default handler and configure to match main.py format (no date)
logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO",
    colorize=True
)


# ============= CamelCase Conversion Helper =============
# NOTE: This is intentionally duplicated from backend/models/response_models.py
# because engine servers run in isolated VENVs without access to backend modules.
# Each engine must be self-contained with its own copy of shared utilities.

def to_camel(string: str) -> str:
    """
    Convert snake_case string to camelCase.

    Examples:
        tts_model_name → ttsModelName
        tts_speaker_wav → ttsSpeakerWav
        current_tts_model → currentTtsModel
    """
    components = string.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])


class CamelCaseModel(BaseModel):
    """
    Base model with automatic snake_case to camelCase conversion.

    All engine server models inherit from this to ensure consistent
    API response formatting (Python snake_case → JSON camelCase).
    """
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,  # Accept both snake_case and camelCase input
    )


# ============= Request/Response Models =============

class LoadRequest(CamelCaseModel):
    """Request to load a specific model"""
    tts_model_name: str


class LoadResponse(CamelCaseModel):
    """Response after loading model"""
    status: str  # "loaded", "error"
    tts_model_name: Optional[str] = None
    error: Optional[str] = None


class GenerateRequest(CamelCaseModel):
    """Request to generate TTS audio"""
    text: str
    language: str  # Required (engine can ignore if not needed)
    tts_speaker_wav: Union[str, List[str]]  # Path(s) to speaker sample(s)
    parameters: Dict[str, Any] = {}  # Engine-specific params


class HealthResponse(CamelCaseModel):
    """Health check response"""
    status: str  # "ready", "loading", "processing", "error"
    tts_model_loaded: bool
    current_tts_model: Optional[str] = None
    error: Optional[str] = None


class ShutdownResponse(CamelCaseModel):
    """Shutdown acknowledgment"""
    status: str  # "shutting_down"


# ============= Base Engine Server =============

class BaseEngineServer(ABC):
    """
    Abstract base class for TTS engine servers

    Engines only need to implement 3 methods:
    - load_model(model_name)
    - generate_audio(text, language, speaker_wav, parameters) -> bytes
    - unload_model()

    All FastAPI routes, error handling, and lifecycle management are handled here.
    """

    def __init__(self, engine_name: str, display_name: str):
        """
        Initialize engine server

        Args:
            engine_name: Engine identifier (e.g., "xtts", "piper")
            display_name: Human-readable name (e.g., "XTTS v2", "Piper TTS")
        """
        self.engine_name = engine_name
        self.display_name = display_name
        self.app = FastAPI(title=f"{display_name} Server")

        # State
        self.status = "ready"  # ready, loading, processing, error
        self.model_loaded = False
        self.current_model = None
        self.error_message = None
        self.shutdown_requested = False
        self.server: Optional[uvicorn.Server] = None  # Server reference for graceful shutdown

        # Setup routes
        self._setup_routes()

        logger.info(f"[{self.engine_name}] BaseEngineServer initialized")

    def _setup_routes(self):
        """Setup FastAPI routes (called automatically)"""

        @self.app.post("/load", response_model=LoadResponse)
        async def load_endpoint(request: LoadRequest):
            """Load a specific model into memory"""
            try:
                #logger.info(f"[{self.engine_name}] Loading model: {request.tts_model_name}")
                self.status = "loading"
                self.error_message = None

                # Call engine-specific implementation
                self.load_model(request.tts_model_name)

                self.model_loaded = True
                self.current_model = request.tts_model_name
                self.status = "ready"

                #logger.info(f"[{self.engine_name}] Model loaded successfully: {request.tts_model_name}")
                return LoadResponse(status="loaded", tts_model_name=request.tts_model_name)

            except HTTPException:
                raise
            except Exception as e:
                self.status = "error"
                self.error_message = str(e)
                logger.error(f"[{self.engine_name}] Model loading failed: {e}")
                logger.error(traceback.format_exc())
                raise HTTPException(status_code=500, detail=str(e))

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
                logger.info(
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

        @self.app.get("/health", response_model=HealthResponse)
        async def health_endpoint():
            """Health check"""
            return HealthResponse(
                status=self.status,
                tts_model_loaded=self.model_loaded,
                current_tts_model=self.current_model,
                error=self.error_message
            )

        @self.app.post("/shutdown", response_model=ShutdownResponse)
        async def shutdown_endpoint():
            """Graceful shutdown request"""
            #logger.info(f"[{self.engine_name}] Shutdown requested")
            self.shutdown_requested = True

            # Unload model to free resources
            try:
                self.unload_model()
            except Exception as e:
                logger.error(f"[{self.engine_name}] Error during unload: {e}")

            # Schedule server shutdown after response is sent (100ms delay)
            if self.server:
                asyncio.create_task(self._delayed_shutdown())

            return ShutdownResponse(status="shutting_down")

        async def _delayed_shutdown_impl():
            """Internal helper: shutdown server after brief delay"""
            await asyncio.sleep(0.1)  # Let response be sent
            if self.server:
                self.server.should_exit = True

        # Store as instance method so shutdown endpoint can access it
        self._delayed_shutdown = _delayed_shutdown_impl

    # ============= Abstract Methods (Engine-Specific) =============

    @abstractmethod
    def load_model(self, model_name: str) -> None:
        """
        Load model into memory (engine-specific)

        Args:
            model_name: Model identifier (e.g., "v2.0.3", "de_thorsten")

        Raises:
            Exception: If loading fails
        """
        pass

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

    @abstractmethod
    def unload_model(self) -> None:
        """
        Unload model and free resources (engine-specific)
        """
        pass

    # ============= Server Lifecycle =============

    def run(self, port: int, host: str = "127.0.0.1"):
        """
        Start the FastAPI server

        Args:
            port: Port to listen on
            host: Host to bind to (default: localhost only)
        """
        #logger.info(f"[{self.engine_name}] Starting server on {host}:{port}")

        # Create uvicorn server manually to enable graceful shutdown
        config = uvicorn.Config(
            self.app,
            host=host,
            port=port,
            log_level="error",  # Only show errors, suppress INFO logs
            access_log=False     # Disable access logs (we log in endpoints)
        )
        self.server = uvicorn.Server(config)

        # Run server (blocks until shutdown via /shutdown endpoint or signal)
        asyncio.run(self.server.serve())

        #logger.info(f"[{self.engine_name}] Server stopped")
