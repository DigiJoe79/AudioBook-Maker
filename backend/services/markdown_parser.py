"""
Markdown Parser for Project Import

Parser with configurable mapping rules and text engine integration.

Features:
- Configurable heading levels (# → Project, ### → Chapter, etc.)
- Configurable divider patterns (***, ---, ___, etc.)
- Accurate segment counting via text processing engine
- Validation and warnings
- Support for merge into existing projects
"""

from typing import List, Dict, Any
import re
from loguru import logger
from models.response_models import MappingRules
from core.text_engine_manager import get_text_engine_manager


class MarkdownParser:
    """Parse markdown files with configurable rules"""

    def __init__(self, mapping_rules: MappingRules):
        self.project_heading = mapping_rules.project_heading
        self.chapter_heading = mapping_rules.chapter_heading
        self.divider_pattern = mapping_rules.divider_pattern

    def parse(self, md_content: str) -> Dict[str, Any]:
        """
        Parse markdown content into structured format

        Args:
            md_content: Raw markdown file content

        Returns:
            {
                "project": {"title": str, "description": str},
                "chapters": [
                    {
                        "title": str,
                        "original_title": str,
                        "order_index": int,
                        "content_blocks": [
                            {"type": "text", "content": str},
                            {"type": "divider"},
                            ...
                        ]
                    }
                ]
            }

        Raises:
            ValueError: If required structure is missing (no project title or chapters)
        """
        lines = md_content.split('\n')

        project_title = None
        project_description = ""
        chapters = []
        current_chapter = None
        current_text_block = []

        # Create regex patterns from mapping rules
        project_pattern = re.escape(self.project_heading) + r'\s+'
        chapter_pattern = re.escape(self.chapter_heading) + r'\s+'
        divider_regex = self._create_divider_regex(self.divider_pattern)

        i = 0
        while i < len(lines):
            line = lines[i].strip()

            # Skip empty lines (but collect them in text blocks)
            if not line:
                if current_text_block or (current_chapter and current_chapter['content_blocks']):
                    current_text_block.append('')
                i += 1
                continue

            # Project title
            if re.match(f'^{project_pattern}', line) and not project_title:
                project_title = re.sub(f'^{project_pattern}', '', line).strip()
                logger.debug(f"Found project title: {project_title}")

                # Check next line for description
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line and not re.match(r'^#{1,6}\s', next_line):
                        project_description = next_line
                        logger.debug(f"Found project description: {project_description}")
                        i += 1  # Skip description line
                i += 1
                continue

            # Chapter
            if re.match(f'^{chapter_pattern}', line):
                # Save previous chapter if exists
                if current_chapter:
                    self._finalize_text_block(current_chapter, current_text_block)
                    chapters.append(current_chapter)
                    current_text_block = []

                # Extract chapter title (remove numbering)
                raw_title = re.sub(f'^{chapter_pattern}', '', line).strip()
                chapter_title = self._clean_chapter_title(raw_title)

                logger.debug(f"Found chapter: '{raw_title}' → '{chapter_title}'")

                current_chapter = {
                    "title": chapter_title,
                    "original_title": raw_title,
                    "order_index": len(chapters),
                    "content_blocks": []
                }
                i += 1
                continue

            # Divider
            if divider_regex.match(line):
                if current_chapter:
                    # Finalize current text block
                    self._finalize_text_block(current_chapter, current_text_block)
                    current_text_block = []

                    # Add divider
                    current_chapter['content_blocks'].append({"type": "divider"})
                    logger.debug(f"Found divider in chapter '{current_chapter['title']}'")
                i += 1
                continue

            # Regular text line
            if current_chapter:
                current_text_block.append(line)

            i += 1

        # Finalize last chapter
        if current_chapter:
            self._finalize_text_block(current_chapter, current_text_block)
            chapters.append(current_chapter)

        # Validation
        if not project_title:
            raise ValueError(
                f"[IMPORT_NO_PROJECT_TITLE]projectHeading:{self.project_heading}"
            )

        if not chapters:
            raise ValueError(
                f"[IMPORT_NO_CHAPTERS]projectHeading:{self.project_heading};chapterHeading:{self.chapter_heading}"
            )

        logger.info(
            f"Parsed markdown: Project '{project_title}', "
            f"{len(chapters)} chapters, "
            f"{sum(len(ch['content_blocks']) for ch in chapters)} content blocks"
        )

        return {
            "project": {
                "title": project_title,
                "description": project_description
            },
            "chapters": chapters
        }

    async def parse_with_segmentation(
        self,
        md_content: str,
        language: str = "en",
        text_engine: str = "",  # Empty = use default from settings
        max_segment_length: int = 500,
        default_divider_duration: int = 2000
    ) -> Dict[str, Any]:
        """
        Parse markdown and segment text blocks using configured text engine

        Args:
            md_content: Raw markdown content
            language: Language code for text processing (default: en)
            text_engine: Text engine name (empty = use default from settings)
            max_segment_length: Maximum segment length (default: 500)
            default_divider_duration: Default pause duration for dividers in ms (default: 2000)

        Returns:
            Same structure as parse(), but with:
            - chapters[].segments instead of content_blocks
            - chapters[].stats with accurate counts
        """
        # First, parse structure
        parsed = self.parse(md_content)

        # Get text engine manager
        text_manager = get_text_engine_manager()

        # Resolve engine name: parameter > settings > first available
        engine_name = text_engine
        if not engine_name:
            from db.database import get_db_connection
            from services.settings_service import SettingsService
            with get_db_connection() as conn:
                settings_service = SettingsService(conn)
                engine_name = settings_service.get_default_engine('text') or ""

        if not engine_name:
            installed = text_manager.list_installed_engines()
            if installed:
                engine_name = installed[0]

        if not engine_name:
            raise ValueError("No text processing engine available")

        # Ensure engine is ready
        await text_manager.ensure_engine_ready(engine_name, language)

        # Process each chapter
        for chapter in parsed["chapters"]:
            segments = []
            segment_id_counter = 0
            total_chars = 0
            divider_count = 0
            failed_count = 0  # Track failed segments

            # Process each content block
            for block in chapter["content_blocks"]:
                if block["type"] == "text":
                    # Segment text via TextEngineManager
                    # This guarantees no mid-sentence splits (respects sentence boundaries)
                    segment_response = await text_manager.segment_with_engine(
                        engine_name=engine_name,
                        text=block["content"],
                        language=language,
                        parameters={'max_length': max_segment_length}
                    )

                    # Convert response format from text engine to expected format
                    # Text engine returns: [{"text": str, "start": int, "end": int}, ...]
                    # We need: [{"text": str, "order_index": int, "status": str, ...}, ...]
                    text_segment_dicts = []
                    for idx, seg in enumerate(segment_response.get('segments', [])):
                        seg_text = seg.get('text', '')
                        seg_length = len(seg_text)

                        # Check if segment exceeds max_length (mark as failed)
                        if seg_length > max_segment_length:
                            text_segment_dicts.append({
                                "text": seg_text,
                                "order_index": idx,
                                "status": "failed",
                                "length": seg_length,
                                "max_length": max_segment_length,
                                "issue": "sentence_too_long"
                            })
                        else:
                            text_segment_dicts.append({
                                "text": seg_text,
                                "order_index": idx,
                                "status": "ok"
                            })

                    for seg_dict in text_segment_dicts:
                        text = seg_dict["text"]
                        status = seg_dict.get("status", "ok")  # Get status from text engine

                        segments.append({
                            "id": f"temp-seg-{chapter['order_index']}-{segment_id_counter}",
                            "type": "text",
                            "content": text,
                            "char_count": len(text),
                            "order_index": segment_id_counter,
                            "status": status,  # Preserve text engine status (ok/failed)
                            # Include metadata if failed
                            "length": seg_dict.get("length") if status == "failed" else None,
                            "max_length": seg_dict.get("max_length") if status == "failed" else None,
                            "issue": seg_dict.get("issue") if status == "failed" else None
                        })
                        total_chars += len(text)
                        segment_id_counter += 1

                        # Track and log failed segments
                        if status == "failed":
                            failed_count += 1
                            logger.info(
                                f"Chapter '{chapter['title']}' segment {segment_id_counter-1}: "
                                f"Single sentence exceeds max_length "
                                f"({seg_dict.get('length')}/{seg_dict.get('max_length')} chars)"
                            )

                elif block["type"] == "divider":
                    segments.append({
                        "id": f"temp-div-{chapter['order_index']}-{segment_id_counter}",
                        "type": "divider",
                        "pause_duration": default_divider_duration,
                        "order_index": segment_id_counter
                    })
                    divider_count += 1
                    segment_id_counter += 1

            # Replace content_blocks with segments
            chapter["segments"] = segments
            del chapter["content_blocks"]

            # Add stats (snake_case, auto-converts to camelCase via ChapterStats model)
            from models.response_models import ChapterStats
            chapter["stats"] = ChapterStats(
                segment_count=len(segments),
                total_chars=total_chars,
                divider_count=divider_count,
                failed_count=failed_count
            )

        logger.info(
            f"Segmented {len(parsed['chapters'])} chapters: "
            f"{sum(ch['stats'].segment_count for ch in parsed['chapters'])} total segments"
        )

        return parsed

    @staticmethod
    def _clean_chapter_title(raw_title: str) -> str:
        """
        Remove chapter numbering from title

        Examples:
            "Chapter 1: This is the Name" → "This is the Name"
            "Kapitel 1: This is the Name" → "This is the Name"
            "Ch. 1: This is the Name" → "This is the Name"
            "1. This is the Name" → "This is the Name"
            "1 - This is the Name" → "This is the Name"
            "This is the Name" → "This is the Name"
        """
        # Remove patterns like "Chapter 1:", "Kapitel 1:", "Ch. 1:", etc.
        cleaned = re.sub(
            r'^(Chapter|Kapitel|Ch\.?)\s+\d+\s*:\s*',
            '',
            raw_title,
            flags=re.IGNORECASE
        )

        # Remove patterns like "1.", "1 -", "1)", etc.
        cleaned = re.sub(r'^\d+[\.\-\)\s]+', '', cleaned)

        return cleaned.strip()

    @staticmethod
    def _finalize_text_block(chapter: Dict, text_lines: List[str]):
        """Add accumulated text lines as content block"""
        if text_lines:
            # Join lines and trim whitespace
            text = '\n'.join(text_lines).strip()
            if text:
                chapter['content_blocks'].append({
                    "type": "text",
                    "content": text
                })
                logger.debug(
                    f"Added text block to chapter '{chapter['title']}': "
                    f"{len(text)} characters"
                )

    @staticmethod
    def _create_divider_regex(pattern: str) -> re.Pattern:
        """
        Create regex pattern for divider matching

        Supports:
        - *** (with optional spaces: * * *)
        - --- (with optional spaces: - - -)
        - ___ (with optional spaces: _ _ _)
        """
        if pattern == "***":
            return re.compile(r'^\*\s*\*\s*\*\s*$')
        elif pattern == "---":
            return re.compile(r'^-\s*-\s*-\s*$')
        elif pattern == "___":
            return re.compile(r'^_\s*_\s*_\s*$')
        else:
            # Fallback: escape pattern and allow spaces
            escaped = re.escape(pattern[0])
            return re.compile(f'^{escaped}\\s*{escaped}\\s*{escaped}\\s*$')
