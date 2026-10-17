// Summit Pyramid — collects the English i18n keys the markup, code and content show to players.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url);
export const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const unq = (s) => s.replace(/\\'/g, "'");
const STR = String.raw`'((?:[^'\\]|\\.)*)'`;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Static <body> keys, as app/i18n.js collects them. Subtrees marked
 *  data-i18n-skip, and the Graphics strings (data-i18n, the preset select) that
 *  gfx-i18n.js owns, are left out. */
export function htmlKeys() {
  let body = read('index.html');
  body = body.slice(body.indexOf('<body'), body.lastIndexOf('</body>'));
  body = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/g, '');
  for (;;) {
    const m = /<(\w+)[^>]*\b(?:data-i18n-skip|data-i18n="[^"]*"|data-gfx="preset")[^>]*>/.exec(body);
    if (!m) break;
    const re = new RegExp('<(/?)' + m[1] + '\\b[^>]*>', 'gi');
    re.lastIndex = m.index + m[0].length;
    let depth = 1, t;
    while (depth && (t = re.exec(body))) depth += t[1] ? -1 : 1;
    body = body.slice(0, m.index) + body.slice(t ? re.lastIndex : body.length);
  }
  const keys = new Set();
  for (const m of body.matchAll(/\b(aria-label|title|placeholder|alt)="([^"]*)"/g)) keys.add(norm(decode(m[2])));
  for (const m of body.matchAll(/>([^<>]+)</g)) keys.add(norm(decode(m[1])));
  return [...keys].filter((k) => /[A-Za-z]/.test(k));
}

/** Keys passed to T()/t(), plus the English tables kept in code. */
export function codeKeys() {
  const keys = new Set();
  const add = (re, src) => { for (const m of src.matchAll(re)) for (const g of m.slice(1)) if (g !== undefined) keys.add(unq(g)); };
  const table = (src, name) => {
    const m = src.match(new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\};'));
    if (!m) throw new Error('table ' + name + ' not found');
    add(new RegExp(':\\s*' + STR, 'g'), m[1]);
  };
  for (const f of ['app/main.js', 'app/ui.js', 'app/loc.js']) {
    const src = read(f);
    add(new RegExp(String.raw`\bT\(` + STR, 'g'), src);
  }
  const main = read('app/main.js');
  table(main, 'ERRORS'); table(main, 'BOARD_NOTES'); table(main, 'SYNC_TEXT');
  const loc = read('app/loc.js');
  table(loc, 'SUIT_NAMES'); table(loc, 'RANK_NAMES');
  const session = read('app/session.js');
  add(new RegExp(String.raw`\bt\(` + STR, 'g'), session);
  add(new RegExp(String.raw`(?:synced|saving|error|offline): ` + STR, 'g'), session.slice(session.indexOf('statusLine(')));
  add(new RegExp(String.raw`this\.caption\(` + STR, 'g'), read('app/audio.js'));
  return [...keys].filter((k) => /[A-Za-z]/.test(k));
}

/** Names and text from content.js shown to players. */
export function contentKeys() {
  const C = createRequire(import.meta.url)('../content.js');
  const keys = new Set();
  for (const d of C.DIFFICULTIES) { keys.add(d.label); keys.add(d.description); }
  for (const c of C.CHALLENGES) { keys.add(c.name); keys.add(c.description); }
  for (const a of C.ACHIEVEMENTS) { keys.add(a.name); keys.add(a.description); }
  for (const l of C.TUTORIAL.lessons) { keys.add(l.title); keys.add(l.text); }
  return [...keys];
}

export function usedKeys() {
  return new Set([...htmlKeys(), ...codeKeys(), ...contentKeys()]);
}
