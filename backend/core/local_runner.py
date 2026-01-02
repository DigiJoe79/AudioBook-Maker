"""
LocalRunner - Subprocess-based engine execution

Preserves the existing behavior of starting engines via subprocess.Popen
using isolated Python VENVs per engine.

This is the default runner for development and simple deployments.
"""

import asyncio
import os
import subprocess
from pathlib import Path
from typing import Dict, Optional

from loguru import logger

from core.engine_runner import EngineRunner, EngineEndpoint


class LocalRunner(EngineRunner):
    """
    Starts engines via subprocess.Popen using isolated VENVs.

    This preserves the existing engine execution behavior from BaseEngineManager,
    extracted into a pluggable runner for the dual-mode architecture.

    Attributes:
        engines_base_path: Base directory containing engine subdirectories
        processes: Active subprocess.Popen instances by variant_id
        endpoints: EngineEndpoint instances for running engines by variant_id
    """

    def __init__(self, engines_base_path: Path):
        """
        Initialize LocalRunner.

        Args:
            engines_base_path: Path to engines directory (e.g., backend/engines/)
        """
        self.engines_base_path = engines_base_path
        self.processes: Dict[str, subprocess.Popen] = {}  # variant_id -> process
        self.endpoints: Dict[str, EngineEndpoint] = {}  # variant_id -> endpoint

    async def start(
        self,
        variant_id: str,
        engine_type: str,
        config: dict
    ) -> EngineEndpoint:
        """
        Start engine server via subprocess.

        Args:
            variant_id: Variant identifier (e.g., "xtts:local")
            engine_type: Engine category (e.g., "tts")
            config: Configuration dict with:
                - port: HTTP port
                - venv_path: Path to engine's VENV
                - server_script: Path to server.py

        Returns:
            EngineEndpoint with localhost URL

        Raises:
            RuntimeError: If Python executable not found or process fails to start
        """
        venv_path = config.get('venv_path')
        server_script = config.get('server_script')
        port = config.get('port')

        if not venv_path or not server_script:
            raise RuntimeError(f"Engine {variant_id} missing venv_path or server_script in config")

        # Determine Python executable path based on OS
        if os.name == 'nt':  # Windows
            python_exe = Path(venv_path) / 'Scripts' / 'python.exe'
        else:  # Linux/Mac
            python_exe = Path(venv_path) / 'bin' / 'python'

        if not python_exe.exists():
            raise RuntimeError(f"Python executable not found: {python_exe}")

        # Build command
        cmd = [str(python_exe), str(server_script), '--port', str(port)]

        # Log with relative paths for readability
        try:
            backend_dir = Path(__file__).parent.parent
            script_rel = Path(server_script).relative_to(backend_dir)
            logger.info(f"[LocalRunner] Starting {variant_id}: {script_rel} --port {port}")
        except ValueError:
            logger.info(f"[LocalRunner] Starting {variant_id}: {' '.join(cmd)}")

        # Start subprocess
        process = subprocess.Popen(
            cmd,
            stdout=None,  # Inherit from parent
            stderr=None,  # Inherit from parent
            cwd=Path(server_script).parent
        )

        self.processes[variant_id] = process

        # Create endpoint
        endpoint = EngineEndpoint(base_url=f"http://127.0.0.1:{port}")
        self.endpoints[variant_id] = endpoint

        logger.debug(f"[LocalRunner] {variant_id} process started (PID: {process.pid})")

        return endpoint

    async def stop(self, variant_id: str) -> None:
        """
        Stop engine subprocess gracefully.

        Args:
            variant_id: Variant to stop (e.g., "xtts:local")
        """
        if variant_id not in self.processes:
            logger.debug(f"[LocalRunner] {variant_id} not running, nothing to stop")
            return

        process = self.processes[variant_id]

        logger.debug(f"[LocalRunner] Stopping {variant_id} (PID: {process.pid})...")

        # Terminate process
        process.terminate()

        # Wait for exit (with timeout)
        try:
            await asyncio.wait_for(
                asyncio.to_thread(process.wait),
                timeout=10.0
            )
            logger.info(f"[LocalRunner] {variant_id} stopped gracefully")
        except asyncio.TimeoutError:
            logger.warning(f"[LocalRunner] {variant_id} timeout, force killing...")
            process.kill()
            await asyncio.to_thread(process.wait)
            logger.info(f"[LocalRunner] {variant_id} force-killed")

        # Cleanup
        del self.processes[variant_id]
        self.endpoints.pop(variant_id, None)

    def is_running(self, variant_id: str) -> bool:
        """Check if engine subprocess is running."""
        if variant_id not in self.processes:
            return False

        process = self.processes[variant_id]
        exit_code = process.poll()

        if exit_code is not None:
            # Process exited - cleanup stale entry
            logger.debug(f"[LocalRunner] {variant_id} process exited (code: {exit_code})")
            del self.processes[variant_id]
            self.endpoints.pop(variant_id, None)
            return False

        return True

    def get_endpoint(self, variant_id: str) -> Optional[EngineEndpoint]:
        """Get endpoint for running engine."""
        return self.endpoints.get(variant_id)
