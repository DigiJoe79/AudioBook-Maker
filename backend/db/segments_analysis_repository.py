"""Repository for segment quality analysis results.

Stores aggregated quality analysis from multiple engines (STT, Audio) in a generic format.
"""
import json
import sqlite3
from typing import List, Dict, Any, Optional
from datetime import datetime
from loguru import logger


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dictionary"""
    return dict(row)


class SegmentsAnalysisRepository:
    """Repository for segment quality analysis database operations.

    Stores quality analysis results in a generic, engine-agnostic format.
    Each analysis contains:
    - quality_score: Aggregated score (0-100)
    - quality_status: Aggregated status (perfect/warning/defect)
    - engine_results: JSON array of results from each engine
    """

    def __init__(self, db):
        self.db = db
        self.cursor = db.cursor()

    def save_quality_analysis(
        self,
        segment_id: str,
        chapter_id: str,
        quality_score: int,
        quality_status: str,
        engine_results: List[Dict[str, Any]]
    ) -> None:
        """
        Save quality analysis results in generic format.

        Args:
            segment_id: Segment identifier
            chapter_id: Chapter identifier
            quality_score: Aggregated quality score (0-100)
            quality_status: Aggregated status (perfect/warning/defect)
            engine_results: List of engine result dicts in generic format
        """
        try:
            # Check if analysis exists
            self.cursor.execute(
                "SELECT id FROM segments_analysis WHERE segment_id = ?",
                (segment_id,)
            )
            existing = self.cursor.fetchone()

            engine_results_json = json.dumps(engine_results)
            analyzed_at = datetime.now().isoformat()

            if existing:
                self.cursor.execute("""
                    UPDATE segments_analysis SET
                        quality_score = ?,
                        quality_status = ?,
                        engine_results = ?,
                        analyzed_at = ?,
                        updated_at = ?
                    WHERE segment_id = ?
                """, (quality_score, quality_status, engine_results_json, analyzed_at, analyzed_at, segment_id))
            else:
                import uuid
                analysis_id = str(uuid.uuid4())
                now = datetime.now().isoformat()
                self.cursor.execute("""
                    INSERT INTO segments_analysis (
                        id, segment_id, chapter_id, quality_score, quality_status,
                        engine_results, analyzed_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (analysis_id, segment_id, chapter_id, quality_score, quality_status,
                      engine_results_json, analyzed_at, now, now))

            self.db.commit()
            logger.debug(f"Saved quality analysis for segment {segment_id}: score={quality_score}, status={quality_status}")

        except Exception as e:
            logger.error(f"Failed to save quality analysis: {e}")
            self.db.rollback()
            raise

    def get_by_segment_id(self, segment_id: str) -> Optional[Dict[str, Any]]:
        """Get analysis for a segment.

        Args:
            segment_id: Segment ID

        Returns:
            Analysis dict or None
        """
        self.cursor.execute("""
            SELECT id, segment_id, chapter_id, quality_score, quality_status,
                   engine_results, analyzed_at, created_at, updated_at
            FROM segments_analysis
            WHERE segment_id = ?
        """, (segment_id,))

        row = self.cursor.fetchone()
        if not row:
            return None

        result = dict_from_row(row)

        # Parse engine_results JSON
        if result.get('engine_results'):
            result['engine_results'] = json.loads(result['engine_results'])
        else:
            result['engine_results'] = []

        return result

    def get_chapter_analyses(self, chapter_id: str) -> List[Dict[str, Any]]:
        """Get all analyses for a chapter.

        Args:
            chapter_id: Chapter ID

        Returns:
            List of analysis dicts
        """
        self.cursor.execute("""
            SELECT sa.id, sa.segment_id, sa.chapter_id, sa.quality_score, sa.quality_status,
                   sa.engine_results, sa.analyzed_at, sa.created_at, sa.updated_at
            FROM segments_analysis sa
            JOIN segments s ON sa.segment_id = s.id
            WHERE sa.chapter_id = ?
            ORDER BY s.order_index
        """, (chapter_id,))

        results = []

        for row in self.cursor.fetchall():
            result = dict_from_row(row)

            # Parse engine_results JSON
            if result.get('engine_results'):
                result['engine_results'] = json.loads(result['engine_results'])
            else:
                result['engine_results'] = []

            results.append(result)

        return results

    def delete_by_segment_id(self, segment_id: str) -> bool:
        """Delete analysis for a segment.

        Args:
            segment_id: Segment ID

        Returns:
            True if analysis was deleted, False if not found
        """
        self.cursor.execute(
            "DELETE FROM segments_analysis WHERE segment_id = ?",
            (segment_id,)
        )

        self.db.commit()
        deleted = self.cursor.rowcount > 0

        if deleted:
            logger.debug(f"Deleted segment analysis for {segment_id}")

        return deleted

    def delete_chapter_analyses(self, chapter_id: str) -> int:
        """Delete all analyses for a chapter.

        Args:
            chapter_id: Chapter ID

        Returns:
            Number of deleted analyses
        """
        self.cursor.execute("""
            DELETE FROM segments_analysis
            WHERE segment_id IN (
                SELECT id FROM segments WHERE chapter_id = ?
            )
        """, (chapter_id,))

        self.db.commit()

        return self.cursor.rowcount
