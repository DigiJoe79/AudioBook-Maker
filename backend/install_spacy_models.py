"""
Install required spaCy language models
Run this after installing requirements.txt
"""
import subprocess
import sys


def install_model(model_name: str):
    """Install a spaCy model"""
    print(f"Installing spaCy model: {model_name}")
    try:
        subprocess.check_call([
            sys.executable, "-m", "spacy", "download", model_name
        ])
        print(f"✓ Successfully installed {model_name}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to install {model_name}: {e}")
        return False


def main():
    """Install all required spaCy models"""
    print("=" * 60)
    print("Installing spaCy language models for Audiobook Maker")
    print("=" * 60)
    print()

    models = [
        ("de_core_news_sm", "German"),
        ("en_core_web_sm", "English"),
    ]

    success_count = 0
    for model, language in models:
        print(f"\n{language} model ({model}):")
        if install_model(model):
            success_count += 1

    print()
    print("=" * 60)
    print(f"Installation complete: {success_count}/{len(models)} models installed")
    print("=" * 60)

    if success_count < len(models):
        print("\nSome models failed to install. You can install them manually:")
        for model, language in models:
            print(f"  python -m spacy download {model}")
        sys.exit(1)


if __name__ == "__main__":
    main()
