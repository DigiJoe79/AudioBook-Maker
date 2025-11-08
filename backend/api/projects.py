"""
API endpoints for project management
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, ConfigDict
from typing import List, Optional
import sqlite3
from loguru import logger

from db.database import get_db
from db.repositories import ProjectRepository, ChapterRepository, SegmentRepository
from services.markdown_parser import MarkdownParser
from services.text_segmenter import get_segmenter
from core.engine_manager import get_engine_manager
from services.settings_service import SettingsService
from models.response_models import (
    ProjectResponse,
    ProjectWithChaptersResponse,
    DeleteResponse,
    ReorderResponse,
    MarkdownImportResponse,
    to_camel  # Import alias generator
)
from config import OUTPUT_DIR

router = APIRouter(tags=["projects"])


# Request models only (responses use central models)
class ProjectCreate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    title: str
    description: Optional[str] = ""


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    title: Optional[str] = None
    description: Optional[str] = None


class ReorderProjectsRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True
    )

    project_ids: List[str]


@router.get("/projects", response_model=List[ProjectWithChaptersResponse])
async def get_all_projects(conn: sqlite3.Connection = Depends(get_db)):
    """Get all projects with their chapters and segments"""
    project_repo = ProjectRepository(conn)
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    projects = project_repo.get_all()

    # Load chapters and segments for each project
    result = []
    for project in projects:
        chapters = chapter_repo.get_by_project(project['id'])

        chapters_with_segments = []
        for chapter in chapters:
            segments = segment_repo.get_by_chapter(chapter['id'])
            chapter_dict = dict(chapter)
            chapter_dict['segments'] = segments
            chapters_with_segments.append(chapter_dict)

        project_dict = dict(project)
        project_dict['chapters'] = chapters_with_segments
        result.append(project_dict)

    return result


@router.get("/projects/{project_id}", response_model=ProjectWithChaptersResponse)
async def get_project(project_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Get a single project with chapters and segments"""
    project_repo = ProjectRepository(conn)
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    project = project_repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    chapters = chapter_repo.get_by_project(project_id)

    chapters_with_segments = []
    for chapter in chapters:
        segments = segment_repo.get_by_chapter(chapter['id'])
        chapter_dict = dict(chapter)
        chapter_dict['segments'] = segments
        chapters_with_segments.append(chapter_dict)

    project_dict = dict(project)
    project_dict['chapters'] = chapters_with_segments

    return project_dict


@router.post("/projects", response_model=ProjectResponse)
async def create_project(
    project: ProjectCreate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """Create a new project"""
    project_repo = ProjectRepository(conn)
    new_project = project_repo.create(project.title, project.description or "")

    # Return with empty chapters list
    new_project['chapters'] = []
    return new_project


@router.put("/projects/{project_id}", response_model=ProjectWithChaptersResponse)
async def update_project(
    project_id: str,
    project: ProjectUpdate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """Update a project"""
    project_repo = ProjectRepository(conn)

    updated = project_repo.update(
        project_id,
        title=project.title,
        description=project.description
    )

    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")

    # Load chapters for response
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    chapters = chapter_repo.get_by_project(project_id)
    chapters_with_segments = []
    for chapter in chapters:
        segments = segment_repo.get_by_chapter(chapter['id'])
        chapter_dict = dict(chapter)
        chapter_dict['segments'] = segments
        chapters_with_segments.append(chapter_dict)

    updated['chapters'] = chapters_with_segments
    return updated


@router.delete("/projects/{project_id}", response_model=DeleteResponse)
async def delete_project(project_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """Delete a project and all its audio files"""
    from pathlib import Path
    import os

    project_repo = ProjectRepository(conn)
    chapter_repo = ChapterRepository(conn)
    segment_repo = SegmentRepository(conn)

    # Get all chapters to delete their audio files
    chapters = chapter_repo.get_by_project(project_id)

    # Delete audio files for all segments in all chapters
    deleted_files = 0
    for chapter in chapters:
        segments = segment_repo.get_by_chapter(chapter['id'])
        for segment in segments:
            if segment.get('audio_path'):
                try:
                    # audio_path is just the filename (e.g., segment_123.wav)
                    filename = segment['audio_path']
                    audio_file = Path(OUTPUT_DIR) / filename

                    if audio_file.exists():
                        os.remove(audio_file)
                        deleted_files += 1
                except Exception as e:
                    # Log but don't fail the deletion
                    logger.warning(f"Could not delete audio file for segment {segment['id']}: {e}")

    # Delete project (CASCADE will delete chapters and segments)
    if not project_repo.delete(project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    return {
        "success": True,
        "message": f"Project deleted (removed {deleted_files} audio files)"
    }


@router.post("/projects/reorder", response_model=ReorderResponse)
async def reorder_projects(
    data: ReorderProjectsRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Reorder projects

    Request body:
    {
      "project_ids": ["id1", "id2", "id3"]
    }

    Array index = new position (0, 1, 2, ...)
    """
    project_repo = ProjectRepository(conn)

    # Validate all projects exist
    for project_id in data.project_ids:
        if not project_repo.get_by_id(project_id):
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    # Reorder
    project_repo.reorder_batch(data.project_ids)

    return {
        "success": True,
        "message": f"Reordered {len(data.project_ids)} projects",
        "count": len(data.project_ids)
    }


@router.post("/projects/import-markdown", response_model=MarkdownImportResponse)
async def import_project_from_markdown(
    file: UploadFile = File(...),
    tts_engine: str = Form(...),
    tts_model_name: str = Form(...),
    language: str = Form(...),
    tts_speaker_name: Optional[str] = Form(None),
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Import project from Markdown file

    Markdown Structure:
    - # Heading 1 → Project title
    - ## Heading 2 → Ignored (Acts, etc.)
    - ### Heading 3 → Chapter (numbering removed: "Chapter 1: Name" → "Name")
    - *** → Divider segment (pause duration from settings)
    - Text → Segmented with spaCy (smart method)

    Args:
        file: Markdown file 
        tts_engine: TTS engine 
        tts_model_name: TTS model 
        language: Language code 
        tts_speaker_name: Optional speaker name for standard segments

    Returns:
        Created project with all chapters and segments
    """
    try:
        # Validate file size (max 10 MB)
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

        # Validate file extension
        if not (file.filename and (file.filename.endswith('.md') or file.filename.endswith('.markdown'))):
            raise HTTPException(status_code=400, detail="Invalid file type (must be .md or .markdown)")

        # Parse markdown
        md_content = content.decode('utf-8')
        try:
            parsed = MarkdownParser.parse(md_content)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # Get repositories and services
        project_repo = ProjectRepository(conn)
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)
        settings_service = SettingsService(conn)

        # Get default divider duration from settings
        audio_settings = settings_service.get_setting('audio')
        default_divider_duration = audio_settings.get('defaultDividerDuration', 2000)

        logger.info(f"Importing markdown project: '{parsed['project_title']}' with {len(parsed['chapters'])} chapters")

        # Create project
        project = project_repo.create(
            title=parsed['project_title'],
            description=parsed.get('project_description', '')
        )

        logger.info(f"Created project: {project['title']} (ID: {project['id']})")

        # Statistics
        total_segments = 0
        total_dividers = 0

        # Get text segmenter
        segmenter = get_segmenter(language)

        # Get engine constraints for segmentation
        manager = get_engine_manager()
        if tts_engine not in manager.list_available_engines():
            raise HTTPException(
                status_code=400,
                detail=f"Unknown engine: {tts_engine}. Available engines: {manager.list_available_engines()}"
            )

        # Get engine constraints from metadata
        metadata = manager._engine_metadata[tts_engine]
        constraints = metadata.get('constraints', {})

        engine_max = constraints.get('max_text_length', 500)
        engine_min = constraints.get('min_text_length', 10)

        # Get user preference from settings
        user_pref = settings_service.get_setting('text.preferredMaxSegmentLength') or 250

        # Use the minimum of user preference and engine max
        max_length = min(user_pref, engine_max)
        min_length = engine_min

        logger.info(f"Segmentation limits - User pref: {user_pref}, Engine max: {engine_max}, Using: {max_length}")

        # Create chapters and segments
        for chapter_data in parsed['chapters']:
            # Create chapter
            chapter = chapter_repo.create(
                project_id=project['id'],
                title=chapter_data['title'],
                order_index=chapter_data['order_index'],
                default_tts_engine=tts_engine,
                default_tts_model_name=tts_model_name
            )

            logger.info(f"Created chapter: '{chapter['title']}' (ID: {chapter['id']})")

            # Process content blocks
            segment_order = 0

            for block in chapter_data['content_blocks']:
                if block['type'] == 'divider':
                    # Create divider segment
                    segment_repo.create(
                        chapter_id=chapter['id'],
                        text='',  # Empty text for dividers
                        order_index=segment_order,
                        tts_engine=tts_engine,
                        tts_model_name=tts_model_name,
                        tts_speaker_name=None,  # No speaker for dividers
                        language=language,
                        segment_type='divider',
                        pause_duration=default_divider_duration,
                        status='completed'  # Dividers are always completed
                    )
                    segment_order += 1
                    total_dividers += 1

                elif block['type'] == 'text':
                    # Segment text with spaCy (smart method)
                    text_segments = segmenter.segment_smart(
                        block['content'],
                        min_length=min_length,
                        max_length=max_length
                    )

                    logger.info(
                        f"Segmented text block into {len(text_segments)} segments "
                        f"({len(block['content'])} chars)"
                    )

                    # Create standard segments
                    for seg in text_segments:
                        segment_repo.create(
                            chapter_id=chapter['id'],
                            text=seg['text'],
                            order_index=segment_order,
                            tts_engine=tts_engine,
                            tts_model_name=tts_model_name,
                            tts_speaker_name=tts_speaker_name,
                            language=language,
                            segment_type='standard',
                            status='pending'
                        )
                        segment_order += 1
                        total_segments += 1

        # Load full project structure for response
        project_with_chapters = project_repo.get_by_id(project['id'])
        chapters = chapter_repo.get_by_project(project['id'])

        chapters_with_segments = []
        for chapter in chapters:
            segments = segment_repo.get_by_chapter(chapter['id'])
            chapter_dict = dict(chapter)
            chapter_dict['segments'] = segments
            chapters_with_segments.append(chapter_dict)

        project_with_chapters['chapters'] = chapters_with_segments

        logger.info(
            f"Import completed successfully: "
            f"{len(chapters)} chapters, "
            f"{total_segments} segments, "
            f"{total_dividers} dividers"
        )

        return {
            "success": True,
            "project": project_with_chapters,
            "total_segments": total_segments,
            "total_dividers": total_dividers,
            "message": f"Projekt '{parsed['project_title']}' erfolgreich importiert"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Markdown import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
