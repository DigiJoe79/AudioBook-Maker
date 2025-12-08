"""
Contract Tests for Quality Job SSE Events

Tests the event structure and camelCase conversion for all quality-related
Server-Sent Events (SSE).

Event Types (9):
- QUALITY_JOB_CREATED
- QUALITY_JOB_STARTED
- QUALITY_JOB_PROGRESS
- QUALITY_JOB_COMPLETED
- QUALITY_JOB_FAILED
- QUALITY_JOB_CANCELLED
- QUALITY_JOB_RESUMED
- QUALITY_SEGMENT_ANALYZED
- QUALITY_SEGMENT_FAILED

Channel: "quality"
"""

import pytest
from unittest.mock import patch
from services.event_broadcaster import (
    broadcaster,
    EventType,
    emit_quality_job_created,
    emit_quality_job_started,
    emit_quality_job_progress,
    emit_quality_job_completed,
    emit_quality_job_failed,
    emit_quality_job_cancelled,
    emit_quality_job_resumed,
    emit_quality_segment_analyzed,
    emit_quality_segment_failed,
)


class TestQualityJobCreatedEvent:
    """Contract tests for QUALITY_JOB_CREATED event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_JOB_CREATED event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "data": data, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_created(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                total_segments=10,
                segment_ids=["seg-1", "seg-2"],
                job_type="chapter"
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_JOB_CREATED
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_JOB_CREATED event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_created(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                total_segments=10,
                segment_ids=["seg-1", "seg-2"],
                job_type="chapter",
                chapter_title="Test Chapter",
                project_title="Test Project",
                stt_engine="whisper",
                audio_engine="silero-vad"
            )

        data = captured_events[0]["data"]
        required_fields = [
            "jobId", "chapterId", "totalSegments", "processedSegments",
            "progress", "segmentIds", "jobType", "chapterTitle",
            "projectTitle", "sttEngine", "audioEngine"
        ]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_JOB_CREATED event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_created(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                total_segments=10,
                segment_ids=["seg-1"],
                job_type="chapter"
            )

        data = captured_events[0]["data"]
        forbidden_fields = [
            "job_id", "chapter_id", "total_segments", "processed_segments",
            "segment_ids", "job_type", "chapter_title", "project_title",
            "stt_engine", "audio_engine"
        ]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"


class TestQualityJobStartedEvent:
    """Contract tests for QUALITY_JOB_STARTED event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_JOB_STARTED event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_started(
                job_id="quality-job-1",
                chapter_id="chapter-1"
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_JOB_STARTED
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_JOB_STARTED event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_started(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                total_segments=10,
                processed_segments=0,
                started_at="2025-12-06T10:00:00"
            )

        data = captured_events[0]["data"]
        required_fields = ["jobId", "chapterId", "totalSegments", "processedSegments", "startedAt"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_JOB_STARTED event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_started(
                job_id="quality-job-1",
                chapter_id="chapter-1"
            )

        data = captured_events[0]["data"]
        forbidden_fields = ["job_id", "chapter_id", "total_segments", "processed_segments", "started_at"]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"


class TestQualityJobProgressEvent:
    """Contract tests for QUALITY_JOB_PROGRESS event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_JOB_PROGRESS event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_progress(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                processed_segments=5,
                total_segments=10,
                progress=50.0
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_JOB_PROGRESS
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_JOB_PROGRESS event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_progress(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                processed_segments=5,
                total_segments=10,
                progress=50.0
            )

        data = captured_events[0]["data"]
        required_fields = ["jobId", "chapterId", "processedSegments", "totalSegments", "progress"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_JOB_PROGRESS event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_progress(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                processed_segments=5,
                total_segments=10,
                progress=50.0
            )

        data = captured_events[0]["data"]
        forbidden_fields = ["job_id", "chapter_id", "processed_segments", "total_segments"]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"


class TestQualityJobCompletedEvent:
    """Contract tests for QUALITY_JOB_COMPLETED event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_JOB_COMPLETED event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_completed(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                total_segments=10
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_JOB_COMPLETED
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_JOB_COMPLETED event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_completed(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                total_segments=10
            )

        data = captured_events[0]["data"]
        required_fields = ["jobId", "chapterId", "totalSegments", "processedSegments", "progress"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

        # Verify completion sets progress to 100%
        assert data["progress"] == 100.0
        assert data["processedSegments"] == data["totalSegments"]

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_JOB_COMPLETED event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_completed(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                total_segments=10
            )

        data = captured_events[0]["data"]
        forbidden_fields = ["job_id", "chapter_id", "total_segments", "processed_segments"]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"


class TestQualityJobFailedEvent:
    """Contract tests for QUALITY_JOB_FAILED event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_JOB_FAILED event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_failed(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                error="Analysis failed"
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_JOB_FAILED
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_JOB_FAILED event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_failed(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                error="STT engine unavailable"
            )

        data = captured_events[0]["data"]
        required_fields = ["jobId", "chapterId", "error"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

        assert data["error"] == "STT engine unavailable"

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_JOB_FAILED event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_failed(
                job_id="quality-job-1",
                chapter_id="chapter-1",
                error="Error"
            )

        data = captured_events[0]["data"]
        forbidden_fields = ["job_id", "chapter_id"]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"


class TestQualityJobCancelledEvent:
    """Contract tests for QUALITY_JOB_CANCELLED event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_JOB_CANCELLED event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_cancelled(
                job_id="quality-job-1",
                chapter_id="chapter-1"
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_JOB_CANCELLED
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_JOB_CANCELLED event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_cancelled(
                job_id="quality-job-1",
                chapter_id="chapter-1"
            )

        data = captured_events[0]["data"]
        required_fields = ["jobId", "chapterId"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_JOB_CANCELLED event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_cancelled(
                job_id="quality-job-1",
                chapter_id="chapter-1"
            )

        data = captured_events[0]["data"]
        forbidden_fields = ["job_id", "chapter_id"]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"


class TestQualityJobResumedEvent:
    """Contract tests for QUALITY_JOB_RESUMED event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_JOB_RESUMED event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_resumed(
                job_id="quality-job-1",
                chapter_id="chapter-1"
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_JOB_RESUMED
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_JOB_RESUMED event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_resumed(
                job_id="quality-job-1",
                chapter_id="chapter-1"
            )

        data = captured_events[0]["data"]
        required_fields = ["jobId", "chapterId", "resumedAt"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

        # Verify resumedAt contains ISO timestamp
        assert "T" in data["resumedAt"], "resumedAt should be ISO format timestamp"

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_JOB_RESUMED event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_job_resumed(
                job_id="quality-job-1",
                chapter_id="chapter-1"
            )

        data = captured_events[0]["data"]
        forbidden_fields = ["job_id", "chapter_id", "resumed_at"]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"


class TestQualitySegmentAnalyzedEvent:
    """Contract tests for QUALITY_SEGMENT_ANALYZED event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_SEGMENT_ANALYZED event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_segment_analyzed(
                segment_id="seg-1",
                chapter_id="chapter-1",
                job_id="quality-job-1",
                quality_score=85.5,
                quality_status="perfect",
                engine_results=[]
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_SEGMENT_ANALYZED
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_SEGMENT_ANALYZED event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_segment_analyzed(
                segment_id="seg-1",
                chapter_id="chapter-1",
                job_id="quality-job-1",
                quality_score=85.5,
                quality_status="perfect",
                engine_results=[
                    {
                        "engineType": "stt",
                        "engineName": "whisper",
                        "qualityScore": 90.0,
                        "qualityStatus": "perfect"
                    }
                ]
            )

        data = captured_events[0]["data"]
        required_fields = ["segmentId", "chapterId", "jobId", "qualityScore", "qualityStatus", "engineResults"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

        # Verify engine results structure
        assert isinstance(data["engineResults"], list)
        if len(data["engineResults"]) > 0:
            result = data["engineResults"][0]
            assert "engineType" in result
            assert "engineName" in result
            assert "qualityScore" in result
            assert "qualityStatus" in result

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_SEGMENT_ANALYZED event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_segment_analyzed(
                segment_id="seg-1",
                chapter_id="chapter-1",
                job_id="quality-job-1",
                quality_score=85.5,
                quality_status="perfect",
                engine_results=[]
            )

        data = captured_events[0]["data"]
        forbidden_fields = ["segment_id", "chapter_id", "job_id", "quality_score", "quality_status", "engine_results"]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"


class TestQualitySegmentFailedEvent:
    """Contract tests for QUALITY_SEGMENT_FAILED event."""

    @pytest.mark.asyncio
    async def test_event_type_and_channel(self):
        """QUALITY_SEGMENT_FAILED event should have correct type and channel."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"event_type": event_type, "channel": channel})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_segment_failed(
                segment_id="seg-1",
                chapter_id="chapter-1",
                job_id="quality-job-1",
                error="Segment analysis failed"
            )

        assert len(captured_events) == 1
        event = captured_events[0]
        assert event["event_type"] == EventType.QUALITY_SEGMENT_FAILED
        assert event["channel"] == "quality"

    @pytest.mark.asyncio
    async def test_has_required_camel_case_fields(self):
        """QUALITY_SEGMENT_FAILED event should have all required fields in camelCase."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_segment_failed(
                segment_id="seg-1",
                chapter_id="chapter-1",
                job_id="quality-job-1",
                error="Audio file not found"
            )

        data = captured_events[0]["data"]
        required_fields = ["segmentId", "chapterId", "jobId", "error"]
        for field in required_fields:
            assert field in data, f"Required field '{field}' missing"

        assert data["error"] == "Audio file not found"

    @pytest.mark.asyncio
    async def test_no_snake_case_fields(self):
        """QUALITY_SEGMENT_FAILED event should not contain snake_case fields."""
        captured_events = []

        async def capture_event(event_type, data, channel, event_id=None):
            captured_events.append({"data": data})

        with patch.object(broadcaster, "broadcast_event", side_effect=capture_event):
            await emit_quality_segment_failed(
                segment_id="seg-1",
                chapter_id="chapter-1",
                job_id="quality-job-1",
                error="Error"
            )

        data = captured_events[0]["data"]
        forbidden_fields = ["segment_id", "chapter_id", "job_id"]
        for field in forbidden_fields:
            assert field not in data, f"Snake_case field '{field}' should not be present"
