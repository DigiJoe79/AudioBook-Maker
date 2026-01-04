"""
Settings API Endpoints

RESTful API for managing global application settings.
"""
import sqlite3
from fastapi import APIRouter, Depends
from typing import Any, Dict
from pydantic import BaseModel, ConfigDict
from loguru import logger

from db.database import get_db
from core.exceptions import ApplicationError
from services.settings_service import SettingsService
from services.event_broadcaster import broadcaster, EventType
from core.base_engine_manager import parse_variant_id
from models.response_models import (
    MessageResponse,
    AllSettingsResponse,
    SettingValueResponse,
    SegmentLimitsResponse,
    EngineSchemaResponse,
    to_camel
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingUpdateRequest(BaseModel):
    """Request model for updating settings"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    value: Dict[str, Any]


@router.get("/", response_model=AllSettingsResponse)
async def get_all_settings(db: sqlite3.Connection = Depends(get_db)) -> AllSettingsResponse:
    """
    Get all global settings

    Returns all settings organized by category (general, tts, audio, text).
    """
    try:
        service = SettingsService(db)
        settings = service.get_all_settings()

        logger.debug("Retrieved all settings")

        return settings

    except Exception as e:
        logger.error(f"Failed to get settings: {e}")
        raise ApplicationError("SETTINGS_GET_FAILED", status_code=500, error=str(e))


@router.get("/{key}", response_model=SettingValueResponse)
async def get_setting(key: str, db: sqlite3.Connection = Depends(get_db)) -> SettingValueResponse:
    """
    Get specific setting by key

    Supports both top-level keys (e.g., 'tts') and dot-notation (e.g., 'tts.defaultEngine').

    Args:
        key: Setting key

    Returns:
        Setting value
    """
    try:
        service = SettingsService(db)
        value = service.get_setting(key)

        if value is None:
            raise ApplicationError("SETTINGS_KEY_NOT_FOUND", status_code=404, key=key)

        logger.debug(f"Retrieved setting: {key}")

        return SettingValueResponse(
            key=key,
            value=value
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to get setting '{key}': {e}")
        raise ApplicationError("SETTINGS_GET_FAILED", status_code=500, key=key, error=str(e))


@router.put("/{key}", response_model=SettingValueResponse)
async def update_setting(
    key: str,
    request: SettingUpdateRequest,
    db: sqlite3.Connection = Depends(get_db)
) -> SettingValueResponse:
    """
    Update a setting

    Updates a top-level category (e.g., 'tts', 'audio') with new values.
    The entire category object is replaced.

    Args:
        key: Setting category key
        request: New value for the category

    Returns:
        Updated setting
    """
    try:
        service = SettingsService(db)
        result = service.update_setting(key, request.value)

        logger.info(f"Updated setting: {key}")

        # Emit SSE event
        await broadcaster.broadcast_settings_update({
            "key": key,
            "value": result["value"]
        })

        return result

    except Exception as e:
        logger.error(f"Failed to update setting '{key}': {e}")
        raise ApplicationError("SETTINGS_UPDATE_FAILED", status_code=500, error=str(e))


@router.post("/reset", response_model=MessageResponse)
async def reset_to_defaults(db: sqlite3.Connection = Depends(get_db)) -> MessageResponse:
    """
    Reset all settings to default values

    This will delete all custom settings and restore defaults from DEFAULT_GLOBAL_SETTINGS.

    Returns:
        Status message
    """
    try:
        service = SettingsService(db)
        result = service.reset_to_defaults()

        logger.info("Reset all settings to defaults")

        # Emit SSE event
        await broadcaster.broadcast_settings_update(
            {"reset": True},
            event_type=EventType.SETTINGS_RESET
        )

        return result

    except Exception as e:
        logger.error(f"Failed to reset settings: {e}")
        raise ApplicationError("SETTINGS_RESET_FAILED", status_code=500, error=str(e))


@router.get("/segment-limits/{engine}", response_model=SegmentLimitsResponse)
async def get_segment_limits(engine: str, db: sqlite3.Connection = Depends(get_db)) -> SegmentLimitsResponse:
    """
    Get effective segment length limits for text segmentation

    Combines user preference with engine constraints to determine the actual limit to use.

    Args:
        engine: Engine name or variant_id (e.g., 'xtts' or 'xtts:local')

    Returns:
        {
            "user_preference": 500,   # From settings
            "engine_maximum": 1000,   # From engine schema
            "effective_limit": 500    # Min of both
        }
    """
    try:
        # Pass full variant_id to get_segment_limits (not base_engine_name)
        # get_engine_metadata requires the full variant_id to find the engine in DB
        service = SettingsService(db)
        limits = service.get_segment_limits(engine)

        logger.debug(f"Retrieved segment limits for engine '{engine}': {limits}")

        return limits

    except Exception as e:
        logger.error(f"Failed to get segment limits for engine '{engine}': {e}")
        raise ApplicationError("SETTINGS_GET_SEGMENT_LIMITS_FAILED", status_code=500, engine=engine, error=str(e))


@router.get("/engine-schema/{engine_type}/{engine}", response_model=EngineSchemaResponse)
async def get_engine_parameter_schema_by_type(engine_type: str, engine: str) -> EngineSchemaResponse:
    """
    Get parameter schema for any engine type

    Returns UI metadata for engine parameters (for Settings dialog).

    Args:
        engine_type: Type of engine ('tts', 'stt', 'text', 'audio')
        engine: Engine name or variant_id (e.g., 'xtts' or 'xtts:local')

    Returns:
        Parameter schema dictionary
    """
    try:
        # Parse variant_id to get base engine name
        base_engine_name, _ = parse_variant_id(engine)

        # Get the appropriate engine manager based on type
        if engine_type == 'tts':
            from core.tts_engine_manager import get_tts_engine_manager
            manager = get_tts_engine_manager()
        elif engine_type == 'stt':
            from core.stt_engine_manager import get_stt_engine_manager
            manager = get_stt_engine_manager()
        elif engine_type == 'text':
            from core.text_engine_manager import get_text_engine_manager
            manager = get_text_engine_manager()
        elif engine_type == 'audio':
            from core.audio_engine_manager import get_audio_engine_manager
            manager = get_audio_engine_manager()
        else:
            raise ApplicationError("SETTINGS_INVALID_ENGINE_TYPE", status_code=400, type=engine_type)

        # Get metadata from DB (Single Source of Truth)
        metadata = manager.get_engine_metadata(engine)
        if not metadata:
            raise ApplicationError("SETTINGS_ENGINE_NOT_FOUND", status_code=404, engine=engine, type=engine_type)

        # Get parameter schema from engine metadata (engine.yaml)
        # Note: metadata['config'] contains the entire engine.yaml,
        # which has 'parameters' with the schema definition
        yaml_config = metadata.get('config') or {}
        schema = yaml_config.get('parameters') or {}

        logger.debug(f"Retrieved parameter schema for {engine_type} engine '{engine}' (base: {base_engine_name}): {len(schema)} parameters")

        return EngineSchemaResponse(parameters=schema)

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to get parameter schema for {engine_type} engine '{engine}': {e}")
        raise ApplicationError("SETTINGS_GET_SCHEMA_FAILED", status_code=500, engine=engine, type=engine_type, error=str(e))


@router.get("/engine-schema/{engine}", response_model=EngineSchemaResponse)
async def get_engine_parameter_schema(engine: str) -> EngineSchemaResponse:
    """
    Get parameter schema for a specific TTS engine (legacy endpoint)

    Returns UI metadata for engine parameters (for Settings dialog).
    DEPRECATED: Use /engine-schema/{engine_type}/{engine} instead.

    Args:
        engine: Engine name or variant_id (e.g., 'xtts' or 'xtts:local')

    Returns:
        Parameter schema dictionary
    """
    try:
        # Parse variant_id to get base engine name
        base_engine_name, _ = parse_variant_id(engine)

        from core.tts_engine_manager import get_tts_engine_manager

        tts_manager = get_tts_engine_manager()

        # Get metadata from DB (Single Source of Truth)
        metadata = tts_manager.get_engine_metadata(engine)
        if not metadata:
            raise ApplicationError("SETTINGS_ENGINE_NOT_FOUND", status_code=404, engine=engine)

        # Get parameter schema from engine metadata (engine.yaml)
        # Note: metadata['config'] contains the entire engine.yaml,
        # which has 'parameters' with the schema definition
        yaml_config = metadata.get('config') or {}
        schema = yaml_config.get('parameters') or {}

        logger.debug(f"Retrieved parameter schema for engine '{engine}' (base: {base_engine_name}): {len(schema)} parameters")

        return EngineSchemaResponse(parameters=schema)

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to get parameter schema for engine '{engine}': {e}")
        raise ApplicationError("SETTINGS_GET_SCHEMA_FAILED", status_code=500, engine=engine, error=str(e))
