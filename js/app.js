import { AudioEngine, MOODS } from "./audio.js";
import { VisualEngine, STYLES } from "./visuals.js";
import { recordVideo } from "./export.js";

const $ = (id) => document.getElementById(id);

const ui = {
  gate: $("gate"),
  studio: $("studio"),
  done: $("done"),
  file: $("file"),
  drop: $("drop"),
  audio: $("audio"),
  view: $("view"),
  veil: $("veil"),
  veilText: $("veilText"),
  playBtn: $("playBtn"),
  iconPlay: $("iconPlay"),
  iconPause: $("iconPause"),
  timeLabel: $("timeLabel"),
  seek: $("seek"),
  titleIn: $("titleIn"),
  artistIn: $("artistIn"),
  styles: $("styles"),
  ratios: $("ratios"),
  lengths: $("lengths"),
  exportBtn: $("exportBtn"),
  exportLabel: $("exportLabel"),
  exportHint: $("exportHint"),
  exportBar: $("exportBar"),
  exportFill: $("exportFill"),
  exportProg: $("exportProg"),
  fileName: $("fileName"),
  againBtn: $("againBtn"),
  backBtn: $("backBtn"),
  outVid: $("outVid"),
  dlLink: $("dlLink"),
  statDur: $("statDur"),
  statBpm: $("statBpm"),
  statMood: $("statMood"),
  statEnergy: $("statEnergy"),
  ambient: $("ambient"),
};

const state = {
  style: "auto",
  ratio: "16:9",
  length: 30,
  objectUrl: "",
  lastBlobUrl: "",
  exporting: false,
  raf: 0,
};

const audio = new AudioEngine(ui.audio);
const visual = new VisualEngine();

function fmt(t) {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function energyWord(e) {
  if (e > 0.62) return "عالية";
  if (e > 0.38) return "متوسطة";
  return "هادية";
}

function paintStyles() {
  ui.styles.innerHTML = "";
  for (const s of STYLES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "style" + (state.style === s.id ? " on" : "");
    b.textContent = s.name;
    b.style.setProperty("--thumb", `url("${s.thumb}")`);
    b.addEventListener("click", () => {
      state.style = s.id;
      applyStyle();
      paintStyles();
    });
    ui.styles.appendChild(b);
  }
}

function applyStyle() {
  const resolved = state.style === "auto" ? (audio.mood || "cinematic") : state.style;
  visual.setMeta({
    title: ui.titleIn.value.trim(),
    artist: ui.artistIn.value.trim(),
    style: resolved,
  });
  visual.setSize(state.ratio);
  syncView();
}

function syncView() {
  ui.view.width = visual.w;
  ui.view.height = visual.h;
}

function clipSeconds() {
  const dur = ui.audio.duration || 0;
  if (state.length === "full") return Math.max(5, dur);
  return Math.max(5, Math.min(Number(state.length), dur || Number(state.length)));
}

function bindSeg(root, attr, key) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    root.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    const val = btn.dataset[attr];
    state[key] = attr === "len" && val !== "full" ? Number(val) : val;
    if (key === "ratio") applyStyle();
  });
}

function setPlaying(on) {
  ui.iconPlay.hidden = on;
  ui.iconPause.hidden = !on;
}

function loop() {
  state.raf = requestAnimationFrame(loop);
  const data = audio.sample();
  visual.setMeta({
    title: ui.titleIn.value.trim(),
    artist: ui.artistIn.value.trim(),
    style: state.style === "auto" ? (audio.mood || "cinematic") : state.style,
  });
  visual.draw(data, performance.now() / 1000);
  const vctx = ui.view.getContext("2d");
  vctx.drawImage(visual.canvas, 0, 0, ui.view.width, ui.view.height);
  if (!state.exporting) {
    ui.timeLabel.textContent = `${fmt(ui.audio.currentTime)} / ${fmt(ui.audio.duration)}`;
    if (ui.audio.duration) {
      ui.seek.value = String(Math.round((ui.audio.currentTime / ui.audio.duration) * 1000));
    }
  }
}

function startLoop() {
  cancelAnimationFrame(state.raf);
  visual.setSize(state.ratio);
  syncView();
  loop();
}

async function loadFile(file) {
  if (!file) return;
  ui.veil.hidden = false;
  ui.veilText.textContent = "بنجهّز الأغنية…";
  ui.gate.hidden = true;
  ui.done.hidden = true;
  ui.studio.hidden = false;

  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);
  ui.audio.src = state.objectUrl;
  ui.fileName.textContent = file.name;
  const base = file.name.replace(/\.[^.]+$/, "");
  if (!ui.titleIn.value) ui.titleIn.value = base;

  await new Promise((res, rej) => {
    ui.audio.onloadedmetadata = res;
    ui.audio.onerror = () => rej(new Error("مش قادرين نقرأ الملف"));
  });

  await audio.setup();
  await audio.resume();

  let buf;
  try {
    buf = await file.arrayBuffer();
    ui.veilText.textContent = "بنسمع الإيقاع والمزاج…";
    await audio.analyzeBuffer(buf);
  } catch {
    audio.bpm = 110;
    audio.mood = "cinematic";
  }

  const sum = audio.summary();
  ui.statDur.textContent = fmt(ui.audio.duration);
  ui.statBpm.textContent = sum.bpm ? `${sum.bpm} BPM` : "—";
  ui.statMood.textContent = sum.moodAr;
  ui.statEnergy.textContent = energyWord(sum.energy);
  applyStyle();
  ui.veil.hidden = true;
  startLoop();
}

async function exportClip() {
  if (state.exporting) return;
  if (!ui.audio.src) return;
  state.exporting = true;
  ui.exportBtn.disabled = true;
  ui.exportLabel.textContent = "بنصوّر الفيديو…";
  ui.exportHint.textContent = "سيّب التبويب مفتوح لحد ما يخلّص";
  ui.exportBar.hidden = false;
  ui.playBtn.disabled = true;

  applyStyle();
  const seconds = clipSeconds();

  try {
    const { blob, ext } = await recordVideo({
      visual,
      audio,
      audioEl: ui.audio,
      seconds,
      onProgress: (p) => {
        ui.exportFill.style.width = `${Math.round(p * 100)}%`;
        ui.exportProg.textContent = `${Math.round(p * 100)}%`;
      },
    });
    if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl);
    state.lastBlobUrl = URL.createObjectURL(blob);
    const name = (ui.titleIn.value.trim() || "nagham").replace(/[^\w\u0600-\u06FF-]+/g, "_");
    ui.outVid.src = state.lastBlobUrl;
    ui.dlLink.href = state.lastBlobUrl;
    ui.dlLink.download = `${name}.${ext}`;
    ui.studio.hidden = true;
    ui.done.hidden = false;
  } catch (err) {
    ui.exportHint.textContent = err.message || "حصل خطأ. جرّب كروم أو إيدج.";
  } finally {
    state.exporting = false;
    ui.exportBtn.disabled = false;
    ui.exportLabel.textContent = "نزّل الفيديو";
    ui.exportHint.textContent = "WebM بجودة عالية · من غير علامة مائية";
    ui.playBtn.disabled = false;
    setPlaying(false);
  }
}

function reset() {
  ui.audio.pause();
  ui.audio.removeAttribute("src");
  ui.audio.load();
  ui.studio.hidden = true;
  ui.done.hidden = true;
  ui.gate.hidden = false;
  ui.titleIn.value = "";
  ui.artistIn.value = "";
  setPlaying(false);
}

function ambient() {
  const c = ui.ambient;
  const ctx = c.getContext("2d");
  const fit = () => {
    c.width = innerWidth;
    c.height = innerHeight;
  };
  fit();
  addEventListener("resize", fit);
  const dots = Array.from({ length: 50 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.6 + Math.random() * 1.8,
    v: 0.00015 + Math.random() * 0.0004,
  }));
  const tick = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const d of dots) {
      d.y -= d.v;
      if (d.y < 0) d.y = 1;
      ctx.fillStyle = "rgba(224,179,90,0.22)";
      ctx.beginPath();
      ctx.arc(d.x * c.width, d.y * c.height, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function bind() {
  paintStyles();
  bindSeg(ui.ratios, "ratio", "ratio");
  bindSeg(ui.lengths, "len", "length");
  ui.titleIn.addEventListener("input", applyStyle);
  ui.artistIn.addEventListener("input", applyStyle);

  ui.file.addEventListener("change", () => loadFile(ui.file.files[0]));
  ["dragenter", "dragover"].forEach((ev) => {
    ui.drop.addEventListener(ev, (e) => {
      e.preventDefault();
      ui.drop.classList.add("over");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    ui.drop.addEventListener(ev, (e) => {
      e.preventDefault();
      ui.drop.classList.remove("over");
    });
  });
  ui.drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  });

  ui.playBtn.addEventListener("click", async () => {
    await audio.setup();
    await audio.resume();
    if (ui.audio.paused) {
      try {
        await ui.audio.play();
        setPlaying(true);
      } catch {
        /* ignore */
      }
    } else {
      ui.audio.pause();
      setPlaying(false);
    }
  });
  ui.audio.addEventListener("ended", () => setPlaying(false));
  ui.seek.addEventListener("input", () => {
    if (!ui.audio.duration) return;
    ui.audio.currentTime = (Number(ui.seek.value) / 1000) * ui.audio.duration;
  });
  ui.exportBtn.addEventListener("click", exportClip);
  ui.againBtn.addEventListener("click", reset);
  ui.backBtn.addEventListener("click", () => {
    ui.done.hidden = true;
    ui.studio.hidden = false;
  });
}

ambient();
visual.preload().then(bind);
