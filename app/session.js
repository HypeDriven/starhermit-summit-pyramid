/* Summit Pyramid — persistence (localStorage, versioned + checksummed) and optional server API. */

const SAVE_KEY = 'summit-pyramid-save-v1';
const SAVE_VERSION = 1;

function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    settings: {
      music: 60, fx: 80, amb: 50, captions: false,
      tier: 'medium', reducedMotion: false,
      highContrast: false, largeText: false, cvd: 'default',
      leftHanded: false, domBoard: false, tutorialDone: false
    },
    journey: { unlocked: 1, completed: {} },   // completed: {stageId: bestScore}
    achievements: {},                          // id -> timestamp
    best: {},                                  // modeKey -> {score, seed}
    stats: { wins: 0, losses: 0, streak: 0, totalPairs: 0 },
    snapshot: null                             // resumable last game
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const doc = JSON.parse(raw);
    if (!doc || doc.version !== SAVE_VERSION || doc.check !== checksum(doc.payload)) return defaultSave();
    return Object.assign(defaultSave(), JSON.parse(doc.payload));
  } catch (e) { return defaultSave(); }
}

export function storeSave(save) {
  try {
    const payload = JSON.stringify(save);
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, check: checksum(payload), payload }));
  } catch (e) { /* storage unavailable: guest session continues in memory */ }
}

/* ---- server API (optional; same-origin only, never breaks offline) ---- */

export class Api {
  constructor() { this.available = false; this.timeOffset = 0; }

  async detect() {
    try {
      const t0 = Date.now();
      const r = await fetch('/api/v1/time', { method: 'GET' });
      if (!r.ok) throw new Error('no api');
      const j = await r.json();
      const t1 = Date.now();
      this.timeOffset = j.now - Math.round((t0 + t1) / 2);
      this.available = true;
    } catch (e) { this.available = false; }
    return this.available;
  }

  now() { return Date.now() + this.timeOffset; }

  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('http-' + r.status));
    return j;
  }

  async submitScore(entry) {
    if (!this.available) return { local: true };
    return this.post('/api/v1/score/submit', entry);
  }

  async submitAchievement(id) {
    if (!this.available) return { local: true };
    return this.post('/api/v1/achievement', { id });
  }

  async leaderboards() {
    if (!this.available) return null;
    try {
      const r = await fetch('/api/v1/leaderboards');
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
}
