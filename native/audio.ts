// Sound, as the browser build's app/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, alternating between
// each event's clips, and during a round the ambience (low-passed noise at
// 320 Hz with a 55 Hz hum, on the old ambience bus) and the quiet adaptive
// pad (every 0.9 s a sine note from the A minor pentatonic scale, an octave
// up and denser when fewer than ten cards are left, and a low triangle note
// every eighth step). The runtime has no ambience bus, so the ambience
// plays on the music bus at the old ambience-to-effects ratio, and the
// notes at the music-to-effects ratio (the old buses' 0.25, 0.35 and 0.6).
// The ambience loop and every note are rendered once into clips (a sine
// table, a slice a frame: per-sample Math.sin is slow natively); the notes
// are started on the fixed-step clock (main.ts calls tick). The synthesized
// stand-ins audio.js played while a sample loaded are not ported (a live
// synthesis graph makes clip loads fail on the web runtime): a clip still
// loading is silent. The runtime's Options own the volumes and the mute.
// Clips load once the mixer runs (natively at once, in a browser after the
// first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

/** audio.js SFX_EVENTS. */
const SAMPLES: Record<string, string[]> = {
  select: ["card-select-1", "card-select-2"],
  deselect: ["card-deselect"],
  removePair: ["pair-remove-1", "pair-remove-2"],
  invalid: ["invalid-buzz"],
  draw: ["card-draw-1", "card-draw-2"],
  recycle: ["waste-recycle"],
  undo: ["undo-swoosh"],
  win: ["win-fanfare"],
  lose: ["lose-fall"],
};
export type Sfx = "select" | "deselect" | "removePair" | "invalid" | "draw" | "recycle" | "undo" | "win" | "lose";
const FX = 0.6, MUSIC = 0.35, AMB = 0.25; // the old bus gains at the default volumes' scale
const clips = new Map<string, AudioClip>();
const turn: Record<string, number> = {};
const queue: string[] = [];
let loading = false;
let wantClips = false;

export function loadSfx(): void { wantClips = true; }
export function play(ev: Sfx): void {
  const names = SAMPLES[ev]!;
  const i = (turn[ev] = ((turn[ev] ?? 0) + 1) % names.length);
  const clip = clips.get(names[i]!);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(names[i]!); if (!queue.includes(names[i]!)) queue.push(names[i]!); }
}

// ---- rendered synthesis -------------------------------------------------------------------------
const RATE = 22050;
const TABLE_N = 4096;
const SINE = new Float32Array(TABLE_N + 1);
for (let i = 0; i <= TABLE_N; i++) SINE[i] = Math.sin((i / TABLE_N) * Math.PI * 2);
const sineAt = (phase: number): number => { const p = (phase - Math.floor(phase)) * TABLE_N; const i = p | 0; return SINE[i]! + (SINE[i + 1]! - SINE[i]!) * (p - i); };
const triAt = (phase: number): number => { const p = phase - Math.floor(phase); return p < 0.25 ? p * 4 : p < 0.75 ? 2 - p * 4 : p * 4 - 4; };

interface Job { data: Float32Array; pos: number; fill: (i: number) => number; done: (c: AudioClip) => void }
const jobs: Job[] = [];
function job(n: number, fill: (i: number) => number, done: (c: AudioClip) => void): void { jobs.push({ data: new Float32Array(n), pos: 0, fill, done }); }

/** audio.js tone(): exponential attack to `gain` in 12 ms, exponential decay to silence at `dur`. */
function toneFill(freq: number, dur: number, type: "sine" | "triangle", gain: number): (i: number) => number {
  const a = 0.012, lo = 0.0001;
  const na = Math.round(a * RATE), nd = Math.round(dur * RATE);
  const up = Math.pow(gain / lo, 1 / na), down = Math.pow(lo / gain, 1 / Math.max(1, nd - na));
  let env = lo; // samples arrive in order: the envelope steps by a constant ratio
  return (i) => {
    env = i < na ? env * up : i < nd ? env * down : 0;
    const ph = (freq * i) / RATE;
    return (type === "sine" ? sineAt(ph) : triAt(ph)) * env;
  };
}
const SCALE = [220, 262, 294, 330, 392, 440];
const notes = new Map<string, AudioClip>();
let ambClip: AudioClip | null = null;
let queued = false;
function queueSynthesis(): void {
  if (queued) return;
  queued = true;
  // ambience: 4 s of noise through a 320 Hz low-pass (gain 0.5) and a 55 Hz sine (gain 0.25); 220 whole cycles loop seamlessly
  const n = RATE * 4;
  let seed = 0x5eed;
  const rand = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  // RBJ low-pass biquad at 320 Hz, Q 1 (Web Audio's default)
  const w0 = (2 * Math.PI * 320) / RATE, al = Math.sin(w0) / 2, cw = Math.cos(w0);
  const b0 = (1 - cw) / 2 / (1 + al), b1 = (1 - cw) / (1 + al), a1 = (-2 * cw) / (1 + al), a2 = (1 - al) / (1 + al);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < 2000; i++) { const x = rand(); const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; } // settle
  job(n, (i) => {
    const x = rand();
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y * 0.5 + sineAt((55 * i) / RATE) * 0.25;
  }, (c) => { ambClip = c; });
  for (const oct of [1, 2]) {
    for (const f of SCALE) {
      job(Math.round(RATE * 1.62), toneFill(f * oct, 1.6, "sine", 0.1), (c) => notes.set(`s${f * oct}`, c));
      job(Math.round(RATE * 2.42), toneFill((f * oct) / 2, 2.4, "triangle", 0.08), (c) => notes.set(`t${f * oct}`, c));
    }
  }
}
function runJobs(budget: number): void {
  let left = budget;
  while (jobs.length && left > 0) {
    const j = jobs[0]!;
    const end = Math.min(j.data.length, j.pos + left);
    for (let i = j.pos; i < end; i++) j.data[i] = j.fill(i);
    left -= end - j.pos;
    j.pos = end;
    if (j.pos >= j.data.length) {
      jobs.shift();
      try { j.done(createClip([j.data], RATE)); } catch (e) { console.warn(`audio: ${String(e)}`); }
    }
  }
}

// ---- the round's ambience and pad ---------------------------------------------------------------
let ambWanted = false;
let ambVoice: Sound | null = null;
let intensity = 0;
let step = 0;
let nextAt = 0;
/** audio.js startAmbience / stopAmbience (rounds only). */
export function startAmbience(now: number): void {
  if (!ambWanted) { step = 0; nextAt = now + 0.9; }
  ambWanted = true;
  queueSynthesis();
}
export function stopAmbience(): void {
  ambWanted = false;
  try { ambVoice?.stop(); } catch { /* gone */ }
  ambVoice = null;
}
export function setIntensity(v: number): void { intensity = Math.max(0, Math.min(1, v)); }
/** The pad's 900 ms steps on the fixed-step clock (seconds). */
export function tick(now: number): void {
  if (!ambWanted || now < nextAt || context.state !== "running") return;
  nextAt = now + 0.9;
  step++;
  const hi = intensity > 0.6;
  const n = SCALE[(step * 2 + Math.floor(step / 4)) % SCALE.length]! * (hi ? 2 : 1);
  const g = MUSIC / FX;
  if (step % (hi ? 2 : 3) === 0) { const c = notes.get(`s${n}`); if (c) try { playClip(c, { bus: "music", gain: g }); } catch { /* busy */ } }
  if (step % 8 === 4) { const c = notes.get(`t${n}`); if (c) try { playClip(c, { bus: "music", gain: g }); } catch { /* busy */ } }
}

/** Each frame: the clips once the mixer runs (one at a time), the synthesis slices, the ambience voice. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const list of Object.values(SAMPLES)) for (const n of list) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
  }
  runJobs(6000);
  if (ambWanted && ambClip && !ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: AMB / FX, loop: true }); } catch { ambVoice = null; }
  }
}
