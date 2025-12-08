"""
Quality Worker - Database-polling job processor for quality analysis

Runs as background thread, polls quality_jobs table for pending jobs,
routes them to STT and Audio engines, and updates status in database.

Architecture:
- Single-threaded worker (processes one job at a time)
- Polls DB every 1 second for pending jobs
- Engine-agnostic (works with any STT/Audio engine)
- Updates DB progress in real-time
- Graceful shutdown support
"""

import time
import threading
import asyncio
import sqlite3
from pathlib import Path
from typing import Optional, Callable, TypeVar, Dict, Any, List
from loguru import logger

from db.database import get_db_connection_simple
from db.quality_job_repository import QualityJobRepository
from db.repositories import SegmentRepository
from db.segments_analysis_repository import SegmentsAnalysisRepository
from services.settings_service import SettingsService

T = TypeVar('T')


def retry_on_db_lock(func: Callable[..., T], max_retries: int = None, initial_delay: float = None) -> T:
    """Retry a function if it fails with 'database is locked' error."""
    from config import DB_LOCK_MAX_RETRIES, DB_LOCK_INITIAL_DELAY
    max_retries = max_retries if max_retries is not None else DB_LOCK_MAX_RETRIES
    initial_delay = initial_delay if initial_delay is not None else DB_LOCK_INITIAL_DELAY
    delay = initial_delay
    last_error = None

    for attempt in range(max_retries):
        try:
            return func()
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e).lower():
                last_error = e
                if attempt < max_retries - 1:
                    logger.warning(
                        f"Database locked (attempt {attempt + 1}/{max_retries}), "
                        f"retrying in {delay:.2f}s..."
                    )
                    time.sleep(delay)
                    delay *= 2
                    continue
            raise
        except Exception:
            raise

    logger.error(f"Database locked after {max_retries} retries, giving up")
    raise last_error


class QualityWorker:
    """
    Background worker for quality analysis (STT + Audio)

    Polls database for pending quality jobs and processes them sequentially.
    Each job can include STT analysis, Audio analysis, or both.
    """

    def __init__(self, poll_interval: float = None, event_loop: Optional[asyncio.AbstractEventLoop] = None):
        from config import QUALITY_WORKER_POLL_INTERVAL
        self.poll_interval = poll_interval if poll_interval is not None else QUALITY_WORKER_POLL_INTERVAL
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.current_job_id: Optional[str] = None
        self._event_loop = event_loop

    def start(self):
        """Start worker in background thread"""
        if self.running:
            logger.warning("[QualityWorker] Quality Worker already running")
            return

        self.running = True
        self.thread = threading.Thread(
            target=self._worker_loop,
            name="QualityWorker",
            daemon=True
        )
        self.thread.start()
        logger.debug("[QualityWorker] ✓ Quality Worker started polling_interval={:.1f}s", self.poll_interval)

    def stop(self, timeout: float = None):
        """Stop worker gracefully"""
        from config import WORKER_STOP_TIMEOUT
        timeout = timeout if timeout is not None else WORKER_STOP_TIMEOUT

        if not self.running:
            return

        logger.info("[QualityWorker] Stopping Quality Worker...")
        self.running = False

        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=timeout)

            if self.thread.is_alive():
                logger.warning(f"[QualityWorker] Worker did not stop within timeout timeout={timeout}s")
            else:
                logger.info("[QualityWorker] ✓ Quality Worker stopped gracefully")

    def _emit_event_sync(self, coro):
        """Emit event from synchronous worker thread."""
        if self._event_loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(coro, self._event_loop)
        except Exception as e:
            logger.error(f"Failed to emit event: {e}")

    def _worker_loop(self):
        """Main worker loop - polls database for jobs"""
        while self.running:
            try:
                def get_next_job():
                    conn = get_db_connection_simple()
                    job_repo = QualityJobRepository(conn)
                    job = job_repo.get_next_pending_job()
                    conn.close()
                    return job

                job = retry_on_db_lock(get_next_job)

                if job:
                    self.current_job_id = job['id']
                    logger.info(f"Processing Quality job {job['id']} ({job['job_type']})")
                    self._process_job_sync(job)
                    self.current_job_id = None
                else:
                    time.sleep(self.poll_interval)

            except KeyboardInterrupt:
                logger.info("[QualityWorker] Worker interrupted, shutting down...")
                self.running = False
                break
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e).lower():
                    logger.warning(f"[QualityWorker] Database locked, retrying in {self.poll_interval}s...")
                else:
                    logger.error(f"[QualityWorker] Database error: {e}", exc_info=True)
                time.sleep(self.poll_interval)
            except Exception as e:
                logger.error(f"[QualityWorker] Unexpected error: {e}", exc_info=True)
                time.sleep(self.poll_interval)

    def _process_job_sync(self, job: dict):
        """Synchronous wrapper for async job processing"""
        if self._event_loop is None:
            logger.error("[QualityWorker] Cannot process job: no event loop available")
            return

        future = asyncio.run_coroutine_threadsafe(
            self._process_job_async(job),
            self._event_loop
        )

        try:
            future.result()
        except Exception as e:
            logger.error(f"Job processing failed: {e}", exc_info=True)

    async def _process_job_async(self, job: dict):
        """Process a single quality job (async)"""
        conn = get_db_connection_simple()
        job_repo = QualityJobRepository(conn)
        segment_repo = SegmentRepository(conn)
        settings_service = SettingsService(conn)

        try:
            # 1. Determine segments to analyze from stored segment_ids
            # This ensures consistent behavior and proper resume support
            segment_objs = job.get('segment_ids', [])

            # Total segments is the ORIGINAL count from job creation (for progress display)
            total_segments = job.get('total_segments', 0)

            if not segment_objs:
                raise ValueError(f"Job {job['id']} has no segment_ids - cannot process")

            # Use stored segment_ids, filter to only pending segments (for resume)
            pending_segment_ids = [
                obj['id'] for obj in segment_objs
                if obj.get('job_status') == 'pending'
            ]
            # If no total_segments stored, use full segment count
            if not total_segments:
                total_segments = len(segment_objs)

            # Check if there are any pending segments to process
            if len(pending_segment_ids) == 0:
                logger.info(f"No pending segments for job {job['id']} - marking complete")
                job_repo.mark_completed(job['id'])
                # Emit SSE event for job completion
                from services.event_broadcaster import emit_quality_job_completed
                self._emit_event_sync(
                    emit_quality_job_completed(job['id'], job['chapter_id'], total_segments)
                )
                return

            # 2. Get engine managers
            stt_manager = None
            audio_manager = None

            if job.get('stt_engine'):
                from core.stt_engine_manager import get_stt_engine_manager
                stt_manager = get_stt_engine_manager()
                await stt_manager.ensure_engine_ready(job['stt_engine'], job.get('stt_model_name'))

            if job.get('audio_engine'):
                from core.audio_engine_manager import get_audio_engine_manager
                audio_manager = get_audio_engine_manager()
                # Get default model for audio engine
                audio_model_name = settings_service.get_default_model_for_engine(job['audio_engine'], 'audio')
                await audio_manager.ensure_engine_ready(job['audio_engine'], audio_model_name)

            # 3. Emit job started event (with existing progress for resumed jobs)
            from services.event_broadcaster import emit_quality_job_started
            initial_processed = job.get('processed_segments', 0) or 0
            self._emit_event_sync(
                emit_quality_job_started(
                    job['id'],
                    job['chapter_id'],
                    total_segments,
                    processed_segments=initial_processed,
                    started_at=job.get('started_at')
                )
            )

            # 4. Process each segment
            # For resumed jobs, start from existing progress
            processed = job.get('processed_segments', 0) or 0
            failed = job.get('failed_segments', 0) or 0
            analysis_repo = SegmentsAnalysisRepository(conn)

            # Auto-regenerate settings: 0=Deaktiviert, 1=Gebündelt, 2=Einzeln
            regenerate_mode = settings_service.get_setting('quality.autoRegenerateDefects') or 0
            defective_segments: List[dict] = []  # For bundled regeneration (mode 1)

            for segment_id in pending_segment_ids:
                if not self.running:
                    job_repo.mark_failed(job['id'], "Worker shutdown")
                    return

                # Check cancellation
                fresh_job = job_repo.get_by_id(job['id'])
                if fresh_job and fresh_job['status'] == 'cancelling':
                    job_repo.mark_cancelled(job['id'])
                    # Emit SSE event for UI update
                    from services.event_broadcaster import emit_quality_job_cancelled
                    self._emit_event_sync(
                        emit_quality_job_cancelled(job['id'], job.get('chapter_id', ''))
                    )
                    logger.info(f"Quality Job {job['id']} cancelled by user")
                    return

                segment = segment_repo.get_by_id(segment_id)
                if not segment or segment.get('is_frozen'):
                    processed += 1
                    job_repo.update_progress(job['id'], processed, failed)
                    continue

                try:
                    result = await self._analyze_segment(
                        segment,
                        stt_manager,
                        audio_manager,
                        job,
                        settings_service,
                        conn
                    )

                    # Save result
                    analysis_repo.save_quality_analysis(
                        segment_id=segment_id,
                        chapter_id=segment['chapter_id'],
                        quality_score=result['qualityScore'],
                        quality_status=result['qualityStatus'],
                        engine_results=result['engines']
                    )

                    processed += 1
                    job_repo.update_progress(job['id'], processed, failed)

                    # Mark segment as analyzed in job (for resume support)
                    job_repo.mark_segment_analyzed(job['id'], segment_id)

                    # Emit SSE event for frontend update
                    from services.event_broadcaster import emit_quality_segment_analyzed, emit_quality_job_progress
                    self._emit_event_sync(
                        emit_quality_segment_analyzed(
                            segment_id=segment_id,
                            chapter_id=segment['chapter_id'],
                            job_id=job['id'],
                            quality_score=result['qualityScore'],
                            quality_status=result['qualityStatus'],
                            engine_results=result['engines']
                        )
                    )
                    # Emit progress event
                    self._emit_event_sync(
                        emit_quality_job_progress(
                            job_id=job['id'],
                            chapter_id=job['chapter_id'],
                            processed_segments=processed,
                            total_segments=total_segments,
                            progress=(processed / total_segments) * 100 if total_segments > 0 else 0
                        )
                    )

                    logger.debug(f"Segment {segment_id} analyzed (score: {result['qualityScore']})")

                    # Auto-Regenerate: Handle defective segments based on mode
                    if result['qualityStatus'] == 'defect':
                        if regenerate_mode == 2:  # Einzeln: sofort Job erstellen
                            await self._handle_auto_regenerate(
                                segment=segment,
                                segment_repo=segment_repo,
                                settings_service=settings_service,
                                conn=conn
                            )
                        elif regenerate_mode == 1:  # Gebündelt: sammeln
                            defective_segments.append(segment)
                        # mode == 0: nichts tun (Deaktiviert)

                except Exception as e:
                    logger.error(f"Segment {segment_id} failed: {e}")
                    failed += 1

            # 4.1 Gebündelt: Create batch TTS job for all defective segments
            if regenerate_mode == 1 and defective_segments:
                await self._create_batch_regenerate_job(
                    segments=defective_segments,
                    segment_repo=segment_repo,
                    settings_service=settings_service,
                    conn=conn
                )

            # 5. Mark job complete and emit SSE event
            from services.event_broadcaster import emit_quality_job_completed, emit_quality_job_failed
            if failed == 0:
                job_repo.mark_completed(job['id'])
                logger.success(f"Quality Job {job['id']} completed ({processed}/{total_segments})")
                self._emit_event_sync(
                    emit_quality_job_completed(job['id'], job['chapter_id'], total_segments)
                )
            else:
                error_msg = f"Completed with {failed} failures"
                job_repo.mark_failed(job['id'], error_msg)
                logger.warning(f"Quality Job {job['id']} completed with {failed} failures")
                self._emit_event_sync(
                    emit_quality_job_failed(job['id'], job['chapter_id'], error_msg)
                )

        except Exception as e:
            logger.error(f"Quality Job {job['id']} failed: {e}", exc_info=True)
            job_repo.mark_failed(job['id'], str(e))
            # Emit SSE event for job failure
            from services.event_broadcaster import emit_quality_job_failed
            self._emit_event_sync(
                emit_quality_job_failed(job['id'], job.get('chapter_id', ''), str(e))
            )
        finally:
            conn.close()

    async def _analyze_segment(
        self,
        segment: dict,
        stt_manager,
        audio_manager,
        job: dict,
        settings_service: SettingsService,
        conn
    ) -> Dict[str, Any]:
        """
        Analyze a single segment with configured engines.

        Returns aggregated result in generic format.
        """
        from config import OUTPUT_DIR

        audio_path = Path(OUTPUT_DIR) / segment['audio_path']
        engine_results = []

        # STT Analysis
        if stt_manager and job.get('stt_engine'):
            try:
                # Get expected text from segment
                expected_text = segment.get('text') or segment.get('content', '')

                # Load pronunciation rules for text comparison
                pronunciation_rules = []
                try:
                    from db.pronunciation_repository import PronunciationRulesRepository
                    pron_repo = PronunciationRulesRepository(conn)
                    # Get rules for this segment's context (engine, language, project)
                    rules = pron_repo.get_rules_for_context(
                        engine_name=segment.get('tts_engine', ''),
                        language=segment.get('language', 'en'),
                        project_id=job.get('project_id')
                    )
                    pronunciation_rules = [
                        {
                            'pattern': r.pattern,
                            'replacement': r.replacement,
                            'isRegex': r.is_regex,
                            'isActive': r.is_active
                        }
                        for r in rules if r.is_active
                    ]
                except Exception as e:
                    logger.warning(f"Failed to load pronunciation rules: {e}")

                stt_result = await stt_manager.analyze_generic(
                    engine_name=job['stt_engine'],
                    audio_path=str(audio_path),
                    language=segment.get('language', 'en'),
                    model_name=job.get('stt_model_name'),
                    expected_text=expected_text,
                    pronunciation_rules=pronunciation_rules
                )
                engine_results.append(stt_result)
            except Exception as e:
                logger.error(f"STT analysis failed: {e}")

        # Audio Analysis
        if audio_manager and job.get('audio_engine'):
            try:
                # Load thresholds from settings
                engine_config = settings_service.get_setting(f"audio.engines.{job['audio_engine']}") or {}
                thresholds = engine_config.get('parameters', {})

                audio_result = await audio_manager.analyze_generic(
                    engine_name=job['audio_engine'],
                    audio_path=str(audio_path),
                    thresholds=thresholds
                )
                engine_results.append(audio_result)
            except Exception as e:
                logger.error(f"Audio analysis failed: {e}")

        # Aggregate results
        return self._aggregate_results(engine_results)

    async def _handle_auto_regenerate(
        self,
        segment: dict,
        segment_repo: SegmentRepository,
        settings_service: SettingsService,
        conn
    ):
        """
        Handle auto-regeneration of a single defective segment (Einzeln mode).

        Called when regenerate_mode == 2. Mode check is done by caller.
        Creates individual TTS job for this segment.
        """
        try:
            # Get quality settings for max attempts check
            max_attempts = settings_service.get_setting('quality.maxRegenerateAttempts') or 5
            current_attempts = segment.get('regenerate_attempts', 0)

            if current_attempts >= max_attempts:
                logger.warning(
                    f"Segment {segment['id']} reached max regenerate attempts "
                    f"({current_attempts}/{max_attempts}), skipping"
                )
                return

            # Increment attempts counter
            new_attempts = segment_repo.increment_regenerate_attempts(segment['id'])
            logger.info(
                f"Auto-regenerating segment {segment['id']} "
                f"(attempt {new_attempts}/{max_attempts})"
            )

            # Create TTS job for this segment
            from db.repositories import TTSJobRepository
            tts_job_repo = TTSJobRepository(conn)

            tts_job = tts_job_repo.create(
                chapter_id=segment['chapter_id'],
                tts_engine=segment['tts_engine'],
                tts_model_name=segment['tts_model_name'],
                tts_speaker_name=segment.get('tts_speaker_name', ''),
                language=segment['language'],
                force_regenerate=True,
                total_segments=1,
                segment_ids=[segment['id']]
            )

            logger.info(f"Created auto-regenerate TTS job {tts_job['id']} for segment {segment['id']}")

            # Get chapter and project titles for display
            from db.repositories import ChapterRepository, ProjectRepository
            chapter_repo = ChapterRepository(conn)
            chapter = chapter_repo.get_by_id(segment['chapter_id'])
            chapter_title = chapter.get('title') if chapter else None
            project_title = None
            if chapter and chapter.get('project_id'):
                project_repo = ProjectRepository(conn)
                project = project_repo.get_by_id(chapter['project_id'])
                project_title = project.get('title') if project else None

            # Emit SSE event
            from services.event_broadcaster import broadcaster, EventType
            self._emit_event_sync(
                broadcaster.broadcast_event(
                    EventType.JOB_CREATED,
                    {
                        'jobId': tts_job['id'],
                        'jobType': 'segment',
                        'chapterId': segment['chapter_id'],
                        'segmentIds': [{'id': segment['id'], 'job_status': 'pending'}],
                        'totalSegments': 1,
                        'triggerSource': 'auto_regenerate',
                        # Display fields for frontend
                        'chapterTitle': chapter_title,
                        'projectTitle': project_title,
                        'ttsEngine': segment['tts_engine'],
                        'ttsModelName': segment['tts_model_name'],
                        'ttsSpeakerName': segment.get('tts_speaker_name', '')
                    },
                    channel='jobs'
                )
            )

        except Exception as e:
            logger.error(f"Failed to auto-regenerate segment {segment['id']}: {e}")

    async def _create_batch_regenerate_job(
        self,
        segments: List[dict],
        segment_repo: SegmentRepository,
        settings_service: SettingsService,
        conn
    ):
        """
        Create single TTS job for multiple defective segments (Gebündelt mode).

        Called when regenerate_mode == 1 at the end of quality job processing.
        Filters segments by maxRegenerateAttempts and creates one batch TTS job.
        """
        try:
            max_attempts = settings_service.get_setting('quality.maxRegenerateAttempts') or 5

            # Filter: only segments under maxRegenerateAttempts
            eligible_segments = []
            for seg in segments:
                current_attempts = seg.get('regenerate_attempts', 0)
                if current_attempts < max_attempts:
                    # Increment counter
                    new_attempts = segment_repo.increment_regenerate_attempts(seg['id'])
                    eligible_segments.append(seg)
                    logger.debug(
                        f"Segment {seg['id']} eligible for batch regenerate "
                        f"(attempt {new_attempts}/{max_attempts})"
                    )
                else:
                    logger.warning(
                        f"Segment {seg['id']} reached max regenerate attempts "
                        f"({current_attempts}/{max_attempts}), skipping"
                    )

            if not eligible_segments:
                logger.debug("[QualityWorker] No eligible segments for batch regeneration")
                return

            # Use TTS parameters from first segment (all should be from same chapter)
            first = eligible_segments[0]

            from db.repositories import TTSJobRepository
            tts_job_repo = TTSJobRepository(conn)

            tts_job = tts_job_repo.create(
                chapter_id=first['chapter_id'],
                tts_engine=first['tts_engine'],
                tts_model_name=first['tts_model_name'],
                tts_speaker_name=first.get('tts_speaker_name', ''),
                language=first['language'],
                force_regenerate=True,
                total_segments=len(eligible_segments),
                segment_ids=[s['id'] for s in eligible_segments]
            )

            logger.info(
                f"Created batch auto-regenerate TTS job {tts_job['id']} "
                f"for {len(eligible_segments)} segments"
            )

            # Get chapter and project titles for display
            from db.repositories import ChapterRepository, ProjectRepository
            chapter_repo = ChapterRepository(conn)
            chapter = chapter_repo.get_by_id(first['chapter_id'])
            chapter_title = chapter.get('title') if chapter else None
            project_title = None
            if chapter and chapter.get('project_id'):
                project_repo = ProjectRepository(conn)
                project = project_repo.get_by_id(chapter['project_id'])
                project_title = project.get('title') if project else None

            # Emit SSE event
            from services.event_broadcaster import broadcaster, EventType
            self._emit_event_sync(
                broadcaster.broadcast_event(
                    EventType.JOB_CREATED,
                    {
                        'jobId': tts_job['id'],
                        'jobType': 'segment' if len(eligible_segments) == 1 else 'selection',
                        'chapterId': first['chapter_id'],
                        'segmentIds': [{'id': s['id'], 'job_status': 'pending'} for s in eligible_segments],
                        'totalSegments': len(eligible_segments),
                        'triggerSource': 'auto_regenerate_batch',
                        # Display fields for frontend
                        'chapterTitle': chapter_title,
                        'projectTitle': project_title,
                        'ttsEngine': first['tts_engine'],
                        'ttsModelName': first['tts_model_name'],
                        'ttsSpeakerName': first.get('tts_speaker_name', '')
                    },
                    channel='jobs'
                )
            )

        except Exception as e:
            logger.error(f"Failed to create batch regenerate job: {e}")

    def _aggregate_results(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Aggregate results from multiple engines."""
        if not results:
            return {
                'qualityScore': 0,
                'qualityStatus': 'defect',
                'engines': []
            }

        # Helper to get score/status from either camelCase or snake_case keys
        def get_score(r: Dict) -> int:
            return r.get('qualityScore') or r.get('quality_score') or 0

        def get_status(r: Dict) -> str:
            return r.get('qualityStatus') or r.get('quality_status') or 'defect'

        # Worst status wins
        status_priority = {'defect': 0, 'warning': 1, 'perfect': 2}
        worst_status = min(
            results,
            key=lambda r: status_priority.get(get_status(r), 0)
        )
        worst_status = get_status(worst_status)

        # Average score
        scores = [get_score(r) for r in results]
        avg_score = sum(scores) // len(scores) if scores else 0

        return {
            'qualityScore': avg_score,
            'qualityStatus': worst_status,
            'engines': results
        }


# Singleton instance
_worker_instance: Optional[QualityWorker] = None


def get_quality_worker(event_loop: Optional[asyncio.AbstractEventLoop] = None) -> QualityWorker:
    """Get singleton Quality worker instance"""
    global _worker_instance
    if _worker_instance is None:
        _worker_instance = QualityWorker(poll_interval=1.0, event_loop=event_loop)
    return _worker_instance
