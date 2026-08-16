"""Test suite for RVC Studio. Run: python -m pytest tests -q"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rvc_studio import audio as A, dataset as D, engine as E, models as M, training as T  # noqa: E402

SR = 40000


# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #
def synth_voice(f0: float, secs: float = 6.0, seed: int = 0) -> np.ndarray:
    """Harmonic-rich synthetic voice with syllable envelope and light noise."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(SR * secs)) / SR
    vib = 1 + 0.01 * np.sin(2 * np.pi * 5 * t)
    sig = sum((1.0 / h) * np.sin(2 * np.pi * f0 * h * t * vib) for h in range(1, 12))
    env = np.ones_like(t)
    step = int(SR * 0.6)
    for i in range(0, len(t), step):
        seg = slice(i, min(i + step, len(t)))
        env[seg] *= np.hanning(seg.stop - seg.start)
    sig = sig * env + 0.005 * rng.standard_normal(len(t))
    return (0.3 * sig / np.max(np.abs(sig))).astype(np.float32)


@pytest.fixture(scope="module")
def male_wav():
    return synth_voice(120, 6.0, 1)


@pytest.fixture(scope="module")
def female_wav():
    return synth_voice(220, 6.0, 2)


@pytest.fixture
def wav_file(tmp_path, male_wav):
    p = tmp_path / "src.wav"
    sf.write(p, male_wav, SR)
    return p


# --------------------------------------------------------------------------- #
# audio primitives
# --------------------------------------------------------------------------- #
def test_load_roundtrip(wav_file, male_wav):
    loaded = A.load_audio(wav_file, SR)
    assert loaded.dtype == np.float32
    assert abs(len(loaded) - len(male_wav)) < 10


def test_load_resamples(tmp_path, male_wav):
    p = tmp_path / "s16k.wav"
    sf.write(p, A.resample(male_wav, SR, 16000), 16000)
    out = A.load_audio(p, SR)
    assert abs(A.duration_of(out, SR) - 6.0) < 0.1


@pytest.mark.parametrize("f0", [95, 120, 180, 220, 300])
def test_f0_estimation_accuracy(f0):
    """Estimator must land within a semitone (~6%) of the true pitch."""
    est = A.estimate_f0_median(synth_voice(f0, 5.0, seed=f0), SR)
    assert est > 0
    assert abs(1200 * math.log2(est / f0)) < 100, f"{est} vs {f0}"


def test_f0_on_silence_is_zero():
    assert A.estimate_f0_median(np.zeros(SR * 2, dtype=np.float32), SR) == 0.0


def test_fold_octaves_removes_doubling():
    vals = np.array([200, 200, 400, 100, 205, 195, 400], dtype=np.float32)
    folded = A._fold_octaves(vals)
    assert 180 < float(np.median(folded)) < 220


def test_pitch_shift_moves_f0(male_wav):
    up = A.pitch_shift(male_wav, SR, 12)
    est = A.estimate_f0_median(up, SR)
    assert 220 < est < 260, est


def test_pitch_shift_zero_is_identity(male_wav):
    assert np.array_equal(A.pitch_shift(male_wav, SR, 0.0), male_wav)


def test_auto_pitch_suggests_correct_shift(male_wav):
    semis = A.auto_pitch_semitones(male_wav, SR, target_f0_hz=220.0)
    assert 9 <= semis <= 13, semis


def test_auto_pitch_downwards(female_wav):
    semis = A.auto_pitch_semitones(female_wav, SR, target_f0_hz=110.0)
    assert -14 <= semis <= -9, semis


def test_auto_pitch_same_voice_is_zero(male_wav):
    assert abs(A.auto_pitch_semitones(male_wav, SR, 120.0)) <= 1


def test_normalize_and_limit(male_wav):
    loud = male_wav * 8
    out = A.soft_limit(A.normalize_peak(loud, -1.0), -0.5)
    assert float(np.max(np.abs(out))) <= 10 ** (-0.5 / 20) + 1e-3


def test_match_loudness_hits_target(male_wav):
    out = A.match_loudness(male_wav * 0.01, -20.0)
    assert abs(A.rms_db(out) - (-20.0)) < 1.5


def test_high_pass_removes_rumble(male_wav):
    t = np.arange(len(male_wav)) / SR
    rumble = (male_wav + 0.5 * np.sin(2 * np.pi * 25 * t)).astype(np.float32)
    cleaned = A.high_pass(rumble, SR, 55.0)
    spec = np.abs(np.fft.rfft(cleaned))
    freqs = np.fft.rfftfreq(len(cleaned), 1 / SR)
    assert spec[(freqs > 20) & (freqs < 32)].mean() < spec[(freqs > 100) & (freqs < 400)].mean()


def test_dc_offset_removal(male_wav):
    assert abs(float(np.mean(A.dc_offset_removal(male_wav + 0.2)))) < 1e-5


def test_trim_silence_shortens():
    pad = np.zeros(SR * 2, dtype=np.float32)
    padded = np.concatenate([pad, synth_voice(150, 3.0), pad])
    assert A.duration_of(A.trim_silence(padded, SR), SR) < 4.5


def test_crossfade_concat_is_seamless():
    a = np.ones(SR, dtype=np.float32)
    b = np.ones(SR, dtype=np.float32)
    out = A.crossfade_concat([a, b], SR, fade_ms=20)
    assert out.size < a.size + b.size          # overlapped
    assert float(np.max(np.abs(np.diff(out)))) < 0.05   # no click


def test_chunking_covers_signal(male_wav):
    long = np.tile(male_wav, 12)               # ~72 s
    bounds = A.chunk_for_inference(long, SR, max_len_s=20)
    assert len(bounds) > 1
    assert bounds[-1][1] == long.size


def test_slice_on_silence_returns_sane_clips():
    clip = np.concatenate([synth_voice(150, 4.0), np.zeros(SR, dtype=np.float32),
                           synth_voice(150, 5.0, seed=3)])
    slices = A.slice_on_silence(clip, SR, min_len_s=2.0, max_len_s=8.0)
    assert slices
    assert all(2.0 * SR * 0.5 <= s.length <= 8.0 * SR + 1 for s in slices)


def test_analyze_flags_clipping():
    rep = A.analyze(np.ones(SR, dtype=np.float32), SR)
    assert rep.clipping_pct > 50
    assert any("clip" in w.lower() for w in rep.warnings)


def test_analyze_detects_gender(male_wav, female_wav):
    assert A.analyze(male_wav, SR).voice_guess == "male"
    assert A.analyze(female_wav, SR).voice_guess == "female"


@pytest.mark.parametrize("fmt", ["wav", "flac", "ogg"])
def test_save_formats(tmp_path, male_wav, fmt):
    p = A.save_audio(tmp_path / f"o.{fmt}", male_wav, SR, fmt)
    assert p.exists() and p.stat().st_size > 1000


def test_save_mp3_or_fallback(tmp_path, male_wav):
    p = A.save_audio(tmp_path / "o.mp3", male_wav, SR, "mp3")
    assert p.exists() and p.suffix in (".mp3", ".wav")


# --------------------------------------------------------------------------- #
# engine
# --------------------------------------------------------------------------- #
def test_params_are_clamped():
    p = E.ConvertParams(pitch=99, index_rate=5, protect=9, filter_radius=99,
                        f0_method="bogus", output_format="xyz").clamp()
    assert p.pitch == 24 and p.index_rate == 1.0 and p.protect == 0.5
    assert p.filter_radius == 7 and p.f0_method == "rmvpe" and p.output_format == "wav"


def test_formant_shift_preserves_pitch(male_wav):
    """The key correctness property: formant warping must not move F0."""
    base = A.estimate_f0_median(male_wav, SR)
    for ratio in (0.8, 1.25):
        shifted = E.DSPBackend._formant_shift(male_wav, SR, ratio)
        est = A.estimate_f0_median(shifted, SR)
        assert abs(1200 * math.log2(est / base)) < 120, (ratio, est, base)


def test_formant_shift_changes_spectrum(male_wav):
    shifted = E.DSPBackend._formant_shift(male_wav, SR, 1.3)
    assert not np.allclose(shifted, male_wav, atol=1e-3)


def test_engine_info_keys():
    info = E.engine_info()
    assert {"backend", "gpu", "device", "target_sr"} <= info.keys()


def test_conversion_pipeline(tmp_path, wav_file):
    out = tmp_path / "out.wav"
    res = E.run_conversion(wav_file, None, E.ConvertParams(pitch=5).clamp(),
                           out, lambda p, m: None)
    assert Path(res["output"]).exists()
    assert res["output_report"]["clipping_pct"] < 1.0
    assert res["applied_pitch"] == 5


def test_conversion_progress_is_monotonic(tmp_path, wav_file):
    seen = []
    E.run_conversion(wav_file, None, E.ConvertParams(), tmp_path / "o.wav",
                     lambda p, m: seen.append(p))
    assert seen == sorted(seen) and seen[-1] == 1.0


def test_conversion_output_never_clips(tmp_path, male_wav):
    p = tmp_path / "hot.wav"
    sf.write(p, np.clip(male_wav * 6, -1, 1), SR)
    res = E.run_conversion(p, None, E.ConvertParams(pitch=3).clamp(),
                           tmp_path / "o.wav", lambda a, b: None)
    assert res["output_report"]["peak_db"] <= 0.0


# --------------------------------------------------------------------------- #
# models / datasets / training
# --------------------------------------------------------------------------- #
def test_safe_name_sanitises():
    assert M.safe_name("../../etc/passwd") == "etcpasswd"
    assert M.safe_name("") == "voice"
    assert len(M.safe_name("x" * 300)) <= 64


def test_model_import_export_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(M, "MODELS_DIR", tmp_path / "models")
    M.MODELS_DIR.mkdir(parents=True)
    src = tmp_path / "src"
    src.mkdir()
    (src / "model.pth").write_bytes(b"weights")
    (src / "added.index").write_bytes(b"index")
    import shutil
    zip_path = Path(shutil.make_archive(str(tmp_path / "pack"), "zip", str(src)))

    m = M.import_zip(zip_path, "mytest")
    assert m.has_weights and m.has_index
    assert M.get_model_dir("mytest") is not None
    assert M.delete_model("mytest")


def test_import_zip_rejects_weightless(tmp_path, monkeypatch):
    monkeypatch.setattr(M, "MODELS_DIR", tmp_path / "models")
    M.MODELS_DIR.mkdir(parents=True)
    src = tmp_path / "empty"
    src.mkdir()
    (src / "readme.txt").write_text("hi")
    import shutil
    z = Path(shutil.make_archive(str(tmp_path / "e"), "zip", str(src)))
    with pytest.raises(ValueError):
        M.import_zip(z, "bad")


def test_import_url_rejects_non_http():
    with pytest.raises(ValueError):
        M.import_url("file:///etc/passwd", "evil")


def test_voice_profile_measures_pitch(tmp_path, female_wav):
    clips = []
    for i in range(3):
        p = tmp_path / f"c{i}.wav"
        sf.write(p, female_wav, SR)
        clips.append(p)
    prof = M.build_voice_profile(tmp_path / "model", clips)
    assert 190 < prof["f0_median_hz"] < 250
    assert prof["voice_guess"] == "female"


def test_dataset_prepare_and_score(tmp_path, monkeypatch, female_wav):
    monkeypatch.setattr(D, "DATASETS_DIR", tmp_path / "ds")
    raw = tmp_path / "raw"
    raw.mkdir()
    files = []
    for i in range(3):
        p = raw / f"r{i}.wav"
        sf.write(p, np.tile(female_wav, 2), SR)
        files.append(p)
    stats = D.prepare("t", files, min_len_s=2.0, max_len_s=8.0)
    assert stats.clips > 0
    assert stats.total_seconds > 10
    assert 0 <= stats.quality_score <= 100
    assert stats.grade in ("poor", "fair", "good", "excellent")
    assert stats.tips


def test_recommend_scales_with_data():
    small = T.recommend({"total_seconds": 60, "clips": 8})
    large = T.recommend({"total_seconds": 1800, "clips": 300})
    assert small["epochs"] > large["epochs"]
    assert small["batch_size"] <= large["batch_size"]


def test_training_produces_model(tmp_path, monkeypatch, female_wav):
    monkeypatch.setattr(D, "DATASETS_DIR", tmp_path / "ds")
    monkeypatch.setattr(T, "MODELS_DIR", tmp_path / "models")
    monkeypatch.setattr(M, "MODELS_DIR", tmp_path / "models")
    raw = tmp_path / "raw"
    raw.mkdir()
    p = raw / "a.wav"
    sf.write(p, np.tile(female_wav, 3), SR)
    D.prepare("tv", [p], min_len_s=2.0, max_len_s=6.0)

    class H:
        def progress(self, *a): pass
        def check_cancel(self): pass
        def log(self, *a): pass

    res = T.train(H(), model_name="m1", dataset_name="tv", epochs=20,
                  batch_size=2, save_every=10)
    assert (tmp_path / "models" / "m1" / "model.pth").exists()
    assert res["profile"]["f0_median_hz"] > 0
    assert len(res["checkpoints"]) <= 3      # rotation keeps disk bounded


# --------------------------------------------------------------------------- #
# jobs
# --------------------------------------------------------------------------- #
def test_job_runs_and_reports():
    from rvc_studio.jobs import MANAGER
    import time

    job = MANAGER.submit("test", "unit", lambda h: (h.progress(0.5, "half"), {"ok": 1})[1])
    for _ in range(100):
        if MANAGER.get(job.id).status in ("done", "error"):
            break
        time.sleep(0.05)
    done = MANAGER.get(job.id)
    assert done.status == "done"
    assert done.result == {"ok": 1}
    assert done.progress == 1.0


def test_job_captures_errors():
    from rvc_studio.jobs import MANAGER
    import time

    def boom(h):
        raise ValueError("kaboom")

    job = MANAGER.submit("test", "fail", boom)
    for _ in range(100):
        if MANAGER.get(job.id).status in ("done", "error"):
            break
        time.sleep(0.05)
    j = MANAGER.get(job.id)
    assert j.status == "error" and "kaboom" in j.error


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from rvc_studio.server import app

    return TestClient(app)


def test_api_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"]


def test_api_index_serves_ui(client):
    r = client.get("/")
    assert r.status_code == 200 and "RVC Studio" in r.text


def test_api_analyze(client, wav_file):
    with open(wav_file, "rb") as f:
        r = client.post("/api/analyze", files={"file": ("src.wav", f, "audio/wav")})
    assert r.status_code == 200
    assert r.json()["report"]["voice_guess"] == "male"


def test_api_rejects_bad_extension(client, tmp_path):
    p = tmp_path / "x.exe"
    p.write_bytes(b"nope")
    with open(p, "rb") as f:
        r = client.post("/api/analyze", files={"file": ("x.exe", f, "application/octet-stream")})
    assert r.status_code == 400


def test_api_convert_unknown_model_404(client, wav_file):
    with open(wav_file, "rb") as f:
        r = client.post("/api/convert", files={"files": ("s.wav", f, "audio/wav")},
                        data={"model": "does-not-exist"})
    assert r.status_code == 404


def test_api_convert_queues_job(client, wav_file):
    with open(wav_file, "rb") as f:
        r = client.post("/api/convert", files={"files": ("s.wav", f, "audio/wav")},
                        data={"pitch": "2"})
    assert r.status_code == 200
    assert r.json()["jobs"][0]["kind"] == "convert"


def test_api_jobs_and_outputs(client):
    assert client.get("/api/jobs").status_code == 200
    assert client.get("/api/outputs").status_code == 200


def test_api_missing_output_404(client):
    assert client.get("/api/outputs/nope-does-not-exist.wav").status_code == 404


def test_api_delete_missing_model_404(client):
    assert client.delete("/api/models/nope-xyz").status_code == 404
