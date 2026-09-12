/* Summit Pyramid — DOM shell: screens, HUD, settings, accessible board mirror. */

const $ = id => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {};
    for (const id of [
      'topbar', 'tray', 'objective', 'score', 'moves', 'move-limit', 'seed', 'mode-label',
      'stock-count', 'waste-top', 'waste-count', 'recycles-left',
      'btn-draw', 'btn-recycle', 'btn-undo', 'btn-hint', 'btn-pause', 'btn-breakdown',
      'board-dom', 'gl', 'toast', 'captions', 'live', 'live-err',
      'scr-title', 'scr-modes', 'scr-journey', 'scr-practice', 'scr-challenge',
      'scr-pause', 'scr-results', 'scr-help', 'scr-settings', 'scr-board', 'scr-tut',
      'stage-grid', 'journey-progress', 'diff-list', 'challenge-list',
      'result-headline', 'result-reason', 'result-table', 'result-achievements', 'result-submit',
      'pause-seed', 'pause-moves', 'board-source', 'board-global', 'board-daily',
      'tut-title', 'tut-text', 'tut-hint', 'resume-line', 'practice-seed',
      'player-name', 'sync-status', 'title-status'
    ]) this.el[id] = $(id);
    this.screens = ['scr-title', 'scr-modes', 'scr-journey', 'scr-practice', 'scr-challenge',
      'scr-pause', 'scr-results', 'scr-help', 'scr-settings', 'scr-board', 'scr-tut'];
    this.lastFocus = null;
    this.returnTo = 'scr-title';
    this.cardButtons = [];   // index 0..27
    this.wasteButton = null;
  }

  show(name, opts = {}) {
    if (name === 'none') {
      for (const s of this.screens) this.el[s].hidden = true;
      return;
    }
    for (const s of this.screens) this.el[s].hidden = s !== name;
    if (name && !opts.keepFocus) {
      this.lastFocus = document.activeElement;
      const first = this.el[name].querySelector('button, [tabindex], input, select');
      if (first) first.focus();
    }
  }

  currentScreen() { return this.screens.find(s => !this.el[s].hidden) || 'none'; }

  restoreFocus() { if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus(); }

  toast(msg, ms = 2200) {
    const t = this.el.toast;
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.style.display = 'none'; }, ms);
  }

  live(msg) { this.el.live.textContent = msg; }
  announceError(msg) { this.el['live-err'].textContent = msg; this.toast(msg); }
  caption(msg) {
    const c = this.el.captions;
    c.style.display = 'block';
    c.textContent = '♪ ' + msg;
    clearTimeout(this._capT);
    this._capT = setTimeout(() => { c.style.display = 'none'; }, 1600);
  }

  setPlaying(on) {
    this.el.topbar.hidden = !on;
    this.el.tray.hidden = !on;
  }

  updateHUD(state, score, modeLabel, content) {
    this.el.score.textContent = score.total;
    this.el.moves.textContent = state.moves;
    this.el['move-limit'].textContent = state.options.moveLimit ? ' / ' + state.options.moveLimit : '';
    this.el.seed.textContent = state.seed;
    this.el['mode-label'].textContent = modeLabel || '';
    this.el['stock-count'].textContent = '(' + state.stock.length + ')';
    this.el['waste-count'].textContent = state.waste.length ? ' (' + state.waste.length + ')' : '';
    this.el['waste-top'].textContent = state.waste.length
      ? content.cardName(state.waste[state.waste.length - 1]) : '—';
    this.el['recycles-left'].textContent = '(' + state.recyclesLeft + ')';
    this.el['btn-draw'].disabled = !state.stock.length;
    this.el['btn-recycle'].disabled = !(state.stock.length === 0 && state.waste.length && state.recyclesLeft > 0);
    this.el['btn-undo'].disabled = !state.history.length;
  }

  /* Accessible board mirror: one button per pyramid slot + waste. */
  buildBoard(R) {
    const board = this.el['board-dom'];
    board.innerHTML = '';
    this.cardButtons = new Array(28).fill(null);
    for (let r = 0; r < 7; r++) {
      const row = document.createElement('div');
      row.className = 'prow';
      for (let c = 0; c <= r; c++) {
        const i = (r * (r + 1)) / 2 + c;
        const b = document.createElement('button');
        b.className = 'card-btn';
        b.dataset.index = i;
        row.appendChild(b);
        this.cardButtons[i] = b;
      }
      board.appendChild(row);
    }
    const pileRow = document.createElement('div');
    pileRow.className = 'prow';
    this.wasteButton = document.createElement('button');
    this.wasteButton.className = 'card-btn';
    this.wasteButton.dataset.zone = 'waste';
    pileRow.appendChild(this.wasteButton);
    board.appendChild(pileRow);
  }

  syncBoard(R, state, selection, legal) {
    for (let i = 0; i < 28; i++) {
      const b = this.cardButtons[i];
      const card = state.pyramid[i];
      if (card == null) { b.style.display = 'none'; continue; }
      b.style.display = '';
      const exposed = R.isExposed(state.pyramid, i);
      b.textContent = R.cardName(card);
      b.classList.toggle('red', card >= 13 && card < 39);
      b.classList.toggle('covered', !exposed);
      b.classList.toggle('sel', selection.some(s => s.zone === 'pyramid' && s.index === i));
      b.disabled = !exposed;
      b.setAttribute('aria-label',
        R.cardName(card) + (exposed ? ', exposed' : ', covered') +
        (selection.some(s => s.zone === 'pyramid' && s.index === i) ? ', selected' : ''));
      const isLegal = exposed && legal.some(a => a.type === 'remove' &&
        a.cards.some(c => c.zone === 'pyramid' && c.index === i));
      b.classList.toggle('legal', isLegal);
    }
    const w = state.waste.length ? state.waste[state.waste.length - 1] : null;
    this.wasteButton.textContent = w == null ? '—' : R.cardName(w);
    this.wasteButton.disabled = w == null;
    this.wasteButton.classList.toggle('red', w != null && w >= 13 && w < 39);
    this.wasteButton.classList.toggle('sel', selection.some(s => s.zone === 'waste'));
    this.wasteButton.setAttribute('aria-label', 'Waste top: ' + (w == null ? 'empty' : R.cardName(w)));
  }

  showResults(terminal, score, modeLabel, achievements, submitNote) {
    this.el['result-headline'].textContent = terminal.won ? 'Pyramid cleared!' : 'Round over';
    this.el['result-headline'].className = terminal.won ? 'good' : 'bad';
    this.el['result-reason'].textContent =
      (terminal.reason === 'pyramid-cleared' ? 'Every card reached the summit.' :
       terminal.reason === 'move-limit' ? 'Move limit reached.' : 'No legal moves remain.') +
      ' · ' + modeLabel;
    const rows = [
      ['Pairs removed (×100)', score.pairs],
      ['Pyramid clear bonus', score.clearBonus],
      ['Unused stock bonus', score.stockBonus],
      ['Unused recycle bonus', score.recycleBonus],
      ['Invalid-action penalty', score.invalidPenalty],
      ['Total', score.total]
    ];
    this.el['result-table'].innerHTML = rows.map(([k, v]) =>
      '<tr><td>' + k + '</td><td style="text-align:right">' + v + '</td></tr>').join('');
    this.el['result-achievements'].innerHTML = achievements.length
      ? 'Achievements unlocked: ' + achievements.map(a => '<b class="good">' + a.name + '</b>').join(', ') : '';
    this.el['result-submit'].textContent = submitNote || '';
    this.show('scr-results');
  }

  renderJourney(content, journey) {
    this.el['journey-progress'].textContent =
      Object.keys(journey.completed).length + ' / ' + content.STAGE_COUNT + ' stages complete';
    const grid = this.el['stage-grid'];
    grid.innerHTML = '';
    for (const s of content.STAGES) {
      const b = document.createElement('button');
      const n = s.index + 1;
      const locked = n > journey.unlocked;
      b.textContent = (s.mastery ? '★' : '') + n;
      b.className = (locked ? 'locked ' : '') + (journey.completed[s.id] != null ? 'done' : '');
      b.disabled = locked;
      b.title = s.name + ' — tier ' + s.difficulty + ', par ' + s.par.score;
      b.dataset.stage = s.id;
      grid.appendChild(b);
    }
  }

  applySettingsToDom(s) {
    document.documentElement.classList.toggle('hc', s.highContrast);
    document.documentElement.classList.toggle('lg-text', s.largeText);
    $('vol-music').value = s.music; $('vol-fx').value = s.fx; $('vol-amb').value = s.amb;
    $('opt-captions').checked = s.captions;
    $('opt-tier').value = s.tier;
    $('opt-motion').checked = s.reducedMotion;
    $('opt-hc').checked = s.highContrast;
    $('opt-lg').checked = s.largeText;
    $('opt-cvd').value = s.cvd;
    $('opt-left').checked = s.leftHanded;
    $('opt-dom').checked = s.domBoard;
    this.el.tray.style.flexDirection = s.leftHanded ? 'row-reverse' : 'row';
    this.el['board-dom'].classList.toggle('visible', !!s.domBoard);
  }
}
