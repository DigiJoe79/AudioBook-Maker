"""
Events API Router - Server-Sent Events (SSE) endpoint

Provides real-time event streaming for TTS jobs, segments, chapters, and system health.

SSE Architecture:
- Long-lived HTTP connection using EventSourceResponse
- Client subscribes to specific channels (jobs, chapter:{id}, export, health)
- Server pushes events as they occur (no polling required)
- Automatic keepalive to prevent connection timeout
- Graceful cleanup on client disconnect

Usage:
    GET /api/events/subscribe?channels=jobs,chapter:ch-1,health

Example Client (JavaScript):
    const eventSource = new EventSource(
        'http://localhost:8765/api/events/subscribe?channels=jobs,health'
    );

    eventSource.addEventListener('job.progress', (event) => {
        const data = JSON.parse(event.data);
        console.log('Job progress:', data.progress);
    });
"""

from typing import Optional
from fastapi import APIRouter, Request, Query
from sse_starlette.sse import EventSourceResponse
from services.event_broadcaster import broadcaster


router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("/subscribe")
async def subscribe_to_events(
    request: Request,
    channels: Optional[str] = Query(
        None,
        description="Comma-separated list of channels to subscribe to (e.g., 'jobs,chapter:ch-1,health')"
    )
):
    """
    Server-Sent Events endpoint for real-time updates.

    **Channels:**
    - `jobs` - Global job updates (all TTS jobs)
    - `chapter:{id}` - Chapter-specific updates (e.g., "chapter:ch-1")
    - `export` - Export job updates
    - `health` - System health updates

    **Default:** Subscribe to `jobs` and `health` channels if not specified.

    **Event Types:**
    - `connected` - Initial connection confirmation
    - `job.created` - New TTS job created
    - `job.started` - Job processing started
    - `job.progress` - Job progress update
    - `job.completed` - Job successfully completed
    - `job.failed` - Job failed with error
    - `job.cancelled` - Job cancelled by user
    - `job.resumed` - Cancelled job resumed
    - `segment.started` - Segment TTS generation started
    - `segment.completed` - Segment TTS completed
    - `segment.failed` - Segment TTS failed
    - `segment.updated` - General segment update
    - `chapter.updated` - Chapter metadata updated
    - `export.started` - Audio export started
    - `export.progress` - Export progress update
    - `export.completed` - Export completed
    - `export.failed` - Export failed
    - `health.update` - System health status update

    **Example:**
    ```
    GET /api/events/subscribe?channels=jobs,chapter:ch-1,health
    ```

    **Response Format:**
    ```
    event: job.progress
    data: {"jobId": "job-123", "progress": 46.0, "status": "running"}
    id: a1b2c3d4-5678-90ab-cdef-1234567890ab

    ```

    **Keepalive:**
    - Server sends keepalive comments every 15 seconds
    - Prevents connection timeout
    - Format: `: keepalive`

    **Client Disconnection:**
    - Automatic cleanup when client disconnects
    - No explicit unsubscribe needed
    - Resources freed immediately

    **Notes:**
    - Connection stays open indefinitely
    - Use `EventSource` API in browsers
    - Supports multiple simultaneous connections
    - Each client gets unique ID
    """
    # Parse channels parameter
    if channels:
        # Split by comma, strip whitespace, filter empty strings
        channel_list = [c.strip() for c in channels.split(",") if c.strip()]
    else:
        # Default channels if not specified
        channel_list = ["jobs", "health"]

    # Return SSE response with event stream
    return EventSourceResponse(
        broadcaster.subscribe(channels=channel_list),
        headers={
            # Prevent any caching of the event stream
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Disable nginx buffering (important for real-time streaming)
            "X-Accel-Buffering": "no",
        },
        # Set media type explicitly
        media_type="text/event-stream"
    )
