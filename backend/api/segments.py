"""
API endpoints for segment management
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
import sqlite3
from loguru import logger

from db.database import get_db
from db.repositories import SegmentRepository
from models.response_models import SegmentResponse, DeleteResponse, ReorderResponse, to_camel
from config import OUTPUT_DIR

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

    return new_segment


@router.get("/segments/{segment_id}", response_model=SegmentResponse)
async def get_segment(segment_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Get a segment"""
    segment_repo = SegmentRepository(conn)

    segment = segment_repo.get_by_id(segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    return segment


@router.put("/segments/{segment_id}", response_model=SegmentResponse)
async def update_segment(
    segment_id: str,
    segment: SegmentUpdate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """Update a segment"""
    segment_repo = SegmentRepository(conn)

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
        raise HTTPException(status_code=404, detail="Segment not found")

    return updated


@router.delete("/segments/{segment_id}", response_model=DeleteResponse)
async def delete_segment(segment_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Delete a segment and its audio file"""
    from pathlib import Path
    import os

    segment_repo = SegmentRepository(conn)

    # Get segment to delete its audio file
    segment = segment_repo.get_by_id(segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Delete audio file if it exists
    if segment.get('audio_path'):
        try:
            # audio_path is just the filename (e.g., segment_123.wav)
            filename = segment['audio_path']
            audio_file = Path(OUTPUT_DIR) / filename

            if audio_file.exists():
                os.remove(audio_file)
                logger.info(f"✓ Deleted audio file: {filename}")
            else:
                logger.warning(f"Audio file not found: {audio_file}")
        except Exception as e:
            # Log but don't fail the deletion
            logger.warning(f"Could not delete audio file for segment {segment_id}: {e}")

    # Delete segment from database
    if not segment_repo.delete(segment_id):
        raise HTTPException(status_code=404, detail="Segment not found")

    return {"success": True, "message": "Segment deleted"}


@router.post("/segments/reorder", response_model=ReorderResponse)
async def reorder_segments(
    data: ReorderSegmentsRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Reorder segments within a chapter

    Request body:
    {
      "segment_ids": ["seg1", "seg2", "seg3"],
      "chapter_id": "ch1"
    }
    """
    segment_repo = SegmentRepository(conn)

    # Validate segments belong to chapter
    for segment_id in data.segment_ids:
        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            raise HTTPException(status_code=404, detail=f"Segment {segment_id} not found")
        if segment['chapter_id'] != data.chapter_id:
            raise HTTPException(
                status_code=400,
                detail=f"Segment {segment_id} does not belong to chapter {data.chapter_id}"
            )

    # Reorder
    segment_repo.reorder_batch(data.segment_ids, data.chapter_id)

    return {
        "success": True,
        "message": f"Reordered {len(data.segment_ids)} segments",
        "count": len(data.segment_ids)
    }


@router.put("/segments/{segment_id}/move", response_model=SegmentResponse)
async def move_segment(
    segment_id: str,
    data: MoveSegmentRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Move segment to another chapter

    Request body:
    {
      "new_chapter_id": "ch2",
      "new_order_index": 0
    }
    """
    from db.repositories import ChapterRepository

    segment_repo = SegmentRepository(conn)
    chapter_repo = ChapterRepository(conn)

    # Validate segment exists
    segment = segment_repo.get_by_id(segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Validate new chapter exists
    if not chapter_repo.get_by_id(data.new_chapter_id):
        raise HTTPException(status_code=404, detail="Target chapter not found")

    # Move segment
    updated_segment = segment_repo.move_to_chapter(
        segment_id,
        data.new_chapter_id,
        data.new_order_index
    )

    return updated_segment
