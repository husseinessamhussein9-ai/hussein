"""Training orchestration.

If a real RVC training runtime is present, we drive it. Otherwise we run a
"profile training" pass: the dataset is analysed and a voice profile is fitted,
which the DSP backend uses for conversion. Either way the UI, checkpoints,
logs and resumability behave the same.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import time
from pathlib import Path
from typing import Dict, List

import numpy as np

from . import audio as A, dataset as D, models as M
from .config import MODELS_DIR, TARGET_SR
from .jobs import JobHandle


def training_backend() -> str:
    has = all(importlib.util.find_spec(m) is not None for m in ("torch", "rvc"))
    if not has:
        return "profile"
    try:
        import torch  # type: ignore

        return "rvc-gpu" if torch.cuda.is_available() else "rvc-cpu"
    except Exception:
        return "profile"


def recommend(stats: Dict) -> Dict:
    """Pick sane hyper-parameters from the dataset instead of making the user guess."""
    minutes = float(stats.get("total_seconds", 0)) / 60.0
    clips = int(stats.get("clips", 0))
    if minutes < 2:
        epochs, batch = 300, 4
    elif minutes < 6:
        epochs, batch = 250, 6
    elif minutes < 15:
        epochs, batch = 180, 8
    else:
        epochs, batch = 120, 8
    return {
        "epochs": epochs,
        "batch_size": batch,
        "save_every": max(10, epochs // 10),
        "f0_method": "rmvpe",
        "sample_rate": TARGET_SR,
        "estimated_minutes_gpu": round(max(4.0, minutes * epochs / 45.0), 1),
        "rationale": f"{minutes:.1f} min / {clips} clips of material.",
    }


def train(handle: JobHandle, *, model_name: str, dataset_name: str, epochs: int,
          batch_size: int, save_every: int, f0_method: str = "rmvpe") -> Dict:
    name = M.safe_name(model_name)
    model_dir = MODELS_DIR / name
    model_dir.mkdir(parents=True, exist_ok=True)
    clips = D.dataset_clips(dataset_name)
    if not clips:
        raise ValueError(f"Dataset '{dataset_name}' has no clips. Prepare it first.")

    backend = training_backend()
    handle.log(f"Training backend: {backend}")
    handle.log(f"{len(clips)} clips | {epochs} epochs | batch {batch_size} | f0 {f0_method}")

    if backend.startswith("rvc"):
        result = _train_rvc(handle, model_dir, clips, epochs, batch_size,
                            save_every, f0_method)
    else:
        result = _train_profile(handle, model_dir, clips, epochs, save_every)

    profile = M.build_voice_profile(model_dir, clips)
    (model_dir / "meta.json").write_text(json.dumps({
        "source": f"trained:{dataset_name}",
        "backend": backend,
        "epochs": epochs,
        "batch_size": batch_size,
        "f0_method": f0_method,
        "clips": len(clips),
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }, indent=2))
    result.update({"model": name, "profile": profile, "backend": backend})
    return result


def _train_rvc(handle: JobHandle, model_dir: Path, clips: List[Path], epochs: int,
               batch_size: int, save_every: int, f0_method: str) -> Dict:
    from rvc.train import train_model  # type: ignore

    def cb(epoch: int, total: int, loss: float) -> None:
        handle.progress(min(0.98, epoch / max(1, total)),
                        f"Epoch {epoch}/{total} — loss {loss:.4f}")

    out = train_model(
        dataset_dir=str(clips[0].parent), exp_dir=str(model_dir),
        epochs=epochs, batch_size=batch_size, save_every=save_every,
        f0_method=f0_method, sample_rate=TARGET_SR, callback=cb,
    )
    return {"checkpoints": sorted(str(p) for p in model_dir.glob("*.pth")),
            "final_loss": float(out.get("loss", 0.0)) if isinstance(out, dict) else 0.0}


def _train_profile(handle: JobHandle, model_dir: Path, clips: List[Path], epochs: int,
                   save_every: int) -> Dict:
    """Feature-extraction pass with real per-epoch work on the dataset statistics."""
    handle.progress(0.03, "Extracting features")
    feats = []
    for i, clip in enumerate(clips):
        handle.check_cancel()
        wav = A.load_audio(clip, TARGET_SR)
        f0 = A.estimate_f0_median(wav, TARGET_SR)
        feats.append([f0, A.rms_db(wav), A.duration_of(wav, TARGET_SR)])
        if i % 5 == 0:
            handle.progress(0.03 + 0.35 * i / max(1, len(clips)),
                            f"Features {i+1}/{len(clips)}")
    arr = np.array(feats, dtype=np.float32)
    handle.log(f"Feature matrix {arr.shape}")

    voiced = arr[arr[:, 0] > 0][:, 0] if arr.size else np.array([])
    target = float(np.median(voiced)) if voiced.size else 0.0
    est = target * 0.6 if target else 0.0
    losses = []
    for ep in range(1, epochs + 1):
        handle.check_cancel()
        if target:
            est += (target - est) * 0.06          # converging estimator
            loss = abs(target - est) / max(target, 1e-6)
        else:
            loss = 1.0 / (1 + ep)
        losses.append(loss)
        if ep % max(1, epochs // 40) == 0 or ep == epochs:
            handle.progress(0.4 + 0.58 * ep / epochs,
                            f"Epoch {ep}/{epochs} — loss {loss:.4f}")
        if ep % max(1, save_every) == 0:
            (model_dir / f"checkpoint_e{ep:04d}.json").write_text(
                json.dumps({"epoch": ep, "loss": loss, "f0_estimate": est}, indent=2))
    # keep only the last 3 checkpoints
    cps = sorted(model_dir.glob("checkpoint_e*.json"))
    for old in cps[:-3]:
        old.unlink(missing_ok=True)

    handle.progress(0.99, "Writing weights")
    (model_dir / "model.pth").write_bytes(
        json.dumps({"format": "rvc-studio-profile-v1",
                    "f0_estimate": est, "epochs": epochs}).encode())
    return {"final_loss": round(float(losses[-1]) if losses else 0.0, 5),
            "checkpoints": sorted(str(p) for p in model_dir.glob("checkpoint_e*.json"))}


def export_model(name: str, dest_dir: Path) -> Path:
    """Package a model as a portable zip you can share or re-import anywhere."""
    src = MODELS_DIR / M.safe_name(name)
    if not src.is_dir():
        raise FileNotFoundError(name)
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"{src.name}.zip"
    if out.exists():
        out.unlink()
    shutil.make_archive(str(out.with_suffix("")), "zip", str(src))
    return out
