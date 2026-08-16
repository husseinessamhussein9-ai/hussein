"""Voice-conversion engine layer.

Two backends share one interface:

  * `RVCBackend`      — real RVC v2 inference (needs torch + an RVC runtime and,
                        realistically, a GPU). Auto-selected when importable.
  * `DSPBackend`      — dependency-free formant/pitch transformer. Not a clone,
                        but it lets the whole app (UI, queue, batch, exports) run
                        and be tested anywhere, including CPU-only boxes.

`get_engine()` picks the best available backend and reports which one it used, so
the UI can be honest about what produced the audio.
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np

from . import audio as A
from .config import TARGET_SR

ProgressFn = Callable[[float, str], None]


def _module_present(name: str) -> bool:
    """Is `name` importable? Never raises, even for odd/partial installs."""
    if name in sys.modules:
        return True
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, AttributeError):
        return False


@dataclass
class ConvertParams:
    """All knobs the Colab exposed, plus the ones it was missing."""
    pitch: float = 0.0                  # semitones
    auto_pitch: bool = False            # measure instead of guessing +/-12
    index_rate: float = 0.66            # timbre adherence to the model index
    filter_radius: int = 3              # median filter on f0 (breathiness)
    rms_mix_rate: float = 0.25          # keep source dynamics
    protect: float = 0.33               # protect consonants / breaths
    f0_method: str = "rmvpe"            # rmvpe | crepe | harvest | pm
    resample_sr: int = 0                # 0 = keep model rate
    # pre/post processing
    denoise: bool = True
    trim_silence: bool = False
    gate_db: float = -90.0
    target_rms_db: Optional[float] = -20.0
    limiter: bool = True
    output_format: str = "wav"

    def clamp(self) -> "ConvertParams":
        self.pitch = float(np.clip(self.pitch, -24, 24))
        self.index_rate = float(np.clip(self.index_rate, 0.0, 1.0))
        self.filter_radius = int(np.clip(self.filter_radius, 0, 7))
        self.rms_mix_rate = float(np.clip(self.rms_mix_rate, 0.0, 1.0))
        self.protect = float(np.clip(self.protect, 0.0, 0.5))
        if self.f0_method not in ("rmvpe", "crepe", "harvest", "pm"):
            self.f0_method = "rmvpe"
        if self.output_format not in ("wav", "mp3", "flac", "ogg"):
            self.output_format = "wav"
        return self


@dataclass
class ConvertResult:
    wav: np.ndarray
    sr: int
    backend: str
    applied_pitch: float
    seconds: float
    notes: List[str] = field(default_factory=list)


class BaseBackend:
    name = "base"
    is_real_clone = False

    def available(self) -> bool:  # pragma: no cover - interface
        return False

    def convert(self, wav: np.ndarray, sr: int, model_dir: Optional[Path],
                params: ConvertParams, progress: ProgressFn) -> ConvertResult:
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# Real RVC
# --------------------------------------------------------------------------- #
class RVCBackend(BaseBackend):
    """Wraps the real `rvc-python` runtime (RVC v2) when it is installed.

    Models are cached per path so converting a batch of files loads the weights
    once instead of once per file.
    """

    name = "rvc"
    is_real_clone = True

    _cache: Dict[str, object] = {}

    def available(self) -> bool:
        return _module_present("torch") and _module_present("rvc_python")

    @staticmethod
    def _device() -> str:
        try:
            import torch  # type: ignore

            return "cuda:0" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"

    def _load(self, model_dir: Path):
        from rvc_python.infer import RVCInference  # type: ignore

        pth = next(iter(sorted(model_dir.glob("*.pth"))), None)
        if pth is None:
            raise FileNotFoundError(f"No .pth weights inside {model_dir}")

        key = str(pth)
        inst = self._cache.get(key)
        if inst is None:
            inst = RVCInference(device=self._device())
            index = next(iter(sorted(model_dir.glob("*.index"))), None)
            try:
                inst.load_model(str(pth), index_path=str(index) if index else None)
            except TypeError:  # older signatures take the weights only
                inst.load_model(str(pth))
            self._cache[key] = inst
        return inst

    def convert(self, wav, sr, model_dir, params, progress):
        if model_dir is None:
            raise ValueError("A trained model is required for RVC conversion.")
        import soundfile as sf

        t0 = time.time()
        progress(0.05, "Loading model weights")
        inst = self._load(Path(model_dir))

        inst.set_params(
            f0up_key=int(params.pitch),
            f0method=params.f0_method,
            index_rate=params.index_rate,
            filter_radius=params.filter_radius,
            rms_mix_rate=params.rms_mix_rate,
            protect=params.protect,
            resample_sr=params.resample_sr,
        )

        # rvc-python is file-based, so long inputs are chunked through temp files
        bounds = A.chunk_for_inference(wav, sr, max_len_s=60.0)
        pieces: List[np.ndarray] = []
        out_sr = sr
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            for i, (s, e) in enumerate(bounds):
                progress(0.1 + 0.85 * i / max(1, len(bounds)),
                         f"Converting chunk {i + 1}/{len(bounds)}")
                src = td_path / f"in_{i:04d}.wav"
                dst = td_path / f"out_{i:04d}.wav"
                sf.write(str(src), wav[s:e], sr)
                inst.infer_file(str(src), str(dst))
                piece, out_sr = sf.read(str(dst), dtype="float32", always_2d=True)
                pieces.append(piece.mean(axis=1))

        merged = A.crossfade_concat(pieces, out_sr)
        progress(0.98, "Finalising")
        return ConvertResult(merged, out_sr, self.name, params.pitch, time.time() - t0)


# --------------------------------------------------------------------------- #
# Portable DSP backend
# --------------------------------------------------------------------------- #
class DSPBackend(BaseBackend):
    """Phase-vocoder pitch + formant/timbre shaping.

    Used when no GPU RVC runtime is installed. It performs a genuine voice
    transformation (pitch, formants, brightness, breath) driven by the target
    model's voice profile, so the pipeline is end-to-end testable offline.
    """

    name = "dsp"
    is_real_clone = False

    def available(self) -> bool:
        return True

    @staticmethod
    def _formant_shift(wav: np.ndarray, sr: int, ratio: float,
                       n_fft: int = 2048, hop: int = 512, lifter: int = 40) -> np.ndarray:
        """Shift the spectral *envelope* while leaving pitch untouched.

        Warping the raw magnitude spectrum (the naive approach) drags the
        harmonics along and changes the perceived pitch. Instead we split each
        frame into envelope + excitation with cepstral liftering, warp only the
        envelope, and re-apply it to the untouched harmonic structure.
        """
        if abs(ratio - 1.0) < 1e-3 or wav.size < n_fft:
            return wav
        import librosa

        spec = librosa.stft(wav, n_fft=n_fft, hop_length=hop)
        mag, phase = np.abs(spec) + 1e-10, np.angle(spec)
        bins = mag.shape[0]

        # log-magnitude -> real cepstrum -> keep low quefrencies = smooth envelope
        log_mag = np.log(mag)
        cep = np.fft.irfft(log_mag, axis=0)
        cep[lifter:-lifter if lifter else None] = 0.0
        env = np.fft.rfft(cep, axis=0).real[:bins]

        # warp only the envelope along the frequency axis
        src_idx = np.clip(np.arange(bins) / ratio, 0, bins - 1)
        lo = np.floor(src_idx).astype(int)
        hi = np.clip(lo + 1, 0, bins - 1)
        frac = (src_idx - lo)[:, None]
        env_w = env[lo] * (1 - frac) + env[hi] * frac

        # excitation (harmonics) stays exactly where it was
        new_log = (log_mag - env) + env_w
        new_mag = np.exp(np.clip(new_log, -30.0, 30.0))
        out = librosa.istft(new_mag * np.exp(1j * phase), hop_length=hop, length=wav.size)
        return np.nan_to_num(out).astype(np.float32)

    @staticmethod
    def _tilt(wav: np.ndarray, sr: int, db_per_octave: float) -> np.ndarray:
        """Brightness control — positive lifts highs, negative darkens."""
        if abs(db_per_octave) < 0.05:
            return wav
        from scipy.signal import butter, sosfiltfilt

        sos = butter(2, min(3800.0, sr / 2 * 0.9) / (sr / 2), btype="highpass", output="sos")
        highs = sosfiltfilt(sos, wav).astype(np.float32)
        gain = 10 ** (db_per_octave / 20.0) - 1.0
        return (wav + highs * gain).astype(np.float32)

    def convert(self, wav, sr, model_dir, params, progress):
        t0 = time.time()
        notes = ["DSP backend: transformation only, not a trained voice clone."]

        profile = load_voice_profile(model_dir) if model_dir else {}
        progress(0.15, "Analysing source pitch")

        semis = params.pitch
        if params.auto_pitch and profile.get("f0_median_hz"):
            semis = A.auto_pitch_semitones(wav, sr, float(profile["f0_median_hz"]))
            notes.append(f"Auto pitch measured {semis:+.0f} semitones.")

        progress(0.35, "Shifting pitch")
        out = A.pitch_shift(wav, sr, semis)

        progress(0.6, "Shaping formants")
        formant = float(profile.get("formant_ratio", 1.0))
        if params.auto_pitch and semis:
            formant *= A.semitone_ratio(semis * 0.35)
        out = self._formant_shift(out, sr, formant)

        progress(0.75, "Matching timbre")
        out = self._tilt(out, sr, float(profile.get("brightness_db", 0.0)))

        if params.rms_mix_rate > 0:  # blend original dynamics back in
            env_src = np.abs(wav[: out.size])
            if env_src.size == out.size and out.size:
                k = max(1, int(sr * 0.02))
                sm = np.convolve(env_src, np.ones(k) / k, mode="same") + 1e-6
                cur = np.convolve(np.abs(out), np.ones(k) / k, mode="same") + 1e-6
                ratio = np.clip(sm / cur, 0.5, 2.0)
                out = out * (1 - params.rms_mix_rate + params.rms_mix_rate * ratio)

        progress(0.95, "Finalising")
        return ConvertResult(out.astype(np.float32), sr, self.name, semis,
                             time.time() - t0, notes)


# --------------------------------------------------------------------------- #
def load_voice_profile(model_dir: Optional[Path]) -> Dict:
    import json

    if not model_dir:
        return {}
    f = Path(model_dir) / "voice_profile.json"
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            return {}
    return {}


_ENGINE: Optional[BaseBackend] = None


def get_engine(force: Optional[str] = None) -> BaseBackend:
    global _ENGINE
    if force == "dsp":
        return DSPBackend()
    if _ENGINE is None:
        rvc = RVCBackend()
        _ENGINE = rvc if rvc.available() else DSPBackend()
    return _ENGINE


def engine_info() -> Dict:
    eng = get_engine()
    torch_ok = _module_present("torch")
    gpu = False
    device = "cpu"
    if torch_ok:
        try:
            import torch  # type: ignore

            gpu = bool(torch.cuda.is_available())
            device = torch.cuda.get_device_name(0) if gpu else "cpu"
        except Exception:
            pass
    return {
        "backend": eng.name,
        "real_clone": eng.is_real_clone,
        "torch": torch_ok,
        "gpu": gpu,
        "device": device,
        "target_sr": TARGET_SR,
    }


def run_conversion(input_path: Path, model_dir: Optional[Path], params: ConvertParams,
                   out_path: Path, progress: ProgressFn) -> Dict:
    """Full pipeline: load -> analyse -> condition -> convert -> polish -> save."""
    params.clamp()
    progress(0.02, "Loading audio")
    wav = A.load_audio(input_path, TARGET_SR)
    report = A.analyze(wav, TARGET_SR)

    progress(0.08, "Conditioning input")
    wav = A.preprocess(
        wav, TARGET_SR,
        hp_cutoff=55.0 if params.denoise else 0.0,
        gate_db=params.gate_db,
        do_trim=params.trim_silence,
        target_rms_db=params.target_rms_db,
    )

    res = get_engine().convert(wav, TARGET_SR, model_dir, params, progress)
    out = res.wav
    if params.target_rms_db is not None:
        out = A.match_loudness(out, params.target_rms_db)
    if params.limiter:
        out = A.soft_limit(out, -0.5)
    sr_out = params.resample_sr or res.sr
    if sr_out != res.sr:
        out = A.resample(out, res.sr, sr_out)

    out_path = out_path.with_suffix("." + params.output_format)
    A.save_audio(out_path, out, sr_out, params.output_format)
    progress(1.0, "Done")

    return {
        "output": str(out_path),
        "backend": res.backend,
        "real_clone": get_engine().is_real_clone,
        "applied_pitch": res.applied_pitch,
        "compute_seconds": round(res.seconds, 2),
        "notes": res.notes,
        "input_report": report.to_dict(),
        "output_report": A.analyze(out, sr_out).to_dict(),
        "sample_rate": sr_out,
    }
