"""
TTS (Text-to-Speech) generation endpoints
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict
from typing import Optional
from pathlib import Path
import sqlite3
from loguru import logger

from db.database import get_db, get_db_connection_simple
from db.repositories import SegmentRepository, TTSJobRepository
from core.engine_manager import get_engine_manager
from models.response_models import (
    EnginesListResponse,
    ModelsListResponse,
    TTSGenerationResponse,
    TTSProgressResponse,
    ChapterGenerationStartResponse,
    ChapterGenerationCancelResponse,
    TTSJobResponse,              # Database-backed job response
    TTSJobsListResponse,         # Job list response
    MessageResponse,             # Generic message response
    CancelJobResponse,           # Job cancellation response
    QueueSegmentsResponse,       # Segment queue response
    DiscoverEnginesResponse,     # Engine discovery response
    CleanupJobsResponse,         # Job cleanup response
    DeleteJobResponse,           # Job deletion response
    to_camel  # Import alias generator
)
from config import OUTPUT_DIR
from services.event_broadcaster import emit_job_created
import os

router = APIRouter()


def _prepare_segments_for_regeneration(
    segment_ids: list[str],
    segment_repo: SegmentRepository
) -> None:
    """
    Prepare segments for regeneration by deleting audio and setting status to queued.

    This is called IMMEDIATELY when job is created (not when worker starts).
    User has made conscious decision to regenerate, so old audio is obsolete.
    Segments are set to 'queued' status to provide immediate UI feedback.

    Args:
        segment_ids: List of segment IDs to prepare
        segment_repo: Segment repository instance
    """
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

        # Set status to queued and clear audio_path
        segment_repo.update(
            segment_id,
            status='queued',
            clear_audio_path=True
        )
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
    tts_speaker_name: str
    language: str
    tts_engine: str  # Engine selection (required)
    tts_model_name: str  # Model name (required)
    force_regenerate: bool = False  # If True, regenerate even completed segments
    options: Optional[TTSOptions] = None  # Optional parameter overrides


@router.get("/engines", response_model=EnginesListResponse)
async def list_engines():
    """
    Get list of available TTS engines

    Returns engine metadata including supported languages, constraints,
    and current load status.
    """
    try:
        manager = get_engine_manager()

        engines = []
        for engine_info_dict in manager.get_engine_info():
            # Get constraints from engine metadata (from engine.yaml)
            constraints_data = engine_info_dict.get('constraints', {})

            # Convert engine metadata to response format
            engine_info = {
                'name': engine_info_dict['name'],
                'display_name': engine_info_dict['display_name'],
                'supported_languages': engine_info_dict.get('supported_languages', []),
                'default_parameters': {},  # Will be fetched from engine config if needed
                'constraints': {
                    'min_text_length': constraints_data.get('min_text_length', 10),
                    'max_text_length': constraints_data.get('max_text_length', 500),
                    'max_text_length_by_lang': constraints_data.get('max_text_length_by_lang'),
                    'sample_rate': constraints_data.get('sample_rate', 24000),
                    'audio_format': constraints_data.get('audio_format', 'wav'),
                    'supports_streaming': constraints_data.get('supports_streaming', False),
                    'requires_punctuation': constraints_data.get('requires_punctuation', True),
                },
                'tts_model_loaded': engine_info_dict['is_running'],
                'device': 'cuda'  # Default device, actual loaded engine may differ
            }

            engines.append(engine_info)

        return {
            "success": True,
            "engines": engines,
            "count": len(engines)
        }
    except Exception as e:
        logger.error(f"Failed to list engines: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/engines/{engine_type}/models", response_model=ModelsListResponse)
async def list_engine_models(engine_type: str):
    """
    Get list of available models for a specific engine

    Args:
        engine_type: Engine identifier

    Returns:
        List of available models with metadata
    """
    try:
        manager = get_engine_manager()

        # Check if engine type is valid
        if engine_type not in manager.list_available_engines():
            raise HTTPException(
                status_code=400,
                detail=f"Unknown engine type: {engine_type}. Available engines: {manager.list_available_engines()}"
            )

        # Get available models (from engine metadata)
        raw_models = manager.get_available_models(engine_type)

        # Convert to TTSModelInfo format
        models = []
        for model in raw_models:
            tts_model_name = model.get('tts_model_name', 'unknown')
            models.append({
                'tts_model_name': tts_model_name,
                'display_name': model.get('display_name', tts_model_name),
                'path': model.get('path', ''),
                'version': tts_model_name,  # Use tts_model_name as version
                'size_mb': None  # Will be calculated if needed
            })

        return {
            "success": True,
            "engine": engine_type,
            "models": models,
            "count": len(models)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list models for engine {engine_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-segment/{segment_id}", response_model=TTSGenerationResponse)
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

        # Get segment from database
        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            raise HTTPException(status_code=404, detail="Segment not found")

        # Use segment's stored parameters
        tts_engine = segment.get('tts_engine')
        tts_model_name = segment.get('tts_model_name')
        tts_speaker_name = segment.get('tts_speaker_name')
        language = segment.get('language')
        context_chapter_id = segment.get('chapter_id')

        # Validate required parameters
        if not all([tts_engine, tts_model_name, tts_speaker_name, language]):
            raise HTTPException(
                status_code=400,
                detail="Segment missing required parameters (engine, model, speaker, or language)"
            )

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
        _prepare_segments_for_regeneration([segment_id], segment_repo)

        # Emit job.created event for immediate UI feedback
        segment_objs = [{"id": segment_id, "job_status": "pending"}]
        try:
            await emit_job_created(job['id'], job['chapter_id'], 1, segment_objs)
            logger.debug(f"Emitted job.created event for job {job['id']}")
        except Exception as e:
            logger.error(f"Failed to emit job.created event: {e}")

        logger.info(f"Queued segment {segment_id} for regeneration (job {job['id']})")

        return {
            "success": True,
            "job_id": job['id'],
            "segment_id": segment_id,
            "message": "Segment queued for regeneration - worker will process asynchronously"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to queue segment {segment_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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

    # Get database connection
    conn = get_db_connection_simple()
    job_repo = TTSJobRepository(conn)
    segment_repo = SegmentRepository(conn)

    # Check if job already running (database is single source of truth)
    active_jobs = job_repo.get_active_jobs_for_chapter(chapter_id)
    if active_jobs:
        # If force_regenerate is True, cancel existing job and continue
        if request.force_regenerate:
            logger.warning(f"Force regenerate: Cancelling existing job for chapter {chapter_id}")
            for job in active_jobs:
                job_repo.request_cancellation(job['id'])
        else:
            logger.warning(f"Job already running for chapter {chapter_id}")
            job = active_jobs[0]  # Get first active job
            progress = (job.get("processed_segments", 0) / job.get("total_segments", 1)) * 100 if job.get("total_segments") else 0
            return {
                "status": "already_running",
                "chapter_id": chapter_id,
                "engine": request.tts_engine,
                "message": f"Generation already in progress (Job ID: {job['id']})",
                "progress": progress
            }

    # Get segments count
    segments = segment_repo.get_by_chapter(chapter_id)

    # Filter segments based on force_regenerate flag
    # This is where force_regenerate is evaluated - Worker just processes segment_ids!
    if request.force_regenerate:
        # Regenerate ALL segments (even completed ones), except dividers
        segments_to_process = [
            s for s in segments
            if s.get('segment_type') != 'divider'
        ]
    else:
        # Only generate pending segments
        segments_to_process = [
            s for s in segments
            if s.get('segment_type') != 'divider'
            and s.get('status') != 'completed'
        ]

    segment_ids = [s['id'] for s in segments_to_process]
    total_segments = len(segment_ids)

    if total_segments == 0:
        return {
            "status": "error",
            "chapter_id": chapter_id,
            "progress": 0,
            "message": "No segments found for chapter"
        }

    # Create job in database (status='pending')
    # Store segment_ids for resume support (especially important for force_regenerate jobs)
    job = job_repo.create(
        chapter_id=chapter_id,
        tts_engine=request.tts_engine,
        tts_model_name=request.tts_model_name,
        tts_speaker_name=request.tts_speaker_name,
        language=request.language,
        force_regenerate=request.force_regenerate,
        total_segments=total_segments,
        segment_ids=segment_ids
    )

    # Immediately prepare segments for regeneration
    # (Delete audio, set status to 'queued')
    _prepare_segments_for_regeneration(segment_ids, segment_repo)
    logger.info(
        f"Prepared {len(segment_ids)} segments for regeneration "
        f"(audio deleted, status set to queued)"
    )

    # Emit job.created event for immediate UI feedback
    # Convert segment_ids to format expected by SSE: [{"id": "...", "job_status": "pending"}]
    segment_objs = [{"id": sid, "job_status": "pending"} for sid in segment_ids]
    try:
        await emit_job_created(job['id'], chapter_id, total_segments, segment_objs)
        logger.debug(f"Emitted job.created event for job {job['id']}")
    except Exception as e:
        logger.error(f"Failed to emit job.created event: {e}")

    # NOTE: Worker will pick up job from database automatically
    # The TTS worker polls the database every 1s for pending jobs
    logger.info(f"Created TTS job {job['id']} for chapter {chapter_id} ({total_segments} segments, engine={request.tts_engine})")

    return {
        "status": "started",
        "chapter_id": chapter_id,
        "engine": request.tts_engine,
        "message": "Job queued for processing by TTS worker"
    }


@router.get("/generate-chapter/{chapter_id}/progress", response_model=TTSProgressResponse)
async def get_generation_progress(chapter_id: str):
    """
    Get progress of a chapter generation job

    Reads from tts_jobs table (database is single source of truth).
    State persists across restarts.
    """
    conn = get_db_connection_simple()
    job_repo = TTSJobRepository(conn)

    # Get latest job for chapter from database
    job = job_repo.get_latest_job_for_chapter(chapter_id)

    if job:
        # Use database job
        total = job.get("total_segments", 0)
        processed = job.get("processed_segments", 0)

        # Map database status to API status
        status_map = {
            'pending': 'queued',
            'running': 'running',
            'completed': 'completed',
            'failed': 'error',
            'cancelled': 'cancelled'
        }

        api_status = status_map.get(job.get("status"), "unknown")

        # Calculate progress percentage
        progress = (processed / total * 100) if total > 0 else 0.0

        return {
            "chapter_id": chapter_id,
            "status": api_status,
            "progress": progress,
            "current_segment": processed,
            "total_segments": total,
            "message": job.get("error_message") or f"Processing segment {processed} of {total}",
            "error": job.get("error_message")
        }
    else:
        return {
            "chapter_id": chapter_id,
            "status": "not_found",
            "progress": 0.0,
            "current_segment": 0,
            "total_segments": 0,
            "message": "Generation job not found"
        }


@router.delete("/generate-chapter/{chapter_id}", response_model=ChapterGenerationCancelResponse)
async def cancel_generation(chapter_id: str):
    """
    Cancel a running generation job

    Cancels jobs in database (single source of truth).
    Note: Can only cancel jobs in 'pending' state.
    Running jobs are marked as 'cancelling' and worker will stop them.
    """
    conn = get_db_connection_simple()
    job_repo = TTSJobRepository(conn)

    # Get active jobs for chapter
    active_jobs = job_repo.get_active_jobs_for_chapter(chapter_id)

    if active_jobs:
        cancelled_count = 0
        for job in active_jobs:
            if job['status'] == 'pending':
                if job_repo.cancel_job(job['id']):
                    cancelled_count += 1
                    logger.info(f"Cancelled job {job['id']}")
            else:
                logger.warning(f"Cannot cancel running job {job['id']}")

        if cancelled_count > 0:
            return {"status": "cancelled", "chapter_id": chapter_id}
        else:
            return {"status": "cannot_cancel", "chapter_id": chapter_id}

    return {"status": "not_found", "chapter_id": chapter_id}


# ===== Phase 2.5: Job Cancellation Endpoint =====

@router.post("/cancel-job/{job_id}", response_model=CancelJobResponse)
async def cancel_job_by_id(job_id: str):
    """
    Cancel a TTS job by job ID (Phase 2.5)

    For pending jobs: Direct cancellation
    For running jobs: Graceful cancellation (worker stops after current segment)

    Args:
        job_id: Job identifier

    Returns:
        Cancellation status
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)

        # Get job
        job = job_repo.get_by_id(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        job_status = job['status']

        # Handle based on current status
        if job_status == 'pending':
            # Direct cancellation
            if job_repo.cancel_job(job_id):
                logger.info(f"Cancelled pending job {job_id}")
                return {
                    "status": "cancelled",
                    "job_id": job_id,
                    "message": "Pending job cancelled"
                }
        elif job_status == 'running':
            # Request graceful cancellation
            if job_repo.request_cancellation(job_id):
                logger.info(f"Requested cancellation for running job {job_id}")
                return {
                    "status": "cancelling",
                    "job_id": job_id,
                    "message": "Cancellation requested - worker will stop after current segment"
                }
        elif job_status in ('completed', 'failed', 'cancelled'):
            # Already finished
            return {
                "status": job_status,
                "job_id": job_id,
                "message": f"Job already {job_status}"
            }

        # Unexpected status
        return {
            "status": "error",
            "job_id": job_id,
            "message": f"Cannot cancel job with status '{job_status}'"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===== Phase 2.5: Multi-Segment Selection Job Endpoint =====

class QueueSegmentsRequest(BaseModel):
    """Request to queue multiple segments for regeneration"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    segment_ids: list[str]
    tts_engine: str
    tts_model_name: str
    tts_speaker_name: str
    language: str


@router.post("/queue-segments", response_model=QueueSegmentsResponse)
async def queue_segments_for_regeneration(
    request: QueueSegmentsRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Queue multiple segments for regeneration via worker (Phase 2.5)

    Creates a selection-type job that will be processed by the TTS worker.

    Args:
        request: Segment IDs and generation parameters

    Returns:
        Job creation response with job_id
    """
    try:
        segment_repo = SegmentRepository(conn)
        job_repo = TTSJobRepository(conn)

        # Validate all segments exist
        segments = [segment_repo.get_by_id(sid) for sid in request.segment_ids]
        segments = [s for s in segments if s is not None]

        if len(segments) != len(request.segment_ids):
            raise HTTPException(
                status_code=404,
                detail="One or more segments not found"
            )

        # Check all segments are from same chapter
        chapter_ids = set(s['chapter_id'] for s in segments)
        if len(chapter_ids) != 1:
            raise HTTPException(
                status_code=400,
                detail="All segments must be from the same chapter"
            )

        context_chapter_id = list(chapter_ids)[0]

        # Create selection job
        job = job_repo.create_segment_job(
            segment_ids=request.segment_ids,
            tts_engine=request.tts_engine,
            tts_model_name=request.tts_model_name,
            tts_speaker_name=request.tts_speaker_name,
            language=request.language,
            context_chapter_id=context_chapter_id
        )

        # Prepare segments for regeneration
        _prepare_segments_for_regeneration(request.segment_ids, segment_repo)

        # Emit job.created event for immediate UI feedback
        segment_objs = [{"id": sid, "job_status": "pending"} for sid in request.segment_ids]
        try:
            await emit_job_created(job['id'], job['chapter_id'], len(request.segment_ids), segment_objs)
            logger.debug(f"Emitted job.created event for job {job['id']}")
        except Exception as e:
            logger.error(f"Failed to emit job.created event: {e}")

        logger.info(f"Queued {len(request.segment_ids)} segments for regeneration (job {job['id']})")

        return {
            "status": "queued",
            "job_id": job['id'],
            "segment_count": len(request.segment_ids),
            "message": f"Queued {len(request.segment_ids)} segments for regeneration"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to queue segments: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/engines/discover", response_model=DiscoverEnginesResponse)
async def discover_engines():
    """
    Re-discover engines without restart (Hot-Reload)

    Use Case: User installs new engine while backend is running.
    Triggers a re-scan of the models/ directory and updates the engine registry.

    Returns:
        Dictionary with:
        - success: bool - Discovery status
        - engines_discovered: int - Number of engines found
        - engines: List[str] - Engine identifiers
    """
    try:
        manager = get_engine_manager()

        # Re-discover engines
        new_engines = manager.rediscover_engines()

        logger.info(f"Re-discovered {len(new_engines)} engines")

        return {
            "success": True,
            "engines_discovered": len(new_engines),
            "engines": list(new_engines.keys())
        }

    except Exception as e:
        logger.error(f"Engine discovery failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# TTS Job Management Endpoints (Database-Driven)
# ============================================================================

@router.get("/jobs", response_model=TTSJobsListResponse)
async def list_tts_jobs(
    status: Optional[str] = None,
    chapter_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
):
    """
    List TTS jobs with optional filters (database-backed)

    Query Parameters:
        status: Filter by job status ('pending', 'running', 'completed', 'failed', 'cancelled')
        chapter_id: Filter by chapter ID
        limit: Maximum number of results (default 50, max 100)
        offset: Pagination offset (default 0)

    Use Cases:
        - Global job list UI (all active jobs): GET /jobs?status=running
        - Chapter-specific job history: GET /jobs?chapter_id=xxx
        - All active jobs: GET /jobs?status=pending,running (note: comma not supported, use /jobs/active)
        - Completed jobs: GET /jobs?status=completed&limit=20

    Returns:
        TTSJobsListResponse with list of jobs matching filters
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)

        # Limit protection
        if limit > 100:
            limit = 100

        # Get jobs from database
        jobs = job_repo.get_all(
            status=status,
            chapter_id=chapter_id,
            limit=limit,
            offset=offset
        )

        logger.debug(f"Retrieved {len(jobs)} jobs (filters: status={status}, chapter_id={chapter_id})")

        return {
            "success": True,
            "jobs": jobs,
            "count": len(jobs)
        }

    except Exception as e:
        logger.error(f"Failed to list TTS jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/active", response_model=TTSJobsListResponse)
async def list_active_tts_jobs():
    """
    Get all active TTS jobs (pending + running + cancelled/paused)

    Convenience endpoint optimized for real-time monitoring.
    Returns only jobs that are currently pending, running, or paused (cancelled).

    This endpoint is designed for:
        - Real-time job monitoring UI
        - Navbar badge counts
        - Auto-polling (500ms-1s interval)

    Equivalent to: GET /jobs?status=pending,running,cancelled but more efficient
    (single database query instead of multiple status checks)

    Returns:
        TTSJobsListResponse with only pending/running/cancelled jobs
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)

        # Get only active jobs (pending, running, or paused/cancelled)
        # Cancelled = Paused jobs that can be resumed
        active_jobs = job_repo.get_all(
            status=['pending', 'running', 'cancelled'],
            limit=100  # Reasonable limit for active jobs
        )

        logger.debug(f"Retrieved {len(active_jobs)} active TTS jobs (including paused)")

        return {
            "success": True,
            "jobs": active_jobs,
            "count": len(active_jobs)
        }

    except Exception as e:
        logger.error(f"Failed to list active TTS jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}", response_model=TTSJobResponse)
async def get_tts_job(job_id: str):
    """
    Get single TTS job by ID (database-backed)

    Path Parameters:
        job_id: Unique job identifier (UUID)

    Use Cases:
        - Job detail view
        - Real-time progress tracking for specific job
        - Debugging/troubleshooting

    Returns:
        TTSJobResponse with complete job details

    Raises:
        404: Job not found
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)

        job = job_repo.get_by_id(job_id)

        if not job:
            logger.warning(f"Job {job_id} not found")
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        logger.debug(f"Retrieved job {job_id} (status: {job.get('status')})")

        return job

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get TTS job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/jobs/cleanup", response_model=CleanupJobsResponse)
async def cleanup_finished_jobs():
    """
    Delete all completed and failed jobs (bulk cleanup)

    Deletes jobs with status 'completed' or 'failed'.
    Cancelled jobs are NOT deleted (user might want to resume them).

    Use Cases:
        - Clear job history to reduce clutter
        - Periodic maintenance/cleanup
        - Free database space

    Returns:
        Number of jobs deleted

    Example Response:
        {"deleted": 15}
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)

        # Get all completed and failed jobs
        finished_jobs = job_repo.get_all(status=['completed', 'failed'])

        # Delete each job with segment cleanup
        # (Completed/failed jobs shouldn't have queued/processing segments,
        #  but we cleanup just in case to prevent orphaned segments)
        deleted_count = 0
        for job in finished_jobs:
            if job_repo.delete_with_segment_cleanup(job['id']):
                deleted_count += 1

        logger.info(f"Cleaned up {deleted_count} finished jobs with segment cleanup")

        return {
            "success": True,
            "deleted": deleted_count
        }

    except Exception as e:
        logger.error(f"Failed to cleanup jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/jobs/{job_id}", response_model=DeleteJobResponse)
async def delete_job(job_id: str):
    """
    Delete a specific job by ID

    Primarily used for deleting individual cancelled jobs that won't be resumed.
    Can also delete any job regardless of status (use with caution).

    Path Parameters:
        job_id: Unique job identifier (UUID)

    Returns:
        Confirmation of deletion

    Raises:
        404: Job not found
        500: Database error

    Example Response:
        {"deleted": true, "job_id": "abc123..."}
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)

        # Delete job with segment cleanup
        # Resets segments stuck in 'queued' or 'processing' back to 'pending'
        deleted = job_repo.delete_with_segment_cleanup(job_id)

        if not deleted:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        logger.info(f"Deleted job {job_id} with segment cleanup")

        return {
            "success": True,
            "deleted": True,
            "job_id": job_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jobs/{job_id}/resume", response_model=TTSJobResponse)
async def resume_cancelled_job(job_id: str):
    """
    Resume a cancelled job by reactivating it with remaining segments

    Updates the cancelled job back to 'pending' status and sets it to
    process only the segments that were not completed before cancellation.
    Preserves the job ID and processed segments count (progress).

    Path Parameters:
        job_id: UUID of the cancelled job to resume

    Returns:
        The same job (updated to pending status with new segment list)

    Raises:
        404: Original job not found
        400: Job is not in cancelled status
        400: All segments already completed (nothing to resume)

    Example Response:
        {
          "id": "same-job-uuid",  // Same as input job_id
          "chapterId": "chapter-123",
          "status": "pending",
          "totalSegments": 5,  // Only unprocessed segments
          "processedSegments": 3,  // Preserved from before cancellation
          ...
        }

    Flow:
        1. Load original cancelled job
        2. Find segments from that chapter that are not completed
        3. Update same job: status='pending', new segment list
        4. Worker will pick up the resumed job automatically
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)
        segment_repo = SegmentRepository(conn)

        # 1. Get original job
        original_job = job_repo.get_by_id(job_id)
        if not original_job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        # 2. Validate job is cancelled
        if original_job['status'] != 'cancelled':
            raise HTTPException(
                status_code=400,
                detail=f"Job {job_id} is not cancelled (status: {original_job['status']})"
            )

        # 3. Resume job - filtering by job_status happens in repository
        # This now works correctly for both normal and force_regenerate jobs!
        resumed_job = job_repo.resume_job(job_id=job_id)

        # 4. Set remaining segments to 'queued' status
        # Extract segment IDs from resumed job
        segment_objs = resumed_job.get('segment_ids', [])
        segment_ids = [seg_obj['id'] for seg_obj in segment_objs]

        if segment_ids:
            # Set segments to queued (they're currently 'pending' from cancellation)
            _prepare_segments_for_regeneration(segment_ids, segment_repo)
            logger.info(f"Set {len(segment_ids)} segments to queued for resumed job {job_id}")

        # 5. Emit job.created event for immediate UI feedback
        try:
            await emit_job_created(
                resumed_job['id'],
                resumed_job['chapter_id'],
                len(segment_ids),
                segment_objs
            )
            logger.debug(f"Emitted job.created event for resumed job {job_id}")
        except Exception as e:
            logger.error(f"Failed to emit job.created event for resume: {e}")

        logger.info(f"Resumed job {job_id} with {len(segment_ids)} segments")

        return resumed_job

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to resume job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= Preferred Engine Management =============

class SetPreferredEngineRequest(BaseModel):
    """Request to set user's preferred engine"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    tts_engine: str
    tts_model_name: str


@router.post("/set-preferred-engine", response_model=MessageResponse)
async def set_preferred_engine(
    request: SetPreferredEngineRequest,
    engine_manager = Depends(get_engine_manager)
):
    """
    Set user's preferred engine/model for warm-keeping

    This preference is stored in RAM only (session-based).
    After all jobs complete, the worker will activate this engine.
    """
    engine_manager.set_preferred_engine(
        request.tts_engine,
        request.tts_model_name
    )

    logger.info(
        f"Preferred engine set: {request.tts_engine} / {request.tts_model_name}"
    )

    return MessageResponse(success=True, message="Preferred engine updated")
