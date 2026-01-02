"""
TTS Worker - Database-polling job processor with HTTP Engine Communication

Runs as background thread, polls tts_jobs table for pending jobs,
routes them to engine servers via HTTP, and updates status in database.

Architecture:
- Single-threaded worker (processes one job at a time)
- Polls DB every 1 second for pending jobs
- Async HTTP communication with engine servers
- Updates DB progress in real-time
- Graceful shutdown support
- Retry logic with engine restart on failure
"""

import time
import threading
import asyncio
import sqlite3
from pathlib import Path
from typing import Optional, Union, List, Dict, Any, Callable, TypeVar
from loguru import logger

from db.database import get_db_connection_simple
from db.repositories import TTSJobRepository, SegmentRepository
from db.pronunciation_repository import PronunciationRulesRepository
from core.tts_engine_manager import get_tts_engine_manager
from core.engine_exceptions import EngineClientError, EngineLoadingError, EngineServerError
from core.pronunciation_transformer import PronunciationTransformer
from core.audio_merger import AudioMerger
from services.speaker_service import SpeakerService
from services.audio_service import AudioService
from services.event_broadcaster import (
    emit_job_started,
    emit_job_progress,
    emit_job_completed,
    emit_job_failed,
    emit_job_cancelled,
    emit_segment_started,
    emit_segment_completed,
    emit_segment_failed
)

T = TypeVar('T')


class SpeakerSampleNotFoundError(Exception):
    """Raised when speaker sample file is not found. Not retryable."""
    pass


def retry_on_db_lock(func: Callable[..., T], max_retries: int = None, initial_delay: float = None) -> T:
    """
    Retry a function if it fails with 'database is locked' error.

    Uses exponential backoff

    Args:
        func: Function to execute (should be a lambda or callable)
        max_retries: Maximum number of retry attempts (default from config)
        initial_delay: Initial delay in seconds (default from config)

    Returns:
        Result of func()

    Raises:
        Exception: If all retries are exhausted
    """
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
                        f"[TTSWorker] Database locked attempt={attempt + 1}/{max_retries} "
                        f"retrying_in={delay:.2f}s"
                    )
                    time.sleep(delay)
                    delay *= 2  # Exponential backoff
                    continue
            raise
        except Exception:
            raise

    # All retries exhausted
    logger.error(f"[TTSWorker] Database locked after retries max_retries={max_retries}")
    raise last_error


class TTSWorker:
    """
    Background worker for TTS generation via HTTP engine servers

    Polls database for pending jobs and processes them sequentially.
    Each job generates audio for all segments via HTTP calls to engine servers.
    """

    def __init__(self, poll_interval: float = None, event_loop: Optional[asyncio.AbstractEventLoop] = None):
        """
        Args:
            poll_interval: Seconds to wait between polling (default from config)
            event_loop: Event loop for emitting SSE events (should be FastAPI's main loop)
        """
        from config import TTS_WORKER_POLL_INTERVAL
        self.poll_interval = poll_interval if poll_interval is not None else TTS_WORKER_POLL_INTERVAL
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.current_job_id: Optional[str] = None
        self._event_loop = event_loop
        self.audio_service = AudioService()  # For calculating audio duration

        # Pronunciation support
        self.transformer = PronunciationTransformer()
        self.audio_merger = AudioMerger()

    def start(self):
        """Start worker in background thread"""
        if self.running:
            logger.warning("[TTSWorker] TTS Worker already running")
            return

        self.running = True
        self.thread = threading.Thread(
            target=self._worker_loop,
            name="TTSWorker",
            daemon=True
        )
        self.thread.start()
        logger.debug("[TTSWorker] [OK] TTS Worker started polling_interval={:.1f}s", self.poll_interval)

    def stop(self, timeout: float = None):
        """
        Stop worker gracefully

        Waits for current job to finish (up to timeout).

        Args:
            timeout: Max seconds to wait for current job to finish (default from config)
        """
        from config import WORKER_STOP_TIMEOUT
        timeout = timeout if timeout is not None else WORKER_STOP_TIMEOUT

        if not self.running:
            return

        logger.info("[TTSWorker] Stopping TTS Worker...")
        self.running = False

        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=timeout)

            if self.thread.is_alive():
                logger.warning(f"[TTSWorker] Worker did not stop within timeout timeout={timeout}s job_id={self.current_job_id}")
            else:
                logger.info("[TTSWorker] [OK] TTS Worker stopped gracefully")

    def has_pending_jobs(self) -> bool:
        """
        Check if there are pending jobs in the queue

        Returns:
            True if there are jobs with status='pending', False otherwise
        """
        try:
            conn = get_db_connection_simple()
            job_repo = TTSJobRepository(conn)

            # Query for pending jobs
            from config import DB_JOBS_EXISTENCE_CHECK_LIMIT
            pending_jobs = job_repo.get_all(
                status='pending',
                limit=DB_JOBS_EXISTENCE_CHECK_LIMIT  # We only need to know if ANY exist
            )

            return len(pending_jobs) > 0

        except Exception as e:
            logger.error(f"[TTSWorker] Error checking for pending jobs error={e}")
            return False  # Assume no pending jobs on error

    def _emit_event_sync(self, coro):
        """
        Emit event from synchronous worker thread.

        Since the worker runs in a background thread, we need to schedule
        async event emissions on the main event loop.

        Args:
            coro: Coroutine to execute (e.g., emit_job_started(...))
        """
        if self._event_loop is None:
            logger.warning("[TTSWorker] Event loop not initialized, skipping event emission")
            return

        try:
            # Schedule coroutine on the main event loop (non-blocking)
            asyncio.run_coroutine_threadsafe(coro, self._event_loop)
        except Exception as e:
            logger.error(f"[TTSWorker] Failed to emit event error={e}")

    def _worker_loop(self):
        """
        Main worker loop - polls database for jobs

        Loop:
        1. Poll DB for next pending job
        2. If job found: process it
        3. If no job: sleep for poll_interval
        4. Repeat until running=False
        """
        # Log event loop status
        if self._event_loop:
            logger.debug("[TTSWorker] Worker has event loop for SSE broadcasting")
        else:
            logger.warning("[TTSWorker] No event loop provided - SSE events will not be emitted")

        while self.running:
            try:
                # Get connection and poll for next job with retry on DB lock
                def get_next_job():
                    conn = get_db_connection_simple()
                    job_repo = TTSJobRepository(conn)
                    job = job_repo.get_next_pending_job()
                    conn.close()
                    return job

                job = retry_on_db_lock(get_next_job, max_retries=5, initial_delay=0.1)

                if job:
                    self.current_job_id = job['id']
                    logger.info(f"[TTSWorker] Processing job job_id={job['id']} chapter_id={job['chapter_id']}")

                    # Process job (now async via HTTP)
                    self._process_job_sync(job)

                    self.current_job_id = None
                else:
                    # No pending jobs, sleep
                    time.sleep(self.poll_interval)

            except KeyboardInterrupt:
                logger.info("[TTSWorker] Worker interrupted, shutting down...")
                self.running = False
                break
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e).lower():
                    logger.warning(f"[TTSWorker] Database locked, retrying in {self.poll_interval}s...")
                else:
                    logger.error(f"[TTSWorker] Database error: {e}", exc_info=True)
                time.sleep(self.poll_interval)
            except Exception as e:
                logger.error(f"[TTSWorker] Unexpected error: {e}", exc_info=True)
                time.sleep(self.poll_interval)

    def _process_job_sync(self, job: dict):
        """
        Synchronous wrapper for async job processing

        Since worker runs in thread, we need to run async code in the event loop.
        """
        if self._event_loop is None:
            logger.error("[TTSWorker] Cannot process job: no event loop available")
            return

        # Run async job processing on the event loop
        future = asyncio.run_coroutine_threadsafe(
            self._process_job_async(job),
            self._event_loop
        )

        # Wait for completion
        try:
            future.result()
        except Exception as e:
            logger.error(f"[TTSWorker] Job processing failed error={e}", exc_info=True)

    def _cleanup_segments_on_cancellation(
        self,
        segment_ids_to_process: list,
        segment_repo
    ):
        """
        Reset segments to 'pending' when job is cancelled.

        This prevents segments from being stuck in 'queued' or 'processing'
        status when user cancels a job. Segments can then be regenerated
        in future jobs.

        Args:
            segment_ids_to_process: List of segment IDs that were in this job
            segment_repo: Segment repository instance
        """
        for seg_id in segment_ids_to_process:
            try:
                seg = segment_repo.get_by_id(seg_id)
                if seg and seg['status'] in ('queued', 'processing'):
                    segment_repo.update(seg_id, status='pending')
                    logger.debug(f"[TTSWorker] Reset segment to pending segment_id={seg_id} reason=job_cancelled")
            except Exception as e:
                logger.error(f"[TTSWorker] Failed to reset segment on cancellation segment_id={seg_id} error={e}")

    async def _generate_with_pronunciation(
        self,
        text: str,
        engine_name: str,
        language: str,
        project_id: Optional[str],
        speaker_wav: Union[str, List[str]],
        parameters: Dict[str, Any]
    ) -> bytes:
        """
        Generate audio with pronunciation rules applied.

        This method:
        1. Fetches applicable pronunciation rules from database
        2. Transforms text using PronunciationTransformer
        3. Splits into chunks if needed (based on engine max_length)
        4. Generates audio for each chunk
        5. Merges chunks if multiple (with AudioMerger)
        6. Returns final audio bytes

        Args:
            text: Original text to generate
            engine_name: TTS engine to use
            language: Language code
            project_id: Project ID for project-specific rules
            speaker_wav: Speaker reference audio path(s)
            parameters: Engine-specific parameters

        Returns:
            Audio bytes (WAV format)
        """
        # Get database connection and pronunciation repository
        conn = get_db_connection_simple()
        try:
            pronunciation_repo = PronunciationRulesRepository(conn)

            # Get applicable pronunciation rules
            rules = pronunciation_repo.get_rules_for_context(
                engine_name=engine_name,
                language=language,
                project_id=project_id
            )
        finally:
            conn.close()

        # Get engine constraints for max_length
        tts_manager = get_tts_engine_manager()
        engine_info = tts_manager.get_engine_info(engine_name)

        # Extract max_length from engine constraints
        max_length = 250  # Default
        if engine_info and len(engine_info) > 0:
            constraints = engine_info[0].get('constraints') or {}
            # Check both naming conventions: max_text_length (XTTS) and max_input_length (generic)
            max_length = constraints.get('max_text_length', constraints.get('max_input_length', 250))

        logger.debug(f"[TTSWorker] Using max_length={max_length} engine={engine_name}")

        # Apply rules and prepare text
        chunks, transform_result = self.transformer.prepare_for_tts(
            text=text,
            rules=rules,
            max_length=max_length
        )

        logger.debug(
            f"[TTSWorker] Text transformation length_before={transform_result.length_before} "
            f"length_after={transform_result.length_after} "
            f"rules_applied={len(transform_result.rules_applied)} "
            f"chunks={len(chunks)}"
        )

        # If single chunk, generate normally
        if len(chunks) == 1:
            return await tts_manager.generate_with_engine(
                engine_name=engine_name,
                text=chunks[0],
                language=language,
                speaker_wav=speaker_wav,
                parameters=parameters
            )

        # Multiple chunks - generate each and merge
        audio_chunks = []

        for i, chunk in enumerate(chunks):
            logger.debug(f"[TTSWorker] Generating chunk [{i+1}/{len(chunks)}]")

            try:
                audio_data = await tts_manager.generate_with_engine(
                    engine_name=engine_name,
                    text=chunk,
                    language=language,
                    speaker_wav=speaker_wav,
                    parameters=parameters
                )
                audio_chunks.append(audio_data)

            except Exception as e:
                logger.error(f"[TTSWorker] Failed to generate chunk chunk_num={i+1} error={e}")
                raise

        # Merge audio chunks
        import uuid
        output_filename = f"merged_{uuid.uuid4().hex[:8]}.wav"

        merged_path = self.audio_merger.merge_audio_bytes(
            audio_chunks=audio_chunks,
            output_filename=output_filename,
            silence_ms=50  # Small gap between chunks
        )

        # Read merged file and return bytes
        with open(merged_path, 'rb') as f:
            merged_audio = f.read()

        # Clean up merged file
        import os
        try:
            os.remove(merged_path)
        except OSError:
            # File might already be deleted or inaccessible - ignore
            pass

        return merged_audio

    async def _process_job_async(self, job: dict):
        """
        Process a single TTS job via HTTP engine server (async version)

        Steps:
        1. Get segments from DB (based on job_type)
        2. Filter segments (based on force_regenerate)
        3. Ensure engine ready via HTTP
        4. Generate each segment via HTTP (with retry logic)
        5. Update progress in DB
        6. Mark job completed/failed
        7. Apply preferred engine if set

        Args:
            job: Job dictionary from database
        """
        import json

        conn = get_db_connection_simple()
        job_repo = TTSJobRepository(conn)
        segment_repo = SegmentRepository(conn)

        # Get chapter to determine project_id (for pronunciation rules)
        from db.repositories import ChapterRepository
        chapter_repo = ChapterRepository(conn)
        chapter = chapter_repo.get_by_id(job['chapter_id'])
        project_id = chapter.get('project_id') if chapter else None

        # Initialize segment_ids_for_events early (for error handling)
        segment_ids_for_events = []

        try:
            # 1. Parse segment_ids from job
            segment_data = job.get('segment_ids')

            # If it's still a string (shouldn't happen, but handle it), parse it
            if isinstance(segment_data, str):
                segment_data = json.loads(segment_data)

            if not segment_data:
                logger.error(f"Job {job['id']} has no segment_ids")
                job_repo.mark_failed(job['id'], "No segment_ids in job")
                return

            # Keep parsed segment_data for event emissions
            segment_ids_for_events = segment_data

            # Extract segment IDs with job_status="pending"
            segment_ids_to_process = [
                seg_obj['id'] for seg_obj in segment_data
                if seg_obj.get('job_status') == 'pending'
            ]

            # 2. Load segments from database
            segments_to_process = []
            for seg_id in segment_ids_to_process:
                seg = segment_repo.get_by_id(seg_id)
                if seg:
                    segments_to_process.append(seg)
                else:
                    logger.warning(f"Segment {seg_id} not found in database")

            total = len(segments_to_process)

            if total == 0:
                logger.warning(f"No segments to process for job {job['id']}")
                job_repo.mark_completed(job['id'])

                # Emit job completed event
                try:
                    self._emit_event_sync(
                        emit_job_completed(job['id'], job['chapter_id'], 0, segment_ids_for_events)
                    )
                except Exception as e:
                    logger.error(f"Failed to emit job completed event: {e}")

                return

            # 3. Get Engine Manager and ensure engine ready (HTTP)
            tts_manager = get_tts_engine_manager()

            try:
                logger.info(f"[TTSWorker] Ensuring engine ready engine={job['tts_engine']} model={job['tts_model_name']}")
                await tts_manager.ensure_engine_ready(job['tts_engine'], job['tts_model_name'])
            except Exception as e:
                error_msg = f"Failed to start engine {job['tts_engine']}: {e}"
                logger.error(f"[TTSWorker] {error_msg}")
                job_repo.mark_failed(job['id'], error_msg)
                return

            # Get speaker service
            speaker_service = SpeakerService(conn)

            # 4. Process each segment (HTTP generation with retry logic)
            initial_processed = job.get('processed_segments', 0)
            processed = initial_processed
            failed = job.get('failed_segments', 0)
            expected_total = job['total_segments']

            # Emit job started event (with startedAt from DB for correct timestamp display)
            try:
                self._emit_event_sync(
                    emit_job_started(
                        job['id'],
                        job['chapter_id'],
                        expected_total,
                        segment_ids_for_events,
                        processed_segments=initial_processed,
                        started_at=job.get('started_at'),
                        tts_engine=job.get('tts_engine')
                    )
                )
            except Exception as e:
                logger.error(f"Failed to emit job started event: {e}")

            for idx, segment in enumerate(segments_to_process):
                # Check if worker should stop (graceful shutdown)
                if not self.running:
                    logger.warning(f"Worker stopping, job {job['id']} incomplete")
                    job_repo.mark_failed(job['id'], "Worker shutdown during processing")
                    return

                # Check for cancellation request
                fresh_job = job_repo.get_by_id(job['id'])
                if fresh_job and fresh_job['status'] == 'cancelling':
                    logger.info(f"Job {job['id']} cancellation requested by user")

                    # Reset segments to 'pending' before marking job cancelled
                    self._cleanup_segments_on_cancellation(segment_ids_to_process, segment_repo)

                    job_repo.mark_cancelled(job['id'])

                    # Emit job cancelled event
                    try:
                        self._emit_event_sync(
                            emit_job_cancelled(job['id'], job['chapter_id'], segment_ids_for_events)
                        )
                    except Exception as e:
                        logger.error(f"Failed to emit job cancelled event: {e}")

                    return

                # ⚠️ SAFETY CHECK: Re-fetch segment from DB to verify frozen status and get latest TTS parameters
                # This prevents processing frozen segments even if they somehow made it into the job
                current_segment = segment_repo.get_by_id(segment['id'])
                if current_segment and current_segment.get('is_frozen', False):
                    logger.warning(f"Skipping frozen segment {segment['id']} (job: {job['id']})")

                    # Mark segment as completed in job (so it won't be re-processed on resume)
                    job_repo.mark_segment_completed(job['id'], segment['id'])

                    # Emit segment skipped event (optional - for UI feedback)
                    try:
                        self._emit_event_sync(
                            emit_segment_completed(
                                segment['id'],
                                job['id'],
                                job['chapter_id'],
                                None,  # No audio path
                                0.0    # No duration
                            )
                        )
                    except Exception as e:
                        logger.error(f"Failed to emit segment skipped event: {e}")

                    # Mark as processed (but skipped) and continue to next segment
                    processed += 1
                    try:
                        retry_on_db_lock(
                            lambda: job_repo.update_progress(
                                job['id'],
                                processed_segments=processed,
                                failed_segments=failed,
                                current_segment_id=segment['id']
                            )
                        )
                    except Exception as e:
                        logger.error(f"Failed to update job progress for {job['id']}: {e}")
                        # Continue anyway - progress update failure shouldn't stop processing
                    continue

                # Use current_segment for TTS parameters (source of truth)
                segment = current_segment

                # Validate segment text length against engine constraints
                from services.segment_validator import SegmentValidator
                constraints = SegmentValidator.get_engine_constraints(tts_manager, segment['tts_engine'])

                if constraints:
                    validation = SegmentValidator.validate_text_length(
                        text=segment['text'],
                        engine_name=segment['tts_engine'],
                        language=segment['language'],
                        constraints=constraints
                    )

                    if not validation['is_valid']:
                        # Text too long - skip generation and mark as failed
                        error_msg = validation['error_message']
                        logger.warning(f"✗ Segment {segment['id']} skipped: {error_msg}")

                        # Mark segment as failed in DB
                        segment_repo.update(segment['id'], status='failed')

                        # Mark segment as completed in job (so it won't be re-processed on resume)
                        job_repo.mark_segment_completed(job['id'], segment['id'])

                        # Increment failed counter
                        failed += 1

                        # Update job progress
                        try:
                            retry_on_db_lock(
                                lambda: job_repo.update_progress(
                                    job['id'],
                                    processed_segments=processed,
                                    failed_segments=failed
                                )
                            )
                        except Exception as e:
                            logger.error(f"Failed to update job progress for {job['id']}: {e}")
                            # Continue anyway - progress update failure shouldn't stop processing

                        # Emit segment failed event
                        try:
                            self._emit_event_sync(
                                emit_segment_failed(segment['id'], job['chapter_id'], error_msg)
                            )
                        except Exception as e:
                            logger.error(f"Failed to emit segment failed event: {e}")

                        # Emit job progress event (only for multi-segment jobs)
                        if expected_total > 1:
                            try:
                                progress_percent = ((processed + failed) / expected_total) * 100
                                self._emit_event_sync(
                                    emit_job_progress(
                                        job['id'],
                                        job['chapter_id'],
                                        processed,
                                        expected_total,
                                        progress_percent,
                                        segment_ids_for_events,
                                        f"Processed {processed}/{expected_total} segments ({failed} failed)",
                                        failed_segments=failed
                                    )
                                )
                            except Exception as e:
                                logger.error(f"Failed to emit job progress event: {e}")

                        # Skip to next segment (don't attempt generation)
                        continue

                # Generate segment with retry logic
                # - 503 (loading): unlimited retries up to 5 min total wait
                # - 500 (server error): max 3 attempts with restart
                # - 400/404 (client error): no retry
                max_server_attempts = 3
                max_loading_wait_seconds = 300  # 5 minutes
                server_attempt = 0
                loading_wait_total = 0

                while server_attempt < max_server_attempts:
                    try:
                        current_segment_num = initial_processed + idx + 1
                        logger.info(f"[{current_segment_num}/{expected_total}] Generating segment {segment['id']} (attempt {server_attempt + 1}/{max_server_attempts})")

                        # Update current_segment_id to show which segment is being processed
                        try:
                            retry_on_db_lock(
                                lambda: job_repo.update_progress(
                                    job['id'],
                                    current_segment_id=segment['id']
                                )
                            )
                        except Exception as e:
                            logger.error(f"Failed to update job progress for {job['id']}: {e}")
                            # Continue anyway - progress update failure shouldn't stop processing

                        # Update segment status: queued → processing
                        segment_repo.update(segment['id'], status='processing')

                        # Emit segment started event (only on first attempt)
                        if server_attempt == 0:
                            try:
                                self._emit_event_sync(
                                    emit_segment_started(segment['id'], job['chapter_id'])
                                )
                            except Exception as e:
                                logger.error(f"Failed to emit segment started event: {e}")

                        # Get speaker samples and ensure they're available in the engine
                        speaker_filenames: Union[str, List[str]] = ""
                        if segment['tts_speaker_name']:
                            speaker = speaker_service.get_speaker_by_name(segment['tts_speaker_name'])
                            if speaker and speaker.get('samples'):
                                # Build list of (sample_uuid, host_path) tuples
                                from config import SPEAKER_SAMPLES_DIR
                                speaker_samples_base = Path(SPEAKER_SAMPLES_DIR)
                                sample_files = []

                                for sample in speaker['samples']:
                                    # filePath format: "speaker_uuid/sample_uuid.wav"
                                    sample_path = speaker_samples_base / sample['filePath']

                                    # Validate file exists before attempting upload
                                    if not sample_path.exists():
                                        raise SpeakerSampleNotFoundError(
                                            f"Speaker sample not found: {sample_path}. "
                                            f"Speaker '{segment['tts_speaker_name']}' has invalid sample paths."
                                        )

                                    # Extract sample UUID from filename (without .wav extension)
                                    sample_uuid = sample_path.stem
                                    sample_files.append((sample_uuid, sample_path))

                                # Upload samples to engine if needed and get filenames
                                speaker_filenames = await tts_manager.ensure_samples_available(
                                    engine_name=segment['tts_engine'],
                                    sample_files=sample_files
                                )

                                # If only one sample, use string instead of list
                                if len(speaker_filenames) == 1:
                                    speaker_filenames = speaker_filenames[0]

                        # Load engine parameters from DB (use segment's engine variant)
                        from db.engine_repository import EngineRepository
                        engine_repo = EngineRepository(conn)
                        engine = engine_repo.get_by_id(segment['tts_engine'])
                        engine_parameters = engine.get("parameters", {}) if engine else {}

                        # Generate audio with pronunciation rules applied (use segment's TTS parameters)
                        audio_bytes = await self._generate_with_pronunciation(
                            text=segment['text'],
                            engine_name=segment['tts_engine'],
                            language=segment['language'],
                            project_id=project_id,
                            speaker_wav=speaker_filenames,
                            parameters=engine_parameters
                        )

                        # Write audio bytes to file
                        from config import OUTPUT_DIR
                        output_path = Path(OUTPUT_DIR) / f"{segment['id']}.wav"
                        with open(output_path, 'wb') as f:
                            f.write(audio_bytes)

                        # Store only filename (frontend constructs full URL)
                        audio_filename = output_path.name

                        # Calculate audio duration for segment
                        try:
                            audio_duration = self.audio_service.get_audio_duration(output_path)
                            start_time = 0.0  # Single segment always starts at 0
                            end_time = audio_duration
                            logger.debug(f"Audio duration: {audio_duration:.2f}s")
                        except Exception as e:
                            logger.warning(f"Failed to calculate audio duration: {e}, using defaults")
                            start_time = 0.0
                            end_time = 0.0

                        # Update segment with audio filename, duration, and mark as completed
                        # TTS parameters (speaker, engine, model, language) already set when job was created
                        try:
                            retry_on_db_lock(
                                lambda: segment_repo.update(
                                    segment['id'],
                                    audio_path=audio_filename,
                                    start_time=start_time,
                                    end_time=end_time,
                                    status='completed'
                                )
                            )
                        except Exception as e:
                            logger.error(f"Failed to update segment {segment['id']}: {e}")
                            raise

                        # Mark segment as completed in job
                        try:
                            retry_on_db_lock(
                                lambda: job_repo.mark_segment_completed(job['id'], segment['id'])
                            )
                        except Exception as e:
                            logger.error(f"Failed to mark segment completed in job {job['id']}: {e}")
                            raise

                        # Increment local counter
                        processed += 1

                        # Emit segment completed event
                        try:
                            self._emit_event_sync(
                                emit_segment_completed(segment['id'], job['chapter_id'], audio_filename)
                            )
                        except Exception as e:
                            logger.error(f"Failed to emit segment completed event: {e}")

                        # Emit job progress event (only for multi-segment jobs)
                        if expected_total > 1:
                            try:
                                progress_percent = (processed / expected_total) * 100
                                self._emit_event_sync(
                                    emit_job_progress(
                                        job['id'],
                                        job['chapter_id'],
                                        processed,
                                        expected_total,
                                        progress_percent,
                                        segment_ids_for_events,
                                        f"Processed {processed}/{expected_total} segments",
                                        failed_segments=failed
                                    )
                                )
                            except Exception as e:
                                logger.error(f"Failed to emit job progress event: {e}")

                        logger.success(f"[TTSWorker] [OK] Segment completed segment_id={segment['id']}")
                        break  # Success - exit retry loop

                    except (SpeakerSampleNotFoundError, EngineClientError) as e:
                        # Non-retryable errors:
                        # - SpeakerSampleNotFoundError: speaker sample file missing
                        # - EngineClientError: 400/404 - request invalid (text too long, model not found, etc.)
                        error_type = "Speaker sample not found" if isinstance(e, SpeakerSampleNotFoundError) else "Client error"
                        logger.error(f"[TTSWorker] ✗ {error_type} segment_id={segment['id']} error={e}")
                        segment_repo.update(segment['id'], status='failed')
                        job_repo.mark_segment_completed(job['id'], segment['id'])
                        failed += 1

                        try:
                            retry_on_db_lock(
                                lambda: job_repo.update_progress(
                                    job['id'],
                                    processed_segments=processed,
                                    failed_segments=failed
                                )
                            )
                        except Exception as progress_err:
                            logger.error(f"Failed to update job progress for {job['id']}: {progress_err}")

                        try:
                            self._emit_event_sync(
                                emit_segment_failed(segment['id'], job['chapter_id'], str(e))
                            )
                        except Exception as emit_err:
                            logger.error(f"Failed to emit segment failed event: {emit_err}")
                        break  # Exit retry loop - no point retrying

                    except EngineLoadingError:
                        # 503 - Engine is loading model, wait and retry WITHOUT restart
                        # Don't count as server_attempt - just wait and retry
                        loading_wait_total += 1
                        if loading_wait_total >= max_loading_wait_seconds:
                            # Timeout waiting for model to load
                            logger.error(f"[TTSWorker] ✗ Timeout waiting for engine to load segment_id={segment['id']} waited={loading_wait_total}s")
                            segment_repo.update(segment['id'], status='failed')
                            job_repo.mark_segment_completed(job['id'], segment['id'])
                            failed += 1

                            try:
                                self._emit_event_sync(
                                    emit_segment_failed(segment['id'], job['chapter_id'], f"Engine loading timeout after {loading_wait_total}s")
                                )
                            except Exception as emit_err:
                                logger.error(f"Failed to emit segment failed event: {emit_err}")
                            break  # Exit retry loop

                        logger.warning(f"[TTSWorker] Engine loading segment_id={segment['id']} - waiting 1s ({loading_wait_total}/{max_loading_wait_seconds}s)")
                        await asyncio.sleep(1.0)  # Short wait, then retry
                        continue  # Retry without incrementing server_attempt

                    except EngineServerError as e:
                        # 500 or connection error - restart engine and retry
                        server_attempt += 1
                        logger.error(f"[TTSWorker] ✗ Server error segment_id={segment['id']} attempt={server_attempt}/{max_server_attempts} error={e}")

                        if server_attempt < max_server_attempts:
                            logger.warning(f"[TTSWorker] Restarting engine for retry engine={job['tts_engine']}")
                            try:
                                await tts_manager.stop_engine_server(job['tts_engine'])
                                await tts_manager.start_engine_server(job['tts_engine'], job['tts_model_name'])
                            except Exception as restart_err:
                                logger.error(f"[TTSWorker] Engine restart failed error={restart_err}")
                        else:
                            # Last attempt failed - mark segment as failed
                            logger.error(f"[TTSWorker] ✗ Segment failed after {max_server_attempts} attempts segment_id={segment['id']}")
                            segment_repo.update(segment['id'], status='failed')
                            job_repo.mark_segment_completed(job['id'], segment['id'])
                            failed += 1

                            try:
                                retry_on_db_lock(
                                    lambda: job_repo.update_progress(
                                        job['id'],
                                        processed_segments=processed,
                                        failed_segments=failed
                                    )
                                )
                            except Exception as progress_err:
                                logger.error(f"Failed to update job progress for {job['id']}: {progress_err}")

                            try:
                                self._emit_event_sync(
                                    emit_segment_failed(segment['id'], job['chapter_id'], str(e))
                                )
                            except Exception as emit_err:
                                logger.error(f"Failed to emit segment failed event: {emit_err}")

                    except Exception as e:
                        # Unexpected error - treat like server error
                        server_attempt += 1
                        logger.error(f"[TTSWorker] ✗ Unexpected error segment_id={segment['id']} attempt={server_attempt}/{max_server_attempts} error={e}")

                        if server_attempt < max_server_attempts:
                            logger.warning(f"[TTSWorker] Restarting engine for retry engine={job['tts_engine']}")
                            try:
                                await tts_manager.stop_engine_server(job['tts_engine'])
                                await tts_manager.start_engine_server(job['tts_engine'], job['tts_model_name'])
                            except Exception as restart_err:
                                logger.error(f"[TTSWorker] Engine restart failed error={restart_err}")
                        else:
                            # Last attempt failed - mark segment as failed
                            logger.error(f"[TTSWorker] ✗ Segment failed after {max_server_attempts} attempts segment_id={segment['id']}")
                            segment_repo.update(segment['id'], status='failed')
                            job_repo.mark_segment_completed(job['id'], segment['id'])
                            failed += 1

                            try:
                                retry_on_db_lock(
                                    lambda: job_repo.update_progress(
                                        job['id'],
                                        processed_segments=processed,
                                        failed_segments=failed
                                    )
                                )
                            except Exception as progress_err:
                                logger.error(f"Failed to update job progress for {job['id']}: {progress_err}")

                            try:
                                self._emit_event_sync(
                                    emit_segment_failed(segment['id'], job['chapter_id'], str(e))
                                )
                            except Exception as emit_err:
                                logger.error(f"Failed to emit segment failed event: {emit_err}")

                            # Emit job progress event (with failed count, only for multi-segment jobs)
                            if expected_total > 1:
                                try:
                                    progress_percent = ((processed + failed) / expected_total) * 100
                                    self._emit_event_sync(
                                        emit_job_progress(
                                            job['id'],
                                            job['chapter_id'],
                                            processed,
                                            expected_total,
                                            progress_percent,
                                            segment_ids_for_events,
                                            f"Processed {processed}/{expected_total} segments ({failed} failed)",
                                            failed_segments=failed
                                        )
                                    )
                                except Exception as emit_err:
                                    logger.error(f"Failed to emit job progress event: {emit_err}")

            # 5. Mark job as completed or failed
            expected_total = job['total_segments']
            if failed == 0 and processed == expected_total:
                job_repo.mark_completed(job['id'])
                logger.success(f"[OK] Job {job['id']} completed ({processed}/{expected_total} segments)")

                # Emit job completed event
                try:
                    self._emit_event_sync(
                        emit_job_completed(job['id'], job['chapter_id'], expected_total, segment_ids_for_events)
                    )
                except Exception as e:
                    logger.error(f"Failed to emit job completed event: {e}")

            else:
                error_msg = f"[TTS_JOB_PARTIAL_FAILURE]processed:{processed};failed:{failed};total:{expected_total}"
                job_repo.mark_failed(job['id'], error_msg)
                logger.warning(f"[WARN] Job {job['id']}: Completed with errors: {processed} ok, {failed} failed out of {expected_total}")

                # Emit job failed event
                try:
                    self._emit_event_sync(
                        emit_job_failed(job['id'], job['chapter_id'], error_msg, segment_ids_for_events)
                    )
                except Exception as e:
                    logger.error(f"Failed to emit job failed event: {e}")

            # 5.1 Auto-Analyze: Create Quality job for successfully generated segments
            # Runs independently of job status - even partial success triggers analysis
            try:
                from services.settings_service import SettingsService
                from db.quality_job_repository import QualityJobRepository

                settings_service = SettingsService(conn)

                # Get segments with audio (only successfully generated)
                segments_with_audio = [
                    seg_id for seg_id in segment_ids_to_process
                    if segment_repo.get_by_id(seg_id) and segment_repo.get_by_id(seg_id).get('audio_path')
                ]

                if segments_with_audio:
                    # Determine if this was a segment or chapter job based on segment_ids field
                    # This is used to decide which auto-analyze setting to check
                    is_tts_segment_job = job.get('segment_ids') is not None

                    # Check appropriate setting based on TTS job type
                    auto_analyze_enabled = False
                    if is_tts_segment_job:
                        auto_analyze_enabled = settings_service.get_setting('quality.autoAnalyzeSegment') or False
                        logger.debug(f"TTS segment job ({len(segments_with_audio)} segments), autoAnalyzeSegment={auto_analyze_enabled}")
                    else:
                        auto_analyze_enabled = settings_service.get_setting('quality.autoAnalyzeChapter') or False
                        logger.debug(f"TTS chapter job ({len(segments_with_audio)} segments), autoAnalyzeChapter={auto_analyze_enabled}")

                    if auto_analyze_enabled:
                        # Quality job type is based on NUMBER of segments, not TTS job type
                        # Single segment → 'segment' job, Multiple segments → 'chapter' job
                        quality_job_type = 'segment' if len(segments_with_audio) == 1 else 'chapter'
                        trigger_source = f'auto_{"segment" if is_tts_segment_job else "chapter"}'

                        logger.debug(f"Auto-analyze enabled, creating Quality {quality_job_type} job (chapter {job['chapter_id']}, {len(segments_with_audio)} segments)")

                        quality_repo = QualityJobRepository(conn)

                        # Get default engines from settings and validate availability
                        from core.stt_engine_manager import get_stt_engine_manager
                        from core.audio_engine_manager import get_audio_engine_manager

                        stt_engine = settings_service.get_default_engine('stt')
                        stt_model = None
                        if stt_engine:
                            stt_mgr = get_stt_engine_manager()
                            if stt_mgr.is_engine_available(stt_engine):
                                stt_model = settings_service.get_default_model_for_engine(stt_engine, 'stt')
                            else:
                                logger.warning(f"STT engine '{stt_engine}' not available, skipping STT in auto-analyze")
                                stt_engine = None

                        audio_engine = settings_service.get_default_engine('audio')
                        if audio_engine:
                            audio_mgr = get_audio_engine_manager()
                            if not audio_mgr.is_engine_available(audio_engine):
                                logger.warning(f"Audio engine '{audio_engine}' not available, skipping audio in auto-analyze")
                                audio_engine = None

                        # Skip if no engines available
                        if not stt_engine and not audio_engine:
                            logger.debug("[TTSWorker] No analysis engines available for auto-analyze, skipping")
                        else:
                            # Create Quality job with explicit segment_ids
                            quality_job = quality_repo.create(
                                job_type=quality_job_type,
                                language=job['language'],
                                total_segments=len(segments_with_audio),
                                chapter_id=job['chapter_id'],
                                segment_id=segments_with_audio[0] if quality_job_type == 'segment' else None,
                                stt_engine=stt_engine,
                                stt_model_name=stt_model,
                                audio_engine=audio_engine,
                                trigger_source=trigger_source,
                                segment_ids=segments_with_audio  # Explicit segment IDs
                            )

                            logger.info(f"Created auto-analyze Quality job {quality_job['id']} ({len(segments_with_audio)} segments)")

                            # Get project title for display
                            from db.repositories import ProjectRepository
                            project_repo = ProjectRepository(conn)
                            project = project_repo.get_by_id(project_id) if project_id else None

                            # Emit Quality job created event
                            from services.event_broadcaster import broadcaster, EventType
                            self._emit_event_sync(
                                broadcaster.broadcast_event(
                                    EventType.QUALITY_JOB_CREATED,
                                    {
                                        'jobId': quality_job['id'],
                                        'chapterId': job['chapter_id'],
                                        'segmentId': segments_with_audio[0] if quality_job_type == 'segment' else None,
                                        'totalSegments': len(segments_with_audio),
                                        'jobType': quality_job_type,
                                        'segmentIds': segments_with_audio,
                                        # Display fields for frontend
                                        'chapterTitle': chapter.get('title') if chapter else None,
                                        'projectTitle': project.get('title') if project else None,
                                        'sttEngine': stt_engine,
                                        'audioEngine': audio_engine
                                    },
                                    channel='jobs'
                                )
                            )
                    else:
                        logger.debug(f"Auto-analyze disabled for {'segment' if is_tts_segment_job else 'chapter'} jobs")
                else:
                    logger.debug("[TTSWorker] No segments with audio for auto-analyze")

            except Exception as e:
                logger.error(f"Failed to create auto-analyze Quality job: {e}")
                # Don't fail the TTS job if auto-analyze fails

            # Note: Old warm-keeping logic removed - now handled by keepRunning setting

        except Exception as e:
            logger.error(f"✗ Job {job['id']} failed: {e}", exc_info=True)
            job_repo.mark_failed(job['id'], str(e))

            # Emit job failed event
            try:
                self._emit_event_sync(
                    emit_job_failed(job['id'], job['chapter_id'], str(e), segment_ids_for_events)
                )
            except Exception as emit_err:
                logger.error(f"Failed to emit job failed event: {emit_err}")
        finally:
            conn.close()


# Singleton instance
_worker_instance: Optional[TTSWorker] = None


def get_tts_worker(event_loop: Optional[asyncio.AbstractEventLoop] = None) -> TTSWorker:
    """
    Get singleton TTS worker instance

    Args:
        event_loop: Optional event loop for SSE events (only used on first call)

    Returns:
        Global worker instance
    """
    global _worker_instance
    if _worker_instance is None:
        _worker_instance = TTSWorker(poll_interval=1.0, event_loop=event_loop)
    return _worker_instance
