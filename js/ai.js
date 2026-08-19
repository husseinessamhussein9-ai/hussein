let pipe = null;
let loading = null;

function statusText(p) {
  if (!p) return "بنجهّز نموذج الذكاء الاصطناعي…";
  if (p.status === "initiate" || p.status === "download") return "بننزّل نموذج التعرف على الكلام…";
  if (p.status === "progress") {
    const pct = p.progress != null ? Math.round(p.progress) : 0;
    return `تحميل النموذج ${pct}%`;
  }
  if (p.status === "ready" || p.status === "done") return "النموذج جاهز. بنسمع الأغنية…";
  return "الذكاء الاصطناعي شغال…";
}

export async function transcribeSong(objectUrl, { language = "ar", onStatus } = {}) {
  onStatus?.(statusText({ status: "initiate" }));
  const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  if (!pipe) {
    if (!loading) {
      loading = pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
        quantized: true,
        progress_callback: (p) => onStatus?.(statusText(p)),
      });
    }
    pipe = await loading;
  }

  onStatus?.("بنحوّل الصوت لكلمات… ممكن ياخد دقيقة");
  const opts = {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    task: "transcribe",
  };
  if (language === "ar") opts.language = "arabic";
  if (language === "en") opts.language = "english";

  const out = await pipe(objectUrl, opts);
  const chunks = out.chunks?.length
    ? out.chunks
    : [{ text: out.text || "", timestamp: [0, null] }];

  const lines = chunks
    .map((c) => {
      const text = String(c.text || "").replace(/\s+/g, " ").trim();
      const start = Number(c.timestamp?.[0] ?? 0);
      const end = Number(c.timestamp?.[1] ?? start + 3);
      return { text, start, end: Number.isFinite(end) ? end : start + 3 };
    })
    .filter((x) => x.text && x.text.length > 1);

  if (!lines.length) throw new Error("الذكاء الاصطناعي مسمعش كلمات واضحة. الصق الكلمات يدويًا.");
  return { lines, raw: lines.map((l) => l.text).join("\n") };
}
