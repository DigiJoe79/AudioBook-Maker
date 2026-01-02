"""
Base Engine Discovery - Generic engine scanning

Shared discovery logic for all engine types (TTS, STT, etc.).
Subclasses can override _discover_engine() for type-specific validation.

This base class handles:
- Scanning engine directories
- Parsing engine.yaml files
- Validating engine structure (server.py, venv/, models/)
- Model discovery (explicit or auto-detect)

Example Usage:
    class TTSEngineDiscovery(BaseEngineDiscovery):
        def _discover_engine(self, engine_dir, engine_name):
            metadata = super()._discover_engine(engine_dir, engine_name)
            if metadata:
                # Add TTS-specific validation
                pass
            return metadata
"""

import hashlib
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import yaml
from loguru import logger
from pydantic import ValidationError

from models.engine_schema import validate_yaml_dict, EngineYamlSchema


@dataclass
class DiscoveredEngine:
    """Metadata for a discovered engine server"""
    name: str
    display_name: str
    version: str
    engine_dir: Path
    server_script: Path
    venv_path: Path
    config: Dict[str, Any]
    models: List[Dict[str, Any]]
    capabilities: Dict[str, bool]
    supported_languages: List[str]


class BaseEngineDiscovery:
    """
    Base class for engine discovery

    Scans engine directory and parses engine.yaml files.
    Subclasses can override methods for type-specific validation.

    Attributes:
        engines_base_path: Path to engines/ directory (e.g., backend/engines/tts/)
    """

    def __init__(self, engines_base_path: Path):
        """
        Initialize engine discovery

        Args:
            engines_base_path: Path to engines directory (e.g., backend/engines/tts/)
        """
        self.engines_base_path = engines_base_path

    def discover_all(self) -> Dict[str, Dict[str, Any]]:
        """
        Scan engines directory and discover all engine servers

        Returns:
            Dictionary mapping engine_name -> engine_metadata
        """
        if not self.engines_base_path.exists():
            logger.warning(f"Engines directory not found: {self.engines_base_path}")
            return {}

        logger.debug(f"Starting engine discovery in: {self.engines_base_path}")

        discovered_engines: Dict[str, Dict[str, Any]] = {}  # Local variable instead of self

        for engine_dir in self.engines_base_path.iterdir():
            if not engine_dir.is_dir():
                continue

            engine_name = engine_dir.name

            # Skip special directories
            if engine_name.startswith('_') or engine_name.startswith('.'):
                continue

            try:
                engine_metadata = self._discover_engine(engine_dir, engine_name)

                if engine_metadata:
                    discovered_engines[engine_name] = engine_metadata
                    logger.info(
                        f"[OK] Discovered engine: {engine_name} "
                        f"({engine_metadata.get('display_name', engine_name)})"
                    )

            except Exception as e:
                logger.warning(f"[SKIP] Could not discover engine '{engine_name}': {e}")

        logger.debug(f"Engine discovery complete: {len(discovered_engines)} engines found")
        return discovered_engines

    def _discover_engine(
        self,
        engine_dir: Path,
        engine_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        Discover a single engine server from its directory

        Discovery Steps:
        1. Check for server.py
        2. Check for engine.yaml (required)
        3. Check for venv/ (required)
        4. Parse metadata from engine.yaml
        5. Auto-detect or parse models
        6. Return metadata dict

        This method can be overridden by subclasses for type-specific validation.

        Args:
            engine_dir: Path to engine directory (e.g., engines/tts/xtts/)
            engine_name: Engine identifier (e.g., 'xtts')

        Returns:
            Engine metadata dict or None if not found/invalid
        """
        # 1. Check for server.py
        server_script = engine_dir / "server.py"
        if not server_script.exists():
            logger.debug(f"No server.py found in {engine_dir}")
            return None

        # 2. Check for engine.yaml (REQUIRED)
        yaml_file = engine_dir / "engine.yaml"
        if not yaml_file.exists():
            logger.warning(f"No engine.yaml found in {engine_dir}")
            return None

        # 3. Parse and validate engine.yaml
        try:
            with open(yaml_file, 'r', encoding='utf-8') as f:
                yaml_content = f.read()
            raw_config = yaml.safe_load(yaml_content)
            # Calculate hash of YAML content for change detection
            config_hash = hashlib.sha256(yaml_content.encode('utf-8')).hexdigest()[:16]
        except Exception as e:
            logger.error(f"Failed to parse {yaml_file}: {e}")
            return None

        # Validate with Pydantic schema
        try:
            validated_config: EngineYamlSchema = validate_yaml_dict(raw_config)
        except ValidationError as e:
            logger.warning(f"Schema validation failed for {engine_name}: {e}")
            return None

        # 4. Check for venv/ (determines is_installed status)
        installation = validated_config.installation
        is_installed = True
        venv_path = None

        if installation:
            venv_path_str = installation.venv_path
            venv_path = engine_dir / venv_path_str

            if not venv_path.exists():
                logger.info(
                    f"Engine {engine_name} found but not installed (VENV missing: {venv_path})"
                )
                is_installed = False
        # else: No installation info (Docker-only engine) - always "installed"

        # 5. Build metadata
        # Use models from YAML, with optional auto-discovery fallback
        if validated_config.auto_discover_models:
            # Auto-detect models from models/ directory
            models = self._auto_detect_models(engine_dir)
        else:
            # Use explicit models from engine.yaml
            models = self._parse_models_from_schema(validated_config.models, engine_dir)

        metadata = {
            'name': validated_config.name,
            'display_name': validated_config.display_name,
            'engine_dir': engine_dir,
            'server_script': server_script,
            'venv_path': venv_path,
            'is_installed': is_installed,
            'config_hash': config_hash,
            'config': raw_config,  # Keep raw config for backwards compatibility
            'models': models,
            'capabilities': validated_config.capabilities,
            'constraints': validated_config.constraints,
            'supported_languages': validated_config.supported_languages
        }

        return metadata

    def _parse_models_from_schema(
        self,
        models: List,  # List of ModelDefinition from Pydantic
        engine_dir: Path
    ) -> List[Dict[str, Any]]:
        """
        Parse models from validated Pydantic schema.

        Args:
            models: List of ModelDefinition instances from validated schema
            engine_dir: Engine directory path

        Returns:
            List of model metadata dicts
        """
        parsed_models = []

        for model_def in models:
            # Convert Pydantic model to dict to access all fields (including extras)
            model_dict = model_def.model_dump()

            model_name = model_dict.get('name')
            if not model_name:
                continue

            # Build model metadata
            model_metadata = {
                'engine_model_name': model_name,
                'display_name': model_dict.get('display_name', model_name),
            }

            # Check if model has a path (local model)
            model_path_str = model_dict.get('path')
            if model_path_str:
                # Resolve path relative to engine directory
                model_path = engine_dir / model_path_str
                model_metadata['path'] = str(model_path)
                model_metadata['exists'] = model_path.exists()
            else:
                # No path = remote/auto-downloaded model
                model_metadata['path'] = None
                model_metadata['exists'] = None

            # Include all additional metadata from schema (e.g., size_mb, vram_gb, etc.)
            for key, value in model_dict.items():
                if key not in ['name', 'path', 'display_name']:
                    model_metadata[key] = value

            parsed_models.append(model_metadata)

        return parsed_models

    def _parse_models(
        self,
        models_config: List[Dict[str, Any]],
        engine_dir: Path
    ) -> List[Dict[str, Any]]:
        """
        Parse models from engine.yaml config

        Args:
            models_config: List of model configs from engine.yaml
            engine_dir: Engine directory path

        Returns:
            List of model metadata dicts with resolved paths
            NOTE: Dict keys are snake_case (backend-consumed, not exposed to frontend API)
        """
        models = []

        for model_cfg in models_config:
            model_name = model_cfg.get('name')
            model_path_str = model_cfg.get('path')  # Optional - may be None for remote models

            if not model_name:
                logger.warning(f"Invalid model config (missing 'name'): {model_cfg}")
                continue

            # Build model metadata
            model_metadata = {
                'engine_model_name': model_name,  # Use engine_ prefix to avoid Pydantic namespace conflict
                'display_name': model_cfg.get('display_name', model_name),
            }

            # Add path-related fields only if path is provided
            if model_path_str:
                # Resolve path relative to engine directory
                model_path = engine_dir / model_path_str
                model_metadata['path'] = str(model_path)
                model_metadata['exists'] = model_path.exists()
            else:
                # No path = remote/auto-downloaded model (e.g., Whisper models from OpenAI)
                model_metadata['path'] = None
                model_metadata['exists'] = None  # Unknown until downloaded

            # Include additional metadata from config (e.g., size_mb, speed, accuracy for Whisper)
            for key, value in model_cfg.items():
                if key not in ['name', 'path', 'display_name']:
                    model_metadata[key] = value

            models.append(model_metadata)

        return models

    def _auto_detect_models(self, engine_dir: Path) -> List[Dict[str, Any]]:
        """
        Auto-detect models from engine's models/ directory

        Scans the models/ subdirectory and treats each subdirectory as a model.
        Only includes models that actually exist on disk.

        Args:
            engine_dir: Engine directory path

        Returns:
            List of detected model metadata dicts
        """
        models = []
        models_dir = engine_dir / 'models'

        if not models_dir.exists():
            logger.debug(f"No models directory found in {engine_dir}")
            return models

        # Scan for subdirectories in models/
        for model_path in models_dir.iterdir():
            if not model_path.is_dir():
                continue  # Skip files, only process directories

            model_name = model_path.name

            # Check if this looks like a valid model directory
            # (has at least one file, not empty)
            if not any(model_path.iterdir()):
                logger.debug(f"Skipping empty model directory: {model_name}")
                continue

            models.append({
                'engine_model_name': model_name,
                'path': str(model_path),
                'display_name': f"{model_name.upper()}",
                'exists': True  # We already checked it exists
            })

        if models:
            logger.debug(f"Auto-detected {len(models)} model(s) in {engine_dir.name}: {[m['engine_model_name'] for m in models]}")
        else:
            logger.warning(f"No models found in {models_dir}")

        return models
