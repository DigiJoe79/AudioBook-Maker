"""
Unit Tests for MarkdownParser

Tests the markdown parsing service for project import.
"""

import pytest
from unittest.mock import Mock, MagicMock, patch, AsyncMock

from services.markdown_parser import MarkdownParser
from models.response_models import MappingRules
from core.exceptions import ApplicationError


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def default_mapping_rules():
    """Default mapping rules for testing."""
    return MappingRules(
        project_heading="#",
        chapter_heading="##",
        divider_pattern="***"
    )


@pytest.fixture
def parser(default_mapping_rules):
    """Create MarkdownParser with default rules."""
    return MarkdownParser(default_mapping_rules)


# ============================================================================
# Test: parse - Basic Structure
# ============================================================================

class TestParseBasicStructure:
    """Tests for basic markdown parsing structure."""

    def test_parses_project_title_from_h1(self, parser):
        """H1 heading is parsed as project title."""
        md = """# My Test Project

## Chapter 1
Some text content.
"""
        result = parser.parse(md)

        assert result["project"]["title"] == "My Test Project"

    def test_parses_project_description(self, parser):
        """Line after project title is parsed as description."""
        md = """# My Test Project
This is the project description.

## Chapter 1
Some text content.
"""
        result = parser.parse(md)

        assert result["project"]["description"] == "This is the project description."

    def test_parses_chapters_from_h2(self, parser):
        """H2 headings are parsed as chapters."""
        md = """# My Project

## First Chapter
Content 1.

## Second Chapter
Content 2.
"""
        result = parser.parse(md)

        assert len(result["chapters"]) == 2
        assert result["chapters"][0]["title"] == "First Chapter"
        assert result["chapters"][1]["title"] == "Second Chapter"

    def test_chapter_order_index_increments(self, parser):
        """Chapter order_index starts at 0 and increments."""
        md = """# Project

## Chapter A
Text A.

## Chapter B
Text B.

## Chapter C
Text C.
"""
        result = parser.parse(md)

        assert result["chapters"][0]["order_index"] == 0
        assert result["chapters"][1]["order_index"] == 1
        assert result["chapters"][2]["order_index"] == 2

    def test_preserves_original_chapter_title(self, parser):
        """Original title is preserved even if cleaned."""
        md = """# Project

## Chapter 1: The Beginning
Text.
"""
        result = parser.parse(md)

        assert result["chapters"][0]["original_title"] == "Chapter 1: The Beginning"
        assert result["chapters"][0]["title"] == "The Beginning"


# ============================================================================
# Test: parse - Content Blocks
# ============================================================================

class TestParseContentBlocks:
    """Tests for content block parsing."""

    def test_parses_text_content_as_text_blocks(self, parser):
        """Text content becomes text content blocks."""
        md = """# Project

## Chapter 1
This is the first paragraph.

This is the second paragraph.
"""
        result = parser.parse(md)

        blocks = result["chapters"][0]["content_blocks"]
        assert len(blocks) == 1
        assert blocks[0]["type"] == "text"
        assert "first paragraph" in blocks[0]["content"]
        assert "second paragraph" in blocks[0]["content"]

    def test_parses_divider_pattern(self, parser):
        """Divider pattern creates divider content blocks."""
        md = """# Project

## Chapter 1
First section.

***

Second section.
"""
        result = parser.parse(md)

        blocks = result["chapters"][0]["content_blocks"]
        assert len(blocks) == 3
        assert blocks[0]["type"] == "text"
        assert blocks[1]["type"] == "divider"
        assert blocks[2]["type"] == "text"

    def test_divider_with_spaces(self, parser):
        """Divider pattern with spaces is recognized."""
        md = """# Project

## Chapter 1
Text before.

* * *

Text after.
"""
        result = parser.parse(md)

        blocks = result["chapters"][0]["content_blocks"]
        assert any(b["type"] == "divider" for b in blocks)

    def test_multiple_dividers(self, parser):
        """Multiple dividers in a chapter."""
        md = """# Project

## Chapter 1
Part 1.

***

Part 2.

***

Part 3.
"""
        result = parser.parse(md)

        blocks = result["chapters"][0]["content_blocks"]
        divider_count = sum(1 for b in blocks if b["type"] == "divider")
        assert divider_count == 2


# ============================================================================
# Test: parse - Validation Errors
# ============================================================================

class TestParseValidation:
    """Tests for validation errors."""

    def test_raises_for_missing_project_title(self, parser):
        """ApplicationError raised when project title is missing."""
        md = """## Chapter 1
Some text.
"""
        with pytest.raises(ApplicationError) as exc_info:
            parser.parse(md)

        assert exc_info.value.code == "IMPORT_NO_PROJECT_TITLE"

    def test_raises_for_no_chapters(self, parser):
        """ApplicationError raised when no chapters found."""
        md = """# My Project
Just a description without chapters.
"""
        with pytest.raises(ApplicationError) as exc_info:
            parser.parse(md)

        assert exc_info.value.code == "IMPORT_NO_CHAPTERS"

    def test_empty_content_raises_error(self, parser):
        """Empty content raises ApplicationError (no title found)."""
        with pytest.raises(ApplicationError) as exc_info:
            parser.parse("")
        assert exc_info.value.code == "IMPORT_NO_PROJECT_TITLE"


# ============================================================================
# Test: parse - Custom Mapping Rules
# ============================================================================

class TestParseCustomMappingRules:
    """Tests for custom mapping rules."""

    def test_h2_as_project_h3_as_chapter(self):
        """Custom rules: H2 for project, H3 for chapter."""
        rules = MappingRules(
            project_heading="##",
            chapter_heading="###",
            divider_pattern="---"
        )
        parser = MarkdownParser(rules)

        md = """## Book Title

### First Chapter
Text content.

---

More text.
"""
        result = parser.parse(md)

        assert result["project"]["title"] == "Book Title"
        assert len(result["chapters"]) == 1
        assert result["chapters"][0]["title"] == "First Chapter"
        # Verify --- divider is recognized
        blocks = result["chapters"][0]["content_blocks"]
        assert any(b["type"] == "divider" for b in blocks)

    def test_underscore_divider_pattern(self):
        """Custom underscore divider pattern."""
        rules = MappingRules(
            project_heading="#",
            chapter_heading="##",
            divider_pattern="___"
        )
        parser = MarkdownParser(rules)

        md = """# Project

## Chapter
Before.

___

After.
"""
        result = parser.parse(md)

        blocks = result["chapters"][0]["content_blocks"]
        assert any(b["type"] == "divider" for b in blocks)


# ============================================================================
# Test: _clean_chapter_title
# ============================================================================

class TestCleanChapterTitle:
    """Tests for chapter title cleaning."""

    def test_removes_chapter_number_prefix(self):
        """'Chapter X:' prefix is removed."""
        assert MarkdownParser._clean_chapter_title("Chapter 1: The Start") == "The Start"
        assert MarkdownParser._clean_chapter_title("Chapter 12: The Middle") == "The Middle"

    def test_removes_kapitel_prefix(self):
        """German 'Kapitel X:' prefix is removed."""
        assert MarkdownParser._clean_chapter_title("Kapitel 1: Der Anfang") == "Der Anfang"
        assert MarkdownParser._clean_chapter_title("Kapitel 99: Das Ende") == "Das Ende"

    def test_removes_ch_prefix(self):
        """'Ch. X:' prefix is removed."""
        assert MarkdownParser._clean_chapter_title("Ch. 1: Introduction") == "Introduction"
        assert MarkdownParser._clean_chapter_title("Ch 5: The Journey") == "The Journey"

    def test_removes_numeric_prefix_with_dot(self):
        """'X.' prefix is removed."""
        assert MarkdownParser._clean_chapter_title("1. The First") == "The First"
        assert MarkdownParser._clean_chapter_title("42. Answer") == "Answer"

    def test_removes_numeric_prefix_with_dash(self):
        """'X -' prefix is removed."""
        assert MarkdownParser._clean_chapter_title("1 - Beginning") == "Beginning"
        assert MarkdownParser._clean_chapter_title("10 - Continuation") == "Continuation"

    def test_preserves_plain_title(self):
        """Plain title without prefix is unchanged."""
        assert MarkdownParser._clean_chapter_title("Just a Title") == "Just a Title"
        assert MarkdownParser._clean_chapter_title("The End") == "The End"

    def test_case_insensitive(self):
        """Prefix removal is case insensitive."""
        assert MarkdownParser._clean_chapter_title("CHAPTER 1: Title") == "Title"
        assert MarkdownParser._clean_chapter_title("chapter 1: title") == "title"


# ============================================================================
# Test: _create_divider_regex
# ============================================================================

class TestCreateDividerRegex:
    """Tests for divider regex creation."""

    def test_asterisk_divider(self):
        """*** divider pattern."""
        regex = MarkdownParser._create_divider_regex("***")

        assert regex.match("***")
        assert regex.match("* * *")
        assert regex.match("*  *  *")
        assert not regex.match("**")
        assert not regex.match("text")

    def test_dash_divider(self):
        """--- divider pattern."""
        regex = MarkdownParser._create_divider_regex("---")

        assert regex.match("---")
        assert regex.match("- - -")
        assert not regex.match("--")

    def test_underscore_divider(self):
        """___ divider pattern."""
        regex = MarkdownParser._create_divider_regex("___")

        assert regex.match("___")
        assert regex.match("_ _ _")
        assert not regex.match("__")


# ============================================================================
# Test: parse_with_segmentation (requires mocking)
# ============================================================================

class TestParseWithSegmentation:
    """Tests for parse_with_segmentation method.

    Note: These tests mock the text engine manager to avoid requiring
    a running spaCy engine during unit tests.
    """

    @pytest.fixture
    def mock_db_and_settings(self):
        """Mock database connection and settings service."""
        mock_conn = MagicMock()
        mock_conn.__enter__ = Mock(return_value=mock_conn)
        mock_conn.__exit__ = Mock(return_value=None)

        mock_settings = MagicMock()
        mock_settings.get_default_engine.return_value = 'spacy:local'

        return mock_conn, mock_settings

    @pytest.mark.asyncio
    async def test_segments_text_blocks(self, parser, mock_db_and_settings):
        """Text blocks are segmented via text engine."""
        mock_conn, mock_settings = mock_db_and_settings

        md = """# Project

## Chapter 1
This is a sentence. This is another sentence.
"""

        # Mock text engine manager
        mock_manager = MagicMock()
        mock_manager.ensure_engine_ready = AsyncMock()
        mock_manager.segment_with_engine = AsyncMock(return_value={
            'segments': [
                {'text': 'This is a sentence.', 'start': 0, 'end': 19},
                {'text': 'This is another sentence.', 'start': 20, 'end': 45}
            ]
        })
        mock_manager.list_installed_engines = Mock(return_value=['spacy:local'])

        with patch('services.markdown_parser.get_text_engine_manager', return_value=mock_manager):
            with patch('db.database.get_db_connection', return_value=mock_conn):
                with patch('services.settings_service.SettingsService', return_value=mock_settings):
                    result = await parser.parse_with_segmentation(md)

        # Should have segments instead of content_blocks
        assert "segments" in result["chapters"][0]
        assert "content_blocks" not in result["chapters"][0]
        assert len(result["chapters"][0]["segments"]) == 2

    @pytest.mark.asyncio
    async def test_preserves_dividers_in_segments(self, parser, mock_db_and_settings):
        """Dividers are preserved as segment type."""
        mock_conn, mock_settings = mock_db_and_settings

        md = """# Project

## Chapter 1
Before divider.

***

After divider.
"""

        mock_manager = MagicMock()
        mock_manager.ensure_engine_ready = AsyncMock()
        mock_manager.segment_with_engine = AsyncMock(return_value={
            'segments': [{'text': 'Test.', 'start': 0, 'end': 5}]
        })
        mock_manager.list_installed_engines = Mock(return_value=['spacy:local'])

        with patch('services.markdown_parser.get_text_engine_manager', return_value=mock_manager):
            with patch('db.database.get_db_connection', return_value=mock_conn):
                with patch('services.settings_service.SettingsService', return_value=mock_settings):
                    result = await parser.parse_with_segmentation(md)

        segments = result["chapters"][0]["segments"]
        dividers = [s for s in segments if s["type"] == "divider"]
        assert len(dividers) == 1
        assert dividers[0]["pause_duration"] == 2000  # Default duration

    @pytest.mark.asyncio
    async def test_adds_chapter_stats(self, parser, mock_db_and_settings):
        """Chapter stats are calculated."""
        mock_conn, mock_settings = mock_db_and_settings

        md = """# Project

## Chapter 1
Text content here.
"""

        mock_manager = MagicMock()
        mock_manager.ensure_engine_ready = AsyncMock()
        mock_manager.segment_with_engine = AsyncMock(return_value={
            'segments': [
                {'text': 'Text content here.', 'start': 0, 'end': 18}
            ]
        })
        mock_manager.list_installed_engines = Mock(return_value=['spacy:local'])

        with patch('services.markdown_parser.get_text_engine_manager', return_value=mock_manager):
            with patch('db.database.get_db_connection', return_value=mock_conn):
                with patch('services.settings_service.SettingsService', return_value=mock_settings):
                    result = await parser.parse_with_segmentation(md)

        stats = result["chapters"][0]["stats"]
        assert stats.segment_count == 1
        assert stats.total_chars == 18

    @pytest.mark.asyncio
    async def test_marks_long_segments_as_failed(self, parser, mock_db_and_settings):
        """Segments exceeding max_length are marked as failed."""
        mock_conn, mock_settings = mock_db_and_settings

        md = """# Project

## Chapter 1
Very long text.
"""

        mock_manager = MagicMock()
        mock_manager.ensure_engine_ready = AsyncMock()
        # Return segment longer than max_length
        mock_manager.segment_with_engine = AsyncMock(return_value={
            'segments': [
                {'text': 'A' * 600, 'start': 0, 'end': 600}  # Exceeds 500 default
            ]
        })
        mock_manager.list_installed_engines = Mock(return_value=['spacy:local'])

        with patch('services.markdown_parser.get_text_engine_manager', return_value=mock_manager):
            with patch('db.database.get_db_connection', return_value=mock_conn):
                with patch('services.settings_service.SettingsService', return_value=mock_settings):
                    result = await parser.parse_with_segmentation(
                        md,
                        max_segment_length=500
                    )

        segment = result["chapters"][0]["segments"][0]
        assert segment["status"] == "failed"
        assert segment["issue"] == "sentence_too_long"

    @pytest.mark.asyncio
    async def test_raises_for_no_text_engine(self, parser, mock_db_and_settings):
        """ValueError raised when no text engine available."""
        mock_conn, _ = mock_db_and_settings
        mock_settings_no_engine = MagicMock()
        mock_settings_no_engine.get_default_engine.return_value = ""

        md = """# Project

## Chapter 1
Text.
"""

        mock_manager = MagicMock()
        mock_manager.list_installed_engines = Mock(return_value=[])  # No engines

        with patch('services.markdown_parser.get_text_engine_manager', return_value=mock_manager):
            with patch('db.database.get_db_connection', return_value=mock_conn):
                with patch('services.settings_service.SettingsService', return_value=mock_settings_no_engine):
                    with pytest.raises(ValueError, match="No text processing engine"):
                        await parser.parse_with_segmentation(md)
