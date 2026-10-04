/* Summit Pyramid — persistence (localStorage, versioned + checksummed) and platform adapter.
 * Offline-first: the local save doc is the authoritative offline cache and local play
 * never touches the network. The Platform class is a thin adapter over window.StarHermit
 * (starhermit-sdk.js): launch token + renewal, sign-in, nickname, the game:<slug> cloud-save
 * slot (remote wins on start), settings KV, controls, invite link and the read-only platform
 * board. The game never calls its own server routes from the client: standalone play (any
 * host, loopback included) makes no network calls and uses the device clock. Launch tokens
 * are never persisted. */

const SAVE_KEY = 'summit-pyramid-save-v1';
const SAVE_VERSION = 1;
const CLOUD_DEBOUNCE_MS = 2000;
const SETTINGS_PUSH_MS = 800;
/* Preferences mirrored to the platform settings KV. */
export const PREF_KEYS = ['music', 'fx', 'amb', 'captions', 'gfx', 'reducedMotion', 'highContrast',
  'largeText', 'cvd', 'leftHanded', 'domBoard', 'tutorialDone'];
/* Keyboard actions (KeyboardEvent.code) — mirrors control.* in starhermit.txt. */
export const DEFAULT_BINDINGS = {
  prev: ['ArrowLeft', 'ArrowUp'], next: ['ArrowRight', 'ArrowDown'], confirm: ['Enter'],
  cancel: ['Escape'], undo: ['KeyU'], hint: ['KeyH'], draw: ['KeyD'], recycle: ['KeyR'], camera: ['KeyC'],
};

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
      gfx: { preset: 'auto' }, reducedMotion: false,
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

/* ---- platform adapter ---- */

export class Platform {
  constructor(sdk) {
    this.sh = sdk || (typeof globalThis !== 'undefined' ? globalThis.StarHermit : null) || null;
    this.nickname = null;
    this.syncState = 'offline';  // offline | saving | synced | error
    this.onSyncChange = null;
    this.onAuthChange = null;
    this._pushedPrefs = {};
    this._prefTimer = null;
  }

  /** True while a StarHermit launch token is held. */
  get hosted() { return !!(this.sh && this.sh.signedIn); }
  get userId() { return this.sh ? this.sh.userId : null; }

  async init() {
    if (this.sh) {
      this.sh.init();
      this.sh.on('auth', a => {
        if (!a.signedIn) { this.nickname = null; this._setSync('offline'); }
        if (this.onAuthChange) this.onAuthChange(a);
        if (this.onSyncChange) this.onSyncChange();
      });
      this.sh.on('saved', ok => this._setSync(ok ? 'synced' : 'error'));
    }
    if (this.hosted) {
      this.fetchAccountProfile().catch(() => {});
      const flush = () => { if (this.hosted) this.sh.flushSave(true); };
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    }
    return this;
  }

  canSignIn() { return !!(this.sh && this.sh.canSignIn()); }
  signIn() { return !!(this.sh && this.sh.signIn()); }
  inviteLink() { return this.hosted ? this.sh.inviteLink() : null; }

  now() { return Date.now(); }

  /* ---- identity (profile nickname; usernames never displayed, /api/v1/me never called) ---- */

  async fetchAccountProfile() {
    if (!this.hosted) return;
    const p = await this.sh.profile();
    this.nickname = p ? String(p.displayName).slice(0, 24) : null;
    if (this.onSyncChange) this.onSyncChange();
  }

  displayName() {
    if (this.nickname) return this.nickname;
    if (this.hosted && this.userId) return 'Player ' + String(this.userId).slice(0, 6);
    return null;
  }

  async nicknameFor(userId) {
    if (!userId) return 'Player';
    const p = await this.sh.profile(userId);
    return p ? String(p.displayName).slice(0, 24) : 'Player';
  }

  statusLine() {
    if (this.hosted) {
      const sync = {
        synced: 'cloud synced', saving: 'saving to cloud…',
        error: 'cloud sync error — will retry', offline: 'offline'
      }[this.syncState] || 'cloud synced';
      return 'Signed in as ' + (this.displayName() || '…') + ' · ' + sync;
    }
    return 'Local play — fully offline-capable';
  }

  /* ---- cloud save: the game:<slug> slot mirrors the local doc ---- */

  _setSync(state) {
    if (this.syncState === state) return;
    this.syncState = state;
    if (this.onSyncChange) this.onSyncChange();
  }

  queueCloudSave(save) {
    if (!this.hosted) return;
    this._setSync('saving');
    this.sh.saveJSON(save, CLOUD_DEBOUNCE_MS);
  }

  flushCloudSave() { return this.hosted ? this.sh.flushSave(true) : Promise.resolve(false); }

  async pullCloudSave() {
    if (!this.hosted) return null;
    const doc = await this.sh.loadJSON();
    this._setSync('synced');
    return (doc && doc.version === SAVE_VERSION) ? doc : null;
  }

  /* ---- settings KV + controls ---- */

  async loadPlatformSettings(local) {
    if (!this.hosted) return null;
    const remote = await this.sh.getSettings();
    const patch = {};
    for (const k of PREF_KEYS) if (remote && remote[k] != null) patch[k] = remote[k];
    this._pushedPrefs = Object.assign(pickPrefs(local), patch);
    return patch;
  }

  pushSettings(s) {
    if (!this.hosted) return;
    clearTimeout(this._prefTimer);
    this._prefTimer = setTimeout(() => {
      const prefs = pickPrefs(s), diff = {};
      for (const k of PREF_KEYS) {
        if (JSON.stringify(prefs[k]) !== JSON.stringify(this._pushedPrefs[k])) diff[k] = prefs[k] == null ? null : prefs[k];
      }
      if (!Object.keys(diff).length) return;
      Object.assign(this._pushedPrefs, diff);
      this.sh.patchSettings(diff);
    }, SETTINGS_PUSH_MS);
  }

  /** Effective bindings: platform overrides win when signed in. */
  async loadBindings() {
    if (!this.hosted) return cloneBindings(DEFAULT_BINDINGS);
    return this.sh.loadBindings(DEFAULT_BINDINGS);
  }

  /* ---- leaderboards ----
   * Hosted: read-only platform board (clients can never submit scores). */

  async boardEntries(friends) {
    const r = await this.sh.leaderboard(null, { pageSize: 20, scope: friends ? 'friends' : undefined });
    if (!r || !r.board) return null;
    const entries = [];
    for (const e of r.items || []) {
      entries.push({
        name: await this.nicknameFor(e.userId),
        me: e.userId === this.userId,
        score: e.score != null ? e.score : (e.value || 0)
      });
    }
    return entries;
  }
}

function pickPrefs(s) {
  const out = {};
  for (const k of PREF_KEYS) if (s && s[k] !== undefined) out[k] = s[k];
  return out;
}
function cloneBindings(b) {
  const out = {};
  for (const k of Object.keys(b)) out[k] = b[k].slice();
  return out;
}
