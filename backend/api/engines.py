"""
Engine Management API Endpoints

Provides endpoints for engine enable/disable, start/stop, and status monitoring.
"""

from fastapi import APIRouter, Depends
import sqlite3
from typing import List, Dict, Any, Optional
from loguru import logger

from core.exceptions import ApplicationError
from db.database import get_db
from services.settings_service import SettingsService
from services.event_broadcaster import (
    emit_engine_enabled,
    emit_engine_disabled,
    emit_docker_image_installing,
    emit_docker_image_installed,
    emit_docker_image_cancelled,
    emit_docker_image_error,
    safe_broadcast,
)
from models.response_models import (
    MessageResponse,
    AllEnginesStatusResponse,
    EngineStatusInfo,
    DockerCatalogResponse,
    DockerImageInfo,
    DockerInstallResponse,
    CamelCaseModel,
    CatalogSyncResponse,
    DiscoverModelsResponse,
    DockerDiscoverResponse,
    DockerRegisterResponse,
    ImageUpdateCheckResponse,
)
from core.tts_engine_manager import get_tts_engine_manager
from core.text_engine_manager import get_text_engine_manager
from core.stt_engine_manager import get_stt_engine_manager
from core.audio_engine_manager import get_audio_engine_manager
from core.base_engine_manager import parse_variant_id, EngineStartupCancelledError
from db.docker_image_catalog_repository import DockerImageCatalogRepository
from db.engine_model_repository import EngineModelRepository
from db.engine_repository import EngineRepository
from db.engine_host_repository import EngineHostRepository

router = APIRouter(prefix="/engines", tags=["engines"])


class EngineActionRequest(CamelCaseModel):
    """Request to perform action on engine"""
    engine_type: str  # 'tts', 'text', 'stt', 'audio'
    engine_name: str


class EngineStartRequest(CamelCaseModel):
    """Request to start an engine with optional model"""
    model_name: Optional[str] = None  # Optional, uses default if not specified



def _get_engine_manager(engine_type: str):
    """Get the appropriate engine manager for the given type"""
    if engine_type == 'tts':
        return get_tts_engine_manager()
    elif engine_type == 'text':
        return get_text_engine_manager()
    elif engine_type == 'stt':
        return get_stt_engine_manager()
    elif engine_type == 'audio':
        return get_audio_engine_manager()
    else:
        raise ValueError(f"Unknown engine type: {engine_type}")


def _extract_parameter_defaults(parameter_schema: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract default values from a parameter schema.

    Parameter schema format: {param_name: {type, default, min, max, ...}}
    Returns: {param_name: default_value}
    """
    defaults = {}
    for name, schema in parameter_schema.items():
        if isinstance(schema, dict) and 'default' in schema:
            defaults[name] = schema['default']
    return defaults


@router.get("/status", response_model=AllEnginesStatusResponse)
async def get_all_engines_status(conn: sqlite3.Connection = Depends(get_db)):
    """
    Get status of all discovered engines across all types.

    Returns engines grouped by type (TTS, Text, STT, Audio) with detailed status info.
    Includes feature-gating summary (has_tts_engine, has_text_engine, has_stt_engine).

    Returns:
        AllEnginesStatusResponse with engines grouped by type
    """
    try:
        from db.engine_repository import EngineRepository

        # Primary data source: engines table (Single Source of Truth)
        engine_repo = EngineRepository(conn)
        all_engines = engine_repo.get_all()

        settings_service = SettingsService(conn)
        # Get allowed languages for TTS filtering
        allowed_languages = settings_service.get_setting('languages.allowedLanguages') or ["de", "en"]

        # Get all engine managers (for runtime status only)
        tts_manager = get_tts_engine_manager()
        text_manager = get_text_engine_manager()
        stt_manager = get_stt_engine_manager()
        audio_manager = get_audio_engine_manager()

        # Helper function to combine DB data with runtime status
        async def build_status_info(
            engine: Dict[str, Any],
            manager
        ) -> EngineStatusInfo:
            """
            Combine DB data from engines table with runtime status from manager.

            Args:
                engine: Engine dict from engines table (Single Source of Truth)
                manager: Engine manager for runtime status

            Returns:
                EngineStatusInfo with combined data
            """
            try:
                variant_id = engine["variant_id"]
                base_engine_name = engine["base_engine_name"]
                engine_type = engine["engine_type"]
                is_enabled = engine.get("enabled", False)
                is_installed = engine.get("is_installed", False)

                # Runtime status from manager
                is_running = manager.is_engine_running(variant_id)

                # Determine status (order matters! Check transitions first)
                if not is_installed:
                    status = "not_installed"
                elif not is_enabled:
                    status = "disabled"
                elif manager.is_engine_stopping(variant_id):
                    status = "stopping"
                elif manager.is_engine_starting(variant_id):
                    status = "starting"
                elif is_running:
                    status = "running"
                else:
                    status = "stopped"

                # Is this the default engine for its type?
                is_default = engine.get("is_default", False)

                # Get models from engine_models table (populated via manual discovery)
                model_repo = EngineModelRepository(conn)
                available_models = model_repo.get_model_names(variant_id)

                # Get auto-stop countdown
                seconds_until_auto_stop = manager.get_seconds_until_auto_stop(variant_id)
                idle_timeout_seconds = manager._inactivity_timeout if variant_id not in manager._exempt_from_auto_stop else None

                # Get device, loaded_model, package_version, and GPU memory from health check if engine is running
                # Note: Don't try health check during 'starting' phase - it's expected to fail
                device = engine.get("requires_gpu") and "gpu" or "cpu"
                loaded_model = None
                error_message = None
                package_version = None
                gpu_memory_used_mb = None
                gpu_memory_total_mb = None
                if is_running and status == "running":  # Only check if fully running, not starting
                    try:
                        logger.debug("build_status_info: invoking health check", variant_id=variant_id, engine_type=engine_type)
                        health_data = await manager.health_check(variant_id)
                        device = health_data.get("device", device)
                        loaded_model = health_data.get("currentEngineModel")
                        package_version = health_data.get("packageVersion")  # Dynamic version from pip package
                        # GPU memory info (only for CUDA engines)
                        gpu_memory_used_mb = health_data.get("gpuMemoryUsedMb")
                        gpu_memory_total_mb = health_data.get("gpuMemoryTotalMb")
                    except Exception as health_err:
                        # Health check failed on running engine - process exists but server not responding
                        logger.warning(f"Health check failed for running engine {variant_id}: {type(health_err).__name__}: {health_err}")
                        # Set status to error - the process exists but the server isn't working
                        status = "error"
                        error_message = f"Server not responding: {type(health_err).__name__}"

                # Get default model name from engine_models table (SSOT)
                default_model_name = model_repo.get_default_model(variant_id)
                # Get default language from engines table (per-variant)
                default_language = engine.get("default_language")

                # Get supported languages from DB (use `or []` to handle explicit None)
                engine_languages = engine.get("supported_languages") or []

                # Filter languages by allowedLanguages for TTS and text processing engines
                if engine_type in ("tts", "text"):
                    filtered_languages = [lang for lang in engine_languages if lang in allowed_languages]
                    logger.debug(
                        "build_status_info: language filtering applied",
                        variant_id=variant_id,
                        engine_languages=engine_languages,
                        allowed_languages=allowed_languages,
                        filtered_languages=filtered_languages
                    )
                else:
                    # Other engine types (stt, audio) use unfiltered languages
                    filtered_languages = engine_languages

                # Get keep_running flag from DB (per-variant)
                keep_running = engine.get("keep_running", False)

                # Determine runner details from host_id
                host_id = engine.get("host_id", "local")
                if host_id == "local":
                    runner_id = "local"
                    runner_type = "subprocess"
                    runner_host = None
                elif host_id.startswith("docker:"):
                    runner_id = host_id  # docker:local or docker:abc123
                    runner_host = host_id.split(":", 1)[1]  # local or abc123
                    runner_type = "docker:local" if runner_host == "local" else "docker:remote"
                else:
                    runner_id = host_id
                    runner_type = "unknown"
                    runner_host = None
                logger.debug(
                    "build_status_info: runner type determined",
                    variant_id=variant_id,
                    host_id=host_id,
                    runner_type=runner_type,
                    runner_host=runner_host
                )

                # Use source from database (local/catalog/custom)
                source = engine.get("source", "local")

                # Construct display name with variant suffix for clarity
                # Format: "Engine Name (venv)" / "Engine Name (local)" / "Engine Name (Host Name)"
                base_display_name = engine.get("display_name", base_engine_name)
                if host_id == "local":
                    variant_suffix = "(venv)"
                elif host_id == "docker:local":
                    variant_suffix = "(local)"
                else:
                    # Remote Docker host - look up display name from engine_hosts table
                    host_repo = EngineHostRepository(conn)
                    host_data = host_repo.get_by_id(host_id)
                    host_display_name = host_data.get("display_name", runner_host) if host_data else runner_host
                    variant_suffix = f"({host_display_name})"
                full_display_name = f"{base_display_name} {variant_suffix}"

                return EngineStatusInfo(
                    variant_id=variant_id,
                    display_name=full_display_name,
                    version=package_version or "",  # Only show version when engine is running
                    engine_type=engine_type,
                    is_enabled=is_enabled,
                    is_running=is_running,
                    is_default=is_default,
                    is_pulling=engine.get("is_pulling", False),
                    status=status,
                    port=manager.engine_ports.get(variant_id),
                    error_message=error_message,
                    idle_timeout_seconds=idle_timeout_seconds,
                    seconds_until_auto_stop=seconds_until_auto_stop,
                    keep_running=keep_running,
                    supported_languages=filtered_languages,
                    all_supported_languages=engine_languages,  # Unfiltered for Settings UI
                    device=device,
                    gpu_memory_used_mb=gpu_memory_used_mb,
                    gpu_memory_total_mb=gpu_memory_total_mb,
                    available_models=available_models,
                    loaded_model=loaded_model,
                    default_model_name=default_model_name,
                    default_language=default_language,
                    # Variant fields
                    base_engine_name=base_engine_name,
                    runner_id=runner_id,
                    runner_type=runner_type,
                    runner_host=runner_host,
                    source=source,
                    docker_image=engine.get("docker_image"),
                    docker_tag=engine.get("docker_tag"),
                    is_installed=is_installed,
                    parameters=engine.get("parameters"),
                )
            except Exception as e:
                logger.error(f"Failed to build status info for engine {variant_id}: {e}", exc_info=True)
                raise

        # Map engine type to manager
        manager_map = {
            "tts": tts_manager,
            "text": text_manager,
            "stt": stt_manager,
            "audio": audio_manager,
        }

        # Collect engines by type from DB (Single Source of Truth)
        tts_engines: List[EngineStatusInfo] = []
        text_engines: List[EngineStatusInfo] = []
        stt_engines: List[EngineStatusInfo] = []
        audio_engines: List[EngineStatusInfo] = []

        # Build status info for all engines from DB
        for engine in all_engines:
            engine_type = engine.get("engine_type")
            manager = manager_map.get(engine_type)

            if not manager:
                logger.warning(f"Unknown engine type: {engine_type} for {engine.get('variant_id')}")
                continue

            try:
                status_info = await build_status_info(engine, manager)

                # Add to appropriate list
                if engine_type == "tts":
                    tts_engines.append(status_info)
                elif engine_type == "text":
                    text_engines.append(status_info)
                elif engine_type == "stt":
                    stt_engines.append(status_info)
                elif engine_type == "audio":
                    audio_engines.append(status_info)

            except Exception as e:
                logger.error(f"Failed to build status for engine {engine.get('variant_id')}: {e}")
                # Continue processing other engines

        # Feature-gating summary
        has_tts_engine = any(e.is_enabled for e in tts_engines)
        has_text_engine = any(e.is_enabled for e in text_engines)
        has_stt_engine = any(e.is_enabled for e in stt_engines)

        logger.debug(
            f"Engine status: TTS={len(tts_engines)} (enabled={has_tts_engine}), "
            f"Text={len(text_engines)} (enabled={has_text_engine}), "
            f"STT={len(stt_engines)} (enabled={has_stt_engine}), "
            f"Audio={len(audio_engines)}"
        )

        return AllEnginesStatusResponse(
            success=True,
            tts=tts_engines,
            text=text_engines,
            stt=stt_engines,
            audio=audio_engines,
            has_tts_engine=has_tts_engine,
            has_text_engine=has_text_engine,
            has_stt_engine=has_stt_engine,
        )

    except Exception as e:
        logger.error(f"Failed to get engine status: {e}")
        raise ApplicationError("ENGINE_STATUS_FAILED", status_code=500, error=str(e))


@router.get("/catalog", response_model=DockerCatalogResponse)
async def get_docker_image_catalog(conn: sqlite3.Connection = Depends(get_db)):
    """
    Get available Docker images from catalog.

    Returns all known Docker images with their metadata for UI display.

    Returns:
        DockerCatalogResponse with available images
    """
    try:
        catalog_repo = DockerImageCatalogRepository(conn)
        all_images = catalog_repo.get_all()

        from models.response_models import DockerImageVariant

        images = []
        for entry in all_images:
            tags = entry.get("tags") or ["latest"]
            requires_gpu_top = entry.get("requires_gpu", False)

            # Build variants list with GPU requirement per tag
            # Use heuristic: 'cpu' tag = no GPU, others inherit top-level requires_gpu
            variants = []
            for tag in tags:
                if tag == 'cpu':
                    tag_gpu = False
                elif tag in ('latest', 'gpu'):
                    tag_gpu = requires_gpu_top
                else:
                    # Unknown tag - use top-level as fallback
                    tag_gpu = requires_gpu_top
                variants.append(DockerImageVariant(tag=tag, requires_gpu=tag_gpu))

            images.append(DockerImageInfo(
                engine_name=entry.get("base_engine_name", ""),
                image=entry.get("image_name", ""),
                engine_type=entry.get("engine_type", ""),
                display_name=entry.get("display_name", ""),
                description=entry.get("description", ""),
                requires_gpu=requires_gpu_top,
                tags=tags,
                default_tag=entry.get("default_tag", "latest"),
                supported_languages=entry.get("supported_languages") or [],
                models=[m.get("name", "default") for m in (entry.get("models") or [])],
                variants=variants,
            ))


        return DockerCatalogResponse(success=True, images=images)

    except Exception as e:
        logger.error(f"Failed to get catalog: {e}")
        raise ApplicationError("CATALOG_LOAD_FAILED", status_code=500, error=str(e))


@router.post("/catalog/sync", response_model=CatalogSyncResponse)
async def sync_online_catalog(conn: sqlite3.Connection = Depends(get_db)):
    """
    Sync catalog from online source (GitHub Release).

    Fetches catalog.yaml from audiobook-maker-engines releases and merges
    with local database:
    - source='builtin' or 'online': Replaced with online data
    - source='custom': Kept unchanged

    Returns:
        CatalogSyncResponse with sync statistics
    """
    try:
        from services.online_catalog_service import fetch_online_catalog, sync_catalog_to_db

        # Fetch online catalog
        logger.info("Fetching online catalog...")
        online_catalog = await fetch_online_catalog()

        catalog_version = online_catalog.get("catalogVersion", "unknown")
        engine_count = len(online_catalog.get("engines", []))
        logger.info(f"Fetched catalog v{catalog_version} with {engine_count} engines")

        # Sync to database
        added, updated, skipped = sync_catalog_to_db(conn, online_catalog)

        message = f"Synced {added + updated} engines ({added} added, {updated} updated, {skipped} skipped)"
        logger.info(message)

        return CatalogSyncResponse(
            success=True,
            added=added,
            updated=updated,
            skipped=skipped,
            message=message,
        )

    except Exception as e:
        logger.error(f"Failed to sync catalog: {e}")
        raise ApplicationError("CATALOG_SYNC_FAILED", status_code=500, error=str(e))


@router.post("/docker/{variant_id}/install", response_model=DockerInstallResponse)
async def install_docker_image(
    variant_id: str,
    tag: Optional[str] = None,
    force: bool = False,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Install (pull) a Docker image for an engine variant.

    Args:
        variant_id: Variant identifier (e.g., 'xtts:docker:local')
        tag: Docker image tag to install (e.g., 'latest', 'cpu'). If not provided, uses default_tag from catalog.
        force: If True, pull image even if already installed (for updates).

    Returns:
        DockerInstallResponse with installation status

    Raises:
        400: If variant_id format is invalid
        404: If engine not found in catalog
        409: If image already installed (unless force=True)
    """
    try:
        from models.engine_variant_models import parse_variant_id, get_host_id_from_variant

        # Parse variant ID
        try:
            variant = parse_variant_id(variant_id)
        except ValueError as e:
            raise ApplicationError("INVALID_VARIANT_ID", status_code=400, variantId=variant_id, error=str(e))

        if variant.source != "docker":
            raise ApplicationError("NOT_DOCKER_VARIANT", status_code=400, variantId=variant_id)

        # Get image info from catalog
        catalog_repo = DockerImageCatalogRepository(conn)
        image_info = catalog_repo.get_by_engine_name(variant.engine_name)
        if not image_info:
            raise ApplicationError("VARIANT_NOT_FOUND", status_code=404, variantId=variant_id)

        # Ensure the Docker host exists in engine_hosts table
        host_repo = EngineHostRepository(conn)
        db_host_id = get_host_id_from_variant(variant)  # e.g., 'docker:local' or 'docker:abc123'
        if not host_repo.get_by_id(db_host_id):
            # Create the host entry
            if variant.runner_type == "docker:local":
                host_repo.ensure_docker_local_exists()
            else:
                # For remote hosts, they should already exist
                raise ApplicationError("HOST_NOT_FOUND", status_code=400, hostId=db_host_id)

        # Check if already installed in engines table (skip check if force=True for updates)
        engine_repo = EngineRepository(conn)
        existing_engine = engine_repo.get_by_id(variant_id)
        if not force and existing_engine and existing_engine.get("is_installed"):
            raise ApplicationError("IMAGE_ALREADY_INSTALLED", status_code=409, variantId=variant_id)

        # Get metadata from catalog (use 'or' to handle NULL values from DB)
        models = image_info.get("models") or []  # Full model objects with metadata
        default_model = image_info.get("default_model", models[0].get("name") if models else None)
        parameter_schema = image_info.get("parameters") or {}
        parameter_defaults = _extract_parameter_defaults(parameter_schema)
        constraints = image_info.get("constraints") or {}
        capabilities = image_info.get("capabilities") or {}

        # Build config with full parameter schema for settings UI
        engine_config = {"parameters": parameter_schema} if parameter_schema else None

        image_name = image_info.get("image_name", "")
        # Use provided tag or fall back to default_tag from catalog
        image_tag = tag or image_info.get("default_tag", "latest")

        logger.debug(
            "install_docker_image: pre-install state check",
            variant_id=variant_id,
            image=f"{image_name}:{image_tag}",
            force=force,
            existing_engine=bool(existing_engine),
            is_installed=existing_engine.get("is_installed") if existing_engine else None,
            is_enabled=existing_engine.get("enabled") if existing_engine else None
        )

        # Actually pull the Docker image with progress events
        from services.docker_service import (
            pull_image_with_progress, is_docker_available, PullCancelledException,
            get_image_id, remove_dangling_image
        )
        from docker.errors import DockerException

        # Get host_id for docker_service calls (maps variant to engine_hosts host_id)
        docker_host_id = get_host_id_from_variant(variant)

        if not is_docker_available(docker_host_id):
            raise ApplicationError("DOCKER_NOT_AVAILABLE", status_code=503, hostId=docker_host_id or "local")

        # Use db_host_id for database and SSE events (consistent with engine_hosts table)
        engine_type = image_info["engine_type"]

        # Get current image ID before pull (for dangling image cleanup after update)
        old_image_id = get_image_id(image_name, image_tag, docker_host_id) if force else None

        # Create/update engine with is_pulling=True BEFORE pull starts (SSOT)
        # This allows the frontend to show progress even after page navigation
        if not existing_engine:
            # New install: create minimal record with is_pulling=True
            engine_repo.upsert(
                variant_id=variant_id,
                base_engine_name=variant.engine_name,
                engine_type=engine_type,
                host_id=db_host_id,
                source="catalog",
                is_installed=False,
                display_name=image_info.get('display_name', variant.engine_name),
                docker_image=image_info["image_name"],
                docker_tag=image_tag,
            )
        engine_repo.set_pulling(variant_id, True)

        await emit_docker_image_installing(variant_id, image_name, db_host_id)

        try:
            logger.info(f"Pulling Docker image {image_name}:{image_tag} for {variant_id} (host: {docker_host_id or 'local'})")
            pull_result = await pull_image_with_progress(
                image_name,
                image_tag,
                variant_id=variant_id,
                host_id=docker_host_id
            )
            logger.info(f"Pull complete: {pull_result['message']}")

            # Clean up old dangling image after successful update
            if old_image_id:
                new_image_id = pull_result.get('image_id')
                if new_image_id and new_image_id != old_image_id:
                    # Stop running engine before removing old image (container uses the image)
                    try:
                        manager = _get_engine_manager(engine_type)
                        if manager.is_engine_running(variant_id):
                            logger.info(f"Stopping running engine '{variant_id}' before image cleanup")
                            await manager.stop_by_variant(variant_id)
                    except Exception as e:
                        logger.warning(f"Failed to stop engine before image cleanup: {e}")

                    removed = remove_dangling_image(old_image_id, docker_host_id)
                    if removed:
                        logger.info(f"Cleaned up old image after update: {old_image_id[:19]}")

        except PullCancelledException:
            logger.info(f"Docker image pull cancelled for {variant_id}")
            # If this was a new install (not an update), remove the engine entry
            if not existing_engine:
                engine_repo.delete(variant_id)
                logger.debug(f"Removed engine entry for cancelled install: {variant_id}")
            else:
                engine_repo.set_pulling(variant_id, False)
            await emit_docker_image_cancelled(variant_id)
            raise ApplicationError("DOCKER_PULL_CANCELLED", status_code=499, variantId=variant_id)
        except DockerException as e:
            logger.error(f"Failed to pull Docker image: {e}")
            # If this was a new install (not an update), remove the engine entry
            if not existing_engine:
                engine_repo.delete(variant_id)
                logger.debug(f"Removed engine entry for failed install: {variant_id}")
            else:
                engine_repo.set_pulling(variant_id, False)
            await emit_docker_image_error(variant_id, str(e), operation="install")
            raise ApplicationError("DOCKER_PULL_FAILED", status_code=500, image=f"{image_name}:{image_tag}", error=str(e))

        # Auto-enable first installed engine of this type as default
        # But preserve existing enabled/default state when updating (force=True)
        engine_type = image_info["engine_type"]
        if force and existing_engine:
            # Preserve current state when updating
            preserve_enabled = existing_engine.get("enabled", False)
            preserve_default = existing_engine.get("is_default", False)
            logger.debug(
                "install_docker_image: preserving state on update",
                variant_id=variant_id,
                preserve_enabled=preserve_enabled,
                preserve_default=preserve_default
            )
        else:
            # New installation: auto-enable if first of type
            enabled_engines = engine_repo.get_enabled(engine_type)
            preserve_enabled = len(enabled_engines) == 0
            preserve_default = preserve_enabled
            logger.debug(
                "install_docker_image: auto-enable logic",
                variant_id=variant_id,
                engine_type=engine_type,
                enabled_count=len(enabled_engines),
                will_auto_enable=preserve_enabled
            )

        # Register/update in engines table (Single Source of Truth)
        engine_repo.upsert(
            variant_id=variant_id,
            base_engine_name=variant.engine_name,
            engine_type=engine_type,
            host_id=db_host_id,
            source="catalog",
            is_installed=True,
            is_default=preserve_default,
            enabled=preserve_enabled,
            display_name=image_info.get('display_name', variant.engine_name),
            supported_languages=image_info.get("supported_languages") or [],
            requires_gpu=image_info.get("requires_gpu", False),
            docker_image=image_info["image_name"],
            docker_tag=image_tag,  # Use the actual tag that was installed
            parameters=parameter_defaults if parameter_defaults else None,
            constraints=constraints if constraints else None,
            capabilities=capabilities if capabilities else None,
            config=engine_config,
        )

        # Mark pull as complete
        engine_repo.set_pulling(variant_id, False)

        if preserve_enabled and not (force and existing_engine):
            logger.info(f"Auto-enabled {variant_id} as default {engine_type} engine (first of type)")

        # Register models in engine_models table (SSOT for models)
        model_repo = EngineModelRepository(conn)
        if models:
            for model in models:
                model_name = model.get("name", "default")
                model_repo.add_model(
                    variant_id=variant_id,
                    model_name=model_name,
                    model_info=model,
                    is_default=(model_name == default_model)
                )

        # Emit installed event
        await emit_docker_image_installed(variant_id, image_name, db_host_id)

        logger.info(f"Docker image installed for variant: {variant_id}")
        return DockerInstallResponse(
            success=True,
            variant_id=variant_id,
            message=f"Image {image_name}:{image_tag} installed for {variant_id}",
            is_installed=True
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to install Docker image: {e}", exc_info=True)
        raise ApplicationError("IMAGE_INSTALL_FAILED", status_code=500, variantId=variant_id, error=str(e))


@router.delete("/docker/{variant_id}/pull", response_model=MessageResponse)
async def cancel_docker_pull(
    variant_id: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Cancel an active Docker image pull.

    Args:
        variant_id: Variant identifier (e.g., 'xtts:docker:local')

    Returns:
        MessageResponse indicating cancellation was requested

    Raises:
        404: If no active pull found for variant
    """
    try:
        from services.docker_service import cancel_pull

        # Check if engine exists and is pulling
        engine_repo = EngineRepository(conn)
        existing_engine = engine_repo.get_by_id(variant_id)

        if not existing_engine:
            raise ApplicationError("VARIANT_NOT_FOUND", status_code=404, variantId=variant_id)

        if not existing_engine.get("is_pulling"):
            raise ApplicationError("NO_ACTIVE_PULL", status_code=404, variantId=variant_id)

        # Request cancellation
        cancelled = cancel_pull(variant_id)

        if not cancelled:
            # Pull may have already been unregistered (race condition with pull completing)
            # This is not an error - the cancellation request was processed
            logger.debug(f"Pull already unregistered for {variant_id}, cancellation still effective")

        logger.info(f"Cancellation requested for Docker pull: {variant_id}")

        return MessageResponse(success=True, message=f"Cancellation requested for {variant_id}")

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Error cancelling Docker pull for {variant_id}: {e}", exc_info=True)
        raise ApplicationError("CANCEL_FAILED", status_code=500, variantId=variant_id, error=str(e))


@router.delete("/docker/{variant_id}/uninstall", response_model=DockerInstallResponse)
async def uninstall_docker_image(
    variant_id: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Uninstall (remove) a Docker image for an engine variant.

    Args:
        variant_id: Variant identifier (e.g., 'xtts:docker:local')

    Returns:
        DockerInstallResponse with uninstallation status

    Raises:
        404: If variant not found or not installed
    """
    try:
        # Check engines table (Single Source of Truth)
        engine_repo = EngineRepository(conn)
        existing_engine = engine_repo.get_by_id(variant_id)

        if not existing_engine:
            raise ApplicationError("VARIANT_NOT_FOUND", status_code=404, variantId=variant_id)

        if not existing_engine.get("is_installed"):
            raise ApplicationError("IMAGE_NOT_INSTALLED", status_code=404, variantId=variant_id)

        # Get image info before uninstalling
        docker_image = existing_engine.get("docker_image")
        docker_tag = existing_engine.get("docker_tag", "latest")

        # Stop container if running (before removing image)
        engine_type = existing_engine.get("engine_type", "tts")
        try:
            manager = _get_engine_manager(engine_type)
            was_running = manager.is_engine_running(variant_id)
            logger.debug(
                "uninstall_docker_image: checking engine state",
                variant_id=variant_id,
                engine_type=engine_type,
                was_running=was_running
            )
            if was_running:
                logger.info(f"Stopping running engine {variant_id} before uninstall")
                await manager.stop_engine_server(variant_id)
                logger.debug("uninstall_docker_image: engine stop completed", variant_id=variant_id)
        except Exception as e:
            logger.warning(f"Could not stop engine before uninstall: {e}")

        # Remove the Docker image FIRST (before deleting from DB)
        if docker_image:
            from services.docker_service import remove_image, is_docker_available
            from models.engine_variant_models import parse_variant_id, get_host_id_from_variant
            from docker.errors import DockerException

            # Get host_id for docker_service calls
            try:
                variant = parse_variant_id(variant_id)
                docker_host_id = get_host_id_from_variant(variant)
            except ValueError:
                docker_host_id = None  # Fall back to local

            if is_docker_available(docker_host_id):
                try:
                    logger.info(f"Removing Docker image {docker_image}:{docker_tag} (host: {docker_host_id or 'local'})")
                    remove_image(docker_image, docker_tag, host_id=docker_host_id)
                except DockerException as e:
                    # If container is still using the image, fail the uninstall
                    error_msg = str(e)
                    if "container" in error_msg.lower() and "using" in error_msg.lower():
                        raise ApplicationError("IMAGE_IN_USE", status_code=409, variantId=variant_id, error="Container still using image. Stop the engine first.")
                    # For other errors (image not found, etc.), log and continue
                    logger.warning(f"Could not remove Docker image: {e}")

        # Delete from engines table AFTER image removal succeeded
        engine_repo.delete(variant_id)

        logger.info(f"Docker image uninstalled for variant: {variant_id}")
        return DockerInstallResponse(
            success=True,
            variant_id=variant_id,
            message=f"Image uninstalled for {variant_id}",
            is_installed=False
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to uninstall Docker image: {e}", exc_info=True)
        raise ApplicationError("IMAGE_UNINSTALL_FAILED", status_code=500, variantId=variant_id, error=str(e))


@router.get("/docker/{variant_id}/check-update", response_model=ImageUpdateCheckResponse)
async def check_docker_image_update(
    variant_id: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Check if a Docker image update is available.

    Compares the local image digest with the registry without pulling.
    This is a lightweight operation (~2-5 KB network traffic).

    Args:
        variant_id: Variant identifier (e.g., 'xtts:docker:local')

    Returns:
        ImageUpdateCheckResponse with update availability info

    Raises:
        404: If variant not found or not a Docker variant
    """
    try:
        from services.docker_service import check_image_update, is_docker_available
        from models.response_models import ImageUpdateCheckResponse
        from models.engine_variant_models import parse_variant_id, get_host_id_from_variant

        # Parse variant to get host_id for docker_service calls
        try:
            variant = parse_variant_id(variant_id)
            docker_host_id = get_host_id_from_variant(variant)
        except ValueError:
            docker_host_id = None  # Fall back to local

        # Check Docker availability
        if not is_docker_available(docker_host_id):
            return ImageUpdateCheckResponse(
                success=False,
                variant_id=variant_id,
                is_installed=False,
                update_available=None,
                error=f"Docker not available on host {docker_host_id or 'local'}"
            )

        # Get engine from repository
        engine_repo = EngineRepository(conn)
        engine = engine_repo.get_by_id(variant_id)

        if not engine:
            raise ApplicationError("VARIANT_NOT_FOUND", status_code=404, variantId=variant_id)

        # Check it's a Docker variant
        docker_image = engine.get("docker_image")
        docker_tag = engine.get("docker_tag", "latest")

        if not docker_image:
            raise ApplicationError("NOT_DOCKER_VARIANT", status_code=400, variantId=variant_id)

        # Perform update check
        logger.info(f"Checking for updates: {docker_image}:{docker_tag} (host: {docker_host_id or 'local'})")
        result = check_image_update(docker_image, docker_tag, docker_host_id)

        return ImageUpdateCheckResponse(
            success=True,
            variant_id=variant_id,
            is_installed=result["is_installed"],
            update_available=result["update_available"],
            local_digest=result["local_digest"],
            remote_digest=result["remote_digest"],
            error=result["error"]
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Update check failed for {variant_id}: {e}", exc_info=True)
        return ImageUpdateCheckResponse(
            success=False,
            variant_id=variant_id,
            is_installed=False,
            update_available=None,
            error=str(e)
        )


@router.post("/{engine_type}/{engine_name}/enable", response_model=MessageResponse)
async def enable_engine(
    engine_type: str,
    engine_name: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Enable an engine variant

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')

    Returns:
        Success message
    """
    try:
        # Parse variant_id to get base engine name (for engine manager)
        base_engine_name, _ = parse_variant_id(engine_name)

        settings_service = SettingsService(conn)
        # Use full variant_id for settings (per-variant settings)
        success = settings_service.set_engine_enabled(engine_name, True, engine_type)

        if not success:
            raise ApplicationError("ENGINE_ENABLE_FAILED", status_code=400, engine=engine_name)

        logger.info(f"Variant '{engine_name}' ({engine_type}) enabled via API")

        # Discover models for newly enabled engine
        try:
            manager = _get_engine_manager(engine_type)
            model_repo = EngineModelRepository(conn)
            existing_models = model_repo.get_model_names(engine_name)

            if not existing_models:
                logger.info(f"Discovering models for newly enabled engine {engine_name}...")
                models = await manager.discover_engine_models(engine_name)

                model_entries = []
                for m in models:
                    name = m.get("name") or m.get("engine_model_name") or m.get("model_name")
                    if name:
                        model_entries.append({"name": name, "info": m})

                if model_entries:
                    model_repo.replace_models(engine_name, model_entries, preserve_default=False)
                    model_repo.set_default_model(engine_name, model_entries[0]["name"])
                    logger.info(f"Discovered {len(model_entries)} models for {engine_name}")
        except Exception as e:
            logger.warning(f"Model discovery failed for {engine_name}: {e}")

        # Emit engine enabled event
        await safe_broadcast(
            emit_engine_enabled,
            engine_type,
            base_engine_name,
            variant_id=engine_name,
            event_description="engine.enabled"
        )

        return MessageResponse(
            success=True,
            message=f"Variant '{engine_name}' enabled successfully"
        )

    except ValueError as e:
        # Validation error (e.g., engine not found)
        raise ApplicationError("ENGINE_ENABLE_FAILED", status_code=400, engineType=engine_type, engineName=engine_name, error=str(e))
    except Exception as e:
        logger.error(f"Failed to enable engine {engine_name}: {e}")
        raise ApplicationError("ENGINE_ENABLE_FAILED", status_code=500, engineType=engine_type, engineName=engine_name, error=str(e))


@router.post("/{engine_type}/{engine_name}/disable", response_model=MessageResponse)
async def disable_engine(
    engine_type: str,
    engine_name: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Disable an engine variant

    Validates that default engine cannot be disabled.
    If the engine is running, it will be stopped automatically.

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')

    Returns:
        Success message

    Raises:
        400: If trying to disable default engine
    """
    try:
        # Parse variant_id to get base engine name (for engine manager)
        base_engine_name, _ = parse_variant_id(engine_name)

        settings_service = SettingsService(conn)
        # Use full variant_id for settings (per-variant settings)
        success = settings_service.set_engine_enabled(engine_name, False, engine_type)

        if not success:
            raise ApplicationError("ENGINE_DISABLE_FAILED", status_code=400, engine=engine_name)

        logger.info(f"Variant '{engine_name}' ({engine_type}) disabled via API")

        # Stop the engine if it's running
        try:
            manager = _get_engine_manager(engine_type)
            if manager.is_engine_running(engine_name):
                logger.info(f"Stopping running engine '{engine_name}' after disable")
                await manager.stop_by_variant(engine_name)
        except Exception as e:
            logger.warning(f"Failed to stop engine '{engine_name}' after disable: {e}")

        # Remove models from engine_models table
        try:
            model_repo = EngineModelRepository(conn)
            deleted_count = model_repo.delete_by_variant(engine_name)
            if deleted_count > 0:
                logger.info(f"Removed {deleted_count} models for disabled engine {engine_name}")
        except Exception as e:
            logger.warning(f"Failed to remove models for {engine_name}: {e}")

        # Emit engine disabled event
        await safe_broadcast(
            emit_engine_disabled,
            engine_type,
            base_engine_name,
            variant_id=engine_name,
            event_description="engine.disabled"
        )

        return MessageResponse(
            success=True,
            message=f"Variant '{engine_name}' disabled successfully"
        )

    except ValueError as e:
        # Validation error (e.g., trying to disable default engine)
        raise ApplicationError("ENGINE_DISABLE_FAILED", status_code=400, engineType=engine_type, engineName=engine_name, error=str(e))
    except Exception as e:
        logger.error(f"Failed to disable engine {engine_name}: {e}")
        raise ApplicationError("ENGINE_DISABLE_FAILED", status_code=500, engineType=engine_type, engineName=engine_name, error=str(e))


@router.post("/{engine_type}/{engine_name}/start", response_model=MessageResponse)
async def start_engine(
    engine_type: str,
    engine_name: str,
    request: Optional[EngineStartRequest] = None,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Manually start an engine server

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier or variant ID (e.g., 'xtts' or 'xtts:docker:local')
        request: Optional request body with model_name

    Returns:
        Success message with port number

    Raises:
        400: If engine is disabled or not found
        500: If engine start failed
    """
    try:
        settings_service = SettingsService(conn)

        # Parse variant ID to get base engine name
        # Handles both plain names ('xtts') and variant IDs ('xtts:docker:local')
        base_engine_name, runner_id = parse_variant_id(engine_name)

        # Check if engine is enabled (use full variant ID like 'spacy:local')
        is_enabled = settings_service.is_engine_enabled(engine_name, engine_type)
        if not is_enabled:
            raise ApplicationError("ENGINE_START_DISABLED", status_code=400, engine=engine_name)

        # Get the appropriate engine manager
        try:
            manager = _get_engine_manager(engine_type)
        except ValueError as e:
            raise ApplicationError("ENGINE_INVALID_TYPE", status_code=400, engineType=engine_type, error=str(e))

        # Check if engine exists using DB lookup (Single Source of Truth)
        metadata = manager.get_engine_metadata(engine_name)

        if not metadata:
            raise ApplicationError("ENGINE_NOT_FOUND", status_code=400, engine=engine_name, type=engine_type)

        # Get model name from request or use default
        # Audio engines don't have models, so model_name can be None for them
        model_name = None
        if request and request.model_name:
            model_name = request.model_name
        elif engine_type == 'audio':
            # Audio engines don't require a model - use dummy placeholder
            # The engine's load_model() is a no-op anyway
            model_name = 'default'
        else:
            # Get default model from engine_models table (SSOT)
            if engine_type in ('tts', 'stt'):
                model_repo = EngineModelRepository(conn)
                # get_default_or_first_model returns default if set, else first available
                model_name = model_repo.get_default_or_first_model(engine_name)
            elif engine_type == 'text':
                # Text engines use language codes as model identifiers
                # Get first supported language from engine metadata
                supported_langs = metadata.get("supported_languages", ["en"])
                model_name = supported_langs[0] if supported_langs else "en"

        # Validate that we have a model (except for audio engines which don't need one)
        if not model_name and engine_type != 'audio':
            raise ApplicationError("ENGINE_NO_MODEL_DISCOVERED", status_code=400, engine=engine_name, hint="Run model discovery first")

        # Start the engine using start_by_variant for consistent handling
        logger.info(f"Starting {engine_type} engine '{engine_name}' (base: {base_engine_name}) with model '{model_name}'")
        await manager.start_by_variant(engine_name, {"model_name": model_name} if model_name else None)
        port = manager.engine_ports.get(engine_name)

        return MessageResponse(
            success=True,
            message=f"Engine '{engine_name}' started successfully on port {port}"
        )

    except ApplicationError:
        # Re-raise application exceptions
        raise
    except EngineStartupCancelledError:
        # Engine was stopped during startup - not an error, user intentionally cancelled
        logger.info(f"Engine {engine_name} start cancelled (stopped during startup)")
        return MessageResponse(
            success=True,
            message=f"Engine '{engine_name}' start cancelled"
        )
    except Exception as e:
        logger.error(f"Failed to start engine {engine_name}: {e}", exc_info=True)
        raise ApplicationError("ENGINE_START_FAILED", status_code=500, error=str(e))


@router.post("/{engine_type}/{engine_name}/stop", response_model=MessageResponse)
async def stop_engine(
    engine_type: str,
    engine_name: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Manually stop an engine server

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Engine identifier or variant ID (e.g., 'xtts' or 'xtts:docker:local')

    Returns:
        Success message

    Raises:
        400: If engine not found
        500: If engine stop failed
    """
    try:
        # Parse variant ID to get base engine name
        # Handles both plain names ('xtts') and variant IDs ('xtts:docker:local')
        base_engine_name, runner_id = parse_variant_id(engine_name)

        # Get the appropriate engine manager
        try:
            manager = _get_engine_manager(engine_type)
        except ValueError as e:
            raise ApplicationError("ENGINE_INVALID_TYPE", status_code=400, engineType=engine_type, error=str(e))

        # Check if engine exists using DB lookup (Single Source of Truth)
        metadata = manager.get_engine_metadata(engine_name)

        if not metadata:
            raise ApplicationError("ENGINE_NOT_FOUND", status_code=400, engine=engine_name, type=engine_type)

        # Check if engine is actually running
        if not manager.is_engine_running(engine_name):
            return MessageResponse(
                success=True,
                message=f"Engine '{engine_name}' was already stopped"
            )

        # Stop the engine using stop_by_variant for consistent handling
        logger.info(f"Stopping {engine_type} engine '{engine_name}' (base: {base_engine_name})")
        await manager.stop_by_variant(engine_name)

        return MessageResponse(
            success=True,
            message=f"Engine '{engine_name}' stopped successfully"
        )

    except ApplicationError:
        # Re-raise application exceptions
        raise
    except Exception as e:
        logger.error(f"Failed to stop engine {engine_name}: {e}", exc_info=True)
        raise ApplicationError("ENGINE_STOP_FAILED", status_code=500, error=str(e))


@router.post("/{engine_type}/default/{engine_name}", response_model=MessageResponse)
async def set_default_engine(
    engine_type: str,
    engine_name: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Set the default engine for a given type

    For single-engine types (STT, Audio, Text), this will automatically
    disable and stop any previously running engine of the same type.

    Args:
        engine_type: Type of engine ('tts', 'stt', 'text')
        engine_name: Engine identifier or variant_id (e.g., 'xtts' or 'xtts:local')

    Returns:
        Success message

    Raises:
        400: If engine is disabled or not found
    """
    try:
        # For single-engine types, find currently running engine before switch
        engines_to_stop = []
        if engine_type in ('stt', 'audio', 'text'):
            try:
                manager = _get_engine_manager(engine_type)
                engine_repo = EngineRepository(conn)
                enabled_engines = engine_repo.get_enabled(engine_type)

                for eng in enabled_engines:
                    if eng['variant_id'] != engine_name:
                        if manager.is_engine_running(eng['variant_id']):
                            engines_to_stop.append(eng['variant_id'])
                            logger.debug(
                                "set_default_engine: detected running engine to stop",
                                engine_type=engine_type,
                                new_default=engine_name,
                                running_variant=eng['variant_id']
                            )
            except Exception as e:
                logger.warning(f"Failed to check running engines before default switch: {e}")

        # Store the full variantId (e.g., 'xtts:local' or 'xtts:docker:local')
        settings_service = SettingsService(conn)
        settings_service.set_default_engine(engine_type, engine_name)

        # Stop previously running engines (single-engine mode cleanup)
        for variant_id in engines_to_stop:
            try:
                logger.info(f"Stopping previously running engine '{variant_id}' after default switch")
                manager = _get_engine_manager(engine_type)
                await manager.stop_by_variant(variant_id)
            except Exception as e:
                logger.warning(f"Failed to stop engine '{variant_id}' after default switch: {e}")

        logger.info(f"Default {engine_type} engine set to '{engine_name}'")

        return MessageResponse(
            success=True,
            message=f"Default {engine_type} engine set to '{engine_name}'"
        )

    except ValueError as e:
        raise ApplicationError("ENGINE_SET_DEFAULT_FAILED", status_code=400, engineType=engine_type, engineName=engine_name, error=str(e))
    except Exception as e:
        logger.error(f"Failed to set default engine: {e}", exc_info=True)
        raise ApplicationError("ENGINE_SET_DEFAULT_FAILED", status_code=500, engineType=engine_type, engineName=engine_name, error=str(e))


@router.delete("/{engine_type}/default", response_model=MessageResponse)
async def clear_default_engine(
    engine_type: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Clear the default engine for a given type (set to none)

    Note: TTS must always have a default engine, so this will fail for TTS.
    All running engines of this type will be stopped.

    Args:
        engine_type: Type of engine ('stt', 'text', 'audio')

    Returns:
        Success message

    Raises:
        400: If trying to clear TTS default (not allowed)
    """
    try:
        # Find all running engines of this type before clearing
        engines_to_stop = []
        try:
            manager = _get_engine_manager(engine_type)
            engine_repo = EngineRepository(conn)
            enabled_engines = engine_repo.get_enabled(engine_type)

            for eng in enabled_engines:
                if manager.is_engine_running(eng['variant_id']):
                    engines_to_stop.append(eng['variant_id'])
        except Exception as e:
            logger.warning(f"Failed to check running engines before clearing default: {e}")

        settings_service = SettingsService(conn)
        settings_service.set_default_engine(engine_type, "")

        # Stop all previously running engines
        for variant_id in engines_to_stop:
            try:
                logger.info(f"Stopping engine '{variant_id}' after clearing default")
                manager = _get_engine_manager(engine_type)
                await manager.stop_by_variant(variant_id)
            except Exception as e:
                logger.warning(f"Failed to stop engine '{variant_id}' after clearing default: {e}")

        return MessageResponse(
            success=True,
            message=f"Default {engine_type} engine cleared"
        )

    except ValueError as e:
        raise ApplicationError("ENGINE_CLEAR_DEFAULT_FAILED", status_code=400, engineType=engine_type, error=str(e))
    except Exception as e:
        logger.error(f"Failed to clear default engine: {e}", exc_info=True)
        raise ApplicationError("ENGINE_CLEAR_DEFAULT_FAILED", status_code=500, engineType=engine_type, error=str(e))


class KeepRunningRequest(CamelCaseModel):
    """Request to set keep-running flag for an engine"""
    keep_running: bool


@router.post("/{engine_type}/{engine_name}/keep-running", response_model=MessageResponse)
async def set_engine_keep_running(
    engine_type: str,
    engine_name: str,
    request: KeepRunningRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Set keep-running flag for an engine variant

    Engines with keepRunning=true will not be auto-stopped after inactivity.

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Variant ID (e.g., 'xtts:local', 'xtts:docker:local')
        request: Request body with keepRunning boolean

    Returns:
        Success message

    Raises:
        400: If engine type is invalid or engine not found
        500: If operation failed
    """
    try:
        # Parse variant_id to get base engine name (for engine manager)
        base_engine_name, _ = parse_variant_id(engine_name)

        # Validate engine type
        valid_types = ['tts', 'text', 'stt', 'audio']
        if engine_type not in valid_types:
            raise ApplicationError("ENGINE_INVALID_TYPE", status_code=400, type=engine_type, valid=", ".join(valid_types))

        # Get the appropriate engine manager to verify engine exists
        try:
            manager = _get_engine_manager(engine_type)
        except ValueError as e:
            raise ApplicationError("ENGINE_INVALID_TYPE", status_code=400, engineType=engine_type, error=str(e))

        # Check if engine exists using DB lookup (Single Source of Truth)
        metadata = manager.get_engine_metadata(engine_name)

        if not metadata:
            raise ApplicationError("ENGINE_NOT_FOUND", status_code=400, engine=engine_name, type=engine_type)

        # Update keep_running flag in settings
        settings_service = SettingsService(conn)
        settings_service.set_engine_keep_running(engine_name, request.keep_running, engine_type)

        action = "enabled" if request.keep_running else "disabled"
        logger.info(f"Keep-running {action} for variant '{engine_name}' ({engine_type})")

        return MessageResponse(
            success=True,
            message=f"Keep-running {action} for variant '{engine_name}'"
        )

    except ApplicationError:
        # Re-raise application exceptions
        raise
    except Exception as e:
        logger.error(f"Failed to set keep-running for engine {engine_name}: {e}", exc_info=True)
        raise ApplicationError("ENGINE_KEEP_RUNNING_FAILED", status_code=500, engineType=engine_type, engineName=engine_name, error=str(e))


class EngineSettingsRequest(CamelCaseModel):
    """Request model for updating engine settings (model, language, parameters)."""
    default_model_name: Optional[str] = None  # Stored in engine_models.is_default
    default_language: Optional[str] = None    # Stored in engines.default_language
    parameters: Optional[Dict[str, Any]] = None  # Stored in engines.parameters


@router.put("/{engine_type}/{engine_name}/settings", response_model=MessageResponse)
async def update_engine_settings(
    engine_type: str,
    engine_name: str,
    request: EngineSettingsRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Update settings for an engine variant (model, language, parameters)

    Updates are applied directly to the engines table (Single Source of Truth).
    Only provided fields are updated; omitted fields remain unchanged.

    Args:
        engine_type: Type of engine ('tts', 'text', 'stt', 'audio')
        engine_name: Variant ID (e.g., 'xtts:local')
        request: Settings to update

    Returns:
        Success message

    Raises:
        400: If engine type is invalid or engine not found
        500: If operation failed
    """
    try:
        from db.engine_repository import EngineRepository

        # Parse variant_id to get base engine name
        base_engine_name, _ = parse_variant_id(engine_name)

        # Validate engine type
        valid_types = ['tts', 'text', 'stt', 'audio']
        if engine_type not in valid_types:
            raise ApplicationError("ENGINE_INVALID_TYPE", status_code=400, type=engine_type, valid=", ".join(valid_types))

        # Check if engine exists in DB
        engine_repo = EngineRepository(conn)
        engine = engine_repo.get_by_id(engine_name)
        if not engine:
            raise ApplicationError("ENGINE_NOT_FOUND", status_code=400, engine=engine_name, type=engine_type)

        # Update default model in engine_models table (SSOT for models)
        updated_fields = []
        if request.default_model_name is not None:
            model_repo = EngineModelRepository(conn)
            if model_repo.set_default_model(engine_name, request.default_model_name):
                updated_fields.append(f"model={request.default_model_name}")
            else:
                raise ApplicationError("MODEL_NOT_FOUND", status_code=400, engine=engine_name, model=request.default_model_name)

        # Update other settings in engines table
        engine_repo.update_settings(
            variant_id=engine_name,
            default_language=request.default_language,
            parameters=request.parameters
        )
        if request.default_language is not None:
            updated_fields.append(f"language={request.default_language}")
        if request.parameters is not None:
            updated_fields.append("parameters updated")

        logger.info(f"Updated settings for '{engine_name}': {', '.join(updated_fields)}")

        return MessageResponse(
            success=True,
            message=f"Updated settings for '{engine_name}': {', '.join(updated_fields) or 'no changes'}"
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to update settings for engine {engine_name}: {e}", exc_info=True)
        raise ApplicationError("ENGINE_SETTINGS_UPDATE_FAILED", status_code=500, engineType=engine_type, engineName=engine_name, error=str(e))


# ============================================================================
# Request Models
# ============================================================================

class DockerDiscoverRequest(CamelCaseModel):
    """Request to discover a custom Docker engine"""
    docker_image: str  # e.g. "my-tts" or "ghcr.io/user/my-tts"
    docker_tag: str = "latest"


class DockerRegisterRequest(CamelCaseModel):
    """Request to register a custom Docker engine"""
    docker_image: str
    docker_tag: str
    # Confirmed/edited fields from user:
    display_name: str
    engine_type: str  # "tts", "stt", "text", "audio"
    # Discovery info (passed from frontend to avoid re-discovery)
    supported_languages: Optional[List[str]] = None
    requires_gpu: Optional[bool] = False
    models: Optional[List[Dict[str, Any]]] = None  # Full model objects with metadata
    parameters: Optional[Dict[str, Any]] = None  # Full parameter schema with type/min/max/default
    constraints: Optional[Dict[str, Any]] = None
    capabilities: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None
    default_language: Optional[str] = None


@router.post("/docker/discover", response_model=DockerDiscoverResponse)
async def discover_docker_engine(
    request: DockerDiscoverRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Discover a custom Docker engine by probing its /info endpoint.

    This endpoint attempts to pull and start a Docker container,
    then queries its /info endpoint to retrieve engine metadata.

    Args:
        request: Docker image details (image name and tag)

    Returns:
        DockerDiscoverResponse with engine metadata or error

    Raises:
        500: If discovery failed (Docker unavailable, image pull failed, etc.)
    """
    try:
        from services.docker_discovery_service import DockerDiscoveryService
        from services.docker_service import is_docker_available

        # Check Docker availability
        if not is_docker_available():
            raise ApplicationError("DOCKER_NOT_AVAILABLE", status_code=503, message="Docker daemon is not running")

        # Initialize discovery service
        discovery_service = DockerDiscoveryService()

        # Discover engine from image
        logger.debug(
            f"[engines] discover_docker_engine START "
            f"image={request.docker_image}:{request.docker_tag}"
        )
        logger.info(f"Discovering Docker engine from {request.docker_image}:{request.docker_tag}")
        result = await discovery_service.discover_engine(
            docker_image=request.docker_image,
            docker_tag=request.docker_tag
        )

        if not result.success:
            return DockerDiscoverResponse(
                success=False,
                engine_info=None,
                error=result.error
            )

        # Keep engine_info in snake_case (matches engine.yaml format)
        # Frontend will use these values directly for DB storage
        engine_info_dict = result.engine_info.model_dump() if result.engine_info else None

        # Note: requires_gpu is already correctly set by docker_discovery_service
        # which matches the docker_tag to the correct variant.
        # No fallback needed - discovery service handles this.
        logger.debug(
            f"[engines] discover_docker_engine DONE name={result.engine_info.name if result.engine_info else 'unknown'} "
            f"type={result.engine_info.type if result.engine_info else 'unknown'} "
            f"requires_gpu={result.engine_info.requires_gpu if result.engine_info else 'unknown'}"
        )
        logger.info(f"Successfully discovered engine: {result.engine_info.name if result.engine_info else 'unknown'}")
        return DockerDiscoverResponse(
            success=True,
            engine_info=engine_info_dict,
            error=None
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to discover Docker engine: {e}", exc_info=True)
        return DockerDiscoverResponse(
            success=False,
            engine_info=None,
            error=str(e)
        )


@router.post("/docker/register", response_model=DockerRegisterResponse)
async def register_docker_engine(
    request: DockerRegisterRequest,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Register a custom Docker engine in the engines table.

    After discovering an engine via /docker/discover, the user can confirm
    or edit the metadata and register it permanently. The engine will be
    marked with source='custom' to prevent overwriting by catalog updates.

    Args:
        request: Registration details (image, tag, display name, engine type)

    Returns:
        DockerRegisterResponse with variant_id or error

    Raises:
        400: If engine with same variant_id already exists
        500: If registration failed
    """
    try:

        # Extract base engine name from docker image
        # e.g. "ghcr.io/user/my-tts" -> "my-tts"
        # e.g. "my-tts" -> "my-tts"
        image_parts = request.docker_image.split("/")
        base_engine_name = image_parts[-1].split(":")[0]  # Remove tag if present

        # Build variant_id: {name}:docker:local
        variant_id = f"{base_engine_name}:docker:local"
        host_id = "docker:local"

        # Check if engine with this variant_id already exists
        engine_repo = EngineRepository(conn)
        existing_engine = engine_repo.get_by_id(variant_id)
        if existing_engine:
            raise ApplicationError("ENGINE_ALREADY_EXISTS", status_code=400, variantId=variant_id)

        # Ensure Docker host exists in engine_hosts table
        host_repo = EngineHostRepository(conn)
        if not host_repo.get_by_id(host_id):
            host_repo.ensure_docker_local_exists()

        # Use discovery info from request (already discovered via /docker/discover)
        supported_languages = request.supported_languages or []
        requires_gpu = request.requires_gpu or False
        models = request.models or []  # Full model objects with metadata
        model_names = [m.get("name", "default") for m in models] if models else []
        parameter_schema = request.parameters or {}
        parameter_defaults = _extract_parameter_defaults(parameter_schema)
        constraints = request.constraints or {}
        capabilities = request.capabilities or {}
        config = request.config or {}

        # Determine default_language: prefer one that's in both supported_languages AND allowedLanguages
        default_language = request.default_language
        if not default_language and supported_languages:
            from services.settings_service import SettingsService
            settings_service = SettingsService(conn)
            languages_settings = settings_service.get_setting("languages") or {}
            allowed_languages = languages_settings.get("allowedLanguages", ["de", "en"])

            # Find first supported language that's also allowed
            for lang in supported_languages:
                if lang in allowed_languages:
                    default_language = lang
                    break

            # Fallback to first supported language if no overlap
            if not default_language:
                default_language = supported_languages[0]

        # Auto-enable first installed engine of this type as default
        enabled_engines = engine_repo.get_enabled(request.engine_type)
        auto_set_default = len(enabled_engines) == 0

        # Register in engines table with source='custom'
        # is_installed=True because discovery succeeded (image is already pulled)
        logger.info(f"Registering custom Docker engine {variant_id}")
        engine_repo.upsert(
            variant_id=variant_id,
            base_engine_name=base_engine_name,
            engine_type=request.engine_type,
            host_id=host_id,
            source="custom",
            is_installed=True,  # Image is already pulled (discovery succeeded)
            display_name=request.display_name,
            supported_languages=supported_languages,
            requires_gpu=requires_gpu,
            docker_image=request.docker_image,
            docker_tag=request.docker_tag,
            parameters=parameter_defaults if parameter_defaults else None,
            constraints=constraints if constraints else None,
            capabilities=capabilities if capabilities else None,
            config=config if config else None,
            default_language=default_language,
            enabled=True,  # Auto-enable on registration
            is_default=auto_set_default,
        )

        if auto_set_default:
            logger.info(f"Auto-set {variant_id} as default {request.engine_type} engine (first of type)")

        # Register models in engine_models table (SSOT for models)
        if models:
            model_repo = EngineModelRepository(conn)
            default_model_name = model_names[0] if model_names else None
            for model in models:
                model_name = model.get("name", "default")
                model_repo.add_model(
                    variant_id=variant_id,
                    model_name=model_name,
                    model_info=model,
                    is_default=(model_name == default_model_name)
                )
            logger.info(f"Registered {len(models)} models for {variant_id}")

        # Also add to docker_image_catalog with source='custom'
        catalog_repo = DockerImageCatalogRepository(conn)
        existing_catalog = catalog_repo.get_by_engine_name(base_engine_name)

        # Use models for catalog
        default_model = model_names[0] if model_names else ""

        if existing_catalog:
            # Update existing entry (only if it's custom, otherwise skip)
            if existing_catalog.get("source") != "custom":
                logger.warning(f"Catalog entry {base_engine_name} exists with source={existing_catalog.get('source')}, updating to custom")
            # Use repository method for update
            catalog_repo.update_entry(
                base_engine_name=base_engine_name,
                image_name=request.docker_image,
                engine_type=request.engine_type,
                display_name=request.display_name,
                requires_gpu=requires_gpu,
                tags=[request.docker_tag],
                default_tag=request.docker_tag,
                supported_languages=supported_languages,
                constraints=constraints,
                capabilities=capabilities,
                parameters=parameter_schema,
                models=models,
                default_model=default_model,
                source="custom",
            )
        else:
            # Create new catalog entry
            catalog_repo.add_entry(
                base_engine_name=base_engine_name,
                image_name=request.docker_image,
                engine_type=request.engine_type,
                display_name=request.display_name,
                requires_gpu=requires_gpu,
                tags=[request.docker_tag],
                default_tag=request.docker_tag,
                supported_languages=supported_languages,
                constraints=constraints,
                capabilities=capabilities,
                parameters=parameter_schema,
                models=models,
                default_model=default_model,
                source="custom"  # Mark as custom to prevent catalog overwrites
            )

        logger.info(f"Successfully registered custom Docker engine: {variant_id}")
        return DockerRegisterResponse(
            success=True,
            variant_id=variant_id,
            error=None
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Failed to register Docker engine: {e}", exc_info=True)
        return DockerRegisterResponse(
            success=False,
            variant_id=None,
            error=str(e)
        )


@router.post("/{variant_id}/discover-models", response_model=DiscoverModelsResponse)
async def discover_models(
    variant_id: str,
    conn: sqlite3.Connection = Depends(get_db)
):
    """
    Manually trigger model discovery for an engine variant.

    Starts the engine if not running, queries /models endpoint,
    stores results in engine_models table, and optionally stops the engine.

    Args:
        variant_id: Variant identifier (e.g., 'xtts:local', 'xtts:docker:local')

    Returns:
        DiscoverModelsResponse with discovered models

    Raises:
        400: If variant_id format is invalid
        404: If engine not found
        500: If discovery failed
    """
    from db.engine_repository import EngineRepository
    from db.engine_model_repository import EngineModelRepository

    try:
        # Parse variant_id to get engine type and base name
        base_engine_name, runner_id = parse_variant_id(variant_id)

        # Get engine from repository
        engine_repo = EngineRepository(conn)
        engine = engine_repo.get_by_id(variant_id)

        if not engine:
            raise ApplicationError("ENGINE_NOT_FOUND", status_code=404, variantId=variant_id)

        engine_type = engine.get("engine_type")
        if not engine_type:
            raise ApplicationError("ENGINE_TYPE_UNKNOWN", status_code=400, variantId=variant_id)

        # Get the appropriate engine manager
        try:
            manager = _get_engine_manager(engine_type)
        except ValueError as e:
            raise ApplicationError("ENGINE_INVALID_TYPE", status_code=400, engineType=engine_type, error=str(e))

        # Check if engine exists using DB lookup (Single Source of Truth)
        metadata = manager.get_engine_metadata(variant_id)
        if not metadata:
            raise ApplicationError("ENGINE_NOT_REGISTERED", status_code=404, variantId=variant_id)

        # Run discovery
        logger.debug(
            "discover_models: starting discovery",
            variant_id=variant_id,
            engine_type=engine_type,
            is_running=manager.is_engine_running(variant_id)
        )
        logger.info(f"Starting model discovery for {variant_id}")
        discovered = await manager.discover_engine_models(variant_id)

        # Store discovered models in database (include full model_info)
        model_repo = EngineModelRepository(conn)
        model_entries = [
            {"name": m.get("name", m.get("engine_model_name", "unknown")), "info": m}
            for m in discovered
        ]
        model_repo.replace_models(variant_id, model_entries)

        model_names = [m.get("name", m.get("engine_model_name", "unknown")) for m in discovered]

        logger.info(f"Model discovery complete for {variant_id}: {len(model_names)} models found")

        return DiscoverModelsResponse(
            success=True,
            variant_id=variant_id,
            models=model_names,
            message=f"Discovered {len(model_names)} models for {variant_id}"
        )

    except ApplicationError:
        raise
    except Exception as e:
        logger.error(f"Model discovery failed for {variant_id}: {e}", exc_info=True)
        raise ApplicationError("MODEL_DISCOVERY_FAILED", status_code=500, variantId=variant_id, error=str(e))


