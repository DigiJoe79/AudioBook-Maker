"""
Health Monitor Service

Provides non-blocking health status checks using a separate thread.
This ensures the /health endpoint responds immediately even when the
main thread is busy with long-running operations (e.g., TTS model loading).
"""

import threading
import time
from datetime import datetime
from typing import Dict, Any
from loguru import logger


class HealthMonitor:
    """
    Thread-safe health monitor that tracks system status.

    This service runs in a separate thread and continuously updates
    the health status, allowing the /health endpoint to respond immediately
    without blocking on the main application thread.
    """

    def __init__(self):
        self._status: Dict[str, Any] = {
            "status": "ok",
            "timestamp": datetime.now().isoformat(),
            "database": True,
            "busy": False,
            "active_jobs": 0
        }
        self._lock = threading.Lock()
        self._monitor_thread: threading.Thread | None = None
        self._running = False

    def start(self):
        """Start the health monitoring thread."""
        if self._running:
            logger.warning("[HealthMonitor] Already running")
            return

        self._running = True
        self._monitor_thread = threading.Thread(
            target=self._monitor_loop,
            daemon=True,
            name="HealthMonitor"
        )
        self._monitor_thread.start()
        logger.debug("[HealthMonitor] Started")

    def stop(self):
        """Stop the health monitoring thread."""
        self._running = False
        if self._monitor_thread:
            from config import HEALTH_MONITOR_STOP_TIMEOUT
            self._monitor_thread.join(timeout=HEALTH_MONITOR_STOP_TIMEOUT)
        logger.info("[HealthMonitor] Stopped")

    def _monitor_loop(self):
        """Main monitoring loop that updates status every second."""
        while self._running:
            try:
                with self._lock:
                    self._status["timestamp"] = datetime.now().isoformat()
                from config import HEALTH_MONITOR_INTERVAL
                time.sleep(HEALTH_MONITOR_INTERVAL)
            except Exception as e:
                logger.error(f"[HealthMonitor] Error in monitor loop: {e}")
                from config import HEALTH_MONITOR_INTERVAL
                time.sleep(HEALTH_MONITOR_INTERVAL)

    def get_status(self) -> Dict[str, Any]:
        """
        Get current health status.

        Returns immediately without blocking, even if main thread is busy.
        """
        with self._lock:
            return self._status.copy()

    def set_active_jobs(self, count: int):
        """Update active jobs count."""
        with self._lock:
            self._status["active_jobs"] = count

    def increment_active_jobs(self) -> int:
        """Increment active jobs counter and return new count."""
        with self._lock:
            self._status["active_jobs"] += 1
            self._status["busy"] = self._status["active_jobs"] > 0
            return self._status["active_jobs"]

    def decrement_active_jobs(self) -> int:
        """Decrement active jobs counter and return new count."""
        with self._lock:
            self._status["active_jobs"] = max(0, self._status["active_jobs"] - 1)
            self._status["busy"] = self._status["active_jobs"] > 0
            return self._status["active_jobs"]


# Global singleton instance
_health_monitor: HealthMonitor | None = None


def get_health_monitor() -> HealthMonitor:
    """Get the global health monitor instance."""
    global _health_monitor
    if _health_monitor is None:
        _health_monitor = HealthMonitor()
        _health_monitor.start()
    return _health_monitor


def shutdown_health_monitor() -> None:
    """Shutdown the global health monitor."""
    global _health_monitor
    if _health_monitor:
        _health_monitor.stop()
        _health_monitor = None
