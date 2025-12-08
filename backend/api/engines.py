"""
Engine Management API Endpoints

Provides endpoints for engine enable/disable, start/stop, and status monitoring.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict
import sqlite3
from typing import List, Dict, Any, Optional
from loguru import logger

from db.database import get_db
from services.settings_service import SettingsService
from services.event_broadcaster import emit_engine_enabled, emit_engine_disabled
from models.response_models import (
    MessageResponse,
    AllEnginesStatusResponse,
    EngineStatusInfo,
    to_camel
)
from core.tts_engine_manager import get_tts_engine_manager
from core.text_engine_manager import get_text_engine_manager
from core.stt_engine_manager import get_stt_engine_manager
from core.audio_engine_manager import get_audio_engine_manager

router = APIRouter(prefix="/engines", tags=["engines"])


class EngineActionRequest(BaseModel):
    """Request to perform action on engine"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    engine_type: str  # 'tts', 'text', 'stt', 'audio'
    engine_name: str


class EngineStartRequest(BaseModel):
    """Request to start an engine with optional model"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    model_name: Optional[str] = None  # Optional, uses default if not specified



def _get_engine_manager(engine_type: str):
    """Get the appropriate engine manager for the given type"""
    if engine_type == 'tts':
        return get_tts_engine_manager()
    elif engine_type == 'text':
        return get_text_engine_manager()
    elif engine_type == 'stt':
        return get_stt_engine_manager()
    elif engine_type == 'audio':
        return get_audio_engine_manager()
    else:
        raise ValueError(f"Unknown engine type: {engine_type}")


@router.get("/status", response_model=AllEnginesStatusResponse)
async def get_all_engines_status(conn: sqlite3.Connection = Depends(get_db)):
    """
    Get status of all discovered engines across all types.

    Returns engines grouped by type (TTS, Text, STT, Audio) with detailed status info.
    Includes feature-gating summary (has_tts_engine, has_text_engine, has_stt_engine).

    Returns:
        AllEnginesStatusResponse with engines grouped by type
    """
    try:
        settings_service = SettingsService(conn)
        default_tts_engine = settings_service.get_setting('tts.defaultTtsEngine') or ""
        default_stt_engine = settings_service.get_setting('stt.defaultSttEngine') or ""
        default_text_engine = settings_service.get_setting('text.defaultTextEngine') or ""

        # Get allowed languages for TTS filtering
        allowed_languages = settings_service.get_setting('languages.allowedLanguages') or ["de", "en"]

        # Get all engine managers
        tts_manager = get_tts_engine_manager()
        text_manager = get_text_engine_manager()
        stt_manager = get_stt_engine_manager()
        audio_manager = get_audio_engine_manager()

        # Helper function to convert engine metadata to EngineStatusInfo
        async def convert_to_status_info(
            engine_name: str,
            engine_metadata: Dict[str, Any],
            engine_type: str,
            manager
        ) -> EngineStatusInfo:
            try:
                # Check if engine is enabled in settings
                is_enabled = settings_service.is_engine_enabled(engine_name, engine_type)

                # Check if engine is running
                is_running = manager.is_engine_running(engine_name)

                # Determine status (order matters! Check transitions first)
                if not is_enabled:
                    status = "disabled"
                elif manager.is_engine_stopping(engine_name):
                    status = "stopping"
                elif manager.is_engine_starting(engine_name):
                    status = "starting"
                elif is_running:
                    status = "running"
                else:
                    status = "stopped"

                # Is this the default engine for its type?
                is_default = False
                if engine_type == "tts":
                    is_default = (engine_name == default_tts_engine)
                elif engine_type == "stt":
                    is_default = (engine_name == default_stt_engine)
                elif engine_type == "text":
                    is_default = (engine_name == default_text_engine)

                # Get models from discovery (if available) or fallback to engine_metadata
                discovered_models = manager.get_discovered_models(engine_name)
                if discovered_models:
                    # Use dynamically discovered models
                    available_models = [m.get("name", "unknown") for m in discovered_models]
                else:
                    # Fallback to engine_metadata (discovery not yet run or failed)
                    models_list = engine_metadata.get("models", [])
                    available_models = []
                    if isinstance(models_list, list):
                        for model in models_list:
                            if isinstance(model, dict):
                                model_name = model.get("engine_model_name", "unknown")
                                available_models.append(model_name)
                            elif isinstance(model, str):
                                available_models.append(model)

                # Get auto-stop countdown
                seconds_until_auto_stop = manager.get_seconds_until_auto_stop(engine_name)
                idle_timeout_seconds = manager._inactivity_timeout if engine_name not in manager._exempt_from_auto_stop else None

                # Get device, loaded_model, and package_version from health check if engine is running
                # Note: Don't try health check during 'starting' phase - it's expected to fail
                device = "cpu"
                loaded_model = None
                error_message = None
                package_version = None
                if is_running and status == "running":  # Only check if fully running, not starting
                    try:
                        health_data = await manager.health_check(engine_name)
                        device = health_data.get("device", "cpu")
                        loaded_model = health_data.get("currentEngineModel")
                        package_version = health_data.get("packageVersion")  # Dynamic version from pip package
                    except Exception as health_err:
                        # Health check failed on running engine - process exists but server not responding
                        logger.warning(f"Health check failed for running engine {engine_name}: {type(health_err).__name__}: {health_err}")
                        # Set status to error - the process exists but the server isn't working
                        status = "error"
                        error_message = f"Server not responding: {type(health_err).__name__}"

                # Get default model name from settings (per-engine)
                default_model_name = None
                if engine_type in ("tts", "stt"):
                    default_model_name = settings_service.get_default_model_for_engine(engine_name, engine_type)

                # Get supported languages from discovered models (if available) or engine_metadata
                if discovered_models:
                    # Aggregate languages from all discovered models
                    engine_languages = list(set(
                        lang for m in discovered_models for lang in m.get("languages", [])
                    ))
                else:
                    # Fallback to engine_metadata
                    engine_languages = engine_metadata.get("supported_languages", [])

                # Check if discovery failed - show error status
                discovery_error = manager.get_discovery_error(engine_name)

                # Filter languages by allowedLanguages for TTS engines only
                if engine_type == "tts":
                    filtered_languages = [lang for lang in engine_languages if lang in allowed_languages]
                else:
                    # Other engine types (text, stt, audio) use unfiltered languages
                    filtered_languages = engine_languages

                # If discovery failed, show error status (unless engine is disabled or already error)
                if discovery_error and is_enabled and status != "error":
                    status = "error"
                    error_message = f"Discovery failed: {discovery_error}"

                # Get keep_running flag from settings
                keep_running = settings_service.get_engine_keep_running(engine_name, engine_type)

                return EngineStatusInfo(
                    name=engine_name,
                    display_name=engine_metadata.get("display_name", engine_name),
                    version=package_version or "",  # Only show version when engine is running
                    engine_type=engine_type,
                    is_enabled=is_enabled,
                    is_running=is_running,
                    is_default=is_default,
                    status=status,
                    port=manager.engine_ports.get(engine_name),
                    error_message=error_message,
                    idle_timeout_seconds=idle_timeout_seconds,
                    seconds_until_auto_stop=seconds_until_auto_stop,
                    keep_running=keep_running,
                    supported_languages=filtered_languages,
                    all_supported_languages=engine_languages,  # Unfiltered for Settings UI
                    device=device,
                    available_models=available_models,
                    loaded_model=loaded_model,
                    default_model_name=default_model_name,
                )
            except Exception as e:
                logger.error(f"Failed to convert metadata for engine {engine_name}: {e}", exc_info=True)
                raise

        # Collect engines by type
        tts_engines: List[EngineStatusInfo] = []
        text_engines: List[EngineStatusInfo] = []
        stt_engines: List[EngineStatusInfo] = []
        audio_engines: List[EngineStatusInfo] = []

        # TTS engines
        logger.debug(f"Processing TTS engines: {list(tts_manager._engine_metadata.keys())}")
        for engine_name, metadata in tts_manager._engine_metadata.items():
            logger.debug(f"TTS engine '{engine_name}' metadata keys: {list(metadata.keys())}")
            tts_engines.append(await convert_to_status_info(engine_name, metadata, "tts", tts_manager))

        # Text engines
        logger.debug(f"Processing Text engines: {list(text_manager._engine_metadata.keys())}")
        for engine_name, metadata in text_manager._engine_metadata.items():
            logger.debug(f"Text engine '{engine_name}' metadata keys: {list(metadata.keys())}")
            text_engines.append(await convert_to_status_info(engine_name, metadata, "text", text_manager))

        # STT engines
        logger.debug(f"Processing STT engines: {list(stt_manager._engine_metadata.keys())}")
        for engine_name, metadata in stt_manager._engine_metadata.items():
            logger.debug(f"STT engine '{engine_name}' metadata keys: {list(metadata.keys())}")
            stt_engines.append(await convert_to_status_info(engine_name, metadata, "stt", stt_manager))

        # Audio engines
        logger.debug(f"Processing Audio engines: {list(audio_manager._engine_metadata.keys())}")
        for engine_name, metadata in audio_manager._engine_metadata.items():
            logger.debug(f"Audio engine '{engine_name}' metadata keys: {list(metadata.keys())}")
            audio_engines.append(await convert_to_status_info(engine_name, metadata, "audio", audio_manager))

        # Feature-gating summary
        has_tts_engine = any(e.is_enabled for e in tts_engines)
        has_text_engine = any(e.is_enabled for e in text_engines)
        has_stt_engine = any(e.is_enabled for e in stt_engines)

        logger.debug(
            f"Engine status: TTS={len(tts_engines)} (enabled={has_tts_engine}), "
            f"Text={len(text_engines)} (enabled={has_text_engine}), "
            f"STT={len(stt_engines)} (enabled={has_stt_engine}), "
            f"Audio={len(audio_engines)}"
        )

        return AllEnginesStatusResponse(
            success=True,
            tts=tts_engines,
            text=text_engines,
            stt=stt_engines,
            audio=audio_engines,
            has_tts_engine=has_tts_engine,
            has_text_engine=has_text_engine,
            has_stt_engine=has_stt_engine,
        )

    except Exception as e:
        logger.error(f"Failed to get engine status: {e}")
        raise HTTPException(status_code=500, detail=f"[ENGINE_STATUS_FAILED]error:{str(e)}")


@router.post("/{engine_type}/{engine_name}/enable", response_model=MessageResponse)
async def enable_engine(
    engine_type: str,
    engine_name: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Enable an engine

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier

    Returns:
        Success message
    """
    try:
        settings_service = SettingsService(conn)
        success = settings_service.set_engine_enabled(engine_name, True, engine_type)

        if not success:
            raise HTTPException(status_code=400, detail=f"[ENGINE_ENABLE_FAILED]engine:{engine_name}")

        logger.info(f"Engine '{engine_name}' ({engine_type}) enabled via API")

        # Discover models for newly enabled engine (non-blocking)
        try:
            manager = _get_engine_manager(engine_type)
            # Run discovery in background - don't block the response
            import asyncio
            asyncio.create_task(manager.discover_engine_models(engine_name))
            logger.info(f"Model discovery started for {engine_name}")
        except Exception as e:
            logger.warning(f"Failed to start model discovery for {engine_name}: {e}")

        # Emit engine enabled event
        try:
            await emit_engine_enabled(engine_type, engine_name)
        except Exception as e:
            logger.warning(f"Failed to broadcast engine enabled event: {e}")

        return MessageResponse(
            success=True,
            message=f"Engine '{engine_name}' enabled successfully"
        )

    except ValueError as e:
        # Validation error (e.g., engine not found)
        raise HTTPException(status_code=400, detail=f"[ENGINE_ENABLE_FAILED]engineType:{engine_type};engineName:{engine_name};error:{str(e)}")
    except Exception as e:
        logger.error(f"Failed to enable engine {engine_name}: {e}")
        raise HTTPException(status_code=500, detail=f"[ENGINE_ENABLE_FAILED]engineType:{engine_type};engineName:{engine_name};error:{str(e)}")


@router.post("/{engine_type}/{engine_name}/disable", response_model=MessageResponse)
async def disable_engine(
    engine_type: str,
    engine_name: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Disable an engine

    Validates that default TTS engine cannot be disabled.

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier

    Returns:
        Success message

    Raises:
        400: If trying to disable default TTS engine
    """
    try:
        settings_service = SettingsService(conn)
        success = settings_service.set_engine_enabled(engine_name, False, engine_type)

        if not success:
            raise HTTPException(status_code=400, detail=f"[ENGINE_DISABLE_FAILED]engine:{engine_name}")

        logger.info(f"Engine '{engine_name}' ({engine_type}) disabled via API")

        # Emit engine disabled event
        try:
            await emit_engine_disabled(engine_type, engine_name)
        except Exception as e:
            logger.warning(f"Failed to broadcast engine disabled event: {e}")

        return MessageResponse(
            success=True,
            message=f"Engine '{engine_name}' disabled successfully"
        )

    except ValueError as e:
        # Validation error (e.g., trying to disable default engine)
        raise HTTPException(status_code=400, detail=f"[ENGINE_DISABLE_FAILED]engineType:{engine_type};engineName:{engine_name};error:{str(e)}")
    except Exception as e:
        logger.error(f"Failed to disable engine {engine_name}: {e}")
        raise HTTPException(status_code=500, detail=f"[ENGINE_DISABLE_FAILED]engineType:{engine_type};engineName:{engine_name};error:{str(e)}")


@router.post("/{engine_type}/{engine_name}/start", response_model=MessageResponse)
async def start_engine(
    engine_type: str,
    engine_name: str,
    request: Optional[EngineStartRequest] = None,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Manually start an engine server

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier
        request: Optional request body with model_name

    Returns:
        Success message with port number

    Raises:
        400: If engine is disabled or not found
        500: If engine start failed
    """
    try:
        settings_service = SettingsService(conn)

        # Check if engine is enabled
        is_enabled = settings_service.is_engine_enabled(engine_name, engine_type)
        if not is_enabled:
            raise HTTPException(
                status_code=400,
                detail=f"[ENGINE_START_DISABLED]engine:{engine_name}"
            )

        # Get the appropriate engine manager
        try:
            manager = _get_engine_manager(engine_type)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"[ENGINE_INVALID_TYPE]engineType:{engine_type};error:{str(e)}")

        # Check if engine exists in manager
        if engine_name not in manager._engine_metadata:
            raise HTTPException(
                status_code=400,
                detail=f"[ENGINE_NOT_FOUND]engine:{engine_name};type:{engine_type}"
            )

        # Get model name from request or use default
        # Audio engines don't have models, so model_name can be None for them
        model_name = None
        if request and request.model_name:
            model_name = request.model_name
        elif engine_type == 'audio':
            # Audio engines don't require a model - use dummy placeholder
            # The engine's load_model() is a no-op anyway
            model_name = 'default'
        else:
            # Try to get default model from per-engine settings
            if engine_type in ('tts', 'stt'):
                model_name = settings_service.get_default_model_for_engine(engine_name, engine_type)
            elif engine_type == 'text':
                # Text engines use language codes as model identifiers
                # Get first supported language from engine metadata
                supported_langs = manager._engine_metadata[engine_name].get("supported_languages", ["en"])
                model_name = supported_langs[0] if supported_langs else "en"

            # If still no model, use first available from engine metadata
            if not model_name:
                models = manager._engine_metadata[engine_name].get("models", [])
                if models:
                    if isinstance(models[0], dict):
                        # Use engine_model_name (v0.4.1+ standard format from discovery)
                        model_name = models[0].get("engine_model_name")
                    else:
                        model_name = models[0]

        # Validate that we have a model (except for audio engines which don't need one)
        if not model_name and engine_type != 'audio':
            raise HTTPException(
                status_code=400,
                detail=f"[ENGINE_NO_MODEL]engine:{engine_name}"
            )

        # Start the engine
        logger.info(f"Starting {engine_type} engine '{engine_name}' with model '{model_name}'")
        await manager.ensure_engine_ready(engine_name, model_name)
        port = manager.engine_ports.get(engine_name)

        return MessageResponse(
            success=True,
            message=f"Engine '{engine_name}' started successfully on port {port}"
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Failed to start engine {engine_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"[ENGINE_START_FAILED]error:{str(e)}")


@router.post("/{engine_type}/{engine_name}/stop", response_model=MessageResponse)
async def stop_engine(
    engine_type: str,
    engine_name: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Manually stop an engine server

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier

    Returns:
        Success message

    Raises:
        400: If engine not found
        500: If engine stop failed
    """
    try:
        # Get the appropriate engine manager
        try:
            manager = _get_engine_manager(engine_type)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"[ENGINE_INVALID_TYPE]engineType:{engine_type};error:{str(e)}")

        # Check if engine exists in manager
        if engine_name not in manager._engine_metadata:
            raise HTTPException(
                status_code=400,
                detail=f"[ENGINE_NOT_FOUND]engine:{engine_name};type:{engine_type}"
            )

        # Check if engine is actually running
        if not manager.is_engine_running(engine_name):
            return MessageResponse(
                success=True,
                message=f"Engine '{engine_name}' was already stopped"
            )

        # Stop the engine
        logger.info(f"Stopping {engine_type} engine '{engine_name}'")
        await manager.stop_engine_server(engine_name)

        return MessageResponse(
            success=True,
            message=f"Engine '{engine_name}' stopped successfully"
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Failed to stop engine {engine_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"[ENGINE_STOP_FAILED]error:{str(e)}")


@router.post("/{engine_type}/default/{engine_name}", response_model=MessageResponse)
async def set_default_engine(
    engine_type: str,
    engine_name: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Set the default engine for a given type

    Args:
        engine_type: Type of engine ('tts', 'stt', 'text')
        engine_name: Engine identifier to set as default

    Returns:
        Success message

    Raises:
        400: If engine is disabled or not found
    """
    try:
        settings_service = SettingsService(conn)
        settings_service.set_default_engine(engine_type, engine_name)

        return MessageResponse(
            success=True,
            message=f"Default {engine_type} engine set to '{engine_name}'"
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"[ENGINE_SET_DEFAULT_FAILED]engineType:{engine_type};engineName:{engine_name};error:{str(e)}")
    except Exception as e:
        logger.error(f"Failed to set default engine: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"[ENGINE_SET_DEFAULT_FAILED]engineType:{engine_type};engineName:{engine_name};error:{str(e)}")


@router.delete("/{engine_type}/default", response_model=MessageResponse)
async def clear_default_engine(
    engine_type: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Clear the default engine for a given type (set to none)

    Note: TTS must always have a default engine, so this will fail for TTS.

    Args:
        engine_type: Type of engine ('stt', 'text', 'audio')

    Returns:
        Success message

    Raises:
        400: If trying to clear TTS default (not allowed)
    """
    try:
        settings_service = SettingsService(conn)
        settings_service.set_default_engine(engine_type, "")

        return MessageResponse(
            success=True,
            message=f"Default {engine_type} engine cleared"
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"[ENGINE_CLEAR_DEFAULT_FAILED]engineType:{engine_type};error:{str(e)}")
    except Exception as e:
        logger.error(f"Failed to clear default engine: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"[ENGINE_CLEAR_DEFAULT_FAILED]engineType:{engine_type};error:{str(e)}")


class KeepRunningRequest(BaseModel):
    """Request to set keep-running flag for an engine"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    keep_running: bool


@router.post("/{engine_type}/{engine_name}/keep-running", response_model=MessageResponse)
async def set_engine_keep_running(
    engine_type: str,
    engine_name: str,
    request: KeepRunningRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Set keep-running flag for an engine

    Engines with keepRunning=true will not be auto-stopped after inactivity.

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier
        request: Request body with keepRunning boolean

    Returns:
        Success message

    Raises:
        400: If engine type is invalid or engine not found
        500: If operation failed
    """
    try:
        # Validate engine type
        valid_types = ['tts', 'text', 'stt', 'audio']
        if engine_type not in valid_types:
            raise HTTPException(
                status_code=400,
                detail=f"[ENGINE_INVALID_TYPE]type:{engine_type};valid:{', '.join(valid_types)}"
            )

        # Get the appropriate engine manager to verify engine exists
        try:
            manager = _get_engine_manager(engine_type)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"[ENGINE_INVALID_TYPE]engineType:{engine_type};error:{str(e)}")

        # Check if engine exists in manager
        if engine_name not in manager._engine_metadata:
            raise HTTPException(
                status_code=400,
                detail=f"[ENGINE_NOT_FOUND]engine:{engine_name};type:{engine_type}"
            )

        # Update keep_running flag in settings
        settings_service = SettingsService(conn)
        settings_service.set_engine_keep_running(engine_name, request.keep_running, engine_type)

        action = "enabled" if request.keep_running else "disabled"
        logger.info(f"Keep-running {action} for engine '{engine_name}' ({engine_type})")

        return MessageResponse(
            success=True,
            message=f"Keep-running {action} for engine '{engine_name}'"
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Failed to set keep-running for engine {engine_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"[ENGINE_KEEP_RUNNING_FAILED]engineType:{engine_type};engineName:{engine_name};error:{str(e)}")


