"""FastAPI application: REST API + static web UI for RVC Studio."""
from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import audio as A, dataset as D, engine as E, models as M, training as T
from .config import (AUDIO_EXTS, DATASETS_DIR, MAX_UPLOAD_MB, MODELS_DIR,
                     OUTPUTS_DIR, TARGET_SR, UPLOADS_DIR)
from .jobs import MANAGER

app = FastAPI(title="RVC Studio", version="1.0.0",
              description="Voice conversion & training studio — a full app replacement "
                          "for the RVC Colab notebook.")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

WEB_DIR = Path(__file__).resolve().parent / "web"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _save_upload(f: UploadFile, folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    suffix = Path(f.filename or "audio.wav").suffix.lower() or ".wav"
    dest = folder / f"{int(time.time())}_{uuid.uuid4().hex[:8]}{suffix}"
    size = 0
    with open(dest, "wb") as out:
        while chunk := f.file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD_MB * 1024 * 1024:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"File exceeds {MAX_UPLOAD_MB} MB limit.")
            out.write(chunk)
    return dest


def _require_audio(path: Path) -> None:
    if path.suffix.lower() not in AUDIO_EXTS:
        path.unlink(missing_ok=True)
        raise HTTPException(400, f"Unsupported file type '{path.suffix}'.")


# --------------------------------------------------------------------------- #
# meta
# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "engine": E.engine_info(),
        "training_backend": T.training_backend(),
        "target_sr": TARGET_SR,
        "max_upload_mb": MAX_UPLOAD_MB,
        "ffmpeg": A.has_ffmpeg(),
    }


# --------------------------------------------------------------------------- #
# models
# --------------------------------------------------------------------------- #
@app.get("/api/models")
def api_models():
    return {"models": M.list_models()}


@app.post("/api/models/import-file")
async def api_import_file(name: str = Form(...), file: UploadFile = File(...)):
    tmp = _save_upload(file, UPLOADS_DIR / "models")
    try:
        if tmp.suffix.lower() == ".zip":
            model = M.import_zip(tmp, name)
        else:
            model = M.import_files({file.filename or "model.pth": tmp.read_bytes()}, name)
        return {"model": model.to_dict()}
    except Exception as exc:
        raise HTTPException(400, str(exc))
    finally:
        tmp.unlink(missing_ok=True)


@app.post("/api/models/import-url")
def api_import_url(name: str = Form(...), url: str = Form(...)):
    try:
        return {"model": M.import_url(url, name).to_dict()}
    except Exception as exc:
        raise HTTPException(400, str(exc))


@app.delete("/api/models/{name}")
def api_delete_model(name: str):
    if not M.delete_model(name):
        raise HTTPException(404, "Model not found")
    return {"deleted": name}


@app.get("/api/models/{name}/export")
def api_export_model(name: str):
    try:
        zip_path = T.export_model(name, OUTPUTS_DIR / "exports")
    except FileNotFoundError:
        raise HTTPException(404, "Model not found")
    return FileResponse(zip_path, filename=zip_path.name,
                        media_type="application/zip")


# --------------------------------------------------------------------------- #
# analysis
# --------------------------------------------------------------------------- #
@app.post("/api/analyze")
async def api_analyze(file: UploadFile = File(...), model: Optional[str] = Form(None)):
    path = _save_upload(file, UPLOADS_DIR)
    _require_audio(path)
    wav = A.load_audio(path, TARGET_SR)
    report = A.analyze(wav, TARGET_SR).to_dict()
    suggestion = None
    md = M.get_model_dir(model) if model else None
    if md:
        prof = E.load_voice_profile(md)
        if prof.get("f0_median_hz"):
            suggestion = A.auto_pitch_semitones(wav, TARGET_SR, float(prof["f0_median_hz"]))
    return {"upload_id": path.name, "report": report, "suggested_pitch": suggestion}


# --------------------------------------------------------------------------- #
# conversion
# --------------------------------------------------------------------------- #
@app.post("/api/convert")
async def api_convert(
    files: List[UploadFile] = File(...),
    model: str = Form(""),
    pitch: float = Form(0.0),
    auto_pitch: bool = Form(False),
    index_rate: float = Form(0.66),
    filter_radius: int = Form(3),
    rms_mix_rate: float = Form(0.25),
    protect: float = Form(0.33),
    f0_method: str = Form("rmvpe"),
    denoise: bool = Form(True),
    trim_silence: bool = Form(False),
    output_format: str = Form("wav"),
):
    """Queue one job per uploaded file — the batch mode the notebook never had."""
    if not files:
        raise HTTPException(400, "No files uploaded.")
    model_dir = M.get_model_dir(model) if model else None
    if model and model_dir is None:
        raise HTTPException(404, f"Model '{model}' not found.")

    params = E.ConvertParams(
        pitch=pitch, auto_pitch=auto_pitch, index_rate=index_rate,
        filter_radius=filter_radius, rms_mix_rate=rms_mix_rate, protect=protect,
        f0_method=f0_method, denoise=denoise, trim_silence=trim_silence,
        output_format=output_format,
    ).clamp()

    jobs = []
    for f in files:
        src = _save_upload(f, UPLOADS_DIR)
        _require_audio(src)
        stem = Path(f.filename or src.name).stem[:40]
        out_path = OUTPUTS_DIR / f"{stem}_{model or 'raw'}_{uuid.uuid4().hex[:6]}.wav"

        def make(src=src, out_path=out_path, params=params, model_dir=model_dir):
            def run(handle):
                return E.run_conversion(src, model_dir, params, out_path,
                                        handle.progress)
            return run

        job = MANAGER.submit("convert", f"Convert {stem}", make())
        jobs.append(job.to_dict())
    return {"jobs": jobs}


# --------------------------------------------------------------------------- #
# datasets & training
# --------------------------------------------------------------------------- #
@app.get("/api/datasets")
def api_datasets():
    return {"datasets": D.list_datasets()}


@app.delete("/api/datasets/{name}")
def api_delete_dataset(name: str):
    if not D.delete_dataset(name):
        raise HTTPException(404, "Dataset not found")
    return {"deleted": name}


@app.post("/api/datasets/prepare")
async def api_prepare(name: str = Form(...), files: List[UploadFile] = File(...),
                      min_len: float = Form(3.0), max_len: float = Form(12.0),
                      denoise: bool = Form(True), trim: bool = Form(True)):
    ds_name = M.safe_name(name)
    saved: List[Path] = []
    for f in files:
        p = _save_upload(f, UPLOADS_DIR / "datasets")
        _require_audio(p)
        saved.append(p)

    def run(handle):
        stats = D.prepare(ds_name, saved, min_len_s=min_len, max_len_s=max_len,
                          denoise=denoise, trim=trim, progress=handle.progress)
        return {"stats": stats.to_dict(),
                "recommended": T.recommend(stats.to_dict())}

    job = MANAGER.submit("dataset", f"Prepare dataset {ds_name}", run)
    return {"job": job.to_dict()}


@app.get("/api/datasets/{name}/recommend")
def api_recommend(name: str):
    f = DATASETS_DIR / name / "stats.json"
    if not f.exists():
        raise HTTPException(404, "Dataset not prepared")
    return {"recommended": T.recommend(json.loads(f.read_text()))}


@app.post("/api/train")
def api_train(model_name: str = Form(...), dataset: str = Form(...),
              epochs: int = Form(200), batch_size: int = Form(8),
              save_every: int = Form(20), f0_method: str = Form("rmvpe")):
    if not D.dataset_clips(dataset):
        raise HTTPException(400, f"Dataset '{dataset}' is empty or missing.")
    epochs = max(1, min(2000, epochs))

    def run(handle):
        return T.train(handle, model_name=model_name, dataset_name=dataset,
                       epochs=epochs, batch_size=batch_size,
                       save_every=save_every, f0_method=f0_method)

    job = MANAGER.submit("train", f"Train {M.safe_name(model_name)}", run)
    return {"job": job.to_dict()}


# --------------------------------------------------------------------------- #
# jobs
# --------------------------------------------------------------------------- #
@app.get("/api/jobs")
def api_jobs(limit: int = 50):
    return {"jobs": MANAGER.list(limit)}


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str):
    job = MANAGER.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"job": job.to_dict()}


@app.post("/api/jobs/{job_id}/cancel")
def api_cancel(job_id: str):
    return {"cancelled": MANAGER.cancel(job_id)}


@app.post("/api/jobs/clear")
def api_clear():
    return {"cleared": MANAGER.clear_finished()}


# --------------------------------------------------------------------------- #
# outputs
# --------------------------------------------------------------------------- #
@app.get("/api/outputs")
def api_outputs(limit: int = 50):
    files = sorted(OUTPUTS_DIR.glob("*.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    return {"outputs": [
        {"name": p.name, "size_mb": round(p.stat().st_size / 1e6, 2),
         "modified": p.stat().st_mtime, "url": f"/api/outputs/{p.name}"}
        for p in files[:limit] if p.is_file()
    ]}


@app.get("/api/outputs/{name}")
def api_output(name: str, download: bool = False):
    p = (OUTPUTS_DIR / Path(name).name)
    if not p.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(p, filename=p.name if download else None)


@app.delete("/api/outputs/{name}")
def api_delete_output(name: str):
    p = OUTPUTS_DIR / Path(name).name
    if not p.is_file():
        raise HTTPException(404, "Not found")
    p.unlink()
    return {"deleted": p.name}


# --------------------------------------------------------------------------- #
# UI
# --------------------------------------------------------------------------- #
if WEB_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    f = WEB_DIR / "index.html"
    if not f.exists():
        return JSONResponse({"error": "UI not built"}, status_code=500)
    return HTMLResponse(f.read_text())
