// Sound, as the browser build's app/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, alternating between
// each event's clips, and during a round the ambience (low-passed noise at
// 320 Hz with a 55 Hz hum, on the old ambience bus) and the quiet adaptive
// pad (every 0.9 s a sine note from the A minor pentatonic scale, an octave
// up and denser when fewer than ten cards are left, and a low triangle note
// every eighth step). The runtime has no ambience bus, so the ambience
// plays on the music bus at the old ambience-to-effects ratio, and the
// notes at the music-to-effects ratio (the old buses' 0.25, 0.35 and 0.6).
// The ambience loop and every note are rendered once into clips
// (OfflineAudioContext); the notes are started on the fixed-step clock (main.ts
// calls tick). The synthesized stand-ins audio.js played while a sample loaded
// are not ported: a clip still loading is silent. The runtime's Options own the
// volumes and the mute. Clips load and renders start at once; the beds start
// once the mixer runs (in a browser, after the first press).
import { OfflineAudioContext, SoundBank, context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

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
const banks = new Map<string, SoundBank>();

/** Loads every clip and renders the beds at once (onStart); a cue whose clips are still loading is skipped. */
export function loadSfx(): void {
  for (const [ev, names] of Object.entries(SAMPLES)) {
    void Promise.all(names.map((n) => loadClip(`sfx/${n}.opus`).catch((e: unknown) => { console.warn(`sfx ${n}: ${e instanceof Error ? e.message : String(e)}`); return null; }))).then((loaded) => {
      const list = loaded.filter((c) => c !== null);
      if (list.length) banks.set(ev, new SoundBank({ clips: list, order: "sequence", bus: "effects" })); // each event alternates between its clips
    });
  }
  void renderSynthesis();
}
export function play(ev: Sfx): void {
  try { banks.get(ev)?.play(); } catch { /* the mixer is full this frame */ }
}

// ---- rendered synthesis -------------------------------------------------------------------------
const RATE = 22050;
/** audio.js tone()s: exponential attack to `gain` in 12 ms, exponential decay to silence at `dur`. All of a kind laid end to end in one render, then cut into clips: a finished context still counts against the engine's 16 until the collector finds it. */
async function renderTones(list: { name: string; freq: number }[], dur: number, type: "sine" | "triangle", gain: number): Promise<void> {
  const slot = dur + 0.02, n = Math.round(RATE * slot);
  const off = new OfflineAudioContext(1, n * list.length, RATE);
  list.forEach(({ freq }, i) => {
    const at = (n * i) / RATE;
    const osc = off.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const g = off.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(off.destination); osc.start(at); osc.stop(at + dur);
  });
  const r = (await off.startRendering()).getChannelData(0);
  list.forEach(({ name }, i) => notes.set(name, createClip([r.slice(n * i, n * (i + 1))], RATE)));
}
const SCALE = [220, 262, 294, 330, 392, 440];
const notes = new Map<string, AudioClip>();
let ambClip: AudioClip | null = null;
/** Ambience: 4 s of noise through a 320 Hz low-pass (gain 0.5) and a 55 Hz sine (gain 0.25); 220 whole cycles and the noise's own 4 s loop repeat seamlessly once the filter settled. */
async function renderAmbience(): Promise<AudioClip> {
  const n = RATE * 4, settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ color: "white", seed: 0x5eed, seconds: 4 });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = 0; // the old RBJ Q 1 (this Q is in dB)
  const ng = off.createGain(); ng.gain.value = 0.5;
  noise.connect(lp).connect(ng).connect(off.destination); noise.start();
  const hum = off.createOscillator(); hum.frequency.value = 55;
  const hg = off.createGain(); hg.gain.value = 0.25;
  hum.connect(hg).connect(off.destination); hum.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}
async function renderSynthesis(): Promise<void> {
  try {
    ambClip = await renderAmbience();
    const pitches = [1, 2].flatMap((oct) => SCALE.map((f) => f * oct));
    await renderTones(pitches.map((p) => ({ name: `s${p}`, freq: p })), 1.6, "sine", 0.1);
    await renderTones(pitches.map((p) => ({ name: `t${p}`, freq: p / 2 })), 2.4, "triangle", 0.08);
  } catch (e) { console.warn(`audio: ${String(e)}`); }
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

/** Each frame: the ambience voice, once the mixer runs and its render is in. */
export function update(): void {
  if (context.state !== "running") return;
  if (ambWanted && ambClip && !ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: AMB / FX, loop: true }); } catch { ambVoice = null; }
  }
}
