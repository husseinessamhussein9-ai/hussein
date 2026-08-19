import { ensureWebmDuration } from "./webm.js";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
];

export function pickMime() {
  if (!window.MediaRecorder) return "";
  for (const t of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch { /* ignore */ }
  }
  return "";
}

export function extFor(mime) {
  return String(mime).includes("mp4") ? "mp4" : "webm";
}

function audioTracks(audio, audioEl) {
  const fromDest = audio.recordDest?.stream?.getAudioTracks?.() || [];
  const live = fromDest.filter((t) => t.readyState === "live");
  if (live.length) return live;
  try {
    const cap = audioEl.captureStream?.() || audioEl.mozCaptureStream?.();
    const tracks = cap?.getAudioTracks?.() || [];
    if (tracks.length) return tracks;
  } catch { /* MediaElementSource blocks element capture */ }
  return live;
}

function waitSeeked(el) {
  return new Promise((resolve) => {
    if (el.currentTime === 0 && !el.seeking) {
      resolve();
      return;
    }
    const done = () => {
      el.removeEventListener("seeked", done);
      resolve();
    };
    el.addEventListener("seeked", done);
    setTimeout(done, 500);
  });
}

function makeRecorder(stream, mime, quality) {
  const videoBitsPerSecond = quality === "1080" ? 8_000_000 : 4_500_000;
  const attempts = [];
  if (mime) {
    attempts.push({ mimeType: mime, videoBitsPerSecond, audioBitsPerSecond: 128_000 });
    attempts.push({ mimeType: mime, videoBitsPerSecond });
  }
  attempts.push({ videoBitsPerSecond });
  attempts.push({});
  let lastErr;
  for (const opts of attempts) {
    try {
      const rec = new MediaRecorder(stream, opts);
      return rec;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("المتصفح مش قادر يسجّل فيديو");
}

export async function recordVideo({
  visual,
  audio,
  audioEl,
  seconds,
  quality = "720",
  onProgress,
  shouldCancel,
}) {
  if (!window.MediaRecorder) throw new Error("المتصفح مش بيدعم تسجيل فيديو. افتح كروم أو إيدج.");
  await audio.resume();
  audioEl.muted = false;

  audioEl.pause();
  audioEl.currentTime = 0;
  await waitSeeked(audioEl);

  visual.ensureMounted();
  visual.draw(audio.sample(), 0);

  const fps = 30;
  const canvasStream = visual.canvas.captureStream(fps);
  const vTrack = canvasStream.getVideoTracks()[0];
  if (!vTrack) throw new Error("مقدرناش نمسك صورة الفيديو");
  try { vTrack.requestFrame?.(); } catch { /* optional */ }

  const tracks = [vTrack, ...audioTracks(audio, audioEl)];
  const mixed = new MediaStream(tracks);
  const mime = pickMime();
  const rec = makeRecorder(mixed, mime, quality);
  const usedMime = rec.mimeType || mime || "video/webm";

  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  const stopped = new Promise((resolve, reject) => {
    rec.onstop = () => resolve();
    rec.onerror = (e) => reject(e.error || new Error("فشل التسجيل"));
  });

  try {
    await audioEl.play();
  } catch {
    throw new Error("لازم تضغط تشغيل مرة، بعدين نزّل الفيديو");
  }

  rec.start(200);
  const startWall = performance.now();
  const totalMs = Math.max(1000, seconds * 1000);
  const startAudio = audioEl.currentTime;

  await new Promise((resolve) => {
    const tick = () => {
      const wall = performance.now() - startWall;
      const played = Math.max(0, (audioEl.currentTime - startAudio) * 1000);
      const elapsed = Math.max(wall, played);
      onProgress?.(Math.min(0.99, elapsed / totalMs));
      if (elapsed >= totalMs || audioEl.ended || rec.state !== "recording") {
        resolve();
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  });

  const cancelled = shouldCancel?.();
  if (rec.state === "recording") {
    try { rec.requestData(); } catch { /* ignore */ }
    rec.stop();
  }
  await stopped;
  audioEl.pause();
  if (cancelled) throw new Error("تم إلغاء التصوير");

  if (!chunks.length) throw new Error("التسجيل طلع فاضي. جرّب كروم، وضغط تشغيل قبل التحميل.");
  let blob = new Blob(chunks, { type: usedMime.split(";")[0] || "video/webm" });
  if (blob.size < 2000) throw new Error("الملف صغير جدًا. الفيديو ما اتسجلش صح.");
  blob = await ensureWebmDuration(blob, totalMs);
  return { blob, mime: usedMime, ext: extFor(usedMime), durationMs: totalMs };
}
