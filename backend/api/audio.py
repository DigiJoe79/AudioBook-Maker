"""
Audio processing and export endpoints
"""
from typing import Dict, Any, Optional
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from loguru import logger

from db.database import get_db_connection_simple
from db.repositories import ChapterRepository, SegmentRepository, ExportJobRepository, ProjectRepository
from services.audio_service import AudioService
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

# In-memory storage for export jobs (similar to TTS generation jobs)
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
                return preset['bitrate'], preset['sample_rate']

        # Otherwise use explicit values or defaults
        bitrate = self.bitrate or "192k"
        sample_rate = self.sample_rate or 24000

        # WAV doesn't use bitrate
        if self.output_format == 'wav':
            bitrate = None

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

    # Notify health monitor that a job started
    health_monitor = get_health_monitor()
    health_monitor.increment_active_jobs()

    try:
        # Update job status to running
        export_jobs[job_id] = {
            "status": "running",
            "progress": 0.0,
            "current_segment": 0,
            "total_segments": 0,
            "message": "Starting export...",
            "started_at": datetime.now()
        }

        # Get database connection
        conn = get_db_connection_simple()
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)
        project_repo = ProjectRepository(conn)
        export_repo = ExportJobRepository(conn)

        # Get chapter details
        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise HTTPException(status_code=404, detail=f"Chapter {chapter_id} not found")

        # Get project details for naming
        project = project_repo.get_by_id(chapter['project_id'])
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

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

        # Progress callback for merging
        def update_progress(current: int, total: int):
            progress = current / total if total > 0 else 0
            export_jobs[job_id].update({
                "progress": progress * 0.5,  # First 50% for merging
                "current_segment": current,
                "message": f"Merging segment {current}/{total}..."
            })
            # Also update database
            if export_job:
                export_repo.update(job_id, merged_segments=current)

        # Merge segments (includes standard + divider)
        logger.info(f"Merging {len(exportable_segments)} segments for chapter {chapter_id}")
        temp_wav_path, duration = audio_service.merge_segments_to_file(
            exportable_segments,
            custom_filename,
            pause_between_segments,
            update_progress
        )

        export_jobs[job_id]["message"] = f"Converting to {output_format.upper()}..."
        export_jobs[job_id]["progress"] = 0.5  # 50% done

        # Prepare metadata
        metadata = {
            "title": f"{project['title']} - Kapitel {chapter['order_index'] + 1}",
            "album": project['title'],
            "track": str(chapter['order_index'] + 1)
        }

        # Convert to target format
        output_path, file_size = audio_service.convert_to_format(
            temp_wav_path,
            output_format,
            bitrate if output_format != 'wav' else None,
            sample_rate,
            metadata
        )

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

        logger.info(f"Export completed: {output_path} ({file_size} bytes, {duration:.1f}s)")

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
            raise HTTPException(status_code=404, detail="Chapter not found")

        # Get segments
        segments = segment_repo.get_by_chapter(request.chapter_id)

        # Check if all STANDARD segments have audio (dividers don't need audio)
        incomplete_segments = [
            s for s in segments
            if s.get('segment_type', 'standard') == 'standard' and s.get('status') != 'completed'
        ]
        if incomplete_segments:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot export: {len(incomplete_segments)} segments are not completed"
            )

        if not segments:
            raise HTTPException(status_code=400, detail="Chapter has no segments")

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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start export: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/{job_id}/progress", response_model=ExportProgressResponse)
async def get_export_progress(job_id: str):
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
            raise HTTPException(status_code=404, detail="Export job not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get export progress: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/export/{job_id}/cancel", response_model=MessageResponse)
async def cancel_export(job_id: str):
    """
    Cancel a running export job

    Attempts to stop an in-progress export operation.
    """
    try:
        # Check if job exists
        if job_id not in export_jobs:
            # Check database
            conn = get_db_connection_simple()
            export_repo = ExportJobRepository(conn)
            export_job = export_repo.get_by_id(job_id)

            if not export_job:
                raise HTTPException(status_code=404, detail="Export job not found")

            if export_job['status'] in ['completed', 'failed', 'cancelled']:
                return {"success": True, "message": f"Job already {export_job['status']}"}

        # Update job status
        if job_id in export_jobs:
            export_jobs[job_id]['status'] = 'cancelled'
            export_jobs[job_id]['message'] = 'Export cancelled by user'

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

        return {"success": True, "message": "Export cancelled successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel export: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/{job_id}/download")
async def download_export(job_id: str):
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
            raise HTTPException(status_code=404, detail="Export job not found")

        if export_job['status'] != 'completed':
            raise HTTPException(
                status_code=400,
                detail=f"Export not ready: status is {export_job['status']}"
            )

        if not export_job.get('output_path'):
            raise HTTPException(status_code=404, detail="Export file not found")

        # Convert URL back to file path
        audio_service = AudioService()
        local_path = audio_service.url_to_local_path(export_job['output_path'])

        if not local_path.exists():
            raise HTTPException(status_code=404, detail="Export file no longer exists")

        # Return file for download
        return FileResponse(
            path=str(local_path),
            media_type='audio/mpeg' if local_path.suffix == '.mp3' else 'audio/wav',
            filename=local_path.name
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download export: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/export/{job_id}", response_model=MessageResponse)
async def delete_export(job_id: str):
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
            raise HTTPException(status_code=404, detail="Export job not found")

        audio_service = AudioService()

        # Delete the main export file if it exists
        if export_job.get('output_path'):
            try:
                local_path = audio_service.url_to_local_path(export_job['output_path'])
                if local_path.exists():
                    local_path.unlink()
                    logger.info(f"Deleted export file: {local_path}")
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

        return {"success": True, "message": "Export deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete export: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class MergeSegmentsRequest(BaseModel):
    """Request model for merging segments"""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    chapter_id: str
    pause_ms: int = 500


@router.post("/merge", response_model=MergeResponse)
async def merge_segments(request: MergeSegmentsRequest):
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
            raise HTTPException(status_code=400, detail="No segments found")

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

        return {
            "success": True,
            "audio_path": audio_url,
            "duration": duration
        }

    except Exception as e:
        logger.error(f"Failed to merge segments: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/duration/{file_path:path}", response_model=AudioDurationResponse)
async def get_audio_duration(file_path: str):
    """Get duration of an audio file"""
    try:
        audio_service = AudioService()
        local_path = Path('output') / file_path
        duration = audio_service.get_audio_duration(local_path)

        return {
            "file_path": file_path,
            "duration": duration
        }
    except Exception as e:
        logger.error(f"Failed to get duration: {e}")
        raise HTTPException(status_code=500, detail=str(e))