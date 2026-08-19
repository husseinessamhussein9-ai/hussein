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
  wave: $("wave"), nowLyric: $("nowLyric"), secBadge: $("secBadge"),
  exportOverlay: $("exportOverlay"), exportFill2: $("exportFill2"), exportProg2: $("exportProg2"),
  cancelBtn: $("cancelBtn"), vol: $("vol"), restartBtn: $("restartBtn"),
  toast: $("toast"), lyricList: $("lyricList"), clearArt: $("clearArt"),
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
  cancel: false,
  toastTimer: 0,
  videoTrack: null,
};

const audio = new AudioEngine(ui.audio);
const visual = new VisualEngine(ui.view);

function fmt(t) {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const SECTION_AR = { intro: "مقدمة", verse: "مقطع", chorus: "كورس", break: "استراحة", outro: "قفلة" };

function toast(msg) {
  if (!ui.toast) return;
  ui.toast.hidden = false;
  ui.toast.textContent = msg;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2800);
}

function savePrefs() {
  try {
    localStorage.setItem("nagham-prefs", JSON.stringify({
      style: state.style, ratio: state.ratio, length: state.length, quality: state.quality,
      lyricStyle: state.lyricStyle, font: ui.fontIn.value, accent: ui.accentIn.value,
      intensity: ui.intensity.value, lyricSize: ui.lyricSize.value,
      spectrum: ui.chkSpectrum.checked, letter: ui.chkLetter.checked,
      progress: ui.chkProgress.checked, intro: ui.chkIntro.checked, end: ui.chkEnd.checked,
    }));
    toast("اتحفظت إعداداتك على الجهاز");
  } catch { toast("مقدرناش نحفظ الإعدادات"); }
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem("nagham-prefs") || "null");
    if (!p) return;
    if (p.style) state.style = p.style;
    if (p.ratio) state.ratio = p.ratio;
    if (p.length != null) state.length = p.length;
    if (p.quality) state.quality = p.quality;
    if (p.lyricStyle) state.lyricStyle = p.lyricStyle;
    if (p.font) ui.fontIn.value = p.font;
    if (p.accent) ui.accentIn.value = p.accent;
    if (p.intensity) { ui.intensity.value = p.intensity; ui.intVal.textContent = `${p.intensity}%`; }
    if (p.lyricSize) { ui.lyricSize.value = p.lyricSize; ui.lySizeVal.textContent = `${p.lyricSize}%`; }
    if (typeof p.spectrum === "boolean") ui.chkSpectrum.checked = p.spectrum;
    if (typeof p.letter === "boolean") ui.chkLetter.checked = p.letter;
    if (typeof p.progress === "boolean") ui.chkProgress.checked = p.progress;
    if (typeof p.intro === "boolean") ui.chkIntro.checked = p.intro;
    if (typeof p.end === "boolean") ui.chkEnd.checked = p.end;
    document.querySelectorAll("#ratios button").forEach((b) => b.classList.toggle("on", b.dataset.ratio === state.ratio));
    document.querySelectorAll("#lengths button").forEach((b) => {
      const v = b.dataset.len === "full" ? "full" : Number(b.dataset.len);
      b.classList.toggle("on", String(v) === String(state.length));
    });
    document.querySelectorAll("#quals button").forEach((b) => b.classList.toggle("on", b.dataset.q === state.quality));
    document.querySelectorAll("#lyricStyles button").forEach((b) => b.classList.toggle("on", b.dataset.ls === state.lyricStyle));
  } catch { /* ignore */ }
}

function paintWave() {
  const c = ui.wave;
  if (!c) return;
  const ctx = c.getContext("2d");
  const w = c.width = c.clientWidth || 300;
  const h = c.height = 36;
  ctx.clearRect(0, 0, w, h);
  const peaks = audio.peaks?.length ? audio.peaks : Array.from({ length: 80 }, () => 0.15);
  const n = peaks.length;
  const mid = h / 2;
  const dur = ui.audio.duration || 1;
  const t = ui.audio.currentTime || 0;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * w;
    const amp = Math.max(2, peaks[i] * h * 2.2);
    ctx.fillStyle = i / n <= t / dur ? "#e0b35a" : "rgba(246,239,226,0.22)";
    ctx.fillRect(x, mid - amp / 2, Math.max(1, w / n - 0.6), amp);
  }
}

function paintLyricList() {
  if (!ui.lyricList) return;
  ui.lyricList.innerHTML = "";
  state.timedLyrics.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = `${fmt(line.start)}  ${line.text}`;
    li.addEventListener("click", () => {
      if (ui.audio.duration) ui.audio.currentTime = line.start;
    });
    ui.lyricList.appendChild(li);
  });
}

function updateLyricChrome(t) {
  const hit = state.timedLyrics.find((l) => t >= l.start && t < l.end);
  if (ui.nowLyric) {
    ui.nowLyric.textContent = hit?.text || (state.timedLyrics.length ? "…" : "الكلمات هتظهر هنا وقت التشغيل");
  }
  if (ui.lyricList) {
    [...ui.lyricList.children].forEach((li, i) => {
      const line = state.timedLyrics[i];
      li.classList.toggle("on", !!(line && t >= line.start && t < line.end));
    });
  }
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
  if (!root) return;
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || state.exporting) return;
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
  if (state.videoTrack) {
    try { state.videoTrack.requestFrame?.(); } catch { /* optional */ }
  }
  if (!state.exporting) {
    ui.timeLabel.textContent = `${fmt(ui.audio.currentTime)} / ${fmt(ui.audio.duration)}`;
    if (ui.audio.duration) {
      ui.seek.value = String(Math.round((ui.audio.currentTime / ui.audio.duration) * 1000));
    }
    if (ui.secBadge) ui.secBadge.textContent = SECTION_AR[data.section?.type] || "مقطع";
    updateLyricChrome(ui.audio.currentTime || 0);
    paintWave();
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
    paintLyricList();
    applyLook();
    return;
  }
  state.timedLyrics = timeLyrics(raw, ui.audio.duration || 30, audio.bpm || 110);
  ui.lyricStatus.textContent = `${state.timedLyrics.length} سطر متزامن مع الإيقاع`;
  paintLyricList();
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
    paintWave();
    toast("الأغنية جاهزة. اضغط تشغيل وتعالَ على الكلمات.");
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
  state.cancel = false;
  ui.exportBtn.disabled = true;
  if (ui.exportBtn2) ui.exportBtn2.disabled = true;
  ui.exportLabel.textContent = "بنصوّر الفيديو…";
  ui.exportHint.textContent = "سيّب التبويب ظاهر. متصغّرش الصفحة.";
  ui.exportBar.hidden = false;
  if (ui.exportOverlay) ui.exportOverlay.hidden = false;
  ui.playBtn.disabled = true;
  applyLook(true);
  let seconds = clipSeconds();
  if (state.length === "full" && seconds > 180 && !confirm("الأغنية أطول من 3 دقايق. التصدير هيتم في الوقت الحقيقي. كمّل؟")) {
    state.exporting = false;
    ui.exportBtn.disabled = false;
    if (ui.exportBtn2) ui.exportBtn2.disabled = false;
    ui.playBtn.disabled = false;
    if (ui.exportOverlay) ui.exportOverlay.hidden = true;
    return;
  }
  const setProg = (p) => {
    const pct = `${Math.round(p * 100)}%`;
    ui.exportFill.style.width = pct;
    ui.exportProg.textContent = pct;
    if (ui.exportFill2) ui.exportFill2.style.width = pct;
    if (ui.exportProg2) ui.exportProg2.textContent = pct;
  };
  try {
    const { blob, ext } = await recordVideo({
      visual, audio, audioEl: ui.audio, seconds, quality: state.quality,
      onProgress: setProg,
      shouldCancel: () => state.cancel,
      onTrack: (t) => { state.videoTrack = t; },
    });
    presentResult(blob, ext);
    toast("الفيديو جاهز");
  } catch (err) {
    ui.exportHint.textContent = err.message || "حصل خطأ. جرّب كروم أو إيدج.";
    toast(err.message || "التصدير فشل");
  } finally {
    state.exporting = false;
    state.cancel = false;
    state.videoTrack = null;
    ui.exportBtn.disabled = false;
    if (ui.exportBtn2) ui.exportBtn2.disabled = false;
    ui.exportLabel.textContent = "نزّل الفيديو";
    ui.exportHint.textContent = "من غير علامة مائية · الصوت جوّه الفيديو";
    ui.playBtn.disabled = false;
    if (ui.exportOverlay) ui.exportOverlay.hidden = true;
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
      paintLyricList();
      applyLook();
      toast("اتاستخرجت الكلمات");
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
        paintLyricList();
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
  ui.cancelBtn?.addEventListener("click", () => { state.cancel = true; toast("بنوقف التصوير…"); });
  ui.restartBtn?.addEventListener("click", () => {
    if (!ui.audio.duration) return;
    ui.audio.currentTime = 0;
  });
  ui.vol?.addEventListener("input", () => audio.setVolume(Number(ui.vol.value) / 100));
  ui.clearArt?.addEventListener("click", () => {
    visual.setCover(null);
    visual.setCustomBg(null);
    ui.coverIn.value = "";
    ui.bgIn.value = "";
    toast("اتمسحت الصور");
  });
  addEventListener("keydown", async (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.code === "Space") {
      e.preventDefault();
      ui.playBtn.click();
    } else if (e.code === "ArrowRight" && ui.audio.duration) {
      ui.audio.currentTime = Math.min(ui.audio.duration, ui.audio.currentTime + 5);
    } else if (e.code === "ArrowLeft" && ui.audio.duration) {
      ui.audio.currentTime = Math.max(0, ui.audio.currentTime - 5);
    } else if (e.key === "s" || e.key === "S" || e.key === "س") {
      savePrefs();
    }
  });
  addEventListener("resize", paintWave);
  loadPrefs();
  paintStyles();
  applyLook(true);
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
