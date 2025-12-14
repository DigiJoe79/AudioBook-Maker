# Release v1.0.2 - VibeVoice TTS Engine

New TTS engine and code quality improvements.

## New Features

### VibeVoice TTS Engine (Experimental)

Added Microsoft VibeVoice as a new TTS engine with voice cloning support.

**Models:**
- **VibeVoice-1.5B** (~3GB VRAM) - Faster generation, up to 90 min audio
- **VibeVoice-7B** (~18GB VRAM) - Highest quality, up to 45 min audio

**Languages:**
- Stable: English (en), Chinese (zh)
- Experimental: German (de), French (fr), Italian (it), Japanese (ja), Korean (ko), Dutch (nl), Polish (pl), Portuguese (pt), Spanish (es)

**Requirements:**
- Python 3.12
- PyTorch 2.9.1 with CUDA 13.0
- Optional: Flash Attention 2 for ~2x faster inference and ~40% less VRAM

**Optional Flash Attention 2 Setup (Windows):**

The setup script asks whether to install Flash Attention 2. If you choose yes, it installs:
- [triton-windows](https://github.com/woct0rdho/triton-windows) - Triton compiler for Windows
- [Flash-Attention-2_for_Windows](https://huggingface.co/ussoewwin/Flash-Attention-2_for_Windows) - Pre-built Windows wheels

Without Flash Attention, SDPA (Scaled Dot-Product Attention) is used as fallback with ~80% of the performance.

**Voice Sample Recommendations for Voice Cloning with VibeVoice:**

| Aspect | Recommendation |
|--------|----------------|
| Duration | 10-60 seconds (10s minimum) |
| Format | WAV or MP3 |
| Sample Rate | 24kHz (VibeVoice native rate) |
| Quality | Clean, no background noise/music |
| Language | EN or ZH for best results |

Best practices:
- Use clean audio without background noise or music
- Natural speaking pace (not too fast)
- Consistent volume throughout
- Avoid intro phrases like "Welcome to..." or "Hello..." (can cause artifacts)
- The 7B model is more stable with fewer unexpected artifacts

### EPUB Import

Added EPUB file support to the Import workflow. You can now import e-books directly alongside Markdown files.

**Features:**
- Automatic EPUB-to-Markdown conversion
- Chapter structure detection
- Front matter filtering (skips cover, ToC, copyright pages)
- Same preview/execute workflow as Markdown import

**Dependencies:** `ebooklib`, `beautifulsoup4`, `markdownify`

*Contributed by [@codesterribly](https://github.com/codesterribly)*

## Bug Fixes

- **Text Segmentation**: Fixed `max_length` parameter being ignored during text segmentation. Segments were incorrectly limited to 250 characters instead of the configured limit (e.g., 5000 for VibeVoice). Affected both Upload and Import workflows.
- **Segment Text Normalization**: Newlines and extra whitespace are now removed when segments are created. This fixes issues with TTS engines (like VibeVoice) that interpret newlines as speaker turn boundaries, causing audio to be truncated.
- **Engine Enable/Disable**: Fixed engines not being disabled when clicking the disable button. The `enabled` flag was written to a separate copy of the settings dictionary instead of the original, causing changes to be lost on save.
- **TTS Job Timestamps**: Fixed job completion timestamps jumping by ~1 hour. SQLite's `datetime('now')` returns UTC without timezone info, but JavaScript interpreted it as local time. Now uses `datetime.now().isoformat()` for consistent local timestamps.

## Improvements

- **API Types**: Migrated frontend API types to OpenAPI-generated source for better type safety

---

**Full Changelog**: https://github.com/DigiJoe79/audiobook-maker/compare/v1.0.1...v1.0.2
