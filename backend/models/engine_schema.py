"""
Pydantic schema for engine.yaml validation.

This module provides validation for engine configuration files used by
TTS, STT, text processing, and audio analysis engines.
"""

from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Union

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator


class UpstreamInfo(BaseModel):
    """Upstream project information for Docker catalog distribution."""

    name: str = Field(..., description="Original project name")
    url: str = Field(..., description="Project URL")
    license: str = Field(..., description="License identifier (e.g., MIT, Apache-2.0)")


class VariantDefinition(BaseModel):
    """Docker image variant definition."""

    tag: str = Field(..., description="Docker image tag")
    platforms: List[str] = Field(..., description="Supported platforms (e.g., linux/amd64)")
    requires_gpu: bool = Field(default=False, description="Whether GPU is required")


class ModelDefinition(BaseModel):
    """Model definition with extensible metadata.

    Engine-specific fields like size_mb, vram_gb, huggingface_id are allowed
    via extra='allow'.
    """

    model_config = {"extra": "allow"}

    name: str = Field(..., description="Unique model identifier (snake_case)")
    display_name: str = Field(..., description="Human-readable model name")


class ParameterDefinition(BaseModel):
    """UI parameter definition for engine configuration."""

    type: Literal["float", "int", "bool", "string"] = Field(..., description="Parameter data type")
    label: str = Field(..., description="i18n key for parameter label")
    description: Optional[str] = Field(None, description="i18n key for parameter description")
    default: Union[float, int, bool, str] = Field(..., description="Default value")
    min: Optional[Union[float, int]] = Field(None, description="Minimum value (numeric types only)")
    max: Optional[Union[float, int]] = Field(None, description="Maximum value (numeric types only)")
    step: Optional[Union[float, int]] = Field(None, description="Step increment (numeric types only)")
    readonly: bool = Field(default=False, description="Whether parameter is read-only")
    category: Optional[str] = Field(None, description="Parameter grouping category")

    @field_validator("default")
    @classmethod
    def validate_default_type(cls, v: Any, info) -> Any:
        """Validate that default value matches declared type."""
        param_type = info.data.get("type")

        if param_type == "float" and not isinstance(v, (float, int)):
            raise ValueError(f"default must be numeric for type 'float', got {type(v).__name__}")
        if param_type == "int" and not isinstance(v, int):
            raise ValueError(f"default must be int for type 'int', got {type(v).__name__}")
        if param_type == "bool" and not isinstance(v, bool):
            raise ValueError(f"default must be bool for type 'bool', got {type(v).__name__}")
        if param_type == "string" and not isinstance(v, str):
            raise ValueError(f"default must be str for type 'string', got {type(v).__name__}")

        return v


class InstallationInfo(BaseModel):
    """Local subprocess installation configuration."""

    python_version: str = Field(..., description="Required Python version")
    venv_path: str = Field(..., description="Path to virtual environment")
    requires_gpu: bool = Field(default=False, description="Whether GPU is required for this engine")


class EngineYamlSchema(BaseModel):
    """Complete engine.yaml validation schema.

    Validates the structure and constraints of engine configuration files
    used by the audiobook-maker engine system.
    """

    schema_version: int = Field(..., description="Schema version (currently 2)")

    # IDENTITY (Required)
    name: str = Field(..., description="Engine identifier (snake_case, lowercase, hyphens allowed)")
    display_name: str = Field(..., description="Human-readable engine name")
    engine_type: Literal["tts", "stt", "text", "audio"] = Field(..., description="Engine type")
    description: Optional[str] = Field(None, description="Engine description")

    # DISTRIBUTION (Optional - for Docker catalog)
    upstream: Optional[UpstreamInfo] = Field(None, description="Upstream project information")
    variants: Optional[List[VariantDefinition]] = Field(None, description="Docker image variants")

    # MODELS (optional for text/audio engines that don't have traditional models)
    models: List[ModelDefinition] = Field(default_factory=list, description="Available models")
    default_model: Optional[str] = Field(None, description="Default model ID (must exist in models)")
    auto_discover_models: bool = Field(default=False, description="Enable filesystem model discovery")

    # LANGUAGES
    supported_languages: List[str] = Field(default_factory=list, description="Supported language codes (e.g., en, de)")

    # CONSTRAINTS (extensible dict)
    constraints: Dict[str, Any] = Field(default_factory=dict, description="Engine constraints")

    # CAPABILITIES (extensible dict)
    capabilities: Dict[str, Any] = Field(default_factory=dict, description="Engine capabilities")

    # UI PARAMETERS
    parameters: Dict[str, ParameterDefinition] = Field(
        default_factory=dict,
        description="UI-exposed engine parameters"
    )

    # ENGINE-SPECIFIC (free-form for server internals)
    engine_config: Dict[str, Any] = Field(
        default_factory=dict,
        description="Engine-specific configuration"
    )

    # LOCAL INSTALLATION (Optional - for subprocess)
    installation: Optional[InstallationInfo] = Field(None, description="Subprocess installation info")

    # GPU REQUIREMENT (Top-level, populated by engine server's /info endpoint)
    # Note: Also available in variants[].requires_gpu and installation.requires_gpu
    requires_gpu: bool = Field(default=False, description="Whether GPU is required")

    @field_validator("name")
    @classmethod
    def validate_name_format(cls, v: str) -> str:
        """Validate that name matches pattern ^[a-z0-9-]+$."""
        import re
        if not re.match(r"^[a-z0-9-]+$", v):
            raise ValueError(
                f"name must contain only lowercase letters, numbers, and hyphens, got: {v}"
            )
        return v

    @model_validator(mode="after")
    def validate_default_model_exists(self) -> "EngineYamlSchema":
        """Validate that default_model exists in models list if both are provided."""
        if self.default_model is not None and self.models:
            model_names = {model.name for model in self.models}
            if self.default_model not in model_names:
                raise ValueError(
                    f"default_model '{self.default_model}' not found in models list. "
                    f"Available models: {sorted(model_names)}"
                )
        return self


def validate_yaml_file(path: Path) -> EngineYamlSchema:
    """
    Validate an engine.yaml file.

    Args:
        path: Path to the engine.yaml file

    Returns:
        Validated EngineYamlSchema instance

    Raises:
        FileNotFoundError: If file does not exist
        yaml.YAMLError: If YAML syntax is invalid
        pydantic.ValidationError: If schema validation fails
    """
    if not path.exists():
        raise FileNotFoundError(f"Engine YAML file not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    return EngineYamlSchema(**data)


def validate_yaml_dict(data: dict) -> EngineYamlSchema:
    """
    Validate engine configuration from a dictionary.

    Args:
        data: Engine configuration dictionary (typically from yaml.safe_load)

    Returns:
        Validated EngineYamlSchema instance

    Raises:
        pydantic.ValidationError: If schema validation fails
    """
    return EngineYamlSchema(**data)
