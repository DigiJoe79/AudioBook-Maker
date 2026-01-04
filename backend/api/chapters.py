"""
API endpoints for chapter management
"""
from fastapi import APIRouter, Depends
from core.exceptions import ApplicationError
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
import sqlite3
from loguru import logger

from db.database import get_db
from services.event_broadcaster import broadcaster, EventType, safe_broadcast
from db.repositories import ChapterRepository, SegmentRepository
from core.text_engine_manager import get_text_engine_manager
from core.tts_engine_manager import get_tts_engine_manager
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
    # Note: Always uses sentence-based segmentation (segment_by_sentences)
    language: str  # Text engine language for segmentation
    tts_engine: str  # Engine selection (required - determines max/min length constraints)
    tts_model_name: str  # Model name for TTS generation (required)
    tts_language: Optional[str] = None  # TTS language (optional, defaults to segmentation language if not provided)
    tts_speaker_name: Optional[str] = None  # Speaker for TTS generation (optional)
    max_length: Optional[int] = None  # Optional override (auto-detected from engine if not provided)


@router.post("/chapters", response_model=ChapterResponse)
async def create_chapter(
    chapter: ChapterCreate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Create a new chapter.

    Broadcasts chapter.created SSE event.
    """
    try:
        chapter_repo = ChapterRepository(conn)

        new_chapter = chapter_repo.create(
            chapter.project_id,
            chapter.title,
            chapter.order_index
        )

        # Emit SSE event
        await safe_broadcast(
            broadcaster.broadcast_chapter_crud,
            {
                "chapterId": new_chapter['id'],
                "projectId": new_chapter['project_id'],
                "title": new_chapter['title'],
                "orderIndex": new_chapter['order_index']
            },
            event_type=EventType.CHAPTER_CREATED,
            event_description="chapter.created"
        )

        # Add empty segments list
        new_chapter['segments'] = []
        return new_chapter
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to create chapter: {e}", exc_info=True)
        raise ApplicationError("CHAPTER_CREATE_FAILED", status_code=500, error=str(e))


@router.get("/chapters/{chapter_id}", response_model=ChapterWithSegmentsResponse)
async def get_chapter(chapter_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Get a chapter with its segments.

    Used for chapter detail view and segment list rendering.
    """
    try:
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)

        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise ApplicationError("CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

        segments = segment_repo.get_by_chapter(chapter_id)
        chapter['segments'] = segments

        return chapter
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to get chapter {chapter_id}: {e}", exc_info=True)
        raise ApplicationError("CHAPTER_GET_FAILED", status_code=500, chapterId=chapter_id, error=str(e))


@router.put("/chapters/{chapter_id}", response_model=ChapterWithSegmentsResponse)
async def update_chapter(
    chapter_id: str,
    chapter: ChapterUpdate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Update chapter title and order.

    Broadcasts chapter.updated SSE event.
    """
    try:
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)

        updated = chapter_repo.update(
            chapter_id,
            title=chapter.title,
            order_index=chapter.order_index
        )

        if not updated:
            raise ApplicationError("CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

        segments = segment_repo.get_by_chapter(chapter_id)
        updated['segments'] = segments

        # Emit SSE event
        await safe_broadcast(
            broadcaster.broadcast_chapter_crud,
            {
                "chapterId": updated['id'],
                "projectId": updated['project_id'],
                "title": updated['title'],
                "orderIndex": updated.get('order_index')
            },
            event_type=EventType.CHAPTER_UPDATED,
            event_description="chapter.updated"
        )

        return updated
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to update chapter {chapter_id}: {e}", exc_info=True)
        raise ApplicationError("CHAPTER_UPDATE_FAILED", status_code=500, chapterId=chapter_id, error=str(e))


@router.post("/chapters/{chapter_id}/segment", response_model=TextSegmentationResponse)
async def segment_chapter_text(
    chapter_id: str,
    request: SegmentTextRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Segment chapter text into natural segments using text engine and create them in the database

    Args:
        chapter_id: Chapter ID to segment
        request: Segmentation parameters (including engine for constraint detection)

    Returns:
        Created segments with validation status
    """
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    chapter = chapter_repo.get_by_id(chapter_id)
    if not chapter:
        raise ApplicationError("CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

    logger.debug(
        f"[chapters] segment_chapter_text START chapter_id={chapter_id} "
        f"text_length={len(request.text)} engine={request.tts_engine}"
    )

    # Get engine constraints (lightweight - don't load model)
    tts_manager = get_tts_engine_manager()

    try:
        # Check if engine type is valid
        if request.tts_engine not in tts_manager.list_available_engines():
            raise ApplicationError(
                "CHAPTER_UNKNOWN_ENGINE",
                status_code=400,
                engine=request.tts_engine,
                available=','.join(tts_manager.list_available_engines())
            )

        # Get engine constraints from metadata (Single Source of Truth)
        metadata = tts_manager.get_engine_metadata(request.tts_engine)
        constraints = (metadata.get('constraints') or {}) if metadata else {}

        engine_max = constraints.get('max_text_length', 500)

        # Get user preference from settings
        from services.settings_service import SettingsService
        settings_service = SettingsService(conn)
        user_pref = settings_service.get_setting('text.preferredMaxSegmentLength') or 250

        # Use the minimum of user preference and engine max (unless explicitly overridden)
        max_length = request.max_length if request.max_length is not None else min(user_pref, engine_max)

        logger.info(f"Segmentation limits - User pref: {user_pref}, Engine max: {engine_max}, Using: {max_length}")

    except ApplicationError:
        raise
    except Exception as e:
        raise ApplicationError(
            "CHAPTER_ENGINE_CONSTRAINTS_FAILED",
            status_code=500,
            error=str(e)
        )

    # Get text engine manager
    text_manager = get_text_engine_manager()

    # Resolve text engine: settings > first available
    text_engine_name = settings_service.get_default_engine('text') or ""

    if not text_engine_name:
        installed = text_manager.list_installed_engines()
        if installed:
            text_engine_name = installed[0]

    if not text_engine_name:
        raise ApplicationError("TEXT_NO_ENGINE_AVAILABLE", status_code=400)

    # Pass language code - engine will select appropriate model
    try:
        await text_manager.ensure_engine_ready(text_engine_name, request.language)
    except Exception as e:
        raise ApplicationError(
            "TEXT_SEGMENTER_LOAD_FAILED",
            status_code=500,
            language=request.language,
            error=str(e)
        )

    # Perform sentence-based segmentation via TextEngineManager
    # This ensures segments never break in the middle of sentences (maintains TTS quality)
    try:
        segment_response = await text_manager.segment_with_engine(
            engine_name=text_engine_name,
            text=request.text,
            language=request.language,
            parameters={'max_length': max_length}
        )

        # Convert response format from text engine to expected format
        # Text engine returns: {"segments": [{"text": str, "start": int, "end": int}, ...], ...}
        # We need: [{"text": str, "order_index": int, "status": str, ...}, ...]
        segments = []
        for idx, seg in enumerate(segment_response.get('segments', [])):
            seg_text = seg.get('text', '')
            seg_length = len(seg_text)

            # Check if segment exceeds max_length (mark as failed)
            if seg_length > max_length:
                segments.append({
                    "text": seg_text,
                    "order_index": idx,
                    "status": "failed",
                    "length": seg_length,
                    "max_length": max_length,
                    "issue": "sentence_too_long"
                })
            else:
                segments.append({
                    "text": seg_text,
                    "order_index": idx,
                    "status": "ok"
                })

    except Exception as e:
        raise ApplicationError(
            "TEXT_SEGMENTATION_FAILED",
            status_code=500,
            error=str(e)
        )

    # Create segments in database
    logger.info(f"[Text Segmentation] Creating {len(segments)} segments")
    logger.info(f"[Text Segmentation] Speaker: '{request.tts_speaker_name}' (type: {type(request.tts_speaker_name)})")
    logger.info(f"[Text Segmentation] Engine: {request.tts_engine}, Model: {request.tts_model_name}")

    from services.segment_validator import SegmentValidator

    # Get existing segments count to append new segments at the end
    existing_segments = segment_repo.get_by_chapter(chapter_id)
    offset = len(existing_segments)
    logger.info(f"[Text Segmentation] Found {offset} existing segments, new segments will start at index {offset}")

    created_segments = []
    for seg in segments:
        # Check if text engine already marked segment as failed (oversized sentence)
        engine_status = seg.get("status", "ok")

        if engine_status == "failed":
            # Text engine detected single sentence > max_length
            # Trust engine's decision (intelligent sentence-boundary detection)
            segment_status = 'failed'
            logger.warning(
                f"Segment {seg['order_index']} marked as 'failed' by text engine: "
                f"Single sentence exceeds max_length ({seg.get('length')}/{seg.get('max_length')} chars). "
                f"User must shorten or split this sentence."
            )
        else:
            # Validate segment text length against engine constraints
            # (Secondary check for edge cases)
            validation = SegmentValidator.validate_text_length(
                text=seg["text"],
                engine_name=request.tts_engine,
                language=request.language,
                constraints=constraints
            )

            # Determine status based on validation
            if validation['is_valid']:
                segment_status = 'pending'
            else:
                segment_status = 'failed'
                logger.warning(
                    f"Segment {seg['order_index']} exceeds max length: "
                    f"{validation['text_length']}/{validation['max_length']} chars. "
                    f"Created as 'failed'. User must edit to shorten text."
                )

        created_seg = segment_repo.create(
            chapter_id=chapter_id,
            text=seg["text"],
            order_index=seg["order_index"] + offset,  # Append after existing segments
            tts_engine=request.tts_engine,
            tts_model_name=request.tts_model_name,  # Required - no fallback
            tts_speaker_name=request.tts_speaker_name,
            language=request.tts_language or request.language,  # Use TTS language if provided, otherwise text segmentation language
            status=segment_status
        )
        if seg["order_index"] == 0:  # Log first segment
            logger.info(f"[Text Segmentation] First segment tts_speaker_name: '{created_seg.get('tts_speaker_name')}'")
        created_segments.append(created_seg)

    return TextSegmentationResponse(
        success=True,
        message=f"Created {len(created_segments)} segments using {request.tts_engine} constraints (max={max_length})",
        segments=created_segments,
        segment_count=len(created_segments),
        engine=request.tts_engine,
        constraints={
            "max_length": max_length
        }
    )


@router.delete("/chapters/{chapter_id}", response_model=DeleteResponse)
async def delete_chapter(chapter_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Delete a chapter and its audio files.

    Cascade deletes all segments. Broadcasts chapter.deleted SSE event.
    """
    try:
        from pathlib import Path
        import os

        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)

        # Get chapter info before deletion (for SSE event)
        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise ApplicationError("CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

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
            raise ApplicationError("CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

        # Emit SSE event
        await safe_broadcast(
            broadcaster.broadcast_chapter_crud,
            {
                "chapterId": chapter_id,
                "projectId": chapter['project_id'],
                "title": chapter['title']
            },
            event_type=EventType.CHAPTER_DELETED,
            event_description="chapter.deleted"
        )

        return DeleteResponse(
            success=True,
            message=f"Chapter deleted (removed {deleted_files} audio files)"
        )
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to delete chapter {chapter_id}: {e}", exc_info=True)
        raise ApplicationError("CHAPTER_DELETE_FAILED", status_code=500, chapterId=chapter_id, error=str(e))


@router.post("/chapters/reorder", response_model=ReorderResponse)
async def reorder_chapters(
    data: ReorderChaptersRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Reorder chapters within a project.

    Array index determines new position. Broadcasts chapter.reordered SSE event.
    """
    try:
        chapter_repo = ChapterRepository(conn)

        # Validate chapters belong to project
        for chapter_id in data.chapter_ids:
            chapter = chapter_repo.get_by_id(chapter_id)
            if not chapter:
                raise ApplicationError("CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)
            if chapter['project_id'] != data.project_id:
                raise ApplicationError(
                    "CHAPTER_PROJECT_MISMATCH",
                    status_code=400,
                    chapterId=chapter_id,
                    projectId=data.project_id
                )

        # Reorder
        chapter_repo.reorder_batch(data.chapter_ids, data.project_id)

        # Emit SSE event with updated chapter order
        chapters_order = [
            {"chapterId": chapter_id, "orderIndex": idx}
            for idx, chapter_id in enumerate(data.chapter_ids)
        ]
        await safe_broadcast(
            broadcaster.broadcast_chapter_crud,
            {
                "projectId": data.project_id,
                "chapters": chapters_order
            },
            event_type=EventType.CHAPTER_REORDERED,
            event_description="chapter.reordered"
        )

        return ReorderResponse(
            success=True,
            message=f"Reordered {len(data.chapter_ids)} chapters",
            count=len(data.chapter_ids)
        )
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to reorder chapters: {e}", exc_info=True)
        raise ApplicationError("CHAPTER_REORDER_FAILED", status_code=500, projectId=data.project_id, error=str(e))


@router.put("/chapters/{chapter_id}/move", response_model=ChapterWithSegmentsResponse)
async def move_chapter(
    chapter_id: str,
    data: MoveChapterRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Move chapter to another project.

    Updates project_id and reorders chapters in both source and target projects.
    """
    try:
        from db.repositories import ProjectRepository

        chapter_repo = ChapterRepository(conn)
        project_repo = ProjectRepository(conn)

        # Validate chapter exists
        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise ApplicationError("CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

        # Validate new project exists
        if not project_repo.get_by_id(data.new_project_id):
            raise ApplicationError("TARGET_PROJECT_NOT_FOUND", status_code=404, projectId=data.new_project_id)

        logger.debug(
            f"[chapters] move_chapter chapter_id={chapter_id} "
            f"from_project={chapter['project_id']} to_project={data.new_project_id} "
            f"new_order_index={data.new_order_index}"
        )

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
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to move chapter {chapter_id}: {e}", exc_info=True)
        raise ApplicationError("CHAPTER_MOVE_FAILED", status_code=500, chapterId=chapter_id, error=str(e))
