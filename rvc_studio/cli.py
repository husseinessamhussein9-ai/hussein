"""Command line interface — everything the UI does, scriptable.

    python -m rvc_studio.cli serve
    python -m rvc_studio.cli convert in.wav -m myvoice --auto-pitch -o out.wav
    python -m rvc_studio.cli batch ./inputs -m myvoice --format mp3
    python -m rvc_studio.cli dataset build myvoice ./raw/*.wav
    python -m rvc_studio.cli train myvoice --dataset myvoice --epochs 200
    python -m rvc_studio.cli models list
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import audio as A, dataset as D, engine as E, models as M, training as T
from .config import AUDIO_EXTS, OUTPUTS_DIR, TARGET_SR


class _Bar:
    def __init__(self, quiet: bool = False) -> None:
        self.quiet = quiet
        self.log_lines: list[str] = []

    def progress(self, p: float, msg: str = "") -> None:
        self.log_lines.append(msg)
        if self.quiet:
            return
        width = 30
        filled = int(width * p)
        sys.stderr.write(f"\r[{'█' * filled}{'·' * (width - filled)}] {p * 100:5.1f}% {msg[:44]:<44}")
        sys.stderr.flush()
        if p >= 1.0:
            sys.stderr.write("\n")

    # JobHandle-compatible shims
    def check_cancel(self) -> None:
        pass

    def log(self, line: str) -> None:
        if not self.quiet:
            print(line, file=sys.stderr)


def _params(args) -> E.ConvertParams:
    return E.ConvertParams(
        pitch=args.pitch, auto_pitch=args.auto_pitch, index_rate=args.index_rate,
        filter_radius=args.filter_radius, rms_mix_rate=args.rms_mix_rate,
        protect=args.protect, f0_method=args.f0_method, denoise=not args.no_denoise,
        trim_silence=args.trim, output_format=args.format,
    ).clamp()


def _add_convert_flags(p: argparse.ArgumentParser) -> None:
    p.add_argument("-m", "--model", default="", help="voice model name")
    p.add_argument("-p", "--pitch", type=float, default=0.0, help="semitones")
    p.add_argument("--auto-pitch", action="store_true", help="measure the shift instead of guessing")
    p.add_argument("--index-rate", type=float, default=0.66)
    p.add_argument("--filter-radius", type=int, default=3)
    p.add_argument("--rms-mix-rate", type=float, default=0.25)
    p.add_argument("--protect", type=float, default=0.33)
    p.add_argument("--f0-method", default="rmvpe", choices=["rmvpe", "crepe", "harvest", "pm"])
    p.add_argument("--no-denoise", action="store_true")
    p.add_argument("--trim", action="store_true")
    p.add_argument("--format", default="wav", choices=["wav", "mp3", "flac", "ogg"])
    p.add_argument("-q", "--quiet", action="store_true")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser("rvc-studio", description="RVC Studio CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve", help="run the web app")
    s.add_argument("--host", default="0.0.0.0")
    s.add_argument("--port", type=int, default=7860)

    c = sub.add_parser("convert", help="convert a single file")
    c.add_argument("input")
    c.add_argument("-o", "--output", default="")
    _add_convert_flags(c)

    b = sub.add_parser("batch", help="convert a whole folder")
    b.add_argument("folder")
    b.add_argument("-o", "--outdir", default=str(OUTPUTS_DIR))
    _add_convert_flags(b)

    a = sub.add_parser("analyze", help="inspect an audio file")
    a.add_argument("input")

    d = sub.add_parser("dataset", help="dataset tools")
    dsub = d.add_subparsers(dest="dcmd", required=True)
    db = dsub.add_parser("build")
    db.add_argument("name")
    db.add_argument("files", nargs="+")
    db.add_argument("--min-len", type=float, default=3.0)
    db.add_argument("--max-len", type=float, default=12.0)
    dsub.add_parser("list")

    t = sub.add_parser("train", help="train a model")
    t.add_argument("model_name")
    t.add_argument("--dataset", required=True)
    t.add_argument("--epochs", type=int, default=0, help="0 = auto recommend")
    t.add_argument("--batch-size", type=int, default=0)

    mo = sub.add_parser("models", help="model registry")
    msub = mo.add_subparsers(dest="mcmd", required=True)
    msub.add_parser("list")
    mi = msub.add_parser("import"); mi.add_argument("path_or_url"); mi.add_argument("name")
    mr = msub.add_parser("remove"); mr.add_argument("name")

    sub.add_parser("info", help="show engine / device info")

    args = ap.parse_args(argv)

    # ---------------------------------------------------------------- serve
    if args.cmd == "serve":
        import uvicorn

        uvicorn.run("rvc_studio.server:app", host=args.host, port=args.port)
        return 0

    if args.cmd == "info":
        print(json.dumps({"engine": E.engine_info(),
                          "training_backend": T.training_backend()}, indent=2))
        return 0

    if args.cmd == "analyze":
        wav = A.load_audio(args.input, TARGET_SR)
        print(json.dumps(A.analyze(wav, TARGET_SR).to_dict(), indent=2))
        return 0

    # -------------------------------------------------------------- convert
    if args.cmd == "convert":
        bar = _Bar(args.quiet)
        out = Path(args.output or (OUTPUTS_DIR / (Path(args.input).stem + "_converted.wav")))
        res = E.run_conversion(Path(args.input), M.get_model_dir(args.model),
                               _params(args), out, bar.progress)
        print(json.dumps(res, indent=2))
        return 0

    if args.cmd == "batch":
        folder = Path(args.folder)
        files = [p for p in sorted(folder.rglob("*")) if p.suffix.lower() in AUDIO_EXTS]
        if not files:
            print("No audio files found.", file=sys.stderr)
            return 1
        outdir = Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)
        md = M.get_model_dir(args.model)
        results = []
        for i, f in enumerate(files, 1):
            print(f"[{i}/{len(files)}] {f.name}", file=sys.stderr)
            bar = _Bar(args.quiet)
            results.append(E.run_conversion(f, md, _params(args),
                                            outdir / f"{f.stem}_converted.wav", bar.progress))
        print(json.dumps({"converted": len(results), "outputs":
                          [r["output"] for r in results]}, indent=2))
        return 0

    # -------------------------------------------------------------- dataset
    if args.cmd == "dataset":
        if args.dcmd == "list":
            print(json.dumps(D.list_datasets(), indent=2))
            return 0
        bar = _Bar()
        stats = D.prepare(M.safe_name(args.name), [Path(f) for f in args.files],
                          min_len_s=args.min_len, max_len_s=args.max_len,
                          progress=bar.progress)
        print(json.dumps({"stats": stats.to_dict(),
                          "recommended": T.recommend(stats.to_dict())}, indent=2))
        return 0

    # ---------------------------------------------------------------- train
    if args.cmd == "train":
        stats_f = Path(D.DATASETS_DIR) / args.dataset / "stats.json"
        reco = T.recommend(json.loads(stats_f.read_text()) if stats_f.exists() else {})
        epochs = args.epochs or reco["epochs"]
        bs = args.batch_size or reco["batch_size"]
        bar = _Bar()
        res = T.train(bar, model_name=args.model_name, dataset_name=args.dataset,
                      epochs=epochs, batch_size=bs, save_every=max(10, epochs // 10))
        print(json.dumps(res, indent=2))
        return 0

    # --------------------------------------------------------------- models
    if args.cmd == "models":
        if args.mcmd == "list":
            print(json.dumps(M.list_models(), indent=2))
        elif args.mcmd == "import":
            src = args.path_or_url
            m = (M.import_url(src, args.name) if src.startswith("http")
                 else M.import_zip(Path(src), args.name))
            print(json.dumps(m.to_dict(), indent=2))
        elif args.mcmd == "remove":
            print(json.dumps({"deleted": M.delete_model(args.name)}))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
