"""
Events API Router - Server-Sent Events (SSE) endpoint

Provides real-time event streaming for TTS jobs, segments, chapters, engines, and system health.

SSE Architecture:
- Long-lived HTTP connection using EventSourceResponse
- Client subscribes to specific channels (jobs, projects, export, health, engines, etc.)
- Server pushes events as they occur (no polling required)
- Automatic keepalive to prevent connection timeout
- Graceful cleanup on client disconnect

Available Channels:
- jobs: TTS job updates, segment updates, chapter content changes
- projects: Project and chapter CRUD events
- export: Export job updates
- import: Import job updates
- health: System health updates (30s interval)
- engines: Engine status updates (15s interval)
- speakers: Speaker management events
- settings: Settings updates
- pronunciation: Pronunciation rule events
- quality: Quality analysis job events

Usage:
    GET /api/events/subscribe?channels=jobs,health,engines

Example Client (JavaScript):
    const eventSource = new EventSource(
        'http://localhost:8765/api/events/subscribe?channels=jobs,health,engines'
    );

    eventSource.addEventListener('job.progress', (event) => {
        const data = JSON.parse(event.data);
        console.log('Job progress:', data.progress);
    });

    eventSource.addEventListener('engine.status', (event) => {
        const data = JSON.parse(event.data);
        console.log('Engine status:', data.engines);
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
        description="Comma-separated list of channels to subscribe to (e.g., 'jobs,health,engines')"
    )
):
    """
    Server-Sent Events endpoint for real-time updates.

    **Channels:**
    - `jobs` - TTS job updates, segment updates, chapter content changes
    - `projects` - Project and chapter CRUD events
    - `export` - Export job updates
    - `import` - Import job updates
    - `health` - System health updates (30s interval)
    - `engines` - Engine status updates (15s interval, countdown timers)
    - `speakers` - Speaker management events
    - `settings` - Settings updates
    - `pronunciation` - Pronunciation rule events
    - `quality` - Quality analysis job events

    **Default:** Subscribe to `jobs`, `health`, and `engines` channels if not specified.

    **Event Types (jobs channel):**
    - `job.created/started/progress/completed/failed/cancelled`
    - `segment.started/completed/failed/updated/frozen/unfrozen`
    - `chapter.updated` - Chapter content changed (segment deletion/reorder)

    **Event Types (projects channel):**
    - `project.created/updated/deleted`
    - `chapter.created/deleted/reordered/updated` - Chapter CRUD

    **Event Types (engines channel):**
    - `engine.status` - Periodic status (every 15s, includes countdown timers)
    - `engine.starting/started/stopping/stopped`
    - `engine.enabled/disabled/error`

    **Example:**
    ```
    GET /api/events/subscribe?channels=jobs,health,engines
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
        channel_list = ["jobs", "health", "engines"]

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
