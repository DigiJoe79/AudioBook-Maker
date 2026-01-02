"""
Online Catalog Service - Fetch and sync engine catalog from GitHub

Fetches catalog.yaml from audiobook-maker-engines releases and merges
with local database. Online entries override builtin/online, custom stays.
"""

import httpx
import json
import yaml
from typing import Any, Dict, Tuple
from datetime import datetime
from loguru import logger

# GitHub Release URL for catalog.yaml
CATALOG_URL = "https://github.com/DigiJoe79/audiobook-maker-engines/releases/latest/download/catalog.yaml"


async def fetch_online_catalog(url: str = CATALOG_URL, timeout: float = 30.0) -> Dict[str, Any]:
    """
    Fetch catalog.yaml from GitHub Release.

    Args:
        url: URL to catalog.yaml
        timeout: Request timeout in seconds

    Returns:
        Parsed catalog data

    Raises:
        httpx.HTTPError: On network errors
        yaml.YAMLError: On invalid YAML
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        response = await client.get(url)
        response.raise_for_status()
        return yaml.safe_load(response.text)


def transform_catalog_entry(engine: Dict[str, Any], registry: str) -> Dict[str, Any]:
    """
    Transform online catalog entry to DB format.

    Catalog.yaml uses snake_case throughout, so minimal transformation needed.

    Args:
        engine: Engine entry from catalog.yaml
        registry: Base registry URL (e.g., "ghcr.io/digijoe79/audiobook-maker-engines")

    Returns:
        Entry in DB format
    """
    # Build image name from registry and engine name
    image_name = f"{registry}/{engine['name']}"

    # Get first variant's GPU requirement
    variants = engine.get("variants", [])
    requires_gpu = any(v.get("requires_gpu", False) for v in variants)

    # Get tags from variants
    tags = [v.get("tag", "latest") for v in variants]

    # Get default tag (first variant or "latest")
    default_tag = tags[0] if tags else "latest"

    # Get models and parameters
    models = engine.get("models", [])
    parameters = engine.get("parameters", {})

    return {
        "base_engine_name": engine["name"],
        "image_name": image_name,
        "engine_type": engine["engine_type"],
        "display_name": engine.get("display_name", engine["name"]),
        "description": engine.get("description", ""),
        "requires_gpu": requires_gpu,
        "default_tag": default_tag,
        "tags": tags,
        "supported_languages": engine.get("supported_languages", []),
        "constraints": engine.get("constraints", {}),
        "capabilities": engine.get("capabilities", {}),
        "parameters": parameters,
        "models": models,
        "default_model": engine.get("default_model", ""),
        "source": "online",
        "repo_url": engine.get("upstream", {}).get("url", ""),
    }


def sync_catalog_to_db(
    conn,
    online_catalog: Dict[str, Any],
) -> Tuple[int, int, int]:
    """
    Sync online catalog to database.

    Merge strategy:
    - source='builtin' or 'online': Replace with online data
    - source='custom': Keep unchanged

    Also creates entries in engines table (with is_installed=false) so they
    appear in the UI for installation.

    Args:
        conn: SQLite connection
        online_catalog: Parsed catalog.yaml data

    Returns:
        Tuple of (added, updated, skipped) counts
    """
    from db.docker_image_catalog_repository import DockerImageCatalogRepository
    from db.engine_host_repository import EngineHostRepository

    catalog_repo = DockerImageCatalogRepository(conn)
    host_repo = EngineHostRepository(conn)
    registry = online_catalog.get("registry", "ghcr.io/digijoe79/audiobook-maker-engines")
    catalog_version = online_catalog.get("catalog_version", "")

    # Ensure docker:local host exists
    host_repo.ensure_docker_local_exists()

    added = 0
    updated = 0
    skipped = 0

    for engine in online_catalog.get("engines", []):
        entry = transform_catalog_entry(engine, registry)
        entry["catalog_version"] = catalog_version
        engine_name = entry["base_engine_name"]

        # Check if exists in catalog
        existing = catalog_repo.get_by_engine_name(engine_name)

        if existing:
            # Check source
            if existing.get("source") == "custom":
                logger.debug(f"Skipping custom engine: {engine_name}")
                skipped += 1
                continue

            # Update existing (builtin or online)
            _update_catalog_entry(conn, entry)
            logger.info(f"Updated catalog entry: {engine_name}")
            updated += 1
        else:
            # Add new to catalog
            catalog_repo.add_entry(
                base_engine_name=entry["base_engine_name"],
                image_name=entry["image_name"],
                engine_type=entry["engine_type"],
                display_name=entry["display_name"],
                requires_gpu=entry["requires_gpu"],
                default_tag=entry["default_tag"],
                tags=entry["tags"],
                supported_languages=entry["supported_languages"],
                source="online",
                repo_url=entry["repo_url"],
                description=entry["description"],
                constraints=entry["constraints"],
                capabilities=entry["capabilities"],
                parameters=entry["parameters"],
                models=entry["models"],
                default_model=entry["default_model"],
                catalog_version=entry["catalog_version"],
            )
            logger.info(f"Added catalog entry: {engine_name}")
            added += 1

    return added, updated, skipped


def _update_catalog_entry(conn, entry: Dict[str, Any]) -> None:
    """Update existing catalog entry with online data."""
    now = datetime.now().isoformat()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE docker_image_catalog SET
            image_name = ?,
            engine_type = ?,
            display_name = ?,
            description = ?,
            requires_gpu = ?,
            default_tag = ?,
            tags = ?,
            supported_languages = ?,
            constraints = ?,
            capabilities = ?,
            parameters = ?,
            models = ?,
            default_model = ?,
            catalog_version = ?,
            source = ?,
            repo_url = ?,
            updated_at = ?
        WHERE base_engine_name = ?
    """, (
        entry["image_name"],
        entry["engine_type"],
        entry["display_name"],
        entry["description"],
        entry["requires_gpu"],
        entry["default_tag"],
        json.dumps(entry["tags"]),
        json.dumps(entry["supported_languages"]),
        json.dumps(entry["constraints"]),
        json.dumps(entry["capabilities"]),
        json.dumps(entry["parameters"]),
        json.dumps(entry["models"]),
        entry["default_model"],
        entry["catalog_version"],
        "online",
        entry["repo_url"],
        now,
        entry["base_engine_name"],
    ))
    conn.commit()


def sync_installed_engines_from_catalog(conn) -> int:
    """
    Update installed catalog engines with latest metadata.

    Only updates system metadata, preserves user settings.

    Args:
        conn: SQLite connection

    Returns:
        Number of engines updated
    """
    from db.engine_repository import EngineRepository
    from db.docker_image_catalog_repository import DockerImageCatalogRepository

    engine_repo = EngineRepository(conn)
    catalog_repo = DockerImageCatalogRepository(conn)

    updated = 0

    # Get all engines installed from catalog
    engines = engine_repo.get_by_source("catalog")

    for engine in engines:
        template = catalog_repo.get_by_engine_name(engine["base_engine_name"])

        if not template:
            logger.debug(f"Engine {engine['base_engine_name']} not in catalog, skipping sync")
            continue  # Engine removed from catalog, keep local copy

        # Update system metadata only (preserves user settings)
        engine_repo.update_catalog_metadata(
            variant_id=engine["variant_id"],
            display_name=template.get("display_name", engine["display_name"]),
            supported_languages=template.get("supported_languages", []),
            constraints=template.get("constraints", {}),
            capabilities=template.get("capabilities", {}),
        )
        logger.debug(f"Updated catalog metadata for {engine['variant_id']}")
        updated += 1

    if updated > 0:
        logger.info(f"Synced {updated} installed catalog engines with latest metadata")

    return updated
