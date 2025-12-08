# spaCy Text Processing Engine

**Version:** 3.8.x
**Type:** Text Processing
**Purpose:** Text segmentation using spaCy's sentence boundary detection

---

## Overview

The spaCy text processing engine provides intelligent text segmentation for audiobook creation. It uses spaCy's NLP pipeline to split text into natural sentence boundaries while respecting a maximum segment length constraint.

**Architecture:** CPU-only with MD models (balanced speed/accuracy).

### Key Features

- ✅ **Intelligent Sentence Segmentation** - Uses spaCy's trained models for accurate sentence detection
- ✅ **Multi-Language Support** - 11 languages (de, en, es, fr, it, nl, pl, pt, ru, zh, ja)
- ✅ **Max Length Constraint** - Respects maximum segment length (default: 250 chars)
- ✅ **Oversized Sentence Marking** - Sentences exceeding max length marked as "failed" for manual review
- ✅ **Performance Optimized** - Disables unnecessary NLP components (NER, etc.)
- ✅ **Model Hotswap** - Switch between languages without restart

---

## Supported Languages

| Language | Model | Size |
|----------|-------|------|
| German | `de_core_news_md` | ~40 MB |
| English | `en_core_web_md` | ~40 MB |
| Spanish | `es_core_news_md` | ~40 MB |
| French | `fr_core_news_md` | ~40 MB |
| Italian | `it_core_news_md` | ~40 MB |
| Dutch | `nl_core_news_md` | ~40 MB |
| Polish | `pl_core_news_md` | ~40 MB |
| Portuguese | `pt_core_news_md` | ~40 MB |
| Russian | `ru_core_news_md` | ~40 MB |
| Chinese | `zh_core_web_md` | ~40 MB |
| Japanese | `ja_core_news_md` | ~40 MB |

---

## Installation

### Windows

```bat
cd backend/engines/text_processing/spacy
setup.bat
```

### Linux/Mac

```bash
cd backend/engines/text_processing/spacy
chmod +x setup.sh
./setup.sh
```

### Manual Setup

```bash
# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate.bat

# Activate (Linux/Mac)
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download language models (MD tier)
python -m spacy download de_core_news_md
python -m spacy download en_core_web_md
```

---

## Configuration

**File:** `engine.yaml`

### Parameters

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `max_length` | int | 250 | 50-500 | Maximum characters per segment |
| `min_length` | int | 10 | 1-100 | Minimum characters (merge short sentences) |
| `mark_oversized` | bool | true | - | Mark sentences exceeding max_length as "failed" |

---

## API Endpoints

### POST `/load`

Load spaCy model for a specific language.

```json
// Request
{ "engineModelName": "de" }

// Response
{ "status": "loaded", "engineModelName": "de_core_news_md" }
```

### POST `/segment`

Segment text into sentences.

```json
// Request
{
  "text": "This is a test. This is another sentence.",
  "language": "en",
  "maxLength": 250
}

// Response
{
  "segments": [
    { "text": "This is a test.", "start": 0, "end": 15, "status": "ok" },
    { "text": "This is another sentence.", "start": 16, "end": 41, "status": "ok" }
  ],
  "totalSegments": 2,
  "totalCharacters": 41
}
```

### GET `/health`

```json
{ "status": "ready", "engineModelLoaded": true, "currentEngineModel": "de_core_news_md" }
```

### GET `/models`

```json
{
  "models": [
    { "name": "de_core_news_md", "displayName": "de_core_news_md", "languages": ["de"] },
    { "name": "en_core_web_md", "displayName": "en_core_web_md", "languages": ["en"] }
  ],
  "defaultModel": null,
  "device": "cpu"
}
```

---

## Performance

### Optimizations

1. **Disabled Pipelines** - Only keeps `tok2vec`, `tagger`, `parser`/`senter` (required for sentence detection)
2. **Senter Preference** - Uses `senter` instead of `parser` when available (~10x faster)
3. **Model Caching** - Models stay loaded in memory for fast subsequent requests

### Benchmarks

| Text Length | Segments | Processing Time |
|-------------|----------|-----------------|
| 1 KB | ~10 | ~5 ms |
| 10 KB | ~100 | ~50 ms |
| 100 KB | ~1000 | ~500 ms |

*Tested on Intel i7-12700K, CPU-only*

---

## Troubleshooting

### Model not found

```
Failed to load spaCy model 'de_core_news_md'. Please run: python -m spacy download de_core_news_md
```

**Solution:**
```bash
# Activate venv first!
venv\Scripts\activate.bat  # Windows
source venv/bin/activate   # Linux/Mac

# Download model
python -m spacy download de_core_news_md
```

### Add more languages

```bash
python -m spacy download fr_core_news_md  # French
python -m spacy download es_core_news_md  # Spanish
# etc.
```

---

## Dependencies

### Versioning Decisions (2025-12-05)

| Package | Version | Begründung |
|---------|---------|------------|
| spacy | >=3.8.7,<4.0.0 | 3.8.11 aktuell. Major 4.x ausgeschlossen für Stabilität |
| fastapi | >=0.120.0 | Aligned mit Whisper Engine |
| uvicorn | >=0.34.0 | Aligned mit Whisper Engine |
| pydantic | >=2.10.0,<3.0.0 | v2 API stabil, v3 würde Breaking Changes bringen |
| loguru | >=0.7.0,<1.0.0 | API stabil |
| pyyaml | >=6.0.1 | 6.0.1 behebt Cython Build-Issue |

### Kompatibilitätsmatrix

| spaCy | Python | NumPy |
|-------|--------|-------|
| 3.8.7 | 3.9-3.13 | 1.x, 2.x |
| 3.8.8+ | 3.10-3.14 | 2.x |

---

## License

This engine uses spaCy (MIT License).

**Model Licenses:** All `_md` models are MIT licensed.

See: https://spacy.io/usage/models#licenses
