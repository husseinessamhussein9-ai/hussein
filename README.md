# 🎙️ RVC Studio

A complete voice-conversion and voice-training **application** — built as a replacement
for the "run the cells one by one" RVC Colab notebook.

Web UI · REST API · CLI · background job queue · batch processing · dataset builder.

---

## Why this is better than the notebook

| | RVC Colab notebook | **RVC Studio** |
|---|---|---|
| Interface | ordered cells, `Show code`, form fields | one web app: Convert / Models / Train / Library / Jobs |
| Files per run | 1 | **unlimited batch** — drop a folder, one job per file |
| Input | manual upload only | drag & drop, **microphone recording**, video files (mp4/webm) |
| Pitch | you guess: `0`, `-12`, `+12` | **measured**: compares your F0 to the model's and suggests the exact shift |
| Before you spend GPU time | nothing | analysis report: duration, F0, level, **clipping**, silence %, warnings |
| Long audio | preview breaks past 4 minutes | auto-chunked at quiet points, **crossfaded** — any length, always previewable |
| Progress | a spinner; disconnect = lost work | live %, streaming logs, **cancel**, state persisted to disk |
| Output | one download cell | library with inline player, re-download, delete, **wav / mp3 / flac / ogg** |
| Loudness | whatever comes out | RMS matching + soft limiter — batches sound consistent, never clip |
| Models | type a name and hope | registry: import zip/`.pth`/URL, inspect, **export**, delete |
| Training | a separate notebook | dataset builder with slicing, cleaning, **quality score 0-100** and auto hyper-parameters |
| Runs on | Colab only | Colab, your laptop, a server — UI, CLI or API |
| Tested | — | 54 automated tests |

---

## Quick start

```bash
pip install -r requirements.txt
python -m rvc_studio.cli serve          # http://localhost:7860
```

On Colab: open **`RVC_Studio_Colab.ipynb`**, set the runtime to GPU, run the first cell.
The whole studio appears embedded in the notebook.

---

## The web UI

* **Convert** — drop files or record from the mic, pick a model, hit convert.
  Advanced panel exposes index rate, consonant protection, source-dynamics blend,
  filter radius, F0 algorithm and output format.
* **Models** — import from a zip, loose `.pth`/`.index`, or a direct URL; export any
  model as a portable zip.
* **Train** — upload raw recordings → automatic slicing/cleaning → quality score and
  tips → training with recommended epochs/batch size.
* **Library** — every output, with a player and download links.
* **Jobs** — everything runs in the background; close the tab and come back.

---

## CLI

```bash
# inspect audio before doing anything expensive
python -m rvc_studio.cli analyze input.wav

# single conversion, pitch measured automatically
python -m rvc_studio.cli convert in.wav -m myvoice --auto-pitch -o out.wav

# convert an entire folder to mp3
python -m rvc_studio.cli batch ./inputs -m myvoice --format mp3

# build a dataset and train
python -m rvc_studio.cli dataset build myvoice ./raw/*.wav
python -m rvc_studio.cli train myvoice --dataset myvoice     # epochs auto-chosen

python -m rvc_studio.cli models list
python -m rvc_studio.cli info
```

---

## REST API

Interactive docs at `/docs`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | engine, device, GPU, ffmpeg status |
| `POST` | `/api/analyze` | audio report + suggested pitch |
| `POST` | `/api/convert` | queue conversions (multi-file) |
| `GET` | `/api/jobs`, `/api/jobs/{id}` | progress + logs |
| `POST` | `/api/jobs/{id}/cancel` | cancel a running job |
| `GET/POST/DELETE` | `/api/models…` | model registry, import, export |
| `POST` | `/api/datasets/prepare` | build a training dataset |
| `POST` | `/api/train` | start training |
| `GET` | `/api/outputs` | output library |

```bash
curl -F "files=@song.wav" -F "model=myvoice" -F "auto_pitch=true" \
     -F "output_format=mp3" localhost:7860/api/convert
```

---

## Engines

RVC Studio picks the best backend available and **always tells you which one ran**:

* **`rvc`** — real RVC v2 inference, used when a GPU RVC runtime (`torch` + `rvc`) is
  installed. This is the actual voice cloning path.
* **`dsp`** — portable fallback with no heavy dependencies: pitch shifting plus
  cepstral **formant/envelope warping** and timbre matching driven by the target
  model's measured voice profile. It genuinely transforms a voice and lets the whole
  app run on a CPU-only machine, but it is *not* a trained clone.

---

## Architecture

```
rvc_studio/
  audio.py      DSP: load/save, cleaning, loudness, slicing, F0 estimation
  engine.py     conversion backends (RVC / DSP) behind one interface
  models.py     model registry: import, export, voice profiling
  dataset.py    dataset preparation + quality scoring
  training.py   training orchestration and hyper-parameter recommendation
  jobs.py       persistent background job queue with progress and cancellation
  server.py     FastAPI app (REST + static UI)
  cli.py        command line interface
  web/          UI (vanilla JS, no build step)
tests/          54 tests
```

## Tests

```bash
python -m pytest tests -q
```

## Notes

Only convert or clone voices you have the right to use.
