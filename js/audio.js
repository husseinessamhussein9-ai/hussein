export const MOODS = {
  fire: { ar: "طاقة", style: "fire" },
  neon: { ar: "إلكتروني", style: "neon" },
  gold: { ar: "فخم", style: "gold" },
  romance: { ar: "رومانسي", style: "romance" },
  cinematic: { ar: "سينمائي", style: "cinematic" },
  cosmos: { ar: "فضائي", style: "cosmos" },
  ocean: { ar: "هادئ", style: "ocean" },
};

export class AudioEngine {
  constructor(audioEl) {
    this.el = audioEl;
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this.gain = null;
    this.recordDest = null;
    this.freq = null;
    this.time = null;
    this.energyHist = [];
    this.beat = false;
    this.beatFlash = 0;
    this.bpm = 0;
    this.mood = "cinematic";
    this.energy = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.ready = false;
    this._lastBeat = 0;
    this.sections = [];
    this.envelope = [];
  }

  async setup() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.source = this.ctx.createMediaElementSource(this.el);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    this.gain = this.ctx.createGain();
    this.recordDest = this.ctx.createMediaStreamDestination();
    this.source.connect(this.analyser);
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.analyser.connect(this.recordDest);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Uint8Array(this.analyser.fftSize);
    this.ready = true;
  }

  async resume() {
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  sample() {
    if (!this.ready) return this._empty();
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);
    const n = this.freq.length;
    const band = (a, b) => {
      let s = 0;
      const start = Math.floor(a * n);
      const end = Math.max(start + 1, Math.floor(b * n));
      for (let i = start; i < end; i++) s += this.freq[i];
      return s / (end - start) / 255;
    };
    this.bass = band(0, 0.06);
    this.mid = band(0.06, 0.28);
    this.treble = band(0.28, 0.7);
    this.energy = this.bass * 0.55 + this.mid * 0.3 + this.treble * 0.15;
    this.energyHist.push(this.energy);
    if (this.energyHist.length > 48) this.energyHist.shift();
    const avg = this.energyHist.reduce((a, b) => a + b, 0) / this.energyHist.length;
    const now = performance.now();
    const minGap = this.bpm ? (60000 / this.bpm) * 0.62 : 220;
    this.beat = this.energy > avg * 1.28 && this.energy > 0.22 && now - this._lastBeat > minGap;
    if (this.beat) {
      this._lastBeat = now;
      this.beatFlash = 1;
    } else {
      this.beatFlash *= 0.88;
    }
    return {
      freq: this.freq,
      time: this.time,
      bass: this.bass,
      mid: this.mid,
      treble: this.treble,
      energy: this.energy,
      beat: this.beat,
      beatFlash: this.beatFlash,
      bpm: this.bpm,
      t: this.el.currentTime || 0,
      dur: this.el.duration || 0,
      section: this.sectionAt(this.el.currentTime || 0),
    };
  }

  _empty() {
    return {
      freq: new Uint8Array(1024),
      time: new Uint8Array(2048),
      bass: 0, mid: 0, treble: 0, energy: 0,
      beat: false, beatFlash: 0, bpm: 0, t: 0, dur: 0,
      section: { start: 0, end: 1, type: "verse", style: "cinematic", energy: 0 },
    };
  }

  async analyzeBuffer(arrayBuffer) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const offline = new Ctx();
    let decoded;
    try {
      decoded = await offline.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      this.bpm = 110;
      this.mood = "cinematic";
      this.energy = 0.4;
      return this.summary();
    }
    const ch = decoded.getChannelData(0);
    const sr = decoded.sampleRate;
    const step = Math.max(1, Math.floor(sr / 500));
    const env = [];
    for (let i = 0; i < ch.length; i += step) {
      let s = 0;
      const end = Math.min(ch.length, i + step);
      for (let j = i; j < end; j++) s += ch[j] * ch[j];
      env.push(Math.sqrt(s / (end - i)));
    }
    let sum = 0;
    for (const v of env) sum += v;
    const mean = sum / env.length || 0.001;
    const peaks = [];
    for (let i = 2; i < env.length - 2; i++) {
      if (env[i] > mean * 1.45 && env[i] > env[i - 1] && env[i] > env[i + 1]) {
        peaks.push(i);
      }
    }
    const gaps = [];
    for (let i = 1; i < peaks.length; i++) {
      const g = (peaks[i] - peaks[i - 1]) * (step / sr);
      if (g > 0.28 && g < 1.05) gaps.push(g);
    }
    if (gaps.length > 6) {
      const hist = {};
      for (const g of gaps) {
        const bpm = Math.round(60 / g);
        const folded = bpm < 75 ? bpm * 2 : bpm > 180 ? Math.round(bpm / 2) : bpm;
        const key = Math.round(folded / 2) * 2;
        hist[key] = (hist[key] || 0) + 1;
      }
      this.bpm = Number(Object.entries(hist).sort((a, b) => b[1] - a[1])[0][0]);
    } else {
      this.bpm = 108;
    }

    const third = Math.floor(env.length / 3);
    const sliceAvg = (a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += env[i];
      return s / Math.max(1, b - a);
    };
    const e1 = sliceAvg(0, third);
    const e2 = sliceAvg(third, third * 2);
    const e3 = sliceAvg(third * 2, env.length);
    const overall = (e1 + e2 + e3) / 3;
    this.energy = Math.min(1, overall * 6);

    const variance = env.reduce((s, v) => s + (v - mean) ** 2, 0) / env.length;
    const punchy = Math.sqrt(variance) / (mean + 1e-6);

    if (this.energy > 0.62 && punchy > 0.7) this.mood = "fire";
    else if (this.bpm >= 122 && this.energy > 0.45) this.mood = "neon";
    else if (this.energy < 0.28) this.mood = "ocean";
    else if (this.bpm < 92 && this.energy < 0.42) this.mood = "romance";
    else if (this.energy > 0.38 && this.energy < 0.58 && this.bpm < 118) this.mood = "gold";
    else if (this.bpm > 118 && this.energy < 0.5) this.mood = "cosmos";
    else this.mood = "cinematic";

    this._buildSections(env, step / sr, decoded.duration);
    offline.close?.();
    return this.summary();
  }

  _buildSections(env, dt, duration) {
    const win = Math.max(1, Math.round(1.6 / dt));
    const smooth = [];
    for (let i = 0; i < env.length; i += win) {
      let s = 0;
      let n = 0;
      for (let j = i; j < Math.min(env.length, i + win); j++, n++) s += env[j];
      smooth.push({ t: i * dt, e: s / Math.max(1, n) });
    }
    this.envelope = smooth;
    const vals = smooth.map((x) => x.e).sort((a, b) => a - b);
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] || 0;
    const hi = q(0.72);
    const lo = q(0.32);
    const styles = ["cinematic", "gold", "romance", "ocean", "cosmos", "neon", "fire"];
    const chunks = [];
    let cur = null;
    for (const s of smooth) {
      let type = "verse";
      let style = this.mood;
      if (s.t < 8) {
        type = "intro";
        style = this.mood === "fire" ? "cinematic" : this.mood;
      } else if (duration - s.t < 10) {
        type = "outro";
        style = "cinematic";
      } else if (s.e >= hi) {
        type = "chorus";
        style = this.energy > 0.55 ? "fire" : "gold";
      } else if (s.e <= lo) {
        type = "break";
        style = this.bpm > 118 ? "cosmos" : "ocean";
      } else {
        style = styles[Math.floor((s.t / Math.max(1, duration)) * styles.length) % styles.length];
      }
      if (!cur || cur.type !== type) {
        if (cur) {
          cur.end = s.t;
          chunks.push(cur);
        }
        cur = { start: s.t, end: s.t, type, style, energy: s.e };
      } else {
        cur.end = s.t;
        cur.energy = (cur.energy + s.e) / 2;
      }
    }
    if (cur) {
      cur.end = duration;
      chunks.push(cur);
    }
    this.sections = chunks.filter((c) => c.end - c.start > 1.2);
    if (!this.sections.length) {
      this.sections = [{ start: 0, end: duration || 1, type: "verse", style: this.mood, energy: this.energy }];
    }
  }

  sectionAt(t) {
    const s = this.sections.find((x) => t >= x.start && t < x.end);
    return s || this.sections[this.sections.length - 1] || {
      start: 0, end: 1, type: "verse", style: this.mood, energy: this.energy,
    };
  }

  summary() {
    return {
      bpm: this.bpm,
      mood: this.mood,
      moodAr: MOODS[this.mood]?.ar || "سينمائي",
      energy: this.energy,
      duration: this.el.duration || 0,
      sections: this.sections.length,
    };
  }
}
