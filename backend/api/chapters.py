"""
API endpoints for chapter management
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict
from typing import Optional, Literal, List
import sqlite3
from loguru import logger

from db.database import get_db
from db.repositories import ChapterRepository, SegmentRepository
from services.text_segmenter import get_segmenter
from core.engine_manager import get_engine_manager
from models.response_models import (
    ChapterResponse,
    ChapterWithSegmentsResponse,
    TextSegmentationResponse,
    DeleteResponse,
    ReorderResponse,
    to_camel  # Import alias generator
)
from config import OUTPUT_DIR

router = APIRouter(tags=["chapters"])


class ChapterCreate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    project_id: str
    title: str
    order_index: int
    default_tts_engine: str
    default_tts_model_name: str


class ChapterUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    title: Optional[str] = None
    order_index: Optional[int] = None


class ReorderChaptersRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    chapter_ids: List[str]
    project_id: str


class MoveChapterRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    new_project_id: str
    new_order_index: int


class SegmentTextRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    text: str
    method: Literal["sentences", "paragraphs", "smart", "length"] = "smart"
    language: str
    tts_engine: str  # Engine selection (required - determines max/min length constraints)
    tts_model_name: str  # Model name for TTS generation (required)
    tts_speaker_name: Optional[str] = None  # Speaker for TTS generation (optional)
    min_length: Optional[int] = None  # Optional override (auto-detected from engine if not provided)
    max_length: Optional[int] = None  # Optional override (auto-detected from engine if not provided)
    auto_create: bool = False  # Automatically create segments in DB


@router.post("/chapters", response_model=ChapterResponse)
async def create_chapter(
    chapter: ChapterCreate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """Create a new chapter"""
    chapter_repo = ChapterRepository(conn)

    new_chapter = chapter_repo.create(
        chapter.project_id,
        chapter.title,
        chapter.order_index,
        chapter.default_tts_engine,
        chapter.default_tts_model_name
    )

    # Add empty segments list
    new_chapter['segments'] = []
    return new_chapter


@router.get("/chapters/{chapter_id}", response_model=ChapterWithSegmentsResponse)
async def get_chapter(chapter_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Get a chapter with its segments"""
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    chapter = chapter_repo.get_by_id(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    segments = segment_repo.get_by_chapter(chapter_id)
    chapter['segments'] = segments

    return chapter


@router.put("/chapters/{chapter_id}", response_model=ChapterWithSegmentsResponse)
async def update_chapter(
    chapter_id: str,
    chapter: ChapterUpdate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """Update a chapter"""
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    updated = chapter_repo.update(
        chapter_id,
        title=chapter.title,
        order_index=chapter.order_index
    )

    if not updated:
        raise HTTPException(status_code=404, detail="Chapter not found")

    segments = segment_repo.get_by_chapter(chapter_id)
    updated['segments'] = segments

    return updated


@router.post("/chapters/{chapter_id}/segment", response_model=TextSegmentationResponse)
async def segment_chapter_text(
    chapter_id: str,
    request: SegmentTextRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Segment chapter text into natural segments using spaCy

    Args:
        chapter_id: Chapter ID to segment
        request: Segmentation parameters (including engine for constraint detection)

    Returns:
        List of segments (preview if auto_create=False, or created segments if auto_create=True)
    """
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    # Verify chapter exists
    chapter = chapter_repo.get_by_id(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Get engine constraints (lightweight - don't load model)
    manager = get_engine_manager()

    try:
        # Check if engine type is valid
        if request.tts_engine not in manager.list_available_engines():
            raise HTTPException(
                status_code=400,
                detail=f"Unknown engine type: {request.tts_engine}. Available engines: {manager.list_available_engines()}"
            )

        # Get engine constraints from metadata
        metadata = manager._engine_metadata[request.tts_engine]
        constraints = metadata.get('constraints', {})

        engine_max = constraints.get('max_text_length', 500)
        engine_min = constraints.get('min_text_length', 10)

        # Get user preference from settings
        from services.settings_service import SettingsService
        settings_service = SettingsService(conn)
        user_pref = settings_service.get_setting('text.preferredMaxSegmentLength') or 250

        # Use the minimum of user preference and engine max (unless explicitly overridden)
        max_length = request.max_length if request.max_length is not None else min(user_pref, engine_max)
        min_length = request.min_length if request.min_length is not None else engine_min

        logger.info(f"Segmentation limits - User pref: {user_pref}, Engine max: {engine_max}, Using: {max_length}")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get engine constraints: {str(e)}"
        )

    # Get text segmenter for the specified language
    try:
        segmenter = get_segmenter(request.language)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load text segmenter: {str(e)}"
        )

    # Perform segmentation based on method
    if request.method == "sentences":
        segments = segmenter.segment_by_sentences(
            request.text,
            min_length=min_length,
            max_length=max_length
        )
    elif request.method == "paragraphs":
        segments = segmenter.segment_by_paragraphs(request.text)
    elif request.method == "smart":
        segments = segmenter.segment_smart(
            request.text,
            min_length=min_length,
            max_length=max_length
        )
    elif request.method == "length":
        segments = segmenter.segment_by_length(
            request.text,
            target_length=(min_length + max_length) // 2
        )
    else:
        raise HTTPException(status_code=400, detail=f"Invalid method: {request.method}")

    # If auto_create is enabled, create segments in database
    if request.auto_create:
        logger.info(f"[Text Segmentation] Creating {len(segments)} segments")
        logger.info(f"[Text Segmentation] Speaker: '{request.tts_speaker_name}' (type: {type(request.tts_speaker_name)})")
        logger.info(f"[Text Segmentation] Engine: {request.tts_engine}, Model: {request.tts_model_name}")

        created_segments = []
        for seg in segments:
            created_seg = segment_repo.create(
                chapter_id=chapter_id,
                text=seg["text"],
                order_index=seg["order_index"],
                tts_engine=request.tts_engine,
                tts_model_name=request.tts_model_name,  # Required - no fallback
                tts_speaker_name=request.tts_speaker_name,
                language=request.language,
                status="pending"
            )
            if seg["order_index"] == 0:  # Log first segment
                logger.info(f"[Text Segmentation] First segment tts_speaker_name: '{created_seg.get('tts_speaker_name')}'")
            created_segments.append(created_seg)

        return {
            "success": True,
            "message": f"Created {len(created_segments)} segments using {request.tts_engine} constraints (min={min_length}, max={max_length})",
            "segments": created_segments,
            "segment_count": len(created_segments),
            "engine": request.tts_engine,
            "constraints": {
                "min_length": min_length,
                "max_length": max_length
            }
        }

    # Otherwise return preview
    return {
        "success": True,
        "message": f"Generated {len(segments)} segments (preview mode) using {request.tts_engine} constraints",
        "segments": segments,
        "segment_count": len(segments),
        "engine": request.tts_engine,
        "constraints": {
            "min_length": min_length,
            "max_length": max_length
        }
    }


@router.delete("/chapters/{chapter_id}", response_model=DeleteResponse)
async def delete_chapter(chapter_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Delete a chapter and its audio files"""
    from pathlib import Path
    import os

    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    # Get all segments to delete their audio files
    segments = segment_repo.get_by_chapter(chapter_id)

    # Delete audio files
    deleted_files = 0
    for segment in segments:
        if segment.get('audio_path'):
            try:
                # audio_path is just the filename (e.g., segment_123.wav)
                filename = segment['audio_path']
                audio_file = Path(OUTPUT_DIR) / filename

                if audio_file.exists():
                    os.remove(audio_file)
                    deleted_files += 1
            except Exception as e:
                # Log but don't fail the deletion
                logger.warning(f"Could not delete audio file for segment {segment['id']}: {e}")

    # Delete chapter (CASCADE will delete segments)
    if not chapter_repo.delete(chapter_id):
        raise HTTPException(status_code=404, detail="Chapter not found")

    return {
        "success": True,
        "message": f"Chapter deleted (removed {deleted_files} audio files)"
    }


@router.post("/chapters/reorder", response_model=ReorderResponse)
async def reorder_chapters(
    data: ReorderChaptersRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Reorder chapters within a project

    Request body:
    {
      "chapter_ids": ["ch1", "ch2", "ch3"],
      "project_id": "proj1"
    }
    """
    chapter_repo = ChapterRepository(conn)

    # Validate chapters belong to project
    for chapter_id in data.chapter_ids:
        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise HTTPException(status_code=404, detail=f"Chapter {chapter_id} not found")
        if chapter['project_id'] != data.project_id:
            raise HTTPException(
                status_code=400,
                detail=f"Chapter {chapter_id} does not belong to project {data.project_id}"
            )

    # Reorder
    chapter_repo.reorder_batch(data.chapter_ids, data.project_id)

    return {
        "success": True,
        "message": f"Reordered {len(data.chapter_ids)} chapters",
        "count": len(data.chapter_ids)
    }


@router.put("/chapters/{chapter_id}/move", response_model=ChapterWithSegmentsResponse)
async def move_chapter(
    chapter_id: str,
    data: MoveChapterRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Move chapter to another project

    Request body:
    {
      "new_project_id": "proj2",
      "new_order_index": 0
    }
    """
    from db.repositories import ProjectRepository

    chapter_repo = ChapterRepository(conn)
    project_repo = ProjectRepository(conn)

    # Validate chapter exists
    chapter = chapter_repo.get_by_id(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Validate new project exists
    if not project_repo.get_by_id(data.new_project_id):
        raise HTTPException(status_code=404, detail="Target project not found")

    # Move chapter
    updated_chapter = chapter_repo.move_to_project(
        chapter_id,
        data.new_project_id,
        data.new_order_index
    )

    # Load segments for response
    segment_repo = SegmentRepository(conn)
    segments = segment_repo.get_by_chapter(chapter_id)
    updated_chapter['segments'] = segments

    return updated_chapter
