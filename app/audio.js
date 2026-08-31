/* Summit Pyramid — WebAudio sound engine.
   Authored one-shot samples (sfx/manifest.json, fetched as sfx/<name>.opus)
   are preferred per event; the synthesized sounds remain as fallback while a
   sample is still loading or if it fails to load. */

/* Event -> authored sample basenames (see sfx/manifest.json). */
const SFX_EVENTS = {
  select: ['card-select-1', 'card-select-2'],
  deselect: ['card-deselect'],
  removePair: ['pair-remove-1', 'pair-remove-2'],
  invalid: ['invalid-buzz'],
  draw: ['card-draw-1', 'card-draw-2'],
  recycle: ['waste-recycle'],
  undo: ['undo-swoosh'],
  win: ['win-fanfare'],
  lose: ['lose-fall']
};

export class AudioEngine {
  constructor(settings, onCaption) {
    this.settings = settings;      // {music, fx, amb, captions} volumes 0..100
    this.onCaption = onCaption || (() => {});
    this.ctx = null;
    this.buses = {};
    this.ambNodes = null;
    this.musicTimer = null;
    this.intensity = 0;            // 0 calm .. 1 close to winning
    this.sfxCache = new Map();     // name -> {state: 'loading'|'ready'|'failed', buffer}
    this.sfxTurn = {};             // event -> round-robin variant index
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (this.started) this.ctx.resume();
    });
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    for (const name of ['music', 'fx', 'amb']) {
      const g = this.ctx.createGain();
      g.connect(this.ctx.destination);
      this.buses[name] = g;
    }
    this.applyVolumes();
    this.started = true;
    return true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.buses.music.gain.value = (this.settings.music / 100) * 0.35;
    this.buses.fx.gain.value = (this.settings.fx / 100) * 0.6;
    this.buses.amb.gain.value = (this.settings.amb / 100) * 0.25;
  }

  caption(text) { if (this.settings.captions && text) this.onCaption(text); }

  /* Lazy-fetch + decode sfx/<name>.opus (only after the gesture unlock in
     ensure() created the context). Result is cached in every state. */
  loadSample(name) {
    let rec = this.sfxCache.get(name);
    if (!rec) {
      rec = { state: 'loading', buffer: null };
      this.sfxCache.set(name, rec);
      fetch('sfx/' + name + '.opus')
        .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
        .then(ab => this.ctx.decodeAudioData(ab))
        .then(buf => { rec.state = 'ready'; rec.buffer = buf; })
        .catch(() => { rec.state = 'failed'; });
    }
    return rec;
  }

  /* Play the sample mapped to an event through the fx bus.
     Returns false while loading or on failure so the caller can synthesize. */
  playEvent(event) {
    const names = SFX_EVENTS[event];
    if (!names || !this.ctx) return false;
    const i = ((this.sfxTurn[event] || 0) + 1) % names.length;
    this.sfxTurn[event] = i;
    const rec = this.loadSample(names[i]);
    if (rec.state !== 'ready') return false;
    const src = this.ctx.createBufferSource();
    src.buffer = rec.buffer;
    src.connect(this.buses.fx);
    src.start();
    return true;
  }

  tone(bus, freq, dur, type, gain, when, slide) {
    const t0 = this.ctx.currentTime + (when || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.buses[bus]);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  noise(bus, dur, gain, when, freq) {
    const t0 = this.ctx.currentTime + (when || 0);
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1200;
    const g = this.ctx.createGain(); g.gain.value = gain || 0.15;
    src.connect(f); f.connect(g); g.connect(this.buses[bus]);
    src.start(t0);
  }

  select() { if (!this.ensure()) return; if (!this.playEvent('select')) this.tone('fx', 660, 0.09, 'triangle', 0.18); this.caption('select'); }
  deselect() { if (!this.ensure()) return; if (!this.playEvent('deselect')) this.tone('fx', 440, 0.07, 'triangle', 0.12); }
  removePair() {
    if (!this.ensure()) return;
    if (!this.playEvent('removePair')) {
      this.tone('fx', 523, 0.16, 'sine', 0.22);
      this.tone('fx', 784, 0.22, 'sine', 0.2, 0.07);
      this.noise('fx', 0.12, 0.06, 0, 2400);
    }
    this.caption('pair removed');
  }
  invalid() { if (!this.ensure()) return; if (!this.playEvent('invalid')) this.tone('fx', 130, 0.2, 'sawtooth', 0.16, 0, 90); this.caption('invalid move'); }
  draw() { if (!this.ensure()) return; if (!this.playEvent('draw')) { this.noise('fx', 0.1, 0.14, 0, 1800); this.tone('fx', 330, 0.08, 'triangle', 0.1, 0.02); } this.caption('card drawn'); }
  recycle() { if (!this.ensure()) return; if (!this.playEvent('recycle')) { this.noise('fx', 0.25, 0.14, 0, 900); this.tone('fx', 262, 0.3, 'triangle', 0.12, 0, 392); } this.caption('waste recycled'); }
  undo() { if (!this.ensure()) return; if (!this.playEvent('undo')) this.tone('fx', 392, 0.1, 'triangle', 0.14, 0, 262); this.caption('undo'); }
  win() {
    if (!this.ensure()) return;
    if (!this.playEvent('win'))
      [523, 659, 784, 1047].forEach((f, i) => this.tone('fx', f, 0.35, 'sine', 0.2, i * 0.12));
    this.caption('pyramid cleared — you win');
  }
  lose() {
    if (!this.ensure()) return;
    if (!this.playEvent('lose'))
      [392, 330, 262, 196].forEach((f, i) => this.tone('fx', f, 0.4, 'triangle', 0.16, i * 0.15));
    this.caption('no moves left — round over');
  }

  startAmbience() {
    if (!this.ensure() || this.ambNodes) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(f); f.connect(g); g.connect(this.buses.amb);
    src.start();
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
    const og = this.ctx.createGain(); og.gain.value = 0.25;
    o.connect(og); og.connect(this.buses.amb); o.start();
    this.ambNodes = { src, o };
    this.startMusic();
  }

  stopAmbience() {
    if (this.ambNodes) { try { this.ambNodes.src.stop(); this.ambNodes.o.stop(); } catch (e) {} this.ambNodes = null; }
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }

  /* Quiet adaptive pad: sparse notes, denser/higher as intensity rises. */
  startMusic() {
    if (this.musicTimer || !this.ctx) return;
    const scale = [220, 262, 294, 330, 392, 440];
    let step = 0;
    this.musicTimer = setInterval(() => {
      if (document.hidden) return;
      step++;
      const n = scale[(step * 2 + Math.floor(step / 4)) % scale.length] * (this.intensity > 0.6 ? 2 : 1);
      if (step % (this.intensity > 0.6 ? 2 : 3) === 0)
        this.tone('music', n, 1.6, 'sine', 0.10);
      if (step % 8 === 4)
        this.tone('music', n / 2, 2.4, 'triangle', 0.08);
    }, 900);
  }

  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }
}
