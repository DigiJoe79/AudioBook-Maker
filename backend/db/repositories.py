"""
Database repositories for CRUD operations
"""
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import sqlite3
import uuid


def utc_now_iso() -> str:
    """
    Generate UTC timestamp in ISO format with 'Z' suffix.

    This ensures JavaScript's Date parser correctly interprets
    the timestamp as UTC, avoiding timezone offset issues when
    frontend (Windows) and backend (WSL2/Linux) are in different timezones.

    Returns:
        ISO 8601 string with 'Z' suffix, e.g., '2025-12-29T14:30:00.123456Z'
    """
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dictionary"""
    return dict(row)


class ProjectRepository:
    """Repository for project operations"""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def create(self, title: str, description: str = "") -> Dict[str, Any]:
        """Create a new project"""
        project_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        cursor = self.conn.cursor()

        # Get next order_index (max + 1, or 0 if no projects exist)
        cursor.execute("SELECT MAX(order_index) FROM projects")
        max_order = cursor.fetchone()[0]
        order_index = 0 if max_order is None else max_order + 1

        cursor.execute(
            """
            INSERT INTO projects (id, title, description, order_index, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (project_id, title, description, order_index, now, now)
        )
        self.conn.commit()

        return self.get_by_id(project_id)

    def get_by_id(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Get project by ID"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_all(self) -> List[Dict[str, Any]]:
        """Get all projects - ordered by order_index for drag & drop support"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM projects ORDER BY order_index, created_at DESC")
        return [dict_from_row(row) for row in cursor.fetchall()]

    def update(self, project_id: str, title: Optional[str] = None,
               description: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Update project"""
        cursor = self.conn.cursor()
        updated_at = datetime.now().isoformat()

        # Build query based on which fields are provided (safe - no user input in column names)
        if title is not None and description is not None:
            cursor.execute(
                "UPDATE projects SET title = ?, description = ?, updated_at = ? WHERE id = ?",
                (title, description, updated_at, project_id)
            )
        elif title is not None:
            cursor.execute(
                "UPDATE projects SET title = ?, updated_at = ? WHERE id = ?",
                (title, updated_at, project_id)
            )
        elif description is not None:
            cursor.execute(
                "UPDATE projects SET description = ?, updated_at = ? WHERE id = ?",
                (description, updated_at, project_id)
            )
        else:
            # No updates provided, just return current state
            return self.get_by_id(project_id)

        self.conn.commit()
        return self.get_by_id(project_id)

    def delete(self, project_id: str) -> bool:
        """Delete project (CASCADE will delete chapters and segments)"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def reorder_batch(self, project_ids: List[str]) -> bool:
        """
        Batch-update order_index for projects
        Array index = new position (0, 1, 2, ...)

        Args:
            project_ids: List of project IDs in new order

        Returns:
            True if successful
        """
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for idx, project_id in enumerate(project_ids):
            cursor.execute(
                "UPDATE projects SET order_index = ?, updated_at = ? WHERE id = ?",
                (idx, now, project_id)
            )

        self.conn.commit()
        return True


class ChapterRepository:
    """Repository for chapter operations"""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def create(self, project_id: str, title: str, order_index: int) -> Dict[str, Any]:
        """Create a new chapter"""
        chapter_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO chapters (id, project_id, title, order_index, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (chapter_id, project_id, title, order_index, now, now)
        )
        self.conn.commit()

        return self.get_by_id(chapter_id)

    def get_by_id(self, chapter_id: str) -> Optional[Dict[str, Any]]:
        """Get chapter by ID"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,))
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_by_project(self, project_id: str) -> List[Dict[str, Any]]:
        """Get all chapters for a project"""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
            (project_id,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def update(self, chapter_id: str, title: Optional[str] = None,
               order_index: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Update chapter"""
        updates = []
        params = []

        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if order_index is not None:
            updates.append("order_index = ?")
            params.append(order_index)

        if not updates:
            return self.get_by_id(chapter_id)

        updates.append("updated_at = ?")
        params.append(datetime.now().isoformat())
        params.append(chapter_id)

        cursor = self.conn.cursor()
        # Safe: Column names are hardcoded above, never user-controlled
        # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        cursor.execute(
            f"UPDATE chapters SET {', '.join(updates)} WHERE id = ?",
            params
        )
        self.conn.commit()

        return self.get_by_id(chapter_id)

    def delete(self, chapter_id: str) -> bool:
        """Delete chapter (CASCADE will delete segments)"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def reorder_batch(self, chapter_ids: List[str], project_id: str) -> bool:
        """
        Batch-update order_index for chapters within a project

        Args:
            chapter_ids: List of chapter IDs in new order
            project_id: Project ID for validation

        Returns:
            True if successful
        """
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for idx, chapter_id in enumerate(chapter_ids):
            cursor.execute(
                "UPDATE chapters SET order_index = ?, updated_at = ? WHERE id = ? AND project_id = ?",
                (idx, now, chapter_id, project_id)
            )

        self.conn.commit()
        return True

    def move_to_project(self, chapter_id: str, new_project_id: str, new_order_index: int) -> Dict[str, Any]:
        """
        Move chapter to another project

        Args:
            chapter_id: ID of chapter to move
            new_project_id: Target project ID
            new_order_index: Position in target project

        Returns:
            Updated chapter object
        """
        # Get chapter to get old project_id
        chapter = self.get_by_id(chapter_id)
        if not chapter:
            raise ValueError(f"Chapter {chapter_id} not found")

        old_project_id = chapter['project_id']

        # Update chapter
        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE chapters SET project_id = ?, order_index = ?, updated_at = ? WHERE id = ?",
            (new_project_id, new_order_index, datetime.now().isoformat(), chapter_id)
        )
        self.conn.commit()

        # Reindex old project chapters
        if old_project_id:
            self.reindex_chapters(old_project_id)

        # Reindex new project chapters
        self.reindex_chapters(new_project_id)

        return self.get_by_id(chapter_id)

    def reindex_chapters(self, project_id: str):
        """
        Normalize order_index after gaps (0, 1, 2, ...)
        Called after move/delete operations

        Args:
            project_id: Project ID to reindex
        """
        chapters = self.get_by_project(project_id)
        cursor = self.conn.cursor()

        for idx, chapter in enumerate(chapters):
            cursor.execute(
                "UPDATE chapters SET order_index = ? WHERE id = ?",
                (idx, chapter['id'])
            )

        self.conn.commit()


class SegmentRepository:
    """Repository for segment operations"""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def create(self, chapter_id: str, text: str, order_index: int,
               tts_engine: str, tts_model_name: str, language: str,
               audio_path: Optional[str] = None,
               start_time: float = 0.0, end_time: float = 0.0,
               status: str = 'pending',
               tts_speaker_name: Optional[str] = None,
               segment_type: str = 'standard',
               pause_duration: int = 0) -> Dict[str, Any]:
        """
        Create a new segment

        Args:
            segment_type: 'standard' (default) or 'divider' (pause only)
            pause_duration: Milliseconds of pause (for divider segments)
        """
        # Normalize text: remove newlines and collapse whitespace
        # This ensures clean text for all TTS engines (some interpret \n as speaker boundaries)
        text = ' '.join(text.split())

        segment_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        cursor = self.conn.cursor()

        # Shift existing segments to make room for the new segment
        # All segments at or after order_index need to be incremented by 1
        cursor.execute(
            """
            UPDATE segments
            SET order_index = order_index + 1,
                updated_at = ?
            WHERE chapter_id = ? AND order_index >= ?
            """,
            (now, chapter_id, order_index)
        )

        # Insert new segment at the specified position
        cursor.execute(
            """
            INSERT INTO segments
            (id, chapter_id, text, audio_path, order_index, start_time, end_time,
             status, tts_engine, tts_model_name, tts_speaker_name, language, segment_type, pause_duration,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (segment_id, chapter_id, text, audio_path, order_index, start_time,
             end_time, status, tts_engine, tts_model_name, tts_speaker_name, language,
             segment_type, pause_duration, now, now)
        )
        self.conn.commit()

        return self.get_by_id(segment_id)

    def get_by_id(self, segment_id: str) -> Optional[Dict[str, Any]]:
        """Get segment by ID"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM segments WHERE id = ?", (segment_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return dict_from_row(row)

    def get_by_chapter(self, chapter_id: str) -> List[Dict[str, Any]]:
        """Get all segments for a chapter with quality analysis data."""
        import json

        cursor = self.conn.cursor()

        # Get segments with quality analysis (generic format)
        cursor.execute("""
            SELECT
                s.*,
                sa.quality_status,
                sa.quality_score,
                sa.engine_results,
                CASE
                    WHEN sa.engine_results IS NOT NULL
                    THEN 1
                    ELSE 0
                END as quality_analyzed
            FROM segments s
            LEFT JOIN segments_analysis sa ON s.id = sa.segment_id
            WHERE s.chapter_id = ?
            ORDER BY s.order_index
        """, (chapter_id,))

        segments = []
        for row in cursor.fetchall():
            segment = dict_from_row(row)

            # Parse engine_results from JSON string to list with camelCase conversion
            if segment.get('engine_results'):
                try:
                    engine_results = json.loads(segment['engine_results'])
                    # Convert snake_case keys to camelCase for frontend
                    segment['engine_results'] = self._convert_engine_results_to_camel_case(engine_results)
                except (json.JSONDecodeError, TypeError):
                    segment['engine_results'] = []
            else:
                segment['engine_results'] = []

            segments.append(segment)

        return segments

    def _convert_engine_results_to_camel_case(self, engine_results: List[Dict]) -> List[Dict]:
        """Convert engine results from snake_case to camelCase for frontend."""
        def to_camel_case(snake_str: str) -> str:
            """Convert snake_case to camelCase."""
            components = snake_str.split('_')
            return components[0] + ''.join(x.title() for x in components[1:])

        def convert_dict(d: Dict) -> Dict:
            """Recursively convert dict keys from snake_case to camelCase."""
            result = {}
            for key, value in d.items():
                camel_key = to_camel_case(key)
                if isinstance(value, dict):
                    result[camel_key] = convert_dict(value)
                elif isinstance(value, list):
                    result[camel_key] = [
                        convert_dict(item) if isinstance(item, dict) else item
                        for item in value
                    ]
                else:
                    result[camel_key] = value
            return result

        return [convert_dict(result) for result in engine_results]

    def update(self, segment_id: str, text: Optional[str] = None,
               audio_path: Optional[str] = None,
               clear_audio_path: bool = False,  # Explicit flag to set audio_path=NULL
               start_time: Optional[float] = None,
               end_time: Optional[float] = None,
               status: Optional[str] = None,
               tts_engine: Optional[str] = None,
               tts_model_name: Optional[str] = None,
               tts_speaker_name: Optional[str] = None,
               language: Optional[str] = None,
               pause_duration: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Update segment"""
        updates = []
        params = []

        if text is not None:
            updates.append("text = ?")
            params.append(text)
        # Support explicitly setting audio_path to NULL (clear_audio_path=True)
        # vs. keeping it unchanged (audio_path=None, clear_audio_path=False)
        if clear_audio_path:
            updates.append("audio_path = ?")
            params.append(None)
        elif audio_path is not None:
            updates.append("audio_path = ?")
            params.append(audio_path)
        if start_time is not None:
            updates.append("start_time = ?")
            params.append(start_time)
        if end_time is not None:
            updates.append("end_time = ?")
            params.append(end_time)
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if tts_engine is not None:
            updates.append("tts_engine = ?")
            params.append(tts_engine)
        if tts_model_name is not None:
            updates.append("tts_model_name = ?")
            params.append(tts_model_name)
        if tts_speaker_name is not None:
            updates.append("tts_speaker_name = ?")
            params.append(tts_speaker_name)
        if language is not None:
            updates.append("language = ?")
            params.append(language)
        if pause_duration is not None:
            updates.append("pause_duration = ?")
            params.append(pause_duration)

        if not updates:
            return self.get_by_id(segment_id)

        updates.append("updated_at = ?")
        params.append(datetime.now().isoformat())
        params.append(segment_id)

        cursor = self.conn.cursor()
        # Safe: Column names are hardcoded above, never user-controlled
        # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        cursor.execute(
            f"UPDATE segments SET {', '.join(updates)} WHERE id = ?",
            params
        )
        self.conn.commit()

        return self.get_by_id(segment_id)

    def set_frozen(self, segment_id: str, is_frozen: bool) -> Dict[str, Any]:
        """
        Set frozen status of a segment.

        Frozen segments are protected from regeneration and STT analysis.

        Args:
            segment_id: ID of the segment to freeze/unfreeze
            is_frozen: True to freeze, False to unfreeze

        Returns:
            Updated segment dict

        Raises:
            ValueError: If segment not found
        """
        cursor = self.conn.cursor()
        updated_at = datetime.now().isoformat()

        cursor.execute(
            "UPDATE segments SET is_frozen = ?, updated_at = ? WHERE id = ?",
            (is_frozen, updated_at, segment_id)
        )
        self.conn.commit()

        if cursor.rowcount == 0:
            raise ValueError(f"Segment {segment_id} not found")

        return self.get_by_id(segment_id)

    def delete(self, segment_id: str) -> bool:
        """Delete segment and shift following segments"""
        cursor = self.conn.cursor()

        # Get segment info before deletion (to know chapter_id and order_index)
        segment = self.get_by_id(segment_id)
        if not segment:
            return False

        chapter_id = segment['chapter_id']
        deleted_order_index = segment['order_index']

        # Delete the segment
        cursor.execute("DELETE FROM segments WHERE id = ?", (segment_id,))

        # Shift all following segments down by 1
        now = datetime.now().isoformat()
        cursor.execute(
            """
            UPDATE segments
            SET order_index = order_index - 1,
                updated_at = ?
            WHERE chapter_id = ? AND order_index > ?
            """,
            (now, chapter_id, deleted_order_index)
        )

        self.conn.commit()
        return True

    def reorder_batch(self, segment_ids: List[str], chapter_id: str) -> bool:
        """
        Batch-update order_index for segments within a chapter

        Args:
            segment_ids: List of segment IDs in new order
            chapter_id: Chapter ID for validation

        Returns:
            True if successful
        """
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for idx, segment_id in enumerate(segment_ids):
            cursor.execute(
                "UPDATE segments SET order_index = ?, updated_at = ? WHERE id = ? AND chapter_id = ?",
                (idx, now, segment_id, chapter_id)
            )

        self.conn.commit()
        return True

    def move_to_chapter(self, segment_id: str, new_chapter_id: str, new_order_index: int) -> Dict[str, Any]:
        """
        Move segment to another chapter

        Args:
            segment_id: ID of segment to move
            new_chapter_id: Target chapter ID
            new_order_index: Position in target chapter

        Returns:
            Updated segment object
        """
        # Get segment to get old chapter_id
        segment = self.get_by_id(segment_id)
        if not segment:
            raise ValueError(f"Segment {segment_id} not found")

        old_chapter_id = segment['chapter_id']

        # Update segment
        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE segments SET chapter_id = ?, order_index = ?, updated_at = ? WHERE id = ?",
            (new_chapter_id, new_order_index, datetime.now().isoformat(), segment_id)
        )
        self.conn.commit()

        # Reindex both chapters
        if old_chapter_id:
            self.reindex_segments(old_chapter_id)
        self.reindex_segments(new_chapter_id)

        return self.get_by_id(segment_id)

    def reindex_segments(self, chapter_id: str):
        """
        Normalize order_index after gaps (0, 1, 2, ...)
        Called after move/delete operations

        Args:
            chapter_id: Chapter ID to reindex
        """
        segments = self.get_by_chapter(chapter_id)
        cursor = self.conn.cursor()

        for idx, segment in enumerate(segments):
            cursor.execute(
                "UPDATE segments SET order_index = ? WHERE id = ?",
                (idx, segment['id'])
            )

        self.conn.commit()

    def increment_regenerate_attempts(self, segment_id: str) -> int:
        """
        Increment the regenerate_attempts counter for a segment.

        Used when auto-regenerate creates a TTS job for a defective segment.

        Args:
            segment_id: Segment ID

        Returns:
            New regenerate_attempts value
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE segments
            SET regenerate_attempts = regenerate_attempts + 1,
                updated_at = ?
            WHERE id = ?
        """, (datetime.now().isoformat(), segment_id))

        self.conn.commit()

        # Get updated value
        cursor.execute("SELECT regenerate_attempts FROM segments WHERE id = ?", (segment_id,))
        row = cursor.fetchone()
        return row[0] if row else 0

    def reset_regenerate_attempts(self, segment_id: str) -> None:
        """
        Reset the regenerate_attempts counter to 0.

        Called when user manually triggers regeneration (not auto-regenerate).

        Args:
            segment_id: Segment ID
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE segments
            SET regenerate_attempts = 0,
                updated_at = ?
            WHERE id = ?
        """, (datetime.now().isoformat(), segment_id))

        self.conn.commit()


class ExportJobRepository:
    """Repository for export job operations"""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def create(self, chapter_id: str, output_format: str, total_segments: int,
               bitrate: Optional[str] = None, sample_rate: int = 24000,
               pause_between_segments: int = 500) -> Dict[str, Any]:
        """Create a new export job"""
        job_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO export_jobs
            (id, chapter_id, status, output_format, bitrate, sample_rate,
             pause_between_segments, total_segments, merged_segments,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (job_id, chapter_id, 'pending', output_format, bitrate, sample_rate,
             pause_between_segments, total_segments, 0, now, now)
        )
        self.conn.commit()

        return self.get_by_id(job_id)

    def get_by_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get export job by ID"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_by_chapter(self, chapter_id: str) -> List[Dict[str, Any]]:
        """Get all export jobs for a chapter"""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM export_jobs WHERE chapter_id = ? ORDER BY created_at DESC",
            (chapter_id,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def get_active_exports(self) -> List[Dict[str, Any]]:
        """Get all active (pending or running) export jobs"""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM export_jobs WHERE status IN ('pending', 'running') ORDER BY created_at"
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def update(self, job_id: str, status: Optional[str] = None,
               output_path: Optional[str] = None,
               merged_segments: Optional[int] = None,
               file_size: Optional[int] = None,
               duration: Optional[float] = None,
               error_message: Optional[str] = None,
               started_at: Optional[str] = None,
               completed_at: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Update export job"""
        updates = []
        params = []

        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if output_path is not None:
            updates.append("output_path = ?")
            params.append(output_path)
        if merged_segments is not None:
            updates.append("merged_segments = ?")
            params.append(merged_segments)
        if file_size is not None:
            updates.append("file_size = ?")
            params.append(file_size)
        if duration is not None:
            updates.append("duration = ?")
            params.append(duration)
        if error_message is not None:
            updates.append("error_message = ?")
            params.append(error_message)
        if started_at is not None:
            updates.append("started_at = ?")
            params.append(started_at)
        if completed_at is not None:
            updates.append("completed_at = ?")
            params.append(completed_at)

        if not updates:
            return self.get_by_id(job_id)

        updates.append("updated_at = ?")
        params.append(datetime.now().isoformat())
        params.append(job_id)

        cursor = self.conn.cursor()
        # Safe: Column names are hardcoded above, never user-controlled
        # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        cursor.execute(
            f"UPDATE export_jobs SET {', '.join(updates)} WHERE id = ?",
            params
        )
        self.conn.commit()

        return self.get_by_id(job_id)

    def delete(self, job_id: str) -> bool:
        """Delete export job"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM export_jobs WHERE id = ?", (job_id,))
        self.conn.commit()
        return cursor.rowcount > 0


class TTSJobRepository:
    """
    Repository for TTS job queue operations

    Provides CRUD operations and atomic job state transitions for persistent TTS job queue.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

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

        import json
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
        chapter_id: str,
        tts_engine: str,
        tts_model_name: str,
        tts_speaker_name: str,
        language: str,
        force_regenerate: bool,
        total_segments: int,
        segment_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Create new TTS job in pending state

        Args:
            chapter_id: Chapter to generate
            tts_engine: Engine identifier (e.g., 'xtts')
            tts_model_name: Model to use (e.g., 'v2.0.2')
            tts_speaker_name: Speaker for voice cloning
            language: Language code (e.g., 'de')
            force_regenerate: Regenerate all segments (even completed ones)
            total_segments: Number of segments to process
            segment_ids: Optional list of segment IDs

        Returns:
            Created job dictionary

        Note:
            segment_ids is stored as array of objects with job_status tracking:
            [{"id": "seg-1", "job_status": "pending"}, ...]
            This allows resume to know which segments in the job are already done.
        """
        import json
        job_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        # Convert segment_ids to job status objects
        # Each segment tracks its status WITHIN THIS JOB (not global DB status)
        if segment_ids:
            segment_objs = [{"id": sid, "job_status": "pending"} for sid in segment_ids]
            segment_ids_json = json.dumps(segment_objs)
        else:
            segment_ids_json = None

        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO tts_jobs
            (id, chapter_id, segment_ids, status, tts_engine, tts_model_name, tts_speaker_name,
             language, force_regenerate, total_segments, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            job_id, chapter_id, segment_ids_json, 'pending', tts_engine, tts_model_name,
            tts_speaker_name, language, force_regenerate, total_segments, now, now
        ))
        self.conn.commit()

        return self.get_by_id(job_id)

    def get_by_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job by ID with chapter and project titles"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT
                j.*,
                c.title as chapter_title,
                p.title as project_title
            FROM tts_jobs j
            LEFT JOIN chapters c ON j.chapter_id = c.id
            LEFT JOIN projects p ON c.project_id = p.id
            WHERE j.id = ?
        """, (job_id,))
        row = cursor.fetchone()
        job = dict_from_row(row) if row else None
        return self._parse_job_segment_ids(job)

    def get_next_pending_job(self) -> Optional[Dict[str, Any]]:
        """
        Get next pending job and mark as running (ATOMIC)

        Uses SQLite transaction to prevent race conditions when
        multiple workers try to pick up the same job.

        Returns:
            Job dictionary with updated started_at, or None if no pending jobs

        Note:
            Returns FRESH job data after the update (not stale data before update).
            This ensures started_at is correctly populated for SSE events.
        """
        cursor = self.conn.cursor()

        # SQLite transaction for atomicity
        # BEGIN IMMEDIATE prevents other writers during transaction
        self.conn.execute("BEGIN IMMEDIATE")

        try:
            # Get oldest pending job (only need the ID)
            cursor.execute("""
                SELECT id FROM tts_jobs
                WHERE status = 'pending'
                ORDER BY created_at
                LIMIT 1
            """)

            row = cursor.fetchone()

            if row:
                job_id = row[0]

                # Mark as running and set started_at (UTC with Z suffix for correct frontend parsing)
                started_at = utc_now_iso()
                cursor.execute("""
                    UPDATE tts_jobs
                    SET status = 'running',
                        started_at = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (started_at, started_at, job_id))

                self.conn.commit()

                # Return fresh job data with updated started_at
                return self.get_by_id(job_id)
            else:
                self.conn.rollback()
                return None

        except Exception as e:
            self.conn.rollback()
            from loguru import logger
            logger.error(f"Failed to get next job: {e}")
            raise

    def update_progress(
        self,
        job_id: str,
        processed_segments: Optional[int] = None,
        current_segment_id: Optional[str] = None,
        failed_segments: Optional[int] = None
    ):
        """
        Update job progress during processing

        Args:
            job_id: Job identifier
            processed_segments: Number of segments completed (optional)
            current_segment_id: ID of segment currently being processed (optional)
            failed_segments: Number of segments that failed (optional)
        """
        cursor = self.conn.cursor()

        updates = ["updated_at = datetime('now')"]
        params = []

        if processed_segments is not None:
            updates.append("processed_segments = ?")
            params.append(processed_segments)

        if current_segment_id is not None:
            updates.append("current_segment_id = ?")
            params.append(current_segment_id)

        if failed_segments is not None:
            updates.append("failed_segments = ?")
            params.append(failed_segments)

        params.append(job_id)

        # Safe: Column names are hardcoded in updates list (lines 957-970), values parameterized
        # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        cursor.execute(f"""
            UPDATE tts_jobs
            SET {', '.join(updates)}
            WHERE id = ?
        """, params)
        self.conn.commit()

    def mark_segment_completed(self, job_id: str, segment_id: str):
        """
        Mark a specific segment as completed within the job

        Updates the job_status of the segment in segment_ids JSON array
        and increments processed_segments counter.

        Args:
            job_id: Job identifier
            segment_id: Segment ID to mark as completed

        Note:
            This updates the job-internal status, not the global segment.status in DB.
            Allows resume to know which segments were already done in THIS job.
        """
        import json

        # Get current job
        job = self.get_by_id(job_id)
        if not job:
            return

        # Get segment_ids (already parsed by get_by_id)
        segment_objs = job.get('segment_ids')
        if not segment_objs:
            return

        # Find and update the segment
        updated = False
        for seg_obj in segment_objs:
            if seg_obj.get('id') == segment_id:
                seg_obj['job_status'] = 'completed'
                updated = True
                break

        if not updated:
            from loguru import logger
            logger.warning(f"Segment {segment_id} not found in job {job_id} segment_ids")
            return

        # Save updated segment_ids back to database
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE tts_jobs
            SET segment_ids = ?,
                processed_segments = processed_segments + 1,
                updated_at = datetime('now')
            WHERE id = ?
        """, (json.dumps(segment_objs), job_id))
        self.conn.commit()

    def mark_completed(self, job_id: str):
        """Mark job as successfully completed"""
        now = utc_now_iso()
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE tts_jobs
            SET status = 'completed',
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
        """, (now, now, job_id))
        self.conn.commit()

    def mark_failed(self, job_id: str, error_message: str):
        """Mark job as failed"""
        now = utc_now_iso()
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE tts_jobs
            SET status = 'failed',
                error_message = ?,
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
        """, (error_message, now, now, job_id))
        self.conn.commit()
        from loguru import logger
        logger.error(f"Job {job_id} failed: {error_message}")

    def get_latest_job_for_chapter(self, chapter_id: str) -> Optional[Dict[str, Any]]:
        """
        Get most recent job for chapter (for progress queries)

        Args:
            chapter_id: Chapter identifier

        Returns:
            Latest job or None
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM tts_jobs
            WHERE chapter_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        """, (chapter_id,))
        row = cursor.fetchone()
        return dict_from_row(row) if row else None

    def get_active_jobs_for_chapter(self, chapter_id: str) -> List[Dict[str, Any]]:
        """
        Get all active (pending or running) jobs for chapter

        Used to prevent duplicate job creation.

        Args:
            chapter_id: Chapter identifier

        Returns:
            List of active jobs
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM tts_jobs
            WHERE chapter_id = ? AND status IN ('pending', 'running')
            ORDER BY created_at
        """, (chapter_id,))
        return [dict_from_row(row) for row in cursor.fetchall()]

    def count_active_jobs(self) -> int:
        """
        Count all active (pending or running) jobs

        Used for health monitoring and UI status indicators.

        Returns:
            Number of active jobs
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) as count FROM tts_jobs
            WHERE status IN ('pending', 'running')
        """)
        row = cursor.fetchone()
        return row[0] if row else 0

    def create_segment_job(
        self,
        segment_ids: List[str],
        tts_engine: str,
        tts_model_name: str,
        tts_speaker_name: str,
        language: str,
        context_chapter_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create job for specific segments (Phase 2.5)

        Args:
            segment_ids: List of segment IDs to process
            tts_engine: Engine identifier (e.g., 'xtts')
            tts_model_name: Model to use (e.g., 'v2.0.2')
            tts_speaker_name: Speaker for voice cloning
            language: Language code (e.g., 'de')
            context_chapter_id: Chapter ID for UI navigation (optional)

        Returns:
            Created job dictionary
        """
        import json

        job_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        # Use first segment's chapter as context if not provided
        if context_chapter_id is None:
            segment_repo = SegmentRepository(self.conn)
            first_segment = segment_repo.get_by_id(segment_ids[0])
            if first_segment:
                context_chapter_id = first_segment['chapter_id']

        # Convert segment_ids to job status objects (new format)
        segment_objs = [{"id": sid, "job_status": "pending"} for sid in segment_ids]

        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO tts_jobs
            (id, chapter_id, segment_ids, status, tts_engine, tts_model_name,
             tts_speaker_name, language, force_regenerate, total_segments, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            job_id, context_chapter_id, json.dumps(segment_objs),
            'pending', tts_engine, tts_model_name, tts_speaker_name, language,
            False,  # force_regenerate not relevant for segment jobs (always process all)
            len(segment_ids), now, now
        ))
        self.conn.commit()

        from loguru import logger
        logger.info(f"Created segment job {job_id} for {len(segment_ids)} segment(s)")

        return self.get_by_id(job_id)

    def request_cancellation(self, job_id: str) -> bool:
        """
        Request job cancellation (set status to 'cancelling')

        Worker will detect this and gracefully stop after current segment.

        Args:
            job_id: Job identifier

        Returns:
            True if cancellation requested, False if job not running
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE tts_jobs
            SET status = 'cancelling',
                updated_at = datetime('now')
            WHERE id = ? AND status = 'running'
        """, (job_id,))
        affected = cursor.rowcount
        self.conn.commit()

        if affected > 0:
            from loguru import logger
            logger.info(f"Cancellation requested for job {job_id}")
        return affected > 0

    def mark_cancelled(self, job_id: str):
        """
        Mark job as cancelled (called by worker after graceful shutdown)

        Args:
            job_id: Job identifier
        """
        now = utc_now_iso()
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE tts_jobs
            SET status = 'cancelled',
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
        """, (now, now, job_id))
        self.conn.commit()

        from loguru import logger
        logger.info(f"Job {job_id} marked as cancelled")

    def cancel_job(self, job_id: str):
        """
        Cancel pending job (direct cancellation)

        Note: For running jobs, use request_cancellation() instead

        Args:
            job_id: Job identifier
        """
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE tts_jobs
            SET status = 'cancelled',
                updated_at = datetime('now')
            WHERE id = ? AND status = 'pending'
        """, (job_id,))
        affected = cursor.rowcount
        self.conn.commit()

        if affected > 0:
            from loguru import logger
            logger.info(f"Cancelled pending job {job_id}")
        return affected > 0

    def resume_job(
        self,
        job_id: str
    ) -> Dict[str, Any]:
        """
        Resume a cancelled job with remaining segments

        Filters segment_ids to only include segments with job_status="pending",
        then updates job status to 'pending' to restart processing.

        Args:
            job_id: Job identifier to resume

        Returns:
            Updated job dictionary

        Raises:
            ValueError: If job not found, not cancelled, or no pending segments remain

        Note:
            Uses job-internal job_status to determine which segments to resume.
            This allows resuming force_regenerate jobs correctly.
        """
        import json

        # Verify job exists and is cancelled
        job = self.get_by_id(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        if job['status'] != 'cancelled':
            raise ValueError(f"Job {job_id} is not cancelled (status: {job['status']})")

        # Get segment_ids (already parsed by get_by_id)
        segment_objs = job.get('segment_ids')
        if not segment_objs:
            raise ValueError(f"Job {job_id} has no segment_ids")

        # Filter to only pending segments
        remaining_segment_objs = [
            seg_obj for seg_obj in segment_objs
            if seg_obj.get('job_status') == 'pending'
        ]

        # Check if there's anything to process
        if not remaining_segment_objs:
            raise ValueError(f"Job {job_id} has no pending segments to resume")

        # Update job to resume with filtered segments
        # NOTE: We keep total_segments unchanged to preserve original job scope
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE tts_jobs
            SET status = 'pending',
                segment_ids = ?,
                error_message = NULL,
                updated_at = datetime('now')
            WHERE id = ?
        """, (json.dumps(remaining_segment_objs), job_id))
        self.conn.commit()

        from loguru import logger
        logger.info(
            f"Resumed job {job_id}: {len(remaining_segment_objs)} remaining segments "
            f"({job.get('processed_segments', 0)}/{job.get('total_segments', 0)} already done)"
        )

        # Return updated job
        return self.get_by_id(job_id)

    def reset_stuck_jobs(self) -> int:
        """
        Reset jobs stuck in 'running' state and cleanup their segments.

        Called on server startup. Jobs with status='running' were likely
        interrupted by server crash and should be marked as failed.
        Segments stuck in 'queued' or 'processing' are reset to 'pending'.

        Returns:
            Number of jobs reset
        """
        import json
        from loguru import logger

        cursor = self.conn.cursor()

        # Get stuck jobs before resetting
        cursor.execute("SELECT * FROM tts_jobs WHERE status = 'running'")
        stuck_jobs = [dict_from_row(row) for row in cursor.fetchall()]

        if not stuck_jobs:
            return 0

        # Reset segments for each stuck job
        segment_repo = SegmentRepository(self.conn)
        for job in stuck_jobs:
            # Parse segment_ids
            segment_ids_json = job.get('segment_ids')
            if segment_ids_json:
                try:
                    if isinstance(segment_ids_json, str):
                        segment_objs = json.loads(segment_ids_json)
                    else:
                        segment_objs = segment_ids_json

                    # Reset segments stuck in queued/processing
                    for seg_obj in segment_objs:
                        seg_id = seg_obj.get('id')
                        if not seg_id:
                            continue

                        try:
                            seg = segment_repo.get_by_id(seg_id)
                            if seg and seg['status'] in ('queued', 'processing'):
                                segment_repo.update(seg_id, status='pending')
                                logger.debug(f"Reset segment {seg_id} to pending (job {job['id']} crashed)")
                        except Exception as e:
                            logger.error(f"Failed to reset segment {seg_id} during crash recovery: {e}")

                except (json.JSONDecodeError, TypeError) as e:
                    logger.error(f"Failed to parse segment_ids for job {job['id']}: {e}")

        # Reset jobs to failed
        cursor.execute("""
            UPDATE tts_jobs
            SET status = 'failed',
                error_message = 'Server restart detected - job interrupted',
                updated_at = datetime('now')
            WHERE status = 'running'
        """)
        affected = cursor.rowcount
        self.conn.commit()

        logger.warning(f"Reset {affected} stuck jobs and their segments from previous session")

        return affected

    def get_all(
        self,
        status: Optional[str | List[str]] = None,
        chapter_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        Get all jobs with optional filters

        Args:
            status: Single status or list of statuses (e.g., 'running' or ['pending', 'running'])
            chapter_id: Filter by chapter ID
            limit: Maximum number of results (default 50)
            offset: Pagination offset (default 0)

        Returns:
            List of job dictionaries, ordered by created_at DESC
        """
        cursor = self.conn.cursor()

        # JOIN with chapters and projects to get titles for UI display
        query = """
            SELECT
                j.*,
                c.title as chapter_title,
                p.title as project_title
            FROM tts_jobs j
            LEFT JOIN chapters c ON j.chapter_id = c.id
            LEFT JOIN projects p ON c.project_id = p.id
            WHERE 1=1
        """
        params = []

        # Status filter (single value or list)
        if status:
            if isinstance(status, list):
                placeholders = ','.join('?' * len(status))
                query += f" AND j.status IN ({placeholders})"
                params.extend(status)
            else:
                query += " AND j.status = ?"
                params.append(status)

        # Chapter ID filter
        if chapter_id:
            query += " AND j.chapter_id = ?"
            params.append(chapter_id)

        # Ordering and pagination
        query += " ORDER BY j.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor.execute(query, params)
        jobs = [dict_from_row(row) for row in cursor.fetchall()]
        return [self._parse_job_segment_ids(job) for job in jobs]

    def delete_by_id(self, job_id: str) -> bool:
        """
        Delete a specific job by ID

        Used for deleting individual cancelled jobs that won't be resumed.

        Args:
            job_id: Job identifier

        Returns:
            True if job was deleted, False if not found
        """
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM tts_jobs WHERE id = ?", (job_id,))
        affected = cursor.rowcount
        self.conn.commit()

        from loguru import logger
        if affected > 0:
            logger.info(f"Deleted job {job_id}")
        else:
            logger.warning(f"Job {job_id} not found for deletion")

        return affected > 0

    def delete_by_status(self, statuses: List[str]) -> int:
        """
        Delete all jobs matching the given statuses

        Used for bulk cleanup of completed/failed jobs.

        Args:
            statuses: List of status values (e.g., ['completed', 'failed'])

        Returns:
            Number of jobs deleted
        """
        cursor = self.conn.cursor()

        placeholders = ','.join('?' * len(statuses))
        query = f"DELETE FROM tts_jobs WHERE status IN ({placeholders})"

        # Safe: Placeholders are just '?,?,?' string, values parameterized
        cursor.execute(query, statuses)  # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        affected = cursor.rowcount
        self.conn.commit()

        from loguru import logger
        logger.info(f"Deleted {affected} job(s) with status: {statuses}")

        return affected

    def delete_with_segment_cleanup(self, job_id: str) -> bool:
        """
        Delete job and reset affected segments to 'pending' status.

        This prevents orphaned segments stuck in 'queued' or 'processing'
        status when a job is deleted. Segments are reset so they can be
        regenerated in future jobs.

        Args:
            job_id: Job identifier

        Returns:
            True if job was deleted, False if not found
        """
        # Get job before deletion to access segment_ids
        job = self.get_by_id(job_id)
        if not job:
            return False

        # Reset segments to 'pending' if they're stuck in queued/processing
        segment_objs = job.get('segment_ids', [])
        if segment_objs:
            segment_repo = SegmentRepository(self.conn)
            for seg_obj in segment_objs:
                seg_id = seg_obj.get('id')
                if not seg_id:
                    continue

                try:
                    seg = segment_repo.get_by_id(seg_id)
                    if seg and seg['status'] in ('queued', 'processing'):
                        segment_repo.update(seg_id, status='pending')
                        from loguru import logger
                        logger.debug(f"Reset segment {seg_id} to pending (job {job_id} deleted)")
                except Exception as e:
                    from loguru import logger
                    logger.error(f"Failed to reset segment {seg_id} during job deletion: {e}")

        # Delete the job
        return self.delete_by_id(job_id)
