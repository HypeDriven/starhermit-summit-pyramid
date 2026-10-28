// The engine client's save model (app/save.js): normalizing, the two-device
// merge (as the browser build's mergeSaves: never remote-wins), the browser
// build's cloud slot read as a foreign save, and the old settings KV carried
// over to the game's options.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/save.js';

const browserDoc = () => ({
  version: 1,
  settings: { music: 60, fx: 80, amb: 50, captions: true, gfx: { preset: 'high' }, reducedMotion: false, highContrast: false,
    largeText: false, cvd: 'deuter', leftHanded: true, domBoard: false, tutorialDone: true },
  journey: { unlocked: 4, completed: { 'stage-01': 1200, 'stage-02': 900, 'stage-03': 1500 } },
  achievements: { 'first-clear': 1700000000000 },
  best: { 'journey:stage-01': { score: 1200, seed: 6221056 } },
  stats: { wins: 3, losses: 2, streak: 3, totalPairs: 40 },
  snapshot: { cfg: { mode: 'practice', label: 'Practice — Ridge', seed: 4242, options: { recycles: 2 }, ranked: false },
    state: { v: 1, seed: 4242, pyramid: new Array(28).fill(1), stock: [], waste: [] }, commands: [], used: [] },
});

test('normalize keeps the progress and drops what the runtime owns now', () => {
  const d = S.normalize(browserDoc());
  assert.deepEqual(d.settings, { tutorialDone: true });
  assert.equal(d.journey.unlocked, 4);
  assert.equal(d.journey.completed['stage-03'], 1500);
  assert.equal(d.stats.streak, 3);
  assert.equal(d.snapshot.cfg.seed, 4242);
  assert.deepEqual(S.normalize(null), S.defaultSave());
  assert.deepEqual(S.normalize({ journey: { unlocked: 99, completed: { x: 'bad' } }, stats: { wins: -3 } }).journey, { unlocked: 40, completed: {} });
  assert.equal(S.normalize({ snapshot: { cfg: {} } }).snapshot, null, 'a broken snapshot is dropped');
});

test('two saves merge: bests and counters keep the larger, achievements the earliest, this device first', () => {
  const a = S.normalize(browserDoc());
  const b = S.normalize({
    version: 1, journey: { unlocked: 6, completed: { 'stage-01': 1000, 'stage-05': 800 } }, achievements: { 'first-clear': 1600000000000, 'streak-3': 5 },
    best: { 'journey:stage-01': { score: 1300, seed: 1 } }, stats: { wins: 9, losses: 1, streak: 0, totalPairs: 10 }, snapshot: null,
    settings: { tutorialDone: false },
  });
  const m = S.mergeSaves(a, b);
  assert.equal(m.journey.unlocked, 6);
  assert.deepEqual(m.journey.completed, { 'stage-01': 1200, 'stage-02': 900, 'stage-03': 1500, 'stage-05': 800 });
  assert.equal(m.achievements['first-clear'], 1600000000000);
  assert.equal(m.achievements['streak-3'], 5);
  assert.equal(m.best['journey:stage-01'].score, 1300);
  assert.deepEqual(m.stats, { wins: 9, losses: 2, streak: 0, totalPairs: 40 }, 'the streak follows the doc with more games');
  assert.equal(m.snapshot.cfg.seed, 4242);
  assert.equal(m.settings.tutorialDone, true);
  assert.ok(S.sameSave(S.mergeSaves(m, m), m));
  assert.ok(S.sameSave(S.mergeSaves(m, a), m), 'merging what it already holds changes nothing');
});

test('the browser build\'s cloud slot reads as a foreign save', () => {
  const d = S.readForeign(JSON.stringify(browserDoc()));
  assert.equal(d.journey.unlocked, 4);
  assert.equal(S.readForeign('not json'), null);
  assert.equal(S.readForeign(JSON.stringify({ version: 2 })), null);
  assert.equal(S.readForeign(''), null);
});

test('the old settings KV carries the game\'s options and tutorialDone', () => {
  const kv = browserDoc().settings;
  const old = S.readLegacySettings(kv);
  assert.deepEqual(old.options, { captions: true, cvd: 'deuter', leftHanded: true, domBoard: false });
  assert.equal(old.tutorialDone, true);
  assert.deepEqual(S.pickOptions({ cvd: 'purple', captions: 'yes' }), {});
  for (const k of Object.keys(kv)) assert.ok(S.BROWSER_KEYS.includes(k), `${k} is removed after the import`);
});
