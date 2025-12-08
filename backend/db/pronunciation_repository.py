"""Repository for pronunciation rules operations."""
import re
import sqlite3
from typing import List, Optional, Tuple, Dict, Any
from datetime import datetime
from loguru import logger

from models.pronunciation_models import (
    PronunciationRule,
    PronunciationRuleCreate,
    PronunciationRuleUpdate
)


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dictionary"""
    return dict(row)

class PronunciationRulesRepository:
    """Repository for pronunciation rules database operations."""

    def __init__(self, db):
        self.db = db
        self.cursor = db.cursor()

    def create(self, rule_data: PronunciationRuleCreate) -> PronunciationRule:
        """Create a new pronunciation rule."""
        try:
            # Generate ID
            import uuid
            rule_id = str(uuid.uuid4())

            # Validate project_id based on scope
            # Only 'project_engine' scope should have a project_id
            # Convert empty string to None to avoid FK constraint errors
            project_id = rule_data.project_id
            if not project_id or rule_data.scope != 'project_engine':
                project_id = None

            # Insert rule
            self.cursor.execute("""
                INSERT INTO pronunciation_rules (
                    id, pattern, replacement, is_regex, scope,
                    project_id, engine_name, language, is_active,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                rule_id,
                rule_data.pattern,
                rule_data.replacement,
                rule_data.is_regex,
                rule_data.scope,
                project_id,
                rule_data.engine_name,
                rule_data.language,
                rule_data.is_active,
                datetime.now().isoformat(),
                datetime.now().isoformat()
            ))

            self.db.commit()

            # Return created rule
            return self.get_by_id(rule_id)

        except Exception as e:
            self.db.rollback()

            # Provide better error message for FK constraint violations
            error_msg = str(e)
            if "FOREIGN KEY constraint failed" in error_msg:
                if rule_data.project_id:
                    logger.error(
                        f"Failed to create pronunciation rule: Project ID '{rule_data.project_id}' "
                        f"does not exist in projects table"
                    )
                    raise ValueError(
                        f"Invalid project_id: '{rule_data.project_id}' does not exist"
                    )
                else:
                    logger.error(f"Failed to create pronunciation rule: {e}")
                    raise
            else:
                logger.error(f"Failed to create pronunciation rule: {e}")
                raise

    def get_by_id(self, rule_id: str) -> Optional[PronunciationRule]:
        """Get a rule by ID."""
        self.cursor.execute("""
            SELECT * FROM pronunciation_rules WHERE id = ?
        """, (rule_id,))

        row = self.cursor.fetchone()
        if not row:
            return None

        return self._row_to_model(row)

    def get_rules_for_context(
        self,
        engine_name: str,
        language: str,
        project_id: Optional[str] = None
    ) -> List[PronunciationRule]:
        """Get all applicable rules for a given context, ordered by priority."""
        rules = []

        # 1. Project+Engine rules (highest priority)
        if project_id:
            self.cursor.execute("""
                SELECT * FROM pronunciation_rules
                WHERE scope = 'project_engine'
                AND project_id = ?
                AND engine_name = ?
                AND language = ?
                AND is_active = 1
                ORDER BY created_at DESC
            """, (project_id, engine_name, language))
            rules.extend([self._row_to_model(row) for row in self.cursor.fetchall()])

        # 2. Engine rules (lowest priority)
        self.cursor.execute("""
            SELECT * FROM pronunciation_rules
            WHERE scope = 'engine'
            AND engine_name = ?
            AND language = ?
            AND is_active = 1
            ORDER BY created_at DESC
        """, (engine_name, language))
        rules.extend([self._row_to_model(row) for row in self.cursor.fetchall()])

        return rules

    def update(self, rule_id: str, update_data: PronunciationRuleUpdate) -> Optional[PronunciationRule]:
        """Update a pronunciation rule."""
        # Build update query dynamically
        fields = []
        values = []

        # SECURITY: Whitelist allowed fields to prevent SQL injection
        ALLOWED_FIELDS = {'pattern', 'replacement', 'is_regex', 'scope', 'project_id', 'engine_name', 'language', 'is_active'}

        for field, value in update_data.model_dump(exclude_unset=True).items():
            # Validate field name against whitelist
            if field not in ALLOWED_FIELDS:
                logger.warning(f"Attempted to update disallowed field: {field}")
                continue

            fields.append(f"{field} = ?")
            values.append(value)

        if not fields:
            return self.get_by_id(rule_id)

        # If scope is being changed to 'engine', clear project_id
        if 'scope' in update_data.model_dump(exclude_unset=True):
            new_scope = update_data.model_dump(exclude_unset=True)['scope']
            if new_scope == 'engine':
                fields.append("project_id = ?")
                values.append(None)
                logger.debug(f"Clearing project_id for scope change to '{new_scope}'")

        # Add updated_at
        fields.append("updated_at = ?")
        values.append(datetime.now().isoformat())

        # Add ID for WHERE clause
        values.append(rule_id)

        query = f"""
            UPDATE pronunciation_rules
            SET {', '.join(fields)}
            WHERE id = ?
        """

        # Safe: Field names validated against whitelist (line 135), values parameterized
        self.cursor.execute(query, values)  # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query
        self.db.commit()

        return self.get_by_id(rule_id)

    def delete(self, rule_id: str) -> bool:
        """Delete a pronunciation rule."""
        self.cursor.execute("""
            DELETE FROM pronunciation_rules WHERE id = ?
        """, (rule_id,))
        self.db.commit()

        return self.cursor.rowcount > 0

    def delete_by_project(self, project_id: str) -> int:
        """Delete all pronunciation rules associated with a project.

        Args:
            project_id: Project ID

        Returns:
            Number of deleted rules
        """
        self.cursor.execute("""
            DELETE FROM pronunciation_rules WHERE project_id = ?
        """, (project_id,))
        self.db.commit()

        return self.cursor.rowcount

    def detect_conflicts(self, engine_name: str, language: str) -> List[Tuple[PronunciationRule, PronunciationRule]]:
        """Detect conflicting rules (overlapping patterns)."""
        conflicts = []

        # Get all active rules for this engine/language
        self.cursor.execute("""
            SELECT * FROM pronunciation_rules
            WHERE engine_name = ?
            AND language = ?
            AND is_active = 1
            ORDER BY
                CASE scope
                    WHEN 'project_engine' THEN 1
                    WHEN 'engine' THEN 2
                END,
                created_at DESC
        """, (engine_name, language))

        rules = [self._row_to_model(row) for row in self.cursor.fetchall()]

        # Check for conflicts
        for i, rule1 in enumerate(rules):
            for rule2 in rules[i+1:]:
                if self._rules_conflict(rule1, rule2):
                    conflicts.append((rule1, rule2))

        return conflicts

    def _rules_conflict(self, rule1: PronunciationRule, rule2: PronunciationRule) -> bool:
        """Check if two rules conflict."""
        # Simple pattern contained in another
        if rule1.pattern in rule2.pattern or rule2.pattern in rule1.pattern:
            return True

        # Regex overlap detection (simplified)
        if rule1.is_regex or rule2.is_regex:
            try:
                if rule1.is_regex:
                    pattern1 = re.compile(rule1.pattern)
                    if pattern1.search(rule2.pattern):
                        return True

                if rule2.is_regex:
                    pattern2 = re.compile(rule2.pattern)
                    if pattern2.search(rule1.pattern):
                        return True
            except re.error:
                pass

        return False

    def get_all(self, limit: int = 1000) -> List[PronunciationRule]:
        """Get all pronunciation rules.

        Args:
            limit: Maximum number of rules to return

        Returns:
            List of all rules
        """
        self.cursor.execute("""
            SELECT * FROM pronunciation_rules
            ORDER BY created_at DESC
            LIMIT ?
        """, (limit,))

        return [self._row_to_model(row) for row in self.cursor.fetchall()]

    def _row_to_model(self, row) -> PronunciationRule:
        """Convert database row to model."""
        if not row:
            return None

        # Create dict from row using helper
        data = dict_from_row(row)

        # Convert timestamps
        data['created_at'] = datetime.fromisoformat(data['created_at'])
        data['updated_at'] = datetime.fromisoformat(data['updated_at'])

        return PronunciationRule(**data)
