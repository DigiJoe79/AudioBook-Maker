"""
API endpoints for project management
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from typing import List, Optional
import sqlite3
from loguru import logger

from core.exceptions import ApplicationError
from db.database import get_db
from services.event_broadcaster import broadcaster, EventType, safe_broadcast
from db.repositories import ProjectRepository, ChapterRepository, SegmentRepository
from models.response_models import (
    ProjectResponse,
    ProjectWithChaptersResponse,
    DeleteResponse,
    ReorderResponse,
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
    """
    Get all projects with their chapters and segments.

    Returns full project hierarchy for sidebar and project selection.
    """
    try:
        project_repo = ProjectRepository(conn)
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)

        projects = project_repo.get_all()
        logger.debug(f"[projects] get_all_projects: found {len(projects)} projects")

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
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to get projects: {e}", exc_info=True)
        raise ApplicationError("PROJECT_LIST_FAILED", status_code=500, error=str(e))


@router.get("/projects/{project_id}", response_model=ProjectWithChaptersResponse)
async def get_project(project_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Get a single project with chapters and segments.

    Returns full project hierarchy for detail view.
    """
    try:
        project_repo = ProjectRepository(conn)
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)

        project = project_repo.get_by_id(project_id)
        if not project:
            raise ApplicationError("PROJECT_NOT_FOUND", status_code=404, projectId=project_id)

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
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to get project {project_id}: {e}", exc_info=True)
        raise ApplicationError("PROJECT_GET_FAILED", status_code=500, projectId=project_id, error=str(e))


@router.post("/projects", response_model=ProjectResponse)
async def create_project(
    project: ProjectCreate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Create a new project.

    Broadcasts project.created SSE event.
    """
    try:
        project_repo = ProjectRepository(conn)
        new_project = project_repo.create(project.title, project.description or "")

        # Emit SSE event
        await safe_broadcast(
            broadcaster.broadcast_project_update,
            {
                "projectId": new_project['id'],
                "title": new_project['title'],
                "description": new_project['description']
            },
            event_type=EventType.PROJECT_CREATED,
            event_description="project.created"
        )

        # Return with empty chapters list
        new_project['chapters'] = []
        return new_project
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to create project: {e}", exc_info=True)
        raise ApplicationError("PROJECT_CREATE_FAILED", status_code=500, error=str(e))


@router.put("/projects/{project_id}", response_model=ProjectWithChaptersResponse)
async def update_project(
    project_id: str,
    project: ProjectUpdate,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Update project title and description.

    Broadcasts project.updated SSE event.
    """
    try:
        project_repo = ProjectRepository(conn)

        updated = project_repo.update(
            project_id,
            title=project.title,
            description=project.description
        )

        if not updated:
            raise ApplicationError("PROJECT_NOT_FOUND", status_code=404, projectId=project_id)

        # Emit SSE event
        await safe_broadcast(
            broadcaster.broadcast_project_update,
            {
                "projectId": updated['id'],
                "title": updated['title'],
                "description": updated['description']
            },
            event_type=EventType.PROJECT_UPDATED,
            event_description="project.updated"
        )

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
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to update project {project_id}: {e}", exc_info=True)
        raise ApplicationError("PROJECT_UPDATE_FAILED", status_code=500, projectId=project_id, error=str(e))


@router.delete("/projects/{project_id}", response_model=DeleteResponse)
async def delete_project(project_id: str, conn: sqlite3.Connection = Depends(get_db)):
    """
    Delete a project and all its audio files.

    Cascade deletes chapters, segments, and pronunciation rules.
    Broadcasts project.deleted SSE event.
    """
    try:
        from pathlib import Path
        import os
        from db.pronunciation_repository import PronunciationRulesRepository

        project_repo = ProjectRepository(conn)
        chapter_repo = ChapterRepository(conn)
        segment_repo = SegmentRepository(conn)
        pronunciation_repo = PronunciationRulesRepository(conn)

        # Get project info before deletion (for SSE event)
        project = project_repo.get_by_id(project_id)
        if not project:
            raise ApplicationError("PROJECT_NOT_FOUND", status_code=404, projectId=project_id)

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

        # Delete pronunciation rules associated with this project
        deleted_rules = pronunciation_repo.delete_by_project(project_id)
        if deleted_rules > 0:
            logger.info(f"Deleted {deleted_rules} pronunciation rule(s) for project {project_id}")

        # Delete project (CASCADE will delete chapters and segments)
        if not project_repo.delete(project_id):
            raise ApplicationError("PROJECT_NOT_FOUND", status_code=404, projectId=project_id)

        # Emit SSE event
        await safe_broadcast(
            broadcaster.broadcast_project_update,
            {
                "projectId": project_id,
                "title": project['title']
            },
            event_type=EventType.PROJECT_DELETED,
            event_description="project.deleted"
        )

        # Build result message
        message_parts = [f"Project deleted (removed {deleted_files} audio files)"]
        if deleted_rules > 0:
            message_parts.append(f"{deleted_rules} pronunciation rule(s) deleted")

        return DeleteResponse(
            success=True,
            message=", ".join(message_parts)
        )
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to delete project {project_id}: {e}", exc_info=True)
        raise ApplicationError("PROJECT_DELETE_FAILED", status_code=500, projectId=project_id, error=str(e))


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
    try:
        project_repo = ProjectRepository(conn)
        logger.debug(f"[projects] reorder_projects: validating {len(data.project_ids)} project IDs")

        # Validate all projects exist
        for project_id in data.project_ids:
            if not project_repo.get_by_id(project_id):
                raise ApplicationError("PROJECT_NOT_FOUND", status_code=404, projectId=project_id)

        # Reorder
        project_repo.reorder_batch(data.project_ids)

        # Broadcast project.reordered event (CRUD consistency)
        logger.debug(f"Broadcasting project.reordered event: projects={len(data.project_ids)}")
        await safe_broadcast(
            broadcaster.broadcast_project_update,
            {"projectIds": data.project_ids},
            event_type=EventType.PROJECT_REORDERED,
            event_description="project.reordered"
        )

        return ReorderResponse(
            success=True,
            message=f"Reordered {len(data.project_ids)} projects",
            count=len(data.project_ids)
        )
    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to reorder projects: {e}", exc_info=True)
        raise ApplicationError("PROJECT_REORDER_FAILED", status_code=500, error=str(e))
