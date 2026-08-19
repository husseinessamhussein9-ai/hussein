import { AudioEngine } from "./audio.js";
import { VisualEngine, STYLES } from "./visuals.js";
import { recordVideo } from "./export.js";
import { saveBlob } from "./webm.js";
import { timeLyrics, fetchLyrics } from "./lyrics.js";
import { transcribeSong } from "./ai.js";

const $ = (id) => document.getElementById(id);

const ui = {
  gate: $("gate"), studio: $("studio"), done: $("done"),
  file: $("file"), drop: $("drop"), audio: $("audio"),
  view: $("view"), veil: $("veil"), veilText: $("veilText"),
  playBtn: $("playBtn"), iconPlay: $("iconPlay"), iconPause: $("iconPause"),
  timeLabel: $("timeLabel"), seek: $("seek"),
  titleIn: $("titleIn"), artistIn: $("artistIn"),
  styles: $("styles"), ratios: $("ratios"), lengths: $("lengths"),
  exportBtn: $("exportBtn"), exportBtn2: $("exportBtn2"), exportLabel: $("exportLabel"), exportHint: $("exportHint"),
  exportBar: $("exportBar"), exportFill: $("exportFill"), exportProg: $("exportProg"),
  fileName: $("fileName"), againBtn: $("againBtn"), backBtn: $("backBtn"),
  outVid: $("outVid"), dlLink: $("dlLink"), dlBtn: $("dlBtn"), openBtn: $("openBtn"), fileMeta: $("fileMeta"),
  statDur: $("statDur"), statBpm: $("statBpm"), statMood: $("statMood"), statEnergy: $("statEnergy"),
  ambient: $("ambient"), lyricsIn: $("lyricsIn"), lyricStatus: $("lyricStatus"),
  aiBtn: $("aiBtn"), fetchBtn: $("fetchBtn"), applyLyrics: $("applyLyrics"),
  fontIn: $("fontIn"), accentIn: $("accentIn"), intensity: $("intensity"), intVal: $("intVal"),
  lyricSize: $("lyricSize"), lySizeVal: $("lySizeVal"),
  coverIn: $("coverIn"), bgIn: $("bgIn"),
  chkSpectrum: $("chkSpectrum"), chkLetter: $("chkLetter"), chkProgress: $("chkProgress"),
  chkIntro: $("chkIntro"), chkEnd: $("chkEnd"),
};

const state = {
  style: "director",
  ratio: "16:9",
  length: 30,
  quality: "720",
  lang: "ar",
  lyricStyle: "karaoke",
  objectUrl: "",
  lastBlobUrl: "",
  lastBlob: null,
  lastName: "nagham.webm",
  exporting: false,
  raf: 0,
  timedLyrics: [],
};

const audio = new AudioEngine(ui.audio);
const visual = new VisualEngine();

function fmt(t) {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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
      applyLook();
      paintStyles();
    });
    ui.styles.appendChild(b);
  }
}

function applyLook(resize = false) {
  const resolved = state.style === "auto" ? (audio.mood || "cinematic") : state.style;
  if (resize) {
    visual.setSize(state.ratio, state.exporting ? state.quality : "720");
    if (ui.view.width !== visual.w || ui.view.height !== visual.h) {
      ui.view.width = visual.w;
      ui.view.height = visual.h;
    }
  }
  visual.setMeta({
    title: ui.titleIn.value.trim(),
    artist: ui.artistIn.value.trim(),
    style: resolved,
    lyrics: state.timedLyrics,
    lyricStyle: state.lyricStyle,
    lyricScale: Number(ui.lyricSize.value) / 100,
    fontFamily: ui.fontIn.value,
    showSpectrum: ui.chkSpectrum.checked,
    showProgress: ui.chkProgress.checked,
    showLetterbox: ui.chkLetter.checked,
    introCard: ui.chkIntro.checked,
    endCard: ui.chkEnd.checked,
    intensity: Number(ui.intensity.value) / 100,
    accent: ui.accentIn.value,
  });
}

function fileNameFor(ext) {
  const raw = (ui.titleIn.value.trim() || "nagham").replace(/[<>:"/\\|?*]+/g, "").slice(0, 50);
  return `${raw || "nagham"}.${ext}`;
}

function clipSeconds() {
  const dur = ui.audio.duration || 0;
  if (state.length === "full") return Math.max(5, dur);
  return Math.max(5, Math.min(Number(state.length), dur || Number(state.length)));
}

function bindSeg(root, attr, key, extra) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    root.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    const val = btn.dataset[attr];
    state[key] = extra ? extra(val) : val;
    applyLook(key === "ratio" || key === "quality");
  });
}

function setPlaying(on) {
  ui.iconPlay.hidden = on;
  ui.iconPause.hidden = !on;
}

function loop() {
  state.raf = requestAnimationFrame(loop);
  const data = audio.sample();
  visual.draw(data, performance.now() / 1000);
  if (ui.view.width && ui.view.height) {
    ui.view.getContext("2d").drawImage(visual.canvas, 0, 0, ui.view.width, ui.view.height);
  }
  if (!state.exporting) {
    ui.timeLabel.textContent = `${fmt(ui.audio.currentTime)} / ${fmt(ui.audio.duration)}`;
    if (ui.audio.duration) {
      ui.seek.value = String(Math.round((ui.audio.currentTime / ui.audio.duration) * 1000));
    }
  }
}

function startLoop() {
  cancelAnimationFrame(state.raf);
  visual.ensureMounted();
  applyLook(true);
  loop();
}

function applyTiming() {
  const raw = ui.lyricsIn.value.trim();
  if (!raw) {
    state.timedLyrics = [];
    applyLook();
    return;
  }
  state.timedLyrics = timeLyrics(raw, ui.audio.duration || 30, audio.bpm || 110);
  ui.lyricStatus.textContent = `${state.timedLyrics.length} سطر متزامن مع الإيقاع`;
  applyLook();
}

async function loadFile(file) {
  if (!file) return;
  ui.veil.hidden = false;
  ui.veilText.textContent = "بنجهّز الأغنية…";
  ui.gate.hidden = true;
  ui.done.hidden = true;
  ui.studio.hidden = false;

  try {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    ui.audio.src = state.objectUrl;
    ui.fileName.textContent = file.name;
    const base = file.name.replace(/\.[^.]+$/, "");
    if (!ui.titleIn.value) ui.titleIn.value = base;

    await new Promise((res, rej) => {
      if (ui.audio.readyState >= 1) { res(); return; }
      const ok = () => res();
      const bad = () => rej(new Error("مش قادرين نقرأ الملف"));
      ui.audio.addEventListener("loadedmetadata", ok, { once: true });
      ui.audio.addEventListener("error", bad, { once: true });
      setTimeout(res, 5000);
    });

    await audio.setup();
    await audio.resume();

    try {
      ui.veilText.textContent = "الذكاء الاصطناعي بيسمع الإيقاع والكورس…";
      await audio.analyzeBuffer(await file.arrayBuffer());
    } catch {
      audio.bpm = 110;
      audio.mood = "cinematic";
    }

    const sum = audio.summary();
    ui.statDur.textContent = fmt(ui.audio.duration);
    ui.statBpm.textContent = sum.bpm ? `${sum.bpm} BPM` : "—";
    ui.statMood.textContent = sum.moodAr;
    ui.statEnergy.textContent = sum.sections ? `${sum.sections} مشهد` : "—";
    applyTiming();
    ui.veil.hidden = true;
    startLoop();
  } catch (err) {
    ui.veilText.textContent = err.message || "حصل خطأ في قراءة الأغنية";
    ui.veil.hidden = false;
  }
}

function readImage(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

function presentResult(blob, ext) {
  if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl);
  state.lastBlob = blob;
  state.lastName = fileNameFor(ext);
  state.lastBlobUrl = URL.createObjectURL(blob);
  ui.outVid.src = state.lastBlobUrl;
  if (ui.dlLink) {
    ui.dlLink.href = state.lastBlobUrl;
    ui.dlLink.download = state.lastName;
  }
  if (ui.openBtn) ui.openBtn.href = state.lastBlobUrl;
  if (ui.fileMeta) {
    const mb = (blob.size / (1024 * 1024)).toFixed(1);
    ui.fileMeta.textContent = `${state.lastName} · ${mb} MB · ${ext.toUpperCase()}`;
  }
  ui.studio.hidden = true;
  ui.done.hidden = false;
  try { saveBlob(blob, state.lastName); } catch { /* preview iframe may block auto-download */ }
}

async function exportClip() {
  if (state.exporting || !ui.audio.src) return;
  state.exporting = true;
  ui.exportBtn.disabled = true;
  if (ui.exportBtn2) ui.exportBtn2.disabled = true;
  ui.exportLabel.textContent = "بنصوّر الفيديو…";
  ui.exportHint.textContent = "سيّب التبويب ظاهر. متصغّرش الصفحة.";
  ui.exportBar.hidden = false;
  ui.playBtn.disabled = true;
  applyLook(true);
  const seconds = clipSeconds();
  try {
    const { blob, ext } = await recordVideo({
      visual, audio, audioEl: ui.audio, seconds, quality: state.quality,
      onProgress: (p) => {
        ui.exportFill.style.width = `${Math.round(p * 100)}%`;
        ui.exportProg.textContent = `${Math.round(p * 100)}%`;
      },
    });
    presentResult(blob, ext);
  } catch (err) {
    ui.exportHint.textContent = err.message || "حصل خطأ. جرّب كروم أو إيدج.";
  } finally {
    state.exporting = false;
    ui.exportBtn.disabled = false;
    if (ui.exportBtn2) ui.exportBtn2.disabled = false;
    ui.exportLabel.textContent = "نزّل الفيديو";
    ui.exportHint.textContent = "من غير علامة مائية · الصوت جوّه الفيديو";
    ui.playBtn.disabled = false;
    setPlaying(false);
    applyLook(true);
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
  ui.lyricsIn.value = "";
  state.timedLyrics = [];
  visual.setCover(null);
  visual.setCustomBg(null);
  setPlaying(false);
}

function ambient() {
  const c = ui.ambient;
  const ctx = c.getContext("2d");
  const fit = () => { c.width = innerWidth; c.height = innerHeight; };
  fit();
  addEventListener("resize", fit);
  const dots = Array.from({ length: 50 }, () => ({
    x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8,
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
  bindSeg($("lengths"), "len", "length", (v) => (v === "full" ? "full" : Number(v)));
  bindSeg($("quals"), "q", "quality");
  bindSeg($("langs"), "lang", "lang");
  bindSeg($("lyricStyles"), "ls", "lyricStyle");

  $("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    $("tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    document.querySelectorAll(".pane").forEach((p) => {
      p.hidden = p.dataset.pane !== btn.dataset.tab;
    });
  });

  ["input", "change"].forEach((ev) => {
    ui.titleIn.addEventListener(ev, applyLook);
    ui.artistIn.addEventListener(ev, applyLook);
    ui.fontIn.addEventListener(ev, applyLook);
    ui.accentIn.addEventListener(ev, applyLook);
    ui.intensity.addEventListener(ev, () => {
      ui.intVal.textContent = `${ui.intensity.value}%`;
      applyLook();
    });
    ui.lyricSize.addEventListener(ev, () => {
      ui.lySizeVal.textContent = `${ui.lyricSize.value}%`;
      applyLook();
    });
    [ui.chkSpectrum, ui.chkLetter, ui.chkProgress, ui.chkIntro, ui.chkEnd].forEach((el) => {
      el.addEventListener(ev, applyLook);
    });
  });

  ui.lyricsIn.addEventListener("change", applyTiming);
  ui.applyLyrics.addEventListener("click", applyTiming);

  ui.coverIn.addEventListener("change", async () => {
    visual.setCover(await readImage(ui.coverIn.files[0]));
  });
  ui.bgIn.addEventListener("change", async () => {
    visual.setCustomBg(await readImage(ui.bgIn.files[0]));
    state.style = "director";
  });

  ui.aiBtn.addEventListener("click", async () => {
    if (!state.objectUrl) return;
    ui.aiBtn.disabled = true;
    ui.lyricStatus.textContent = "بنحمّل الذكاء الاصطناعي… أول مرة بتاخد وقت";
    try {
      const { lines, raw } = await transcribeSong(state.objectUrl, {
        language: state.lang,
        onStatus: (s) => { ui.lyricStatus.textContent = s; },
      });
      ui.lyricsIn.value = raw;
      state.timedLyrics = lines;
      ui.lyricStatus.textContent = `اتاستخرجت ${lines.length} جملة بالذكاء الاصطناعي`;
      applyLook();
    } catch (err) {
      ui.lyricStatus.textContent = err.message || "الاستخراج فشل. الصق الكلمات بإيدك.";
    } finally {
      ui.aiBtn.disabled = false;
    }
  });

  ui.fetchBtn.addEventListener("click", async () => {
    ui.fetchBtn.disabled = true;
    ui.lyricStatus.textContent = "بندوّر على الكلمات…";
    try {
      const hit = await fetchLyrics(ui.artistIn.value, ui.titleIn.value);
      ui.lyricsIn.value = hit.raw || hit.lines.map((l) => l.text).join("\n");
      if (hit.lines) {
        state.timedLyrics = hit.lines;
        ui.lyricStatus.textContent = `اتجاب ${hit.lines.length} سطر متزامن`;
      } else {
        applyTiming();
      }
      applyLook();
    } catch (err) {
      ui.lyricStatus.textContent = err.message;
    } finally {
      ui.fetchBtn.disabled = false;
    }
  });

  ui.file.addEventListener("change", () => loadFile(ui.file.files[0]));
  ["dragenter", "dragover"].forEach((ev) => {
    ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach((ev) => {
    ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.remove("over"); });
  });
  ui.drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  });

  ui.playBtn.addEventListener("click", async () => {
    await audio.setup();
    await audio.resume();
    if (ui.audio.paused) {
      try { await ui.audio.play(); setPlaying(true); } catch { /* ignore */ }
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
  ui.exportBtn2?.addEventListener("click", exportClip);
  ui.againBtn.addEventListener("click", reset);
  ui.backBtn.addEventListener("click", () => {
    ui.done.hidden = true;
    ui.studio.hidden = false;
  });
  ui.dlBtn?.addEventListener("click", () => {
    if (!state.lastBlob) return;
    try { saveBlob(state.lastBlob, state.lastName); }
    catch { window.open(state.lastBlobUrl, "_blank"); }
  });
  ui.openBtn?.addEventListener("click", () => {
    if (state.lastBlobUrl) window.open(state.lastBlobUrl, "_blank", "noopener");
  });
  ui.dlLink?.addEventListener("click", (e) => {
    if (!state.lastBlob) return;
    e.preventDefault();
    try { saveBlob(state.lastName ? state.lastBlob : state.lastBlob, state.lastName); }
    catch { window.open(state.lastBlobUrl, "_blank"); }
  });
}

ambient();
visual.preload().then(bind);
