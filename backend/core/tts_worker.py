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
from pathlib import Path
from typing import Optional
from loguru import logger

from db.database import get_db_connection_simple
from db.repositories import TTSJobRepository, SegmentRepository
from core.engine_manager import get_engine_manager
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


class TTSWorker:
    """
    Background worker for TTS generation via HTTP engine servers

    Polls database for pending jobs and processes them sequentially.
    Each job generates audio for all segments via HTTP calls to engine servers.
    """

    def __init__(self, poll_interval: float = 1.0, event_loop: Optional[asyncio.AbstractEventLoop] = None):
        """
        Args:
            poll_interval: Seconds to wait between polling (default 1.0s)
            event_loop: Event loop for emitting SSE events (should be FastAPI's main loop)
        """
        self.poll_interval = poll_interval
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.current_job_id: Optional[str] = None
        self._event_loop = event_loop
        self.audio_service = AudioService()  # For calculating audio duration

    def start(self):
        """Start worker in background thread"""
        if self.running:
            logger.warning("TTS Worker already running")
            return

        self.running = True
        self.thread = threading.Thread(
            target=self._worker_loop,
            name="TTSWorker",
            daemon=True
        )
        self.thread.start()
        logger.info("✓ TTS Worker started (polling interval: {:.1f}s)", self.poll_interval)

    def stop(self, timeout: float = 10.0):
        """
        Stop worker gracefully

        Waits for current job to finish (up to timeout).

        Args:
            timeout: Max seconds to wait for current job to finish
        """
        if not self.running:
            return

        logger.info("Stopping TTS Worker...")
        self.running = False

        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=timeout)

            if self.thread.is_alive():
                logger.warning(f"Worker did not stop within {timeout}s (job {self.current_job_id} still running)")
            else:
                logger.info("✓ TTS Worker stopped gracefully")

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
            pending_jobs = job_repo.get_all(
                status='pending',
                limit=1  # We only need to know if ANY exist
            )

            return len(pending_jobs) > 0

        except Exception as e:
            logger.error(f"Error checking for pending jobs: {e}")
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
            logger.warning("Event loop not initialized, skipping event emission")
            return

        try:
            # Schedule coroutine on the main event loop (non-blocking)
            asyncio.run_coroutine_threadsafe(coro, self._event_loop)
        except Exception as e:
            logger.error(f"Failed to emit event: {e}")

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
            logger.debug("Worker has event loop for SSE broadcasting")
        else:
            logger.warning("No event loop provided - SSE events will not be emitted")

        while self.running:
            try:
                # Get connection
                conn = get_db_connection_simple()
                job_repo = TTSJobRepository(conn)

                # Poll for next job (atomic get + lock)
                job = job_repo.get_next_pending_job()

                if job:
                    self.current_job_id = job['id']
                    logger.info(f"📋 Processing job {job['id']} for chapter {job['chapter_id']}")

                    # Process job (now async via HTTP)
                    self._process_job_sync(job)

                    self.current_job_id = None
                else:
                    # No pending jobs, sleep
                    time.sleep(self.poll_interval)

            except Exception as e:
                logger.error(f"Worker error: {e}", exc_info=True)
                time.sleep(self.poll_interval)

    def _process_job_sync(self, job: dict):
        """
        Synchronous wrapper for async job processing

        Since worker runs in thread, we need to run async code in the event loop.
        """
        if self._event_loop is None:
            logger.error("Cannot process job: no event loop available")
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
            logger.error(f"Job processing failed: {e}", exc_info=True)

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
                    logger.debug(f"Reset segment {seg_id} to pending (job cancelled)")
            except Exception as e:
                logger.error(f"Failed to reset segment {seg_id} on cancellation: {e}")

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
            manager = get_engine_manager()

            try:
                logger.info(f"Ensuring engine ready: {job['tts_engine']} / {job['tts_model_name']}")
                await manager.ensure_engine_ready(job['tts_engine'], job['tts_model_name'])
            except Exception as e:
                error_msg = f"Failed to start engine {job['tts_engine']}: {e}"
                logger.error(error_msg)
                job_repo.mark_failed(job['id'], error_msg)
                return

            # Get speaker service
            speaker_service = SpeakerService(conn)

            # 4. Process each segment (HTTP generation with retry logic)
            initial_processed = job.get('processed_segments', 0)
            processed = initial_processed
            failed = job.get('failed_segments', 0)
            expected_total = job['total_segments']

            # Emit job started event
            try:
                self._emit_event_sync(
                    emit_job_started(job['id'], job['chapter_id'], expected_total, segment_ids_for_events)
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

                # Generate segment with retry logic (3 attempts)
                for attempt in range(3):
                    try:
                        current_segment_num = initial_processed + idx + 1
                        logger.info(f"[{current_segment_num}/{expected_total}] Generating segment {segment['id']} (attempt {attempt + 1}/3)")

                        # Update current_segment_id to show which segment is being processed
                        job_repo.update_progress(
                            job['id'],
                            current_segment_id=segment['id']
                        )

                        # Update segment status: queued → processing
                        segment_repo.update(segment['id'], status='processing')

                        # Emit segment started event (only on first attempt)
                        if attempt == 0:
                            try:
                                self._emit_event_sync(
                                    emit_segment_started(segment['id'], job['chapter_id'])
                                )
                            except Exception as e:
                                logger.error(f"Failed to emit segment started event: {e}")

                        # Get speaker reference audio path(s)
                        speaker_wav = None
                        if job['tts_speaker_name']:
                            speaker = speaker_service.get_speaker_by_name(job['tts_speaker_name'])
                            if speaker and speaker.get('samples'):
                                # Get all sample file paths for XTTS
                                speaker_wav = [sample['filePath'] for sample in speaker['samples']]
                                # If only one sample, use string instead of list
                                if len(speaker_wav) == 1:
                                    speaker_wav = speaker_wav[0]

                        # Load engine parameters from settings
                        from services.settings_service import SettingsService
                        settings_service = SettingsService(conn)
                        engine_parameters = settings_service.get_engine_parameters(job['tts_engine'])

                        # Generate audio via HTTP
                        audio_bytes = await manager.generate_with_engine(
                            engine_name=job['tts_engine'],
                            text=segment['text'],
                            language=job['language'],
                            speaker_wav=speaker_wav or "",
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
                        segment_repo.update(
                            segment['id'],
                            audio_path=audio_filename,
                            start_time=start_time,
                            end_time=end_time,
                            status='completed'
                        )

                        # Mark segment as completed in job
                        job_repo.mark_segment_completed(job['id'], segment['id'])

                        # Increment local counter
                        processed += 1

                        # Emit segment completed event
                        try:
                            self._emit_event_sync(
                                emit_segment_completed(segment['id'], job['chapter_id'], audio_filename)
                            )
                        except Exception as e:
                            logger.error(f"Failed to emit segment completed event: {e}")

                        # Emit job progress event
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
                                    f"Processed {processed}/{expected_total} segments"
                                )
                            )
                        except Exception as e:
                            logger.error(f"Failed to emit job progress event: {e}")

                        logger.success(f"✓ Segment {segment['id']} completed")
                        break  # Success - exit retry loop

                    except Exception as e:
                        logger.error(f"✗ Segment {segment['id']} attempt {attempt + 1}/3 failed: {e}")

                        # If not last attempt, restart engine and retry
                        if attempt < 2:
                            logger.warning(f"Restarting engine {job['tts_engine']} for retry...")
                            try:
                                await manager.stop_engine_server(job['tts_engine'])
                                await manager.start_engine_server(job['tts_engine'], job['tts_model_name'])
                            except Exception as restart_err:
                                logger.error(f"Engine restart failed: {restart_err}")
                        else:
                            # Last attempt failed - mark segment as failed
                            logger.error(f"✗ Segment {segment['id']} failed after 3 attempts")
                            segment_repo.update(segment['id'], status='failed')

                            # Increment failed counter
                            failed += 1

                            # Update job progress in database
                            job_repo.update_progress(
                                job['id'],
                                processed_segments=processed,
                                failed_segments=failed
                            )

                            # Emit segment failed event
                            try:
                                self._emit_event_sync(
                                    emit_segment_failed(segment['id'], job['chapter_id'], str(e))
                                )
                            except Exception as emit_err:
                                logger.error(f"Failed to emit segment failed event: {emit_err}")

                            # Emit job progress event (with failed count)
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
                                        f"Processed {processed}/{expected_total} segments ({failed} failed)"
                                    )
                                )
                            except Exception as emit_err:
                                logger.error(f"Failed to emit job progress event: {emit_err}")

            # 5. Mark job as completed or failed
            expected_total = job['total_segments']
            if failed == 0 and processed == expected_total:
                job_repo.mark_completed(job['id'])
                logger.success(f"✓ Job {job['id']} completed ({processed}/{expected_total} segments)")

                # Emit job completed event
                try:
                    self._emit_event_sync(
                        emit_job_completed(job['id'], job['chapter_id'], expected_total, segment_ids_for_events)
                    )
                except Exception as e:
                    logger.error(f"Failed to emit job completed event: {e}")

            else:
                error_msg = f"Completed with errors: {processed} ok, {failed} failed out of {expected_total}"
                job_repo.mark_failed(job['id'], error_msg)
                logger.warning(f"⚠ Job {job['id']}: {error_msg}")

                # Emit job failed event
                try:
                    self._emit_event_sync(
                        emit_job_failed(job['id'], job['chapter_id'], error_msg, segment_ids_for_events)
                    )
                except Exception as e:
                    logger.error(f"Failed to emit job failed event: {e}")

            # 6. Apply preferred engine after job completion (warm-keeping)
            # Only activate if queue is empty - avoid unnecessary switches
            try:
                if self.has_pending_jobs():
                    logger.debug("Pending jobs in queue, skipping preferred engine activation")
                else:
                    logger.debug("Queue empty, checking if preferred engine should be activated")
                    await manager.apply_preferred_engine()
            except Exception as e:
                logger.error(f"Failed to apply preferred engine: {e}")

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
