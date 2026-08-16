"""Paths + runtime settings for RVC Studio."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.environ.get("RVC_STUDIO_HOME", Path(__file__).resolve().parent.parent)).resolve()
DATA = Path(os.environ.get("RVC_STUDIO_DATA", ROOT / "data")).resolve()

MODELS_DIR = DATA / "models"        # <name>/model.pth + index
UPLOADS_DIR = DATA / "uploads"      # raw user input
OUTPUTS_DIR = DATA / "outputs"      # converted audio
DATASETS_DIR = DATA / "datasets"    # training datasets (sliced)
JOBS_DIR = DATA / "jobs"            # job logs / state
CACHE_DIR = DATA / "cache"

for _p in (MODELS_DIR, UPLOADS_DIR, OUTPUTS_DIR, DATASETS_DIR, JOBS_DIR, CACHE_DIR):
    _p.mkdir(parents=True, exist_ok=True)

TARGET_SR = 40000
MAX_UPLOAD_MB = int(os.environ.get("RVC_MAX_UPLOAD_MB", "512"))
MAX_WORKERS = int(os.environ.get("RVC_MAX_WORKERS", "1"))

AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus",
              ".wma", ".mp4", ".webm", ".mkv", ".mov"}
