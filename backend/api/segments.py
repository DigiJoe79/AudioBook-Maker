"""
API endpoints for segment management
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
import sqlite3
from loguru import logger

from core.exceptions import ApplicationError
from db.database import get_db
from db.repositories import SegmentRepository
from models.response_models import SegmentResponse, DeleteResponse, ReorderResponse, to_camel
from config import OUTPUT_DIR
from services.event_broadcaster import broadcaster, EventType, safe_broadcast

router = APIRouter(tags=["segments"])


class SegmentCreate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    chapter_id: str
    text: str
    order_index: int
    segment_type: str = 'standard'  # 'standard' or 'divider'
    pause_duration: int = 0  # milliseconds (for dividers)
    tts_engine: str = ''
    tts_model_name: str = ''
    tts_speaker_name: Optional[str] = None
    language: str = ''
    audio_path: Optional[str] = None
    start_time: float = 0.0
    end_time: float = 0.0
    status: str = 'pending'


class SegmentUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    text: Optional[str] = None
    audio_path: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    status: Optional[str] = None
    pause_duration: Optional[int] = None
    tts_engine: Optional[str] = None
    tts_model_name: Optional[str] = None
    language: Optional[str] = None
    tts_speaker_name: Optional[str] = None


class ReorderSegmentsRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    segment_ids: List[str]
    chapter_id: str


class MoveSegmentRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    new_chapter_id: str
    new_order_index: int


@router.post("/segments", response_model=SegmentResponse)
async def create_segment(
    segment: SegmentCreate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Create a new segment

    Supports two types:
    - standard: Regular text segment (requires engine, model_name, language)
    - divider: Pause/scene break (only needs pause_duration)
    """
    try:
        segment_repo = SegmentRepository(conn)

        new_segment = segment_repo.create(
            chapter_id=segment.chapter_id,
            text=segment.text,
            order_index=segment.order_index,
            tts_engine=segment.tts_engine,
            tts_model_name=segment.tts_model_name,
            tts_speaker_name=segment.tts_speaker_name,
            language=segment.language,
            audio_path=segment.audio_path,
            start_time=segment.start_time,
            end_time=segment.end_time,
            status=segment.status,
            segment_type=segment.segment_type,
            pause_duration=segment.pause_duration
        )

        # Broadcast segment.created event for ALL segments (CRUD consistency)
        logger.debug(f"Broadcasting segment.created event: segmentId={new_segment['id']}, chapterId={new_segment['chapter_id']}")
        await safe_broadcast(
            broadcaster.broadcast_event,
            event_type=EventType.SEGMENT_CREATED,
            data={
                "segmentId": new_segment["id"],
                "chapterId": new_segment["chapter_id"],
                "text": new_segment.get("text", ""),
                "segmentType": new_segment.get("segment_type", "standard"),
                "orderIndex": new_segment.get("order_index", 0)
            },
            channel="projects",
            event_description="segment.created"
        )

        # Additional segment.updated event for divider segments (triggers audio/waveform update)
        # Standard segments get segment.completed after TTS generation
        if new_segment.get("segment_type") == "divider" and new_segment.get("pause_duration", 0) > 0:
            logger.debug(f"Broadcasting segment.updated event for new divider: segmentId={new_segment['id']}, chapterId={new_segment['chapter_id']}")
            await safe_broadcast(
                broadcaster.broadcast_segment_update,
                {
                    "segmentId": new_segment["id"],
                    "chapterId": new_segment["chapter_id"],
                    "pauseDuration": new_segment.get("pause_duration"),
                },
                event_description="segment.updated for divider"
            )

        return new_segment
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to create segment: {e}", exc_info=True)
        raise ApplicationError("SEGMENT_CREATE_FAILED", status_code=500, error=str(e))


@router.get("/segments/{segment_id}", response_model=SegmentResponse)
async def get_segment(segment_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Get a single segment by ID.

    Used for segment detail view and editing.
    """
    try:
        segment_repo = SegmentRepository(conn)

        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            raise ApplicationError("SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)

        return segment
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to get segment {segment_id}: {e}", exc_info=True)
        raise ApplicationError("SEGMENT_GET_FAILED", status_code=500, segmentId=segment_id, error=str(e))


@router.put("/segments/{segment_id}", response_model=SegmentResponse)
async def update_segment(
    segment_id: str,
    segment: SegmentUpdate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Update segment text, audio, or TTS parameters.

    Deletes quality analysis if text changes. Broadcasts segment.updated SSE event.
    """
    try:
        from db.segments_analysis_repository import SegmentsAnalysisRepository

        segment_repo = SegmentRepository(conn)
        analysis_repo = SegmentsAnalysisRepository(conn)

        # If text is changed, delete analysis (text is now different from analyzed audio)
        if segment.text is not None:
            deleted = analysis_repo.delete_by_segment_id(segment_id)
            if deleted:
                logger.debug(f"Deleted segment analysis for {segment_id} (text changed)")

        updated = segment_repo.update(
            segment_id,
            text=segment.text,
            audio_path=segment.audio_path,
            start_time=segment.start_time,
            end_time=segment.end_time,
            status=segment.status,
            pause_duration=segment.pause_duration,
            tts_engine=segment.tts_engine,
            tts_model_name=segment.tts_model_name,
            language=segment.language,
            tts_speaker_name=segment.tts_speaker_name
        )

        if not updated:
            raise ApplicationError("SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)

        # Broadcast SSE event for real-time UI updates (including MSE player hot-swap)
        logger.debug(f"Broadcasting segment.updated event: segmentId={updated['id']}, chapterId={updated['chapter_id']}")
        await safe_broadcast(
            broadcaster.broadcast_segment_update,
            {
                "segmentId": updated["id"],
                "chapterId": updated["chapter_id"],
                "pauseDuration": updated.get("pause_duration"),
                "text": updated.get("text"),
            },
            event_description="segment.updated"
        )

        return updated
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to update segment {segment_id}: {e}", exc_info=True)
        raise ApplicationError("SEGMENT_UPDATE_FAILED", status_code=500, segmentId=segment_id, error=str(e))


@router.delete("/segments/{segment_id}", response_model=DeleteResponse)
async def delete_segment(segment_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Delete a segment and its audio file.

    Deletes audio file and quality analysis. Broadcasts segment.deleted and chapter.updated SSE events.
    """
    try:
        from pathlib import Path
        import os
        from db.segments_analysis_repository import SegmentsAnalysisRepository

        segment_repo = SegmentRepository(conn)
        analysis_repo = SegmentsAnalysisRepository(conn)

        # Get segment to delete its audio file
        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            raise ApplicationError("SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)

        # Delete audio file if it exists
        if segment.get('audio_path'):
            try:
                # audio_path is just the filename (e.g., segment_123.wav)
                filename = segment['audio_path']
                audio_file = Path(OUTPUT_DIR) / filename

                if audio_file.exists():
                    os.remove(audio_file)
                    logger.debug(f"[OK] Deleted audio file: {filename}")
                else:
                    logger.warning(f"Audio file not found: {audio_file}")
            except Exception as e:
                # Log but don't fail the deletion
                logger.warning(f"Could not delete audio file for segment {segment_id}: {e}")

        # Delete segment analysis (if exists)
        analysis_repo.delete_by_segment_id(segment_id)

        # Delete segment from database
        if not segment_repo.delete(segment_id):
            raise ApplicationError("SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)

        chapter_id = segment.get("chapter_id")

        # Broadcast SSE events
        # Broadcast segment.deleted event (CRUD consistency)
        logger.debug(f"Broadcasting segment.deleted event: segmentId={segment_id}, chapterId={chapter_id}")
        await safe_broadcast(
            broadcaster.broadcast_event,
            event_type=EventType.SEGMENT_DELETED,
            data={"segmentId": segment_id, "chapterId": chapter_id},
            channel="projects",
            event_description="segment.deleted"
        )

        # Also broadcast chapter.updated event to trigger AudioPlayer refresh
        # (on "projects" channel for unified channel architecture)
        logger.debug(f"Broadcasting chapter.updated event after segment deletion: chapterId={chapter_id}")
        await safe_broadcast(
            broadcaster.broadcast_event,
            event_type=EventType.CHAPTER_UPDATED,
            data={"chapterId": chapter_id},
            channel="projects",
            event_description="chapter.updated after segment deletion"
        )

        return DeleteResponse(
            success=True,
            message="Segment deleted"
        )
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to delete segment {segment_id}: {e}", exc_info=True)
        raise ApplicationError("SEGMENT_DELETE_FAILED", status_code=500, segmentId=segment_id, error=str(e))


@router.post("/segments/reorder", response_model=ReorderResponse)
async def reorder_segments(
    data: ReorderSegmentsRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Reorder segments within a chapter.

    Array index determines new position. Broadcasts segment.reordered SSE event.
    """
    try:
        segment_repo = SegmentRepository(conn)

        # Validate segments belong to chapter
        for segment_id in data.segment_ids:
            segment = segment_repo.get_by_id(segment_id)
            if not segment:
                raise ApplicationError("SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)
            if segment['chapter_id'] != data.chapter_id:
                raise ApplicationError("SEGMENT_CHAPTER_MISMATCH", status_code=400, segmentId=segment_id, chapterId=data.chapter_id)

        # Reorder
        segment_repo.reorder_batch(data.segment_ids, data.chapter_id)

        # Broadcast segment.reordered event (CRUD consistency)
        logger.debug(f"Broadcasting segment.reordered event: chapterId={data.chapter_id}, segments={len(data.segment_ids)}")
        await safe_broadcast(
            broadcaster.broadcast_event,
            event_type=EventType.SEGMENT_REORDERED,
            data={"chapterId": data.chapter_id, "segmentIds": data.segment_ids},
            channel="projects",
            event_description="segment.reordered"
        )

        return ReorderResponse(
            success=True,
            message=f"Reordered {len(data.segment_ids)} segments",
            count=len(data.segment_ids)
        )
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to reorder segments: {e}", exc_info=True)
        raise ApplicationError("SEGMENT_REORDER_FAILED", status_code=500, chapterId=data.chapter_id, error=str(e))


@router.put("/segments/{segment_id}/move", response_model=SegmentResponse)
async def move_segment(
    segment_id: str,
    data: MoveSegmentRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Move segment to another chapter.

    Updates chapter_id and reorders segments in both source and target chapters.
    """
    try:
        from db.repositories import ChapterRepository

        segment_repo = SegmentRepository(conn)
        chapter_repo = ChapterRepository(conn)

        # Validate segment exists
        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            raise ApplicationError("SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)

        # Validate new chapter exists
        if not chapter_repo.get_by_id(data.new_chapter_id):
            raise ApplicationError("TARGET_CHAPTER_NOT_FOUND", status_code=404, chapterId=data.new_chapter_id)

        logger.debug(
            f"[segments] move_segment segment_id={segment_id} "
            f"from_chapter={segment['chapter_id']} to_chapter={data.new_chapter_id} "
            f"new_order_index={data.new_order_index}"
        )

        # Move segment
        updated_segment = segment_repo.move_to_chapter(
            segment_id,
            data.new_chapter_id,
            data.new_order_index
        )

        return updated_segment
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to move segment {segment_id}: {e}", exc_info=True)
        raise ApplicationError("SEGMENT_MOVE_FAILED", status_code=500, segmentId=segment_id, targetChapterId=data.new_chapter_id, error=str(e))


class FreezeSegmentRequest(BaseModel):
    """Request body for freezing/unfreezing a segment"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    freeze: bool


@router.patch("/segments/{segment_id}/freeze", response_model=SegmentResponse)
async def toggle_freeze_segment(
    segment_id: str,
    data: FreezeSegmentRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Freeze or unfreeze a segment.

    Frozen segments are:
    - Protected from regeneration (TTS jobs skip them)
    - Protected from STT analysis
    - Visually marked with blue background + checkmark

    Request body:
    {
      "freeze": true  // or false
    }
    """
    segment_repo = SegmentRepository(conn)

    # Validate segment exists
    segment = segment_repo.get_by_id(segment_id)
    if not segment:
        raise ApplicationError("SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)

    logger.debug(
        f"[segments] toggle_freeze_segment segment_id={segment_id} "
        f"freeze={data.freeze} chapter_id={segment['chapter_id']}"
    )

    # Update frozen status
    try:
        updated_segment = segment_repo.set_frozen(segment_id, data.freeze)
    except ValueError as e:
        raise ApplicationError("SEGMENT_FREEZE_FAILED", status_code=404, segmentId=segment_id, error=str(e))

    # Broadcast SSE event
    event_type = EventType.SEGMENT_FROZEN if data.freeze else EventType.SEGMENT_UNFROZEN

    await broadcaster.broadcast_event(
        event_type=event_type,
        data={
            "segmentId": segment_id,
            "chapterId": updated_segment["chapter_id"],
            "isFrozen": data.freeze
        },
        channel="jobs"
    )

    logger.debug(f"{'Frozen' if data.freeze else 'Unfrozen'} segment {segment_id}")

    return updated_segment
