"""
EPUB Import API Routes

These endpoints mirror the existing markdown import endpoints in import_routes.py
but accept an EPUB file. The EPUB is converted to markdown internally, then
the same MarkdownParser + ImportValidator pipeline is used.

Endpoints:

- POST /api/projects/import/epub/preview
- POST /api/projects/import/epub
"""

from __future__ import annotations

from typing import Optional
from datetime import datetime
import json
import sqlite3

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends

from loguru import logger

from models.response_models import (
    MappingRules,
    ImportPreviewResponse,
    ImportExecuteResponse,
    ChapterPreview,
    ImportStats,
)
from services.markdown_parser import MarkdownParser
from services.import_validator import ImportValidator
from services.epub_importer import EpubImporter
from db.database import get_db
from db.repositories import ProjectRepository, ChapterRepository, SegmentRepository
from services.settings_service import SettingsService
from core.tts_engine_manager import get_tts_engine_manager
from services.event_broadcaster import broadcaster, EventType


router = APIRouter(
    prefix="/api/projects/import/epub",
    tags=["import"],
)


@router.post("/preview", response_model=ImportPreviewResponse)
async def get_epub_import_preview(
    file: UploadFile = File(...),
    mapping_rules: str = Form(...),
    language: str = Form(default="en"),
    conn: sqlite3.Connection = Depends(get_db),
) -> ImportPreviewResponse:
    """
    Parse an EPUB file and return the same preview structure as the markdown import.

    Steps:
    1. Read EPUB bytes and convert to markdown using EpubImporter.
    2. Run MarkdownParser with segmentation using conservative engine limits.
    3. Run ImportValidator to get warnings and stats.
    """
    try:
        # Parse mapping rules
        rules_dict = json.loads(mapping_rules)
        rules = MappingRules(**rules_dict)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"[EPUB_IMPORT_INVALID_MAPPING_JSON]error:{str(e)}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="[EPUB_IMPORT_FILE_EMPTY]")

    logger.debug(f"Parsing EPUB file: {file.filename} ({len(content)} bytes)")

    # Convert EPUB to markdown
    try:
        importer = EpubImporter(language=language)
        book = importer.load_from_bytes(content)
        md_content = importer.to_markdown_document(book)
    except ValueError as ve:
        logger.error(f"EPUB parsing failed: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception(f"Unexpected EPUB parsing error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"[EPUB_IMPORT_PARSE_FAILED]error:{str(e)}",
        )

    # Get segmentation limits and divider duration from settings
    settings_service = SettingsService(conn)
    user_pref = settings_service.get_setting("text.preferredMaxSegmentLength") or 250
    default_divider_duration = (
        settings_service.get_setting("audio.defaultDividerDuration") or 2000
    )

    # Conservative engine max as in markdown preview
    conservative_engine_max = 250
    max_length = min(user_pref, conservative_engine_max)

    logger.debug(
        "EPUB preview segmentation limits - "
        f"User pref: {user_pref}, "
        f"Conservative engine max: {conservative_engine_max}, "
        f"Using max: {max_length}"
    )

    parser = MarkdownParser(rules)

    # Parse with segmentation
    try:
        parsed = await parser.parse_with_segmentation(
            md_content,
            language=language,
            max_segment_length=max_length,
            default_divider_duration=default_divider_duration,
        )
    except ValueError as ve:
        logger.error(f"Markdown parsing failed for EPUB: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Segmentation failed for EPUB preview: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"[EPUB_IMPORT_SEGMENTATION_FAILED]error:{str(e)}",
        )

    # Validate and get warnings
    validator = ImportValidator()
    chapter_warnings = validator.validate_structure(parsed)
    global_warnings = validator.validate_global(parsed)

    # Map per chapter warnings
    chapter_warning_map = {}
    for warning in chapter_warnings:
        for chapter in parsed["chapters"]:
            if chapter["title"] in warning.message:
                chapter_warning_map.setdefault(chapter["title"], []).append(warning)

    # Build chapter preview objects
    chapter_previews = []
    for chapter in parsed["chapters"]:
        chapter_previews.append(
            ChapterPreview(
                id=f"temp-epub-ch-{chapter['order_index']}",
                title=chapter["title"],
                original_title=chapter["original_title"],
                order_index=chapter["order_index"],
                stats=chapter["stats"],
                warnings=chapter_warning_map.get(chapter["title"], []),
            )
        )

    # Overall stats
    total_segments = sum(ch["stats"].segment_count for ch in parsed["chapters"])
    total_chars = sum(ch["stats"].total_chars for ch in parsed["chapters"])

    words = total_chars / 5
    minutes = words / 150
    estimated_duration = f"~{int(minutes)}min" if minutes >= 1 else "<1min"

    stats = ImportStats(
        total_chapters=len(parsed["chapters"]),
        total_segments=total_segments,
        total_chars=total_chars,
        estimated_duration=estimated_duration,
    )

    is_valid = not any(w.severity == "critical" for w in global_warnings)

    logger.success(
        "EPUB preview generated: "
        f"{stats.total_chapters} chapters, "
        f"{stats.total_segments} segments, "
        f"{len(global_warnings)} warnings"
    )

    # Broadcast preview completion as a normal import event
    await broadcaster.broadcast_import_update(
        import_data={
            "importId": f"epub-preview-{datetime.now().timestamp()}",
            "status": "completed",
            "message": (
                f"EPUB preview: {stats.total_chapters} chapters, "
                f"{stats.total_segments} segments"
            ),
            "chapterCount": stats.total_chapters,
            "segmentCount": stats.total_segments,
        },
        event_type=EventType.IMPORT_PROGRESS,
    )

    return ImportPreviewResponse(
        is_valid=is_valid,
        project=parsed["project"],
        chapters=chapter_previews,
        global_warnings=global_warnings,
        stats=stats,
    )


@router.post("", response_model=ImportExecuteResponse)
async def execute_epub_import(
    file: UploadFile = File(...),
    mapping_rules: str = Form(...),
    language: str = Form(default="en"),
    mode: str = Form(...),
    merge_target_id: Optional[str] = Form(None),
    selected_chapters: str = Form(default="[]"),
    renamed_chapters: str = Form(default="{}"),
    tts_engine: str = Form(...),
    tts_model_name: str = Form(...),
    tts_language: str = Form(...),
    tts_speaker_name: Optional[str] = Form(None),
    conn: sqlite3.Connection = Depends(get_db),
) -> ImportExecuteResponse:
    """
    Execute an EPUB import by converting to markdown and running the same
    import pipeline as markdown imports.

    Args mirror the markdown /api/projects/import endpoint for consistency.
    """
    # Parse form JSON parameters
    try:
        rules_dict = json.loads(mapping_rules)
        rules = MappingRules(**rules_dict)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"[EPUB_IMPORT_INVALID_MAPPING_JSON]error:{str(e)}",
        )

    try:
        selected_chapters_list = json.loads(selected_chapters)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"[EPUB_IMPORT_INVALID_CHAPTERS_JSON]error:{str(e)}",
        )

    try:
        renamed_chapters_dict = json.loads(renamed_chapters)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"[EPUB_IMPORT_INVALID_RENAMED_JSON]error:{str(e)}",
        )

    if mode not in ["new", "merge"]:
        raise HTTPException(
            status_code=400,
            detail=f"[EPUB_IMPORT_INVALID_MODE]mode:{mode}",
        )

    if mode == "merge" and not merge_target_id:
        raise HTTPException(
            status_code=400,
            detail="[EPUB_IMPORT_MISSING_TARGET_ID]",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="[EPUB_IMPORT_FILE_EMPTY]")

    logger.info(
        "Executing EPUB import: "
        f"mode={mode}, file={file.filename}, language={language}"
    )

    # Unique import ID for SSE
    import_id = f"epub-import-{datetime.now().timestamp()}"

    await broadcaster.broadcast_import_update(
        import_data={
            "importId": import_id,
            "status": "running",
            "progress": 0.0,
            "message": "Starting EPUB import...",
        },
        event_type=EventType.IMPORT_STARTED,
    )

    # Convert EPUB to markdown
    try:
        importer = EpubImporter(language=language)
        book = importer.load_from_bytes(content)
        md_content = importer.to_markdown_document(book)
    except ValueError as ve:
        logger.error(f"EPUB parsing failed during import: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception(f"Unexpected EPUB parsing error during import: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"[EPUB_IMPORT_PARSE_FAILED]error:{str(e)}",
        )

    # Engine constraints and settings
    settings_service = SettingsService(conn)
    tts_manager = get_tts_engine_manager()

    if tts_engine not in tts_manager.list_available_engines():
        raise HTTPException(
            status_code=400,
            detail=f"[EPUB_IMPORT_UNKNOWN_ENGINE]engine:{tts_engine}",
        )

    metadata = tts_manager._engine_metadata[tts_engine]
    constraints = metadata.get("constraints", {})
    engine_max = constraints.get("max_text_length", 500)

    user_pref = settings_service.get_setting("text.preferredMaxSegmentLength") or 250
    default_divider_duration = (
        settings_service.get_setting("audio.defaultDividerDuration") or 2000
    )

    max_length = min(user_pref, engine_max)

    logger.debug(
        "EPUB import segmentation limits - "
        f"User pref: {user_pref}, "
        f"Engine max: {engine_max}, "
        f"Using: {max_length}"
    )

    parser = MarkdownParser(rules)

    # Parse markdown with segmentation
    try:
        parsed = await parser.parse_with_segmentation(
            md_content,
            language=language,
            max_segment_length=max_length,
            default_divider_duration=default_divider_duration,
        )
    except ValueError as ve:
        logger.error(f"Markdown parsing failed during EPUB import: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Segmentation failed during EPUB import: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"[EPUB_IMPORT_SEGMENTATION_FAILED]error:{str(e)}",
        )

    # Repositories
    project_repo = ProjectRepository(conn)
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    # Resolve project for new vs merge
    if mode == "new":
        project = project_repo.create(
            title=parsed["project"]["title"],
            description=parsed["project"]["description"],
        )
        logger.info(f"Created new project from EPUB: {project['id']} - {project['title']}")

        await broadcaster.broadcast_import_update(
            import_data={
                "importId": import_id,
                "projectId": project["id"],
                "status": "running",
                "progress": 0.3,
                "message": "Project created, importing EPUB chapters...",
            },
            event_type=EventType.IMPORT_PROGRESS,
        )
    else:
        project = project_repo.get_by_id(merge_target_id)
        if project is None:
            raise HTTPException(
                status_code=404,
                detail="[EPUB_IMPORT_TARGET_NOT_FOUND]",
            )

    # Filter chapters based on selection
    # Note: selected_chapters_list contains chapter IDs (e.g., "temp-epub-ch-0", "temp-epub-ch-1")
    # We need to map these back to chapters using order_index
    chapters_to_import = parsed["chapters"]
    if selected_chapters_list:
        # Extract chapter indices from IDs (e.g., "temp-epub-ch-0" -> 0)
        selected_indices = set()
        for chapter_id in selected_chapters_list:
            if chapter_id.startswith("temp-epub-ch-"):
                try:
                    index = int(chapter_id.replace("temp-epub-ch-", ""))
                    selected_indices.add(index)
                except ValueError:
                    pass

        chapters_to_import = [
            ch for ch in parsed["chapters"]
            if ch["order_index"] in selected_indices
        ]

        logger.debug(f"Filtered chapters: {len(chapters_to_import)}/{len(parsed['chapters'])}")

    # Track stats
    chapters_created = 0
    segments_created = 0

    for chapter_data in chapters_to_import:
        original_title = chapter_data["title"]

        new_title = renamed_chapters_dict.get(original_title, original_title)

        chapter = chapter_repo.create(
            project_id=project["id"],
            title=new_title,
            order_index=chapter_data["order_index"],
        )
        chapters_created += 1

        for seg_data in chapter_data["segments"]:
            if seg_data["type"] == "text":
                segment_status = "pending"
                spacy_status = seg_data.get("status", "ok")
                if spacy_status == "failed":
                    segment_status = "failed"

                segment_repo.create(
                    chapter_id=chapter["id"],
                    text=seg_data["content"],
                    order_index=seg_data["order_index"],
                    tts_engine=tts_engine,
                    tts_model_name=tts_model_name,
                    language=tts_language,
                    tts_speaker_name=tts_speaker_name,
                    segment_type='standard',
                    status=segment_status,
                )
                segments_created += 1
            elif seg_data["type"] == "divider":
                segment_repo.create(
                    chapter_id=chapter["id"],
                    text="",
                    order_index=seg_data["order_index"],
                    tts_engine=tts_engine,
                    tts_model_name=tts_model_name,
                    language=tts_language,
                    tts_speaker_name=tts_speaker_name,
                    segment_type='divider',
                    pause_duration=seg_data.get("pause_duration", 300),
                    status='completed',
                )
                segments_created += 1

    # Fetch complete project with chapters and segments for response
    project_complete = project_repo.get_by_id(project['id'])
    chapters = chapter_repo.get_by_project(project['id'])

    # Build ProjectWithChaptersResponse
    chapters_with_segments = []
    for chapter in chapters:
        segments = segment_repo.get_by_chapter(chapter['id'])
        chapter_copy = dict(chapter)
        chapter_copy['segments'] = segments
        chapters_with_segments.append(chapter_copy)

    project_complete['chapters'] = chapters_with_segments

    await broadcaster.broadcast_import_update(
        import_data={
            "importId": import_id,
            "projectId": project["id"],
            "status": "completed",
            "progress": 1.0,
            "message": (
                f"EPUB import completed: {chapters_created} chapters, "
                f"{segments_created} segments"
            ),
            "chapterCount": chapters_created,
            "segmentCount": segments_created,
        },
        event_type=EventType.IMPORT_COMPLETED,
    )

    logger.success(
        f"EPUB import completed for project {project['id']}: "
        f"{chapters_created} chapters, {segments_created} segments"
    )

    return ImportExecuteResponse(
        project=project_complete,
        chapters_created=chapters_created,
        segments_created=segments_created,
    )
