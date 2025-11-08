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
from typing import Dict, Set, AsyncGenerator, Any, Optional
from datetime import datetime
from loguru import logger


class EventType:
    """Event type constants for SSE broadcasting"""

    # Segment events
    SEGMENT_UPDATED = "segment.updated"
    SEGMENT_STARTED = "segment.started"
    SEGMENT_COMPLETED = "segment.completed"
    SEGMENT_FAILED = "segment.failed"

    # Job events
    JOB_CREATED = "job.created"
    JOB_STARTED = "job.started"
    JOB_PROGRESS = "job.progress"
    JOB_COMPLETED = "job.completed"
    JOB_FAILED = "job.failed"
    JOB_CANCELLED = "job.cancelled"
    JOB_RESUMED = "job.resumed"

    # Chapter events
    CHAPTER_UPDATED = "chapter.updated"

    # Export events
    EXPORT_STARTED = "export.started"
    EXPORT_PROGRESS = "export.progress"
    EXPORT_COMPLETED = "export.completed"
    EXPORT_FAILED = "export.failed"

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


class EventBroadcaster:
    """
    Singleton service for managing Server-Sent Events broadcasting.

    Manages client connections, subscriptions, and event distribution.
    Events are routed to clients based on channel subscriptions.

    Channels:
    - "jobs" - All TTS job updates
    - "chapter:{id}" - Updates for specific chapter
    - "export" - Export job updates
    - "health" - System health updates
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

        logger.info("[EventBroadcaster] Initialized")

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
            async for event in broadcaster.subscribe(["jobs", "chapter:ch-1"]):
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

        logger.info(
            f"[EventBroadcaster] Client {client_id[:8]} subscribed to channels: {channels}"
        )

        try:
            # Send initial connection event
            yield {
                "event": "connected",
                "data": json.dumps({
                    "clientId": client_id,
                    "channels": channels,
                    "timestamp": datetime.utcnow().isoformat()
                }),
                "id": str(uuid.uuid4())
            }

            # Continuous event stream
            while True:
                try:
                    # Wait for event with timeout (for keepalive)
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
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

        logger.info(
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
            return

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
            "_timestamp": datetime.utcnow().isoformat(),
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
            return

        # Broadcast to all subscribers
        async with self._lock:
            subscribers = self.subscriptions.get(channel, set()).copy()

        if not subscribers:
            return

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

        # Also broadcast to chapter-specific channel if available
        # (for future chapter-specific subscriptions)
        chapter_id = segment_data.get("chapterId")
        if chapter_id:
            await self.broadcast_event(
                event_type=event_type,
                data=segment_data,
                channel=f"chapter:{chapter_id}"
            )

    async def broadcast_job_update(
        self,
        job_data: Dict[str, Any],
        event_type: str = EventType.JOB_PROGRESS
    ):
        """
        Broadcast job update event.

        Broadcasts to "jobs" channel (all jobs) and optionally to chapter-specific
        channel if chapterId is present.

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
        # Broadcast to global jobs channel
        await self.broadcast_event(
            event_type=event_type,
            data=job_data,
            channel="jobs"
        )

        # Also broadcast to chapter-specific channel if available
        chapter_id = job_data.get("chapterId")
        if chapter_id:
            await self.broadcast_event(
                event_type=event_type,
                data=job_data,
                channel=f"chapter:{chapter_id}"
            )

    async def broadcast_chapter_update(self, chapter_data: Dict[str, Any]):
        """
        Broadcast chapter update event.

        Args:
            chapter_data: Chapter data including chapterId

        Example:
            await broadcaster.broadcast_chapter_update({
                "chapterId": "ch-1",
                "title": "Chapter 1",
                "segmentCount": 50
            })
        """
        chapter_id = chapter_data.get("chapterId")
        if not chapter_id:
            logger.error(
                "[EventBroadcaster] Chapter update missing chapterId"
            )
            return

        await self.broadcast_event(
            event_type=EventType.CHAPTER_UPDATED,
            data=chapter_data,
            channel=f"chapter:{chapter_id}"
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


async def emit_job_created(
    job_id: str,
    chapter_id: str,
    total_segments: int,
    segment_ids: list
):
    """
    Emit job created event immediately when job is queued.

    This provides instant UI feedback when user creates a job,
    before the worker picks it up.
    """
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "pending",
            "totalSegments": total_segments,
            "processedSegments": 0,
            "progress": 0.0,
            "segmentIds": segment_ids
        },
        event_type=EventType.JOB_CREATED
    )


async def emit_job_started(
    job_id: str,
    chapter_id: str,
    total_segments: int,
    segment_ids: list
):
    """Emit job started event with segment details"""
    await broadcaster.broadcast_job_update(
        {
            "jobId": job_id,
            "chapterId": chapter_id,
            "status": "running",
            "totalSegments": total_segments,
            "processedSegments": 0,
            "progress": 0.0,
            "segmentIds": segment_ids
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
    message: Optional[str] = None
):
    """Emit job progress event"""
    data = {
        "jobId": job_id,
        "chapterId": chapter_id,
        "status": "running",
        "processedSegments": processed_segments,
        "totalSegments": total_segments,
        "progress": progress,
        "segmentIds": segment_ids
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
