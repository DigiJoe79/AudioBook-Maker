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
from services.tts_manager import get_tts_manager
from models.response_models import (
    ChapterResponse,
    ChapterWithSegmentsResponse,
    TextSegmentationResponse,
    DeleteResponse,
    ReorderResponse,
    to_camel
)
from config import OUTPUT_DIR

router = APIRouter(tags=["chapters"])


class ChapterCreate(BaseModel):
    model_config = ConfigDict(
        protected_namespaces=(),
        alias_generator=to_camel,
        populate_by_name=True
    )

    project_id: str
    title: str
    order_index: int
    default_engine: str
    default_model_name: str


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
        protected_namespaces=(),
        alias_generator=to_camel,
        populate_by_name=True
    )

    text: str
    method: Literal["sentences", "paragraphs", "smart", "length"] = "smart"
    language: str
    engine: str
    model_name: str
    speaker_name: Optional[str] = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    auto_create: bool = False


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
        chapter.default_engine,
        chapter.default_model_name
    )

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

    chapter = chapter_repo.get_by_id(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    manager = get_tts_manager()

    try:
        if request.engine not in manager.list_available_engines():
            raise HTTPException(
                status_code=400,
                detail=f"Unknown engine type: {request.engine}. Available engines: {manager.list_available_engines()}"
            )

        engine_class = manager._engine_classes[request.engine]
        temp_engine = engine_class()

        engine_max = temp_engine.get_max_text_length(request.language)
        engine_min = temp_engine.get_min_text_length()

        from services.settings_service import SettingsService
        settings_service = SettingsService(conn)
        user_pref = settings_service.get_setting('text.preferredMaxSegmentLength') or 250

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

    try:
        segmenter = get_segmenter(request.language)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load text segmenter: {str(e)}"
        )

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

    if request.auto_create:
        logger.info(f"[Text Segmentation] Creating {len(segments)} segments")
        logger.info(f"[Text Segmentation] Speaker: '{request.speaker_name}' (type: {type(request.speaker_name)})")
        logger.info(f"[Text Segmentation] Engine: {request.engine}, Model: {request.model_name}")

        created_segments = []
        for seg in segments:
            created_seg = segment_repo.create(
                chapter_id=chapter_id,
                text=seg["text"],
                order_index=seg["order_index"],
                engine=request.engine,
                model_name=request.model_name,
                speaker_name=request.speaker_name,
                language=request.language,
                status="pending"
            )
            if seg["order_index"] == 0:
                logger.info(f"[Text Segmentation] First segment speaker_name: '{created_seg.get('speaker_name')}'")
            created_segments.append(created_seg)

        return {
            "success": True,
            "message": f"Created {len(created_segments)} segments using {request.engine} constraints (min={min_length}, max={max_length})",
            "segments": created_segments,
            "segment_count": len(created_segments),
            "engine": request.engine,
            "constraints": {
                "min_length": min_length,
                "max_length": max_length
            }
        }

    return {
        "success": True,
        "message": f"Generated {len(segments)} segments (preview mode) using {request.engine} constraints",
        "segments": segments,
        "segment_count": len(segments),
        "engine": request.engine,
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

    segments = segment_repo.get_by_chapter(chapter_id)

    deleted_files = 0
    for segment in segments:
        if segment.get('audio_path'):
            try:
                audio_url = segment['audio_path']
                if '/audio/' in audio_url:
                    filename = audio_url.split('/audio/')[-1]
                    audio_file = Path(OUTPUT_DIR) / filename

                    if audio_file.exists():
                        os.remove(audio_file)
                        deleted_files += 1
            except Exception as e:
                logger.warning(f"Could not delete audio file for segment {segment['id']}: {e}")

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

    for chapter_id in data.chapter_ids:
        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise HTTPException(status_code=404, detail=f"Chapter {chapter_id} not found")
        if chapter['project_id'] != data.project_id:
            raise HTTPException(
                status_code=400,
                detail=f"Chapter {chapter_id} does not belong to project {data.project_id}"
            )

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

    chapter = chapter_repo.get_by_id(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    if not project_repo.get_by_id(data.new_project_id):
        raise HTTPException(status_code=404, detail="Target project not found")

    updated_chapter = chapter_repo.move_to_project(
        chapter_id,
        data.new_project_id,
        data.new_order_index
    )

    segment_repo = SegmentRepository(conn)
    segments = segment_repo.get_by_chapter(chapter_id)
    updated_chapter['segments'] = segments

    return updated_chapter
