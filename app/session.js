/* Summit Pyramid — persistence (localStorage, versioned + checksummed) and platform adapter.
 * Offline-first: the local save doc is the authoritative offline cache and local play
 * never touches the network. Hosted (StarHermit) mode activates only when a launch
 * token was read from the URL; every platform call then carries the Bearer token, the
 * account nickname, and the single cloud-save slot mirrors the local doc (remote wins
 * on conflict). The game's own server.js keeps its replay-validated submit, board and
 * achievement routes for local development only (npm start) — those paths never run
 * hosted, so the fabricated routes stay silent on-platform. Launch tokens are never
 * persisted; rate limits and structured {"error":...} responses are recoverable states. */

const SAVE_KEY = 'summit-pyramid-save-v1';
const SAVE_VERSION = 1;
const TOKEN_REFRESH_MS = 45 * 60 * 1000;  // launch tokens live 60 min
const TOKEN_RETRY_MS = 60 * 1000;
const CLOUD_DEBOUNCE_MS = 2000;
const ZIP_ENTRY = 'summit-pyramid-save.json';

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

/* ---- platform adapter ---- */

export class Platform {
  constructor() {
    this.hosted = false;         // true iff a launch token was read
    this.devApi = false;         // true when the game's own dev server answers
    this.timeOffset = 0;         // dev-server clock offset (round-trip adjusted)
    this.launchToken = null;     // short-lived; read from launch, never stored
    this.userId = null;          // token sub
    this.slug = null;            // token game_scope (cloud-save key)
    this.nickname = null;
    this.syncState = 'offline';  // offline | saving | synced | error
    this.onSyncChange = null;
    this._cloudTimer = null;
    this._cloudDirty = false;
    this._cloudDoc = null;
    this._refreshTimer = null;
    this._retryTimer = null;
    this._nickCache = new Map();
    this._gameInfo = null;
  }

  async init() {
    this.readLaunchToken();
    if (!this.hosted) await this.detectDevServer();
    if (this.hosted) {
      this.fetchAccountProfile().catch(() => {});
      this._refreshTimer = setTimeout(() => this._refreshToken(), TOKEN_REFRESH_MS);
      window.addEventListener('pagehide', () => this.flushCloudSave());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushCloudSave(); });
    }
    return this;
  }

  readLaunchToken() {
    // The platform delivers the token in the URL fragment: #game_token=<jwt>
    // (optional &session_id=…). Read it once, then strip it from the address
    // bar. Query-param fallbacks exist for local development only and never
    // run on *.starhermit.com. Never persisted.
    let token = null;
    if (location.hash) {
      const frag = new URLSearchParams(location.hash.slice(1));
      token = frag.get('game_token');
      if (token && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    }
    if (!token && !/(^|\.)starhermit\.com$/i.test(location.hostname)) {
      const params = new URLSearchParams(location.search);
      token = params.get('game_token') || params.get('launch') || params.get('token');
      if (token && history.replaceState) history.replaceState(null, '', location.pathname);
    }
    this.launchToken = token;
    if (!token) return;
    const payload = decodeJwtPayload(token);
    this.userId = (payload && payload.sub) || null;
    this.slug = (payload && payload.game_scope) || null;
    this.hosted = true;
  }

  async detectDevServer() {
    // GET /api/v1/time is this game's own server.js route (local dev). On the
    // platform that route does not exist, and hosted mode never probes it.
    try {
      const t0 = Date.now();
      const r = await fetch('/api/v1/time', { signal: AbortSignal.timeout(2500) });
      if (!r.ok) throw new Error('no api');
      const j = await r.json();
      const t1 = Date.now();
      this.timeOffset = j.now - Math.round((t0 + t1) / 2);
      this.devApi = true;
    } catch (e) { this.devApi = false; }
    return this.devApi;
  }

  now() { return Date.now() + this.timeOffset; }

  authHeaders() { return this.launchToken ? { authorization: 'Bearer ' + this.launchToken } : {}; }

  async api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'content-type': 'application/json' }, this.authHeaders(), opts.headers || {});
    const r = await fetch('/api/v1' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (r.status === 429) {
      const err = new Error('rate-limited');
      err.recoverable = true;
      err.retryAfter = Number(r.headers.get('retry-after')) || 5;
      throw err;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('http-' + r.status));
    return j;
  }

  async _refreshToken() {
    // Scoped launch tokens may re-mint: swap the new token in and reschedule.
    clearTimeout(this._refreshTimer);
    clearTimeout(this._retryTimer);
    if (!this.hosted || !this.slug || !this.launchToken) return;
    try {
      const res = await this.api('/games/' + encodeURIComponent(this.slug) + '/launch-token', { method: 'POST' });
      if (res.token) this.launchToken = res.token;
      this._refreshTimer = setTimeout(() => this._refreshToken(), TOKEN_REFRESH_MS);
    } catch (e) {
      this._retryTimer = setTimeout(() => this._refreshToken(), TOKEN_RETRY_MS);
    }
  }

  /* ---- identity (nickname only; usernames never displayed, /api/v1/me never called) ---- */

  async fetchAccountProfile() {
    if (!this.hosted || !this.userId) return;
    let name = null;
    try {
      const prof = await this.api('/users/' + encodeURIComponent(this.userId) + '/profile');
      name = (prof && prof.nickname) || null;
    } catch (e) { /* fall through to the id-based fallback */ }
    this.nickname = String(name || 'Player ' + String(this.userId).slice(0, 8)).slice(0, 24);
    if (this.onSyncChange) this.onSyncChange();
  }

  displayName() {
    if (this.nickname) return this.nickname;
    if (this.hosted && this.userId) return 'Player ' + String(this.userId).slice(0, 8);
    return null;
  }

  async nicknameFor(userId) {
    // Leaderboard entries resolve ids to nicknames via the profile helper.
    if (!userId) return 'Player';
    if (this._nickCache.has(userId)) return this._nickCache.get(userId);
    let name = 'Player ' + String(userId).slice(0, 8);
    try {
      const prof = await this.api('/users/' + encodeURIComponent(userId) + '/profile');
      if (prof && prof.nickname) name = String(prof.nickname).slice(0, 24);
    } catch (e) { /* keep fallback */ }
    this._nickCache.set(userId, name);
    return name;
  }

  statusLine() {
    if (this.hosted) {
      const sync = {
        synced: 'cloud synced', saving: 'saving to cloud…',
        error: 'cloud sync error — will retry', offline: 'offline'
      }[this.syncState] || 'cloud synced';
      return 'Signed in as ' + (this.displayName() || '…') + ' · ' + sync;
    }
    if (this.devApi) return 'Dev server connected — validated rankings on';
    return 'Local play — fully offline-capable';
  }

  /* ---- cloud save: ONE zip+base64 slot mirroring the local doc ---- */

  _setSync(state) {
    if (this.syncState === state) return;
    this.syncState = state;
    if (this.onSyncChange) this.onSyncChange();
  }

  queueCloudSave(save) {
    this._cloudDoc = save;
    if (!this.hosted || !this.slug) return;
    this._cloudDirty = true;
    this._setSync('saving');
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => this.pushCloudSave(), CLOUD_DEBOUNCE_MS);
  }

  flushCloudSave() {
    if (!this._cloudDirty) return;
    clearTimeout(this._cloudTimer);
    this.pushCloudSave();
  }

  async pushCloudSave() {
    if (!this.hosted || !this.slug) return;
    clearTimeout(this._cloudTimer);
    if (!this._cloudDirty) { this._setSync('synced'); return; }
    const doc = this._cloudDoc;
    this._cloudDirty = false;
    this._setSync('saving');
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(doc));
      await this.api('/me/cloud-saves/' + encodeURIComponent(this.slug), {
        method: 'PUT',
        body: { dataBase64: bytesToBase64(zipStore(ZIP_ENTRY, bytes)) }
      });
      this._setSync('synced');
    } catch (e) {
      this._cloudDirty = true;
      this._setSync('error');
    }
  }

  async pullCloudSave() {
    if (!this.hosted || !this.slug) return null;
    try {
      const r = await fetch('/api/v1/me/cloud-saves/' + encodeURIComponent(this.slug), { headers: this.authHeaders() });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('http-' + r.status);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
      return (doc && doc.version === SAVE_VERSION) ? doc : null;
    } catch (e) { return null; }
  }

  /* ---- leaderboards ----
   * Hosted: read-only platform board (clients can never submit scores).
   * Dev: the game's own server.js validated global/daily boards. */

  async gameInfo() {
    if (this._gameInfo) return this._gameInfo;
    this._gameInfo = await this.api('/games/' + encodeURIComponent(this.slug));
    return this._gameInfo;
  }

  async boardEntries(friends) {
    const info = await this.gameInfo();
    if (!info.leaderboardId) return null;
    const q = 'friendsOnly=' + (friends ? '1' : '') + '&page=1&pageSize=20';
    const res = await this.api('/leaderboards/' + encodeURIComponent(info.leaderboardId) + '/entries?' + q);
    const entries = [];
    for (const e of res.entries || []) {
      const userId = e.userId != null ? e.userId : (e.user && e.user.id);
      entries.push({
        name: await this.nicknameFor(userId),
        me: userId === this.userId,
        score: e.score != null ? e.score : (e.value || 0)
      });
    }
    return entries;
  }

  async devBoards() {
    if (!this.devApi) return null;
    try {
      const r = await fetch('/api/v1/leaderboards', { headers: this.authHeaders() });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  /* ---- own dev server: replay-validated submit + achievements (local dev only) ----
   * Graceful fallback: callers keep the local record when these reject. */

  async submitScore(entry) {
    if (!this.devApi) return { local: true };
    const body = Object.assign({ name: this.displayName() || 'Player' }, entry);
    return this.api('/score/submit', { method: 'POST', body: body });
  }

  submitAchievement(id) {
    if (!this.devApi) return Promise.resolve({ local: true });
    return this.api('/achievement', { method: 'POST', body: { id: id } }).catch(e => ({ local: true, error: e.message }));
  }
}

/* Launch-token payload (base64url decode only; the platform verifies). */
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    return JSON.parse(atob(b64 + pad));
  } catch (e) {
    return null;
  }
}

// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
