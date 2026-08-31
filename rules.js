'use strict';

/*
 * Summit Pyramid — pure deterministic rules engine.
 * Works in Node (module.exports) and the browser (globalThis.SummitRules).
 *
 * Pyramid solitaire variant: 7 rows / 28 cards, 24-card stock + waste.
 * Card values A=1..K=13. TARGET=21: pairs of exposed cards summing to 21
 * are removable. One member of a pair may be the waste top card.
 * Stock flips one card at a time to waste; when the stock is empty the waste
 * may be recycled back a limited number of times (default 2).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SummitRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const RULESET_VERSION = 1;
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['C', 'D', 'H', 'S'];
  const TARGET = 21;
  const ROWS = 7;
  const PYRAMID_SIZE = (ROWS * (ROWS + 1)) / 2; // 28
  const STOCK_SIZE = 52 - PYRAMID_SIZE; // 24

  const SCORE = { pair: 100, clearBonus: 1000, stockCard: 10, recycleLeft: 100, invalid: -25 };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cardValue(card) { return (card % 13) + 1; }
  function cardSuit(card) { return Math.floor(card / 13); }
  function cardName(card) {
    if (card == null || card < 0 || card > 51) return '?';
    return RANKS[card % 13] + SUITS[Math.floor(card / 13)];
  }

  function rowOf(idx) {
    for (let r = 0; r < ROWS; r++) if (idx < ((r + 1) * (r + 2)) / 2) return r;
    return -1;
  }
  function rowStart(r) { return (r * (r + 1)) / 2; }
  function children(idx) {
    const r = rowOf(idx);
    if (r < 0 || r >= ROWS - 1) return null;
    const c = idx - rowStart(r);
    return [rowStart(r + 1) + c, rowStart(r + 1) + c + 1];
  }

  function isExposed(pyramid, idx) {
    if (idx < 0 || idx >= PYRAMID_SIZE || pyramid[idx] == null) return false;
    const ch = children(idx);
    if (!ch) return true; // bottom row
    return pyramid[ch[0]] == null && pyramid[ch[1]] == null;
  }

  function exposedIndices(pyramid) {
    const out = [];
    for (let i = 0; i < PYRAMID_SIZE; i++) if (isExposed(pyramid, i)) out.push(i);
    return out;
  }

  /* ---- construction ---- */

  function deal(seed) {
    const rand = mulberry32(seed >>> 0);
    const order = [];
    for (let c = 0; c < 52; c++) order.push(c);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order;
  }

  function normalizeOptions(options) {
    const o = options || {};
    let recycles = o.recycles == null ? 2 : o.recycles | 0;
    if (!(recycles >= 0) || recycles > 9) recycles = 2;
    let moveLimit = o.moveLimit == null ? null : o.moveLimit | 0;
    if (!(moveLimit > 0)) moveLimit = null;
    return { recycles, moveLimit };
  }

  function newGame(seed, options) {
    seed = (seed == null ? 1 : seed) >>> 0;
    const opts = normalizeOptions(options);
    const order = deal(seed);
    const state = {
      v: RULESET_VERSION,
      seed,
      options: opts,
      pyramid: order.slice(0, PYRAMID_SIZE),
      stock: order.slice(PYRAMID_SIZE),
      waste: [],
      recyclesLeft: opts.recycles,
      removedPairs: 0,
      moves: 0,
      invalid: 0,
      tick: 0,
      status: 'active',
      history: []
    };
    updateStatus(state);
    return state;
  }

  /* ---- status / terminal ---- */

  function hasRemove(state) {
    const exp = exposedIndices(state.pyramid);
    const vals = exp.map(i => cardValue(state.pyramid[i]));
    for (let a = 0; a < exp.length; a++)
      for (let b = a + 1; b < exp.length; b++)
        if (vals[a] + vals[b] === TARGET) return true;
    if (state.waste.length) {
      const wv = cardValue(state.waste[state.waste.length - 1]);
      for (const v of vals) if (v + wv === TARGET) return true;
    }
    return false;
  }

  function updateStatus(state) {
    if (state.pyramid.every(c => c == null)) { state.status = 'won'; return; }
    if (state.options.moveLimit != null && state.moves >= state.options.moveLimit) {
      state.status = 'lost'; return;
    }
    if (state.stock.length === 0 && state.recyclesLeft <= 0 && !hasRemove(state)) {
      state.status = 'lost'; return;
    }
    state.status = 'active';
  }

  function isTerminal(state) {
    if (!state || state.status === 'won') return { over: true, won: true, reason: 'pyramid-cleared' };
    if (state.status === 'lost') {
      if (state.options.moveLimit != null && state.moves >= state.options.moveLimit)
        return { over: true, won: false, reason: 'move-limit' };
      return { over: true, won: false, reason: 'no-moves' };
    }
    return { over: false, won: false, reason: 'in-progress' };
  }

  /* ---- legal actions ---- */

  function legalActions(state) {
    if (!state || state.status !== 'active') return [];
    const actions = [];
    const exp = exposedIndices(state.pyramid);
    for (let a = 0; a < exp.length; a++) {
      for (let b = a + 1; b < exp.length; b++) {
        if (cardValue(state.pyramid[exp[a]]) + cardValue(state.pyramid[exp[b]]) === TARGET) {
          actions.push({
            type: 'remove',
            cards: [{ zone: 'pyramid', index: exp[a] }, { zone: 'pyramid', index: exp[b] }]
          });
        }
      }
    }
    if (state.waste.length) {
      const wv = cardValue(state.waste[state.waste.length - 1]);
      for (const i of exp) {
        if (cardValue(state.pyramid[i]) + wv === TARGET) {
          actions.push({
            type: 'remove',
            cards: [{ zone: 'waste' }, { zone: 'pyramid', index: i }]
          });
        }
      }
    }
    if (state.stock.length) actions.push({ type: 'draw' });
    if (state.stock.length === 0 && state.waste.length && state.recyclesLeft > 0)
      actions.push({ type: 'recycle' });
    return actions;
  }

  /* ---- command application ---- */

  function cloneState(s) { return JSON.parse(JSON.stringify(s)); }

  function snapshot(state) {
    const s = cloneState(state);
    s.history = [];
    return s;
  }

  function err(state, reason) {
    const s = cloneState(state);
    s.invalid += 1;
    s.tick += 1;
    return { error: reason, state: s };
  }

  function cardAt(state, ref) {
    if (!ref || typeof ref !== 'object') return { error: 'bad-card-ref' };
    if (ref.zone === 'waste') {
      if (!state.waste.length) return { error: 'waste-empty' };
      return { card: state.waste[state.waste.length - 1] };
    }
    if (ref.zone === 'pyramid') {
      const i = ref.index | 0;
      if (i !== ref.index || i < 0 || i >= PYRAMID_SIZE) return { error: 'bad-card-ref' };
      if (state.pyramid[i] == null) return { error: 'card-absent' };
      return { card: state.pyramid[i], index: i };
    }
    return { error: 'bad-card-ref' };
  }

  function applyCommand(state, cmd) {
    if (!state || typeof state !== 'object') return { error: 'bad-state' };
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string')
      return { error: 'malformed-command' };
    if (state.status !== 'active' && cmd.type !== 'undo') return { error: 'game-over' };

    switch (cmd.type) {
      case 'remove': {
        if (!Array.isArray(cmd.cards) || cmd.cards.length !== 2)
          return err(state, 'malformed-command');
        const [ra, rb] = cmd.cards;
        if (ra && rb && ra.zone === 'waste' && rb.zone === 'waste')
          return err(state, 'same-card');
        if (ra && rb && ra.zone === 'pyramid' && rb.zone === 'pyramid' && ra.index === rb.index)
          return err(state, 'same-card');
        const a = cardAt(state, ra);
        if (a.error) return err(state, a.error);
        const b = cardAt(state, rb);
        if (b.error) return err(state, b.error);
        if (a.index != null && !isExposed(state.pyramid, a.index))
          return err(state, 'card-covered');
        if (b.index != null && !isExposed(state.pyramid, b.index))
          return err(state, 'card-covered');
        if (cardValue(a.card) + cardValue(b.card) !== TARGET)
          return err(state, 'not-a-pair');
        const s = cloneState(state);
        s.history.push(snapshot(state));
        if (ra.zone === 'waste' || rb.zone === 'waste') s.waste.pop();
        if (a.index != null) s.pyramid[a.index] = null;
        if (b.index != null) s.pyramid[b.index] = null;
        s.removedPairs += 1;
        s.moves += 1;
        s.tick += 1;
        updateStatus(s);
        return s;
      }
      case 'draw': {
        if (!state.stock.length) return err(state, 'stock-empty');
        const s = cloneState(state);
        s.history.push(snapshot(state));
        s.waste.push(s.stock.pop());
        s.moves += 1;
        s.tick += 1;
        updateStatus(s);
        return s;
      }
      case 'recycle': {
        if (state.stock.length) return err(state, 'stock-not-empty');
        if (!state.waste.length) return err(state, 'waste-empty');
        if (state.recyclesLeft <= 0) return err(state, 'recycle-unavailable');
        const s = cloneState(state);
        s.history.push(snapshot(state));
        s.stock = s.waste.reverse();
        s.waste = [];
        s.recyclesLeft -= 1;
        s.moves += 1;
        s.tick += 1;
        updateStatus(s);
        return s;
      }
      case 'undo': {
        if (!Array.isArray(state.history) || !state.history.length) return { error: 'nothing-to-undo' };
        const prev = cloneState(state.history[state.history.length - 1]);
        prev.history = state.history.slice(0, -1);
        prev.tick = state.tick + 1;
        return prev;
      }
      default:
        return err(state, 'unknown-type');
    }
  }

  function applyCommands(seed, commands, options) {
    let state = newGame(seed, options);
    const results = [];
    for (const cmd of commands || []) {
      const r = applyCommand(state, cmd);
      if (r && r.error) { results.push(r); state = r.state || state; }
      else { state = r; results.push({ ok: true }); }
    }
    return { state, results };
  }

  /* ---- scoring ---- */

  function scoreComponents(state) {
    const cleared = state.pyramid.every(c => c == null);
    const pairs = state.removedPairs * SCORE.pair;
    const clearBonus = cleared ? SCORE.clearBonus : 0;
    const stockBonus = state.stock.length * SCORE.stockCard;
    const recycleBonus = state.recyclesLeft * SCORE.recycleLeft;
    const invalidPenalty = state.invalid * SCORE.invalid;
    return {
      pairs, clearBonus, stockBonus, recycleBonus, invalidPenalty,
      total: pairs + clearBonus + stockBonus + recycleBonus + invalidPenalty
    };
  }

  /* ---- serialization / hashing ---- */

  function serialize(state) { return JSON.stringify(state); }

  function deserialize(json) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return { error: 'bad-json' }; }
    if (!s || typeof s !== 'object' || s.v !== RULESET_VERSION ||
        !Array.isArray(s.pyramid) || s.pyramid.length !== PYRAMID_SIZE ||
        !Array.isArray(s.stock) || !Array.isArray(s.waste))
      return { error: 'bad-state' };
    if (!Array.isArray(s.history)) s.history = [];
    return s;
  }

  function canonicalize(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
    const keys = Object.keys(obj).filter(k => k !== 'history' && k !== 'tick').sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function stateHash(state) { return fnv1a(canonicalize(state)); }

  return {
    RULESET_VERSION, RANKS, SUITS, TARGET, ROWS, PYRAMID_SIZE, STOCK_SIZE, SCORE,
    mulberry32, cardValue, cardSuit, cardName, rowOf, rowStart, children,
    isExposed, exposedIndices, deal, newGame, legalActions, applyCommand,
    applyCommands, isTerminal, scoreComponents, serialize, deserialize,
    stateHash, canonicalize, fnv1a, hasRemove
  };
});
