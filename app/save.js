// save.js — Summit Pyramid's save model for the engine client (pure: no
// storage, no platform), shared by native/platform.ts and the node tests.
//
// The engine save (starhermit:storage `saves`, schema 1, on the device and in
// the player's cloud slot) is the document the browser build kept in
// localStorage (summit-pyramid-save-v1, checksummed) and mirrored to the
// cloud slot game:<slug> through the JS SDK's saveJSON:
//   { version: 1, settings, journey: { unlocked, completed }, achievements,
//     best, stats: { wins, losses, streak, totalPairs }, snapshot }
// `settings` keeps only tutorialDone now (volumes, graphics, reduced motion,
// contrast and larger text are the runtime's Options; captions, the colour-
// vision palette, the left-handed tray and the 2D board are engine settings).
// Two saves merge as the browser build merged them after a save conflict
// (session.js mergeSaves: never remote-wins; the larger of each counter, the
// earliest achievement, this device's resumable game first). readForeign()
// reads the old cloud slot's text (plain JSON).

const SAVE_VERSION = 1;
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const num = (v) => (Number.isFinite(+v) ? +v : 0);

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    settings: { tutorialDone: false },
    journey: { unlocked: 1, completed: {} },   // completed: {stageId: bestScore}
    achievements: {},                          // id -> timestamp
    best: {},                                  // modeKey -> {score, seed}
    stats: { wins: 0, losses: 0, streak: 0, totalPairs: 0 },
    snapshot: null,                            // resumable last game
  };
}

/** A save document from anything (missing or broken fields from the default one). */
export function normalize(raw) {
  const d = obj(raw);
  const out = defaultSave();
  out.settings.tutorialDone = obj(d.settings).tutorialDone === true;
  const j = obj(d.journey);
  out.journey.unlocked = Math.max(1, Math.min(40, Math.floor(num(j.unlocked)) || 1));
  for (const [k, v] of Object.entries(obj(j.completed))) if (Number.isFinite(v)) out.journey.completed[k] = v;
  for (const [k, v] of Object.entries(obj(d.achievements))) if (v) out.achievements[k] = num(v) || 1;
  for (const [k, v] of Object.entries(obj(d.best))) if (v && Number.isFinite(v.score)) out.best[k] = { score: v.score, seed: num(v.seed) };
  const s = obj(d.stats);
  for (const k of Object.keys(out.stats)) out.stats[k] = Math.max(0, Math.floor(num(s[k])));
  const snap = d.snapshot;
  out.snapshot = snap && typeof snap === 'object' && snap.cfg && snap.state && Array.isArray(snap.state.pyramid) ? JSON.parse(JSON.stringify(snap)) : null;
  return out;
}

/** session.js mergeSaves(a, b): this device's (a) first, never remote-wins. */
export function mergeSaves(a, b) {
  const A = normalize(a), B = normalize(b);
  const completed = { ...A.journey.completed };
  for (const [k, v] of Object.entries(B.journey.completed)) if (completed[k] == null || num(v) > num(completed[k])) completed[k] = v;
  const achievements = { ...A.achievements };
  for (const [k, v] of Object.entries(B.achievements)) if (!achievements[k] || (v && v < achievements[k])) achievements[k] = v;
  const best = { ...A.best };
  for (const [k, v] of Object.entries(B.best)) if (!best[k] || num(v.score) > num(best[k].score)) best[k] = v;
  const games = (s) => num(s.wins) + num(s.losses);
  return normalize({
    version: SAVE_VERSION,
    settings: { tutorialDone: A.settings.tutorialDone || B.settings.tutorialDone },
    journey: { unlocked: Math.max(A.journey.unlocked, B.journey.unlocked), completed },
    achievements,
    best,
    stats: {
      wins: Math.max(A.stats.wins, B.stats.wins),
      losses: Math.max(A.stats.losses, B.stats.losses),
      streak: games(B.stats) > games(A.stats) ? B.stats.streak : A.stats.streak,
      totalPairs: Math.max(A.stats.totalPairs, B.stats.totalPairs),
    },
    snapshot: A.snapshot || B.snapshot || null,
  });
}

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
/** Same content, whatever the key order. */
export function sameSave(a, b) { return canonical(normalize(a)) === canonical(normalize(b)); }

/** The browser build's cloud slot text (the save document as JSON), or null when it is not one. */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const doc = JSON.parse(text);
    if (!doc || typeof doc !== 'object' || doc.version !== SAVE_VERSION) return null;
    return normalize(doc);
  } catch { return null; }
}

/**
 * The game's own options (engine `settings`, synced with the account) and the
 * browser build's settings KV keys (session.js PREF_KEYS) they came from.
 */
export const DEFAULT_OPTIONS = { captions: false, cvd: 'default', leftHanded: false, domBoard: false };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
export const PALETTES = ['default', 'deuter', 'tritan'];
export const BROWSER_KEYS = ['music', 'fx', 'amb', 'captions', 'gfx', 'reducedMotion', 'highContrast',
  'largeText', 'cvd', 'leftHanded', 'domBoard', 'tutorialDone'];

/** Valid option values from anything. */
export function pickOptions(raw) {
  const r = obj(raw);
  const out = {};
  if (typeof r.captions === 'boolean') out.captions = r.captions;
  if (PALETTES.includes(r.cvd)) out.cvd = r.cvd;
  if (typeof r.leftHanded === 'boolean') out.leftHanded = r.leftHanded;
  if (typeof r.domBoard === 'boolean') out.domBoard = r.domBoard;
  return out;
}

/** The browser build's settings KV (key → value) as { options, tutorialDone }. */
export function readLegacySettings(kv) {
  const k = obj(kv);
  return { options: pickOptions(k), tutorialDone: k.tutorialDone === true };
}
