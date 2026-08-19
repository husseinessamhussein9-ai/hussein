import { currentLyric } from "./lyrics.js";

export const STYLES = [
  { id: "director", name: "مخرج AI", thumb: "assets/og-cover.jpg" },
  { id: "auto", name: "تلقائي", thumb: "assets/og-cover.jpg" },
  { id: "cinematic", name: "سينمائي", thumb: "assets/bg-cinematic.jpg" },
  { id: "gold", name: "ذهب وعتمة", thumb: "assets/bg-gold.jpg" },
  { id: "neon", name: "نيون", thumb: "assets/bg-neon.jpg" },
  { id: "cosmos", name: "فضاء", thumb: "assets/bg-cosmos.jpg" },
  { id: "ocean", name: "أورورا", thumb: "assets/bg-ocean.jpg" },
  { id: "fire", name: "طاقة", thumb: "assets/bg-fire.jpg" },
  { id: "romance", name: "رومانسي", thumb: "assets/bg-romance.jpg" },
];

const BG_SRC = {
  cinematic: "assets/bg-cinematic.jpg",
  gold: "assets/bg-gold.jpg",
  neon: "assets/bg-neon.jpg",
  cosmos: "assets/bg-cosmos.jpg",
  ocean: "assets/bg-ocean.jpg",
  fire: "assets/bg-fire.jpg",
  romance: "assets/bg-romance.jpg",
};

const GLOW = {
  cinematic: "rgba(80,160,220,",
  gold: "rgba(232,190,90,",
  neon: "rgba(255,60,200,",
  cosmos: "rgba(170,120,255,",
  ocean: "rgba(80,230,190,",
  fire: "rgba(255,90,30,",
  romance: "rgba(255,140,150,",
};

export class VisualEngine {
  constructor(canvas) {
    this.canvas = canvas || document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this._pattern = null;
    this.images = {};
    this.cover = null;
    this.customBg = null;
    this.particles = [];
    this.style = "cinematic";
    this.mode = "director";
    this.title = "";
    this.artist = "";
    this.ratio = "16:9";
    this.w = 1280;
    this.h = 720;
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.grain = this._makeGrain();
    this.lyrics = [];
    this.lyricStyle = "karaoke";
    this.lyricScale = 1;
    this.fontFamily = "Cairo";
    this.showSpectrum = true;
    this.showProgress = true;
    this.showLetterbox = true;
    this.introCard = true;
    this.endCard = true;
    this.intensity = 1;
    this.accent = "#e0b35a";
    this._scene = "cinematic";
    this._prevScene = "cinematic";
    this._fade = 1;
    this._wrapCache = new Map();
    this._initParticles(240);
  }

  async preload() {
    await Promise.all(Object.entries(BG_SRC).map(([k, src]) => this._load(k, src)));
    try { await document.fonts.ready; } catch { /* ignore */ }
  }

  _load(key, src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.images[key] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  setCover(img) { this.cover = img || null; }
  setCustomBg(img) { this.customBg = img || null; }

  setSize(ratio, quality = "720") {
    this.ratio = ratio;
    const long = quality === "1080" ? 1920 : 1280;
    if (ratio === "9:16") {
      this.w = quality === "1080" ? 1080 : 720;
      this.h = quality === "1080" ? 1920 : 1280;
    } else if (ratio === "1:1") {
      this.w = this.h = quality === "1080" ? 1080 : 720;
    } else {
      this.w = long;
      this.h = Math.round(long * 9 / 16);
    }
    if (this.canvas.width === this.w && this.canvas.height === this.h) return;
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this._wrapCache.clear();
    this._pattern = null;
  }

  setMeta(m = {}) {
    const keys = [
      "title", "artist", "lyrics", "lyricStyle", "lyricScale", "fontFamily",
      "showSpectrum", "showProgress", "showLetterbox", "introCard", "endCard",
      "intensity", "accent",
    ];
    for (const k of keys) {
      if (m[k] !== undefined) this[k] = m[k];
    }
    if (m.style) {
      this.style = m.style;
      this.mode = m.style;
    }
  }

  _initParticles(n) {
    this.particles = Array.from({ length: n }, () => ({
      x: Math.random(), y: Math.random(), z: Math.random(),
      s: 0.4 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 0.0008,
      vy: -0.0004 - Math.random() * 0.0014,
    }));
  }

  _makeGrain() {
    const c = document.createElement("canvas");
    c.width = 160; c.height = 160;
    const g = c.getContext("2d");
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 70 + Math.random() * 150;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 26;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  ensureMounted() {
    if (!this._pattern) {
      try { this._pattern = this.ctx.createPattern(this.grain, "repeat"); } catch { this._pattern = null; }
    }
  }

  _pickScene(a) {
    if (this.customBg) return "custom";
    if (this.mode === "director") return a.section?.style || this._scene || "cinematic";
    if (this.mode === "auto") return this.style || "cinematic";
    return this.mode || "cinematic";
  }

  draw(audio, clock = 0) {
    const { ctx, w, h } = this;
    const t = audio.t || clock;
    const scene = this._pickScene(audio);
    if (scene !== this._scene) {
      this._prevScene = this._scene;
      this._scene = scene;
      this._fade = 0;
    }
    this._fade = Math.min(1, this._fade + 0.018);

    ctx.fillStyle = "#050308";
    ctx.fillRect(0, 0, w, h);
    if (this._fade < 1) {
      this._kenBurns(this._prevScene, t, audio, 1);
      ctx.globalAlpha = this._fade;
      this._kenBurns(this._scene, t, audio, 1);
      ctx.globalAlpha = 1;
    } else {
      this._kenBurns(this._scene, t, audio, 1);
    }
    this._grade(this._scene, audio);
    this._particles(this._scene, audio);
    this._rays(this._scene, audio);
    if (this.showSpectrum) this._spectrum(this._scene, audio);
    this._beatFlash(audio);
    this._coverBadge(t, audio);
    this._vignette();
    if (this.showLetterbox) this._letterbox(this._scene);
    this._lyrics(t, audio);
    this._titles(t, audio);
    if (this.showProgress) this._progress(t, audio);
    this._cards(t, audio);
    this._grainOverlay();
  }

  _coverDraw(img, zoom, ox, oy) {
    const { ctx, w, h } = this;
    if (!img) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(w / iw, h / ih) * zoom;
    ctx.drawImage(img, (w - iw * scale) / 2 + ox, (h - ih * scale) / 2 + oy, iw * scale, ih * scale);
  }

  _kenBurns(style, t, a, _z) {
    const img = style === "custom" ? this.customBg : this.images[style] || this.cover || this.images.cinematic;
    const punch = 1 + a.beatFlash * 0.05 * this.intensity + a.bass * 0.04 * this.intensity;
    const zoom = (1.14 + Math.sin(t * 0.07) * 0.07 + a.energy * 0.05) * punch;
    const ox = Math.sin(t * 0.05) * this.w * 0.03;
    const oy = Math.cos(t * 0.04) * this.h * 0.02;
    this._coverDraw(img, zoom, ox, oy);
  }

  _grade(style, a) {
    const { ctx, w, h } = this;
    const map = {
      cinematic: `rgba(10, 30, 50, ${0.28 + a.bass * 0.15})`,
      gold: `rgba(40, 18, 4, ${0.22 + a.mid * 0.18})`,
      neon: `rgba(80, 0, 90, ${0.18 + a.energy * 0.2})`,
      cosmos: `rgba(20, 0, 50, ${0.22 + a.treble * 0.16})`,
      ocean: `rgba(0, 30, 40, ${0.22 + a.mid * 0.14})`,
      fire: `rgba(60, 8, 0, ${0.2 + a.bass * 0.22})`,
      romance: `rgba(50, 10, 20, ${0.22 + a.mid * 0.16})`,
      custom: `rgba(0,0,0,${0.22 + a.bass * 0.12})`,
    };
    ctx.fillStyle = map[style] || map.cinematic;
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 20, w * 0.5, h * 0.45, w * 0.58);
    const glow = GLOW[style] || "rgba(232,190,90,";
    g.addColorStop(0, `${glow}${0.1 + a.energy * 0.24 * this.intensity})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  _particles(style, a) {
    const { ctx, w, h } = this;
    const colors = {
      cinematic: "rgba(200,220,255,", gold: "rgba(240,210,130,",
      neon: "rgba(255,80,220,", cosmos: "rgba(230,230,255,",
      ocean: "rgba(160,255,230,", fire: "rgba(255,170,80,",
      romance: "rgba(255,200,190,", custom: "rgba(255,240,210,",
    };
    const col = colors[style] || colors.gold;
    const speed = (0.7 + a.energy * 2.6) * this.intensity;
    for (const p of this.particles) {
      p.x += p.vx * speed + (a.beat ? (Math.random() - 0.5) * 0.012 : 0);
      p.y += p.vy * speed * (0.6 + p.s);
      if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      if (p.x < -0.02) p.x = 1.02;
      if (p.x > 1.02) p.x = -0.02;
      const size = p.s * (1.2 + a.bass * 3) * (w / 900);
      ctx.fillStyle = `${col}${0.16 + p.z * 0.55 + a.energy * 0.18})`;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _spectrum(style, a) {
    const { ctx, w, h } = this;
    if (!a.freq) return;
    const cx = w / 2;
    const cy = h * (this.ratio === "9:16" ? 0.42 : 0.46);
    const base = Math.min(w, h) * (this.lyrics?.length ? 0.12 : 0.155);
    const bins = 64;
    const step = Math.max(1, Math.floor(a.freq.length / bins));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = Math.max(1.4, w / 720);
    ctx.lineCap = "round";
    for (let i = 0; i < bins; i++) {
      const v = a.freq[i * step] / 255;
      const len = base * 0.12 + v * base * (1.05 + a.beatFlash * 0.35) * this.intensity;
      const ang = (i / bins) * Math.PI * 2 - Math.PI / 2;
      ctx.globalAlpha = 0.18 + v * 0.62;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * base, Math.sin(ang) * base);
      ctx.lineTo(Math.cos(ang) * (base + len), Math.sin(ang) * (base + len));
      ctx.stroke();
    }
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(0, 0, base * (0.7 + a.bass * 0.1), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _beatFlash(a) {
    if (a.beatFlash < 0.02) return;
    const { ctx, w, h } = this;
    ctx.fillStyle = `rgba(255,255,255,${a.beatFlash * 0.08 * this.intensity})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(255,230,180,${a.beatFlash * 0.32})`;
    ctx.lineWidth = 8 * a.beatFlash;
    ctx.strokeRect(10, 10, w - 20, h - 20);
  }

  _vignette() {
    const { ctx, w, h } = this;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.66)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  _letterbox(style) {
    if (this.ratio === "9:16") return;
    const { ctx, w, h } = this;
    const bar = style === "cinematic" || style === "gold" ? h * 0.085 : h * 0.05;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  }

  _rays(style, a) {
    if (a.energy < 0.38 && a.beatFlash < 0.2) return;
    const { ctx, w, h } = this;
    ctx.save();
    ctx.translate(w / 2, h * 0.42);
    ctx.globalCompositeOperation = "lighter";
    const n = 7;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (a.t || 0) * 0.12;
      ctx.rotate(ang);
      const g = ctx.createLinearGradient(0, 0, 0, h * 0.45);
      g.addColorStop(0, `rgba(255,230,180,${0.035 + a.beatFlash * 0.08})`);
      g.addColorStop(1, "rgba(255,230,180,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-18, h * 0.42);
      ctx.lineTo(18, h * 0.42);
      ctx.fill();
      ctx.rotate(-ang);
    }
    ctx.restore();
  }

  _coverBadge(t, a) {
    if (!this.cover || (this.introCard && t < 3.2)) return;
    const { ctx, w, h } = this;
    const s = Math.min(w, h) * 0.11;
    const x = this.ratio === "9:16" ? w * 0.08 : w * 0.07;
    const y = this.ratio === "9:16" ? h * 0.1 : h * 0.14;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.cover, x, y, s, s);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _wrap(text, maxW, font) {
    const key = font + "|" + maxW + "|" + text;
    if (this._wrapCache.has(key)) return this._wrapCache.get(key);
    const { ctx } = this;
    ctx.font = font;
    const words = text.split(/\s+/);
    const lines = [];
    let cur = "";
    const pushLong = (token) => {
      let piece = "";
      for (const ch of [...token]) {
        const test = piece + ch;
        if (ctx.measureText(test).width > maxW && piece) {
          lines.push(piece);
          piece = ch;
        } else piece = test;
      }
      if (piece) cur = piece;
    };
    for (const word of words) {
      const test = cur ? cur + " " + word : word;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = "";
        if (ctx.measureText(word).width > maxW) pushLong(word);
        else cur = word;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    const out = lines.slice(0, 4);
    this._wrapCache.set(key, out);
    if (this._wrapCache.size > 80) this._wrapCache.clear();
    return out;
  }

  _lyrics(t, a) {
    if (!this.lyrics?.length) return;
    const hit = currentLyric(this.lyrics, t);
    if (!hit.current) return;
    const { ctx, w, h } = this;
    const fade = Math.min(1, hit.p * 8) * Math.min(1, (1 - hit.p) * 10 + 0.55);
    const chorus = a.section?.type === "chorus" ? 1.12 : 1;
    const size = Math.round(Math.min(w, h) * 0.042 * this.lyricScale * chorus);
    const font = `800 ${size}px ${this.fontFamily}, Cairo, sans-serif`;
    const maxW = w * 0.82;
    const rows = this._wrap(hit.current.text, maxW, font);
    const yBase = this.ratio === "9:16" ? h * 0.72 : h * 0.74;
    ctx.save();
    ctx.textAlign = "center";
    ctx.direction = "rtl";

    if (this.lyricStyle === "cinematic") {
      const boxH = rows.length * size * 1.25 + 28;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, yBase - size - 16, w, boxH);
    }

    if (this.lyricStyle === "elegant") {
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = 0.7 * fade;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(w * 0.3, yBase + rows.length * size * 0.7);
      ctx.lineTo(w * 0.7, yBase + rows.length * size * 0.7);
      ctx.stroke();
    }

    ctx.globalAlpha = fade;
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 18;
    rows.forEach((row, i) => {
      const y = yBase + i * size * 1.22;
      const scale = this.lyricStyle === "kinetic" ? 1 + a.beatFlash * 0.06 + Math.sin(t * 6) * 0.01 : 1;
      ctx.save();
      ctx.translate(w / 2, y);
      ctx.scale(scale, scale);
      ctx.font = font;
      if (this.lyricStyle === "karaoke") {
        ctx.fillStyle = "rgba(246,239,226,0.38)";
        ctx.fillText(row, 0, 0);
        ctx.fillStyle = this.accent;
        ctx.save();
        ctx.beginPath();
        const tw = ctx.measureText(row).width;
        ctx.rect(-tw / 2, -size, tw * Math.max(0.08, hit.p), size * 1.4);
        ctx.clip();
        ctx.fillText(row, 0, 0);
        ctx.restore();
      } else {
        ctx.fillStyle = "#f6efe2";
        ctx.fillText(row, 0, 0);
      }
      ctx.restore();
    });

    if (hit.next && this.lyricStyle === "karaoke") {
      ctx.globalAlpha = 0.28 * fade;
      ctx.shadowBlur = 0;
      ctx.font = `600 ${Math.round(size * 0.52)}px ${this.fontFamily}, Cairo, sans-serif`;
      ctx.fillStyle = "#f6efe2";
      ctx.fillText(hit.next.text, w / 2, yBase + rows.length * size * 1.25 + 10);
    }
    ctx.restore();
  }

  _titles(t, a) {
    if (!this.title && !this.artist) return;
    if (this.introCard && t < 3.2) return;
    const { ctx, w, h } = this;
    const fadeIn = Math.min(1, Math.max(0, (t - 3.1) / 1.1));
    const fadeOut = a.dur ? Math.min(1, Math.max(0, (a.dur - t - 2.2) / 1.1)) : 1;
    const alpha = fadeIn * fadeOut * (this.lyrics?.length ? 0.55 : 1);
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.fillStyle = "#f6efe2";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 16;
    const titleSize = Math.round(Math.min(w, h) * 0.036);
    ctx.font = `800 ${titleSize}px ${this.fontFamily}, Cairo, sans-serif`;
    const y = this.ratio === "9:16" ? h * 0.9 : h * 0.9;
    if (this.title) ctx.fillText(this.title, w / 2, y);
    if (this.artist) {
      ctx.font = `600 ${Math.round(titleSize * 0.52)}px ${this.fontFamily}, Cairo, sans-serif`;
      ctx.fillStyle = this.accent;
      ctx.fillText(this.artist, w / 2, y + titleSize * 0.7);
    }
    ctx.restore();
  }

  _progress(t, a) {
    if (!a.dur) return;
    const { ctx, w, h } = this;
    const p = Math.min(1, t / a.dur);
    const y = h - (this.showLetterbox && this.ratio !== "9:16" ? h * 0.055 : 10);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(w * 0.08, y, w * 0.84, 3);
    ctx.fillStyle = this.accent;
    ctx.fillRect(w * 0.08, y, w * 0.84 * p, 3);
  }

  _cards(t, a) {
    const { ctx, w, h } = this;
    const intro = this.introCard && t < 3.4;
    const outro = this.endCard && a.dur && t > a.dur - 3.2;
    if (!intro && !outro) return;
    const local = intro ? t / 3.4 : 1 - (a.dur - t) / 3.2;
    const alpha = intro ? Math.min(1, t * 1.4) * Math.min(1, (3.4 - t) * 1.6) : Math.min(1, (a.dur - t) * 1.4);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = "rgba(5,3,8,0.62)";
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.fillStyle = this.accent;
    ctx.font = `700 ${Math.round(Math.min(w, h) * 0.028)}px Cairo, sans-serif`;
    ctx.fillText(intro ? "نَغَم" : "نَغَم", w / 2, h * 0.38);
    ctx.fillStyle = "#f6efe2";
    ctx.font = `800 ${Math.round(Math.min(w, h) * 0.062)}px ${this.fontFamily}, Cairo, sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 18;
    ctx.fillText(this.title || (intro ? "أغنية" : "شكرًا"), w / 2, h * 0.5);
    if (this.artist) {
      ctx.font = `600 ${Math.round(Math.min(w, h) * 0.032)}px Cairo, sans-serif`;
      ctx.fillStyle = this.accent;
      ctx.fillText(this.artist, w / 2, h * 0.5 + Math.min(w, h) * 0.06);
    }
    if (this.cover) {
      const s = Math.min(w, h) * 0.16;
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.28, s / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(this.cover, w / 2 - s / 2, h * 0.28 - s / 2, s, s);
      ctx.restore();
    }
    ctx.restore();
  }

  _grainOverlay() {
    const { ctx, w, h } = this;
    if (!this._pattern) {
      try { this._pattern = ctx.createPattern(this.grain, "repeat"); } catch { return; }
    }
    if (!this._pattern) return;
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = this._pattern;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
}
