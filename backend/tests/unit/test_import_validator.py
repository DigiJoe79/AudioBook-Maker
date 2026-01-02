"""
Unit Tests for ImportValidator

Tests the import validation service for markdown import.
"""

import pytest
from unittest.mock import MagicMock, patch

from services.import_validator import ImportValidator


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def validator():
    """Create ImportValidator with generous limits."""
    return ImportValidator(max_chapter_length=50000, max_segment_length=500)


@pytest.fixture
def validator_strict():
    """Create ImportValidator with strict limits for testing."""
    return ImportValidator(max_chapter_length=100, max_segment_length=50)


def make_parsed_data(chapters):
    """Helper to create parsed data structure."""
    return {
        "project": {"title": "Test Project", "description": ""},
        "chapters": chapters
    }


def make_chapter(title, content_blocks=None, segments=None, stats=None):
    """Helper to create chapter data."""
    chapter = {
        "title": title,
        "original_title": title,
        "order_index": 0
    }
    if content_blocks is not None:
        chapter["content_blocks"] = content_blocks
    if segments is not None:
        chapter["segments"] = segments
    if stats is not None:
        chapter["stats"] = stats
    return chapter


# ============================================================================
# Test: validate_structure - Content Blocks
# ============================================================================

class TestValidateStructureContentBlocks:
    """Tests for validate_structure with content_blocks (pre-segmentation)."""

    def test_valid_chapter_no_warnings(self, validator):
        """Valid chapter produces no warnings."""
        chapters = [
            make_chapter("Chapter 1", content_blocks=[
                {"type": "text", "content": "Some text content."}
            ])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_structure(data)

        assert len(warnings) == 0

    def test_empty_chapter_warning(self, validator):
        """Empty chapter produces warning."""
        chapters = [
            make_chapter("Empty Chapter", content_blocks=[])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_structure(data)

        assert len(warnings) == 1
        assert warnings[0].type == "empty_chapter"
        assert warnings[0].severity == "warning"

    def test_chapter_too_long_warning(self, validator_strict):
        """Chapter exceeding max length produces warning."""
        long_content = "A" * 150  # Exceeds 100 char limit
        chapters = [
            make_chapter("Long Chapter", content_blocks=[
                {"type": "text", "content": long_content}
            ])
        ]
        data = make_parsed_data(chapters)

        warnings = validator_strict.validate_structure(data)

        assert len(warnings) == 1
        assert warnings[0].type == "chapter_too_long"
        assert "IMPORT_CHAPTER_TOO_LONG" in warnings[0].message

    def test_special_chars_in_title_info(self, validator):
        """Special characters in title produce info warning."""
        chapters = [
            make_chapter("Chapter/One", content_blocks=[
                {"type": "text", "content": "Content"}
            ])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_structure(data)

        assert len(warnings) == 1
        assert warnings[0].type == "special_chars_in_title"
        assert warnings[0].severity == "info"

    def test_backslash_in_title(self, validator):
        """Backslash in title produces info warning."""
        chapters = [
            make_chapter("Chapter\\Two", content_blocks=[
                {"type": "text", "content": "Content"}
            ])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_structure(data)

        assert any(w.type == "special_chars_in_title" for w in warnings)

    def test_hash_in_title(self, validator):
        """Hash in title produces info warning."""
        chapters = [
            make_chapter("Chapter#Three", content_blocks=[
                {"type": "text", "content": "Content"}
            ])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_structure(data)

        assert any(w.type == "special_chars_in_title" for w in warnings)

    def test_divider_blocks_not_counted_for_length(self, validator_strict):
        """Divider blocks don't contribute to character count."""
        chapters = [
            make_chapter("Chapter", content_blocks=[
                {"type": "text", "content": "Short"},  # 5 chars
                {"type": "divider"},  # Should not add to count
                {"type": "text", "content": "Also short"}  # 10 chars = 15 total
            ])
        ]
        data = make_parsed_data(chapters)

        warnings = validator_strict.validate_structure(data)

        # 15 chars < 100 limit, should not warn
        assert not any(w.type == "chapter_too_long" for w in warnings)


# ============================================================================
# Test: validate_structure - Segments
# ============================================================================

class TestValidateStructureSegments:
    """Tests for validate_structure with segments (post-segmentation)."""

    def test_uses_stats_for_segmented_chapters(self, validator_strict):
        """Segmented chapters use pre-calculated stats."""
        mock_stats = MagicMock()
        mock_stats.total_chars = 150  # Exceeds 100 limit

        chapters = [
            make_chapter(
                "Long Chapter",
                segments=[{"id": "1", "type": "text", "content": "x" * 150}],
                stats=mock_stats
            )
        ]
        data = make_parsed_data(chapters)

        warnings = validator_strict.validate_structure(data)

        assert any(w.type == "chapter_too_long" for w in warnings)

    def test_empty_segments_warning(self, validator):
        """Empty segments array produces warning."""
        mock_stats = MagicMock()
        mock_stats.total_chars = 0

        chapters = [
            make_chapter("Empty", segments=[], stats=mock_stats)
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_structure(data)

        assert any(w.type == "empty_chapter" for w in warnings)


# ============================================================================
# Test: validate_global
# ============================================================================

class TestValidateGlobal:
    """Tests for validate_global method."""

    def test_no_chapters_critical(self, validator):
        """No chapters produces critical warning."""
        data = make_parsed_data([])

        warnings = validator.validate_global(data)

        assert len(warnings) == 1
        assert warnings[0].type == "no_chapters"
        assert warnings[0].severity == "critical"

    def test_duplicate_chapter_names_warning(self, validator):
        """Duplicate chapter names produce warning."""
        chapters = [
            make_chapter("Same Name", content_blocks=[{"type": "text", "content": "A"}]),
            make_chapter("Same Name", content_blocks=[{"type": "text", "content": "B"}]),
            make_chapter("Different", content_blocks=[{"type": "text", "content": "C"}])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_global(data)

        assert len(warnings) == 1
        assert warnings[0].type == "duplicate_chapters"
        assert "Same Name" in warnings[0].message

    def test_multiple_duplicates(self, validator):
        """Multiple duplicate groups are all reported."""
        chapters = [
            make_chapter("Name A", content_blocks=[{"type": "text", "content": "1"}]),
            make_chapter("Name A", content_blocks=[{"type": "text", "content": "2"}]),
            make_chapter("Name B", content_blocks=[{"type": "text", "content": "3"}]),
            make_chapter("Name B", content_blocks=[{"type": "text", "content": "4"}])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_global(data)

        assert len(warnings) == 1
        assert "Name A" in warnings[0].message
        assert "Name B" in warnings[0].message

    def test_unique_chapters_no_warning(self, validator):
        """Unique chapter names produce no warning."""
        chapters = [
            make_chapter("Chapter 1", content_blocks=[{"type": "text", "content": "A"}]),
            make_chapter("Chapter 2", content_blocks=[{"type": "text", "content": "B"}]),
            make_chapter("Chapter 3", content_blocks=[{"type": "text", "content": "C"}])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_global(data)

        assert len(warnings) == 0


# ============================================================================
# Test: validate_all
# ============================================================================

class TestValidateAll:
    """Tests for validate_all method."""

    def test_combines_global_and_structure_warnings(self, validator_strict):
        """All warnings from both validators are returned."""
        chapters = [
            make_chapter("Dup", content_blocks=[{"type": "text", "content": "A" * 150}]),
            make_chapter("Dup", content_blocks=[])  # Empty + duplicate
        ]
        data = make_parsed_data(chapters)

        warnings = validator_strict.validate_all(data)

        types = [w.type for w in warnings]
        assert "duplicate_chapters" in types  # From global
        assert "chapter_too_long" in types    # From structure
        assert "empty_chapter" in types       # From structure

    def test_no_warnings_for_valid_data(self, validator):
        """Valid data produces no warnings."""
        chapters = [
            make_chapter("Chapter 1", content_blocks=[
                {"type": "text", "content": "Valid content here."}
            ]),
            make_chapter("Chapter 2", content_blocks=[
                {"type": "text", "content": "More valid content."}
            ])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_all(data)

        assert len(warnings) == 0

    def test_stops_on_critical_no_chapters(self, validator):
        """Critical 'no_chapters' prevents structure validation."""
        data = make_parsed_data([])

        warnings = validator.validate_all(data)

        # Should only have the critical warning, not attempt structure validation
        assert len(warnings) == 1
        assert warnings[0].type == "no_chapters"


# ============================================================================
# Test: Custom Limits
# ============================================================================

class TestCustomLimits:
    """Tests for custom limit configuration."""

    def test_custom_max_chapter_length(self):
        """Custom max_chapter_length is respected."""
        validator = ImportValidator(max_chapter_length=20, max_segment_length=500)

        chapters = [
            make_chapter("Chapter", content_blocks=[
                {"type": "text", "content": "A" * 25}  # Exceeds 20
            ])
        ]
        data = make_parsed_data(chapters)

        warnings = validator.validate_structure(data)

        assert any(w.type == "chapter_too_long" for w in warnings)

    def test_defaults_from_config(self):
        """Defaults are loaded from config when not specified."""
        with patch('config.IMPORT_MAX_CHAPTER_LENGTH', 12345):
            with patch('config.IMPORT_MAX_SEGMENT_LENGTH', 67890):
                validator = ImportValidator()

                assert validator.max_chapter_length == 12345
                assert validator.max_segment_length == 67890
