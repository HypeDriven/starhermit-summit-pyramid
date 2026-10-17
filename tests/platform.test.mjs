// platform.test.mjs — the StarHermit adapter (app/session.js) over
// starhermit-sdk.js with a stubbed fetch and launch hash: token read,
// nickname, cloud-save path game:<slug> round-trip, settings patch,
// controls, no network standalone, merge of two saves and the save-conflict
// reload → merge → save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SDK = require('../starhermit-sdk.js');
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `x.${b64url({ sub: 'u-12345678', game_scope: 'summit-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.y`;

function setup(hash, hostname = 'summit-test.starhermit.com') {
  const calls = [], store = new Map();
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const path = url.split('?')[0];
    const json = (o) => new Response(JSON.stringify(o));
    if (path.endsWith('/profile')) return json({ nickname: 'Climber' });
    if (path.includes('/cloud-saves/')) {
      if (init.method === 'PUT') { store.set(path, JSON.parse(init.body).dataBase64); return json({ etag: '"v' + calls.length + '"' }); }
      return store.has(path) ? new Response(Buffer.from(store.get(path), 'base64')) : new Response(null, { status: 404 });
    }
    if (path.endsWith('/settings')) return init.method === 'PATCH' ? new Response(null, { status: 204 }) : json({ settings: { music: 5 } });
    if (path.endsWith('/controls')) return json({ actions: [{ action: 'draw', codes: ['Space'] }] });
    return new Response(null, { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname };
  const win = { location, history: { state: null, replaceState: (_s, _t, u) => { location.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } } };
  globalThis.location = location;
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false };
  return { calls, sdk: SDK.create({ window: win, fetch }), location };
}

const { Platform, defaultSave, mergeSaves } = await import('../app/session.js');

test('launch token read + stripped; nickname from profile', async () => {
  const { sdk, location } = setup('#game_token=' + JWT);
  const p = await new Platform(sdk).init();
  assert.equal(p.hosted, true);
  assert.equal(sdk.slug, 'summit-test');
  assert.equal(location.hash, '');
  await p.fetchAccountProfile();
  assert.equal(p.displayName(), 'Climber');
  sdk.signOut();
});

test('cloud save round-trips through game:<slug>', async () => {
  const { sdk, calls } = setup('#game_token=' + JWT);
  const p = await new Platform(sdk).init();
  const save = defaultSave();
  save.stats.wins = 7;
  p.queueCloudSave(save);
  await p.flushCloudSave();
  const put = calls.find(c => c.method === 'PUT');
  assert.ok(put.url.endsWith('/api/v1/me/cloud-saves/' + encodeURIComponent('game:summit-test')));
  assert.equal(put.auth, 'Bearer ' + JWT);
  const back = await p.pullCloudSave();
  assert.equal(back.stats.wins, 7);
  sdk.signOut();
});

test('settings KV load + PATCH of changed keys; controls overrides', async () => {
  const { sdk, calls } = setup('#game_token=' + JWT);
  const p = await new Platform(sdk).init();
  const s = defaultSave().settings;
  assert.deepEqual(await p.loadPlatformSettings(s), { music: 5 });
  p.pushSettings(Object.assign({}, s, { music: 5, highContrast: true }));
  await new Promise(r => setTimeout(r, 900));
  const patch = calls.find(c => c.method === 'PATCH');
  assert.ok(patch.url.endsWith('/api/v1/games/summit-test/settings'));
  assert.deepEqual(JSON.parse(patch.body), { settings: { highContrast: true } });
  const b = await p.loadBindings();
  assert.deepEqual(b.draw, ['Space']);
  assert.deepEqual(b.undo, ['KeyU']);
  assert.match(p.inviteLink(), /game-invite\/u-12345678\/summit-test$/);
  sdk.signOut();
});

test('standalone: no network at all', async () => {
  const { sdk, calls } = setup('', 'example.com');
  const p = await new Platform(sdk).init();
  assert.equal(p.hosted, false);
  assert.equal(p.canSignIn(), false);
  assert.equal(p.inviteLink(), null);
  p.queueCloudSave(defaultSave());
  p.pushSettings(defaultSave().settings);
  assert.equal(await p.pullCloudSave(), null);
  assert.deepEqual((await p.loadBindings()).undo, ['KeyU']);
  await new Promise(r => setTimeout(r, 900));
  assert.equal(calls.length, 0);
});

test('sign-in offered on the platform host without a token', async () => {
  // canSignIn() is only true on a game's UUID host (<uuid>.starhermit.com).
  const { sdk, calls } = setup('', '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  const p = await new Platform(sdk).init();
  assert.equal(p.canSignIn(), true);
  assert.equal(calls.length, 0);
});

test('mergeSaves keeps the better progress from both devices', () => {
  const a = defaultSave(), b = defaultSave();
  a.journey = { unlocked: 3, completed: { 'stage-01': 900, 'stage-02': 500 } };
  b.journey = { unlocked: 5, completed: { 'stage-01': 1200, 'stage-04': 700 } };
  a.achievements = { 'first-clear': 200 }; b.achievements = { 'first-clear': 100, 'streak-3': 300 };
  a.best = { 'daily:x': { score: 10, seed: 1 } }; b.best = { 'daily:x': { score: 30, seed: 2 }, 'score:y': { score: 5, seed: 3 } };
  a.stats = { wins: 4, losses: 1, streak: 2, totalPairs: 90 }; b.stats = { wins: 6, losses: 3, streak: 0, totalPairs: 80 };
  a.snapshot = { cfg: { mode: 'practice' } }; b.snapshot = { cfg: { mode: 'daily' } };
  a.settings.music = 11; b.settings.music = 99;
  const m = mergeSaves(a, b);
  assert.deepEqual(m.journey, { unlocked: 5, completed: { 'stage-01': 1200, 'stage-02': 500, 'stage-04': 700 } });
  assert.deepEqual(m.achievements, { 'first-clear': 100, 'streak-3': 300 });
  assert.deepEqual(m.best, { 'daily:x': { score: 30, seed: 2 }, 'score:y': { score: 5, seed: 3 } });
  assert.deepEqual(m.stats, { wins: 6, losses: 3, streak: 0, totalPairs: 90 });
  assert.deepEqual(m.snapshot, { cfg: { mode: 'practice' } }, 'this device keeps its game in progress');
  assert.equal(m.settings.music, 11);
  assert.deepEqual(mergeSaves(defaultSave(), b).snapshot, { cfg: { mode: 'daily' } });
});

test('save conflict: a refused write reloads the cloud copy; the merge is saved on top of it', async () => {
  const slot = '/api/v1/me/cloud-saves/' + encodeURIComponent('game:summit-test');
  const zipOf = async (doc) => {
    let bytes = null;
    const loc = { hash: '#game_token=' + JWT, search: '', pathname: '/', hostname: 'h', href: 'https://h/' };
    const z = SDK.create({ window: { location: loc, history: { replaceState() {} } }, fetch: async (u, init = {}) => {
      if (init.method === 'PUT') { bytes = JSON.parse(init.body).dataBase64; return new Response(JSON.stringify({ etag: '"z"' }), { status: 200 }); }
      return new Response(null, { status: 404 });
    }, setTimeout: () => 0, clearTimeout() {} });
    z.init();
    await z.writeSave(JSON.stringify(doc));
    return bytes;
  };
  let stored = null, etag = null;
  const puts = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET', path = url.split('?')[0];
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (path === slot + '/info') return json({ exists: !!stored, etag });
    if (path === slot && method === 'GET') return stored ? new Response(Buffer.from(stored, 'base64')) : new Response(null, { status: 404 });
    if (path === slot && method === 'PUT') {
      const match = init.headers['If-Match'];
      puts.push(match || init.headers['If-None-Match']);
      if ((match && match !== etag) || (!match && stored)) return json({ error: 'precondition_failed' }, 412);
      stored = JSON.parse(init.body).dataBase64;
      etag = '"v' + puts.length + '"';
      return json({ etag });
    }
    if (path.endsWith('/profile')) return json({ nickname: 'Climber' });
    return new Response(null, { status: 404 });
  };
  const location = { hash: '#game_token=' + JWT, search: '', pathname: '/', hostname: 'h', href: 'https://h/' };
  globalThis.location = location;
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false };
  const sdk = SDK.create({ window: { location, history: { replaceState() {} } }, fetch, setTimeout: () => 0, clearTimeout() {} });
  const p = await new Platform(sdk).init();
  assert.equal(await p.pullCloudSave(), null);           // empty slot: later writes are conditional
  const other = defaultSave();
  other.journey = { unlocked: 9, completed: { 'stage-08': 1500 } };
  stored = await zipOf(other);
  etag = '"other"';
  const local = defaultSave();
  local.journey = { unlocked: 2, completed: { 'stage-01': 800 } };
  let merged = null;
  p.onConflict = (remote) => { merged = mergeSaves(local, remote); p.queueCloudSave(merged); };
  p.queueCloudSave(local);
  await sdk.flushSave();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(merged, 'conflict handed to the game');
  assert.deepEqual(merged.journey, { unlocked: 9, completed: { 'stage-01': 800, 'stage-08': 1500 } });
  assert.equal(sdk.saveConflicted(), false);
  await sdk.flushSave();
  assert.equal(puts.at(-1), '"other"', 'the merge is written on top of the reloaded version');
  assert.equal((await p.pullCloudSave()).journey.unlocked, 9);
  sdk.signOut();
});
