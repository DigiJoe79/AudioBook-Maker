"""
SSE Contract Tests for System Events

Tests event structure, camelCase conversion, and channel routing for:
- Health events (1 type)
- Settings events (2 types)
- Speaker events (5 types)
- Pronunciation events (5 types)
- Export events (5 types)
- Import events (5 types)

Event structure validation ensures frontend SSE handlers receive correctly
formatted events with proper camelCase field names.
"""

import pytest
from services.event_broadcaster import (
    broadcaster,
    EventType,
    # Health
    # Settings
    # Speaker
    # Pronunciation
    # Export
    # Import
    emit_import_cancelled,
)


class TestHealthEvents:
    """Contract tests for health events (channel: health)."""

    @pytest.mark.asyncio
    async def test_health_update_event_structure(self):
        """HEALTH_UPDATE event should have correct structure and camelCase fields."""
        test_data = {
            "status": "ok",
            "activeJobs": 2,
            "busy": True,
            "hasTtsEngine": True,
            "hasTextEngine": True,
            "hasSttEngine": False,
            "hasAudioEngine": False,
        }

        # Mock client to capture event
        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-health"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("health", set()).add(client_id)

            # Broadcast event
            await broadcaster.broadcast_health_update(test_data)

            # Capture event
            event = await queue.get()
            captured_events.append(event)

            # Cleanup
            del broadcaster.clients[client_id]
            broadcaster.subscriptions["health"].discard(client_id)

        await mock_subscribe()

        # Assertions
        assert len(captured_events) == 1
        event = captured_events[0]

        # Event has correct structure
        assert "data" in event
        assert "id" in event

        # Parse data payload
        event_data = event["data"]

        # Event type is in data payload
        assert event_data["event"] == EventType.HEALTH_UPDATE

        # Channel is correct
        assert event_data["_channel"] == "health"

        # Original data is preserved with camelCase
        assert event_data["status"] == "ok"
        assert event_data["activeJobs"] == 2
        assert event_data["busy"] is True
        assert event_data["hasTtsEngine"] is True

        # NO snake_case fields
        assert "active_jobs" not in event_data
        assert "has_tts_engine" not in event_data

        # Metadata fields present
        assert "_timestamp" in event_data
        assert "_channel" in event_data


class TestSettingsEvents:
    """Contract tests for settings events (channel: settings)."""

    @pytest.mark.asyncio
    async def test_settings_updated_event_structure(self):
        """SETTINGS_UPDATED event should have correct structure and camelCase fields."""
        test_data = {
            "key": "tts",
            "value": {
                "defaultEngine": "xtts",
                "defaultModelName": "main",
            }
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-settings"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("settings", set()).add(client_id)

            await broadcaster.broadcast_settings_update(test_data, EventType.SETTINGS_UPDATED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["settings"].discard(client_id)

        await mock_subscribe()

        assert len(captured_events) == 1
        event = captured_events[0]
        event_data = event["data"]

        assert event_data["event"] == EventType.SETTINGS_UPDATED
        assert event_data["_channel"] == "settings"
        assert event_data["key"] == "tts"
        assert "value" in event_data
        assert event_data["value"]["defaultEngine"] == "xtts"

        # NO snake_case
        assert "default_engine" not in str(event_data)

    @pytest.mark.asyncio
    async def test_settings_reset_event_structure(self):
        """SETTINGS_RESET event should have correct structure."""
        test_data = {
            "message": "Settings reset to defaults"
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-settings-reset"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("settings", set()).add(client_id)

            await broadcaster.broadcast_settings_update(test_data, EventType.SETTINGS_RESET)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["settings"].discard(client_id)

        await mock_subscribe()

        assert len(captured_events) == 1
        event_data = captured_events[0]["data"]

        assert event_data["event"] == EventType.SETTINGS_RESET
        assert event_data["_channel"] == "settings"
        assert "message" in event_data


class TestSpeakerEvents:
    """Contract tests for speaker events (channel: speakers)."""

    @pytest.mark.asyncio
    async def test_speaker_created_event_structure(self):
        """SPEAKER_CREATED event should have correct structure and camelCase fields."""
        test_data = {
            "speakerId": "spk-123",
            "name": "John Doe",
            "gender": "male",
            "languageCode": "en-US",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-speaker"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("speakers", set()).add(client_id)

            await broadcaster.broadcast_speaker_update(test_data, EventType.SPEAKER_CREATED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["speakers"].discard(client_id)

        await mock_subscribe()

        assert len(captured_events) == 1
        event_data = captured_events[0]["data"]

        assert event_data["event"] == EventType.SPEAKER_CREATED
        assert event_data["_channel"] == "speakers"
        assert event_data["speakerId"] == "spk-123"
        assert event_data["name"] == "John Doe"
        assert event_data["languageCode"] == "en-US"

        # NO snake_case
        assert "speaker_id" not in event_data
        assert "language_code" not in event_data

    @pytest.mark.asyncio
    async def test_speaker_updated_event_structure(self):
        """SPEAKER_UPDATED event should have correct structure."""
        test_data = {
            "speakerId": "spk-123",
            "name": "Jane Doe",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-speaker-update"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("speakers", set()).add(client_id)

            await broadcaster.broadcast_speaker_update(test_data, EventType.SPEAKER_UPDATED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["speakers"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.SPEAKER_UPDATED
        assert event_data["_channel"] == "speakers"

    @pytest.mark.asyncio
    async def test_speaker_deleted_event_structure(self):
        """SPEAKER_DELETED event should have correct structure."""
        test_data = {
            "speakerId": "spk-123",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-speaker-delete"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("speakers", set()).add(client_id)

            await broadcaster.broadcast_speaker_update(test_data, EventType.SPEAKER_DELETED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["speakers"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.SPEAKER_DELETED
        assert event_data["_channel"] == "speakers"
        assert event_data["speakerId"] == "spk-123"

    @pytest.mark.asyncio
    async def test_speaker_sample_added_event_structure(self):
        """SPEAKER_SAMPLE_ADDED event should have correct structure."""
        test_data = {
            "speakerId": "spk-123",
            "sampleId": "sample-456",
            "audioPath": "/media/speakers/spk-123/sample-456.wav",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-sample-add"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("speakers", set()).add(client_id)

            await broadcaster.broadcast_speaker_update(test_data, EventType.SPEAKER_SAMPLE_ADDED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["speakers"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.SPEAKER_SAMPLE_ADDED
        assert event_data["_channel"] == "speakers"
        assert event_data["sampleId"] == "sample-456"
        assert event_data["audioPath"] == "/media/speakers/spk-123/sample-456.wav"

        # NO snake_case
        assert "sample_id" not in event_data
        assert "audio_path" not in event_data

    @pytest.mark.asyncio
    async def test_speaker_sample_deleted_event_structure(self):
        """SPEAKER_SAMPLE_DELETED event should have correct structure."""
        test_data = {
            "speakerId": "spk-123",
            "sampleId": "sample-456",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-sample-delete"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("speakers", set()).add(client_id)

            await broadcaster.broadcast_speaker_update(test_data, EventType.SPEAKER_SAMPLE_DELETED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["speakers"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.SPEAKER_SAMPLE_DELETED
        assert event_data["_channel"] == "speakers"


class TestPronunciationEvents:
    """Contract tests for pronunciation events (channel: pronunciation)."""

    @pytest.mark.asyncio
    async def test_pronunciation_rule_created_event_structure(self):
        """PRONUNCIATION_RULE_CREATED event should have correct structure and camelCase fields."""
        test_data = {
            "ruleId": "rule-123",
            "pattern": "Dr\\.",
            "replacement": "Doctor",
            "scope": "global",
            "engineName": None,
            "projectId": None,
            "isRegex": True,
            "isActive": True,
            "priority": 100,
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-pronunciation"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("pronunciation", set()).add(client_id)

            await broadcaster.broadcast_pronunciation_update(test_data, EventType.PRONUNCIATION_RULE_CREATED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["pronunciation"].discard(client_id)

        await mock_subscribe()

        assert len(captured_events) == 1
        event_data = captured_events[0]["data"]

        assert event_data["event"] == EventType.PRONUNCIATION_RULE_CREATED
        assert event_data["_channel"] == "pronunciation"
        assert event_data["ruleId"] == "rule-123"
        assert event_data["pattern"] == "Dr\\."
        assert event_data["replacement"] == "Doctor"
        assert event_data["scope"] == "global"
        assert event_data["isRegex"] is True
        assert event_data["isActive"] is True

        # NO snake_case
        assert "rule_id" not in event_data
        assert "is_regex" not in event_data
        assert "is_active" not in event_data
        assert "engine_name" not in event_data
        assert "project_id" not in event_data

    @pytest.mark.asyncio
    async def test_pronunciation_rule_updated_event_structure(self):
        """PRONUNCIATION_RULE_UPDATED event should have correct structure."""
        test_data = {
            "ruleId": "rule-123",
            "isActive": False,
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-pronunciation-update"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("pronunciation", set()).add(client_id)

            await broadcaster.broadcast_pronunciation_update(test_data, EventType.PRONUNCIATION_RULE_UPDATED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["pronunciation"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.PRONUNCIATION_RULE_UPDATED
        assert event_data["_channel"] == "pronunciation"

    @pytest.mark.asyncio
    async def test_pronunciation_rule_deleted_event_structure(self):
        """PRONUNCIATION_RULE_DELETED event should have correct structure."""
        test_data = {
            "ruleId": "rule-123",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-pronunciation-delete"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("pronunciation", set()).add(client_id)

            await broadcaster.broadcast_pronunciation_update(test_data, EventType.PRONUNCIATION_RULE_DELETED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["pronunciation"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.PRONUNCIATION_RULE_DELETED
        assert event_data["_channel"] == "pronunciation"

    @pytest.mark.asyncio
    async def test_pronunciation_rule_bulk_change_event_structure(self):
        """PRONUNCIATION_RULE_BULK_CHANGE event should have correct structure."""
        test_data = {
            "ruleIds": ["rule-1", "rule-2", "rule-3"],
            "operation": "activate",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-pronunciation-bulk"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("pronunciation", set()).add(client_id)

            await broadcaster.broadcast_pronunciation_update(test_data, EventType.PRONUNCIATION_RULE_BULK_CHANGE)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["pronunciation"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.PRONUNCIATION_RULE_BULK_CHANGE
        assert event_data["_channel"] == "pronunciation"
        assert event_data["ruleIds"] == ["rule-1", "rule-2", "rule-3"]

        # NO snake_case
        assert "rule_ids" not in event_data

    @pytest.mark.asyncio
    async def test_pronunciation_rules_imported_event_structure(self):
        """PRONUNCIATION_RULES_IMPORTED event should have correct structure."""
        test_data = {
            "importedCount": 15,
            "scope": "global",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-pronunciation-import"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("pronunciation", set()).add(client_id)

            await broadcaster.broadcast_pronunciation_update(test_data, EventType.PRONUNCIATION_RULES_IMPORTED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["pronunciation"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.PRONUNCIATION_RULES_IMPORTED
        assert event_data["_channel"] == "pronunciation"
        assert event_data["importedCount"] == 15

        # NO snake_case
        assert "imported_count" not in event_data


class TestExportEvents:
    """Contract tests for export events (channel: export)."""

    @pytest.mark.asyncio
    async def test_export_started_event_structure(self):
        """EXPORT_STARTED event should have correct structure and camelCase fields."""
        test_data = {
            "exportId": "exp-123",
            "chapterId": "ch-1",
            "format": "mp3",
            "filename": "chapter-1.mp3",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-export"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("export", set()).add(client_id)

            await broadcaster.broadcast_export_update(test_data, EventType.EXPORT_STARTED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["export"].discard(client_id)

        await mock_subscribe()

        assert len(captured_events) == 1
        event_data = captured_events[0]["data"]

        assert event_data["event"] == EventType.EXPORT_STARTED
        assert event_data["_channel"] == "export"
        assert event_data["exportId"] == "exp-123"
        assert event_data["chapterId"] == "ch-1"
        assert event_data["format"] == "mp3"

        # NO snake_case
        assert "export_id" not in event_data
        assert "chapter_id" not in event_data

    @pytest.mark.asyncio
    async def test_export_progress_event_structure(self):
        """EXPORT_PROGRESS event should have correct structure."""
        test_data = {
            "exportId": "exp-123",
            "status": "running",
            "progress": 45.5,
            "message": "Encoding audio...",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-export-progress"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("export", set()).add(client_id)

            await broadcaster.broadcast_export_update(test_data, EventType.EXPORT_PROGRESS)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["export"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.EXPORT_PROGRESS
        assert event_data["_channel"] == "export"
        assert event_data["progress"] == 45.5

    @pytest.mark.asyncio
    async def test_export_completed_event_structure(self):
        """EXPORT_COMPLETED event should have correct structure."""
        test_data = {
            "exportId": "exp-123",
            "status": "completed",
            "outputPath": "/media/exports/chapter-1.mp3",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-export-complete"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("export", set()).add(client_id)

            await broadcaster.broadcast_export_update(test_data, EventType.EXPORT_COMPLETED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["export"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.EXPORT_COMPLETED
        assert event_data["_channel"] == "export"
        assert event_data["outputPath"] == "/media/exports/chapter-1.mp3"

        # NO snake_case
        assert "output_path" not in event_data

    @pytest.mark.asyncio
    async def test_export_failed_event_structure(self):
        """EXPORT_FAILED event should have correct structure."""
        test_data = {
            "exportId": "exp-123",
            "status": "failed",
            "error": "FFmpeg encoding failed",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-export-fail"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("export", set()).add(client_id)

            await broadcaster.broadcast_export_update(test_data, EventType.EXPORT_FAILED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["export"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.EXPORT_FAILED
        assert event_data["_channel"] == "export"
        assert "error" in event_data

    @pytest.mark.asyncio
    async def test_export_cancelled_event_structure(self):
        """EXPORT_CANCELLED event should have correct structure."""
        test_data = {
            "exportId": "exp-123",
            "status": "cancelled",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-export-cancel"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("export", set()).add(client_id)

            await broadcaster.broadcast_export_update(test_data, EventType.EXPORT_CANCELLED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["export"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.EXPORT_CANCELLED
        assert event_data["_channel"] == "export"


class TestImportEvents:
    """Contract tests for import events (channel: import)."""

    @pytest.mark.asyncio
    async def test_import_started_event_structure(self):
        """IMPORT_STARTED event should have correct structure and camelCase fields."""
        test_data = {
            "importId": "import-123",
            "projectTitle": "My Audiobook",
            "chapterCount": 15,
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-import"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("import", set()).add(client_id)

            await broadcaster.broadcast_import_update(test_data, EventType.IMPORT_STARTED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["import"].discard(client_id)

        await mock_subscribe()

        assert len(captured_events) == 1
        event_data = captured_events[0]["data"]

        assert event_data["event"] == EventType.IMPORT_STARTED
        assert event_data["_channel"] == "import"
        assert event_data["importId"] == "import-123"
        assert event_data["projectTitle"] == "My Audiobook"
        assert event_data["chapterCount"] == 15

        # NO snake_case
        assert "import_id" not in event_data
        assert "project_title" not in event_data
        assert "chapter_count" not in event_data

    @pytest.mark.asyncio
    async def test_import_progress_event_structure(self):
        """IMPORT_PROGRESS event should have correct structure."""
        test_data = {
            "importId": "import-123",
            "status": "running",
            "progress": 60.0,
            "message": "Creating chapters...",
            "currentChapter": 9,
            "totalChapters": 15,
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-import-progress"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("import", set()).add(client_id)

            await broadcaster.broadcast_import_update(test_data, EventType.IMPORT_PROGRESS)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["import"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.IMPORT_PROGRESS
        assert event_data["_channel"] == "import"
        assert event_data["progress"] == 60.0
        assert event_data["currentChapter"] == 9
        assert event_data["totalChapters"] == 15

        # NO snake_case
        assert "current_chapter" not in event_data
        assert "total_chapters" not in event_data

    @pytest.mark.asyncio
    async def test_import_completed_event_structure(self):
        """IMPORT_COMPLETED event should have correct structure."""
        test_data = {
            "importId": "import-123",
            "status": "completed",
            "projectId": "proj-456",
            "chapterCount": 15,
            "segmentCount": 245,
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-import-complete"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("import", set()).add(client_id)

            await broadcaster.broadcast_import_update(test_data, EventType.IMPORT_COMPLETED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["import"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.IMPORT_COMPLETED
        assert event_data["_channel"] == "import"
        assert event_data["projectId"] == "proj-456"
        assert event_data["segmentCount"] == 245

        # NO snake_case
        assert "project_id" not in event_data
        assert "chapter_count" not in event_data
        assert "segment_count" not in event_data

    @pytest.mark.asyncio
    async def test_import_failed_event_structure(self):
        """IMPORT_FAILED event should have correct structure."""
        test_data = {
            "importId": "import-123",
            "status": "failed",
            "error": "Invalid markdown structure",
        }

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-import-fail"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("import", set()).add(client_id)

            await broadcaster.broadcast_import_update(test_data, EventType.IMPORT_FAILED)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["import"].discard(client_id)

        await mock_subscribe()

        event_data = captured_events[0]["data"]
        assert event_data["event"] == EventType.IMPORT_FAILED
        assert event_data["_channel"] == "import"
        assert "error" in event_data

    @pytest.mark.asyncio
    async def test_import_cancelled_event_structure(self):
        """IMPORT_CANCELLED event should have correct structure using helper function."""
        import_id = "import-123"
        message = "User cancelled import"

        captured_events = []

        async def mock_subscribe():
            client_id = "test-client-import-cancel"
            queue = __import__('asyncio').Queue()
            broadcaster.clients[client_id] = queue
            broadcaster.subscriptions.setdefault("import", set()).add(client_id)

            # Use the helper function
            await emit_import_cancelled(import_id, message)

            event = await queue.get()
            captured_events.append(event)

            del broadcaster.clients[client_id]
            broadcaster.subscriptions["import"].discard(client_id)

        await mock_subscribe()

        assert len(captured_events) == 1
        event_data = captured_events[0]["data"]

        assert event_data["event"] == EventType.IMPORT_CANCELLED
        assert event_data["_channel"] == "import"
        assert event_data["importId"] == import_id
        assert event_data["message"] == message

        # NO snake_case
        assert "import_id" not in event_data


class TestEventChannelRouting:
    """Test that events are routed to correct channels."""

    @pytest.mark.asyncio
    async def test_all_system_events_use_correct_channels(self):
        """Verify that all system events use their designated channels."""
        # Test one event from each category
        test_events = [
            (EventType.HEALTH_UPDATE, "health", broadcaster.broadcast_health_update),
            (EventType.SETTINGS_UPDATED, "settings", lambda data: broadcaster.broadcast_settings_update(data, EventType.SETTINGS_UPDATED)),
            (EventType.SPEAKER_CREATED, "speakers", lambda data: broadcaster.broadcast_speaker_update(data, EventType.SPEAKER_CREATED)),
            (EventType.PRONUNCIATION_RULE_CREATED, "pronunciation", lambda data: broadcaster.broadcast_pronunciation_update(data, EventType.PRONUNCIATION_RULE_CREATED)),
            (EventType.EXPORT_STARTED, "export", lambda data: broadcaster.broadcast_export_update(data, EventType.EXPORT_STARTED)),
            (EventType.IMPORT_STARTED, "import", lambda data: broadcaster.broadcast_import_update(data, EventType.IMPORT_STARTED)),
        ]

        for event_type, expected_channel, broadcast_func in test_events:
            captured_events = []

            async def test_channel():
                client_id = f"test-client-{event_type}"
                queue = __import__('asyncio').Queue()
                broadcaster.clients[client_id] = queue
                broadcaster.subscriptions.setdefault(expected_channel, set()).add(client_id)

                # Broadcast minimal test data
                await broadcast_func({"test": "data"})

                event = await queue.get()
                captured_events.append(event)

                del broadcaster.clients[client_id]
                broadcaster.subscriptions[expected_channel].discard(client_id)

            await test_channel()

            event_data = captured_events[0]["data"]
            assert event_data["_channel"] == expected_channel, \
                f"{event_type} should use channel '{expected_channel}', got '{event_data['_channel']}'"
