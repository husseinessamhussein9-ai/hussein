export const STYLES = [
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

export class VisualEngine {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.images = {};
    this.particles = [];
    this.style = "cinematic";
    this.title = "";
    this.artist = "";
    this.ratio = "16:9";
    this.w = 1280;
    this.h = 720;
    this.grain = this._makeGrain();
    this._initParticles(220);
  }

  async preload() {
    const entries = Object.entries(BG_SRC);
    await Promise.all(entries.map(([k, src]) => this._load(k, src)));
  }

  _load(key, src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.images[key] = img;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  setSize(ratio, quality = "720") {
    this.ratio = ratio;
    const long = quality === "1080" ? 1920 : 1280;
    if (ratio === "9:16") {
      this.w = quality === "1080" ? 1080 : 720;
      this.h = quality === "1080" ? 1920 : 1280;
    } else if (ratio === "1:1") {
      this.w = quality === "1080" ? 1080 : 720;
      this.h = this.w;
    } else {
      this.w = long;
      this.h = Math.round(long * 9 / 16);
    }
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }

  setMeta({ title, artist, style }) {
    if (title != null) this.title = title;
    if (artist != null) this.artist = artist;
    if (style) this.style = style;
  }

  _initParticles(n) {
    this.particles = Array.from({ length: n }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: Math.random(),
      s: 0.4 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 0.0008,
      vy: -0.0004 - Math.random() * 0.0014,
    }));
  }

  _makeGrain() {
    const c = document.createElement("canvas");
    c.width = 180;
    c.height = 180;
    const g = c.getContext("2d");
    const img = g.createImageData(180, 180);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 80 + Math.random() * 140;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 28;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  draw(audio, clock = 0) {
    const { ctx, w, h } = this;
    const t = audio.t || clock;
    const style = this.style === "auto" ? "cinematic" : this.style;
    ctx.fillStyle = "#050308";
    ctx.fillRect(0, 0, w, h);

    this._kenBurns(style, t, audio);
    this._grade(style, audio);
    this._particles(style, audio);
    this._spectrum(style, audio);
    this._beatFlash(audio);
    this._vignette();
    this._letterbox(style);
    this._titles(t, audio);
    this._grainOverlay();
  }

  _cover(img, zoom, ox, oy) {
    const { ctx, w, h } = this;
    if (!img) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.max(w / iw, h / ih) * zoom;
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2 + ox, (h - dh) / 2 + oy, dw, dh);
  }

  _kenBurns(style, t, a) {
    const img = this.images[style];
    const punch = 1 + a.beatFlash * 0.045 + a.bass * 0.04;
    const zoom = (1.12 + Math.sin(t * 0.07) * 0.06 + a.energy * 0.05) * punch;
    const ox = Math.sin(t * 0.05) * this.w * 0.03;
    const oy = Math.cos(t * 0.04) * this.h * 0.02;
    this._cover(img, zoom, ox, oy);
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
    };
    ctx.fillStyle = map[style] || map.cinematic;
    ctx.fillRect(0, 0, w, h);

    const g = ctx.createRadialGradient(w * 0.5, h * 0.4, 20, w * 0.5, h * 0.45, w * 0.55);
    const glow = {
      cinematic: "rgba(80,160,220,",
      gold: "rgba(232,190,90,",
      neon: "rgba(255,60,200,",
      cosmos: "rgba(170,120,255,",
      ocean: "rgba(80,230,190,",
      fire: "rgba(255,90,30,",
      romance: "rgba(255,140,150,",
    }[style] || "rgba(232,190,90,";
    g.addColorStop(0, `${glow}${0.08 + a.energy * 0.22})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  _particles(style, a) {
    const { ctx, w, h } = this;
    const colors = {
      cinematic: "rgba(200,220,255,",
      gold: "rgba(240,210,130,",
      neon: "rgba(255,80,220,",
      cosmos: "rgba(230,230,255,",
      ocean: "rgba(160,255,230,",
      fire: "rgba(255,170,80,",
      romance: "rgba(255,200,190,",
    };
    const col = colors[style] || colors.gold;
    const speed = 0.7 + a.energy * 2.4;
    for (const p of this.particles) {
      p.x += p.vx * speed + (a.beat ? (Math.random() - 0.5) * 0.01 : 0);
      p.y += p.vy * speed * (0.6 + p.s);
      if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      if (p.x < -0.02) p.x = 1.02;
      if (p.x > 1.02) p.x = -0.02;
      const size = p.s * (1.2 + a.bass * 3) * (w / 900);
      ctx.fillStyle = `${col}${0.18 + p.z * 0.55 + a.energy * 0.2})`;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _spectrum(style, a) {
    const { ctx, w, h } = this;
    if (!a.freq) return;
    const cx = w / 2;
    const cy = h * (this.ratio === "9:16" ? 0.46 : 0.5);
    const base = Math.min(w, h) * 0.16;
    const bins = 72;
    const step = Math.max(1, Math.floor(a.freq.length / bins));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1.4, w / 700);
    ctx.lineCap = "round";
    for (let i = 0; i < bins; i++) {
      const v = a.freq[i * step] / 255;
      const len = base * 0.15 + v * base * (1.15 + a.beatFlash * 0.4);
      const ang = (i / bins) * Math.PI * 2 - Math.PI / 2;
      ctx.globalAlpha = 0.22 + v * 0.65;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * base, Math.sin(ang) * base);
      ctx.lineTo(Math.cos(ang) * (base + len), Math.sin(ang) * (base + len));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, base * (0.72 + a.bass * 0.12), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    if (style === "neon" || style === "fire") {
      this._bottomWave(a);
    }
  }

  _bottomWave(a) {
    const { ctx, w, h } = this;
    if (!a.time) return;
    ctx.beginPath();
    const y0 = h * 0.78;
    for (let i = 0; i < a.time.length; i += 4) {
      const x = (i / a.time.length) * w;
      const y = y0 + ((a.time[i] - 128) / 128) * h * 0.08 * (0.5 + a.energy);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  _beatFlash(a) {
    if (a.beatFlash < 0.02) return;
    const { ctx, w, h } = this;
    ctx.fillStyle = `rgba(255,255,255,${a.beatFlash * 0.1})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(255,230,180,${a.beatFlash * 0.35})`;
    ctx.lineWidth = 10 * a.beatFlash;
    ctx.strokeRect(8, 8, w - 16, h - 16);
  }

  _vignette() {
    const { ctx, w, h } = this;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  _letterbox(style) {
    if (this.ratio === "9:16") return;
    const { ctx, w, h } = this;
    const bar = style === "cinematic" || style === "gold" ? h * 0.09 : h * 0.055;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  }

  _titles(t, a) {
    const { ctx, w, h } = this;
    if (!this.title && !this.artist) return;
    const fadeIn = Math.min(1, Math.max(0, (t - 0.4) / 1.4));
    const fadeOut = a.dur ? Math.min(1, Math.max(0, (a.dur - t - 0.3) / 1.2)) : 1;
    const alpha = fadeIn * fadeOut;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.fillStyle = "#f6efe2";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 18;
    const titleSize = Math.round(Math.min(w, h) * 0.048);
    ctx.font = `800 ${titleSize}px Cairo, sans-serif`;
    const y = this.ratio === "9:16" ? h * 0.8 : h * 0.82;
    if (this.title) ctx.fillText(this.title, w / 2, y);
    if (this.artist) {
      ctx.font = `600 ${Math.round(titleSize * 0.48)}px Cairo, sans-serif`;
      ctx.fillStyle = "rgba(224,179,90,0.95)";
      ctx.fillText(this.artist, w / 2, y + titleSize * 0.7);
    }
    ctx.restore();
  }

  _grainOverlay() {
    const { ctx, w, h } = this;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = ctx.createPattern(this.grain, "repeat");
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
}
