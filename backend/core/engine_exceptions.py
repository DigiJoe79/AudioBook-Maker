"""
Engine Exception Classes

Shared exception types for engine HTTP communication.
Used by all engine managers (TTS, STT, Audio, Text) and workers.
"""


class EngineClientError(Exception):
    """
    400/404 - Client error, request is invalid.

    NOT retryable - the same request will fail again.
    Examples: text too long, model not found, missing speaker samples.
    """
    pass


class EngineLoadingError(Exception):
    """
    503 - Engine is loading model.

    Retryable WITHOUT restart - just wait and retry.
    The engine is running but not ready to process requests yet.
    """
    pass


class EngineServerError(Exception):
    """
    500 - Server error, engine may have crashed.

    Retryable WITH restart - restart engine and retry.
    """
    pass


class EngineHostUnavailableError(Exception):
    """
    Host is not reachable for engine operations.

    NOT retryable - the Docker host is down or disconnected.
    User must fix host connectivity before retrying.

    Error format: [ENGINE_HOST_UNAVAILABLE]host:<host_id>
    """
    pass
