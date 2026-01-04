"""
Quality Analysis Endpoints - Unified STT + Audio Analysis

Provides job-based quality analysis endpoints using the Quality Worker system.
"""

from fastapi import APIRouter, Depends
from core.exceptions import ApplicationError
from typing import Optional
from loguru import logger

from db.database import get_db
from db.quality_job_repository import QualityJobRepository
from db.repositories import SegmentRepository, ChapterRepository
from models.response_models import (
    QualityJobCreatedResponse,
)
from services.settings_service import SettingsService

router = APIRouter(prefix="/api/quality", tags=["quality"])


@router.post("/analyze/segment/{segment_id}", response_model=QualityJobCreatedResponse)
async def analyze_segment(
    segment_id: str,
    stt_engine: Optional[str] = None,
    stt_model_name: Optional[str] = None,
    audio_engine: Optional[str] = None,
    db=Depends(get_db)
):
    """
    Create quality analysis job for a single segment.

    Uses default engines from settings if not specified.
    """
    try:
        segment_repo = SegmentRepository(db)
        job_repo = QualityJobRepository(db)
        settings_service = SettingsService(db)

        # Validate segment
        segment = segment_repo.get_by_id(segment_id)
        if not segment:
            raise ApplicationError("STT_SEGMENT_NOT_FOUND", status_code=404, segmentId=segment_id)

        # Check frozen FIRST (consistent with TTS)
        if segment.get('is_frozen'):
            raise ApplicationError("QUALITY_SEGMENT_FROZEN", status_code=400)

        if not segment.get('audio_path'):
            raise ApplicationError("QUALITY_NO_AUDIO", status_code=400)

        # Get default engines if not specified
        if stt_engine is None:
            stt_engine = settings_service.get_default_engine('stt')
            if stt_engine:
                stt_model_name = stt_model_name or settings_service.get_default_model_for_engine(stt_engine, 'stt')

        if audio_engine is None:
            audio_engine = settings_service.get_default_engine('audio')

        logger.debug(
            f"[quality] analyze_segment segment_id={segment_id} "
            f"has_audio={bool(segment.get('audio_path'))} stt_engine={stt_engine} audio_engine={audio_engine}"
        )

        # Validate engines are actually available (discovered AND enabled)
        from core.stt_engine_manager import get_stt_engine_manager
        from core.audio_engine_manager import get_audio_engine_manager

        if stt_engine:
            stt_manager = get_stt_engine_manager()
            stt_available = stt_manager.is_engine_available(stt_engine)
            logger.debug("Engine availability check", engine_type="stt", engine=stt_engine, available=stt_available)
            if not stt_available:
                logger.warning(f"STT engine '{stt_engine}' not available, skipping STT analysis")
                stt_engine = None
                stt_model_name = None

        if audio_engine:
            audio_manager = get_audio_engine_manager()
            audio_available = audio_manager.is_engine_available(audio_engine)
            logger.debug("Engine availability check", engine_type="audio", engine=audio_engine, available=audio_available)
            if not audio_available:
                logger.warning(f"Audio engine '{audio_engine}' not available, skipping audio analysis")
                audio_engine = None

        # At least one engine must be active
        if not stt_engine and not audio_engine:
            raise ApplicationError("QUALITY_NO_ENGINES", status_code=400)

        logger.debug("Engines validated for analysis", stt_engine=stt_engine, audio_engine=audio_engine)

        # Create job with segment_ids for tracking
        job_params = dict(
            job_type='segment',
            language=segment.get('language', 'en'),
            total_segments=1,
            segment_id=segment_id,
            chapter_id=segment.get('chapter_id'),
            stt_engine=stt_engine,
            stt_model_name=stt_model_name,
            audio_engine=audio_engine,
            trigger_source='manual',
            segment_ids=[segment_id]
        )
        logger.debug("Creating quality job", **job_params)
        job = job_repo.create(**job_params)

        logger.info(f"Created quality job {job['id']} for segment {segment_id}")

        # Emit SSE event for frontend update (job dict has titles from JOIN)
        from services.event_broadcaster import emit_quality_job_created
        await emit_quality_job_created(
            job_id=job['id'],
            chapter_id=segment.get('chapter_id'),
            total_segments=1,
            segment_ids=[segment_id],
            job_type='segment',
            chapter_title=job.get('chapter_title'),
            project_title=job.get('project_title'),
            stt_engine=stt_engine,
            audio_engine=audio_engine
        )

        return QualityJobCreatedResponse(
            job_id=job['id'],
            message="Quality analysis job created",
            status="pending"
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to create quality job: {e}")
        raise ApplicationError("QUALITY_JOB_CREATE_FAILED", status_code=500, error=str(e))


@router.post("/analyze/chapter/{chapter_id}", response_model=QualityJobCreatedResponse)
async def analyze_chapter(
    chapter_id: str,
    stt_engine: Optional[str] = None,
    stt_model_name: Optional[str] = None,
    audio_engine: Optional[str] = None,
    db=Depends(get_db)
):
    """
    Create quality analysis job for all segments in a chapter.

    Queues job for processing by Quality Worker. Uses default engines if not specified.
    """
    try:
        chapter_repo = ChapterRepository(db)
        segment_repo = SegmentRepository(db)
        job_repo = QualityJobRepository(db)
        settings_service = SettingsService(db)

        # Validate chapter
        chapter = chapter_repo.get_by_id(chapter_id)
        if not chapter:
            raise ApplicationError("STT_CHAPTER_NOT_FOUND", status_code=404, chapterId=chapter_id)

        # Get segments with audio
        segments = segment_repo.get_by_chapter(chapter_id)
        segments_with_audio = [
            s for s in segments
            if s.get('audio_path') and s.get('status') == 'completed' and not s.get('is_frozen')
        ]

        logger.debug(
            f"[quality] analyze_chapter chapter_id={chapter_id} "
            f"total_segments={len(segments)} with_audio={len(segments_with_audio)}"
        )

        if not segments_with_audio:
            raise ApplicationError("QUALITY_NO_SEGMENTS", status_code=400)

        # Check for active jobs
        active_jobs = job_repo.get_active_jobs_for_chapter(chapter_id)
        if active_jobs:
            raise ApplicationError("QUALITY_JOB_IN_PROGRESS", status_code=409, jobId=active_jobs[0]['id'])

        # Get default engines
        if stt_engine is None:
            stt_engine = settings_service.get_default_engine('stt')
            if stt_engine:
                stt_model_name = stt_model_name or settings_service.get_default_model_for_engine(stt_engine, 'stt')

        if audio_engine is None:
            audio_engine = settings_service.get_default_engine('audio')

        # Validate engines are actually available (discovered AND enabled)
        from core.stt_engine_manager import get_stt_engine_manager
        from core.audio_engine_manager import get_audio_engine_manager

        if stt_engine:
            stt_manager = get_stt_engine_manager()
            if not stt_manager.is_engine_available(stt_engine):
                logger.warning(f"STT engine '{stt_engine}' not available, skipping STT analysis")
                stt_engine = None
                stt_model_name = None

        if audio_engine:
            audio_manager = get_audio_engine_manager()
            if not audio_manager.is_engine_available(audio_engine):
                logger.warning(f"Audio engine '{audio_engine}' not available, skipping audio analysis")
                audio_engine = None

        if not stt_engine and not audio_engine:
            raise ApplicationError("QUALITY_NO_ENGINES", status_code=400)

        # Create job with segment_ids for tracking
        segment_ids = [s['id'] for s in segments_with_audio]
        job = job_repo.create(
            job_type='chapter',
            language=segments_with_audio[0].get('language', 'en'),
            total_segments=len(segments_with_audio),
            chapter_id=chapter_id,
            stt_engine=stt_engine,
            stt_model_name=stt_model_name,
            audio_engine=audio_engine,
            trigger_source='manual',
            segment_ids=segment_ids
        )

        logger.debug(f"Created quality job {job['id']} for chapter {chapter_id} ({len(segments_with_audio)} segments)")

        # Emit SSE event for frontend update (job dict has titles from JOIN)
        from services.event_broadcaster import emit_quality_job_created
        await emit_quality_job_created(
            job_id=job['id'],
            chapter_id=chapter_id,
            total_segments=len(segments_with_audio),
            segment_ids=segment_ids,
            job_type='chapter',
            chapter_title=job.get('chapter_title'),
            project_title=job.get('project_title'),
            stt_engine=stt_engine,
            audio_engine=audio_engine
        )

        return QualityJobCreatedResponse(
            job_id=job['id'],
            message=f"Quality analysis job created for {len(segments_with_audio)} segments",
            status="pending"
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to create quality job: {e}")
        raise ApplicationError("QUALITY_JOB_CREATE_FAILED", status_code=500, error=str(e))
