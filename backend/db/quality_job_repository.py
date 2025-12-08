"""
Quality Job Repository - Database operations for quality analysis jobs

Manages the quality_jobs table for unified STT + Audio analysis jobs.
"""

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from loguru import logger


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dictionary"""
    return dict(row)


class QualityJobRepository:
    """
    Repository for quality analysis jobs

    Handles CRUD operations for quality_jobs table.
    Jobs can trigger STT analysis, Audio analysis, or both.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self._ensure_table_exists()

    def _ensure_table_exists(self):
        """Create quality_jobs table if it doesn't exist."""
        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS quality_jobs (
                id TEXT PRIMARY KEY,
                job_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',

                -- Engine configuration
                stt_engine TEXT,
                stt_model_name TEXT,
                audio_engine TEXT,

                -- Context
                chapter_id TEXT,
                segment_id TEXT,
                language TEXT DEFAULT 'en',

                -- Segment tracking (like TTS jobs)
                segment_ids TEXT,

                -- Progress
                total_segments INTEGER DEFAULT 0,
                processed_segments INTEGER DEFAULT 0,
                failed_segments INTEGER DEFAULT 0,
                current_segment_id TEXT,

                -- Metadata
                trigger_source TEXT DEFAULT 'manual',
                error_message TEXT,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP
            )
        """)
        self.conn.commit()

        # Migration: Add segment_ids column if it doesn't exist (for existing DBs)
        try:
            cursor.execute("SELECT segment_ids FROM quality_jobs LIMIT 1")
        except sqlite3.OperationalError:
            logger.info("Migrating quality_jobs: Adding segment_ids column")
            cursor.execute("ALTER TABLE quality_jobs ADD COLUMN segment_ids TEXT")
            self.conn.commit()

    def _parse_job_segment_ids(self, job: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """
        Parse segment_ids JSON string to list of dicts for Pydantic model.

        Args:
            job: Job dictionary with segment_ids as JSON string

        Returns:
            Job dictionary with segment_ids as parsed list, or None if job is None
        """
        if not job:
            return None

        segment_ids_json = job.get('segment_ids')
        if segment_ids_json and isinstance(segment_ids_json, str):
            try:
                job['segment_ids'] = json.loads(segment_ids_json)
            except (json.JSONDecodeError, TypeError):
                # If parsing fails, keep as None
                job['segment_ids'] = None

        return job

    def create(
        self,
        job_type: str,
        language: str,
        total_segments: int,
        chapter_id: Optional[str] = None,
        segment_id: Optional[str] = None,
        stt_engine: Optional[str] = None,
        stt_model_name: Optional[str] = None,
        audio_engine: Optional[str] = None,
        trigger_source: str = 'manual',
        segment_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Create a new quality analysis job.

        Args:
            job_type: 'segment' or 'chapter'
            language: Audio language code
            total_segments: Number of segments to analyze
            chapter_id: Chapter ID (for chapter jobs)
            segment_id: Segment ID (for segment jobs)
            stt_engine: STT engine to use (None = skip STT)
            stt_model_name: STT model name
            audio_engine: Audio engine to use (None = skip audio analysis)
            trigger_source: 'manual' or 'auto'
            segment_ids: List of segment IDs to analyze

        Returns:
            Created job dict

        Note:
            segment_ids is stored as array of objects with job_status tracking:
            [{"id": "seg-1", "job_status": "pending"}, ...]
            This allows resume to know which segments in the job are already done.
        """
        job_id = str(uuid.uuid4())
        target_id = segment_id if job_type == 'segment' else chapter_id

        # Convert segment_ids to job status objects (like TTS jobs)
        # Each segment tracks its status WITHIN THIS JOB (not global DB status)
        if segment_ids:
            segment_objs = [{"id": sid, "job_status": "pending"} for sid in segment_ids]
            segment_ids_json = json.dumps(segment_objs)
        else:
            segment_ids_json = None

        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO quality_jobs (
                id, job_type, target_id, status,
                stt_engine, stt_model_name, audio_engine,
                chapter_id, segment_id, language,
                segment_ids, total_segments, trigger_source
            ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            job_id, job_type, target_id,
            stt_engine, stt_model_name, audio_engine,
            chapter_id, segment_id, language,
            segment_ids_json, total_segments, trigger_source
        ))
        self.conn.commit()

        logger.debug(f"Created quality job {job_id} ({job_type}, {total_segments} segments)")
        return self.get_by_id(job_id)

    def get_by_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job by ID with chapter and project titles."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT
                j.*,
                c.title as chapter_title,
                p.title as project_title
            FROM quality_jobs j
            LEFT JOIN chapters c ON j.chapter_id = c.id
            LEFT JOIN projects p ON c.project_id = p.id
            WHERE j.id = ?
        """, (job_id,))
        row = cursor.fetchone()
        if row:
            return self._parse_job_segment_ids(dict_from_row(row))
        return None

    def get_next_pending_job(self) -> Optional[Dict[str, Any]]:
        """Get next pending job (oldest first)."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT id FROM quality_jobs
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
        """)
        row = cursor.fetchone()
        if row:
            job_id = row[0]
            # Mark as running and set started_at
            cursor.execute("""
                UPDATE quality_jobs
                SET status = 'running', started_at = ?
                WHERE id = ?
            """, (datetime.now().isoformat(), job_id))
            self.conn.commit()
            # Return fresh job data with updated started_at
            return self.get_by_id(job_id)
        return None

    def get_all(
        self,
        status: Optional[str] = None,
        chapter_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get jobs with optional filtering, including chapter and project titles."""
        query = """
            SELECT
                j.*,
                c.title as chapter_title,
                p.title as project_title
            FROM quality_jobs j
            LEFT JOIN chapters c ON j.chapter_id = c.id
            LEFT JOIN projects p ON c.project_id = p.id
            WHERE 1=1
        """
        params = []

        if status:
            query += " AND j.status = ?"
            params.append(status)
        if chapter_id:
            query += " AND j.chapter_id = ?"
            params.append(chapter_id)

        query += " ORDER BY j.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = self.conn.cursor()
        cursor.execute(query, params)
        jobs = [dict_from_row(row) for row in cursor.fetchall()]
        return [self._parse_job_segment_ids(job) for job in jobs]

    def get_active_jobs_for_chapter(self, chapter_id: str) -> List[Dict[str, Any]]:
        """Get active (pending/running) jobs for a chapter."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM quality_jobs
            WHERE chapter_id = ? AND status IN ('pending', 'running')
        """, (chapter_id,))
        jobs = [dict_from_row(row) for row in cursor.fetchall()]
        return [self._parse_job_segment_ids(job) for job in jobs]

    def update_progress(
        self,
        job_id: str,
        processed_segments: int,
        failed_segments: int,
        current_segment_id: Optional[str] = None
    ):
        """Update job progress."""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE quality_jobs
            SET processed_segments = ?, failed_segments = ?, current_segment_id = ?
            WHERE id = ?
        """, (processed_segments, failed_segments, current_segment_id, job_id))
        self.conn.commit()

    def mark_completed(self, job_id: str):
        """Mark job as completed."""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE quality_jobs
            SET status = 'completed', completed_at = ?
            WHERE id = ?
        """, (datetime.now().isoformat(), job_id))
        self.conn.commit()

    def mark_failed(self, job_id: str, error_message: str):
        """Mark job as failed."""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE quality_jobs
            SET status = 'failed', error_message = ?, completed_at = ?
            WHERE id = ?
        """, (error_message, datetime.now().isoformat(), job_id))
        self.conn.commit()

    def mark_cancelled(self, job_id: str):
        """Mark job as cancelled."""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE quality_jobs
            SET status = 'cancelled', completed_at = ?
            WHERE id = ?
        """, (datetime.now().isoformat(), job_id))
        self.conn.commit()

    def request_cancellation(self, job_id: str) -> bool:
        """Request job cancellation (sets status to 'cancelling')."""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE quality_jobs
            SET status = 'cancelling'
            WHERE id = ? AND status IN ('pending', 'running')
        """, (job_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def mark_segment_analyzed(self, job_id: str, segment_id: str):
        """
        Mark a specific segment as analyzed within the job.

        Updates the job_status of the segment in segment_ids JSON array.

        Args:
            job_id: Job identifier
            segment_id: Segment that was analyzed
        """
        # Get current job
        job = self.get_by_id(job_id)
        if not job:
            return

        # Get segment_ids (already parsed by get_by_id)
        segment_objs = job.get('segment_ids')
        if not segment_objs:
            return

        # Find and update the segment's job_status
        updated = False
        for seg_obj in segment_objs:
            if seg_obj.get('id') == segment_id:
                seg_obj['job_status'] = 'analyzed'
                updated = True
                break

        if not updated:
            logger.warning(f"Segment {segment_id} not found in job {job_id} segment_ids")
            return

        # Save updated segment_ids back to database
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE quality_jobs
            SET segment_ids = ?
            WHERE id = ?
        """, (json.dumps(segment_objs), job_id))
        self.conn.commit()

    def resume_job(self, job_id: str) -> Dict[str, Any]:
        """
        Resume a cancelled quality job with remaining segments.

        Filters segment_ids to only include segments with job_status="pending",
        then updates job status to 'pending' to restart processing.

        Args:
            job_id: Job identifier to resume

        Returns:
            Updated job dictionary

        Raises:
            ValueError: If job not found or not cancelled
        """
        # Verify job exists and is cancelled
        job = self.get_by_id(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        if job['status'] != 'cancelled':
            raise ValueError(f"Job {job_id} is not cancelled (status: {job['status']})")

        # Get segment_ids (already parsed by get_by_id)
        segment_objs = job.get('segment_ids')

        # Filter to only pending segments (if segment_ids exist)
        if segment_objs:
            remaining_segment_objs = [
                seg for seg in segment_objs
                if seg.get('job_status') == 'pending'
            ]
            remaining_json = json.dumps(remaining_segment_objs) if remaining_segment_objs else None
            remaining_count = len(remaining_segment_objs)
        else:
            remaining_json = None
            remaining_count = job.get('total_segments', 0) - job.get('processed_segments', 0)

        # Reset job to pending with remaining segments
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE quality_jobs
            SET status = 'pending',
                segment_ids = ?,
                started_at = NULL,
                completed_at = NULL,
                error_message = NULL
            WHERE id = ?
        """, (remaining_json, job_id))
        self.conn.commit()

        logger.info(f"Resumed quality job {job_id} ({remaining_count} remaining segments)")
        return self.get_by_id(job_id)

    def delete_by_id(self, job_id: str) -> bool:
        """Delete job by ID."""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM quality_jobs WHERE id = ?", (job_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def cleanup_finished_jobs(self, keep_recent: int = 10) -> int:
        """Delete old finished jobs, keeping most recent."""
        cursor = self.conn.cursor()
        cursor.execute("""
            DELETE FROM quality_jobs
            WHERE status IN ('completed', 'failed', 'cancelled')
            AND id NOT IN (
                SELECT id FROM quality_jobs
                WHERE status IN ('completed', 'failed', 'cancelled')
                ORDER BY completed_at DESC
                LIMIT ?
            )
        """, (keep_recent,))
        self.conn.commit()
        return cursor.rowcount
