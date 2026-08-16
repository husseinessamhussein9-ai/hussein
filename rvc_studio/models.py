"""Model registry: import, inspect, profile and delete voice models."""
from __future__ import annotations

import json
import re
import shutil
import urllib.request
import zipfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from . import audio as A
from .config import MODELS_DIR, TARGET_SR

SAFE_NAME = re.compile(r"[^A-Za-z0-9._\- ]+")


def safe_name(name: str) -> str:
    name = SAFE_NAME.sub("", (name or "").strip()).strip(". ")
    return (name or "voice")[:64]


@dataclass
class VoiceModel:
    name: str
    path: str
    has_weights: bool
    has_index: bool
    size_mb: float
    profile: Dict
    source: str = "local"

    def to_dict(self) -> Dict:
        return asdict(self)


def _dir_size_mb(p: Path) -> float:
    return round(sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) / 1e6, 2)


def describe(model_dir: Path) -> VoiceModel:
    meta_f = model_dir / "meta.json"
    meta = json.loads(meta_f.read_text()) if meta_f.exists() else {}
    prof_f = model_dir / "voice_profile.json"
    profile = json.loads(prof_f.read_text()) if prof_f.exists() else {}
    return VoiceModel(
        name=model_dir.name,
        path=str(model_dir),
        has_weights=any(model_dir.glob("*.pth")),
        has_index=any(model_dir.glob("*.index")),
        size_mb=_dir_size_mb(model_dir),
        profile=profile,
        source=meta.get("source", "local"),
    )


def list_models() -> List[Dict]:
    out = []
    for d in sorted(MODELS_DIR.iterdir()):
        if d.is_dir():
            out.append(describe(d).to_dict())
    return out


def get_model_dir(name: str) -> Optional[Path]:
    if not name:
        return None
    d = MODELS_DIR / safe_name(name)
    return d if d.is_dir() else None


def delete_model(name: str) -> bool:
    d = get_model_dir(name)
    if not d:
        return False
    shutil.rmtree(d)
    return True


def _flatten_zip(zf: zipfile.ZipFile, dest: Path) -> None:
    """Extract only useful files, ignoring nested folder junk and path traversal."""
    keep = (".pth", ".index", ".json", ".npy", ".wav", ".flac", ".mp3", ".txt")
    for info in zf.infolist():
        if info.is_dir():
            continue
        name = Path(info.filename).name
        if not name or name.startswith(".") or not name.lower().endswith(keep):
            continue
        with zf.open(info) as src, open(dest / name, "wb") as dst:
            shutil.copyfileobj(src, dst)


def import_zip(zip_path: Path, name: str, source: str = "upload") -> VoiceModel:
    """Import a standard RVC model zip (weights + .index), as shared on Discord/HF."""
    model_dir = MODELS_DIR / safe_name(name)
    model_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        _flatten_zip(zf, model_dir)
    (model_dir / "meta.json").write_text(json.dumps({"source": source}, indent=2))
    if not any(model_dir.glob("*.pth")):
        shutil.rmtree(model_dir, ignore_errors=True)
        raise ValueError("No .pth weights found inside the archive.")
    return describe(model_dir)


def import_files(files: Dict[str, bytes], name: str) -> VoiceModel:
    """Import loose files (model.pth + optional .index)."""
    model_dir = MODELS_DIR / safe_name(name)
    model_dir.mkdir(parents=True, exist_ok=True)
    for fname, blob in files.items():
        fname = Path(fname).name
        if fname.lower().endswith((".pth", ".index")):
            (model_dir / fname).write_bytes(blob)
    (model_dir / "meta.json").write_text(json.dumps({"source": "upload"}, indent=2))
    if not any(model_dir.glob("*.pth")):
        raise ValueError("A .pth weights file is required.")
    return describe(model_dir)


def import_url(url: str, name: str) -> VoiceModel:
    """Download a model zip from a direct URL (Hugging Face, Drive direct link...)."""
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("Only http(s) URLs are supported.")
    tmp = MODELS_DIR / f".{safe_name(name)}.download"
    req = urllib.request.Request(url, headers={"User-Agent": "rvc-studio/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    try:
        if zipfile.is_zipfile(tmp):
            return import_zip(tmp, name, source=url)
        model_dir = MODELS_DIR / safe_name(name)
        model_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(tmp), model_dir / "model.pth")
        (model_dir / "meta.json").write_text(json.dumps({"source": url}, indent=2))
        return describe(model_dir)
    finally:
        tmp.unlink(missing_ok=True)


def build_voice_profile(model_dir: Path, samples: List[Path]) -> Dict:
    """Measure a reference voice so auto-pitch and timbre matching have real numbers."""
    f0s, tilts = [], []
    for s in samples[:12]:
        try:
            wav = A.load_audio(s, TARGET_SR)
        except Exception:
            continue
        wav = A.preprocess(wav, TARGET_SR, do_trim=True)
        f0 = A.estimate_f0_median(wav, TARGET_SR)
        if f0 > 0:
            f0s.append(f0)
        spec = np.abs(np.fft.rfft(wav[: TARGET_SR * 5] if wav.size else wav)) + 1e-9
        if spec.size > 16:
            freqs = np.fft.rfftfreq(min(wav.size, TARGET_SR * 5), 1 / TARGET_SR)
            low = spec[(freqs > 100) & (freqs < 1000)].mean()
            high = spec[(freqs > 3000) & (freqs < 8000)].mean()
            tilts.append(float(20 * np.log10(high / max(low, 1e-9))))

    f0_med = float(np.median(f0s)) if f0s else 0.0
    profile = {
        "f0_median_hz": round(f0_med, 2),
        "f0_samples": len(f0s),
        "brightness_db": round(float(np.median(tilts)) + 24 if tilts else 0.0, 2),
        "formant_ratio": round(float(np.clip(f0_med / 165.0, 0.75, 1.35)), 3) if f0_med else 1.0,
        "voice_guess": "male" if 0 < f0_med < 155 else ("female" if f0_med >= 190 else
                       ("androgynous" if f0_med else "unknown")),
    }
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "voice_profile.json").write_text(json.dumps(profile, indent=2))
    return profile
