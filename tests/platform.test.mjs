// platform.test.mjs — the StarHermit adapter (app/session.js) over
// starhermit-sdk.js with a stubbed fetch and launch hash: token read,
// nickname, cloud-save path game:<slug> round-trip, settings patch,
// controls, and no network standalone.
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
      if (init.method === 'PUT') { store.set(path, JSON.parse(init.body).dataBase64); return new Response(null, { status: 204 }); }
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

const { Platform, defaultSave } = await import('../app/session.js');

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
  const { sdk, calls } = setup('');
  const p = await new Platform(sdk).init();
  assert.equal(p.canSignIn(), true);
  assert.equal(calls.length, 0);
});
