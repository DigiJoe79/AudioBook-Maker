"""
Markdown Parser for Project Import

Parses markdown files into audiobook project structure:
-
-
-
- *** → Divider marker
- Text → Chapter content (to be segmented)
"""

from typing import List, Dict, Any
import re
from loguru import logger


class MarkdownParser:
    """Parse markdown files into project structure"""

    @staticmethod
    def parse(md_content: str) -> Dict[str, Any]:
        """
        Parse markdown content into structured format

        Args:
            md_content: Raw markdown file content

        Returns:
            {
                "project_title": str,
                "project_description": str,
                "chapters": [
                    {
                        "title": str,
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
            ValueError: If required structure is missing (no
        """
        lines = md_content.split('\n')

        project_title = None
        project_description = ""
        chapters = []
        current_chapter = None
        current_text_block = []

        i = 0
        while i < len(lines):
            line = lines[i].strip()

            if not line:
                if current_text_block or (current_chapter and current_chapter['content_blocks']):
                    current_text_block.append('')
                i += 1
                continue

            if line.startswith('# ') and not project_title:
                project_title = line[2:].strip()
                logger.debug(f"Found project title: {project_title}")

                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line and not next_line.startswith('#'):
                        project_description = next_line
                        logger.debug(f"Found project description: {project_description}")
                        i += 1
                i += 1
                continue

            if line.startswith('## '):
                logger.debug(f"Ignoring heading 2: {line[3:]}")
                i += 1
                continue

            if line.startswith('### '):
                if current_chapter:
                    MarkdownParser._finalize_text_block(current_chapter, current_text_block)
                    chapters.append(current_chapter)
                    current_text_block = []

                raw_title = line[4:].strip()
                chapter_title = MarkdownParser._clean_chapter_title(raw_title)

                logger.debug(f"Found chapter: '{raw_title}' → '{chapter_title}'")

                current_chapter = {
                    "title": chapter_title,
                    "order_index": len(chapters),
                    "content_blocks": []
                }
                i += 1
                continue

            if re.match(r'^\*\s*\*\s*\*\s*$', line):
                if current_chapter:
                    MarkdownParser._finalize_text_block(current_chapter, current_text_block)
                    current_text_block = []

                    current_chapter['content_blocks'].append({"type": "divider"})
                    logger.debug(f"Found divider in chapter '{current_chapter['title']}'")
                i += 1
                continue

            if current_chapter:
                current_text_block.append(line)

            i += 1

        if current_chapter:
            MarkdownParser._finalize_text_block(current_chapter, current_text_block)
            chapters.append(current_chapter)

        if not project_title:
            raise ValueError("No project title found (missing # heading)")

        if not chapters:
            raise ValueError("No chapters found (missing ### headings)")

        logger.info(
            f"Parsed markdown: Project '{project_title}', "
            f"{len(chapters)} chapters, "
            f"{sum(len(ch['content_blocks']) for ch in chapters)} content blocks"
        )

        return {
            "project_title": project_title,
            "project_description": project_description,
            "chapters": chapters
        }

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
        cleaned = re.sub(
            r'^(Chapter|Kapitel|Ch\.?)\s+\d+\s*:\s*',
            '',
            raw_title,
            flags=re.IGNORECASE
        )

        cleaned = re.sub(r'^\d+[\.\-\)\s]+', '', cleaned)

        return cleaned.strip()

    @staticmethod
    def _finalize_text_block(chapter: Dict, text_lines: List[str]):
        """Add accumulated text lines as content block"""
        if text_lines:
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
