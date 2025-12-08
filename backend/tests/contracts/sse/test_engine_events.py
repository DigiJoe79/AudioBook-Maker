"""
SSE Contract Tests for Engine Events

Tests SSE event structure, camelCase conversion, and required fields
for all engine-related events.

Event Types:
- ENGINE_STARTING, ENGINE_STARTED, ENGINE_STOPPING, ENGINE_STOPPED
- ENGINE_ERROR, ENGINE_ENABLED, ENGINE_DISABLED, ENGINE_STATUS

Channel: engines
"""

import asyncio
import json
import pytest
from typing import Callable, Awaitable

from services.event_broadcaster import (
    broadcaster,
    emit_engine_starting,
    emit_engine_started,
    emit_engine_stopping,
    emit_engine_stopped,
    emit_engine_enabled,
    emit_engine_disabled,
    emit_engine_error,
)


async def capture_next_event(emit_func: Callable[[], Awaitable[None]]) -> dict:
    """
    Helper function to capture the next SSE event after emitting.

    Automatically skips 'connected' and initial 'engine.status' events.

    Args:
        emit_func: Async function that emits the event to capture

    Returns:
        The captured event data dictionary
    """
    events = []

    async def capture_events():
        async for event in broadcaster.subscribe(channels=["engines"]):
            if event.get("event") == "connected":
                continue
            # Skip initial engine.status event
            data = json.loads(event["data"]) if isinstance(event["data"], str) else event["data"]
            if data.get("event") == "engine.status":
                continue
            events.append(event)
            break

    # Start subscriber task
    subscriber = asyncio.create_task(capture_events())

    # Give subscriber time to connect
    await asyncio.sleep(0.1)

    # Emit the event
    await emit_func()

    # Wait for event
    await asyncio.wait_for(subscriber, timeout=2.0)

    # Return parsed data
    assert len(events) == 1
    event = events[0]
    return json.loads(event["data"]) if isinstance(event["data"], str) else event["data"]


@pytest.mark.asyncio
class TestEngineStartingEvent:
    """Contract tests for ENGINE_STARTING event."""

    async def test_engine_starting_event_structure(self):
        """Test that ENGINE_STARTING event has correct structure."""
        data = await capture_next_event(
            lambda: emit_engine_starting(engine_type="tts", engine_name="xtts")
        )

        # Standard SSE fields
        assert data["event"] == "engine.starting"
        assert "_timestamp" in data
        assert "_channel" in data
        assert data["_channel"] == "engines"

    async def test_engine_starting_uses_camel_case(self):
        """Test that ENGINE_STARTING event uses camelCase for field names."""
        data = await capture_next_event(
            lambda: emit_engine_starting(engine_type="tts", engine_name="xtts")
        )

        # Should use camelCase
        assert "engineType" in data
        assert "engineName" in data

        # Should NOT use snake_case
        assert "engine_type" not in data
        assert "engine_name" not in data

    async def test_engine_starting_required_fields(self):
        """Test that ENGINE_STARTING event has all required fields."""
        data = await capture_next_event(
            lambda: emit_engine_starting(engine_type="stt", engine_name="whisper")
        )

        # Required fields
        assert data["engineType"] == "stt"
        assert data["engineName"] == "whisper"


@pytest.mark.asyncio
class TestEngineStartedEvent:
    """Contract tests for ENGINE_STARTED event."""

    async def test_engine_started_event_structure(self):
        """Test that ENGINE_STARTED event has correct structure."""
        data = await capture_next_event(
            lambda: emit_engine_started(
                engine_type="tts", engine_name="xtts", port=8001, version="0.1.0"
            )
        )

        assert data["event"] == "engine.started"
        assert data["_channel"] == "engines"

    async def test_engine_started_uses_camel_case(self):
        """Test that ENGINE_STARTED event uses camelCase for field names."""
        data = await capture_next_event(
            lambda: emit_engine_started(
                engine_type="text", engine_name="spacy", port=8003
            )
        )

        assert "engineType" in data
        assert "engineName" in data
        assert "engine_type" not in data

    async def test_engine_started_required_fields(self):
        """Test that ENGINE_STARTED event has all required fields."""
        data = await capture_next_event(
            lambda: emit_engine_started(
                engine_type="audio",
                engine_name="silero-vad",
                port=8004,
                version="1.0.0",
            )
        )

        # Required fields
        assert data["engineType"] == "audio"
        assert data["engineName"] == "silero-vad"
        assert data["status"] == "running"
        assert data["port"] == 8004
        assert data["version"] == "1.0.0"


@pytest.mark.asyncio
class TestEngineStoppingEvent:
    """Contract tests for ENGINE_STOPPING event."""

    async def test_engine_stopping_event_structure(self):
        """Test that ENGINE_STOPPING event has correct structure."""
        data = await capture_next_event(
            lambda: emit_engine_stopping(
                engine_type="tts", engine_name="chatterbox", reason="manual"
            )
        )

        assert data["event"] == "engine.stopping"
        assert data["_channel"] == "engines"

    async def test_engine_stopping_uses_camel_case(self):
        """Test that ENGINE_STOPPING event uses camelCase for field names."""
        data = await capture_next_event(
            lambda: emit_engine_stopping(
                engine_type="tts", engine_name="xtts", reason="inactivity"
            )
        )

        assert "engineType" in data
        assert "engineName" in data
        assert "engine_type" not in data

    async def test_engine_stopping_required_fields(self):
        """Test that ENGINE_STOPPING event has all required fields."""
        data = await capture_next_event(
            lambda: emit_engine_stopping(
                engine_type="stt", engine_name="whisper", reason="error"
            )
        )

        # Required fields
        assert data["engineType"] == "stt"
        assert data["engineName"] == "whisper"
        assert data["reason"] == "error"


@pytest.mark.asyncio
class TestEngineStoppedEvent:
    """Contract tests for ENGINE_STOPPED event."""

    async def test_engine_stopped_event_structure(self):
        """Test that ENGINE_STOPPED event has correct structure."""
        data = await capture_next_event(
            lambda: emit_engine_stopped(
                engine_type="text", engine_name="spacy", reason="manual"
            )
        )

        assert data["event"] == "engine.stopped"
        assert data["_channel"] == "engines"

    async def test_engine_stopped_uses_camel_case(self):
        """Test that ENGINE_STOPPED event uses camelCase for field names."""
        data = await capture_next_event(
            lambda: emit_engine_stopped(
                engine_type="audio", engine_name="silero-vad", reason="inactivity"
            )
        )

        assert "engineType" in data
        assert "engineName" in data
        assert "engine_type" not in data

    async def test_engine_stopped_required_fields(self):
        """Test that ENGINE_STOPPED event has all required fields."""
        data = await capture_next_event(
            lambda: emit_engine_stopped(
                engine_type="tts", engine_name="kani", reason="error"
            )
        )

        # Required fields
        assert data["engineType"] == "tts"
        assert data["engineName"] == "kani"
        assert data["status"] == "stopped"
        assert data["reason"] == "error"


@pytest.mark.asyncio
class TestEngineEnabledEvent:
    """Contract tests for ENGINE_ENABLED event."""

    async def test_engine_enabled_event_structure(self):
        """Test that ENGINE_ENABLED event has correct structure."""
        data = await capture_next_event(
            lambda: emit_engine_enabled(engine_type="tts", engine_name="chatterbox")
        )

        assert data["event"] == "engine.enabled"
        assert data["_channel"] == "engines"

    async def test_engine_enabled_uses_camel_case(self):
        """Test that ENGINE_ENABLED event uses camelCase for field names."""
        data = await capture_next_event(
            lambda: emit_engine_enabled(engine_type="stt", engine_name="whisper")
        )

        assert "engineType" in data
        assert "engineName" in data
        assert "isEnabled" in data
        assert "engine_type" not in data
        assert "is_enabled" not in data

    async def test_engine_enabled_required_fields(self):
        """Test that ENGINE_ENABLED event has all required fields."""
        data = await capture_next_event(
            lambda: emit_engine_enabled(engine_type="text", engine_name="spacy")
        )

        # Required fields
        assert data["engineType"] == "text"
        assert data["engineName"] == "spacy"
        assert data["isEnabled"] is True


@pytest.mark.asyncio
class TestEngineDisabledEvent:
    """Contract tests for ENGINE_DISABLED event."""

    async def test_engine_disabled_event_structure(self):
        """Test that ENGINE_DISABLED event has correct structure."""
        data = await capture_next_event(
            lambda: emit_engine_disabled(engine_type="audio", engine_name="silero-vad")
        )

        assert data["event"] == "engine.disabled"
        assert data["_channel"] == "engines"

    async def test_engine_disabled_uses_camel_case(self):
        """Test that ENGINE_DISABLED event uses camelCase for field names."""
        data = await capture_next_event(
            lambda: emit_engine_disabled(engine_type="tts", engine_name="kani")
        )

        assert "engineType" in data
        assert "engineName" in data
        assert "isEnabled" in data
        assert "engine_type" not in data
        assert "is_enabled" not in data

    async def test_engine_disabled_required_fields(self):
        """Test that ENGINE_DISABLED event has all required fields."""
        data = await capture_next_event(
            lambda: emit_engine_disabled(engine_type="tts", engine_name="chatterbox")
        )

        # Required fields
        assert data["engineType"] == "tts"
        assert data["engineName"] == "chatterbox"
        assert data["isEnabled"] is False


@pytest.mark.asyncio
class TestEngineErrorEvent:
    """Contract tests for ENGINE_ERROR event."""

    async def test_engine_error_event_structure(self):
        """Test that ENGINE_ERROR event has correct structure."""
        data = await capture_next_event(
            lambda: emit_engine_error(
                engine_type="tts",
                engine_name="xtts",
                error="Failed to load model",
                details="CUDA out of memory",
            )
        )

        assert data["event"] == "engine.error"
        assert data["_channel"] == "engines"

    async def test_engine_error_uses_camel_case(self):
        """Test that ENGINE_ERROR event uses camelCase for field names."""
        data = await capture_next_event(
            lambda: emit_engine_error(
                engine_type="stt", engine_name="whisper", error="Connection timeout"
            )
        )

        assert "engineType" in data
        assert "engineName" in data
        assert "engine_type" not in data

    async def test_engine_error_required_fields(self):
        """Test that ENGINE_ERROR event has all required fields."""
        data = await capture_next_event(
            lambda: emit_engine_error(
                engine_type="text",
                engine_name="spacy",
                error="Model not found",
                details="en_core_web_md missing",
            )
        )

        # Required fields
        assert data["engineType"] == "text"
        assert data["engineName"] == "spacy"
        assert data["error"] == "Model not found"
        assert data["details"] == "en_core_web_md missing"

    async def test_engine_error_without_details(self):
        """Test that ENGINE_ERROR event works without optional details field."""
        data = await capture_next_event(
            lambda: emit_engine_error(
                engine_type="audio", engine_name="silero-vad", error="Generic error"
            )
        )

        assert data["error"] == "Generic error"
        # Details should not be present if not provided
        assert "details" not in data


@pytest.mark.asyncio
class TestEngineStatusEvent:
    """Contract tests for ENGINE_STATUS event."""

    async def capture_engine_status(self) -> dict:
        """
        Helper to capture the initial engine.status event.

        Unlike other events, engine.status is automatically sent on connection,
        so we don't skip it - we use it directly for testing.
        """
        events = []

        async def capture_events():
            async for event in broadcaster.subscribe(channels=["engines"]):
                if event.get("event") == "connected":
                    continue
                # Capture the first engine.status event
                data = json.loads(event["data"]) if isinstance(event["data"], str) else event["data"]
                if data.get("event") == "engine.status":
                    events.append(event)
                    break

        # Start subscriber task
        subscriber = asyncio.create_task(capture_events())

        # Give subscriber time to connect and receive initial status
        await asyncio.sleep(0.2)

        # Wait for event
        await asyncio.wait_for(subscriber, timeout=2.0)

        # Return parsed data
        assert len(events) == 1
        event = events[0]
        return json.loads(event["data"]) if isinstance(event["data"], str) else event["data"]

    async def test_engine_status_event_structure(self):
        """Test that ENGINE_STATUS event has correct structure."""
        data = await self.capture_engine_status()

        assert data["event"] == "engine.status"
        assert data["_channel"] == "engines"

    async def test_engine_status_uses_camel_case(self):
        """Test that ENGINE_STATUS event uses camelCase for field names."""
        data = await self.capture_engine_status()

        assert "hasTtsEngine" in data
        assert "hasTextEngine" in data
        assert "hasSttEngine" in data
        assert "hasAudioEngine" in data
        assert "has_tts_engine" not in data

    async def test_engine_status_required_fields(self):
        """Test that ENGINE_STATUS event has all required fields."""
        data = await self.capture_engine_status()

        # Required fields
        assert "engines" in data
        assert "tts" in data["engines"]
        assert "text" in data["engines"]
        assert "stt" in data["engines"]
        assert "audio" in data["engines"]
        assert "hasTtsEngine" in data
        assert "hasTextEngine" in data
        assert "hasSttEngine" in data
        assert "hasAudioEngine" in data
