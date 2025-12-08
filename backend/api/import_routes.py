"""
Import API Routes

Endpoints for markdown import preview and final import.
"""

from fastapi import APIRouter, UploadFile, File, Body, Form, HTTPException, Depends
from typing import Optional
import json
import sqlite3
from datetime import datetime

from models.response_models import (
    MappingRules,
    ImportPreviewResponse,
    ImportExecuteResponse,
    ChapterPreview,
    # SegmentPreview,  # Commented out - not used in preview anymore
    ImportStats
)
from services.markdown_parser import MarkdownParser
from services.import_validator import ImportValidator
from db.database import get_db
from db.repositories import ProjectRepository, ChapterRepository, SegmentRepository
from services.settings_service import SettingsService
from core.tts_engine_manager import get_tts_engine_manager
from services.event_broadcaster import broadcaster, EventType
from loguru import logger


router = APIRouter(prefix="/api/projects/import", tags=["import"])


@router.post("/preview", response_model=ImportPreviewResponse)
async def get_import_preview(
    file: UploadFile = File(...),
    mapping_rules: str = Body(...),  # JSON string
    language: str = Body(default="en"),
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Parse markdown file and return preview with validation

    Args:
        file: Markdown file (.md)
        mapping_rules: JSON string with mapping configuration
        language: Language code for spaCy segmentation (default: en)

    Returns:
        ImportPreviewResponse with parsed structure, segments, warnings, stats

    Raises:
        HTTPException 400: Invalid markdown structure or parsing error
    """
    try:
        # Parse mapping rules
        rules_dict = json.loads(mapping_rules)
        rules = MappingRules(**rules_dict)

        # Read file content
        content = await file.read()
        md_content = content.decode('utf-8')

        logger.debug(f"Parsing markdown file: {file.filename} ({len(md_content)} chars)")

        # Get segmentation limits and divider duration from settings
        settings_service = SettingsService(conn)
        user_pref = settings_service.get_setting('text.preferredMaxSegmentLength') or 250
        default_divider_duration = settings_service.get_setting('audio.defaultDividerDuration') or 2000

        # For preview, use conservative estimate (smallest common engine limit)
        # This prevents false positives in preview that don't appear in actual import
        # Common engine limits: XTTS=250, Chatterbox=300 → use 250 as safe default
        conservative_engine_max = 250
        max_length = min(user_pref, conservative_engine_max)

        logger.debug(
            f"Preview segmentation limits - User pref: {user_pref}, "
            f"Conservative engine max: {conservative_engine_max}, Using max: {max_length}"
        )

        # Parse with segmentation
        parser = MarkdownParser(rules)
        try:
            parsed = await parser.parse_with_segmentation(
                md_content,
                language=language,
                max_segment_length=max_length,
                default_divider_duration=default_divider_duration
            )
        except ValueError as ve:
            # Catch parsing/structure errors (missing headings, etc.)
            logger.error(f"Markdown parsing failed: {str(ve)}")
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            # Catch spaCy model loading errors or segmentation failures
            logger.error(f"Segmentation failed: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"[IMPORT_SEGMENTATION_FAILED]error:{str(e)}"
            )

        # Validate and get warnings
        validator = ImportValidator()  # Uses config defaults
        chapter_warnings = validator.validate_structure(parsed)
        global_warnings = validator.validate_global(parsed)

        # Assign warnings to chapters
        chapter_warning_map = {}
        for warning in chapter_warnings:
            # Extract chapter title from warning message
            for chapter in parsed["chapters"]:
                if chapter["title"] in warning.message:
                    if chapter["title"] not in chapter_warning_map:
                        chapter_warning_map[chapter["title"]] = []
                    chapter_warning_map[chapter["title"]].append(warning)

        # Build chapter preview objects
        chapter_previews = []
        for chapter in parsed["chapters"]:
            # Segments are generated internally but not sent to frontend for performance
            # Preview now shows only stats (segmentCount, totalChars, dividerCount, failedCount)
            # Uncomment below if detailed segment preview is needed in the future:
            # segment_previews = [
            #     SegmentPreview(
            #         id=seg["id"],
            #         type=seg["type"],
            #         content=seg.get("content"),
            #         char_count=seg.get("char_count"),
            #         pause_duration=seg.get("pause_duration"),
            #         order_index=seg["order_index"]
            #     )
            #     for seg in chapter["segments"]
            # ]

            chapter_previews.append(ChapterPreview(
                id=f"temp-ch-{chapter['order_index']}",
                title=chapter["title"],
                original_title=chapter["original_title"],
                order_index=chapter["order_index"],
                # segments=segment_previews,  # Commented out - only stats in preview
                stats=chapter["stats"],
                warnings=chapter_warning_map.get(chapter["title"], [])
            ))

        # Calculate overall stats
        total_segments = sum(ch["stats"].segment_count for ch in parsed["chapters"])
        total_chars = sum(ch["stats"].total_chars for ch in parsed["chapters"])

        # Estimate duration (rough: ~150 words/min, ~5 chars/word)
        words = total_chars / 5
        minutes = words / 150
        estimated_duration = f"~{int(minutes)}min" if minutes >= 1 else "<1min"

        stats = ImportStats(
            total_chapters=len(parsed["chapters"]),
            total_segments=total_segments,
            total_chars=total_chars,
            estimated_duration=estimated_duration
        )

        # Check if valid (no critical warnings)
        is_valid = not any(w.severity == "critical" for w in global_warnings)

        logger.success(
            f"Preview generated: {stats.total_chapters} chapters, "
            f"{stats.total_segments} segments, {len(global_warnings)} warnings"
        )

        # Broadcast preview completed event
        await broadcaster.broadcast_import_update(
            import_data={
                "importId": f"preview-{datetime.now().timestamp()}",
                "status": "completed",
                "message": f"Preview completed: {stats.total_chapters} chapters, {stats.total_segments} segments",
                "chapterCount": stats.total_chapters,
                "segmentCount": stats.total_segments
            },
            event_type=EventType.IMPORT_PROGRESS
        )

        return ImportPreviewResponse(
            is_valid=is_valid,
            project=parsed["project"],
            chapters=chapter_previews,
            global_warnings=global_warnings,
            stats=stats
        )

    except HTTPException:
        # Re-raise HTTPExceptions without modification
        raise
    except ValueError as e:
        logger.error(f"Markdown parsing error: {e}")
        raise HTTPException(status_code=400, detail=f"[IMPORT_PREVIEW_FAILED]error:{str(e)}")
    except Exception as e:
        logger.exception(f"Unexpected error in import preview: {e}")
        raise HTTPException(status_code=500, detail=f"[IMPORT_INTERNAL_ERROR]error:{str(e)}")


@router.post("", response_model=ImportExecuteResponse)
async def execute_import(
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
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Execute markdown import and create/update project in database

    Args:
        file: Markdown file (.md)
        mapping_rules: JSON string with mapping configuration
        language: Language code for spaCy segmentation (default: en)
        mode: 'new' (create new project) or 'merge' (add to existing)
        merge_target_id: Project ID for merge mode (required if mode=merge)
        selected_chapters: JSON array of chapter titles to import (empty = all)
        renamed_chapters: JSON object mapping original titles to new titles
        tts_engine: TTS engine identifier (e.g., 'xtts')
        tts_model_name: TTS model name (e.g., 'v2.0.2')
        tts_language: TTS language code (e.g., 'en', 'de')
        tts_speaker_name: Optional speaker name for voice cloning

    Returns:
        ImportExecuteResponse with created/updated project

    Raises:
        HTTPException 400: Invalid input, parsing error, or missing required params
        HTTPException 404: Target project not found (merge mode)
        HTTPException 500: Internal server error
    """
    try:
        # Parse parameters
        try:
            rules_dict = json.loads(mapping_rules)
            rules = MappingRules(**rules_dict)
        except (json.JSONDecodeError, ValueError) as e:
            raise HTTPException(status_code=400, detail=f"[IMPORT_INVALID_MAPPING_JSON]error:{str(e)}")

        try:
            selected_chapters_list = json.loads(selected_chapters)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"[IMPORT_INVALID_CHAPTERS_JSON]error:{str(e)}")

        try:
            renamed_chapters_dict = json.loads(renamed_chapters)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"[IMPORT_INVALID_RENAMED_JSON]error:{str(e)}")

        # Validate mode
        if mode not in ['new', 'merge']:
            raise HTTPException(status_code=400, detail=f"[IMPORT_INVALID_MODE]mode:{mode}")

        # Validate merge mode requirements
        if mode == 'merge' and not merge_target_id:
            raise HTTPException(status_code=400, detail="[IMPORT_MISSING_TARGET_ID]")

        # Read file content
        content = await file.read()
        md_content = content.decode('utf-8')

        if not md_content.strip():
            raise HTTPException(status_code=400, detail="[IMPORT_FILE_EMPTY]")

        logger.info(f"Executing import: mode={mode}, file={file.filename}, language={language}")

        # Generate unique import ID for tracking
        import_id = f"import-{datetime.now().timestamp()}"

        # Broadcast import started event
        await broadcaster.broadcast_import_update(
            import_data={
                "importId": import_id,
                "status": "running",
                "progress": 0.0,
                "message": "Starting import..."
            },
            event_type=EventType.IMPORT_STARTED
        )

        # Get segmentation limits (engine-aware)
        settings_service = SettingsService(conn)
        tts_manager = get_tts_engine_manager()

        # Validate engine
        if tts_engine not in tts_manager.list_available_engines():
            raise HTTPException(
                status_code=400,
                detail=f"[IMPORT_UNKNOWN_ENGINE]engine:{tts_engine}"
            )

        # Get engine constraints from metadata
        metadata = tts_manager._engine_metadata[tts_engine]
        constraints = metadata.get('constraints', {})

        engine_max = constraints.get('max_text_length', 500)

        # Get user preference and divider duration from settings
        user_pref = settings_service.get_setting('text.preferredMaxSegmentLength') or 250
        default_divider_duration = settings_service.get_setting('audio.defaultDividerDuration') or 2000

        # Use the minimum of user preference and engine max (safest)
        max_length = min(user_pref, engine_max)

        logger.debug(
            f"Segmentation limits - User pref: {user_pref}, Engine max: {engine_max}, "
            f"Using: max={max_length}"
        )

        # Parse markdown with segmentation (engine-aware)
        # IMPORTANT: Use 'language' for spaCy (content language for text analysis)
        #            NOT 'tts_language' (user's audio output preference)
        parser = MarkdownParser(rules)
        try:
            parsed = await parser.parse_with_segmentation(
                md_content,
                language=language,  # spaCy language for text segmentation (en/de/etc.)
                max_segment_length=max_length,
                default_divider_duration=default_divider_duration
            )
        except ValueError as ve:
            # Catch parsing/structure errors (missing headings, etc.)
            logger.error(f"Markdown parsing failed during import: {str(ve)}")
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            # Catch spaCy model loading errors or segmentation failures
            logger.error(f"Segmentation failed during import: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"[IMPORT_SEGMENTATION_FAILED]error:{str(e)}"
            )

        # Initialize repositories
        project_repo = ProjectRepository(conn)
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)

        if mode == 'new':
            # Create new project
            project = project_repo.create(
                title=parsed["project"]["title"],
                description=parsed["project"]["description"]
            )
            logger.info(f"Created new project: {project['id']} - {project['title']}")

            # Broadcast progress after project creation
            await broadcaster.broadcast_import_update(
                import_data={
                    "importId": import_id,
                    "projectId": project['id'],
                    "status": "running",
                    "progress": 0.3,
                    "message": "Project created, importing chapters..."
                },
                event_type=EventType.IMPORT_PROGRESS
            )

            # Track stats
            chapters_created = 0
            segments_created = 0

            # Create all chapters (with batch commits per chapter for large imports)
            for chapter_data in parsed["chapters"]:
                chapter = chapter_repo.create(
                    project_id=project['id'],
                    title=chapter_data["title"],
                    order_index=chapter_data["order_index"]
                )
                chapters_created += 1
                logger.debug(f"Created chapter: {chapter['id']} - {chapter['title']}")

                # Create segments
                for seg_data in chapter_data["segments"]:
                    if seg_data["type"] == "text":
                        # Get status from parsed data (spaCy may have marked as 'failed')
                        segment_status = 'pending'
                        spacy_status = seg_data.get("status", "ok")

                        if spacy_status == "failed":
                            # Single sentence exceeds max_length - mark as failed
                            segment_status = 'failed'
                            logger.debug(
                                f"Segment {seg_data['order_index']} in chapter '{chapter_data['title']}' "
                                f"marked as 'failed': Single sentence > {seg_data.get('max_length')} chars. "
                                f"User must shorten this sentence."
                            )

                        _ = segment_repo.create(
                            chapter_id=chapter['id'],
                            text=seg_data["content"],
                            order_index=seg_data["order_index"],
                            tts_engine=tts_engine,
                            tts_model_name=tts_model_name,
                            language=tts_language,
                            tts_speaker_name=tts_speaker_name,
                            segment_type='standard',
                            status=segment_status  # Use spaCy status or 'pending'
                        )
                        segments_created += 1
                    elif seg_data["type"] == "divider":
                        _ = segment_repo.create(
                            chapter_id=chapter['id'],
                            text="",
                            order_index=seg_data["order_index"],
                            tts_engine=tts_engine,
                            tts_model_name=tts_model_name,
                            language=tts_language,
                            tts_speaker_name=tts_speaker_name,
                            segment_type='divider',
                            pause_duration=seg_data.get("pause_duration", 300),
                            status='completed'  # Dividers don't need generation
                        )
                        segments_created += 1

                # Commit after each chapter to reduce transaction size and prevent DB locks
                conn.commit()
                logger.debug(f"Committed chapter '{chapter['title']}' ({segments_created} segments so far)")

            # Broadcast progress after chapters created
            await broadcaster.broadcast_import_update(
                import_data={
                    "importId": import_id,
                    "projectId": project['id'],
                    "status": "running",
                    "progress": 0.8,
                    "message": f"Created {chapters_created} chapters..."
                },
                event_type=EventType.IMPORT_PROGRESS
            )

            logger.success(
                f"Import completed: {chapters_created} chapters, {segments_created} segments created"
            )

        elif mode == 'merge':
            # Fetch existing project
            project = project_repo.get_by_id(merge_target_id)
            if not project:
                raise HTTPException(status_code=404, detail=f"[IMPORT_PROJECT_NOT_FOUND]projectId:{merge_target_id}")

            logger.info(f"Merging into existing project: {project['id']} - {project['title']}")

            # Broadcast progress for merge mode start
            await broadcaster.broadcast_import_update(
                import_data={
                    "importId": import_id,
                    "projectId": project['id'],
                    "status": "running",
                    "progress": 0.3,
                    "message": "Merging chapters into existing project..."
                },
                event_type=EventType.IMPORT_PROGRESS
            )

            # Get existing chapters to determine next order_index
            existing_chapters = chapter_repo.get_by_project(project['id'])
            next_order_index = len(existing_chapters)

            # Filter chapters based on selection
            # Note: selected_chapters_list contains chapter IDs (e.g., "temp-ch-0", "temp-ch-1")
            # We need to map these back to chapters using order_index
            chapters_to_import = parsed["chapters"]
            if selected_chapters_list:
                # Extract chapter indices from IDs (e.g., "temp-ch-0" -> 0)
                selected_indices = set()
                for chapter_id in selected_chapters_list:
                    if chapter_id.startswith("temp-ch-"):
                        try:
                            index = int(chapter_id.replace("temp-ch-", ""))
                            selected_indices.add(index)
                        except ValueError:
                            logger.warning(f"Invalid chapter ID format: {chapter_id}")

                # Filter by order_index
                chapters_to_import = [
                    ch for ch in parsed["chapters"]
                    if ch["order_index"] in selected_indices
                ]

                logger.debug(f"Selected chapter IDs: {selected_chapters_list}")
                logger.debug(f"Extracted indices: {selected_indices}")
                logger.debug(f"Filtered chapters: {len(chapters_to_import)}/{len(parsed['chapters'])}")

            # Track stats
            chapters_created = 0
            segments_created = 0

            # Create filtered chapters (with batch commits per chapter for large imports)
            for chapter_data in chapters_to_import:
                # Apply rename if exists
                # Note: renamed_chapters_dict uses chapter IDs as keys (e.g., "temp-ch-0")
                chapter_id = f"temp-ch-{chapter_data['order_index']}"
                chapter_title = renamed_chapters_dict.get(chapter_id, chapter_data["title"])

                chapter = chapter_repo.create(
                    project_id=project['id'],
                    title=chapter_title,
                    order_index=next_order_index
                )
                chapters_created += 1
                next_order_index += 1
                logger.debug(f"Added chapter to project: {chapter['id']} - {chapter_title}")

                # Create segments
                for seg_data in chapter_data["segments"]:
                    if seg_data["type"] == "text":
                        # Get status from parsed data (spaCy may have marked as 'failed')
                        segment_status = 'pending'
                        spacy_status = seg_data.get("status", "ok")

                        if spacy_status == "failed":
                            # Single sentence exceeds max_length - mark as failed
                            segment_status = 'failed'
                            logger.debug(
                                f"Segment {seg_data['order_index']} in chapter '{chapter_data['title']}' "
                                f"marked as 'failed': Single sentence > {seg_data.get('max_length')} chars. "
                                f"User must shorten this sentence."
                            )

                        _ = segment_repo.create(
                            chapter_id=chapter['id'],
                            text=seg_data["content"],
                            order_index=seg_data["order_index"],
                            tts_engine=tts_engine,
                            tts_model_name=tts_model_name,
                            language=tts_language,
                            tts_speaker_name=tts_speaker_name,
                            segment_type='standard',
                            status=segment_status  # Use spaCy status or 'pending'
                        )
                        segments_created += 1
                    elif seg_data["type"] == "divider":
                        _ = segment_repo.create(
                            chapter_id=chapter['id'],
                            text="",
                            order_index=seg_data["order_index"],
                            tts_engine=tts_engine,
                            tts_model_name=tts_model_name,
                            language=tts_language,
                            tts_speaker_name=tts_speaker_name,
                            segment_type='divider',
                            pause_duration=seg_data.get("pause_duration", 300),
                            status='completed'  # Dividers don't need generation
                        )
                        segments_created += 1

                # Commit after each chapter to reduce transaction size and prevent DB locks
                conn.commit()
                logger.debug(f"Committed chapter '{chapter_title}' ({segments_created} segments so far)")

            # Broadcast progress after merge completed
            await broadcaster.broadcast_import_update(
                import_data={
                    "importId": import_id,
                    "projectId": project['id'],
                    "status": "running",
                    "progress": 0.8,
                    "message": f"Merged {chapters_created} chapters..."
                },
                event_type=EventType.IMPORT_PROGRESS
            )

            logger.info(
                f"Merge completed: {chapters_created} chapters, {segments_created} segments added"
            )

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

        # Broadcast import completed event
        await broadcaster.broadcast_import_update(
            import_data={
                "importId": import_id,
                "projectId": project['id'],
                "status": "completed",
                "progress": 1.0,
                "message": f"Import completed: {chapters_created} chapters, {segments_created} segments",
                "chapterCount": chapters_created,
                "segmentCount": segments_created
            },
            event_type=EventType.IMPORT_COMPLETED
        )

        return ImportExecuteResponse(
            project=project_complete,
            chapters_created=chapters_created,
            segments_created=segments_created
        )

    except HTTPException as http_err:
        # Broadcast import failed event for HTTP errors
        try:
            error_msg = str(http_err.detail) if hasattr(http_err, 'detail') else str(http_err)
            await broadcaster.broadcast_import_update(
                import_data={
                    "importId": import_id,
                    "status": "failed",
                    "message": f"Import failed: {error_msg}",
                    "error": error_msg
                },
                event_type=EventType.IMPORT_FAILED
            )
        except Exception:
            pass  # Don't fail on error event broadcast
        # Re-raise HTTPExceptions without modification
        raise
    except ValueError as e:
        # Broadcast import failed event for value errors
        error_msg = str(e)
        try:
            await broadcaster.broadcast_import_update(
                import_data={
                    "importId": import_id,
                    "status": "failed",
                    "message": f"Import failed: {error_msg}",
                    "error": error_msg
                },
                event_type=EventType.IMPORT_FAILED
            )
        except Exception:
            pass  # Don't fail on error event broadcast
        logger.error(f"Import execution error: {e}")
        raise HTTPException(status_code=400, detail=f"[IMPORT_FAILED]error:{error_msg}")
    except Exception as e:
        # Broadcast import failed event for unexpected errors
        error_msg = str(e)
        try:
            await broadcaster.broadcast_import_update(
                import_data={
                    "importId": import_id,
                    "status": "failed",
                    "message": f"Import failed: {error_msg}",
                    "error": error_msg
                },
                event_type=EventType.IMPORT_FAILED
            )
        except Exception:
            pass  # Don't fail on error event broadcast
        logger.exception(f"Unexpected error in import execution: {e}")
        raise HTTPException(status_code=500, detail=f"[IMPORT_INTERNAL_ERROR]error:{error_msg}")
