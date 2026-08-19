export function parseLyricsText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\[.*?\]\s*/, "").trim())
    .filter((l) => l && !/^(\d+:\d+|instrumental|intro|outro)$/i.test(l));
}

export function parseLRC(lrc) {
  const lines = [];
  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g;
  for (const raw of String(lrc || "").split("\n")) {
    re.lastIndex = 0;
    let m;
    let text = "";
    let start = null;
    while ((m = re.exec(raw))) {
      const sec = Number(m[1]) * 60 + Number(m[2]) + Number(m[3] || 0) / (m[3]?.length === 3 ? 1000 : 100);
      if (start == null) start = sec;
      text = m[4];
    }
    text = (text || raw.replace(/\[.*?\]/g, "")).trim();
    if (start != null && text) lines.push({ text, start, end: start + 3.2 });
  }
  for (let i = 0; i < lines.length - 1; i++) {
    lines[i].end = Math.max(lines[i].start + 0.7, lines[i + 1].start);
  }
  return lines;
}

function snap(t, beat) {
  if (!beat) return t;
  return Math.round(t / beat) * beat;
}

export function timeLyrics(text, duration, bpm = 110) {
  const rows = parseLyricsText(text);
  if (!rows.length || !duration) return [];
  const beat = bpm ? 60 / Math.max(60, bpm) : 0.5;
  const startAt = Math.min(2.4, duration * 0.07);
  const usable = Math.max(5, duration - startAt - 1.4);
  const weights = rows.map((l) => Math.max(6, [...l].length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = startAt;
  return rows.map((line, i) => {
    const dur = (weights[i] / total) * usable;
    const start = Math.max(0, snap(t, beat));
    const end = Math.min(duration, snap(t + dur, beat) + 0.05);
    t += dur;
    return { text: line, start, end: Math.max(end, start + 0.8) };
  });
}

export async function fetchLyrics(artist, title) {
  const a = artist.trim();
  const t = title.trim();
  if (!a || !t) throw new Error("اكتب اسم الأغنية والفنان الأول");

  try {
    const q = new URL("https://lrclib.net/api/search");
    q.searchParams.set("track_name", t);
    q.searchParams.set("artist_name", a);
    const r = await fetch(q, { headers: { "Lrclib-Client": "NaghamVideo/2.0" } });
    if (r.ok) {
      const arr = await r.json();
      const hit = (arr || []).find((x) => x.syncedLyrics) || (arr || [])[0];
      if (hit?.syncedLyrics) {
        return { source: "lrclib-sync", lines: parseLRC(hit.syncedLyrics), raw: hit.plainLyrics || "" };
      }
      if (hit?.plainLyrics) {
        return { source: "lrclib", lines: null, raw: hit.plainLyrics };
      }
    }
  } catch {
    /* fall through */
  }

  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("ملقيناش الكلمات. الصقها بإيدك أو استخرجها بالذكاء الاصطناعي.");
  const j = await r.json();
  if (!j.lyrics) throw new Error("ملقيناش الكلمات");
  return { source: "lyrics.ovh", lines: null, raw: j.lyrics };
}

export function currentLyric(lines, t) {
  if (!lines?.length) return { current: null, prev: null, next: null, index: -1, p: 0 };
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (t >= lines[i].start && t < lines[i].end) {
      index = i;
      break;
    }
    if (t >= lines[i].start) index = i;
  }
  if (index < 0) return { current: null, prev: null, next: lines[0], index: -1, p: 0 };
  const cur = lines[index];
  const span = Math.max(0.25, cur.end - cur.start);
  const p = Math.min(1, Math.max(0, (t - cur.start) / span));
  return {
    current: cur,
    prev: lines[index - 1] || null,
    next: lines[index + 1] || null,
    index,
    p,
  };
}
