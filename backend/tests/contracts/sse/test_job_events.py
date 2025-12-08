"""
Contract Tests for SSE TTS Job Events

These tests verify that TTS job SSE events have the correct structure,
use camelCase field names, include required metadata, and broadcast
on the correct channel.

Event Types Tested (8):
- JOB_CREATED
- JOB_STARTED
- JOB_PROGRESS
- JOB_COMPLETED
- JOB_FAILED
- JOB_CANCELLING
- JOB_CANCELLED
- JOB_RESUMED

Channel: "jobs"
"""

import pytest
from unittest.mock import patch
from services.event_broadcaster import (
    broadcaster,
    EventType,
    emit_job_created,
    emit_job_started,
    emit_job_progress,
    emit_job_completed,
    emit_job_failed,
    emit_job_cancelling,
    emit_job_cancelled,
    emit_job_resumed,
)
from datetime import datetime


class TestJobCreatedEvent:
    """Contract tests for JOB_CREATED event."""

    @pytest.mark.asyncio
    async def test_job_created_has_required_fields(self):
        """JOB_CREATED event should contain all required fields."""
        captured_events = []

        # Mock broadcast_event to capture the event
        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_created(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1", "seg-2"],
                tts_engine="xtts",
                tts_model_name="v2.0.2",
                tts_speaker_name="narrator"
            )

        assert len(captured_events) == 1
        event = captured_events[0]

        # Verify event type
        assert event["event_type"] == EventType.JOB_CREATED

        # Verify channel
        assert event["channel"] == "jobs"

        # Verify required fields in data
        data = event["data"]
        required_fields = [
            "jobId",
            "chapterId",
            "status",
            "totalSegments",
            "processedSegments",
            "progress",
            "segmentIds",
        ]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from JOB_CREATED event"

    @pytest.mark.asyncio
    async def test_job_created_uses_camel_case(self):
        """JOB_CREATED event should use camelCase field names."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_created(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1"],
                tts_engine="xtts",
                tts_model_name="v2.0.2",
                tts_speaker_name="narrator"
            )

        data = captured_events[0]["data"]

        # Verify camelCase fields
        expected_camel_fields = [
            "jobId",
            "chapterId",
            "totalSegments",
            "processedSegments",
            "segmentIds",
            "ttsEngine",
            "ttsModelName",
            "ttsSpeakerName",
        ]
        for field in expected_camel_fields:
            assert field in data, f"Expected camelCase field '{field}' not found"

        # Verify no snake_case fields
        snake_case_fields = [
            "job_id",
            "chapter_id",
            "total_segments",
            "processed_segments",
            "segment_ids",
            "tts_engine",
            "tts_model_name",
            "tts_speaker_name",
        ]
        for field in snake_case_fields:
            assert field not in data, f"Unexpected snake_case field '{field}' found"

    @pytest.mark.asyncio
    async def test_job_created_field_types(self):
        """JOB_CREATED event fields should have correct types."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_created(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1", "seg-2"],
                tts_engine="xtts"
            )

        data = captured_events[0]["data"]

        assert isinstance(data["jobId"], str)
        assert isinstance(data["chapterId"], str)
        assert isinstance(data["status"], str)
        assert data["status"] == "pending"
        assert isinstance(data["totalSegments"], int)
        assert isinstance(data["processedSegments"], int)
        assert data["processedSegments"] == 0
        assert isinstance(data["progress"], float)
        assert data["progress"] == 0.0
        assert isinstance(data["segmentIds"], list)


class TestJobStartedEvent:
    """Contract tests for JOB_STARTED event."""

    @pytest.mark.asyncio
    async def test_job_started_has_required_fields(self):
        """JOB_STARTED event should contain all required fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_started(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1", "seg-2"],
                processed_segments=0,
                started_at="2024-01-01T12:00:00",
                tts_engine="xtts"
            )

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event["event_type"] == EventType.JOB_STARTED
        assert event["channel"] == "jobs"

        data = event["data"]
        required_fields = [
            "jobId",
            "chapterId",
            "status",
            "totalSegments",
            "processedSegments",
            "progress",
            "segmentIds",
            "startedAt",
        ]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from JOB_STARTED event"

    @pytest.mark.asyncio
    async def test_job_started_uses_camel_case(self):
        """JOB_STARTED event should use camelCase field names."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_started(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1"],
                tts_engine="xtts"
            )

        data = captured_events[0]["data"]

        # Verify camelCase fields
        assert "jobId" in data
        assert "chapterId" in data
        assert "totalSegments" in data
        assert "processedSegments" in data
        assert "segmentIds" in data
        assert "startedAt" in data
        assert "ttsEngine" in data

        # Verify no snake_case
        assert "job_id" not in data
        assert "started_at" not in data
        assert "tts_engine" not in data

    @pytest.mark.asyncio
    async def test_job_started_status_is_running(self):
        """JOB_STARTED event should have status 'running'."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_started(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1"]
            )

        data = captured_events[0]["data"]
        assert data["status"] == "running"


class TestJobProgressEvent:
    """Contract tests for JOB_PROGRESS event."""

    @pytest.mark.asyncio
    async def test_job_progress_has_required_fields(self):
        """JOB_PROGRESS event should contain all required fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_progress(
                job_id="job-123",
                chapter_id="chapter-456",
                processed_segments=5,
                total_segments=10,
                progress=50.0,
                segment_ids=["seg-1", "seg-2"],
                message="Processing segment 5",
                failed_segments=1
            )

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event["event_type"] == EventType.JOB_PROGRESS
        assert event["channel"] == "jobs"

        data = event["data"]
        required_fields = [
            "jobId",
            "chapterId",
            "status",
            "processedSegments",
            "totalSegments",
            "progress",
            "segmentIds",
            "failedSegments",
        ]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from JOB_PROGRESS event"

    @pytest.mark.asyncio
    async def test_job_progress_uses_camel_case(self):
        """JOB_PROGRESS event should use camelCase field names."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_progress(
                job_id="job-123",
                chapter_id="chapter-456",
                processed_segments=5,
                total_segments=10,
                progress=50.0,
                segment_ids=["seg-1"],
                failed_segments=0
            )

        data = captured_events[0]["data"]

        assert "processedSegments" in data
        assert "totalSegments" in data
        assert "segmentIds" in data
        assert "failedSegments" in data

        assert "processed_segments" not in data
        assert "failed_segments" not in data

    @pytest.mark.asyncio
    async def test_job_progress_includes_optional_message(self):
        """JOB_PROGRESS event should include optional message field."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_progress(
                job_id="job-123",
                chapter_id="chapter-456",
                processed_segments=5,
                total_segments=10,
                progress=50.0,
                segment_ids=["seg-1"],
                message="Custom progress message"
            )

        data = captured_events[0]["data"]
        assert "message" in data
        assert data["message"] == "Custom progress message"

    @pytest.mark.asyncio
    async def test_job_progress_field_types(self):
        """JOB_PROGRESS event fields should have correct types."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_progress(
                job_id="job-123",
                chapter_id="chapter-456",
                processed_segments=5,
                total_segments=10,
                progress=50.0,
                segment_ids=["seg-1", "seg-2"],
                failed_segments=1
            )

        data = captured_events[0]["data"]

        assert isinstance(data["processedSegments"], int)
        assert isinstance(data["totalSegments"], int)
        assert isinstance(data["progress"], float)
        assert isinstance(data["failedSegments"], int)


class TestJobCompletedEvent:
    """Contract tests for JOB_COMPLETED event."""

    @pytest.mark.asyncio
    async def test_job_completed_has_required_fields(self):
        """JOB_COMPLETED event should contain all required fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_completed(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1", "seg-2"]
            )

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event["event_type"] == EventType.JOB_COMPLETED
        assert event["channel"] == "jobs"

        data = event["data"]
        required_fields = [
            "jobId",
            "chapterId",
            "status",
            "totalSegments",
            "processedSegments",
            "progress",
            "segmentIds",
        ]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from JOB_COMPLETED event"

    @pytest.mark.asyncio
    async def test_job_completed_status_and_progress(self):
        """JOB_COMPLETED event should have status 'completed' and progress 100.0."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_completed(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1"]
            )

        data = captured_events[0]["data"]
        assert data["status"] == "completed"
        assert data["progress"] == 100.0
        assert data["processedSegments"] == data["totalSegments"]


class TestJobFailedEvent:
    """Contract tests for JOB_FAILED event."""

    @pytest.mark.asyncio
    async def test_job_failed_has_required_fields(self):
        """JOB_FAILED event should contain all required fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_failed(
                job_id="job-123",
                chapter_id="chapter-456",
                error="Engine not available",
                segment_ids=["seg-1", "seg-2"]
            )

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event["event_type"] == EventType.JOB_FAILED
        assert event["channel"] == "jobs"

        data = event["data"]
        required_fields = [
            "jobId",
            "chapterId",
            "status",
            "error",
            "segmentIds",
        ]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from JOB_FAILED event"

    @pytest.mark.asyncio
    async def test_job_failed_status_is_failed(self):
        """JOB_FAILED event should have status 'failed'."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_failed(
                job_id="job-123",
                chapter_id="chapter-456",
                error="Test error",
                segment_ids=["seg-1"]
            )

        data = captured_events[0]["data"]
        assert data["status"] == "failed"
        assert isinstance(data["error"], str)


class TestJobCancellingEvent:
    """Contract tests for JOB_CANCELLING event."""

    @pytest.mark.asyncio
    async def test_job_cancelling_has_required_fields(self):
        """JOB_CANCELLING event should contain all required fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_cancelling(
                job_id="job-123",
                chapter_id="chapter-456"
            )

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event["event_type"] == EventType.JOB_CANCELLING
        assert event["channel"] == "jobs"

        data = event["data"]
        required_fields = ["jobId", "chapterId", "status"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from JOB_CANCELLING event"

    @pytest.mark.asyncio
    async def test_job_cancelling_status_is_cancelling(self):
        """JOB_CANCELLING event should have status 'cancelling'."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_cancelling(
                job_id="job-123",
                chapter_id="chapter-456"
            )

        data = captured_events[0]["data"]
        assert data["status"] == "cancelling"


class TestJobCancelledEvent:
    """Contract tests for JOB_CANCELLED event."""

    @pytest.mark.asyncio
    async def test_job_cancelled_has_required_fields(self):
        """JOB_CANCELLED event should contain all required fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_cancelled(
                job_id="job-123",
                chapter_id="chapter-456",
                segment_ids=["seg-1", "seg-2"]
            )

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event["event_type"] == EventType.JOB_CANCELLED
        assert event["channel"] == "jobs"

        data = event["data"]
        required_fields = ["jobId", "chapterId", "status", "segmentIds"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from JOB_CANCELLED event"

    @pytest.mark.asyncio
    async def test_job_cancelled_status_is_cancelled(self):
        """JOB_CANCELLED event should have status 'cancelled'."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_cancelled(
                job_id="job-123",
                chapter_id="chapter-456",
                segment_ids=["seg-1"]
            )

        data = captured_events[0]["data"]
        assert data["status"] == "cancelled"


class TestJobResumedEvent:
    """Contract tests for JOB_RESUMED event."""

    @pytest.mark.asyncio
    async def test_job_resumed_has_required_fields(self):
        """JOB_RESUMED event should contain all required fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_resumed(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1", "seg-2"]
            )

        assert len(captured_events) == 1
        event = captured_events[0]

        assert event["event_type"] == EventType.JOB_RESUMED
        assert event["channel"] == "jobs"

        data = event["data"]
        required_fields = [
            "jobId",
            "chapterId",
            "status",
            "totalSegments",
            "processedSegments",
            "progress",
            "segmentIds",
            "resumedAt",
        ]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing from JOB_RESUMED event"

    @pytest.mark.asyncio
    async def test_job_resumed_uses_camel_case(self):
        """JOB_RESUMED event should use camelCase field names."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_resumed(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1"]
            )

        data = captured_events[0]["data"]

        assert "resumedAt" in data
        assert "totalSegments" in data
        assert "processedSegments" in data

        assert "resumed_at" not in data
        assert "total_segments" not in data

    @pytest.mark.asyncio
    async def test_job_resumed_status_and_initial_values(self):
        """JOB_RESUMED event should have status 'pending' and reset progress."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_resumed(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1"]
            )

        data = captured_events[0]["data"]
        assert data["status"] == "pending"
        assert data["processedSegments"] == 0
        assert data["progress"] == 0.0

    @pytest.mark.asyncio
    async def test_job_resumed_includes_timestamp(self):
        """JOB_RESUMED event should include resumedAt timestamp."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_job_resumed(
                job_id="job-123",
                chapter_id="chapter-456",
                total_segments=10,
                segment_ids=["seg-1"]
            )

        data = captured_events[0]["data"]
        assert "resumedAt" in data
        assert isinstance(data["resumedAt"], str)
        # Verify it's a valid ISO timestamp (will raise ValueError if not)
        datetime.fromisoformat(data["resumedAt"])


class TestJobEventsBroadcast:
    """Test that job events use the broadcast_event method correctly."""

    @pytest.mark.asyncio
    async def test_all_job_events_broadcast_on_jobs_channel(self):
        """All job events should broadcast on the 'jobs' channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            # Emit all 8 job events
            await emit_job_created("job-1", "ch-1", 10, ["seg-1"])
            await emit_job_started("job-1", "ch-1", 10, ["seg-1"])
            await emit_job_progress("job-1", "ch-1", 5, 10, 50.0, ["seg-1"])
            await emit_job_completed("job-1", "ch-1", 10, ["seg-1"])
            await emit_job_failed("job-1", "ch-1", "error", ["seg-1"])
            await emit_job_cancelling("job-1", "ch-1")
            await emit_job_cancelled("job-1", "ch-1", ["seg-1"])
            await emit_job_resumed("job-1", "ch-1", 10, ["seg-1"])

        # Verify all 8 events broadcasted on "jobs" channel
        assert len(captured_events) == 8
        for event in captured_events:
            assert event["channel"] == "jobs"
