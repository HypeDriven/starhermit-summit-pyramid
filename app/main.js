/* Summit Pyramid — bootstrap and game-flow orchestration.
 * Flow: boot → title → mode-select → preparing/tutorial → active ↔ paused → resolving → results → progression. */

import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import { Renderer3D } from './render3d.js';
import { loadSave, storeSave, Api } from './session.js';

const R = globalThis.SummitRules;
const C = globalThis.SummitContent;

const ui = new UI();
const save = loadSave();
const audio = new AudioEngine(save.settings, m => ui.caption(m));
const api = new Api();

let flow = 'boot';            // boot|title|modes|preparing|tutorial|active|paused|resolving|results
let renderer = null;
let game = null;              // current round context
let kbFocus = null;           // {zone,index?} keyboard focus target
let actionSeq = 0;

/* ---------- round lifecycle ---------- */

function themeFor(id) { return C.THEMES.find(t => t.id === id) || C.THEMES[0]; }

function startRound(cfg) {
  // cfg: {mode, label, seed, options, themeId, stageId, ranked, tutorial?}
  flow = 'preparing';
  const options = Object.assign({ recycles: 2, moveLimit: null }, cfg.options || {});
  game = {
    cfg,
    state: R.newGame(cfg.seed, options),
    selection: [],
    commands: [],
    used: new Set(),
    tutorialStep: cfg.tutorial ? 0 : null,
    startedAt: Date.now()
  };
  const theme = themeFor(cfg.themeId || C.THEMES[(cfg.seed % C.THEMES.length)]?.id || 'dusk');
  if (renderer) {
    renderer.settings = save.settings;
    renderer.buildEnv(theme, cfg.seed);
    renderer.buildBoard(game.state, theme);
    renderer.resize();
  }
  ui.buildBoard(R);
  if (cfg.tutorial) enterTutorialLesson();
  flow = cfg.tutorial ? 'tutorial' : 'active';
  ui.show(cfg.tutorial ? 'scr-tut' : 'none');
  ui.setPlaying(true);
  syncAll();
  audio.ensure(); audio.startAmbience();
  ui.live(cfg.label + ' started. ' + ui.el.objective.textContent);
  persistSnapshot();
}

function enterTutorialLesson() {
  const lesson = C.TUTORIAL.lessons[game.tutorialStep];
  ui.el['tut-title'].textContent = (game.tutorialStep + 1) + '/' + C.TUTORIAL.lessons.length + ' — ' + lesson.title;
  ui.el['tut-text'].textContent = lesson.text;
  game.lesson = lesson;
  game.state = R.newGame(lesson.seed, { recycles: lesson.recycles == null ? 2 : lesson.recycles });
  if (lesson.drawAll) while (game.state.stock.length) game.state = R.applyCommand(game.state, { type: 'draw' });
  if (renderer) { renderer.buildBoard(game.state, renderer.theme || themeFor('dusk')); renderer.resize(); }
  game.selection = [];
  ui.el['tut-hint'].textContent = lesson.require.type === 'remove'
    ? (lesson.require.waste ? 'Pair the waste top card with a pyramid card.' : 'Select two exposed cards totaling 14.')
    : lesson.require.type === 'draw' ? 'Press Draw (D).' : 'Press Recycle (R).';
}

function endRound(terminal) {
  flow = 'resolving';
  const score = R.scoreComponents(game.state);
  const won = terminal.won;
  // stats & progression
  save.stats.totalPairs += game.state.removedPairs;
  const unlocked = [];
  if (won) {
    save.stats.wins++; save.stats.streak++;
    grant('first-clear', unlocked);
    if (game.used.has('draw') && game.used.has('recycle') && game.used.has('undo'))
      grant('mechanic-master', unlocked);
    if (save.stats.streak >= 3) grant('streak-3', unlocked);
    if (game.cfg.stageId) {
      const stage = C.stageById(game.cfg.stageId);
      const prev = save.journey.completed[stage.id];
      if (prev == null || score.total > prev) save.journey.completed[stage.id] = score.total;
      save.journey.unlocked = Math.max(save.journey.unlocked, Math.min(C.STAGE_COUNT, stage.index + 2));
      if (stage.index >= 19) grant('stage-20', unlocked);
    }
  } else { save.stats.losses++; save.stats.streak = 0; }
  if (save.stats.totalPairs >= 500) grant('pairs-500', unlocked);
  const bestKey = game.cfg.mode + ':' + (game.cfg.stageId || game.cfg.label);
  if (won && (!save.best[bestKey] || score.total > save.best[bestKey].score))
    save.best[bestKey] = { score: score.total, seed: game.state.seed };
  save.snapshot = null;
  storeSave(save);

  // submit ranked results
  let submitNote = 'Unranked local game.';
  const ranked = game.cfg.ranked;
  const finish = note => {
    flow = 'results';
    ui.showResults(terminal, score, game.cfg.label, unlocked, note);
    (won ? audio.win() : audio.lose());
    ui.live(terminal.won ? 'You win. Score ' + score.total : 'Round over. Score ' + score.total);
  };
  if (ranked && api.available) {
    api.submitScore({
      seed: game.state.seed, rulesetVersion: R.RULESET_VERSION, options: game.state.options,
      mode: game.cfg.mode, dailyId: game.cfg.mode === 'daily' ? C.dailyId(new Date(api.now())) : undefined,
      commands: game.commands, claimedScore: score.total, durationMs: Date.now() - game.startedAt
    }).then(r => finish('Score validated and submitted (rank ' + (r.rank || '—') + ').'))
      .catch(e => finish('Submission rejected: ' + e.message));
  } else if (ranked) finish('Ranked game recorded locally (no server connection).');
  else finish(submitNote);
}

function grant(id, unlocked) {
  if (save.achievements[id]) return;
  const meta = C.ACHIEVEMENTS.find(a => a.id === id);
  if (!meta) return;
  save.achievements[id] = Date.now();
  unlocked.push(meta);
  api.submitAchievement(id).catch(() => {});
}

function persistSnapshot() {
  if (!game || game.cfg.tutorial) { save.snapshot = null; storeSave(save); return; }
  save.snapshot = { cfg: game.cfg, state: game.state, commands: game.commands, used: [...game.used] };
  storeSave(save);
}

/* ---------- command application ---------- */

function doCommand(cmd) {
  if (!game || (flow !== 'active' && flow !== 'tutorial')) return;
  cmd = Object.assign({}, cmd, { id: 'c' + game.state.seed + '-' + (++actionSeq) });
  const before = game.state;
  const res = R.applyCommand(before, cmd);
  if (res && res.error) {
    game.state = res.state || before;
    audio.invalid();
    ui.announceError(explainError(res.error));
    syncAll();
    return;
  }
  game.state = res;
  game.commands.push(cmd);
  game.used.add(cmd.type);
  // sounds
  if (cmd.type === 'remove') {
    const refs = cmd.cards;
    audio.removePair();
    if (renderer) renderer.animateRemoval(refs, () => syncAll());
    ui.live('Removed ' + describeCards(before, refs) + '. ' +
      (R.isTerminal(game.state).over ? '' : hintText()));
  } else if (cmd.type === 'draw') { audio.draw(); ui.live('Drew ' + R.cardName(game.state.waste[game.state.waste.length - 1]) + '.'); }
  else if (cmd.type === 'recycle') { audio.recycle(); ui.live('Waste recycled. ' + game.state.recyclesLeft + ' left.'); }
  else if (cmd.type === 'undo') { audio.undo(); ui.live('Undone.'); }
  game.selection = [];
  kbFocus = null;
  const t = R.isTerminal(game.state);
  // tutorial progression
  if (flow === 'tutorial' && game.lesson && lessonSatisfied(cmd)) advanceTutorial();
  if (t.over && flow !== 'tutorial') { persistSnapshot(); syncAll(); endRound(t); return; }
  if (t.over && flow === 'tutorial') {
    // tutorial can't be lost: recycle/undo keeps it alive; treat as lesson reset
    game.state = R.newGame(game.lesson.seed, { recycles: 2 });
  }
  persistSnapshot();
  syncAll();
}

function lessonSatisfied(cmd) {
  const req = game.lesson.require;
  if (req.type !== cmd.type) return false;
  if (req.waste) return cmd.cards && cmd.cards.some(c => c.zone === 'waste');
  return true;
}

function advanceTutorial() {
  game.tutorialStep++;
  audio.select();
  if (game.tutorialStep >= C.TUTORIAL.lessons.length) {
    save.settings.tutorialDone = true;
    storeSave(save);
    ui.toast('Lessons complete!');
    quitToModes();
    return;
  }
  enterTutorialLesson();
  syncAll();
}

function explainError(err) {
  return {
    'not-a-pair': 'Those cards do not total 14.',
    'card-covered': 'That card is still covered by cards below it.',
    'card-absent': 'That card is already removed.',
    'stock-empty': 'The stock is empty — recycle the waste if you can.',
    'stock-not-empty': 'You can only recycle when the stock is empty.',
    'recycle-unavailable': 'No recycles left.',
    'nothing-to-undo': 'Nothing to undo.',
    'same-card': 'Pick two different cards.',
    'waste-empty': 'The waste pile is empty.',
    'game-over': 'This round is over.'
  }[err] || 'That action is not legal right now (' + err + ').';
}

function describeCards(state, refs) {
  return refs.map(r => {
    if (r.zone === 'waste') return R.cardName(state.waste[state.waste.length - 1]);
    return R.cardName(state.pyramid[r.index]);
  }).join(' + ');
}

function hintText() {
  const acts = R.legalActions(game.state);
  const rem = acts.find(a => a.type === 'remove');
  if (rem) return 'Hint: ' + describeCards(game.state, rem.cards) + ' totals 14.';
  if (acts.some(a => a.type === 'draw')) return 'Hint: draw from the stock.';
  if (acts.some(a => a.type === 'recycle')) return 'Hint: recycle the waste.';
  return 'No moves left.';
}

function doHint() {
  if (!game || flow !== 'active') return;
  const msg = hintText();
  ui.toast(msg, 3500);
  ui.live(msg);
  audio.select();
  const acts = R.legalActions(game.state);
  const rem = acts.find(a => a.type === 'remove');
  if (rem) { game.selection = rem.cards.slice(0, 1); syncAll(); }
}

/* ---------- selection ---------- */

function tapTarget(ref) {
  if (!game || (flow !== 'active' && flow !== 'tutorial')) return;
  if (ref.zone === 'stock') { doCommand({ type: 'draw' }); return; }
  audio.ensure();
  const already = game.selection.findIndex(s => s.zone === ref.zone && s.index === ref.index);
  if (already >= 0) { game.selection.splice(already, 1); audio.deselect(); syncAll(); return; }
  game.selection.push(ref);
  audio.select();
  if (game.selection.length === 2) {
    doCommand({ type: 'remove', cards: game.selection.slice(0, 2) });
  } else {
    ui.live('Selected ' + describeRef(ref) + '. Pick a second card totaling 14.');
    syncAll();
  }
}

function describeRef(ref) {
  if (ref.zone === 'waste') return 'waste ' + R.cardName(game.state.waste[game.state.waste.length - 1]);
  return R.cardName(game.state.pyramid[ref.index]);
}

/* ---------- sync ---------- */

function syncAll() {
  if (!game) return;
  const score = R.scoreComponents(game.state);
  ui.updateHUD(game.state, score, game.cfg.label, { cardName: R.cardName });
  const legal = R.legalActions(game.state);
  ui.syncBoard(R, game.state, game.selection, legal);
  if (renderer) renderer.syncState(game.state, game.selection);
  audio.setIntensity(game.state.pyramid.filter(c => c != null).length < 10 ? 0.8 : 0.2);
}

/* ---------- screen flow ---------- */

function quitToModes() {
  game = null;
  ui.setPlaying(false);
  flow = 'modes';
  ui.show('scr-modes');
  audio.stopAmbience();
}

function goTitle() {
  game = null;
  ui.setPlaying(false);
  flow = 'title';
  ui.el['resume-line'].hidden = !save.snapshot;
  ui.show('scr-title');
  audio.stopAmbience();
}

function startJourneyStage(id) {
  const s = C.stageById(id);
  if (!s) return;
  startRound({
    mode: 'journey', label: 'Journey — ' + s.name, seed: s.seed,
    options: s.mechanics, themeId: s.theme, stageId: s.id, ranked: false,
    tutorial: s.tutorial && !save.settings.tutorialDone
  });
}

function startDaily() {
  const now = new Date(api.now());
  const seed = C.dailySeed(now);
  startRound({
    mode: 'daily', label: 'Daily — ' + C.dailyId(now), seed,
    options: { recycles: 2 }, themeId: C.THEMES[seed % C.THEMES.length].id, ranked: true
  });
}

function randomSeed() { return (Math.floor(Math.random() * 0xffffffff)) >>> 0; }

/* ---------- wiring ---------- */

function bind() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);

  on('btn-play', () => {
    audio.ensure();
    if (!save.settings.tutorialDone) {
      startRound({ mode: 'learn', label: 'Learn', seed: 101, tutorial: true, themeId: 'dusk' });
    } else { flow = 'modes'; ui.show('scr-modes'); }
  });
  on('btn-resume', () => {
    const snap = save.snapshot;
    if (!snap) return;
    startRound(snap.cfg);
    game.state = snap.state;
    game.commands = snap.commands || [];
    game.used = new Set(snap.used || []);
    syncAll();
  });
  on('btn-title-help', () => { ui.returnTo = 'scr-title'; ui.show('scr-help'); });
  on('btn-title-settings', () => { ui.returnTo = 'scr-title'; ui.show('scr-settings'); });
  on('btn-title-board', showLeaderboards);

  on('mode-learn', () => startRound({ mode: 'learn', label: 'Learn', seed: 101, tutorial: true, themeId: 'dusk' }));
  on('mode-journey', () => { ui.renderJourney(C, save.journey); ui.show('scr-journey'); });
  on('mode-daily', startDaily);
  on('mode-practice', () => {
    const list = ui.el['diff-list'];
    list.innerHTML = '';
    for (const d of C.DIFFICULTIES) {
      const b = document.createElement('button');
      b.innerHTML = d.label + ' <span class="muted">— ' + d.description + '</span>';
      b.addEventListener('click', () => {
        const raw = ui.el['practice-seed'].value.trim();
        const seed = raw ? (parseInt(raw, 10) >>> 0) : randomSeed();
        startRound({
          mode: 'practice', label: 'Practice — ' + d.label, seed,
          options: { recycles: d.recycles }, ranked: false
        });
      });
      list.appendChild(b);
    }
    ui.show('scr-practice');
  });
  on('mode-challenge', () => {
    const list = ui.el['challenge-list'];
    list.innerHTML = '';
    for (const ch of C.CHALLENGES) {
      const b = document.createElement('button');
      b.innerHTML = ch.name + ' <span class="muted">— ' + ch.description + '</span>';
      b.addEventListener('click', () => startRound({
        mode: 'challenge', label: 'Challenge — ' + ch.name, seed: ch.seed,
        options: ch.mechanics, ranked: false
      }));
      list.appendChild(b);
    }
    ui.show('scr-challenge');
  });
  on('mode-score', () => {
    const seed = randomSeed();
    startRound({
      mode: 'score', label: 'Score chase', seed,
      options: { recycles: 2 }, ranked: true
    });
  });

  ui.el['stage-grid'].addEventListener('click', e => {
    const b = e.target.closest('button[data-stage]');
    if (b && !b.disabled) startJourneyStage(b.dataset.stage);
  });

  document.querySelectorAll('button.back').forEach(b => b.addEventListener('click', () => {
    const to = b.dataset.back;
    if (to === 'title') goTitle();
    else if (to === 'modes') { flow = 'modes'; ui.show('scr-modes'); }
    else if (ui.returnTo === 'pause') ui.show('scr-pause');
    else if (ui.returnTo === 'scr-modes') { flow = 'modes'; ui.show('scr-modes'); }
    else goTitle();
  }));

  // tray
  on('btn-draw', () => doCommand({ type: 'draw' }));
  on('btn-recycle', () => doCommand({ type: 'recycle' }));
  on('btn-undo', () => doCommand({ type: 'undo' }));
  on('btn-hint', doHint);
  on('btn-pause', pauseGame);
  on('btn-breakdown', () => {
    if (!game) return;
    const s = R.scoreComponents(game.state);
    ui.toast(`Pairs ${s.pairs} · Clear ${s.clearBonus} · Stock ${s.stockBonus} · Recycle ${s.recycleBonus} · Penalty ${s.invalidPenalty}`, 4000);
  });

  // pause menu
  on('btn-resume-pause', resumeGame);
  on('btn-pause-settings', () => { ui.returnTo = 'pause'; ui.show('scr-settings'); });
  on('btn-pause-help', () => { ui.returnTo = 'pause'; ui.show('scr-help'); });
  on('btn-restart', () => { const cfg = game.cfg; startRound(cfg); });
  on('btn-quit', () => { save.snapshot = null; storeSave(save); quitToModes(); });

  // results
  on('btn-retry', () => startRound(game.cfg));
  on('btn-results-modes', quitToModes);
  on('btn-next', () => {
    if (game.cfg.stageId) {
      const s = C.stageById(game.cfg.stageId);
      const next = C.STAGES[s.index + 1];
      if (next && next.index + 1 <= save.journey.unlocked) { startJourneyStage(next.id); return; }
    }
    quitToModes();
  });

  // help / settings
  on('btn-help-tutorial', () => startRound({ mode: 'learn', label: 'Learn', seed: 101, tutorial: true, themeId: 'dusk' }));
  on('btn-settings-tutorial', () => startRound({ mode: 'learn', label: 'Learn', seed: 101, tutorial: true, themeId: 'dusk' }));
  on('btn-tut-skip', () => { if (game && flow === 'tutorial') advanceTutorial(); });
  on('btn-tut-quit', quitToModes);

  bindSettings();

  // canvas picking (gameplay layer only)
  ui.el.gl.addEventListener('pointerdown', e => {
    if (!renderer || !game || (flow !== 'active' && flow !== 'tutorial')) return;
    const hit = renderer.pick(e.clientX, e.clientY);
    if (hit) tapTarget(hit);
  });

  // DOM board mirror (also the 2D fallback)
  ui.el['board-dom'].addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.zone === 'waste') tapTarget({ zone: 'waste' });
    else tapTarget({ zone: 'pyramid', index: parseInt(b.dataset.index, 10) });
  });

  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { if (renderer) renderer.resize(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && flow === 'active') pauseGame(true);
  });
}

function bindSettings() {
  const s = save.settings;
  const upd = () => {
    storeSave(save);
    ui.applySettingsToDom(s);
    audio.applyVolumes();
    if (renderer) {
      const rebuild = renderer.settings.tier !== s.tier;
      renderer.settings = s;
      if (rebuild && game) { renderer.buildEnv(renderer.theme, game.state.seed); renderer.buildBoard(game.state, renderer.theme); }
      renderer.resize();
    }
  };
  const rng = (id, key) => document.getElementById(id).addEventListener('input', e => { s[key] = +e.target.value; upd(); });
  const chk = (id, key) => document.getElementById(id).addEventListener('change', e => { s[key] = e.target.checked; upd(); });
  const sel = (id, key) => document.getElementById(id).addEventListener('change', e => { s[key] = e.target.value; upd(); });
  rng('vol-music', 'music'); rng('vol-fx', 'fx'); rng('vol-amb', 'amb');
  chk('opt-captions', 'captions'); chk('opt-motion', 'reducedMotion');
  chk('opt-hc', 'highContrast'); chk('opt-lg', 'largeText');
  chk('opt-left', 'leftHanded'); chk('opt-dom', 'domBoard');
  sel('opt-tier', 'tier'); sel('opt-cvd', 'cvd');
}

function pauseGame(silent) {
  if (!game || flow !== 'active') return;
  flow = 'paused';
  ui.el['pause-seed'].textContent = game.state.seed;
  ui.el['pause-moves'].textContent = game.state.moves;
  ui.show('scr-pause');
  if (!silent) audio.select();
}

function resumeGame() {
  if (!game) return;
  flow = 'active';
  ui.show('none');
  ui.restoreFocus();
}

/* keyboard: arrows navigate legal targets, Enter confirm, Esc cancel/pause,
   U undo, H hint, D draw, R recycle, C camera reset */
function onKey(e) {
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = e.key;
  if (k === 'Escape') {
    if (flow === 'active' || flow === 'tutorial') {
      if (game && game.selection.length) { game.selection = []; syncAll(); audio.deselect(); }
      else pauseGame();
    } else if (flow === 'paused') resumeGame();
    return;
  }
  if (!game || (flow !== 'active' && flow !== 'tutorial')) return;
  if (k === 'u' || k === 'U') { doCommand({ type: 'undo' }); return; }
  if (k === 'h' || k === 'H') { doHint(); return; }
  if (k === 'd' || k === 'D') { doCommand({ type: 'draw' }); return; }
  if (k === 'r' || k === 'R') { doCommand({ type: 'recycle' }); return; }
  if (k === 'c' || k === 'C') { if (renderer) renderer.resetCamera(); return; }
  if (k.startsWith('Arrow')) {
    e.preventDefault();
    const targets = navTargets();
    if (!targets.length) return;
    const i = targets.findIndex(t => t.zone === (kbFocus && kbFocus.zone) && t.index === (kbFocus && kbFocus.index));
    const d = (k === 'ArrowRight' || k === 'ArrowDown') ? 1 : -1;
    kbFocus = targets[(i + d + targets.length) % targets.length];
    ui.live('Focused ' + describeRef(kbFocus) + '. Enter to select.');
    audio.select();
    return;
  }
  if (k === 'Enter' && kbFocus) { tapTarget(kbFocus); kbFocus = null; }
}

function navTargets() {
  const out = R.exposedIndices(game.state.pyramid).map(i => ({ zone: 'pyramid', index: i }));
  if (game.state.waste.length) out.push({ zone: 'waste' });
  return out;
}

async function showLeaderboards() {
  ui.show('scr-board');
  const renderLocal = note => {
    ui.el['board-source'].textContent = note;
    const rows = Object.entries(save.best)
      .sort((a, b) => b[1].score - a[1].score).slice(0, 10)
      .map(([k, v], i) => '<tr><td>' + (i + 1) + '</td><td>' + k + '</td><td style="text-align:right">' + v.score + '</td></tr>');
    ui.el['board-global'].innerHTML = rows.join('') || '<tr><td class="muted">No local scores yet.</td></tr>';
    ui.el['board-daily'].innerHTML = '<tr><td class="muted">—</td></tr>';
  };
  if (!api.available) { renderLocal('Local board (casual — no server connection).'); return; }
  try {
    const boards = await api.leaderboards();
    if (!boards) { renderLocal('Local board (server unreachable).'); return; }
    ui.el['board-source'].textContent = 'Validated global rankings.';
    ui.el['board-global'].innerHTML = (boards.global || []).map((e, i) =>
      '<tr><td>' + (i + 1) + '</td><td>seed ' + e.seed + '</td><td>' + e.mode + '</td><td style="text-align:right">' + e.score + '</td></tr>'
    ).join('') || '<tr><td class="muted">No entries yet.</td></tr>';
    ui.el['board-daily'].innerHTML = (boards.daily || []).map((e, i) =>
      '<tr><td>' + (i + 1) + '</td><td>' + e.dailyId + '</td><td style="text-align:right">' + e.score + '</td></tr>'
    ).join('') || '<tr><td class="muted">No entries yet.</td></tr>';
  } catch (e) { renderLocal('Local board (error).'); }
}

/* ---------- boot ---------- */

function boot() {
  ui.applySettingsToDom(save.settings);
  bind();
  ui.buildBoard(R);
  // 3D or fallback
  renderer = new Renderer3D(ui.el.gl, save.settings);
  if (renderer.ok) {
    renderer.buildEnv(themeFor('dusk'), 1);
    renderer.resize();
  } else {
    renderer = null;
    ui.el.gl.style.display = 'none';
    ui.el['board-dom'].classList.add('visible');
    ui.toast('3D unavailable — using the accessible 2D board. Your progress is preserved.', 6000);
  }
  api.detect().then(ok => { if (ok) ui.toast('Connected to ranking server.'); });
  goTitle();
  flow = 'title';
}

boot();
