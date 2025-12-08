"""
SSE Contract Tests for Project and Chapter Events

These tests verify that SSE events for project and chapter operations
emit the correct event structure, field names (camelCase), and channel.

Tested Event Types:
- Project Events: PROJECT_CREATED, PROJECT_UPDATED, PROJECT_DELETED, PROJECT_REORDERED
- Chapter Events: CHAPTER_CREATED, CHAPTER_UPDATED, CHAPTER_DELETED, CHAPTER_REORDERED

All events broadcast on the "projects" channel.
"""

import pytest
import asyncio
from services.event_broadcaster import (
    broadcaster,
    EventType,
    emit_project_reordered
)


# ============================================================================
# Test Helpers
# ============================================================================

async def capture_sse_event(channel: str = "projects", timeout: float = 1.0):
    """
    Capture a single SSE event from the broadcaster.

    Args:
        channel: Channel to subscribe to (default: "projects")
        timeout: Maximum time to wait for event in seconds

    Returns:
        Event data dict or None if timeout

    Raises:
        asyncio.TimeoutError: If no event received within timeout
    """
    captured_event = None

    async def event_listener():
        nonlocal captured_event
        async for event in broadcaster.subscribe(channels=[channel]):
            # Skip connection event
            if "event" in event and event.get("event") == "connected":
                continue
            captured_event = event
            break

    # Run listener with timeout
    listener_task = asyncio.create_task(event_listener())
    try:
        await asyncio.wait_for(listener_task, timeout=timeout)
    except asyncio.TimeoutError:
        listener_task.cancel()
        raise

    return captured_event


def validate_sse_structure(event: dict):
    """
    Validate basic SSE event structure.

    Args:
        event: Event dictionary from broadcaster

    Asserts:
        - Has "data" field (JSON string)
        - Has "id" field (event ID)
    """
    assert "data" in event, "SSE event must have 'data' field"
    assert "id" in event, "SSE event must have 'id' field"


def validate_event_data(data: dict, expected_event_type: str, expected_channel: str = "projects"):
    """
    Validate parsed event data structure.

    Args:
        data: Parsed event data dictionary
        expected_event_type: Expected event type (e.g., "project.created")
        expected_channel: Expected channel name (default: "projects")

    Asserts:
        - Has "event" field matching expected type
        - Has "_timestamp" field (ISO8601)
        - Has "_channel" field matching expected channel
    """
    assert "event" in data, "Event data must have 'event' field"
    assert data["event"] == expected_event_type, \
        f"Expected event type '{expected_event_type}', got '{data['event']}'"

    assert "_timestamp" in data, "Event data must have '_timestamp' field"
    assert isinstance(data["_timestamp"], str), "_timestamp must be ISO8601 string"

    assert "_channel" in data, "Event data must have '_channel' field"
    assert data["_channel"] == expected_channel, \
        f"Expected channel '{expected_channel}', got '{data['_channel']}'"


def validate_camel_case_fields(data: dict, required_fields: list):
    """
    Validate that event data uses camelCase field names.

    Args:
        data: Event data dictionary
        required_fields: List of required camelCase field names

    Asserts:
        - All required fields are present
        - No snake_case equivalents exist
    """
    for field in required_fields:
        assert field in data, f"Required camelCase field '{field}' not found in event data"

    # Check for common snake_case violations
    forbidden_snake_case = [
        "project_id", "chapter_id", "order_index", "created_at", "updated_at",
        "default_tts_engine", "tts_model_name", "tts_speaker_name"
    ]
    for field in forbidden_snake_case:
        assert field not in data, \
            f"Forbidden snake_case field '{field}' found - use camelCase instead"


# ============================================================================
# Project Event Tests
# ============================================================================

class TestProjectCreatedEvent:
    """Tests for project.created SSE event."""

    @pytest.mark.asyncio
    async def test_project_created_event_structure(self):
        """PROJECT_CREATED event has correct structure and channel."""
        # Prepare test data
        project_data = {
            "projectId": "proj-test-123",
            "title": "Test Project",
            "description": "Test Description",
            "orderIndex": 0
        }

        # Capture event
        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)  # Let subscriber connect

        # Emit event
        await broadcaster.broadcast_project_update(
            project_data,
            event_type=EventType.PROJECT_CREATED
        )

        # Validate
        event = await capture_task
        validate_sse_structure(event)

        # Parse and validate data
        import json
        data = json.loads(event["data"])
        validate_event_data(data, EventType.PROJECT_CREATED, "projects")

    @pytest.mark.asyncio
    async def test_project_created_uses_camel_case(self):
        """PROJECT_CREATED event uses camelCase field names."""
        project_data = {
            "projectId": "proj-test-456",
            "title": "CamelCase Test",
            "description": "Testing camelCase",
            "orderIndex": 1
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_project_update(
            project_data,
            event_type=EventType.PROJECT_CREATED
        )

        event = await capture_task
        import json
        data = json.loads(event["data"])

        # Validate camelCase fields
        validate_camel_case_fields(data, ["projectId", "title", "orderIndex"])
        assert data["projectId"] == "proj-test-456"
        assert data["title"] == "CamelCase Test"


class TestProjectUpdatedEvent:
    """Tests for project.updated SSE event."""

    @pytest.mark.asyncio
    async def test_project_updated_event_structure(self):
        """PROJECT_UPDATED event has correct structure and channel."""
        project_data = {
            "projectId": "proj-update-123",
            "title": "Updated Project",
            "description": "Updated Description"
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_project_update(
            project_data,
            event_type=EventType.PROJECT_UPDATED
        )

        event = await capture_task
        validate_sse_structure(event)

        import json
        data = json.loads(event["data"])
        validate_event_data(data, EventType.PROJECT_UPDATED, "projects")

    @pytest.mark.asyncio
    async def test_project_updated_uses_camel_case(self):
        """PROJECT_UPDATED event uses camelCase field names."""
        project_data = {
            "projectId": "proj-update-456",
            "title": "Updated Title"
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_project_update(
            project_data,
            event_type=EventType.PROJECT_UPDATED
        )

        event = await capture_task
        import json
        data = json.loads(event["data"])

        validate_camel_case_fields(data, ["projectId", "title"])


class TestProjectDeletedEvent:
    """Tests for project.deleted SSE event."""

    @pytest.mark.asyncio
    async def test_project_deleted_event_structure(self):
        """PROJECT_DELETED event has correct structure and channel."""
        project_data = {
            "projectId": "proj-delete-123"
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_project_update(
            project_data,
            event_type=EventType.PROJECT_DELETED
        )

        event = await capture_task
        validate_sse_structure(event)

        import json
        data = json.loads(event["data"])
        validate_event_data(data, EventType.PROJECT_DELETED, "projects")

    @pytest.mark.asyncio
    async def test_project_deleted_uses_camel_case(self):
        """PROJECT_DELETED event uses camelCase field names."""
        project_data = {
            "projectId": "proj-delete-456"
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_project_update(
            project_data,
            event_type=EventType.PROJECT_DELETED
        )

        event = await capture_task
        import json
        data = json.loads(event["data"])

        validate_camel_case_fields(data, ["projectId"])
        assert data["projectId"] == "proj-delete-456"


class TestProjectReorderedEvent:
    """Tests for project.reordered SSE event."""

    @pytest.mark.asyncio
    async def test_project_reordered_event_structure(self):
        """PROJECT_REORDERED event has correct structure and channel."""
        project_ids = ["proj-1", "proj-2", "proj-3"]

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await emit_project_reordered(project_ids)

        event = await capture_task
        validate_sse_structure(event)

        import json
        data = json.loads(event["data"])
        validate_event_data(data, EventType.PROJECT_REORDERED, "projects")

    @pytest.mark.asyncio
    async def test_project_reordered_uses_camel_case(self):
        """PROJECT_REORDERED event uses camelCase field names."""
        project_ids = ["proj-a", "proj-b", "proj-c"]

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await emit_project_reordered(project_ids)

        event = await capture_task
        import json
        data = json.loads(event["data"])

        validate_camel_case_fields(data, ["projectIds"])
        assert data["projectIds"] == project_ids


# ============================================================================
# Chapter Event Tests
# ============================================================================

class TestChapterCreatedEvent:
    """Tests for chapter.created SSE event."""

    @pytest.mark.asyncio
    async def test_chapter_created_event_structure(self):
        """CHAPTER_CREATED event has correct structure and channel."""
        chapter_data = {
            "chapterId": "ch-test-123",
            "projectId": "proj-123",
            "title": "Test Chapter",
            "orderIndex": 0
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_chapter_crud(
            chapter_data,
            event_type=EventType.CHAPTER_CREATED
        )

        event = await capture_task
        validate_sse_structure(event)

        import json
        data = json.loads(event["data"])
        validate_event_data(data, EventType.CHAPTER_CREATED, "projects")

    @pytest.mark.asyncio
    async def test_chapter_created_uses_camel_case(self):
        """CHAPTER_CREATED event uses camelCase field names."""
        chapter_data = {
            "chapterId": "ch-test-456",
            "projectId": "proj-456",
            "title": "CamelCase Chapter",
            "orderIndex": 1
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_chapter_crud(
            chapter_data,
            event_type=EventType.CHAPTER_CREATED
        )

        event = await capture_task
        import json
        data = json.loads(event["data"])

        validate_camel_case_fields(data, ["chapterId", "projectId", "title", "orderIndex"])
        assert data["chapterId"] == "ch-test-456"
        assert data["projectId"] == "proj-456"


class TestChapterUpdatedEvent:
    """Tests for chapter.updated SSE event."""

    @pytest.mark.asyncio
    async def test_chapter_updated_event_structure(self):
        """CHAPTER_UPDATED event has correct structure and channel."""
        chapter_data = {
            "chapterId": "ch-update-123",
            "title": "Updated Chapter"
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_chapter_update(chapter_data)

        event = await capture_task
        validate_sse_structure(event)

        import json
        data = json.loads(event["data"])
        validate_event_data(data, EventType.CHAPTER_UPDATED, "projects")

    @pytest.mark.asyncio
    async def test_chapter_updated_uses_camel_case(self):
        """CHAPTER_UPDATED event uses camelCase field names."""
        chapter_data = {
            "chapterId": "ch-update-456",
            "title": "Updated Title",
            "segmentCount": 10
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_chapter_update(chapter_data)

        event = await capture_task
        import json
        data = json.loads(event["data"])

        validate_camel_case_fields(data, ["chapterId", "title"])
        assert data["segmentCount"] == 10


class TestChapterDeletedEvent:
    """Tests for chapter.deleted SSE event."""

    @pytest.mark.asyncio
    async def test_chapter_deleted_event_structure(self):
        """CHAPTER_DELETED event has correct structure and channel."""
        chapter_data = {
            "chapterId": "ch-delete-123",
            "projectId": "proj-123"
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_chapter_crud(
            chapter_data,
            event_type=EventType.CHAPTER_DELETED
        )

        event = await capture_task
        validate_sse_structure(event)

        import json
        data = json.loads(event["data"])
        validate_event_data(data, EventType.CHAPTER_DELETED, "projects")

    @pytest.mark.asyncio
    async def test_chapter_deleted_uses_camel_case(self):
        """CHAPTER_DELETED event uses camelCase field names."""
        chapter_data = {
            "chapterId": "ch-delete-456",
            "projectId": "proj-456"
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_chapter_crud(
            chapter_data,
            event_type=EventType.CHAPTER_DELETED
        )

        event = await capture_task
        import json
        data = json.loads(event["data"])

        validate_camel_case_fields(data, ["chapterId", "projectId"])
        assert data["chapterId"] == "ch-delete-456"


class TestChapterReorderedEvent:
    """Tests for chapter.reordered SSE event."""

    @pytest.mark.asyncio
    async def test_chapter_reordered_event_structure(self):
        """CHAPTER_REORDERED event has correct structure and channel."""
        chapter_data = {
            "chapterId": "ch-reorder-123",
            "projectId": "proj-123",
            "orderIndex": 2
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_chapter_crud(
            chapter_data,
            event_type=EventType.CHAPTER_REORDERED
        )

        event = await capture_task
        validate_sse_structure(event)

        import json
        data = json.loads(event["data"])
        validate_event_data(data, EventType.CHAPTER_REORDERED, "projects")

    @pytest.mark.asyncio
    async def test_chapter_reordered_uses_camel_case(self):
        """CHAPTER_REORDERED event uses camelCase field names."""
        chapter_data = {
            "chapterId": "ch-reorder-456",
            "projectId": "proj-456",
            "orderIndex": 3
        }

        capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
        await asyncio.sleep(0.1)

        await broadcaster.broadcast_chapter_crud(
            chapter_data,
            event_type=EventType.CHAPTER_REORDERED
        )

        event = await capture_task
        import json
        data = json.loads(event["data"])

        validate_camel_case_fields(data, ["chapterId", "projectId", "orderIndex"])
        assert data["orderIndex"] == 3


# ============================================================================
# Channel Validation Tests
# ============================================================================

class TestEventChannelRouting:
    """Tests that all project/chapter events use the correct channel."""

    @pytest.mark.asyncio
    async def test_all_project_events_use_projects_channel(self):
        """All project events broadcast on 'projects' channel."""
        test_cases = [
            (EventType.PROJECT_CREATED, {"projectId": "p1"}),
            (EventType.PROJECT_UPDATED, {"projectId": "p2"}),
            (EventType.PROJECT_DELETED, {"projectId": "p3"}),
        ]

        for event_type, data in test_cases:
            capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
            await asyncio.sleep(0.1)

            await broadcaster.broadcast_project_update(data, event_type=event_type)

            event = await capture_task
            import json
            parsed = json.loads(event["data"])
            assert parsed["_channel"] == "projects", \
                f"{event_type} must use 'projects' channel"

    @pytest.mark.asyncio
    async def test_all_chapter_events_use_projects_channel(self):
        """All chapter events broadcast on 'projects' channel."""
        test_cases = [
            (EventType.CHAPTER_CREATED, {"chapterId": "ch1", "projectId": "p1"}),
            (EventType.CHAPTER_UPDATED, {"chapterId": "ch2"}),
            (EventType.CHAPTER_DELETED, {"chapterId": "ch3", "projectId": "p3"}),
            (EventType.CHAPTER_REORDERED, {"chapterId": "ch4", "projectId": "p4"}),
        ]

        for event_type, data in test_cases:
            capture_task = asyncio.create_task(capture_sse_event(channel="projects"))
            await asyncio.sleep(0.1)

            if event_type == EventType.CHAPTER_UPDATED:
                await broadcaster.broadcast_chapter_update(data)
            else:
                await broadcaster.broadcast_chapter_crud(data, event_type=event_type)

            event = await capture_task
            import json
            parsed = json.loads(event["data"])
            assert parsed["_channel"] == "projects", \
                f"{event_type} must use 'projects' channel"
