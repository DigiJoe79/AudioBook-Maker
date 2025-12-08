"""
XTTS Model Downloader for Coqui TTS

This module handles automatic downloading of the XTTS-v2 model files
from HuggingFace if they are not already present locally.
"""

import sys
from pathlib import Path
from typing import Dict

import requests
from loguru import logger


class ModelDownloader:
    """Handles downloading of XTTS model files from HuggingFace."""

    MODEL_VERSION = "v2.0.2"
    HUGGINGFACE_BASE_URL = f"https://huggingface.co/coqui/XTTS-v2/resolve/{MODEL_VERSION}"
    CHUNK_SIZE = 8192  # 8 KB chunks for optimal download speed

    def __init__(self, base_dir: Path = None):
        """
        Initialize the model downloader.

        Args:
            base_dir: Base directory for model storage. Defaults to script directory.
        """
        self.base_dir = base_dir or Path(__file__).parent.resolve()
        # New structure: engines/xtts/models/v2.0.2/
        self.model_path = self.base_dir / 'models' / self.MODEL_VERSION

        self.files_to_download: Dict[str, str] = {
            'LICENSE.txt': f'{self.HUGGINGFACE_BASE_URL}/LICENSE.txt?download=true',
            'README.md': f'{self.HUGGINGFACE_BASE_URL}/README.md?download=true',
            'config.json': f'{self.HUGGINGFACE_BASE_URL}/config.json?download=true',
            'model.pth': f'{self.HUGGINGFACE_BASE_URL}/model.pth?download=true',
            'vocab.json': f'{self.HUGGINGFACE_BASE_URL}/vocab.json?download=true',
        }

    def create_directories(self) -> None:
        """Create necessary directories if they don't exist."""
        try:
            self.model_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"Model directory ready: {self.model_path}")
        except Exception as e:
            logger.error(f"Failed to create directory {self.model_path}: {e}")
            raise

    def download_file(self, url: str, destination: Path) -> bool:
        """
        Download a file from URL to destination.

        Args:
            url: URL to download from
            destination: Local path to save the file

        Returns:
            True if download was successful, False otherwise
        """
        try:
            logger.info(f"Downloading {destination.name}...")

            response = requests.get(url, stream=True, timeout=30)
            response.raise_for_status()

            with open(destination, 'wb') as file:
                for chunk in response.iter_content(chunk_size=self.CHUNK_SIZE):
                    if chunk:
                        file.write(chunk)

            logger.info(f"Successfully downloaded {destination.name}")
            return True

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to download {destination.name}: {e}")
            if destination.exists():
                destination.unlink()  # Remove partial download
            return False
        except Exception as e:
            logger.error(f"Unexpected error downloading {destination.name}: {e}")
            if destination.exists():
                destination.unlink()
            return False

    def check_and_download_models(self) -> bool:
        """
        Check for existing model files and download missing ones.

        Returns:
            True if all files are present (or successfully downloaded), False otherwise
        """
        logger.info("Checking XTTS model files...")

        self.create_directories()

        missing_files = [
            (filename, url)
            for filename, url in self.files_to_download.items()
            if not (self.model_path / filename).exists()
        ]

        if not missing_files:
            logger.info("All model files are already downloaded.")
            return True

        logger.info(f"Found {len(missing_files)} missing file(s). Starting download...")

        failed_downloads = []
        for filename, url in missing_files:
            destination = self.model_path / filename
            if not self.download_file(url, destination):
                failed_downloads.append(filename)

        if failed_downloads:
            logger.error(f"Failed to download: {', '.join(failed_downloads)}")
            return False

        logger.info("All model files downloaded successfully!")
        return True


def main():
    """Main entry point for the model downloader."""
    try:
        downloader = ModelDownloader()
        success = downloader.check_and_download_models()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        logger.warning("Download interrupted by user.")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
