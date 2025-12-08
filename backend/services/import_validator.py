"""
Import Validator for Markdown Import

Validates parsed markdown structure and generates warnings.

Warning Types:
- chapter_too_long: Chapter exceeds max character limit
- empty_chapter: Chapter has no content blocks
- special_chars_in_title: Chapter title contains problematic characters
- no_chapters: No chapters found (critical)
- duplicate_chapters: Multiple chapters with same name
"""

from typing import List, Dict, Any
import re
from loguru import logger
from models.response_models import ImportWarning


class ImportValidator:
    """Validate import structure and generate warnings"""

    def __init__(
        self,
        max_chapter_length: int = None,
        max_segment_length: int = None
    ):
        from config import IMPORT_MAX_CHAPTER_LENGTH, IMPORT_MAX_SEGMENT_LENGTH
        self.max_chapter_length = max_chapter_length if max_chapter_length is not None else IMPORT_MAX_CHAPTER_LENGTH
        self.max_segment_length = max_segment_length if max_segment_length is not None else IMPORT_MAX_SEGMENT_LENGTH

    def validate_structure(self, parsed_data: Dict[str, Any]) -> List[ImportWarning]:
        """
        Validate chapter-level structure

        Works with both segmented data (segments) and non-segmented data (content_blocks)

        Returns list of warnings (severity: warning, info)
        """
        warnings = []

        for chapter in parsed_data["chapters"]:
            # Support both segmented and non-segmented data
            # After segmentation: chapter has "segments" and "stats"
            # Before segmentation: chapter has "content_blocks"
            if "segments" in chapter:
                # Use pre-calculated stats from segmentation
                total_chars = chapter["stats"].total_chars
                is_empty = len(chapter["segments"]) == 0
            else:
                # Calculate from content_blocks
                total_chars = sum(
                    len(block["content"])
                    for block in chapter.get("content_blocks", [])
                    if block["type"] == "text"
                )
                is_empty = not chapter.get("content_blocks", [])

            # Check chapter length
            if total_chars > self.max_chapter_length:
                warnings.append(ImportWarning(
                    type="chapter_too_long",
                    message=(
                        f"[IMPORT_CHAPTER_TOO_LONG]chapterTitle:{chapter['title']};"
                        f"charCount:{total_chars};maxChars:{self.max_chapter_length}"
                    ),
                    severity="warning"
                ))

            # Check for empty chapters
            if is_empty:
                warnings.append(ImportWarning(
                    type="empty_chapter",
                    message=f"Chapter '{chapter['title']}' has no content.",
                    severity="warning"
                ))

            # Check for special characters in title
            if re.search(r'[/\\#]', chapter['title']):
                warnings.append(ImportWarning(
                    type="special_chars_in_title",
                    message=(
                        f"Chapter '{chapter['title']}' contains special characters "
                        f"(/, \\, #) that may cause issues."
                    ),
                    severity="info"
                ))

        logger.debug(f"Structure validation: {len(warnings)} warnings")
        return warnings

    def validate_global(self, parsed_data: Dict[str, Any]) -> List[ImportWarning]:
        """
        Validate global structure (project-level)

        Returns list of warnings (severity: critical, warning)
        """
        warnings = []

        # Check if chapters exist
        if not parsed_data["chapters"]:
            warnings.append(ImportWarning(
                type="no_chapters",
                message="No chapters found in markdown file.",
                severity="critical"
            ))
            return warnings  # Critical error, no further validation

        # Check for duplicate chapter names
        chapter_titles = [ch["title"] for ch in parsed_data["chapters"]]
        duplicates = [title for title in set(chapter_titles) if chapter_titles.count(title) > 1]

        if duplicates:
            warnings.append(ImportWarning(
                type="duplicate_chapters",
                message=(
                    f"Duplicate chapter names found: {', '.join(duplicates)}. "
                    f"This may cause confusion."
                ),
                severity="warning"
            ))

        logger.debug(f"Global validation: {len(warnings)} warnings")
        return warnings

    def validate_all(self, parsed_data: Dict[str, Any]) -> List[ImportWarning]:
        """
        Run all validations and return combined warnings
        """
        warnings = []
        warnings.extend(self.validate_global(parsed_data))
        warnings.extend(self.validate_structure(parsed_data))

        logger.info(f"Total validation warnings: {len(warnings)}")
        return warnings
