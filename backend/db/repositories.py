"""
Database repositories for CRUD operations
"""
from typing import List, Optional, Dict, Any
from datetime import datetime
import sqlite3
import uuid


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
        cursor.execute(
            """
            INSERT INTO projects (id, title, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (project_id, title, description, now, now)
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

    def create(self, project_id: str, title: str, order_index: int,
               default_engine: str, default_model_name: str) -> Dict[str, Any]:
        """Create a new chapter"""
        chapter_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO chapters (id, project_id, title, order_index, default_engine, default_model_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (chapter_id, project_id, title, order_index, default_engine, default_model_name, now, now)
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
               order_index: Optional[int] = None,
               default_engine: Optional[str] = None,
               default_model_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Update chapter"""
        updates = []
        params = []

        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if order_index is not None:
            updates.append("order_index = ?")
            params.append(order_index)
        if default_engine is not None:
            updates.append("default_engine = ?")
            params.append(default_engine)
        if default_model_name is not None:
            updates.append("default_model_name = ?")
            params.append(default_model_name)

        if not updates:
            return self.get_by_id(chapter_id)

        updates.append("updated_at = ?")
        params.append(datetime.now().isoformat())
        params.append(chapter_id)

        cursor = self.conn.cursor()
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
        chapter = self.get_by_id(chapter_id)
        if not chapter:
            raise ValueError(f"Chapter {chapter_id} not found")

        old_project_id = chapter['project_id']

        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE chapters SET project_id = ?, order_index = ?, updated_at = ? WHERE id = ?",
            (new_project_id, new_order_index, datetime.now().isoformat(), chapter_id)
        )
        self.conn.commit()

        if old_project_id:
            self.reindex_chapters(old_project_id)

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
               engine: str, model_name: str, language: str,
               audio_path: Optional[str] = None,
               start_time: float = 0.0, end_time: float = 0.0,
               status: str = 'pending',
               speaker_name: Optional[str] = None,
               segment_type: str = 'standard',
               pause_duration: int = 0) -> Dict[str, Any]:
        """
        Create a new segment

        Args:
            segment_type: 'standard' (default) or 'divider' (pause only)
            pause_duration: Milliseconds of pause (for divider segments)
        """
        segment_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        cursor = self.conn.cursor()

        cursor.execute(
            """
            UPDATE segments
            SET order_index = order_index + 1,
                updated_at = ?
            WHERE chapter_id = ? AND order_index >= ?
            """,
            (now, chapter_id, order_index)
        )

        cursor.execute(
            """
            INSERT INTO segments
            (id, chapter_id, text, audio_path, order_index, start_time, end_time,
             status, engine, model_name, speaker_name, language, segment_type, pause_duration,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (segment_id, chapter_id, text, audio_path, order_index, start_time,
             end_time, status, engine, model_name, speaker_name, language,
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
        """Get all segments for a chapter"""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM segments WHERE chapter_id = ? ORDER BY order_index",
            (chapter_id,)
        )
        return [dict_from_row(row) for row in cursor.fetchall()]

    def update(self, segment_id: str, text: Optional[str] = None,
               audio_path: Optional[str] = None,
               start_time: Optional[float] = None,
               end_time: Optional[float] = None,
               status: Optional[str] = None,
               engine: Optional[str] = None,
               model_name: Optional[str] = None,
               speaker_name: Optional[str] = None,
               language: Optional[str] = None,
               pause_duration: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Update segment"""
        updates = []
        params = []

        if text is not None:
            updates.append("text = ?")
            params.append(text)
        if audio_path is not None:
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
        if engine is not None:
            updates.append("engine = ?")
            params.append(engine)
        if model_name is not None:
            updates.append("model_name = ?")
            params.append(model_name)
        if speaker_name is not None:
            updates.append("speaker_name = ?")
            params.append(speaker_name)
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
        cursor.execute(
            f"UPDATE segments SET {', '.join(updates)} WHERE id = ?",
            params
        )
        self.conn.commit()

        return self.get_by_id(segment_id)

    def delete(self, segment_id: str) -> bool:
        """Delete segment and shift following segments"""
        cursor = self.conn.cursor()

        segment = self.get_by_id(segment_id)
        if not segment:
            return False

        chapter_id = segment['chapter_id']
        deleted_order_index = segment['order_index']

        cursor.execute("DELETE FROM segments WHERE id = ?", (segment_id,))

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
        segment = self.get_by_id(segment_id)
        if not segment:
            raise ValueError(f"Segment {segment_id} not found")

        old_chapter_id = segment['chapter_id']

        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE segments SET chapter_id = ?, order_index = ?, updated_at = ? WHERE id = ?",
            (new_chapter_id, new_order_index, datetime.now().isoformat(), segment_id)
        )
        self.conn.commit()

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
