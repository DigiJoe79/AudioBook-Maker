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
from services.tts_manager import get_tts_manager
from services.settings_service import SettingsService
from models.response_models import (
    ProjectResponse,
    ProjectWithChaptersResponse,
    DeleteResponse,
    ReorderResponse,
    MarkdownImportResponse,
    to_camel
)
from config import OUTPUT_DIR

router = APIRouter(tags=["projects"])


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

    chapters = chapter_repo.get_by_project(project_id)

    deleted_files = 0
    for chapter in chapters:
        segments = segment_repo.get_by_chapter(chapter['id'])
        for segment in segments:
            if segment.get('audio_path'):
                try:
                    audio_url = segment['audio_path']
                    if '/audio/' in audio_url:
                        filename = audio_url.split('/audio/')[-1]
                        audio_file = Path(OUTPUT_DIR) / filename

                        if audio_file.exists():
                            os.remove(audio_file)
                            deleted_files += 1
                except Exception as e:
                    logger.warning(f"Could not delete audio file for segment {segment['id']}: {e}")

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

    for project_id in data.project_ids:
        if not project_repo.get_by_id(project_id):
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    project_repo.reorder_batch(data.project_ids)

    return {
        "success": True,
        "message": f"Reordered {len(data.project_ids)} projects",
        "count": len(data.project_ids)
    }


@router.post("/projects/import-markdown", response_model=MarkdownImportResponse)
async def import_project_from_markdown(
    file: UploadFile = File(...),
    engine: str = Form(...),
    model_name: str = Form(...),
    language: str = Form(...),
    speaker_name: Optional[str] = Form(None),
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Import project from Markdown file

    Markdown Structure:
    -
    -
    -
    - *** → Divider segment (pause duration from settings)
    - Text → Segmented with spaCy (smart method)

    Args:
        file: Markdown file (.md, max 10MB)
        engine: TTS engine (e.g., 'xtts', 'dummy')
        model_name: TTS model (e.g., 'v2.0.2')
        language: Language code (e.g., 'de', 'en')
        speaker_name: Optional speaker name for standard segments

    Returns:
        Created project with all chapters and segments
    """
    try:
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

        if not (file.filename and (file.filename.endswith('.md') or file.filename.endswith('.markdown'))):
            raise HTTPException(status_code=400, detail="Invalid file type (must be .md or .markdown)")

        md_content = content.decode('utf-8')
        try:
            parsed = MarkdownParser.parse(md_content)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        project_repo = ProjectRepository(conn)
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)
        settings_service = SettingsService(conn)

        audio_settings = settings_service.get_setting('audio')
        default_divider_duration = audio_settings.get('defaultDividerDuration', 2000)

        logger.info(f"Importing markdown project: '{parsed['project_title']}' with {len(parsed['chapters'])} chapters")

        project = project_repo.create(
            title=parsed['project_title'],
            description=parsed.get('project_description', '')
        )

        logger.info(f"Created project: {project['title']} (ID: {project['id']})")

        total_segments = 0
        total_dividers = 0

        segmenter = get_segmenter(language)

        manager = get_tts_manager()
        if engine not in manager.list_available_engines():
            raise HTTPException(
                status_code=400,
                detail=f"Unknown engine: {engine}. Available engines: {manager.list_available_engines()}"
            )

        engine_class = manager._engine_classes[engine]
        temp_engine = engine_class()
        engine_max = temp_engine.get_max_text_length(language)
        engine_min = temp_engine.get_min_text_length()

        user_pref = settings_service.get_setting('text.preferredMaxSegmentLength') or 250

        max_length = min(user_pref, engine_max)
        min_length = engine_min

        logger.info(f"Segmentation limits - User pref: {user_pref}, Engine max: {engine_max}, Using: {max_length}")

        for chapter_data in parsed['chapters']:
            chapter = chapter_repo.create(
                project_id=project['id'],
                title=chapter_data['title'],
                order_index=chapter_data['order_index'],
                default_engine=engine,
                default_model_name=model_name
            )

            logger.info(f"Created chapter: '{chapter['title']}' (ID: {chapter['id']})")

            segment_order = 0

            for block in chapter_data['content_blocks']:
                if block['type'] == 'divider':
                    segment_repo.create(
                        chapter_id=chapter['id'],
                        text='',
                        order_index=segment_order,
                        engine=engine,
                        model_name=model_name,
                        speaker_name=None,
                        language=language,
                        segment_type='divider',
                        pause_duration=default_divider_duration,
                        status='completed'
                    )
                    segment_order += 1
                    total_dividers += 1

                elif block['type'] == 'text':
                    text_segments = segmenter.segment_smart(
                        block['content'],
                        min_length=min_length,
                        max_length=max_length
                    )

                    logger.info(
                        f"Segmented text block into {len(text_segments)} segments "
                        f"({len(block['content'])} chars)"
                    )

                    for seg in text_segments:
                        segment_repo.create(
                            chapter_id=chapter['id'],
                            text=seg['text'],
                            order_index=segment_order,
                            engine=engine,
                            model_name=model_name,
                            speaker_name=speaker_name,
                            language=language,
                            segment_type='standard',
                            status='pending'
                        )
                        segment_order += 1
                        total_segments += 1

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
