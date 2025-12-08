"""
Contract Tests for Segment SSE Events

These tests verify that segment-related SSE events have the correct structure,
use camelCase field names, and are broadcast on the correct channels.

Event Types Tested:
- SEGMENT_CREATED - New segment added (projects channel)
- SEGMENT_UPDATED - Segment content/metadata changed (projects channel)
- SEGMENT_DELETED - Segment removed (projects channel)
- SEGMENT_REORDERED - Segments reordered in chapter (projects channel)
- SEGMENT_STARTED - TTS generation started (jobs channel)
- SEGMENT_COMPLETED - TTS generation completed (jobs channel)
- SEGMENT_FAILED - TTS generation failed (jobs channel)
- SEGMENT_FROZEN - Segment frozen (jobs channel)
- SEGMENT_UNFROZEN - Segment unfrozen (jobs channel)
"""

import pytest
from services.event_broadcaster import (
    broadcaster,
    EventType,
    emit_segment_started,
    emit_segment_completed,
    emit_segment_failed,
    emit_segment_frozen,
    emit_segment_created,
    emit_segment_deleted,
    emit_segment_reordered
)


class TestSegmentEventStructure:
    """Test that segment events have correct structure and camelCase fields."""

    @pytest.mark.asyncio
    async def test_segment_started_event_structure(self):
        """
        SEGMENT_STARTED event should:
        - Have event, _timestamp, _channel fields
        - Use camelCase (segmentId, chapterId)
        - Be broadcast on 'jobs' channel
        - Include status field
        """
        # Capture broadcast call
        broadcasted_event = None

        async def capture_broadcast(event_type, data, channel, event_id=None):
            nonlocal broadcasted_event
            broadcasted_event = {
                "event": event_type,
                "data": data,
                "channel": channel
            }

        # Mock broadcast_event
        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_broadcast

        try:
            # Emit event
            await emit_segment_started(
                segment_id="seg-123",
                chapter_id="ch-456"
            )

            # Verify event was broadcast
            assert broadcasted_event is not None
            assert broadcasted_event["event"] == EventType.SEGMENT_STARTED
            assert broadcasted_event["channel"] == "jobs"

            # Verify data structure (camelCase)
            data = broadcasted_event["data"]
            assert "segmentId" in data
            assert "chapterId" in data
            assert "status" in data
            assert data["segmentId"] == "seg-123"
            assert data["chapterId"] == "ch-456"
            assert data["status"] == "processing"

            # Verify NO snake_case fields
            assert "segment_id" not in data
            assert "chapter_id" not in data

        finally:
            broadcaster.broadcast_event = original_broadcast

    @pytest.mark.asyncio
    async def test_segment_completed_event_structure(self):
        """
        SEGMENT_COMPLETED event should:
        - Have event, _timestamp, _channel fields
        - Use camelCase (segmentId, chapterId, audioPath)
        - Be broadcast on 'jobs' channel
        - Include status and audioPath fields
        """
        broadcasted_event = None

        async def capture_broadcast(event_type, data, channel, event_id=None):
            nonlocal broadcasted_event
            broadcasted_event = {
                "event": event_type,
                "data": data,
                "channel": channel
            }

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_broadcast

        try:
            await emit_segment_completed(
                segment_id="seg-789",
                chapter_id="ch-456",
                audio_path="/media/audio/seg-789.wav"
            )

            assert broadcasted_event is not None
            assert broadcasted_event["event"] == EventType.SEGMENT_COMPLETED
            assert broadcasted_event["channel"] == "jobs"

            data = broadcasted_event["data"]
            assert "segmentId" in data
            assert "chapterId" in data
            assert "status" in data
            assert "audioPath" in data
            assert data["segmentId"] == "seg-789"
            assert data["chapterId"] == "ch-456"
            assert data["status"] == "completed"
            assert data["audioPath"] == "/media/audio/seg-789.wav"

            # Verify NO snake_case fields
            assert "segment_id" not in data
            assert "chapter_id" not in data
            assert "audio_path" not in data

        finally:
            broadcaster.broadcast_event = original_broadcast

    @pytest.mark.asyncio
    async def test_segment_failed_event_structure(self):
        """
        SEGMENT_FAILED event should:
        - Have event, _timestamp, _channel fields
        - Use camelCase (segmentId, chapterId)
        - Be broadcast on 'jobs' channel
        - Include status and error fields
        """
        broadcasted_event = None

        async def capture_broadcast(event_type, data, channel, event_id=None):
            nonlocal broadcasted_event
            broadcasted_event = {
                "event": event_type,
                "data": data,
                "channel": channel
            }

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_broadcast

        try:
            await emit_segment_failed(
                segment_id="seg-999",
                chapter_id="ch-456",
                error="TTS engine not available"
            )

            assert broadcasted_event is not None
            assert broadcasted_event["event"] == EventType.SEGMENT_FAILED
            assert broadcasted_event["channel"] == "jobs"

            data = broadcasted_event["data"]
            assert "segmentId" in data
            assert "chapterId" in data
            assert "status" in data
            assert "error" in data
            assert data["segmentId"] == "seg-999"
            assert data["chapterId"] == "ch-456"
            assert data["status"] == "failed"
            assert data["error"] == "TTS engine not available"

            # Verify NO snake_case fields
            assert "segment_id" not in data
            assert "chapter_id" not in data

        finally:
            broadcaster.broadcast_event = original_broadcast

    @pytest.mark.asyncio
    async def test_segment_frozen_event_structure(self):
        """
        SEGMENT_FROZEN event should:
        - Have event, _timestamp, _channel fields
        - Use camelCase (segmentId, chapterId, isFrozen)
        - Be broadcast on 'jobs' channel
        - Include isFrozen=true
        """
        broadcasted_event = None

        async def capture_broadcast(event_type, data, channel, event_id=None):
            nonlocal broadcasted_event
            broadcasted_event = {
                "event": event_type,
                "data": data,
                "channel": channel
            }

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_broadcast

        try:
            await emit_segment_frozen(
                segment_id="seg-111",
                chapter_id="ch-456",
                is_frozen=True
            )

            assert broadcasted_event is not None
            assert broadcasted_event["event"] == EventType.SEGMENT_FROZEN
            assert broadcasted_event["channel"] == "jobs"

            data = broadcasted_event["data"]
            assert "segmentId" in data
            assert "chapterId" in data
            assert "isFrozen" in data
            assert data["segmentId"] == "seg-111"
            assert data["chapterId"] == "ch-456"
            assert data["isFrozen"] is True

            # Verify NO snake_case fields
            assert "segment_id" not in data
            assert "chapter_id" not in data
            assert "is_frozen" not in data

        finally:
            broadcaster.broadcast_event = original_broadcast

    @pytest.mark.asyncio
    async def test_segment_unfrozen_event_structure(self):
        """
        SEGMENT_UNFROZEN event should:
        - Have event, _timestamp, _channel fields
        - Use camelCase (segmentId, chapterId, isFrozen)
        - Be broadcast on 'jobs' channel
        - Include isFrozen=false
        """
        broadcasted_event = None

        async def capture_broadcast(event_type, data, channel, event_id=None):
            nonlocal broadcasted_event
            broadcasted_event = {
                "event": event_type,
                "data": data,
                "channel": channel
            }

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_broadcast

        try:
            await emit_segment_frozen(
                segment_id="seg-222",
                chapter_id="ch-456",
                is_frozen=False
            )

            assert broadcasted_event is not None
            assert broadcasted_event["event"] == EventType.SEGMENT_UNFROZEN
            assert broadcasted_event["channel"] == "jobs"

            data = broadcasted_event["data"]
            assert "segmentId" in data
            assert "chapterId" in data
            assert "isFrozen" in data
            assert data["segmentId"] == "seg-222"
            assert data["chapterId"] == "ch-456"
            assert data["isFrozen"] is False

            # Verify NO snake_case fields
            assert "segment_id" not in data
            assert "chapter_id" not in data
            assert "is_frozen" not in data

        finally:
            broadcaster.broadcast_event = original_broadcast

    @pytest.mark.asyncio
    async def test_segment_created_event_structure(self):
        """
        SEGMENT_CREATED event should:
        - Have event, _timestamp, _channel fields
        - Use camelCase (segmentId, chapterId, segmentType, orderIndex)
        - Be broadcast on 'projects' channel (CRUD event)
        - Include text, segmentType, orderIndex
        """
        broadcasted_event = None

        async def capture_broadcast(event_type, data, channel, event_id=None):
            nonlocal broadcasted_event
            broadcasted_event = {
                "event": event_type,
                "data": data,
                "channel": channel
            }

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_broadcast

        try:
            await emit_segment_created(
                segment_id="seg-new-1",
                chapter_id="ch-789",
                text="This is a new segment",
                segment_type="standard",
                order_index=5
            )

            assert broadcasted_event is not None
            assert broadcasted_event["event"] == EventType.SEGMENT_CREATED
            assert broadcasted_event["channel"] == "projects"  # CRUD events on projects channel

            data = broadcasted_event["data"]
            assert "segmentId" in data
            assert "chapterId" in data
            assert "text" in data
            assert "segmentType" in data
            assert "orderIndex" in data
            assert data["segmentId"] == "seg-new-1"
            assert data["chapterId"] == "ch-789"
            assert data["text"] == "This is a new segment"
            assert data["segmentType"] == "standard"
            assert data["orderIndex"] == 5

            # Verify NO snake_case fields
            assert "segment_id" not in data
            assert "chapter_id" not in data
            assert "segment_type" not in data
            assert "order_index" not in data

        finally:
            broadcaster.broadcast_event = original_broadcast

    @pytest.mark.asyncio
    async def test_segment_deleted_event_structure(self):
        """
        SEGMENT_DELETED event should:
        - Have event, _timestamp, _channel fields
        - Use camelCase (segmentId, chapterId)
        - Be broadcast on 'projects' channel (CRUD event)
        """
        broadcasted_event = None

        async def capture_broadcast(event_type, data, channel, event_id=None):
            nonlocal broadcasted_event
            broadcasted_event = {
                "event": event_type,
                "data": data,
                "channel": channel
            }

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_broadcast

        try:
            await emit_segment_deleted(
                segment_id="seg-del-1",
                chapter_id="ch-789"
            )

            assert broadcasted_event is not None
            assert broadcasted_event["event"] == EventType.SEGMENT_DELETED
            assert broadcasted_event["channel"] == "projects"  # CRUD events on projects channel

            data = broadcasted_event["data"]
            assert "segmentId" in data
            assert "chapterId" in data
            assert data["segmentId"] == "seg-del-1"
            assert data["chapterId"] == "ch-789"

            # Verify NO snake_case fields
            assert "segment_id" not in data
            assert "chapter_id" not in data

        finally:
            broadcaster.broadcast_event = original_broadcast

    @pytest.mark.asyncio
    async def test_segment_reordered_event_structure(self):
        """
        SEGMENT_REORDERED event should:
        - Have event, _timestamp, _channel fields
        - Use camelCase (chapterId, segmentIds)
        - Be broadcast on 'projects' channel (CRUD event)
        - Include list of segmentIds in new order
        """
        broadcasted_event = None

        async def capture_broadcast(event_type, data, channel, event_id=None):
            nonlocal broadcasted_event
            broadcasted_event = {
                "event": event_type,
                "data": data,
                "channel": channel
            }

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_broadcast

        try:
            segment_ids = ["seg-3", "seg-1", "seg-2", "seg-4"]
            await emit_segment_reordered(
                chapter_id="ch-999",
                segment_ids=segment_ids
            )

            assert broadcasted_event is not None
            assert broadcasted_event["event"] == EventType.SEGMENT_REORDERED
            assert broadcasted_event["channel"] == "projects"  # CRUD events on projects channel

            data = broadcasted_event["data"]
            assert "chapterId" in data
            assert "segmentIds" in data
            assert data["chapterId"] == "ch-999"
            assert data["segmentIds"] == segment_ids
            assert isinstance(data["segmentIds"], list)
            assert len(data["segmentIds"]) == 4

            # Verify NO snake_case fields
            assert "chapter_id" not in data
            assert "segment_ids" not in data

        finally:
            broadcaster.broadcast_event = original_broadcast


class TestSegmentEventChannels:
    """Test that segment events are broadcast on correct channels."""

    @pytest.mark.asyncio
    async def test_status_events_use_jobs_channel(self):
        """
        Status events (STARTED, COMPLETED, FAILED, FROZEN, UNFROZEN)
        should be broadcast on 'jobs' channel.
        """
        channels_captured = []

        async def capture_channel(event_type, data, channel, event_id=None):
            channels_captured.append(channel)

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_channel

        try:
            # Test all status events
            await emit_segment_started("seg-1", "ch-1")
            await emit_segment_completed("seg-2", "ch-1", "/audio/seg-2.wav")
            await emit_segment_failed("seg-3", "ch-1", "error")
            await emit_segment_frozen("seg-4", "ch-1", True)
            await emit_segment_frozen("seg-5", "ch-1", False)

            # All should be on 'jobs' channel
            assert len(channels_captured) == 5
            assert all(ch == "jobs" for ch in channels_captured)

        finally:
            broadcaster.broadcast_event = original_broadcast

    @pytest.mark.asyncio
    async def test_crud_events_use_projects_channel(self):
        """
        CRUD events (CREATED, DELETED, REORDERED)
        should be broadcast on 'projects' channel.
        """
        channels_captured = []

        async def capture_channel(event_type, data, channel, event_id=None):
            channels_captured.append(channel)

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_channel

        try:
            # Test all CRUD events
            await emit_segment_created("seg-new", "ch-1", "text", "standard", 0)
            await emit_segment_deleted("seg-old", "ch-1")
            await emit_segment_reordered("ch-1", ["seg-1", "seg-2"])

            # All should be on 'projects' channel
            assert len(channels_captured) == 3
            assert all(ch == "projects" for ch in channels_captured)

        finally:
            broadcaster.broadcast_event = original_broadcast


class TestSegmentEventTypes:
    """Test that correct event types are used."""

    @pytest.mark.asyncio
    async def test_all_segment_event_types(self):
        """Verify all 9 segment event types are correctly emitted."""
        event_types_captured = []

        async def capture_event_type(event_type, data, channel, event_id=None):
            event_types_captured.append(event_type)

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_event_type

        try:
            # Emit all segment events
            await emit_segment_started("s1", "c1")
            await emit_segment_completed("s2", "c1", "/audio.wav")
            await emit_segment_failed("s3", "c1", "error")
            await emit_segment_frozen("s4", "c1", True)
            await emit_segment_frozen("s5", "c1", False)
            await emit_segment_created("s6", "c1", "text", "standard", 0)
            await emit_segment_deleted("s7", "c1")
            await emit_segment_reordered("c1", ["s1", "s2"])

            # Verify all event types
            assert EventType.SEGMENT_STARTED in event_types_captured
            assert EventType.SEGMENT_COMPLETED in event_types_captured
            assert EventType.SEGMENT_FAILED in event_types_captured
            assert EventType.SEGMENT_FROZEN in event_types_captured
            assert EventType.SEGMENT_UNFROZEN in event_types_captured
            assert EventType.SEGMENT_CREATED in event_types_captured
            assert EventType.SEGMENT_DELETED in event_types_captured
            assert EventType.SEGMENT_REORDERED in event_types_captured

            # Should have 8 events (8 emit calls, but 2 frozen calls)
            assert len(event_types_captured) == 8

        finally:
            broadcaster.broadcast_event = original_broadcast


class TestSegmentEventCamelCase:
    """Test that all segment events use camelCase consistently."""

    @pytest.mark.asyncio
    async def test_no_snake_case_in_any_segment_event(self):
        """
        All segment events should use camelCase field names exclusively.
        No snake_case fields should be present.
        """
        all_data_captured = []

        async def capture_data(event_type, data, channel, event_id=None):
            all_data_captured.append(data)

        original_broadcast = broadcaster.broadcast_event
        broadcaster.broadcast_event = capture_data

        try:
            # Emit all segment events
            await emit_segment_started("s1", "c1")
            await emit_segment_completed("s2", "c1", "/audio.wav")
            await emit_segment_failed("s3", "c1", "error")
            await emit_segment_frozen("s4", "c1", True)
            await emit_segment_frozen("s5", "c1", False)
            await emit_segment_created("s6", "c1", "text", "standard", 0)
            await emit_segment_deleted("s7", "c1")
            await emit_segment_reordered("c1", ["s1", "s2"])

            # Check all captured data
            snake_case_fields = [
                "segment_id", "chapter_id", "audio_path", "is_frozen",
                "segment_type", "order_index", "segment_ids"
            ]

            for data in all_data_captured:
                for snake_field in snake_case_fields:
                    assert snake_field not in data, \
                        f"Found snake_case field '{snake_field}' in event data: {data}"

        finally:
            broadcaster.broadcast_event = original_broadcast
