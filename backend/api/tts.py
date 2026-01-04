"""
TTS (Text-to-Speech) generation endpoints
"""

from fastapi import APIRouter, Depends
from core.exceptions import ApplicationError
from pydantic import BaseModel, ConfigDict
from typing import Optional
from pathlib import Path
import sqlite3
from loguru import logger

from db.database import get_db, get_db_connection_simple
from db.repositories import SegmentRepository, TTSJobRepository, ChapterRepository
from db.segments_analysis_repository import SegmentsAnalysisRepository
from models.response_models import (
    SegmentQueueResponse,
    ChapterGenerationStartResponse,
    to_camel
)
from config import OUTPUT_DIR
from services.event_broadcaster import emit_job_created
import os

router = APIRouter()


def _prepare_segments_for_regeneration(
    segment_ids: list[str],
    segment_repo: SegmentRepository,
    analysis_repo: 'SegmentsAnalysisRepository' = None,
    tts_engine: str = None,
    tts_model_name: str = None,
    tts_speaker_name: str = None,
    language: str = None
) -> None:
    """
    Prepare segments for regeneration by deleting audio, Whisper analyses, and setting status to queued.

    This is called IMMEDIATELY when job is created (not when worker starts).
    User has made conscious decision to regenerate, so old audio is obsolete.
    Segments are set to 'queued' status to provide immediate UI feedback.

    Optionally updates TTS parameters if provided (when user changes settings via dialog).

    Args:
        segment_ids: List of segment IDs to prepare
        segment_repo: Segment repository instance
        analysis_repo: Optional segments analysis repository instance
        tts_engine: Optional engine to set on segments (when user changes via dialog)
        tts_model_name: Optional model to set on segments
        tts_speaker_name: Optional speaker to set on segments
        language: Optional language to set on segments
    """
    has_override = any([tts_engine, tts_model_name, tts_speaker_name, language])
    logger.debug(
        "_prepare_segments_for_regeneration called",
        segment_count=len(segment_ids),
        has_tts_override=has_override,
        override_engine=tts_engine,
        override_model=tts_model_name,
        override_speaker=tts_speaker_name,
        override_language=language
    )
    for segment_id in segment_ids:
        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            logger.warning(f"Segment {segment_id} not found, skipping")
            continue

        # Delete audio file if exists
        if segment.get('audio_path'):
            try:
                # Extract filename from URL: http://localhost:8765/audio/seg-123.wav → seg-123.wav
                filename = segment['audio_path'].split('/')[-1]
                audio_file_path = Path(OUTPUT_DIR) / filename

                if audio_file_path.exists():
                    os.remove(audio_file_path)
                    logger.debug(f"Deleted audio file for segment {segment_id}: {audio_file_path}")
            except Exception as e:
                logger.error(f"Failed to delete audio for segment {segment_id}: {e}")

        # Delete segment analysis if exists
        if analysis_repo:
            try:
                deleted = analysis_repo.delete_by_segment_id(segment_id)
                if deleted:
                    logger.debug(f"Deleted segment analysis for {segment_id}")
            except Exception as e:
                logger.error(f"Failed to delete segment analysis for {segment_id}: {e}")

        # Reset auto-regenerate counter (manual regeneration resets the counter)
        try:
            segment_repo.reset_regenerate_attempts(segment_id)
            logger.debug(f"Reset regenerate_attempts for segment {segment_id}")
        except Exception as e:
            logger.error(f"Failed to reset regenerate_attempts for {segment_id}: {e}")

        # Set status to queued, clear audio_path, and optionally update TTS parameters
        update_params = {
            'status': 'queued',
            'clear_audio_path': True
        }

        # Add TTS parameters if provided (when user changes settings via dialog)
        if tts_engine is not None:
            update_params['tts_engine'] = tts_engine
        if tts_model_name is not None:
            update_params['tts_model_name'] = tts_model_name
        if tts_speaker_name is not None:
            update_params['tts_speaker_name'] = tts_speaker_name
        if language is not None:
            update_params['language'] = language

        segment_repo.update(segment_id, **update_params)

        if any([tts_engine, tts_model_name, tts_speaker_name, language]):
            logger.debug(f"Set segment {segment_id} to queued with updated TTS parameters")
        else:
            logger.debug(f"Set segment {segment_id} to queued")


class TTSOptions(BaseModel):
    """TTS generation options (optional overrides)"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    temperature: Optional[float] = None
    length_penalty: Optional[float] = None
    repetition_penalty: Optional[float] = None
    top_k: Optional[int] = None
    top_p: Optional[float] = None
    speed: Optional[float] = None


class GenerateChapterRequest(BaseModel):
    """Request to generate entire chapter"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    chapter_id: str
    force_regenerate: bool = False  # If True, regenerate even completed segments
    override_segment_settings: bool = False  # If True, override segment TTS parameters with values below

    # TTS parameters (only used when override_segment_settings=True)
    tts_speaker_name: Optional[str] = None
    language: Optional[str] = None
    tts_engine: Optional[str] = None
    tts_model_name: Optional[str] = None
    options: Optional[TTSOptions] = None  # Optional parameter overrides


# REMOVED: GET /engines - Use GET /api/engines/status instead (engines.py)
# REMOVED: GET /engines/{engine_type}/models - Use GET /api/engines/status instead (engines.py)
#
# The new unified endpoint /api/engines/status provides all engine information
# across all types (TTS, STT, Text, Audio) including available models.


@router.post("/generate-segment/{segment_id}", response_model=SegmentQueueResponse)
async def generate_segment_by_id(
    segment_id: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Queue segment for regeneration via worker (Phase 2.5)

    This endpoint creates a segment-type job that will be processed by the TTS worker.
    The segment's existing parameters (engine, model, speaker, language) are used.

    This replaces the old synchronous generation approach to:
    - Enable job cancellation
    - Prevent request timeouts on long generations
    - Maintain consistency with chapter-level generation

    Returns immediately with job information.
    Use GET /api/tts/progress/{chapter_id} to monitor progress.
    """
    try:
        segment_repo = SegmentRepository(conn)
        job_repo = TTSJobRepository(conn)
        analysis_repo = SegmentsAnalysisRepository(conn)

        # Get segment from database
        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            logger.debug("generate_segment_by_id validation failed", segment_id=segment_id, reason="not_found")
            raise ApplicationError("TTS_SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)

        # Check if segment is frozen
        if segment.get('is_frozen', False):
            logger.debug("generate_segment_by_id validation failed", segment_id=segment_id, reason="frozen")
            raise ApplicationError("TTS_SEGMENT_FROZEN", status_code=400)

        logger.debug(
            "generate_segment_by_id validation passed",
            segment_id=segment_id,
            is_frozen=False,
            segment_type=segment.get('segment_type'),
            current_status=segment.get('status')
        )

        # Use segment's stored parameters
        tts_engine = segment.get('tts_engine')
        tts_model_name = segment.get('tts_model_name')
        tts_speaker_name = segment.get('tts_speaker_name')
        language = segment.get('language')
        context_chapter_id = segment.get('chapter_id')

        # Validate required parameters
        if not all([tts_engine, tts_model_name, tts_speaker_name, language]):
            raise ApplicationError("TTS_MISSING_PARAMETERS", status_code=400)

        # Create segment job
        job = job_repo.create_segment_job(
            segment_ids=[segment_id],
            tts_engine=tts_engine,
            tts_model_name=tts_model_name,
            tts_speaker_name=tts_speaker_name,
            language=language,
            context_chapter_id=context_chapter_id
        )

        # Prepare single segment for regeneration
        _prepare_segments_for_regeneration([segment_id], segment_repo, analysis_repo)

        # Emit job.created event for immediate UI feedback
        segment_objs = [{"id": segment_id, "job_status": "pending"}]
        try:
            await emit_job_created(
                job['id'],
                job['chapter_id'],
                1,
                segment_objs,
                tts_engine=tts_engine,
                tts_model_name=tts_model_name,
                tts_speaker_name=tts_speaker_name
            )
            logger.debug(f"Emitted job.created event for job {job['id']}")
        except Exception as e:
            logger.error(f"Failed to emit job.created event: {e}")

        logger.debug(f"Queued segment {segment_id} for regeneration (job {job['id']})")

        return SegmentQueueResponse(
            success=True,
            job_id=job['id'],
            segment_id=segment_id,
            message="Segment queued for regeneration - worker will process asynchronously"
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to queue segment {segment_id}: {e}")
        raise ApplicationError("TTS_GENERATION_FAILED", status_code=500, error=str(e))


@router.post("/generate-chapter", response_model=ChapterGenerationStartResponse)
async def generate_chapter(
    request: GenerateChapterRequest
):
    """
    Generate audio for an entire chapter (batch operation)

    Creates job in database (persistent) and returns immediately.
    Worker picks up job asynchronously. State persists across restarts.
    """
    chapter_id = request.chapter_id

    try:
        # Get database connection
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)
        segment_repo = SegmentRepository(conn)
        analysis_repo = SegmentsAnalysisRepository(conn)
        chapter_repo = ChapterRepository(conn)

        # Validate chapter exists
        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise ApplicationError("TTS_CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

        # Check if job already running (database is single source of truth)
        active_jobs = job_repo.get_active_jobs_for_chapter(chapter_id)
        logger.debug(
            "generate_chapter entry",
            chapter_id=chapter_id,
            force_regenerate=request.force_regenerate,
            override_segment_settings=request.override_segment_settings,
            active_jobs_count=len(active_jobs) if active_jobs else 0
        )
        if active_jobs:
            # If force_regenerate is True, cancel existing job and continue
            if request.force_regenerate:
                logger.debug(
                    "generate_chapter decision: cancelling existing jobs due to force_regenerate",
                    chapter_id=chapter_id,
                    jobs_to_cancel=len(active_jobs)
                )
                logger.warning(f"Force regenerate: Cancelling existing job for chapter {chapter_id}")
                for job in active_jobs:
                    job_repo.request_cancellation(job['id'])
            else:
                logger.debug(
                    "generate_chapter decision: returning already_running (force_regenerate=False)",
                    chapter_id=chapter_id,
                    existing_job_id=active_jobs[0]['id']
                )
                logger.warning(f"Job already running for chapter {chapter_id}")
                job = active_jobs[0]  # Get first active job
                progress = (job.get("processed_segments", 0) / job.get("total_segments", 1)) * 100 if job.get("total_segments") else 0
                return ChapterGenerationStartResponse(
                    status="already_running",
                    chapter_id=chapter_id,
                    engine=job.get("tts_engine"),  # Use existing job's engine
                    message=f"Generation already in progress (Job ID: {job['id']})",
                    progress=progress
                )

        # Get segments count
        segments = segment_repo.get_by_chapter(chapter_id)

        # Calculate skip counts for detailed logging
        divider_count = sum(1 for s in segments if s.get('segment_type') == 'divider')
        frozen_count = sum(1 for s in segments if s.get('is_frozen', False))
        completed_count = sum(1 for s in segments if s.get('status') == 'completed')

        # Filter segments based on force_regenerate flag
        # This is where force_regenerate is evaluated - Worker just processes segment_ids!
        if request.force_regenerate:
            # Regenerate ALL segments (even completed ones), except dividers and frozen
            segments_to_process = [
                s for s in segments
                if s.get('segment_type') != 'divider'
                and not s.get('is_frozen', False)  # Skip frozen segments
            ]
            logger.debug(
                "generate_chapter segment filtering (force_regenerate=True)",
                chapter_id=chapter_id,
                total_segments=len(segments),
                dividers_skipped=divider_count,
                frozen_skipped=frozen_count,
                completed_included=completed_count,
                segments_to_process=len(segments_to_process)
            )
        else:
            # Only generate pending segments (and not frozen)
            segments_to_process = [
                s for s in segments
                if s.get('segment_type') != 'divider'
                and s.get('status') != 'completed'
                and not s.get('is_frozen', False)  # Skip frozen segments
            ]
            logger.debug(
                "generate_chapter segment filtering (force_regenerate=False)",
                chapter_id=chapter_id,
                total_segments=len(segments),
                dividers_skipped=divider_count,
                frozen_skipped=frozen_count,
                completed_skipped=completed_count,
                segments_to_process=len(segments_to_process)
            )

        segment_ids = [s['id'] for s in segments_to_process]
        total_segments = len(segment_ids)

        if total_segments == 0:
            raise ApplicationError("TTS_NO_SEGMENTS", status_code=400, chapterId=chapter_id)

        # Determine TTS parameters for job metadata
        # If override_segment_settings=True: use request parameters
        # If override_segment_settings=False: use first segment's parameters (for logging only)
        if request.override_segment_settings:
            job_engine = request.tts_engine
            job_model = request.tts_model_name
            job_speaker = request.tts_speaker_name
            job_language = request.language
            logger.debug(
                "generate_chapter TTS params from request (override_segment_settings=True)",
                chapter_id=chapter_id,
                job_engine=job_engine,
                job_model=job_model,
                job_speaker=job_speaker,
                job_language=job_language
            )
        else:
            # Use first segment's parameters as job metadata (worker reads from each segment)
            first_segment = segments_to_process[0]
            job_engine = first_segment.get('tts_engine')
            job_model = first_segment.get('tts_model_name')
            job_speaker = first_segment.get('tts_speaker_name')
            job_language = first_segment.get('language')
            logger.debug(
                "generate_chapter TTS params from first segment (override_segment_settings=False)",
                chapter_id=chapter_id,
                first_segment_id=first_segment.get('id'),
                job_engine=job_engine,
                job_model=job_model,
                job_speaker=job_speaker,
                job_language=job_language
            )

        # Create job in database (status='pending')
        # Store segment_ids for resume support (especially important for force_regenerate jobs)
        # Note: Job-level TTS parameters are only metadata for logging (worker reads from segments)
        job = job_repo.create(
            chapter_id=chapter_id,
            tts_engine=job_engine,  # Metadata only
            tts_model_name=job_model,  # Metadata only
            tts_speaker_name=job_speaker,  # Metadata only
            language=job_language,  # Metadata only
            force_regenerate=request.force_regenerate,
            total_segments=total_segments,
            segment_ids=segment_ids
        )

        # Immediately prepare segments for regeneration
        # (Delete audio, segment analyses, set status to 'queued')
        # If override_segment_settings=True, also update segment TTS parameters
        if request.override_segment_settings:
            _prepare_segments_for_regeneration(
                segment_ids,
                segment_repo,
                analysis_repo,
                tts_engine=request.tts_engine,
                tts_model_name=request.tts_model_name,
                tts_speaker_name=request.tts_speaker_name,
                language=request.language
            )
            logger.debug(
                f"Prepared {len(segment_ids)} segments for regeneration "
                f"(audio deleted, status set to queued, TTS parameters OVERRIDDEN with: "
                f"engine={request.tts_engine}, model={request.tts_model_name}, "
                f"speaker={request.tts_speaker_name}, language={request.language})"
            )
        else:
            # Don't override segment parameters - use existing segment settings
            _prepare_segments_for_regeneration(
                segment_ids,
                segment_repo,
                analysis_repo
            )
            logger.debug(
                f"Prepared {len(segment_ids)} segments for regeneration "
                f"(audio deleted, status set to queued, segment TTS parameters PRESERVED)"
            )

        # Emit job.created event for immediate UI feedback
        # Convert segment_ids to format expected by SSE: [{"id": "...", "job_status": "pending"}]
        segment_objs = [{"id": sid, "job_status": "pending"} for sid in segment_ids]
        try:
            await emit_job_created(
                job['id'],
                chapter_id,
                total_segments,
                segment_objs,
                tts_engine=job_engine,
                tts_model_name=job_model,
                tts_speaker_name=job_speaker
            )
            logger.debug(f"Emitted job.created event for job {job['id']}")
        except Exception as e:
            logger.error(f"Failed to emit job.created event: {e}")

        # NOTE: Worker will pick up job from database automatically
        # The TTS worker polls the database every 1s for pending jobs
        logger.info(f"Created TTS job {job['id']} for chapter {chapter_id} ({total_segments} segments, engine={job_engine})")

        return ChapterGenerationStartResponse(
            status="started",
            chapter_id=chapter_id,
            engine=job_engine,
            message="Job queued for processing by TTS worker"
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to create TTS job for chapter {chapter_id}: {e}")
        raise ApplicationError("TTS_JOB_CREATE_FAILED", status_code=500, chapterId=chapter_id, error=str(e))


# ============================================================================
# REMOVED LEGACY ENDPOINTS
# ============================================================================
#
# GET /generate-chapter/{chapter_id}/progress - REMOVED (Legacy)
#   Progress is now tracked via SSE events (job.progress, segment.completed)
#
# DELETE /generate-chapter/{chapter_id} - REMOVED (Legacy)
#   Use POST /api/jobs/tts/{job_id}/cancel instead
#
# POST /queue-segments - REMOVED (Legacy, never used in frontend)
#   Use POST /generate-chapter with segment selection instead
#
# POST /engines/discover - REMOVED
#   Engine discovery happens automatically at backend startup
#
# ============================================================================
# TTS Job Management - MOVED TO /api/jobs/tts/* (jobs.py)
# ============================================================================
