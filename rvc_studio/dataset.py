"""Dataset preparation for training: slice, clean, validate, report."""
from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable, Dict, List

import numpy as np

from . import audio as A
from .config import DATASETS_DIR, TARGET_SR

ProgressFn = Callable[[float, str], None]


@dataclass
class DatasetStats:
    name: str
    clips: int
    total_seconds: float
    mean_clip_seconds: float
    f0_median_hz: float
    voice_guess: str
    quality_score: int          # 0..100
    grade: str                  # poor / fair / good / excellent
    issues: List[str]
    tips: List[str]

    def to_dict(self) -> Dict:
        return asdict(self)


def _grade(score: int) -> str:
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 45:
        return "fair"
    return "poor"


def prepare(name: str, sources: List[Path], *, min_len_s: float = 3.0,
            max_len_s: float = 12.0, denoise: bool = True, trim: bool = True,
            progress: ProgressFn = lambda p, m: None) -> DatasetStats:
    """Turn raw recordings into a clean, evenly-levelled clip set for training."""
    ds_dir = DATASETS_DIR / name
    if ds_dir.exists():
        shutil.rmtree(ds_dir)
    clips_dir = ds_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    total_samples, kept, f0s, issues = 0, 0, [], []
    for i, src in enumerate(sources):
        progress(0.05 + 0.8 * i / max(1, len(sources)), f"Slicing {src.name}")
        try:
            wav = A.load_audio(src, TARGET_SR)
        except Exception as exc:
            issues.append(f"{src.name}: unreadable ({exc.__class__.__name__})")
            continue

        rep = A.analyze(wav, TARGET_SR)
        if rep.clipping_pct > 1.0:
            issues.append(f"{src.name}: {rep.clipping_pct:.1f}% clipped samples")
        wav = A.preprocess(wav, TARGET_SR, hp_cutoff=55.0 if denoise else 0.0,
                           gate_db=-52.0 if denoise else -90.0,
                           do_trim=False, target_rms_db=-20.0)

        for sl in A.slice_on_silence(wav, TARGET_SR, min_len_s, max_len_s):
            piece = wav[sl.start:sl.end]
            if trim:
                piece = A.trim_silence(piece, TARGET_SR, pad_ms=40)
            if A.duration_of(piece, TARGET_SR) < min_len_s * 0.5:
                continue
            piece = A.match_loudness(piece, -20.0)
            A.save_audio(clips_dir / f"{kept:05d}.wav", piece, TARGET_SR, "wav")
            total_samples += piece.size
            kept += 1
            # sample pitch on a subset — every clip when there are few, else 1-in-8
            if len(f0s) < 24 and (kept <= 8 or kept % 8 == 0):
                f0 = A.estimate_f0_median(piece, TARGET_SR)
                if f0 > 0:
                    f0s.append(f0)

    progress(0.92, "Scoring dataset")
    total_s = total_samples / TARGET_SR
    f0_med = float(np.median(f0s)) if f0s else 0.0

    # score: minutes of material dominate, variety and cleanliness adjust
    minutes = total_s / 60.0
    score = int(np.clip(minutes / 10.0 * 70, 0, 70))          # 10 min -> 70
    score += int(np.clip(kept / 100.0 * 20, 0, 20))            # 100 clips -> +20
    score += 10 if not issues else max(0, 10 - 3 * len(issues))
    score = int(np.clip(score, 0, 100))

    tips: List[str] = []
    if minutes < 3:
        tips.append("Under 3 minutes of audio — aim for 10+ minutes for a convincing clone.")
    if kept < 30:
        tips.append("Few clips: add more varied sentences (questions, loud, soft).")
    if f0_med and f0_med < 80:
        tips.append("Very low measured pitch — check the source is not pitched down.")
    if not tips:
        tips.append("Dataset looks healthy. Train 150-300 epochs and watch for overfitting.")

    stats = DatasetStats(
        name=name, clips=kept, total_seconds=round(total_s, 2),
        mean_clip_seconds=round(total_s / kept, 2) if kept else 0.0,
        f0_median_hz=round(f0_med, 2),
        voice_guess="male" if 0 < f0_med < 155 else ("female" if f0_med >= 190 else
                    ("androgynous" if f0_med else "unknown")),
        quality_score=score, grade=_grade(score), issues=issues, tips=tips,
    )
    (ds_dir / "stats.json").write_text(json.dumps(stats.to_dict(), indent=2))
    progress(1.0, "Dataset ready")
    return stats


def list_datasets() -> List[Dict]:
    out = []
    for d in sorted(DATASETS_DIR.iterdir()):
        if not d.is_dir():
            continue
        f = d / "stats.json"
        if f.exists():
            try:
                out.append(json.loads(f.read_text()))
                continue
            except Exception:
                pass
        out.append({"name": d.name, "clips": len(list((d / "clips").glob("*.wav")))})
    return out


def dataset_clips(name: str) -> List[Path]:
    return sorted((DATASETS_DIR / name / "clips").glob("*.wav"))


def delete_dataset(name: str) -> bool:
    d = DATASETS_DIR / name
    if not d.is_dir():
        return False
    shutil.rmtree(d)
    return True
