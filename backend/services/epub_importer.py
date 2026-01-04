"""
EPUB Importer

Converts an uploaded EPUB file into a Markdown string that matches the
Markdown import pipeline (projects, chapters, segments).

Design goals:
- Reuse the existing MarkdownParser and ImportValidator as-is
- Produce clean chapter headings and body text
- Skip obvious front matter such as covers and very short boilerplate pages
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import List

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import markdownify
from loguru import logger

from core.exceptions import ApplicationError


@dataclass
class EpubChapter:
    title: str
    text_markdown: str
    order_index: int


@dataclass
class EpubBook:
    title: str
    description: str
    chapters: List[EpubChapter]


class EpubImporter:
    """
    Lightweight EPUB importer that converts EPUB to a Markdown document
    suitable for the existing Markdown import pipeline.

    It does not touch the database. It only parses bytes -> EpubBook -> markdown.
    """

    def __init__(self, language: str = "en"):
        self.language = language

    def load_from_bytes(self, data: bytes) -> EpubBook:
        """
        Parse EPUB bytes and build an EpubBook structure.
        """
        if not data:
            raise ApplicationError("EPUB_IMPORT_FILE_EMPTY", status_code=400)

        logger.debug(
            "EPUB parsing phase: START",
            file_size_bytes=len(data)
        )
        book = epub.read_epub(io.BytesIO(data))
        logger.debug("EPUB parsing phase: ZIP extraction complete")

        # Get book title
        meta_title = book.get_metadata("DC", "title")
        if meta_title and len(meta_title) > 0:
            title = meta_title[0][0]
            logger.debug("EPUB metadata: title extracted", title=title)
        else:
            title = "Untitled Book"
            logger.debug("EPUB metadata: no title found, using default")

        # Best-effort description (optional)
        meta_desc = book.get_metadata("DC", "description")
        if meta_desc and len(meta_desc) > 0:
            description = meta_desc[0][0]
            logger.debug(
                "EPUB metadata: description extracted",
                description_length=len(description)
            )
        else:
            description = ""
            logger.debug("EPUB metadata: no description found")

        chapters: List[EpubChapter] = []
        document_items = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))
        logger.debug(
            "EPUB parsing phase: document enumeration",
            document_count=len(document_items)
        )

        # Items of type DOCUMENT are the XHTML/HTML spine entries
        for idx, item in enumerate(document_items):
            html_bytes: bytes = item.get_content()
            html = html_bytes.decode("utf-8", errors="ignore")

            soup = BeautifulSoup(html, "html.parser")

            # Get a chapter title from any prominent heading
            heading = soup.find(["h1", "h2", "h3", "title"])
            if heading is not None:
                chapter_title = heading.get_text(" ", strip=True)
                logger.debug(
                    "HTML to markdown: heading found",
                    item_index=idx,
                    heading_tag=heading.name,
                    title=chapter_title
                )
            else:
                chapter_title = f"Chapter {idx + 1}"
                logger.debug(
                    "HTML to markdown: no heading, using fallback",
                    item_index=idx,
                    fallback_title=chapter_title
                )

            # Convert body HTML to markdown
            body = soup.body if soup.body is not None else soup
            html_length = len(str(body))
            body_md = markdownify.markdownify(
                str(body),
                heading_style="ATX",  # Use '#' headings
                strip=["style", "script"]
            )

            # Clean up markdown text a bit
            text_md = self._normalize_markdown(body_md)
            logger.debug(
                "HTML to markdown: conversion complete",
                item_index=idx,
                html_length=html_length,
                markdown_length=len(text_md)
            )

            # Heuristic: skip very short or obviously front matter pages
            if self._looks_like_front_matter(chapter_title, text_md, idx):
                logger.debug(
                    "EPUB parsing phase: skipping front matter",
                    item_index=idx,
                    title=chapter_title,
                    text_length=len(text_md)
                )
                continue

            chapters.append(
                EpubChapter(
                    title=chapter_title,
                    text_markdown=text_md,
                    order_index=len(chapters) + 1,
                )
            )

        if not chapters:
            raise ApplicationError("EPUB_IMPORT_NO_CHAPTERS", status_code=400)

        logger.debug(
            "EPUB parsing phase: COMPLETE",
            chapters_extracted=len(chapters),
            documents_processed=len(document_items)
        )
        logger.info(f"Parsed EPUB: '{title}' with {len(chapters)} chapters")
        return EpubBook(
            title=title,
            description=description,
            chapters=chapters,
        )

    def _normalize_markdown(self, text: str) -> str:
        """
        Basic cleanup for markdown output:
        - Strip leading/trailing whitespace
        - Collapse runs of blank lines
        """
        lines = [line.rstrip() for line in text.splitlines()]

        cleaned: List[str] = []
        blank_run = 0
        for line in lines:
            if line.strip() == "":
                blank_run += 1
                # Allow at most one consecutive blank line
                if blank_run > 1:
                    continue
            else:
                blank_run = 0
            cleaned.append(line)

        result = "\n".join(cleaned).strip()
        return result

    def _looks_like_front_matter(self, title: str, text: str, index: int) -> bool:
        """
        Heuristics to skip obvious non-content:
        - Very short pages
        - Titles like "Cover", "Table of Contents", "Copyright"
        """
        title_lower = title.lower()

        if index == 0 and any(
            key in title_lower
            for key in ["cover", "title page"]
        ):
            return True

        if any(
            key in title_lower
            for key in ["table of contents", "contents", "copyright"]
        ):
            return True

        # Skip extremely short pages that are unlikely to be real content
        if len(text.strip()) < 200:
            return True

        return False

    def to_markdown_document(self, book: EpubBook) -> str:
        """
        Render an EpubBook as one Markdown document with:
        - H1 heading for the project title
        - H2 headings for chapters
        - Chapter bodies in plain markdown underneath

        This matches the expectations of the existing MarkdownParser,
        which looks for a project heading plus chapter headings.
        """
        lines: List[str] = []

        # Project title as level 1 heading
        lines.append(f"# {book.title}")
        lines.append("")

        if book.description:
            lines.append(book.description.strip())
            lines.append("")

        for chapter in book.chapters:
            lines.append(f"## {chapter.title}")
            lines.append("")
            lines.append(chapter.text_markdown.strip())
            lines.append("")

        return "\n".join(lines).strip()
