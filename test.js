'use strict';

/* Summit Pyramid — test suite. Plain asserts; exits non-zero on failure. */

const assert = require('assert');
const R = require('./rules.js');
const C = require('./content.js');
const G = require('./game.js');

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; throw new Error(msg); }
  passed++;
}
function section(name) { console.log('— ' + name); }

/* helpers */
function pyramidRemoveAction(state) {
  return R.legalActions(state).find(a => a.type === 'remove' &&
    a.cards.every(c => c.zone === 'pyramid'));
}
function wasteRemoveAction(state) {
  return R.legalActions(state).find(a => a.type === 'remove' &&
    a.cards.some(c => c.zone === 'waste'));
}
function firstPyramidPair(state) {
  const exp = R.exposedIndices(state.pyramid);
  for (let a = 0; a < exp.length; a++)
    for (let b = a + 1; b < exp.length; b++)
      if (R.cardValue(state.pyramid[exp[a]]) + R.cardValue(state.pyramid[exp[b]]) === R.TARGET)
        return [exp[a], exp[b]];
  return null;
}

/* ---------- construction & determinism ---------- */
section('construction');
{
  const s = R.newGame(42);
  ok(s.pyramid.length === 28 && s.stock.length === 24 && s.waste.length === 0, 'sizes');
  ok(new Set(s.pyramid.concat(s.stock)).size === 52, 'unique cards');
  ok(s.status === 'active' && s.tick === 0, 'initial status');
  ok(R.stateHash(R.newGame(42)) === R.stateHash(R.newGame(42)), 'same seed same hash');
  ok(R.stateHash(R.newGame(42)) !== R.stateHash(R.newGame(43)), 'different seed different hash');
  ok(R.legalActions(s).length > 0, 'legal actions at start (seed 42)');
}

function seedWith(fn, opts) {
  for (let seed = 1; seed < 5000; seed++) {
    const s = R.newGame(seed, opts);
    if (fn(s)) return s;
  }
  return null;
}

/* ---------- every legal action type ---------- */
section('legal action types');
{
  let s = seedWith(st => pyramidRemoveAction(st));
  ok(s, 'seed with pyramid pair exists');
  const rem = pyramidRemoveAction(s);
  const s2 = R.applyCommand(s, rem);
  ok(!s2.error && s2.removedPairs === 1 && s2.moves === s.moves + 1 && s2.tick === s.tick + 1, 'remove applied');
  ok(s2.pyramid[rem.cards[0].index] == null && s2.pyramid[rem.cards[1].index] == null, 'cards gone');
  ok(s.removedPairs === 0, 'immutability of prior state');

  // draw
  const s3 = R.applyCommand(s2, { type: 'draw' });
  ok(!s3.error && s3.waste.length === s2.waste.length + 1 && s3.stock.length === s2.stock.length - 1, 'draw applied');

  // waste + pyramid remove (draw until possible)
  let s4 = s3, guard = 0;
  while (!wasteRemoveAction(s4) && s4.stock.length && guard++ < 60)
    s4 = R.applyCommand(s4, { type: 'draw' });
  const wrem = wasteRemoveAction(s4);
  ok(wrem, 'found waste remove');
  const wTop = s4.waste[s4.waste.length - 1];
  const s5 = R.applyCommand(s4, wrem);
  ok(!s5.error && s5.waste.length === s4.waste.length - 1, 'waste remove applied');
  ok(R.cardValue(wTop) + R.cardValue(s4.pyramid[wrem.cards.find(c => c.zone === 'pyramid').index]) === R.TARGET, 'waste pair sums to 14');

  // recycle: drain stock first
  let s6 = s5;
  while (s6.stock.length) s6 = R.applyCommand(s6, { type: 'draw' });
  const rec = R.applyCommand(s6, { type: 'recycle' });
  ok(!rec.error && rec.stock.length === s6.waste.length && rec.waste.length === 0, 'recycle applied');
  ok(rec.recyclesLeft === s6.recyclesLeft - 1, 'recycle count decremented');

  // undo
  const before = R.stateHash(s5);
  const d = R.applyCommand(s5, { type: 'draw' });
  ok(!d.error, 'draw for undo test');
  const u = R.applyCommand(d, { type: 'undo' });
  ok(!u.error && R.stateHash(u) === before, 'undo restores state');
  ok(u.tick > d.tick - 1, 'tick monotonic across undo');
  const u2 = R.applyCommand(R.newGame(1), { type: 'undo' });
  ok(u2.error === 'nothing-to-undo', 'undo empty history');
}

/* ---------- invalid-action reasons ---------- */
section('invalid actions');
{
  let s = R.newGame(7);
  ok(R.applyCommand(s, null).error === 'malformed-command', 'null command');
  ok(R.applyCommand(s, { type: 'bogus' }).error === 'unknown-type', 'unknown type');
  ok(R.applyCommand(s, { type: 'remove' }).error === 'malformed-command', 'remove without cards');
  ok(R.applyCommand(s, { type: 'remove', cards: [{ zone: 'waste' }, { zone: 'waste' }] }).error === 'same-card', 'two waste');
  ok(R.applyCommand(s, { type: 'remove', cards: [{ zone: 'pyramid', index: 3 }, { zone: 'pyramid', index: 3 }] }).error === 'same-card', 'same card twice');
  ok(R.applyCommand(s, { type: 'remove', cards: [{ zone: 'pyramid', index: 0 }, { zone: 'pyramid', index: 27 }] }).error === 'card-covered', 'covered apex');
  ok(R.applyCommand(s, { type: 'remove', cards: [{ zone: 'pyramid', index: 99 }, { zone: 'pyramid', index: 27 }] }).error === 'bad-card-ref', 'out of range index');
  ok(R.applyCommand(s, { type: 'recycle' }).error === 'stock-not-empty', 'recycle with stock');
  // not-a-pair: two exposed bottom cards that don't sum to 14
  const exp = R.exposedIndices(s.pyramid);
  let pair = null;
  for (let a = 0; a < exp.length && !pair; a++)
    for (let b = a + 1; b < exp.length && !pair; b++)
      if (R.cardValue(s.pyramid[exp[a]]) + R.cardValue(s.pyramid[exp[b]]) !== R.TARGET) pair = [exp[a], exp[b]];
  ok(pair, 'found non-pair');
  ok(R.applyCommand(s, { type: 'remove', cards: [{ zone: 'pyramid', index: pair[0] }, { zone: 'pyramid', index: pair[1] }] }).error === 'not-a-pair', 'not-a-pair');
  ok(s.invalid === 0, 'invalid attempts do not mutate source state');
  // drain stock
  while (s.stock.length) s = R.applyCommand(s, { type: 'draw' });
  ok(R.applyCommand(s, { type: 'draw' }).error === 'stock-empty', 'stock-empty');
  // waste-empty
  ok(R.applyCommand(R.newGame(7), { type: 'remove', cards: [{ zone: 'waste' }, { zone: 'pyramid', index: 27 }] }).error === 'waste-empty', 'waste-empty');
  // recycle-unavailable
  s.recyclesLeft = 0;
  ok(R.applyCommand(s, { type: 'recycle' }).error === 'recycle-unavailable', 'recycle-unavailable');
  // game-over
  const lost = R.newGame(5, { moveLimit: 1 });
  const l2 = R.applyCommand(lost, { type: 'draw' });
  ok(l2.status === 'lost', 'move-limit loss');
  ok(R.applyCommand(l2, { type: 'draw' }).error === 'game-over', 'game-over');
  // invalid penalty recorded
  const bad = R.applyCommand(R.newGame(3), { type: 'recycle' });
  ok(bad.error && bad.state.invalid === 1, 'invalid penalty recorded');
}

/* ---------- scoring ---------- */
section('scoring');
{
  const s = R.newGame(9);
  s.removedPairs = 5; s.invalid = 2; s.recyclesLeft = 1;
  s.stock = s.stock.slice(0, 7);
  const c = R.scoreComponents(s);
  ok(c.pairs === 500 && c.stockBonus === 70 && c.recycleBonus === 100 && c.invalidPenalty === -50, 'components');
  ok(c.clearBonus === 0 && c.total === 620, 'total without clear');
  s.pyramid = s.pyramid.map(() => null);
  const c2 = R.scoreComponents(s);
  ok(c2.clearBonus === 1000 && c2.total === 1620, 'clear bonus');
}

/* ---------- terminal states ---------- */
section('terminal states');
{
  // crafted win: one final exposed pair left
  const s = R.newGame(11);
  s.pyramid = s.pyramid.map(() => null);
  s.pyramid[26] = 7;  // value 8
  s.pyramid[27] = 5;  // value 6  (8+6=14)
  s.stock = []; s.waste = []; s.recyclesLeft = 0; s.status = 'active';
  const cur = R.applyCommand(s, { type: 'remove', cards: [{ zone: 'pyramid', index: 26 }, { zone: 'pyramid', index: 27 }] });
  ok(!cur.error, 'final pair removable');
  const t = R.isTerminal(cur);
  ok(t.over && t.won && t.reason === 'pyramid-cleared', 'win terminal');

  // no-moves loss
  const s2 = R.newGame(12);
  s2.pyramid = s2.pyramid.map(() => null);
  s2.pyramid[26] = 4; s2.pyramid[27] = 8; // values 5,9 — not a pair, both exposed
  s2.stock = []; s2.waste = []; s2.recyclesLeft = 0; s2.status = 'active';
  // force a status refresh through a command: recycle attempt is an error (no status), so use undo-less draw? craft via applyCommand on remove... simply call newGame-like update via a no-op remove? Use applyCommand with a legal-ish but failing command won't refresh. Instead remove nothing: emulate by applying 'draw' error then check isTerminal is based on status; do a valid action path:
  // Easiest: temporarily give a pair elsewhere? No — status updated only on successful commands. Make pyramid contain a pair to remove:
  s2.pyramid[25] = 4; s2.pyramid[26] = 8; s2.pyramid[27] = 3; // values 5,9,4: 5+9=14, leaves value 4 alone → no-moves
  const r = R.applyCommand(s2, { type: 'remove', cards: [{ zone: 'pyramid', index: 25 }, { zone: 'pyramid', index: 26 }] });
  ok(!r.error, 'crafted remove ok');
  const t2 = R.isTerminal(r);
  ok(t2.over && !t2.won && t2.reason === 'no-moves', 'no-moves loss');

  const t3 = R.isTerminal(R.newGame(2));
  ok(!t3.over && t3.reason === 'in-progress', 'active game not terminal');
}

/* ---------- serialization ---------- */
section('serialization');
{
  let s = R.newGame(77);
  s = R.applyCommand(s, { type: 'draw' });
  const back = R.deserialize(R.serialize(s));
  ok(!back.error && R.stateHash(back) === R.stateHash(s), 'round-trip hash');
  ok(R.deserialize('not json').error === 'bad-json', 'bad json');
  ok(R.deserialize('{"v":99}').error === 'bad-state', 'bad state');
}

/* ---------- replay & hash ---------- */
section('replay determinism');
function greedyGame(seed, options) {
  let s = R.newGame(seed, options);
  const commands = [];
  let guard = 0;
  while (!R.isTerminal(s).over && guard++ < 500) {
    const acts = R.legalActions(s);
    if (!acts.length) break;
    const a = acts.find(x => x.type === 'remove') || acts[0];
    const cmd = Object.assign({}, a, { id: 'g' + commands.length });
    const r = R.applyCommand(s, cmd);
    ok(!r.error, 'greedy command legal: ' + JSON.stringify(a));
    s = r;
    commands.push(cmd);
  }
  return { s, commands };
}
{
  const g1 = greedyGame(4242);
  const g2 = greedyGame(4242);
  ok(R.stateHash(g1.s) === R.stateHash(g2.s), 'two greedy runs identical hash');
  const rep = R.applyCommands(4242, g1.commands);
  ok(R.stateHash(rep.state) === R.stateHash(g1.s), 'applyCommands replay hash equal');
  ok(R.scoreComponents(rep.state).total === R.scoreComponents(g1.s).total, 'replay score equal');
  ok(Number.isFinite(R.scoreComponents(rep.state).total), 'score finite');
}

/* ---------- golden scripted game ---------- */
section('golden game');
{
  const g = greedyGame(31337, { recycles: 2 });
  ok(g.s.moves > 0, 'golden game made moves');
  ok(R.isTerminal(g.s).over, 'golden game terminated (reason: ' + R.isTerminal(g.s).reason + ')');
  const snapshot = R.stateHash(g.s);
  // resume mid-game: serialize/deserialize mid-state and continue
  const mid = Math.floor(g.commands.length / 2);
  const midState = R.applyCommands(31337, g.commands.slice(0, mid), { recycles: 2 }).state;
  const restored = R.deserialize(R.serialize(midState));
  let cur = restored;
  for (const cmd of g.commands.slice(mid)) cur = R.applyCommand(cur, cmd);
  ok(R.stateHash(cur) === snapshot, 'resumed game reaches golden hash');
  console.log('  golden hash:', snapshot, 'score:', R.scoreComponents(g.s).total);
}

/* ---------- undo ---------- */
section('undo stack');
{
  let s = R.newGame(64);
  const h0 = R.stateHash(s);
  s = R.applyCommand(s, { type: 'draw' });
  s = R.applyCommand(s, { type: 'draw' });
  s = R.applyCommand(s, { type: 'undo' });
  s = R.applyCommand(s, { type: 'undo' });
  ok(R.stateHash(s) === h0, 'double undo returns to start');
  ok(R.applyCommand(s, { type: 'undo' }).error === 'nothing-to-undo', 'history exhausted');
}

/* ---------- content validators ---------- */
section('content');
{
  const errors = C.validateStages();
  ok(errors.length === 0, 'stage validators: ' + errors.join('; '));
  ok(C.STAGES.length === 40, '40 stages');
  ok(C.THEMES.length === 5, '5 themes');
  ok(C.ACHIEVEMENTS.length === 5, '5 achievements');
  ok(C.CHALLENGES.length >= 3, 'challenge variants');
  ok(C.dailySeed(new Date(Date.UTC(2026, 7, 29))) === C.dailySeed(new Date(Date.UTC(2026, 7, 29, 23))), 'daily seed stable within UTC day');
  ok(C.dailySeed(new Date(Date.UTC(2026, 7, 29))) !== C.dailySeed(new Date(Date.UTC(2026, 7, 30))), 'daily seed changes by day');
  // tutorial lessons have their required action available
  for (const lesson of C.TUTORIAL.lessons) {
    let s = R.newGame(lesson.seed, { recycles: lesson.recycles == null ? 2 : lesson.recycles });
    if (lesson.drawAll) while (s.stock.length) s = R.applyCommand(s, { type: 'draw' });
    if (lesson.require.type === 'draw') ok(s.stock.length > 0, lesson.id + ': draw available');
    else if (lesson.require.type === 'recycle')
      ok(R.legalActions(s).some(a => a.type === 'recycle'), lesson.id + ': recycle available');
    else if (lesson.require.waste) {
      let found = wasteRemoveAction(s), guard = 0;
      while (!found && s.stock.length && guard++ < 30) {
        s = R.applyCommand(s, { type: 'draw' });
        found = wasteRemoveAction(s);
      }
      ok(found, lesson.id + ': waste pair reachable');
    } else {
      let found = pyramidRemoveAction(s), guard = 0;
      while (!found && s.stock.length && guard++ < 30) {
        s = R.applyCommand(s, { type: 'draw' });
        found = pyramidRemoveAction(s);
      }
      ok(found, lesson.id + ': pyramid pair reachable');
    }
  }
}

/* ---------- fuzz malformed commands ---------- */
section('fuzz');
{
  const base = R.newGame(99);
  const junk = [
    undefined, null, 0, 1, -1, 'x', [], {}, { type: null }, { type: 5 }, { type: '' },
    { type: 'remove' }, { type: 'remove', cards: null }, { type: 'remove', cards: 'ab' },
    { type: 'remove', cards: [] }, { type: 'remove', cards: [{}] },
    { type: 'remove', cards: [{ zone: 'x' }, { zone: 'y' }] },
    { type: 'remove', cards: [{ zone: 'pyramid' }, { zone: 'pyramid' }] },
    { type: 'remove', cards: [{ zone: 'pyramid', index: 1.5 }, { zone: 'pyramid', index: NaN }] },
    { type: 'remove', cards: [{ zone: 'pyramid', index: -1 }, { zone: 'pyramid', index: 28 }] },
    { type: 'remove', cards: [{ zone: 'pyramid', index: 1e9 }, { zone: 'waste' }] },
    { type: 'draw', extra: {} }, { type: 'recycle', cards: [1, 2] }, { type: 'undo', n: 1 }
  ];
  const rand = R.mulberry32(1234);
  for (let i = 0; i < 200; i++) {
    junk.push({
      type: ['remove', 'draw', 'recycle', 'undo', 'x'][Math.floor(rand() * 5)],
      cards: rand() < 0.5 ? [{ zone: 'pyramid', index: Math.floor(rand() * 60) - 10 }, { zone: rand() < 0.5 ? 'waste' : 'pyramid', index: Math.floor(rand() * 40) - 5 }] : undefined
    });
  }
  let s = base;
  for (const cmd of junk) {
    const r = R.applyCommand(s, cmd);   // must not throw
    ok(r && typeof r === 'object', 'returns object for ' + JSON.stringify(cmd));
    if (r.error) ok(typeof r.error === 'string', 'error reason is string');
    else s = r;
    const sc = R.scoreComponents(r.error ? (r.state || s) : r);
    ok(Number.isFinite(sc.total), 'score never NaN');
  }
  // fuzz states too
  for (let i = 0; i < 50; i++) {
    const st = R.newGame(Math.floor(rand() * 1e9));
    ok(R.legalActions(st).every(a => a.type), 'legal actions well-formed');
  }
}

/* ---------- server validation ---------- */
section('server validation');
{
  const g = greedyGame(555);
  const score = R.scoreComponents(g.s).total;
  const claim = {
    seed: 555, rulesetVersion: R.RULESET_VERSION, commands: g.commands, claimedScore: score
  };
  const v = G.validateScoreClaim(claim);
  ok(v.ok && v.score === score, 'valid claim accepted');
  const bad1 = G.validateScoreClaim(Object.assign({}, claim, { claimedScore: score + 1 }));
  ok(!bad1.ok && bad1.error === 'score-mismatch', 'tampered score rejected');
  const bad2 = G.validateScoreClaim(Object.assign({}, claim, { rulesetVersion: 999 }));
  ok(!bad2.ok && bad2.error === 'stale-version', 'stale version rejected');
  const bad3 = G.validateScoreClaim(Object.assign({}, claim, {
    commands: g.commands.concat([{ type: 'bogus' }]), claimedScore: R.scoreComponents(R.applyCommands(555, g.commands).state).total
  }));
  ok(!bad3.ok, 'illegal commands rejected');
  const bad4 = G.validateScoreClaim({ seed: -1, rulesetVersion: 1, commands: [], claimedScore: 0 });
  ok(!bad4.ok, 'bad seed rejected');
}

/* live server round-trip on ephemeral port */
section('server http');
async function httpTests() {
  const { createServer } = require('./server.js');
  const server = createServer();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const url = p => 'http://127.0.0.1:' + port + p;
  try {
    const t = await (await fetch(url('/api/v1/time'))).json();
    ok(typeof t.now === 'number' && Math.abs(t.now - Date.now()) < 5000, 'time endpoint');
    const idx = await fetch(url('/'));
    ok(idx.status === 200 && (await idx.text()).includes('Summit Pyramid'), 'index served');
    const g = greedyGame(777);
    const score = R.scoreComponents(g.s).total;
    const post = (p, b) => fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const good = await post('/api/v1/score/submit', {
      seed: 777, rulesetVersion: R.RULESET_VERSION, commands: g.commands, claimedScore: score, mode: 'score'
    });
    ok(good.status === 200, 'valid submission accepted');
    const goodJ = await good.json();
    ok(goodJ.ok && goodJ.score === score, 'submission score echoed');
    const bad = await post('/api/v1/score/submit', {
      seed: 777, rulesetVersion: R.RULESET_VERSION, commands: g.commands, claimedScore: score + 500, mode: 'score'
    });
    ok(bad.status === 422 && (await bad.json()).error === 'score-mismatch', 'tampered submission rejected');
    const dup = await post('/api/v1/score/submit', {
      seed: 777, rulesetVersion: R.RULESET_VERSION, commands: g.commands, claimedScore: score, mode: 'score'
    });
    ok((await dup.json()).deduped === true, 'duplicate commands deduped');
    const ach = await post('/api/v1/achievement', { id: 'first-clear' });
    ok(ach.status === 200, 'achievement accepted');
    const boards = await (await fetch(url('/api/v1/leaderboards'))).json();
    ok(boards.global.some(e => e.score === score), 'leaderboard contains entry');
  } finally {
    server.close();
  }
  console.log('\nAll tests passed (' + passed + ' assertions).');
}

httpTests().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
