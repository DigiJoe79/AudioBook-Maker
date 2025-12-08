"""
API endpoints for text processing and segmentation
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal, List

from core.text_engine_manager import get_text_engine_manager
from models.response_models import CamelCaseModel

router = APIRouter(prefix="/text", tags=["text-processing"])


class SegmentTextResponse(CamelCaseModel):
    """Response for text segmentation endpoint"""
    success: bool
    method: str
    language: str
    segment_count: int
    segments: List[str]


class SegmentRequest(BaseModel):
    text: str
    method: Literal["sentences", "paragraphs", "smart", "length"] = "smart"
    language: str = "de"
    engine_name: str = ""  # Empty = use default from settings
    min_length: int = 50
    max_length: int = 500


@router.post("/segment", response_model=SegmentTextResponse)
async def segment_text(request: SegmentRequest) -> SegmentTextResponse:
    """
    Segment text using the configured text processing engine.

    Args:
        request: Segmentation parameters

    Returns:
        List of text segments
    """
    text_manager = get_text_engine_manager()

    # Resolve engine name: request > settings > first available
    engine_name = request.engine_name
    if not engine_name:
        from db.database import get_db_connection
        from services.settings_service import SettingsService
        with get_db_connection() as conn:
            settings_service = SettingsService(conn)
            engine_name = settings_service.get_setting('text.defaultTextEngine') or ""

    if not engine_name and text_manager._engine_metadata:
        engine_name = next(iter(text_manager._engine_metadata.keys()))

    if not engine_name:
        raise HTTPException(status_code=400, detail="[TEXT_NO_ENGINE_AVAILABLE]")

    if engine_name not in text_manager._engine_metadata:
        raise HTTPException(status_code=400, detail=f"[TEXT_ENGINE_NOT_FOUND]engine:{engine_name}")

    try:
        await text_manager.ensure_engine_ready(engine_name, request.language)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"[TEXT_SEGMENTER_LOAD_FAILED]engine:{engine_name};language:{request.language};error:{str(e)}"
        )

    try:
        if request.method in ["sentences", "smart"]:
            segment_response = await text_manager.segment_with_engine(
                engine_name=engine_name,
                text=request.text,
                language=request.language,
                parameters={'max_length': request.max_length}
            )
            segments = [seg.get('text', '') for seg in segment_response.get('segments', [])]

        elif request.method == "paragraphs":
            import re
            paragraphs = re.split(r'\n\s*\n', request.text)
            segments = [p.strip() for p in paragraphs if p.strip()]

        elif request.method == "length":
            target_length = (request.min_length + request.max_length) // 2
            segment_response = await text_manager.segment_with_engine(
                engine_name=engine_name,
                text=request.text,
                language=request.language,
                parameters={'max_length': target_length * 2}
            )
            segments = [seg.get('text', '') for seg in segment_response.get('segments', [])]

        else:
            raise HTTPException(status_code=400, detail=f"[TEXT_INVALID_METHOD]method:{request.method}")

        return SegmentTextResponse(
            success=True,
            method=request.method,
            language=request.language,
            segment_count=len(segments),
            segments=segments
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"[TEXT_SEGMENTATION_FAILED]error:{str(e)}")
