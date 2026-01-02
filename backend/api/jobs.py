"""
Consolidated Job Management Endpoints

Provides centralized job management for all job types:
- /api/jobs/tts/* - TTS job management
- /api/jobs/quality/* - Quality analysis job management
"""

import sqlite3
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from loguru import logger

from db.database import get_db, get_db_connection_simple
from db.repositories import TTSJobRepository, SegmentRepository
from db.segments_analysis_repository import SegmentsAnalysisRepository
from db.quality_job_repository import QualityJobRepository
from models.response_models import (
    TTSJobResponse,
    TTSJobsListResponse,
    CancelJobResponse,
    CleanupJobsResponse,
    DeleteJobResponse,
    QualityJobResponse,
    QualityJobsListResponse,
    MessageResponse,
)
from services.event_broadcaster import emit_job_resumed

# Main router with /api/jobs prefix (no tags - sub-routers define their own)
router = APIRouter(prefix="/api/jobs")

# Sub-routers for each job type
tts_router = APIRouter(prefix="/tts", tags=["TTS Jobs"])
quality_router = APIRouter(prefix="/quality", tags=["Quality Jobs"])


# ============================================================================
# TTS Job Management Endpoints
# ============================================================================

@tts_router.get("/", response_model=TTSJobsListResponse)
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
        - Global job list UI (all active jobs): GET /jobs/tts?status=running
        - Chapter-specific job history: GET /jobs/tts?chapter_id=xxx
        - All active jobs: GET /jobs/tts?status=pending,running (note: comma not supported, use /active)
        - Completed jobs: GET /jobs/tts?status=completed&limit=20

    Returns:
        TTSJobsListResponse with list of jobs matching filters
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)

        # Limit protection
        if limit > 100:
            limit = 100

        jobs = job_repo.get_all(
            status=status,
            chapter_id=chapter_id,
            limit=limit,
            offset=offset
        )

        logger.debug(f"Retrieved {len(jobs)} TTS jobs (filters: status={status}, chapter_id={chapter_id})")

        return TTSJobsListResponse(
            success=True,
            jobs=jobs,
            count=len(jobs)
        )

    except Exception as e:
        logger.error(f"Failed to list TTS jobs: {e}")
        raise HTTPException(status_code=500, detail=f"[TTS_JOB_LIST_FAILED]error:{str(e)}")


@tts_router.get("/active", response_model=TTSJobsListResponse)
async def list_active_tts_jobs() -> TTSJobsListResponse:
    """
    Get all active TTS jobs (pending + running + cancelled/paused)

    Convenience endpoint optimized for real-time monitoring.
    Returns only jobs that are currently pending, running, or paused (cancelled).

    This endpoint is designed for:
        - Real-time job monitoring UI
        - Navbar badge counts
        - Auto-polling (500ms-1s interval)

    Equivalent to: GET /jobs/tts?status=pending,running,cancelled but more efficient
    (single database query instead of multiple status checks)

    Returns:
        TTSJobsListResponse with only pending/running/cancelled jobs
    """
    try:
        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)

        # Get only active jobs (pending, running, or paused/cancelled)
        # Cancelled = Paused jobs that can be resumed
        from config import DB_JOBS_ACTIVE_LIMIT
        active_jobs = job_repo.get_all(
            status=['pending', 'running', 'cancelled'],
            limit=DB_JOBS_ACTIVE_LIMIT  # Reasonable limit for active jobs
        )

        logger.debug(f"Retrieved {len(active_jobs)} active TTS jobs (including paused)")

        return TTSJobsListResponse(
            success=True,
            jobs=active_jobs,
            count=len(active_jobs)
        )

    except Exception as e:
        logger.error(f"Failed to list active TTS jobs: {e}")
        raise HTTPException(status_code=500, detail=f"[TTS_JOB_ACTIVE_LIST_FAILED]error:{str(e)}")


@tts_router.get("/{job_id}", response_model=TTSJobResponse)
async def get_tts_job(job_id: str) -> TTSJobResponse:
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
            logger.warning(f"TTS job {job_id} not found")
            raise HTTPException(status_code=404, detail=f"[TTS_JOB_NOT_FOUND]jobId:{job_id}")

        logger.debug(f"Retrieved TTS job {job_id} (status: {job.get('status')})")

        return job

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get TTS job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[TTS_JOB_GET_FAILED]jobId:{job_id};error:{str(e)}")


@tts_router.delete("/cleanup", response_model=CleanupJobsResponse)
async def cleanup_tts_jobs() -> CleanupJobsResponse:
    """
    Delete all completed and failed TTS jobs (bulk cleanup)

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

    Note: This route MUST be defined before /{job_id} to prevent
    "cleanup" being matched as a job_id parameter.
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

        logger.info(f"Cleaned up {deleted_count} finished TTS jobs with segment cleanup")

        return CleanupJobsResponse(
            success=True,
            deleted=deleted_count
        )

    except Exception as e:
        logger.error(f"Failed to cleanup TTS jobs: {e}")
        raise HTTPException(status_code=500, detail=f"[TTS_JOB_CLEANUP_FAILED]error:{str(e)}")


@tts_router.delete("/{job_id}", response_model=DeleteJobResponse)
async def delete_tts_job(job_id: str) -> DeleteJobResponse:
    """
    Delete a specific TTS job by ID

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
            raise HTTPException(status_code=404, detail=f"[TTS_JOB_NOT_FOUND]jobId:{job_id}")

        logger.info(f"Deleted TTS job {job_id} with segment cleanup")

        return DeleteJobResponse(
            success=True,
            deleted=True,
            job_id=job_id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete TTS job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[TTS_JOB_DELETE_FAILED]jobId:{job_id};error:{str(e)}")


@tts_router.post("/{job_id}/cancel", response_model=CancelJobResponse)
async def cancel_tts_job(job_id: str) -> CancelJobResponse:
    """
    Cancel a TTS job by job ID

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
            raise HTTPException(status_code=404, detail=f"[TTS_JOB_NOT_FOUND]jobId:{job_id}")

        job_status = job['status']

        # Handle based on current status
        if job_status == 'pending':
            # Direct cancellation - pending jobs haven't been picked up by worker yet
            if job_repo.cancel_job(job_id):
                logger.info(f"Cancelled pending TTS job {job_id}")

                # Emit SSE event for pending job cancellation
                # (running jobs emit from worker when they actually stop)
                try:
                    from services.event_broadcaster import emit_job_cancelled
                    segment_ids = job.get('segment_ids', [])
                    await emit_job_cancelled(job_id, job['chapter_id'], segment_ids)
                except Exception as e:
                    logger.error(f"Failed to emit TTS job cancelled event: {e}")

                return CancelJobResponse(
                    status="cancelled",
                    job_id=job_id,
                    message="Pending job cancelled"
                )
        elif job_status == 'running':
            # Request graceful cancellation
            if job_repo.request_cancellation(job_id):
                logger.info(f"Requested cancellation for running TTS job {job_id}")

                # Emit SSE event for immediate UI feedback
                # (Worker will emit job.cancelled when it actually stops)
                try:
                    from services.event_broadcaster import emit_job_cancelling
                    await emit_job_cancelling(job_id, job['chapter_id'])
                except Exception as e:
                    logger.error(f"Failed to emit TTS job cancelling event: {e}")

                return CancelJobResponse(
                    status="cancelling",
                    job_id=job_id,
                    message="Cancellation requested - worker will stop after current segment"
                )
        elif job_status in ('completed', 'failed', 'cancelled'):
            # Already finished
            return CancelJobResponse(
                status=job_status,
                job_id=job_id,
                message=f"Job already {job_status}"
            )

        # Unexpected status
        return CancelJobResponse(
            status="error",
            job_id=job_id,
            message=f"Cannot cancel job with status '{job_status}'"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel TTS job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[TTS_JOB_CANCEL_FAILED]jobId:{job_id};error:{str(e)}")


@tts_router.post("/{job_id}/resume", response_model=TTSJobResponse)
async def resume_tts_job(job_id: str) -> TTSJobResponse:
    """
    Resume a cancelled TTS job by reactivating it with remaining segments

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
        analysis_repo = SegmentsAnalysisRepository(conn)

        # 1. Get original job
        original_job = job_repo.get_by_id(job_id)
        if not original_job:
            raise HTTPException(status_code=404, detail=f"[TTS_JOB_NOT_FOUND]jobId:{job_id}")

        # 2. Validate job is cancelled
        if original_job['status'] != 'cancelled':
            raise HTTPException(
                status_code=400,
                detail=f"[JOB_NOT_CANCELLED]jobId:{job_id};status:{original_job['status']}"
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
            # Import helper function from tts.py
            from api.tts import _prepare_segments_for_regeneration
            _prepare_segments_for_regeneration(segment_ids, segment_repo, analysis_repo)
            logger.debug(f"Set {len(segment_ids)} segments to queued for resumed TTS job {job_id}")

        # 5. Emit job.resumed event for immediate UI feedback
        try:
            await emit_job_resumed(
                resumed_job['id'],
                resumed_job['chapter_id'],
                len(segment_ids),
                segment_objs
            )
            logger.debug(f"Emitted job.resumed event for resumed TTS job {job_id}")
        except Exception as e:
            logger.error(f"Failed to emit job.resumed event for resume: {e}")

        logger.info(f"Resumed TTS job {job_id} with {len(segment_ids)} segments")

        return resumed_job

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to resume TTS job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[TTS_JOB_RESUME_FAILED]jobId:{job_id};error:{str(e)}")


# ============================================================================
# Quality Job Management Endpoints
# ============================================================================

@quality_router.get("/", response_model=QualityJobsListResponse)
async def list_quality_jobs(
    status: Optional[str] = None,
    chapter_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db=Depends(get_db)
):
    """
    List quality jobs with optional filtering.

    Supports filtering by status and chapter_id with pagination.
    """
    try:
        job_repo = QualityJobRepository(db)
        jobs = job_repo.get_all(status=status, chapter_id=chapter_id, limit=limit, offset=offset)

        return QualityJobsListResponse(
            jobs=[QualityJobResponse(**job) for job in jobs],
            count=len(jobs)
        )
    except Exception as e:
        logger.error(f"Failed to list quality jobs: {e}")
        raise HTTPException(status_code=500, detail=f"[QUALITY_JOB_LIST_FAILED]error:{str(e)}")


@quality_router.get("/active", response_model=QualityJobsListResponse)
async def list_active_quality_jobs(db: sqlite3.Connection = Depends(get_db)) -> QualityJobsListResponse:
    """
    List active (pending/running) quality jobs.

    Optimized endpoint for job monitoring UI.
    """
    try:
        job_repo = QualityJobRepository(db)
        jobs = job_repo.get_all(status='pending') + job_repo.get_all(status='running')

        return QualityJobsListResponse(
            jobs=[QualityJobResponse(**job) for job in jobs],
            count=len(jobs)
        )
    except Exception as e:
        logger.error(f"Failed to list active quality jobs: {e}")
        raise HTTPException(status_code=500, detail=f"[QUALITY_JOB_ACTIVE_LIST_FAILED]error:{str(e)}")


@quality_router.get("/{job_id}", response_model=QualityJobResponse)
async def get_quality_job(job_id: str, db: sqlite3.Connection = Depends(get_db)) -> QualityJobResponse:
    """
    Get quality job by ID.

    Returns job details including progress and analysis results.
    """
    try:
        job_repo = QualityJobRepository(db)
        job = job_repo.get_by_id(job_id)

        if not job:
            raise HTTPException(status_code=404, detail=f"[JOB_NOT_FOUND]jobId:{job_id}")

        return QualityJobResponse(**job)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get quality job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[QUALITY_JOB_GET_FAILED]jobId:{job_id};error:{str(e)}")


@quality_router.post("/{job_id}/cancel", response_model=MessageResponse)
async def cancel_quality_job(job_id: str, db: sqlite3.Connection = Depends(get_db)) -> MessageResponse:
    """
    Cancel a running quality job.

    Pending jobs cancel immediately. Running jobs stop gracefully after current segment.
    """
    try:
        job_repo = QualityJobRepository(db)
        job = job_repo.get_by_id(job_id)

        if not job:
            raise HTTPException(status_code=404, detail=f"[JOB_NOT_FOUND]jobId:{job_id}")

        if job['status'] not in ('pending', 'running'):
            raise HTTPException(status_code=400, detail=f"[JOB_CANNOT_CANCEL]status:{job['status']}")

        if job['status'] == 'pending':
            # Pending jobs can be cancelled immediately (worker hasn't picked them up)
            job_repo.mark_cancelled(job_id)
            # Emit SSE event since worker won't process this job
            try:
                from services.event_broadcaster import emit_quality_job_cancelled
                await emit_quality_job_cancelled(job_id, job.get('chapter_id', ''))
            except Exception as e:
                logger.error(f"Failed to emit quality job cancelled event: {e}")
            return MessageResponse(success=True, message="Job cancelled")

        # Running jobs: request cancellation, worker will complete it
        success = job_repo.request_cancellation(job_id)

        if not success:
            raise HTTPException(status_code=400, detail="[JOB_NOT_RUNNING]")

        # NOTE: Don't emit SSE here - the worker will emit when it actually cancels
        # This avoids race condition where refetch overwrites the optimistic update

        return MessageResponse(success=True, message="Cancellation requested")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel quality job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[QUALITY_JOB_CANCEL_FAILED]jobId:{job_id};error:{str(e)}")


@quality_router.delete("/cleanup", response_model=CleanupJobsResponse)
async def cleanup_quality_jobs(db: sqlite3.Connection = Depends(get_db)) -> CleanupJobsResponse:
    """
    Delete all completed and failed quality jobs (bulk cleanup).

    Deletes jobs with status 'completed' or 'failed'.
    Cancelled jobs are NOT deleted (user might want to resume them).

    Returns:
        Number of jobs deleted

    Note: This route MUST be defined before /{job_id} to prevent
    "cleanup" being matched as a job_id parameter.
    """
    try:
        job_repo = QualityJobRepository(db)

        # Get all completed and failed jobs
        completed_jobs = job_repo.get_all(status='completed')
        failed_jobs = job_repo.get_all(status='failed')
        finished_jobs = completed_jobs + failed_jobs

        # Delete each job
        deleted_count = 0
        for job in finished_jobs:
            if job_repo.delete_by_id(job['id']):
                deleted_count += 1

        logger.info(f"Cleaned up {deleted_count} finished quality jobs")

        return CleanupJobsResponse(
            success=True,
            deleted=deleted_count
        )

    except Exception as e:
        logger.error(f"Failed to cleanup quality jobs: {e}")
        raise HTTPException(status_code=500, detail=f"[QUALITY_JOB_CLEANUP_FAILED]error:{str(e)}")


@quality_router.post("/{job_id}/resume", response_model=QualityJobResponse)
async def resume_quality_job(job_id: str, db: sqlite3.Connection = Depends(get_db)) -> QualityJobResponse:
    """
    Resume a cancelled quality job.

    Resets job to pending status so worker will pick it up again.

    Path Parameters:
        job_id: UUID of the cancelled job to resume

    Returns:
        Updated job object

    Raises:
        404: Job not found
        400: Job is not cancelled
    """
    try:
        job_repo = QualityJobRepository(db)

        # Resume job (raises ValueError if not found or not cancelled)
        resumed_job = job_repo.resume_job(job_id)

        # Emit SSE event for immediate UI feedback
        try:
            from services.event_broadcaster import emit_quality_job_resumed
            await emit_quality_job_resumed(
                resumed_job['id'],
                resumed_job.get('chapter_id', '')
            )
        except Exception as e:
            logger.error(f"Failed to emit quality job resumed event: {e}")

        logger.info(f"Resumed quality job {job_id}")

        return QualityJobResponse(**resumed_job)

    except ValueError as e:
        error_msg = str(e)
        if "not found" in error_msg:
            raise HTTPException(status_code=404, detail=f"[QUALITY_JOB_NOT_FOUND]jobId:{job_id}")
        raise HTTPException(status_code=400, detail=f"[QUALITY_JOB_INVALID_STATE]jobId:{job_id};error:{error_msg}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to resume quality job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[QUALITY_JOB_RESUME_FAILED]jobId:{job_id};error:{str(e)}")


@quality_router.delete("/{job_id}", response_model=MessageResponse)
async def delete_quality_job(job_id: str, db: sqlite3.Connection = Depends(get_db)) -> MessageResponse:
    """
    Delete a quality job.

    Removes job from database. Cannot delete running jobs.
    """
    try:
        job_repo = QualityJobRepository(db)
        job = job_repo.get_by_id(job_id)

        if not job:
            raise HTTPException(status_code=404, detail=f"[JOB_NOT_FOUND]jobId:{job_id}")

        success = job_repo.delete_by_id(job_id)

        if not success:
            raise HTTPException(status_code=500, detail="[JOB_DELETE_FAILED]")

        return MessageResponse(success=True, message="Job deleted")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete quality job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"[QUALITY_JOB_DELETE_FAILED]jobId:{job_id};error:{str(e)}")


# Include sub-routers in main router
router.include_router(tts_router)
router.include_router(quality_router)
