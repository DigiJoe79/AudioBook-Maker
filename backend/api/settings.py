"""
Settings API Endpoints

RESTful API for managing global application settings.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Any, Dict
from pydantic import BaseModel, ConfigDict
from loguru import logger

from db.database import get_db
from services.settings_service import SettingsService
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
async def get_all_settings(db=Depends(get_db)):
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
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{key}", response_model=SettingValueResponse)
async def get_setting(key: str, db=Depends(get_db)):
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
            raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")

        logger.debug(f"Retrieved setting: {key}")

        return {
            "key": key,
            "value": value
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get setting '{key}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{key}", response_model=SettingValueResponse)
async def update_setting(
    key: str,
    request: SettingUpdateRequest,
    db=Depends(get_db)
):
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

        return result

    except Exception as e:
        logger.error(f"Failed to update setting '{key}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset", response_model=MessageResponse)
async def reset_to_defaults(db=Depends(get_db)):
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

        return result

    except Exception as e:
        logger.error(f"Failed to reset settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/segment-limits/{engine}", response_model=SegmentLimitsResponse)
async def get_segment_limits(engine: str, db=Depends(get_db)):
    """
    Get effective segment length limits for text segmentation

    Combines user preference with engine constraints to determine the actual limit to use.

    Args:
        engine: Engine name (e.g., 'xtts', 'dummy')

    Returns:
        {
            "user_preference": 500,
            "engine_maximum": 1000,
            "effective_limit": 500
        }
    """
    try:
        service = SettingsService(db)
        limits = service.get_segment_limits(engine)

        logger.debug(f"Retrieved segment limits for engine '{engine}': {limits}")

        return limits

    except Exception as e:
        logger.error(f"Failed to get segment limits for engine '{engine}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/engine-schema/{engine}", response_model=EngineSchemaResponse)
async def get_engine_parameter_schema(engine: str):
    """
    Get parameter schema for a specific TTS engine

    Returns UI metadata for engine parameters (for Settings dialog).

    Args:
        engine: Engine name (e.g., 'xtts', 'dummy')

    Returns:
        Parameter schema dictionary
    """
    try:
        from services.tts_manager import TTSManager

        manager = TTSManager()
        engine_class = manager._engine_classes.get(engine)

        if not engine_class:
            raise HTTPException(status_code=404, detail=f"Engine '{engine}' not found")

        schema = engine_class.get_parameter_schema_static()

        logger.debug(f"Retrieved parameter schema for engine '{engine}'")

        return {"parameters": schema}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get parameter schema for engine '{engine}': {e}")
        raise HTTPException(status_code=500, detail=str(e))
