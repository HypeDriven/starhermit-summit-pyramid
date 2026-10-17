/* Summit Pyramid — player-facing names for rules.js / content.js data.
 * The rules and content stay English (they feed seeds, saves and best-score
 * keys); these helpers translate at display time. */
import { T } from './i18n.js';

const R = globalThis.SummitRules;
const C = globalThis.SummitContent;

const SUIT_SYMBOLS = { C: '♣', D: '♦', H: '♥', S: '♠' };
const SUIT_NAMES = { C: 'Clubs', D: 'Diamonds', H: 'Hearts', S: 'Spades' };
const RANK_NAMES = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };

/** Short card face, e.g. "Q♠" (rank letters as printed on the cards). */
export function cardShort(card) {
  if (card == null) return '—';
  return R.RANKS[card % 13] + SUIT_SYMBOLS[R.SUITS[Math.floor(card / 13)]];
}
/** Spoken card name for screen readers, e.g. "Queen of Spades". */
export function cardSpoken(card) {
  if (card == null) return T('empty');
  const rank = R.RANKS[card % 13];
  return T('{rank} of {suit}', {
    rank: RANK_NAMES[rank] ? T(RANK_NAMES[rank]) : rank,
    suit: T(SUIT_NAMES[R.SUITS[Math.floor(card / 13)]]),
  });
}

export function stageName(s) {
  if (!s) return '';
  return s.mastery ? T('Mastery: {n}', { n: s.index + 1 }) : T('Ascent {n}', { n: s.index + 1 });
}

/** Mode label for a round config (cfg.label stays English for best-score keys). */
export function modeLabel(cfg) {
  if (!cfg) return '';
  const label = String(cfg.label || '');
  let m;
  if (cfg.mode === 'learn') return T('Learn');
  if (cfg.mode === 'score') return T('Score chase');
  if (cfg.mode === 'journey') {
    const s = cfg.stageId ? C.stageById(cfg.stageId) : null;
    return T('Journey — {name}', { name: s ? stageName(s) : label.replace(/^Journey — /, '') });
  }
  if ((m = /^Daily — (.+)$/.exec(label))) return T('Daily — {date}', { date: m[1] });
  if ((m = /^Practice — (.+)$/.exec(label))) {
    const d = C.DIFFICULTIES.find(x => x.label === m[1]);
    return T('Practice — {difficulty}', { difficulty: d ? T(d.label) : m[1] });
  }
  if ((m = /^Challenge — (.+)$/.exec(label))) {
    const ch = C.CHALLENGES.find(x => x.name === m[1]);
    return T('Challenge — {name}', { name: ch ? T(ch.name) : m[1] });
  }
  return label;
}

/** Display text for a personal-best key ("<mode>:<stageId or label>"). */
export function bestKeyLabel(key) {
  const i = String(key).indexOf(':');
  const mode = key.slice(0, i), rest = key.slice(i + 1);
  if (mode === 'journey') return modeLabel({ mode, stageId: rest, label: rest });
  return modeLabel({ mode, label: rest });
}
