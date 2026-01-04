"""
Audio processing and export endpoints
"""
from typing import Dict, Any, Optional
from datetime import datetime
from pathlib import Path
import asyncio
from fastapi import APIRouter, BackgroundTasks
from core.exceptions import ApplicationError
from fastapi.responses import FileResponse
from pydantic import BaseModel
from loguru import logger

from db.database import get_db_connection_simple
from db.repositories import ChapterRepository, SegmentRepository, ExportJobRepository, ProjectRepository
from services.audio_service import AudioService
from services.event_broadcaster import broadcaster, EventType
from config import EXPORTS_DIR
from models.response_models import (
    ExportResponse,
    ExportProgressResponse,
    MessageResponse,
    MergeResponse,
    AudioDurationResponse,
    to_camel
)
from pydantic import ConfigDict

router = APIRouter()

export_jobs: Dict[str, Dict[str, Any]] = {}


class ExportRequest(BaseModel):
    """Audio export request"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    chapter_id: str
    output_format: str = "mp3"  # mp3, m4a, wav
    quality: Optional[str] = None  # low, medium, high - preferred over bitrate/sample_rate
    bitrate: Optional[str] = None  # Legacy support: explicit bitrate (e.g. "192k")
    sample_rate: Optional[int] = None  # Legacy support: explicit sample rate
    pause_between_segments: int = 500  # milliseconds
    custom_filename: Optional[str] = None  # Optional custom filename

    def get_export_params(self):
        """
        Convert quality preset to bitrate + sample_rate, or use explicit values.
        Quality presets take precedence over explicit bitrate/sample_rate.
        """
        # Quality presets for each format
        QUALITY_PRESETS = {
            'mp3': {
                'low': {'bitrate': '96k', 'sample_rate': 22050},
                'medium': {'bitrate': '128k', 'sample_rate': 44100},
                'high': {'bitrate': '192k', 'sample_rate': 48000},
            },
            'm4a': {
                'low': {'bitrate': '96k', 'sample_rate': 24000},
                'medium': {'bitrate': '128k', 'sample_rate': 44100},
                'high': {'bitrate': '192k', 'sample_rate': 48000},
            },
            'wav': {
                'low': {'bitrate': None, 'sample_rate': 22050},
                'medium': {'bitrate': None, 'sample_rate': 24000},
                'high': {'bitrate': None, 'sample_rate': 48000},
            }
        }

        # If quality is specified, use preset
        if self.quality and self.output_format in QUALITY_PRESETS:
            preset = QUALITY_PRESETS[self.output_format].get(self.quality)
            if preset:
                logger.debug(
                    "quality preset resolved",
                    quality=self.quality,
                    output_format=self.output_format,
                    bitrate=preset['bitrate'],
                    sample_rate=preset['sample_rate']
                )
                return preset['bitrate'], preset['sample_rate']

        # Otherwise use explicit values or defaults
        bitrate = self.bitrate or "192k"
        sample_rate = self.sample_rate or 24000

        # WAV doesn't use bitrate
        if self.output_format == 'wav':
            bitrate = None

        logger.debug(
            "explicit/default params used",
            output_format=self.output_format,
            bitrate=bitrate,
            sample_rate=sample_rate,
            quality_requested=self.quality
        )
        return bitrate, sample_rate


async def export_task(
    job_id: str,
    chapter_id: str,
    output_format: str,
    bitrate: Optional[str],
    sample_rate: int,
    pause_between_segments: int,
    custom_filename: Optional[str] = None
):
    """Background task for exporting audio"""
    from services.health_monitor import get_health_monitor

    logger.debug(
        "export_task started",
        job_id=job_id,
        chapter_id=chapter_id,
        output_format=output_format,
        bitrate=bitrate,
        sample_rate=sample_rate,
        pause_between_segments=pause_between_segments,
        custom_filename=custom_filename
    )

    health_monitor = get_health_monitor()
    health_monitor.increment_active_jobs()

    try:
        export_jobs[job_id] = {
            "status": "running",
            "progress": 0.0,
            "current_segment": 0,
            "total_segments": 0,
            "message": "Starting export...",
            "started_at": datetime.now()
        }

        await broadcaster.broadcast_export_update(
            export_data={
                "exportId": job_id,
                "chapterId": chapter_id,
                "status": "running",
                "progress": 0.0,
                "message": "Starting export..."
            },
            event_type=EventType.EXPORT_STARTED
        )

        conn = get_db_connection_simple()
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)
        project_repo = ProjectRepository(conn)
        export_repo = ExportJobRepository(conn)

        # Get chapter details
        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise ApplicationError("EXPORT_CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

        # Get project details for naming
        project = project_repo.get_by_id(chapter['project_id'])
        if not project:
            raise ApplicationError("EXPORT_PROJECT_NOT_FOUND", status_code=404, projectId=chapter['project_id'])

        # Get segments for chapter (includes both standard and divider segments)
        segments = segment_repo.get_by_chapter(chapter_id)

        if not segments:
            raise ValueError("No segments to export")

        # Filter segments: completed standard segments + all divider segments
        exportable_segments = [
            s for s in segments
            if (s.get('segment_type') == 'divider') or
               (s.get('segment_type', 'standard') == 'standard' and s.get('status') == 'completed' and s.get('audio_path'))
        ]

        divider_count = sum(1 for s in exportable_segments if s.get('segment_type') == 'divider')
        completed_count = len(exportable_segments) - divider_count
        skipped_count = len(segments) - len(exportable_segments)
        logger.debug(
            "segment filtering complete",
            job_id=job_id,
            total_segments=len(segments),
            exportable_segments=len(exportable_segments),
            completed_standard=completed_count,
            dividers=divider_count,
            skipped=skipped_count
        )

        if not exportable_segments:
            raise ValueError("No segments to export (no completed audio or dividers)")

        # Update job in database
        export_job = export_repo.get_by_id(job_id)
        if export_job:
            export_repo.update(
                job_id,
                status='running',
                started_at=datetime.now().isoformat()
            )

        # Update total segments count
        export_jobs[job_id]["total_segments"] = len(exportable_segments)
        export_jobs[job_id]["message"] = f"Merging {len(exportable_segments)} segments..."

        # Initialize audio service
        audio_service = AudioService()

        # Generate output filename if not provided
        if not custom_filename:
            # Format: "Projektname - Kapitel X Kapiteltitel"
            chapter_number = chapter['order_index'] + 1  # Make 1-based
            custom_filename = f"{project['title']} - Kapitel {chapter_number} {chapter['title']}"

        # Sanitize filename (remove invalid characters)
        custom_filename = "".join(c for c in custom_filename if c.isalnum() or c in ' -_')

        # Format-specific progress mapping (WAV is much faster to convert than MP3/M4A)
        merge_progress_end = 0.95 if output_format == 'wav' else 0.75
        convert_progress_start = merge_progress_end
        convert_progress_mid = convert_progress_start + (1.0 - convert_progress_start) * 0.5
        convert_progress_final = convert_progress_start + (1.0 - convert_progress_start) * 0.8

        # Cancellation callback (checked BEFORE each segment - immediate abort)
        def check_cancellation() -> None:
            if job_id in export_jobs and export_jobs[job_id].get('status') == 'cancelled':
                logger.info(f"Export job {job_id} cancelled by user")
                raise InterruptedError("Export cancelled by user")

        # Get event loop for thread-safe SSE broadcasting
        loop = asyncio.get_event_loop()

        # Progress callback for merging (called AFTER each segment)
        def update_progress(current: int, total: int) -> None:
            progress = current / total if total > 0 else 0
            progress_pct = progress * merge_progress_end
            logger.debug(
                "progress callback invoked",
                job_id=job_id,
                current=current,
                total=total,
                progress_pct=round(progress_pct, 3)
            )
            export_jobs[job_id].update({
                "progress": progress_pct,  # Format-specific: 75% or 95%
                "current_segment": current,
                "message": f"Merging segment {current}/{total}..."
            })
            # Also update database
            if export_job:
                export_repo.update(job_id, merged_segments=current)

            # Broadcast progress event (thread-safe)
            # Note: update_progress is called from thread pool, so we need run_coroutine_threadsafe
            asyncio.run_coroutine_threadsafe(
                broadcaster.broadcast_export_update(
                    export_data={
                        "exportId": job_id,
                        "chapterId": chapter_id,
                        "status": "running",
                        "progress": progress_pct,
                        "message": f"Merging segment {current}/{total}...",
                        "currentSegment": current,
                        "totalSegments": total
                    },
                    event_type=EventType.EXPORT_PROGRESS
                ),
                loop
            )

        # Merge segments (includes standard + divider)
        # Run in thread pool to avoid blocking the event loop
        logger.debug(f"Merging {len(exportable_segments)} segments for chapter {chapter_id}")
        temp_wav_path, duration = await asyncio.to_thread(
            audio_service.merge_segments_to_file,
            exportable_segments,
            custom_filename,
            pause_between_segments,
            update_progress,
            check_cancellation  # FIX BUG 2: Check BEFORE each segment (immediate abort)
        )

        # FIX BUG 2: Check for cancellation after merge
        if job_id in export_jobs and export_jobs[job_id].get('status') == 'cancelled':
            logger.debug(f"Export job {job_id} was cancelled after merge, cleaning up")
            # Cleanup temp file
            if temp_wav_path and temp_wav_path.exists():
                temp_wav_path.unlink()
            return

        # Update progress: Merging complete, starting conversion
        export_jobs[job_id]["message"] = f"Converting to {output_format.upper()}..."
        export_jobs[job_id]["progress"] = convert_progress_start  # Format-specific: 75% or 95%

        # Update database
        if export_job:
            export_repo.update(job_id, merged_segments=len(exportable_segments))

        # Broadcast progress event
        await broadcaster.broadcast_export_update(
            export_data={
                "exportId": job_id,
                "chapterId": chapter_id,
                "status": "running",
                "progress": convert_progress_start,
                "message": f"Converting to {output_format.upper()}..."
            },
            event_type=EventType.EXPORT_PROGRESS
        )

        # Give frontend time to receive SSE update (600ms delay)
        await asyncio.sleep(0.6)

        # Prepare metadata
        metadata = {
            "title": f"{project['title']} - Kapitel {chapter['order_index'] + 1}",
            "album": project['title'],
            "track": str(chapter['order_index'] + 1)
        }

        # Update progress: Conversion starting
        export_jobs[job_id]["progress"] = convert_progress_mid  # Format-specific
        export_jobs[job_id]["message"] = f"Encoding {output_format.upper()} audio..."

        # Broadcast progress event
        await broadcaster.broadcast_export_update(
            export_data={
                "exportId": job_id,
                "chapterId": chapter_id,
                "status": "running",
                "progress": convert_progress_mid,
                "message": f"Encoding {output_format.upper()} audio..."
            },
            event_type=EventType.EXPORT_PROGRESS
        )

        # Give frontend time to receive SSE update (600ms delay)
        await asyncio.sleep(0.6)

        # Convert to target format
        # Run in thread pool to avoid blocking the event loop
        output_path, file_size = await asyncio.to_thread(
            audio_service.convert_to_format,
            temp_wav_path,
            output_format,
            bitrate if output_format != 'wav' else None,
            sample_rate,
            metadata
        )

        # FIX BUG 2: Check for cancellation after conversion
        if job_id in export_jobs and export_jobs[job_id].get('status') == 'cancelled':
            logger.debug(f"Export job {job_id} was cancelled after conversion, cleaning up")
            # Cleanup both temp and output files
            if temp_wav_path and temp_wav_path.exists():
                temp_wav_path.unlink()
            if output_path and output_path.exists():
                output_path.unlink()
            return

        # Update progress: Conversion complete
        export_jobs[job_id]["progress"] = convert_progress_final  # Format-specific
        export_jobs[job_id]["message"] = "Finalizing export..."

        # Broadcast progress event
        await broadcaster.broadcast_export_update(
            export_data={
                "exportId": job_id,
                "chapterId": chapter_id,
                "status": "running",
                "progress": convert_progress_final,
                "message": "Finalizing export..."
            },
            event_type=EventType.EXPORT_PROGRESS
        )

        # Give frontend time to receive SSE update (600ms delay)
        await asyncio.sleep(0.6)

        # Generate HTTP URL for the exported file
        relative_path = output_path.relative_to(Path(EXPORTS_DIR))
        audio_url = f"http://localhost:8765/exports/{relative_path.as_posix()}"

        # Update job completion
        export_jobs[job_id].update({
            "status": "completed",
            "progress": 1.0,
            "message": "Export completed successfully",
            "output_path": audio_url,
            "file_size": file_size,
            "duration": duration,
            "completed_at": datetime.now()
        })

        # Update database
        if export_job:
            export_repo.update(
                job_id,
                status='completed',
                output_path=audio_url,
                file_size=file_size,
                duration=duration,
                merged_segments=len(exportable_segments),
                completed_at=datetime.now().isoformat()
            )

        # Broadcast export completed event
        await broadcaster.broadcast_export_update(
            export_data={
                "exportId": job_id,
                "chapterId": chapter_id,
                "status": "completed",
                "progress": 1.0,
                "message": "Export completed successfully",
                "outputPath": audio_url,
                "fileSize": file_size,
                "duration": duration
            },
            event_type=EventType.EXPORT_COMPLETED
        )

        logger.info(f"Export completed: {output_path} ({file_size} bytes, {duration:.1f}s)")

    except InterruptedError as e:
        # FIX BUG 2: Handle cancellation separately (not an error)
        error_msg = str(e)
        logger.info(f"Export cancelled for job {job_id}: {error_msg}")

        # Cleanup any partial temp files (WAV + output format)
        temp_wav_path = Path(EXPORTS_DIR) / f"{custom_filename}.wav"
        if temp_wav_path.exists():
            temp_wav_path.unlink()
            logger.debug(f"Cleaned up partial temp file: {temp_wav_path}")

        # Also cleanup output file if conversion started
        output_path = Path(EXPORTS_DIR) / f"{custom_filename}.{output_format}"
        if output_path.exists():
            output_path.unlink()
            logger.debug(f"Cleaned up partial output file: {output_path}")

        # Keep cancelled status (already set by cancel endpoint)
        if job_id in export_jobs:
            export_jobs[job_id].update({
                "progress": 0.0,
                "message": "Export cancelled by user",
                "completed_at": datetime.now()
            })

        # Broadcast export cancelled event
        await broadcaster.broadcast_export_update(
            export_data={
                "exportId": job_id,
                "chapterId": chapter_id,
                "status": "cancelled",
                "progress": 0.0,
                "message": "Export cancelled by user"
            },
            event_type=EventType.EXPORT_CANCELLED
        )

        # Database already updated by cancel endpoint, no need to update again

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Export failed for job {job_id}: {error_msg}")

        # Update job with error
        export_jobs[job_id] = {
            "status": "failed",
            "progress": 0.0,
            "message": "Export failed",
            "error": error_msg,
            "completed_at": datetime.now()
        }

        # Update database
        try:
            conn = get_db_connection_simple()
            export_repo = ExportJobRepository(conn)
            export_repo.update(
                job_id,
                status='failed',
                error_message=error_msg,
                completed_at=datetime.now().isoformat()
            )
        except Exception as db_error:
            logger.error(f"Failed to update database: {db_error}")

        # Broadcast export failed event
        await broadcaster.broadcast_export_update(
            export_data={
                "exportId": job_id,
                "chapterId": chapter_id,
                "status": "failed",
                "progress": 0.0,
                "message": f"Export failed: {error_msg}",
                "error": error_msg
            },
            event_type=EventType.EXPORT_FAILED
        )
    finally:
        # Always decrement active jobs count (success or failure)
        health_monitor.decrement_active_jobs()


@router.post("/export", response_model=ExportResponse)
async def start_export(
    request: ExportRequest,
    background_tasks: BackgroundTasks
):
    """
    Start audio export for a chapter

    This endpoint initiates a background export job that:
    1. Validates all segments are completed
    2. Merges segment audio files with pauses
    3. Converts to the requested format
    4. Adds metadata (title, track number)
    """
    try:
        # Get database connection
        conn = get_db_connection_simple()
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)
        export_repo = ExportJobRepository(conn)

        # Validate chapter exists
        chapter = chapter_repo.get_by_id(request.chapter_id)
        if not chapter:
            raise ApplicationError("EXPORT_CHAPTER_NOT_FOUND", status_code=404, chapterId=request.chapter_id)

        # Get segments
        segments = segment_repo.get_by_chapter(request.chapter_id)

        # Check if all STANDARD segments have audio (dividers don't need audio)
        incomplete_segments = [
            s for s in segments
            if s.get('segment_type', 'standard') == 'standard' and s.get('status') != 'completed'
        ]
        if incomplete_segments:
            raise ApplicationError("EXPORT_INCOMPLETE_SEGMENTS", status_code=400, count=len(incomplete_segments))

        if not segments:
            raise ApplicationError("EXPORT_NO_SEGMENTS", status_code=400, chapterId=request.chapter_id)

        # Get bitrate and sample_rate from quality preset or explicit values
        bitrate, sample_rate = request.get_export_params()

        # Create export job in database
        export_job = export_repo.create(
            chapter_id=request.chapter_id,
            output_format=request.output_format,
            total_segments=len(segments),
            bitrate=bitrate,
            sample_rate=sample_rate,
            pause_between_segments=request.pause_between_segments
        )

        job_id = export_job['id']

        # Initialize job in memory
        export_jobs[job_id] = {
            "status": "pending",
            "progress": 0.0,
            "current_segment": 0,
            "total_segments": len(segments),
            "message": "Export queued...",
            "created_at": datetime.now()
        }

        # Start background task
        background_tasks.add_task(
            export_task,
            job_id,
            request.chapter_id,
            request.output_format,
            bitrate,
            sample_rate,
            request.pause_between_segments,
            request.custom_filename
        )

        return ExportResponse(
            job_id=job_id,
            status="pending",
            message=f"Export started for chapter with {len(segments)} segments"
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to start export: {e}")
        raise ApplicationError("EXPORT_START_FAILED", status_code=500, error=str(e))


@router.get("/export/{job_id}/progress", response_model=ExportProgressResponse)
async def get_export_progress(job_id: str) -> ExportProgressResponse:
    """
    Get progress of an export job

    Returns current status and progress information for tracking
    the export operation in the UI.
    """
    # Check in-memory job first
    if job_id in export_jobs:
        job = export_jobs[job_id]
        return ExportProgressResponse(
            job_id=job_id,
            status=job.get("status", "unknown"),
            progress=job.get("progress", 0.0),
            current_segment=job.get("current_segment", 0),
            total_segments=job.get("total_segments", 0),
            message=job.get("message", ""),
            output_path=job.get("output_path"),
            file_size=job.get("file_size"),
            duration=job.get("duration"),
            error=job.get("error")
        )

    # Fall back to database
    try:
        conn = get_db_connection_simple()
        export_repo = ExportJobRepository(conn)
        export_job = export_repo.get_by_id(job_id)

        if export_job:
            progress = export_job['merged_segments'] / export_job['total_segments'] if export_job['total_segments'] > 0 else 0
            return ExportProgressResponse(
                job_id=job_id,
                status=export_job['status'],
                progress=progress,
                current_segment=export_job['merged_segments'],
                total_segments=export_job['total_segments'],
                message=f"Export {export_job['status']}",
                output_path=export_job.get('output_path'),
                file_size=export_job.get('file_size'),
                duration=export_job.get('duration'),
                error=export_job.get('error_message')
            )
        else:
            raise ApplicationError("EXPORT_JOB_NOT_FOUND", status_code=404, jobId=job_id)

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to get export progress: {e}")
        raise ApplicationError("EXPORT_PROGRESS_QUERY_FAILED", status_code=500, jobId=job_id, error=str(e))


@router.delete("/export/{job_id}/cancel", response_model=MessageResponse)
async def cancel_export(job_id: str) -> MessageResponse:
    """
    Cancel a running export job

    Attempts to stop an in-progress export operation.
    """
    try:
        logger.debug("cancel_export called", job_id=job_id)

        # Check if job exists
        if job_id not in export_jobs:
            # Check database
            conn = get_db_connection_simple()
            export_repo = ExportJobRepository(conn)
            export_job = export_repo.get_by_id(job_id)

            if not export_job:
                logger.debug("cancel_export: job not found", job_id=job_id)
                raise ApplicationError("EXPORT_JOB_NOT_FOUND", status_code=404, jobId=job_id)

            if export_job['status'] in ['completed', 'failed', 'cancelled']:
                logger.debug(
                    "cancel_export: job already terminal",
                    job_id=job_id,
                    status=export_job['status']
                )
                return MessageResponse(success=True, message=f"Job already {export_job['status']}")

        # Update job status
        previous_status = export_jobs.get(job_id, {}).get('status', 'unknown')
        if job_id in export_jobs:
            export_jobs[job_id]['status'] = 'cancelled'
            export_jobs[job_id]['message'] = 'Export cancelled by user'

        logger.debug(
            "cancel_export: status transition",
            job_id=job_id,
            previous_status=previous_status,
            new_status='cancelled'
        )

        # Update database
        conn = get_db_connection_simple()
        export_repo = ExportJobRepository(conn)
        export_repo.update(
            job_id,
            status='cancelled',
            error_message='Cancelled by user',
            completed_at=datetime.now().isoformat()
        )

        # Clean up any temporary files
        audio_service = AudioService()
        audio_service.cleanup_temp_files(job_id)

        return MessageResponse(success=True, message="Export cancelled successfully")

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel export: {e}")
        raise ApplicationError("EXPORT_CANCEL_FAILED", status_code=500, jobId=job_id, error=str(e))


@router.get("/export/{job_id}/download")
async def download_export(job_id: str) -> FileResponse:
    """
    Download the exported audio file

    Returns the exported file for download once the job is completed.
    """
    try:
        # Get job details
        conn = get_db_connection_simple()
        export_repo = ExportJobRepository(conn)
        export_job = export_repo.get_by_id(job_id)

        if not export_job:
            raise ApplicationError("EXPORT_JOB_NOT_FOUND", status_code=404, jobId=job_id)

        if export_job['status'] != 'completed':
            raise ApplicationError("EXPORT_NOT_READY", status_code=400, status=export_job['status'])

        if not export_job.get('output_path'):
            raise ApplicationError("EXPORT_FILE_NOT_FOUND", status_code=404, jobId=job_id)

        # Convert URL back to file path
        audio_service = AudioService()
        local_path = audio_service.url_to_local_path(export_job['output_path'])

        if not local_path.exists():
            raise ApplicationError("EXPORT_FILE_DELETED", status_code=410, jobId=job_id, path=str(local_path))

        # Return file for download
        return FileResponse(
            path=str(local_path),
            media_type='audio/mpeg' if local_path.suffix == '.mp3' else 'audio/wav',
            filename=local_path.name
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to download export: {e}")
        raise ApplicationError("EXPORT_DOWNLOAD_FAILED", status_code=500, jobId=job_id, error=str(e))


@router.delete("/export/{job_id}", response_model=MessageResponse)
async def delete_export(job_id: str) -> MessageResponse:
    """
    Delete export file and cleanup resources

    Called after successful download or when user cancels/closes dialog.
    Removes the exported audio file and any temporary files.
    """
    try:
        # Get job details
        conn = get_db_connection_simple()
        export_repo = ExportJobRepository(conn)
        export_job = export_repo.get_by_id(job_id)

        if not export_job:
            raise ApplicationError("EXPORT_JOB_NOT_FOUND", status_code=404, jobId=job_id)

        audio_service = AudioService()

        # Delete the main export file if it exists
        if export_job.get('output_path'):
            try:
                local_path = audio_service.url_to_local_path(export_job['output_path'])
                if local_path.exists():
                    local_path.unlink()
                    logger.debug(f"Deleted export file: {local_path}")
            except Exception as e:
                logger.warning(f"Failed to delete export file: {e}")

        # Cleanup any temporary files (WAV, etc.)
        audio_service.cleanup_temp_files(job_id)

        # Update job status to deleted
        export_repo.update(
            job_id,
            status='deleted',
            completed_at=datetime.now().isoformat()
        )

        # Remove from in-memory cache
        if job_id in export_jobs:
            del export_jobs[job_id]

        return MessageResponse(success=True, message="Export deleted successfully")

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to delete export: {e}")
        raise ApplicationError("EXPORT_DELETE_FAILED", status_code=500, jobId=job_id, error=str(e))


class MergeSegmentsRequest(BaseModel):
    """Request model for merging segments"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    chapter_id: str
    pause_ms: int = 500


@router.post("/merge", response_model=MergeResponse)
async def merge_segments(request: MergeSegmentsRequest) -> MergeResponse:
    """
    Quick merge for preview (no format conversion)

    Creates a temporary WAV file for immediate playback

    Request body (camelCase or snake_case accepted):
    {
      "chapterId": "chapter-123",
      "pauseMs": 500
    }
    """
    try:
        conn = get_db_connection_simple()
        segment_repo = SegmentRepository(conn)

        # Get segments
        segments = segment_repo.get_by_chapter(request.chapter_id)

        if not segments:
            raise ApplicationError("EXPORT_NO_SEGMENTS_FOUND", status_code=404, chapterId=request.chapter_id)

        # Initialize audio service
        audio_service = AudioService()

        # Quick merge to WAV
        output_path, duration = audio_service.merge_segments_to_file(
            segments,
            f"preview_{request.chapter_id}",
            request.pause_ms
        )

        # Return URL for playback
        relative_path = output_path.relative_to(Path(EXPORTS_DIR))
        audio_url = f"http://localhost:8765/exports/{relative_path.as_posix()}"

        return MergeResponse(
            success=True,
            audio_path=audio_url,
            duration=duration
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to merge segments: {e}")
        raise ApplicationError("AUDIO_MERGE_FAILED", status_code=500, chapterId=request.chapter_id, error=str(e))


@router.get("/duration/{file_path:path}", response_model=AudioDurationResponse)
async def get_audio_duration(file_path: str) -> AudioDurationResponse:
    """Get duration of an audio file"""
    try:
        audio_service = AudioService()
        local_path = Path('output') / file_path
        duration = audio_service.get_audio_duration(local_path)

        return AudioDurationResponse(
            file_path=file_path,
            duration=duration
        )
    except Exception as e:
        logger.error(f"Failed to get duration: {e}")
        raise ApplicationError("AUDIO_DURATION_FAILED", status_code=500, filePath=file_path, error=str(e))


# IMPORTANT: This catch-all route MUST be last!
# FastAPI matches routes in order, so specific routes like /duration must come first
@router.get("/{file_path:path}")
async def get_audio_file(file_path: str) -> FileResponse:
    """
    Serve audio files with proper CORS headers

    This endpoint serves audio files from the output directory.
    Using an explicit endpoint instead of StaticFiles mount ensures
    CORS middleware is applied correctly.

    IMPORTANT: This is a catch-all route and must be defined LAST
    to avoid shadowing other routes like /duration/{file_path}
    """
    from config import OUTPUT_DIR

    # Security: Prevent path traversal
    if '..' in file_path or file_path.startswith('/'):
        raise ApplicationError("EXPORT_INVALID_PATH", status_code=400, path=file_path)

    audio_path = Path(OUTPUT_DIR) / file_path

    if not audio_path.exists():
        raise ApplicationError("EXPORT_AUDIO_FILE_NOT_FOUND", status_code=404, path=file_path)

    if not audio_path.is_file():
        raise ApplicationError("EXPORT_NOT_A_FILE", status_code=400, path=file_path)

    # Determine media type based on file extension
    media_type = "audio/wav"
    if file_path.endswith('.mp3'):
        media_type = "audio/mpeg"
    elif file_path.endswith('.m4a'):
        media_type = "audio/mp4"
    elif file_path.endswith('.ogg'):
        media_type = "audio/ogg"

    response = FileResponse(
        path=str(audio_path),
        media_type=media_type,
        filename=audio_path.name
    )

    # Add CORS headers manually (FileResponse bypasses middleware in some cases)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"

    return response