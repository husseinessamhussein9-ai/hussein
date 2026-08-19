export function pickMime() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const t of types) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function extFor(mime) {
  return mime.includes("mp4") ? "mp4" : "webm";
}

export async function recordVideo({
  visual,
  audio,
  audioEl,
  seconds,
  onProgress,
}) {
  const mime = pickMime();
  if (!mime) throw new Error("المتصفح مش بيدعم تسجيل فيديو");

  await audio.resume();
  const canvasStream = visual.canvas.captureStream(30);
  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audio.recordDest.stream.getAudioTracks(),
  ]);

  const chunks = [];
  const rec = new MediaRecorder(mixed, {
    mimeType: mime,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 192_000,
  });
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  const done = new Promise((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    rec.onerror = () => reject(new Error("فشل التسجيل"));
  });

  audioEl.currentTime = 0;
  try {
    await audioEl.play();
  } catch {
    throw new Error("لازم تضغط تشغيل مرة قبل التحميل");
  }

  rec.start(250);
  const start = performance.now();
  const totalMs = seconds * 1000;

  await new Promise((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - start;
      onProgress?.(Math.min(1, elapsed / totalMs), audioEl.currentTime);
      if (elapsed >= totalMs || audioEl.ended) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });

  if (rec.state === "recording") rec.stop();
  audioEl.pause();
  const blob = await done;
  return { blob, mime, ext: extFor(mime) };
}
