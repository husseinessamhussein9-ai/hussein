"""Audio DSP utilities for RVC Studio.

Everything here is engine-independent: loading, cleaning, slicing, pitch work,
loudness matching and export. The RVC engine (rvc_studio/engine.py) plugs on top.
"""
from __future__ import annotations

import math
import subprocess
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np
import soundfile as sf

TARGET_SR = 40000  # RVC v2 40k models

_FFMPEG: str | None = None


def ffmpeg_path() -> str | None:
    """Locate ffmpeg: system install first, then the pip-installable bundled build."""
    global _FFMPEG
    if _FFMPEG is not None:
        return _FFMPEG or None
    import shutil as _sh

    exe = _sh.which("ffmpeg")
    if not exe:
        try:
            import imageio_ffmpeg  # type: ignore

            exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            exe = None
    _FFMPEG = exe or ""
    return exe


def has_ffmpeg() -> bool:
    return ffmpeg_path() is not None


# --------------------------------------------------------------------------- #
# loading / saving
# --------------------------------------------------------------------------- #
def _ffmpeg_decode(path: Path, sr: int) -> np.ndarray:
    """Decode any container (mp4/m4a/webm/ogg...) through ffmpeg to mono float32."""
    exe = ffmpeg_path()
    if not exe:
        raise RuntimeError(
            f"Cannot read '{path.name}': install ffmpeg (or `pip install imageio-ffmpeg`) "
            "to support compressed / video formats."
        )
    cmd = [
        exe, "-v", "quiet", "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(sr), "-",
    ]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def load_audio(path: str | Path, sr: int = TARGET_SR) -> np.ndarray:
    """Load audio as mono float32 at `sr`. Falls back to ffmpeg for exotic formats."""
    path = Path(path)
    try:
        data, file_sr = sf.read(str(path), dtype="float32", always_2d=True)
        wav = data.mean(axis=1)
        if file_sr != sr:
            wav = resample(wav, file_sr, sr)
    except Exception:
        wav = _ffmpeg_decode(path, sr)
    wav = np.nan_to_num(wav, nan=0.0, posinf=0.0, neginf=0.0)
    return wav.astype(np.float32)


def resample(wav: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return wav.astype(np.float32)
    import librosa

    return librosa.resample(wav.astype(np.float32), orig_sr=sr_in, target_sr=sr_out)


def save_audio(path: str | Path, wav: np.ndarray, sr: int, fmt: str | None = None) -> Path:
    """Write wav/flac/ogg/mp3.

    Compressed formats go through libsndfile when it can handle them, otherwise
    ffmpeg. If neither can encode the requested format we fall back to WAV rather
    than throwing away a conversion the user already waited for.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fmt = (fmt or path.suffix.lstrip(".")).lower()
    wav = np.clip(np.nan_to_num(wav), -1.0, 1.0).astype(np.float32)

    if fmt in ("wav", "flac", "ogg"):
        sf.write(str(path), wav, sr, format=fmt.upper())
        return path

    if fmt == "mp3":
        try:  # libsndfile >= 1.1 ships an MP3 encoder
            sf.write(str(path), wav, sr, format="MP3")
            return path
        except Exception:
            pass

    exe = ffmpeg_path()
    if exe:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
            sf.write(tmp.name, wav, sr, format="WAV")
            codec = {"mp3": ["-b:a", "320k"], "m4a": ["-b:a", "256k"]}.get(fmt, [])
            subprocess.run([exe, "-v", "quiet", "-y", "-i", tmp.name, *codec, str(path)],
                           check=True)
        return path

    fallback = path.with_suffix(".wav")
    sf.write(str(fallback), wav, sr, format="WAV")
    return fallback


def duration_of(wav: np.ndarray, sr: int) -> float:
    return float(len(wav)) / float(sr)


# --------------------------------------------------------------------------- #
# cleaning
# --------------------------------------------------------------------------- #
def dc_offset_removal(wav: np.ndarray) -> np.ndarray:
    return (wav - float(np.mean(wav))).astype(np.float32)


def high_pass(wav: np.ndarray, sr: int, cutoff: float = 55.0) -> np.ndarray:
    """Remove rumble below `cutoff` Hz (butterworth, zero-phase)."""
    from scipy.signal import butter, sosfiltfilt

    if cutoff <= 0 or cutoff >= sr / 2:
        return wav
    sos = butter(4, cutoff / (sr / 2), btype="highpass", output="sos")
    return sosfiltfilt(sos, wav).astype(np.float32)


def noise_gate(wav: np.ndarray, sr: int, threshold_db: float = -45.0,
               attack_ms: float = 5.0, release_ms: float = 120.0) -> np.ndarray:
    """Smooth (click-free) downward expander used to kill room hiss between words."""
    if threshold_db <= -90:
        return wav
    frame = max(1, int(sr * 0.005))
    env = np.abs(wav)
    kernel = np.ones(frame, dtype=np.float32) / frame
    env = np.convolve(env, kernel, mode="same")
    thr = 10 ** (threshold_db / 20.0)
    target = (env > thr).astype(np.float32)

    a_att = math.exp(-1.0 / max(1.0, sr * attack_ms / 1000.0))
    a_rel = math.exp(-1.0 / max(1.0, sr * release_ms / 1000.0))
    gain = np.empty_like(target)
    g = 0.0
    for i, t in enumerate(target):
        coef = a_att if t > g else a_rel
        g = coef * g + (1 - coef) * t
        gain[i] = g
    return (wav * gain).astype(np.float32)


def trim_silence(wav: np.ndarray, sr: int, top_db: float = 35.0,
                 pad_ms: float = 80.0) -> np.ndarray:
    import librosa

    if wav.size == 0:
        return wav
    trimmed, _ = librosa.effects.trim(wav, top_db=top_db)
    if trimmed.size == 0:
        return wav
    pad = np.zeros(int(sr * pad_ms / 1000.0), dtype=np.float32)
    return np.concatenate([pad, trimmed, pad]).astype(np.float32)


# --------------------------------------------------------------------------- #
# loudness
# --------------------------------------------------------------------------- #
def rms_db(wav: np.ndarray) -> float:
    if wav.size == 0:
        return -120.0
    r = float(np.sqrt(np.mean(np.square(wav))))
    return 20 * math.log10(max(r, 1e-9))


def normalize_peak(wav: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
    peak = float(np.max(np.abs(wav))) if wav.size else 0.0
    if peak < 1e-9:
        return wav
    target = 10 ** (peak_db / 20.0)
    return (wav * (target / peak)).astype(np.float32)


def match_loudness(wav: np.ndarray, target_db: float = -20.0,
                   peak_ceiling_db: float = -1.0) -> np.ndarray:
    """Bring RMS to `target_db` then guard the peak — keeps batches consistent."""
    cur = rms_db(wav)
    if cur <= -119:
        return wav
    wav = (wav * (10 ** ((target_db - cur) / 20.0))).astype(np.float32)
    peak = float(np.max(np.abs(wav)))
    ceiling = 10 ** (peak_ceiling_db / 20.0)
    if peak > ceiling:
        wav = wav * (ceiling / peak)
    return wav.astype(np.float32)


def soft_limit(wav: np.ndarray, ceiling_db: float = -0.5) -> np.ndarray:
    ceiling = 10 ** (ceiling_db / 20.0)
    return (np.tanh(wav / max(ceiling, 1e-6)) * ceiling).astype(np.float32)


def crossfade_concat(chunks: List[np.ndarray], sr: int, fade_ms: float = 20.0) -> np.ndarray:
    """Glue processed chunks back together without seams."""
    chunks = [c for c in chunks if c.size]
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    fade = max(1, int(sr * fade_ms / 1000.0))
    out = chunks[0].astype(np.float32)
    for nxt in chunks[1:]:
        n = min(fade, out.size, nxt.size)
        if n <= 1:
            out = np.concatenate([out, nxt])
            continue
        ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
        head = out[-n:] * (1 - ramp) + nxt[:n] * ramp
        out = np.concatenate([out[:-n], head, nxt[n:]])
    return out.astype(np.float32)


# --------------------------------------------------------------------------- #
# pitch
# --------------------------------------------------------------------------- #
def semitone_ratio(semitones: float) -> float:
    return 2.0 ** (semitones / 12.0)


def pitch_shift(wav: np.ndarray, sr: int, semitones: float) -> np.ndarray:
    if abs(semitones) < 1e-3:
        return wav
    import librosa

    return librosa.effects.pitch_shift(
        wav.astype(np.float32), sr=sr, n_steps=float(semitones)
    ).astype(np.float32)


def estimate_f0_median(wav: np.ndarray, sr: int, fmin: float = 60.0,
                       fmax: float = 800.0, max_analysis_s: float = 8.0) -> float:
    """Median voiced F0 in Hz (0.0 when nothing voiced is detected).

    Analysis runs at 16 kHz on at most `max_analysis_s` of the *loudest* region
    (probabilistic YIN, with plain YIN as a fallback). Bounding the window keeps
    this fast on hour-long files while staying accurate to about a semitone.
    """
    import librosa

    if wav.size < sr // 4:
        return 0.0

    wav = _energetic_excerpt(wav, sr, max_analysis_s)

    ana_sr, hop = 16000, 320
    sig = (resample(wav, sr, ana_sr) if sr != ana_sr else wav).astype(np.float32)
    voiced_mask = None
    try:
        f0, voiced_mask, _ = librosa.pyin(sig, fmin=fmin, fmax=fmax, sr=ana_sr,
                                          frame_length=1024, hop_length=hop)
    except Exception:
        try:
            f0 = librosa.yin(sig, fmin=fmin, fmax=fmax, sr=ana_sr,
                             frame_length=1024, hop_length=hop)
        except Exception:
            return 0.0
    if f0 is None or not np.size(f0):
        return 0.0

    # keep only frames that are actually voiced (tracker flag + energy floor)
    rms = librosa.feature.rms(y=sig, frame_length=1024, hop_length=hop)[0][: len(f0)]
    f0 = np.asarray(f0)[: len(rms)]
    if not rms.size:
        return 0.0
    keep = (rms > max(float(np.median(rms)) * 0.5, 1e-4)) & np.isfinite(f0)
    if voiced_mask is not None:
        keep &= np.asarray(voiced_mask)[: len(keep)]
    vals = f0[keep & (f0 > fmin) & (f0 < fmax)]
    if not vals.size:
        return 0.0
    return float(np.median(_fold_octaves(vals)))


def _energetic_excerpt(wav: np.ndarray, sr: int, max_s: float,
                       n_windows: int = 6) -> np.ndarray:
    """Stitch together the loudest short windows spread across the whole file.

    A single contiguous excerpt can easily land on a pause or a held note; taking
    several windows from different parts keeps the estimate representative while
    bounding the cost of pitch tracking.
    """
    span = int(max_s * sr)
    if wav.size <= span:
        return wav
    win = max(int(sr * 0.5), span // n_windows)
    n_slots = max(1, wav.size // win)
    energies = np.array([
        float(np.mean(np.square(wav[i * win:(i + 1) * win]))) for i in range(n_slots)
    ])
    order = np.argsort(energies)[::-1][: max(1, span // win)]
    return np.concatenate([wav[i * win:(i + 1) * win] for i in sorted(order)])


def _fold_octaves(vals: np.ndarray) -> np.ndarray:
    """Collapse octave-doubling/halving errors onto the dominant octave.

    Pitch trackers regularly report 2f or f/2 on a handful of frames; without
    this the median drifts and auto-pitch lands a whole octave off.
    """
    med = float(np.median(vals))
    if med <= 0:
        return vals
    out = vals.astype(np.float64).copy()
    for _ in range(3):
        out = np.where(out < med / 1.5, out * 2.0, out)
        out = np.where(out > med * 1.5, out / 2.0, out)
        med = float(np.median(out))
    return out.astype(np.float32)


def auto_pitch_semitones(source_wav: np.ndarray, sr: int, target_f0_hz: float,
                         clamp: float = 14.0) -> float:
    """Suggest the pitch shift that maps the source voice onto the target's range.

    Replaces the Colab's "male->female = 12, female->male = -12" guesswork with
    an actual measurement, rounded to a whole semitone.
    """
    src = estimate_f0_median(source_wav, sr)
    if src <= 0 or target_f0_hz <= 0:
        return 0.0
    semis = 12.0 * math.log2(target_f0_hz / src)
    # fold into the nearest octave-equivalent that stays inside the clamp
    while semis > clamp:
        semis -= 12.0
    while semis < -clamp:
        semis += 12.0
    return float(round(semis))


# --------------------------------------------------------------------------- #
# slicing (for training datasets)
# --------------------------------------------------------------------------- #
@dataclass
class Slice:
    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start


def slice_on_silence(wav: np.ndarray, sr: int, min_len_s: float = 3.0,
                     max_len_s: float = 12.0, top_db: float = 35.0) -> List[Slice]:
    """Split a long recording into training-sized voiced segments."""
    import librosa

    intervals = librosa.effects.split(wav, top_db=top_db,
                                      frame_length=2048, hop_length=512)
    min_len, max_len = int(min_len_s * sr), int(max_len_s * sr)
    out: List[Slice] = []
    cur_start, cur_end = None, None

    for start, end in intervals:
        if cur_start is None:
            cur_start, cur_end = int(start), int(end)
            continue
        if end - cur_start <= max_len:
            cur_end = int(end)
        else:
            if cur_end - cur_start >= min_len:
                out.append(Slice(cur_start, cur_end))
            cur_start, cur_end = int(start), int(end)

    if cur_start is not None and cur_end - cur_start >= min_len:
        out.append(Slice(cur_start, cur_end))

    # hard-split anything still too long
    final: List[Slice] = []
    for s in out:
        if s.length <= max_len:
            final.append(s)
            continue
        pos = s.start
        while pos < s.end:
            final.append(Slice(pos, min(pos + max_len, s.end)))
            pos += max_len
    return [s for s in final if s.length >= int(min_len_s * sr * 0.5)]


def chunk_for_inference(wav: np.ndarray, sr: int, max_len_s: float = 30.0,
                        overlap_ms: float = 200.0) -> List[Tuple[int, int]]:
    """Chunk long audio so inference never blows up VRAM. Cuts at quiet points."""
    max_len = int(max_len_s * sr)
    if wav.size <= max_len:
        return [(0, wav.size)]
    ov = int(sr * overlap_ms / 1000.0)
    bounds: List[Tuple[int, int]] = []
    pos = 0
    while pos < wav.size:
        end = min(pos + max_len, wav.size)
        if end < wav.size:
            search_from = max(pos + max_len // 2, end - sr * 2)
            window = np.abs(wav[search_from:end])
            if window.size:
                end = search_from + int(np.argmin(window))
        bounds.append((max(0, pos - ov if bounds else pos), end))
        pos = end
    return bounds


# --------------------------------------------------------------------------- #
# analysis report (shown in the UI before you spend GPU minutes)
# --------------------------------------------------------------------------- #
@dataclass
class AudioReport:
    duration_s: float
    sample_rate: int
    rms_db: float
    peak_db: float
    clipping_pct: float
    silence_pct: float
    f0_median_hz: float
    voice_guess: str
    warnings: List[str]

    def to_dict(self) -> dict:
        return asdict(self)


def analyze(wav: np.ndarray, sr: int) -> AudioReport:
    peak = float(np.max(np.abs(wav))) if wav.size else 0.0
    peak_db = 20 * math.log10(max(peak, 1e-9))
    clipping = float(np.mean(np.abs(wav) > 0.995) * 100) if wav.size else 0.0
    frame = max(1, int(sr * 0.02))
    n = (wav.size // frame) * frame
    frames = wav[:n].reshape(-1, frame) if n else np.zeros((1, 1), dtype=np.float32)
    frame_rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    silence = float(np.mean(frame_rms < 10 ** (-45 / 20.0)) * 100)
    f0 = estimate_f0_median(wav, sr)

    if f0 <= 0:
        guess = "unknown"
    elif f0 < 155:
        guess = "male"
    elif f0 < 190:
        guess = "androgynous"
    else:
        guess = "female"

    warns: List[str] = []
    if duration_of(wav, sr) < 1.0:
        warns.append("Audio is shorter than 1s — result will be unusable.")
    if clipping > 0.5:
        warns.append(f"{clipping:.1f}% of samples are clipped — re-record or lower the input gain.")
    if peak_db < -30:
        warns.append("Very quiet input; auto gain will be applied.")
    if silence > 60:
        warns.append("Over 60% silence — enable trimming for a cleaner conversion.")
    if f0 == 0:
        warns.append("No voiced pitch detected — is this music or noise only?")
    return AudioReport(
        duration_s=round(duration_of(wav, sr), 2),
        sample_rate=sr,
        rms_db=round(rms_db(wav), 2),
        peak_db=round(peak_db, 2),
        clipping_pct=round(clipping, 3),
        silence_pct=round(silence, 2),
        f0_median_hz=round(f0, 2),
        voice_guess=guess,
        warnings=warns,
    )


def preprocess(wav: np.ndarray, sr: int, *, remove_dc: bool = True,
               hp_cutoff: float = 55.0, gate_db: float = -90.0,
               do_trim: bool = False, target_rms_db: float | None = -20.0) -> np.ndarray:
    """Standard input conditioning chain applied before the engine runs."""
    if remove_dc:
        wav = dc_offset_removal(wav)
    if hp_cutoff:
        wav = high_pass(wav, sr, hp_cutoff)
    if gate_db > -90:
        wav = noise_gate(wav, sr, gate_db)
    if do_trim:
        wav = trim_silence(wav, sr)
    if target_rms_db is not None:
        wav = match_loudness(wav, target_rms_db)
    return wav.astype(np.float32)
