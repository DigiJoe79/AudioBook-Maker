"""
Event Broadcaster Service for Server-Sent Events (SSE)

Manages real-time event broadcasting to all connected SSE clients.
Provides singleton instance for application-wide event emission.

Architecture:
- In-memory event queue using asyncio.Queue
- Client subscription management with channel-based routing
- Thread-safe async operations
- Automatic client cleanup on disconnection
- Support for multiple event types (job updates, segment updates, etc.)

Usage:
    from services.event_broadcaster import broadcaster

    # Emit event to all subscribers
    await broadcaster.broadcast_job_update({
        "jobId": "job-123",
        "status": "running",
        "progress": 46.0
    })
"""

import asyncio
import json
import uuid
from typing import Dict, Set, AsyncGenerator, Any, Optional, Callable, Awaitable
from datetime import datetime, timezone
from loguru import logger


def utc_now_iso() -> str:
    """
    Generate UTC timestamp in ISO format with 'Z' suffix.

    This ensures JavaScript's Date parser correctly interprets
    the timestamp as UTC, avoiding timezone offset issues when
    frontend (Windows) and backend (WSL2/Linux) are in different timezones.

    Returns:
        ISO 8601 string with 'Z' suffix, e.g., '2025-12-29T14:30:00.123456Z'
    """
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


class EventType:
    """Event type constants for SSE broadcasting"""

    # Segment events
    SEGMENT_CREATED = "segment.created"
    SEGMENT_UPDATED = "segment.updated"
    SEGMENT_DELETED = "segment.deleted"
    SEGMENT_REORDERED = "segment.reordered"
    SEGMENT_STARTED = "segment.started"
    SEGMENT_COMPLETED = "segment.completed"
    SEGMENT_FAILED = "segment.failed"
    SEGMENT_FROZEN = "segment.frozen"
    SEGMENT_UNFROZEN = "segment.unfrozen"

    # Job events
    JOB_CREATED = "job.created"
    JOB_STARTED = "job.started"
    JOB_PROGRESS = "job.progress"
    JOB_COMPLETED = "job.completed"
    JOB_FAILED = "job.failed"
    JOB_CANCELLING = "job.cancelling"
    JOB_CANCELLED = "job.cancelled"
    JOB_RESUMED = "job.resumed"

    # Chapter events
    CHAPTER_UPDATED = "chapter.updated"
    CHAPTER_CREATED = "chapter.created"
    CHAPTER_DELETED = "chapter.deleted"
    CHAPTER_REORDERED = "chapter.reordered"

    # Project events
    PROJECT_CREATED = "project.created"
    PROJECT_UPDATED = "project.updated"
    PROJECT_DELETED = "project.deleted"
    PROJECT_REORDERED = "project.reordered"

    # Export events
    EXPORT_STARTED = "export.started"
    EXPORT_PROGRESS = "export.progress"
    EXPORT_COMPLETED = "export.completed"
    EXPORT_FAILED = "export.failed"
    EXPORT_CANCELLED = "export.cancelled"

    # Import events
    IMPORT_STARTED = "import.started"
    IMPORT_PROGRESS = "import.progress"
    IMPORT_COMPLETED = "import.completed"
    IMPORT_FAILED = "import.failed"
    IMPORT_CANCELLED = "import.cancelled"

    # Health events
    HEALTH_UPDATE = "health.update"

    # Speaker events
    SPEAKER_CREATED = "speaker.created"
    SPEAKER_UPDATED = "speaker.updated"
    SPEAKER_DELETED = "speaker.deleted"
    SPEAKER_SAMPLE_ADDED = "speaker.sample_added"
    SPEAKER_SAMPLE_DELETED = "speaker.sample_deleted"

    # Settings events
    SETTINGS_UPDATED = "settings.updated"
    SETTINGS_RESET = "settings.reset"

    # Pronunciation events
    PRONUNCIATION_RULE_CREATED = "pronunciation.rule.created"
    PRONUNCIATION_RULE_UPDATED = "pronunciation.rule.updated"
    PRONUNCIATION_RULE_DELETED = "pronunciation.rule.deleted"
    PRONUNCIATION_RULE_BULK_CHANGE = "pronunciation.rule.bulk_change"
    PRONUNCIATION_RULES_IMPORTED = "pronunciation.rules.imported"

    # Quality Job events (for unified quality analysis)
    QUALITY_JOB_CREATED = "quality.job.created"
    QUALITY_JOB_STARTED = "quality.job.started"
    QUALITY_JOB_PROGRESS = "quality.job.progress"
    QUALITY_JOB_COMPLETED = "quality.job.completed"
    QUALITY_JOB_FAILED = "quality.job.failed"
    QUALITY_JOB_CANCELLED = "quality.job.cancelled"
    QUALITY_JOB_RESUMED = "quality.job.resumed"
    QUALITY_SEGMENT_ANALYZED = "quality.segment.analyzed"
    QUALITY_SEGMENT_FAILED = "quality.segment.failed"

    # Engine events
    ENGINE_STARTING = "engine.starting"
    ENGINE_STARTED = "engine.started"
    ENGINE_MODEL_LOADED = "engine.model_loaded"  # Model loaded, engine fully ready
    ENGINE_STOPPING = "engine.stopping"
    ENGINE_STOPPED = "engine.stopped"
    ENGINE_ERROR = "engine.error"
    ENGINE_ENABLED = "engine.enabled"
    ENGINE_DISABLED = "engine.disabled"
    ENGINE_STATUS = "engine.status"  # Periodic status with countdown timers

    # Docker image events
    DOCKER_IMAGE_INSTALLING = "docker.image.installing"
    DOCKER_IMAGE_PROGRESS = "docker.image.progress"
    DOCKER_IMAGE_INSTALLED = "docker.image.installed"
    DOCKER_IMAGE_UNINSTALLING = "docker.image.uninstalling"
    DOCKER_IMAGE_UNINSTALLED = "docker.image.uninstalled"
    DOCKER_IMAGE_CANCELLED = "docker.image.cancelled"
    DOCKER_IMAGE_ERROR = "docker.image.error"

    # Docker host connection events
    DOCKER_HOST_CONNECTED = "docker.host.connected"
    DOCKER_HOST_DISCONNECTED = "docker.host.disconnected"
    DOCKER_HOST_CONNECTING = "docker.host.connecting"


class EventBroadcaster:
    """
    Singleton service for managing Server-Sent Events broadcasting.

    Manages client connections, subscriptions, and event distribution.
    Events are routed to clients based on channel subscriptions.

    Channels:
    - "jobs" - TTS job updates, segment updates, chapter content changes
    - "projects" - Project and chapter CRUD events
    - "export" - Export job updates
    - "import" - Import job updates
    - "health" - System health updates (30s interval)
    - "engines" - Engine status updates (15s interval)
    - "speakers" - Speaker management events
    - "settings" - Settings updates
    - "pronunciation" - Pronunciation rule events
    - "quality" - Quality analysis job events
    """

    def __init__(self):
        """Initialize the event broadcaster"""
        # Client management: {client_id: asyncio.Queue}
        self.clients: Dict[str, asyncio.Queue] = {}

        # Subscription tracking: {channel: Set[client_id]}
        self.subscriptions: Dict[str, Set[str]] = {}

        # Lock for thread-safe operations
        self._lock = asyncio.Lock()

        # Statistics tracking
        self._total_clients = 0
        self._total_events = 0

        logger.debug("[EventBroadcaster] Initialized")

    async def subscribe(self, channels: Optional[list[str]] = None) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Subscribe a new SSE client and create event stream.

        This is an async generator that yields events to the client.
        Automatically cleans up on client disconnection.

        Args:
            channels: List of channels to subscribe to (default: ["jobs", "health"])

        Yields:
            Event dictionaries with structure:
            {
                "event": "event_type",
                "data": {...},
                "id": "event_id",
                "timestamp": "ISO8601"
            }

        Example:
            async for event in broadcaster.subscribe(["jobs", "health", "engines"]):
                yield event
        """
        if channels is None:
            channels = ["jobs", "health"]

        # Generate unique client ID
        client_id = str(uuid.uuid4())

        # Create event queue for this client
        queue: asyncio.Queue = asyncio.Queue()

        async with self._lock:
            self.clients[client_id] = queue
            self._total_clients += 1

            # Subscribe to channels
            for channel in channels:
                if channel not in self.subscriptions:
                    self.subscriptions[channel] = set()
                self.subscriptions[channel].add(client_id)

        logger.debug(
            f"[EventBroadcaster] Client {client_id[:8]} subscribed to channels: {channels}"
        )

        try:
            # Send initial connection event
            yield {
                "event": "connected",
                "data": json.dumps({
                    "clientId": client_id,
                    "channels": channels,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }),
                "id": str(uuid.uuid4())
            }

            # Trigger immediate engine status broadcast for initial state
            # (only if client subscribes to engines channel)
            if "engines" in channels:
                asyncio.create_task(self._send_initial_engine_status())

            # Continuous event stream
            while True:
                try:
                    # Wait for event with timeout (for keepalive)
                    from config import SSE_KEEPALIVE_TIMEOUT
                    event = await asyncio.wait_for(queue.get(), timeout=SSE_KEEPALIVE_TIMEOUT)
                    self._total_events += 1

                    # Serialize data field to JSON string
                    # SSE-Starlette doesn't auto-serialize, so we must do it manually
                    if "data" in event and not isinstance(event["data"], str):
                        event["data"] = json.dumps(event["data"])

                    yield event

                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    # Note: Only 'comment' field is allowed for ServerSentEvent
                    yield {
                        "comment": "keepalive"
                    }

        except asyncio.CancelledError:
            logger.debug(f"[EventBroadcaster] Client {client_id[:8]} cancelled")

        except Exception as e:
            logger.error(
                f"[EventBroadcaster] Error in client {client_id[:8]} stream: {e}"
            )

        finally:
            # Cleanup on disconnect
            await self._unsubscribe(client_id)

    async def _unsubscribe(self, client_id: str):
        """
        Remove client from all subscriptions and cleanup.

        Args:
            client_id: Unique client identifier
        """
        async with self._lock:
            # Remove from clients
            if client_id in self.clients:
                del self.clients[client_id]

            # Remove from all channel subscriptions
            for channel_subscribers in self.subscriptions.values():
                channel_subscribers.discard(client_id)

            # Cleanup empty channels
            empty_channels = [
                channel for channel, subscribers in self.subscriptions.items()
                if len(subscribers) == 0
            ]
            for channel in empty_channels:
                del self.subscriptions[channel]

        logger.debug(
            f"[EventBroadcaster] Client {client_id[:8]} unsubscribed "
            f"(active: {len(self.clients)})"
        )

    async def broadcast_event(
        self,
        event_type: str,
        data: Dict[str, Any],
        channel: str = "jobs",
        event_id: Optional[str] = None
    ):
        """
        Broadcast event to all subscribers of a channel.

        Args:
            event_type: Event type constant (e.g., EventType.JOB_PROGRESS)
            data: Event payload data (must be JSON-serializable)
            channel: Channel to broadcast on (default: "jobs")
            event_id: Optional event ID (auto-generated if not provided)

        Example:
            await broadcaster.broadcast_event(
                event_type=EventType.JOB_PROGRESS,
                data={"jobId": "job-123", "progress": 46.0},
                channel="jobs"
            )
        """
        if channel not in self.subscriptions or not self.subscriptions[channel]:
            # No subscribers for this channel, skip
            return True

        # Generate event ID if not provided
        if event_id is None:
            event_id = str(uuid.uuid4())

        # Prepare event payload
        # Note: ServerSentEvent only accepts: event, data, id, retry, comment
        # We include event type, timestamp and channel in the data payload
        # IMPORTANT: We send as DEFAULT message (no "event:" field) so that
        # EventSource.onmessage is triggered. Event type is in data.event instead.
        event_data = {
            "event": event_type,  # Event type in data payload
            **data,  # Spread original data
            "_timestamp": datetime.now(timezone.utc).isoformat(),
            "_channel": channel
        }

        event = {
            # NO "event" field - send as default message type
            "data": event_data,
            "id": event_id
        }

        # Validate data is JSON-serializable
        try:
            json.dumps(event_data)
        except (TypeError, ValueError) as e:
            logger.error(
                f"[EventBroadcaster] Event data not JSON-serializable: {e}"
            )
            return False

        # Broadcast to all subscribers
        async with self._lock:
            subscribers = self.subscriptions.get(channel, set()).copy()

        if not subscribers:
            return True

        # Queue event for all subscribers (non-blocking)
        failed_clients = []
        for client_id in subscribers:
            if client_id in self.clients:
                try:
                    # Use put_nowait to avoid blocking
                    self.clients[client_id].put_nowait(event)
                except asyncio.QueueFull:
                    logger.warning(
                        f"[EventBroadcaster] Queue full for client {client_id[:8]}, "
                        "dropping event"
                    )
                    failed_clients.append(client_id)
                except Exception as e:
                    logger.error(
                        f"[EventBroadcaster] Failed to queue event for "
                        f"client {client_id[:8]}: {e}"
                    )
                    failed_clients.append(client_id)

        # Cleanup failed clients
        for client_id in failed_clients:
            await self._unsubscribe(client_id)

        logger.debug(
            f"[EventBroadcaster] Broadcasted {event_type} to {len(subscribers)} "
            f"clients on channel '{channel}'"
        )
        return True

    async def broadcast_segment_update(
        self,
        segment_data: Dict[str, Any],
        event_type: str = EventType.SEGMENT_UPDATED
    ):
        """
        Broadcast segment update event.

        Broadcasts to "jobs" channel (all segments) and optionally to chapter-specific
        channel if chapterId is present. This mirrors the behavior of broadcast_job_update
        for consistency.

        Args:
            segment_data: Segment data including chapterId, segmentId, status, etc.
            event_type: Event type (default: SEGMENT_UPDATED)

        Example:
            await broadcaster.broadcast_segment_update({
                "segmentId": "seg-123",
                "chapterId": "ch-1",
                "status": "completed",
                "audioPath": "/audio/seg-123.wav"
            })
        """
        # Broadcast to global jobs channel (frontend subscribes to this)
        await self.broadcast_event(
            event_type=event_type,
            data=segment_data,
            channel="jobs"
        )

    async def broadcast_job_update(
        self,
        job_data: Dict[str, Any],
        event_type: str = EventType.JOB_PROGRESS
    ):
        """
        Broadcast job update event to the jobs channel.

        Args:
            job_data: Job data including jobId, status, progress, etc.
            event_type: Event type (default: JOB_PROGRESS)

        Example:
            await broadcaster.broadcast_job_update({
                "jobId": "job-123",
                "chapterId": "ch-1",
                "status": "running",
                "progress": 46.0,
                "processedSegments": 23,
                "totalSegments": 50
            })
        """
        await self.broadcast_event(
            event_type=event_type,
            data=job_data,
            channel="jobs"
        )

    async def broadcast_chapter_update(self, chapter_data: Dict[str, Any]):
        """
        Broadcast chapter update event to projects channel (unified).

        Used for chapter content changes (segment deletion, reorder) that
        require AudioPlayer refresh and cache invalidation.

        Args:
            chapter_data: Chapter data including chapterId

        Example:
            await broadcaster.broadcast_chapter_update({
                "chapterId": "ch-1",
                "title": "Chapter 1",
                "segmentCount": 50
            })
        """
        await self.broadcast_event(
            event_type=EventType.CHAPTER_UPDATED,
            data=chapter_data,
            channel="projects"
        )

    async def broadcast_project_update(
        self,
        project_data: Dict[str, Any],
        event_type: str = EventType.PROJECT_UPDATED
    ):
        """
        Broadcast project CRUD event.

        Args:
            project_data: Project data including projectId, title, description
            event_type: Event type (default: PROJECT_UPDATED)

        Example:
            await broadcaster.broadcast_project_update({
                "projectId": "proj-123",
                "title": "My Audiobook",
                "description": "A great book"
            }, event_type=EventType.PROJECT_CREATED)
        """
        await self.broadcast_event(
            event_type=event_type,
            data=project_data,
            channel="projects"
        )

    async def broadcast_chapter_crud(
        self,
        chapter_data: Dict[str, Any],
        event_type: str
    ):
        """
        Broadcast chapter CRUD event (created/deleted/reordered/updated).

        Args:
            chapter_data: Chapter data including chapterId, projectId, title, orderIndex
            event_type: Event type (CHAPTER_CREATED, CHAPTER_DELETED, CHAPTER_REORDERED, CHAPTER_UPDATED)

        Example:
            await broadcaster.broadcast_chapter_crud({
                "chapterId": "ch-123",
                "projectId": "proj-1",
                "title": "Chapter 1",
                "orderIndex": 0
            }, event_type=EventType.CHAPTER_CREATED)
        """
        await self.broadcast_event(
            event_type=event_type,
            data=chapter_data,
            channel="projects"
        )

    async def broadcast_export_update(
        self,
        export_data: Dict[str, Any],
        event_type: str = EventType.EXPORT_PROGRESS
    ):
        """
        Broadcast export job update event.

        Args:
            export_data: Export job data including exportId, status, progress
            event_type: Event type (default: EXPORT_PROGRESS)

        Example:
            await broadcaster.broadcast_export_update({
                "exportId": "exp-123",
                "status": "running",
                "progress": 75.0
            })
        """
        await self.broadcast_event(
            event_type=event_type,
            data=export_data,
            channel="export"
        )

    async def broadcast_import_update(
        self,
        import_data: Dict[str, Any],
        event_type: str = EventType.IMPORT_PROGRESS
    ):
        """
        Broadcast import job update event.

        Args:
            import_data: Import data including importId, status, progress, message
            event_type: Event type (default: IMPORT_PROGRESS)

        Example:
            await broadcaster.broadcast_import_update({
                "importId": "import-123",
                "status": "running",
                "progress": 50.0,
                "message": "Importing chapters..."
            })
        """
        await self.broadcast_event(
            event_type=event_type,
            data=import_data,
            channel="import"
        )

    async def broadcast_health_update(self, health_data: Dict[str, Any]):
        """
        Broadcast system health update event.

        Args:
            health_data: Health status data

        Example:
            await broadcaster.broadcast_health_update({
                "status": "ok",
                "activeJobs": 2,
                "busy": True
            })
        """
        await self.broadcast_event(
            event_type=EventType.HEALTH_UPDATE,
            data=health_data,
            channel="health"
        )

    async def broadcast_speaker_update(
        self,
        speaker_data: Dict[str, Any],
        event_type: str = EventType.SPEAKER_UPDATED
    ):
        """
        Broadcast speaker update event.

        Args:
            speaker_data: Speaker data including speakerId, name, etc.
            event_type: Event type (default: SPEAKER_UPDATED)

        Example:
            await broadcaster.broadcast_speaker_update({
                "speakerId": "spk-123",
                "name": "John Doe",
                "gender": "male"
            }, event_type=EventType.SPEAKER_CREATED)
        """
        await self.broadcast_event(
            event_type=event_type,
            data=speaker_data,
            channel="speakers"
        )

    async def broadcast_settings_update(
        self,
        settings_data: Dict[str, Any],
        event_type: str = EventType.SETTINGS_UPDATED
    ):
        """
        Broadcast settings update event.

        Args:
            settings_data: Settings data including key and value
            event_type: Event type (default: SETTINGS_UPDATED)

        Example:
            await broadcaster.broadcast_settings_update({
                "key": "tts",
                "value": {"defaultEngine": "engineName", ...}
            })
        """
        await self.broadcast_event(
            event_type=event_type,
            data=settings_data,
            channel="settings"
        )

    async def broadcast_pronunciation_update(
        self,
        pronunciation_data: Dict[str, Any],
        event_type: str = EventType.PRONUNCIATION_RULE_UPDATED
    ):
        """
        Broadcast pronunciation rule update event.

        Args:
            pronunciation_data: Pronunciation rule data including ruleId, pattern, replacement, etc.
            event_type: Event type (default: PRONUNCIATION_RULE_UPDATED)

        Example:
            await broadcaster.broadcast_pronunciation_update({
                "ruleId": "rule-123",
                "pattern": "Dr.",
                "replacement": "Doctor",
                "scope": "global"
            }, event_type=EventType.PRONUNCIATION_RULE_CREATED)
        """
        await self.broadcast_event(
            event_type=event_type,
            data=pronunciation_data,
            channel="pronunciation"
        )

    async def _send_initial_engine_status(self):
        """
        Send initial engine status to newly connected clients.

        Called when a new client subscribes to the 'engines' channel.
        Triggers an immediate broadcast from EngineStatusBroadcaster.
        """
        try:
            # Import here to avoid circular imports
            from services.engine_status_broadcaster import engine_status_broadcaster
            await engine_status_broadcaster.broadcast_now()
            logger.debug("[EventBroadcaster] Sent initial engine status to new client")
        except Exception as e:
            logger.error(f"[EventBroadcaster] Failed to send initial engine status: {e}")

    def get_stats(self) -> Dict[str, Any]:
        """
        Get broadcaster statistics.

        Returns:
            Dictionary with statistics:
            - activeClients: Number of connected clients
            - totalClients: Total clients since startup
            - totalEvents: Total events broadcasted
            - channels: List of active channels with subscriber counts
        """
        return {
            "activeClients": len(self.clients),
            "totalClients": self._total_clients,
            "totalEvents": self._total_events,
            "channels": {
                channel: len(subscribers)
                for channel, subscribers in self.subscriptions.items()
            }
        }

    def __repr__(self) -> str:
        """String representation"""
        stats = self.get_stats()
        return (
            f"<EventBroadcaster "
            f"clients={stats['activeClients']} "
            f"channels={len(stats['channels'])} "
            f"events={stats['totalEvents']}>"
        )


# Global singleton instance
broadcaster = EventBroadcaster()


# ==================== Utility Functions ====================

async def safe_broadcast(
    broadcast_func: Callable[..., Awaitable[None]],
    *args,
    event_description: str = "event",
    **kwargs
) -> None:
    """
    Safely broadcast an SSE event, logging any errors without raising.

    Consolidates duplicated error handling for all broadcast calls across API routes.
    Prevents SSE failures from affecting API responses - broadcasts are fire-and-forget.

    Args:
        broadcast_func: The broadcaster method to call (e.g., broadcaster.broadcast_segment_update)
        *args: Positional arguments to pass to broadcast_func
        event_description: Human-readable event description for error logging (default: "event")
        **kwargs: Keyword arguments to pass to broadcast_func

    Usage:
        await safe_broadcast(
            broadcaster.broadcast_segment_update,
            data,
            event_type=EventType.SEGMENT_UPDATED,
            event_description="segment update"
        )
    """
    try:
        await broadcast_func(*args, **kwargs)
    except Exception as e:
        logger.warning(f"Failed to broadcast {event_description}: {e}")


# Convenience functions for common operations
async def emit_segment_started(segment_id: str, chapter_id: str):
    """Emit segment started event"""
    await broadcaster.broadcast_segment_update(
        {
            "segmentId": segment_id,
            "chapterId": chapter_id,
            "status": "processing"
        },
        event_type=EventType.SEGMENT_STARTED
    )


async def emit_segment_completed(
    segment_id: str,
    chapter_id: str,
    audio_path: str
):
    """Emit segment completed event"""
    await broadcaster.broadcast_segment_update(
        {
            "segmentId": segment_id,
            "chapterId": chapter_id,
            "status": "completed",
            "audioPath": audio_path
        },
        event_type=EventType.SEGMENT_COMPLETED
    )


async def emit_segment_failed(
    segment_id: str,
    chapter_id: str,
    error: str
):
    """Emit segment failed event"""
    await broadcaster.broadcast_segment_update(
        {
            "segmentId": segment_id,
            "chapterId": chapter_id,
            "status": "failed",
            "error": error
        },
        event_type=EventType.SEGMENT_FAILED
    )


async def emit_segment_frozen(
    segment_id: str,
    chapter_id: str,
    is_frozen: bool
):
    """
    Emit segment frozen/unfrozen event.

    Args:
        segment_id: The segment ID
        chapter_id: The chapter ID
        is_frozen: True if segment is being frozen, False if unfrozen
    """
    event_type = EventType.SEGMENT_FROZEN if is_frozen else EventType.SEGMENT_UNFROZEN
    await broadcaster.broadcast_event(
        event_type=event_type,
        data={
            "segmentId": segment_id,
            "chapterId": chapter_id,
            "isFrozen": is_frozen,
        },
        channel="jobs"
    )


async def emit_job_created(
    job_id: str,
    chapter_id: str,
    total_segments: int,
    segment_ids: list,
    tts_engine: str = None,
    tts_model_name: str = None,
    tts_speaker_name: str = None
):
    """
    Emit job created event immediately when job is queued.

    This provides instant UI feedback when user creates a job,
    before the worker picks it up.

    Args:
        job_id: Job identifier
        chapter_id: Chapter identifier
        total_segments: Total segments in job
        segment_ids: List of segment IDs
        tts_engine: TTS engine name (for display in job title)
        tts_model_name: TTS model name
        tts_speaker_name: TTS speaker name
    """
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "pending",
            "totalSegments": total_segments,
            "processedSegments": 0,
            "progress": 0.0,
            "segmentIds": segment_ids,
            "ttsEngine": tts_engine,
            "ttsModelName": tts_model_name,
            "ttsSpeakerName": tts_speaker_name
        },
        event_type=EventType.JOB_CREATED
    )


async def emit_job_started(
    job_id: str,
    chapter_id: str,
    total_segments: int,
    segment_ids: list,
    processed_segments: int = 0,
    started_at: str = None,
    tts_engine: str = None
):
    """
    Emit job started event with segment details

    Args:
        job_id: Job identifier
        chapter_id: Chapter identifier
        total_segments: Total number of segments in job
        segment_ids: List of segment IDs in job
        processed_segments: Number of already processed segments (for resumed jobs)
        started_at: ISO timestamp when job started (from DB)
        tts_engine: TTS engine name (for display in job title)
    """
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "running",
            "totalSegments": total_segments,
            "processedSegments": processed_segments,
            "progress": 0.0,
            "segmentIds": segment_ids,
            "startedAt": started_at or utc_now_iso(),
            "ttsEngine": tts_engine
        },
        event_type=EventType.JOB_STARTED
    )


async def emit_job_progress(
    job_id: str,
    chapter_id: str,
    processed_segments: int,
    total_segments: int,
    progress: float,
    segment_ids: list,
    message: Optional[str] = None,
    failed_segments: int = 0
):
    """Emit job progress event"""
    data = {
        "jobId": job_id,
        "chapterId": chapter_id,
        "status": "running",
        "processedSegments": processed_segments,
        "totalSegments": total_segments,
        "progress": progress,
        "segmentIds": segment_ids,
        "failedSegments": failed_segments
    }
    if message:
        data["message"] = message

    await broadcaster.broadcast_job_update(
        data,
        event_type=EventType.JOB_PROGRESS
    )


async def emit_job_completed(
    job_id: str,
    chapter_id: str,
    total_segments: int,
    segment_ids: list
):
    """Emit job completed event"""
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "completed",
            "totalSegments": total_segments,
            "processedSegments": total_segments,
            "progress": 100.0,
            "segmentIds": segment_ids
        },
        event_type=EventType.JOB_COMPLETED
    )


async def emit_job_failed(
    job_id: str,
    chapter_id: str,
    error: str,
    segment_ids: list
):
    """Emit job failed event"""
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "failed",
            "error": error,
            "segmentIds": segment_ids
        },
        event_type=EventType.JOB_FAILED
    )


async def emit_job_cancelling(
    job_id: str,
    chapter_id: str
):
    """
    Emit job cancelling event when cancellation is requested for a running job.

    This provides immediate UI feedback that the job is being cancelled,
    before the worker actually stops (after finishing current segment).
    """
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "cancelling"
        },
        event_type=EventType.JOB_CANCELLING
    )


async def emit_job_cancelled(
    job_id: str,
    chapter_id: str,
    segment_ids: list
):
    """Emit job cancelled event"""
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "cancelled",
            "segmentIds": segment_ids
        },
        event_type=EventType.JOB_CANCELLED
    )


async def emit_job_resumed(
    job_id: str,
    chapter_id: str,
    total_segments: int,
    segment_ids: list
):
    """
    Emit job resumed event when a cancelled job is resumed.

    This provides instant UI feedback when user resumes a cancelled job,
    indicating that the job is back in the queue.

    Note:
        resumedAt is used by frontend as createdAt to prevent timestamp
        flickering back to original job creation time.
    """
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "pending",
            "totalSegments": total_segments,
            "processedSegments": 0,
            "progress": 0.0,
            "segmentIds": segment_ids,
            "resumedAt": utc_now_iso()
        },
        event_type=EventType.JOB_RESUMED
    )


# ==================== Engine Event Helpers ====================

async def emit_engine_started(
    engine_type: str,
    engine_name: str,
    port: int,
    version: Optional[str] = None,
    variant_id: Optional[str] = None
):
    """
    Emit engine started event when an engine server starts

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier (e.g., 'xtts', 'chatterbox')
        port: HTTP port the engine is listening on
        version: Package version from health check (optional)
        variant_id: Variant identifier for variant-aware frontends (optional)
    """
    data = {
        "engineType": engine_type,
        "engineName": engine_name,
        "status": "running",
        "port": port,
    }
    if version:
        data["version"] = version
    if variant_id:
        data["variantId"] = variant_id

    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_STARTED,
        data=data,
        channel="engines"
    )


async def emit_engine_model_loaded(
    engine_type: str,
    engine_name: str,
    model_name: str,
    variant_id: Optional[str] = None
):
    """
    Emit engine model loaded event when a model is loaded on an engine.

    This event indicates the engine is fully ready for requests.
    Also emitted on model hotswap (changing model without restart).

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier (e.g., 'xtts', 'chatterbox')
        model_name: Name of the loaded model
        variant_id: Variant identifier for variant-aware frontends (optional)
    """
    data = {
        "engineType": engine_type,
        "engineName": engine_name,
        "loadedModel": model_name,
    }
    if variant_id:
        data["variantId"] = variant_id

    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_MODEL_LOADED,
        data=data,
        channel="engines"
    )


async def emit_engine_starting(
    engine_type: str,
    engine_name: str,
    variant_id: Optional[str] = None
):
    """Emit when engine server is starting (process launched, waiting for ready)"""
    data = {
        "engineType": engine_type,
        "engineName": engine_name,
    }
    if variant_id:
        data["variantId"] = variant_id

    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_STARTING,
        data=data,
        channel="engines"
    )


async def emit_engine_stopping(
    engine_type: str,
    engine_name: str,
    reason: str = "manual",
    variant_id: Optional[str] = None
):
    """Emit when engine server is stopping (shutdown requested)"""
    data = {
        "engineType": engine_type,
        "engineName": engine_name,
        "reason": reason,
    }
    if variant_id:
        data["variantId"] = variant_id

    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_STOPPING,
        data=data,
        channel="engines"
    )


async def emit_engine_stopped(
    engine_type: str,
    engine_name: str,
    reason: str = "manual",
    variant_id: Optional[str] = None
):
    """
    Emit engine stopped event when an engine server stops

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier (e.g., 'xtts', 'chatterbox')
        reason: Reason for stop - "manual", "inactivity", or "error"
        variant_id: Variant identifier for variant-aware frontends (optional)
    """
    data = {
        "engineType": engine_type,
        "engineName": engine_name,
        "status": "stopped",
        "reason": reason,
    }
    if variant_id:
        data["variantId"] = variant_id

    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_STOPPED,
        data=data,
        channel="engines"
    )


async def emit_engine_enabled(
    engine_type: str,
    engine_name: str,
    variant_id: Optional[str] = None
):
    """
    Emit engine enabled event when an engine is enabled via settings

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier (e.g., 'xtts', 'chatterbox')
        variant_id: Variant identifier for variant-aware frontends (optional)
    """
    data = {
        "engineType": engine_type,
        "engineName": engine_name,
        "isEnabled": True,
    }
    if variant_id:
        data["variantId"] = variant_id

    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_ENABLED,
        data=data,
        channel="engines"
    )


async def emit_engine_disabled(
    engine_type: str,
    engine_name: str,
    variant_id: Optional[str] = None
):
    """
    Emit engine disabled event when an engine is disabled via settings

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier (e.g., 'xtts', 'chatterbox')
        variant_id: Variant identifier for variant-aware frontends (optional)
    """
    data = {
        "engineType": engine_type,
        "engineName": engine_name,
        "isEnabled": False,
    }
    if variant_id:
        data["variantId"] = variant_id

    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_DISABLED,
        data=data,
        channel="engines"
    )


async def emit_engine_error(
    engine_type: str,
    engine_name: str,
    error: str,
    details: str = None,
    variant_id: Optional[str] = None
):
    """
    Emit engine error event when an engine encounters an error

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier (e.g., 'xtts', 'chatterbox')
        error: Error message
        details: Optional detailed error information
        variant_id: Variant identifier for variant-aware frontends (optional)
    """
    data = {
        "engineType": engine_type,
        "engineName": engine_name,
        "error": error,
    }
    if details:
        data["details"] = details
    if variant_id:
        data["variantId"] = variant_id

    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_ERROR,
        data=data,
        channel="engines"
    )


async def emit_engine_status(
    engines_status: dict,
    has_tts_engine: bool,
    has_text_engine: bool,
    has_stt_engine: bool,
    has_audio_engine: bool = False
):
    """
    Emit periodic engine status update with countdown timers

    Args:
        engines_status: Dict with engine status per type:
            {
                "tts": [{"variantId": "xtts:local", "isRunning": True, "secondsUntilAutoStop": 180}, ...],
                "text": [...],
                "stt": [...],
                "audio": [...]
            }
        has_tts_engine: Whether at least one TTS engine is enabled
        has_text_engine: Whether at least one Text engine is enabled
        has_stt_engine: Whether at least one STT engine is enabled
        has_audio_engine: Whether at least one Audio engine is enabled
    """
    await broadcaster.broadcast_event(
        event_type=EventType.ENGINE_STATUS,
        data={
            "engines": engines_status,
            "hasTtsEngine": has_tts_engine,
            "hasTextEngine": has_text_engine,
            "hasSttEngine": has_stt_engine,
            "hasAudioEngine": has_audio_engine,
        },
        channel="engines"
    )


# ==================== Docker Image Event Helpers ====================

async def emit_docker_image_installing(variant_id: str, image_name: str, host_id: str):
    """Emit when Docker image pull starts"""
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_IMAGE_INSTALLING,
        data={
            "variantId": variant_id,
            "imageName": image_name,
            "hostId": host_id,
        },
        channel="engines"
    )


async def emit_docker_image_progress(
    variant_id: str,
    status: str,
    progress_percent: int,
    current_layer: str = "",
    message: str = ""
):
    """
    Emit Docker image pull progress event.

    Args:
        variant_id: The variant being installed (e.g., 'xtts:docker:local')
        status: Current status ('downloading', 'extracting', 'verifying')
        progress_percent: Overall progress percentage (0-100)
        current_layer: Current layer being processed (optional)
        message: Human-readable progress message (optional)
    """
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_IMAGE_PROGRESS,
        data={
            "variantId": variant_id,
            "status": status,
            "progressPercent": progress_percent,
            "currentLayer": current_layer,
            "message": message,
        },
        channel="engines"
    )


async def emit_docker_image_installed(variant_id: str, image_name: str, host_id: str):
    """Emit when Docker image is successfully installed"""
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_IMAGE_INSTALLED,
        data={
            "variantId": variant_id,
            "imageName": image_name,
            "hostId": host_id,
            "isInstalled": True,
        },
        channel="engines"
    )


async def emit_docker_image_uninstalling(variant_id: str, host_id: str):
    """Emit when Docker image removal starts"""
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_IMAGE_UNINSTALLING,
        data={
            "variantId": variant_id,
            "hostId": host_id,
        },
        channel="engines"
    )


async def emit_docker_image_uninstalled(variant_id: str, host_id: str):
    """Emit when Docker image is successfully removed"""
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_IMAGE_UNINSTALLED,
        data={
            "variantId": variant_id,
            "hostId": host_id,
            "isInstalled": False,
        },
        channel="engines"
    )


async def emit_docker_image_cancelled(variant_id: str):
    """Emit when Docker image pull is cancelled by user"""
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_IMAGE_CANCELLED,
        data={
            "variantId": variant_id,
        },
        channel="engines"
    )


async def emit_docker_image_error(variant_id: str, error: str, operation: str = "install"):
    """Emit when Docker image operation fails"""
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_IMAGE_ERROR,
        data={
            "variantId": variant_id,
            "error": error,
            "operation": operation,
        },
        channel="engines"
    )


# ==================== Quality Event Helpers ====================

async def emit_quality_job_created(
    job_id: str,
    chapter_id: str,
    total_segments: int,
    segment_ids: list,
    job_type: str = "chapter",
    chapter_title: str = None,
    project_title: str = None,
    stt_engine: str = None,
    audio_engine: str = None
):
    """Emit quality job created event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_JOB_CREATED,
        data={
            "jobId": job_id,
            "chapterId": chapter_id,
            "totalSegments": total_segments,
            "processedSegments": 0,
            "progress": 0.0,
            "segmentIds": segment_ids,
            "jobType": job_type,
            "chapterTitle": chapter_title,
            "projectTitle": project_title,
            "sttEngine": stt_engine,
            "audioEngine": audio_engine
        },
        channel="quality"
    )


async def emit_quality_job_started(
    job_id: str,
    chapter_id: str,
    total_segments: int = 0,
    processed_segments: int = 0,
    started_at: str = None
):
    """Emit quality job started event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_JOB_STARTED,
        data={
            "jobId": job_id,
            "chapterId": chapter_id,
            "totalSegments": total_segments,
            "processedSegments": processed_segments,
            "startedAt": started_at or utc_now_iso(),
        },
        channel="quality"
    )


async def emit_quality_job_progress(
    job_id: str,
    chapter_id: str,
    processed_segments: int,
    total_segments: int,
    progress: float
):
    """Emit quality job progress event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_JOB_PROGRESS,
        data={
            "jobId": job_id,
            "chapterId": chapter_id,
            "processedSegments": processed_segments,
            "totalSegments": total_segments,
            "progress": progress,
        },
        channel="quality"
    )


async def emit_quality_job_completed(
    job_id: str,
    chapter_id: str,
    total_segments: int
):
    """Emit quality job completed event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_JOB_COMPLETED,
        data={
            "jobId": job_id,
            "chapterId": chapter_id,
            "totalSegments": total_segments,
            "processedSegments": total_segments,
            "progress": 100.0,
        },
        channel="quality"
    )


async def emit_quality_job_failed(job_id: str, chapter_id: str, error: str):
    """Emit quality job failed event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_JOB_FAILED,
        data={
            "jobId": job_id,
            "chapterId": chapter_id,
            "error": error,
        },
        channel="quality"
    )


async def emit_quality_job_cancelled(job_id: str, chapter_id: str):
    """Emit quality job cancelled event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_JOB_CANCELLED,
        data={
            "jobId": job_id,
            "chapterId": chapter_id,
        },
        channel="quality"
    )


async def emit_quality_job_resumed(job_id: str, chapter_id: str):
    """Emit quality job resumed event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_JOB_RESUMED,
        data={
            "jobId": job_id,
            "chapterId": chapter_id,
            "resumedAt": utc_now_iso(),
        },
        channel="quality"
    )


async def emit_quality_segment_analyzed(
    segment_id: str,
    chapter_id: str,
    job_id: str,
    quality_score: float,
    quality_status: str,
    engine_results: list
):
    """Emit quality segment analyzed event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_SEGMENT_ANALYZED,
        data={
            "segmentId": segment_id,
            "chapterId": chapter_id,
            "jobId": job_id,
            "qualityScore": quality_score,
            "qualityStatus": quality_status,
            "engineResults": engine_results,
        },
        channel="quality"
    )


async def emit_quality_segment_failed(
    segment_id: str,
    chapter_id: str,
    job_id: str,
    error: str
):
    """Emit quality segment failed event"""
    await broadcaster.broadcast_event(
        event_type=EventType.QUALITY_SEGMENT_FAILED,
        data={
            "segmentId": segment_id,
            "chapterId": chapter_id,
            "jobId": job_id,
            "error": error,
        },
        channel="quality"
    )


# ==================== Segment CRUD Event Helpers ====================

async def emit_segment_created(
    segment_id: str,
    chapter_id: str,
    text: str = "",
    segment_type: str = "standard",
    order_index: int = 0
):
    """
    Emit segment created event when a new segment is added.

    Args:
        segment_id: The segment ID
        chapter_id: The chapter ID
        text: Segment text content
        segment_type: 'standard' or 'divider'
        order_index: Position in chapter
    """
    await broadcaster.broadcast_event(
        event_type=EventType.SEGMENT_CREATED,
        data={
            "segmentId": segment_id,
            "chapterId": chapter_id,
            "text": text,
            "segmentType": segment_type,
            "orderIndex": order_index,
        },
        channel="projects"
    )


async def emit_segment_deleted(segment_id: str, chapter_id: str):
    """
    Emit segment deleted event when a segment is removed.

    Args:
        segment_id: The segment ID
        chapter_id: The chapter ID
    """
    await broadcaster.broadcast_event(
        event_type=EventType.SEGMENT_DELETED,
        data={
            "segmentId": segment_id,
            "chapterId": chapter_id,
        },
        channel="projects"
    )


async def emit_segment_reordered(chapter_id: str, segment_ids: list):
    """
    Emit segment reordered event when segments are reordered within a chapter.

    Args:
        chapter_id: The chapter ID
        segment_ids: List of segment IDs in new order
    """
    await broadcaster.broadcast_event(
        event_type=EventType.SEGMENT_REORDERED,
        data={
            "chapterId": chapter_id,
            "segmentIds": segment_ids,
        },
        channel="projects"
    )


# ==================== Project CRUD Event Helpers ====================

async def emit_project_reordered(project_ids: list):
    """
    Emit project reordered event when projects are reordered.

    Args:
        project_ids: List of project IDs in new order
    """
    await broadcaster.broadcast_event(
        event_type=EventType.PROJECT_REORDERED,
        data={
            "projectIds": project_ids,
        },
        channel="projects"
    )


# ==================== Import Event Helpers ====================

async def emit_import_cancelled(import_id: str, message: str = ""):
    """
    Emit import cancelled event when an import is cancelled.

    Args:
        import_id: The import job ID
        message: Optional cancellation message
    """
    await broadcaster.broadcast_event(
        event_type=EventType.IMPORT_CANCELLED,
        data={
            "importId": import_id,
            "message": message,
        },
        channel="import"
    )


# ==================== Docker Host Event Helpers ====================

async def emit_docker_host_connected(
    host_id: str,
    docker_version: str,
    os_info: str,
    has_gpu: bool = False
):
    """
    Emit when Docker host connection is established.

    Args:
        host_id: Host identifier (e.g., 'docker:local', 'docker:gpu-server')
        docker_version: Docker daemon version (e.g., '24.0.6')
        os_info: Operating system info (e.g., 'Docker Desktop')
        has_gpu: Whether host has NVIDIA GPU runtime
    """
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_HOST_CONNECTED,
        data={
            "hostId": host_id,
            "dockerVersion": docker_version,
            "os": os_info,
            "isAvailable": True,
            "hasGpu": has_gpu,
        },
        channel="engines"
    )


async def emit_docker_host_disconnected(
    host_id: str,
    reason: str,
    error_code: str = "CONNECTION_LOST"
):
    """
    Emit when Docker host connection is lost.

    Args:
        host_id: Host identifier
        reason: Reason for disconnection (e.g., 'Connection refused', 'Timeout')
        error_code: Categorized error code for frontend handling
            - SSH_AUTH_FAILED: SSH authentication failed
            - CONNECTION_REFUSED: Connection refused (Docker daemon not running)
            - CONNECTION_TIMEOUT: Connection timeout
            - DNS_FAILED: Cannot resolve hostname
            - NETWORK_UNREACHABLE: Network unreachable
            - SSH_CONNECTION_FAILED: SSH connection failed
            - DOCKER_NOT_FOUND: Docker not found on remote host
            - CONNECTION_LOST: Generic connection lost (default)
    """
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_HOST_DISCONNECTED,
        data={
            "hostId": host_id,
            "reason": reason,
            "errorCode": error_code,
            "isAvailable": False,
        },
        channel="engines"
    )


async def emit_docker_host_connecting(host_id: str, attempt: int):
    """
    Emit when attempting to reconnect to Docker host.

    Args:
        host_id: Host identifier
        attempt: Reconnection attempt number (1, 2, 3, ...)
    """
    await broadcaster.broadcast_event(
        event_type=EventType.DOCKER_HOST_CONNECTING,
        data={
            "hostId": host_id,
            "attempt": attempt,
        },
        channel="engines"
    )
