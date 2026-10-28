// Summit Pyramid — collects the English i18n keys the engine client, the
// display names and the content show to players.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url);
export const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const SQ = String.raw`'((?:[^'\\]|\\.)*)'`;
const DQ = String.raw`"((?:[^"\\]|\\.)*)"`;
const unq = (s) => s.replace(/\\(['"\\])/g, '$1');

/** Keys passed to T() / N() in native/*.ts and app/loc.js, plus loc.js's name tables. */
export function codeKeys() {
  const keys = new Set();
  const add = (re, src) => { for (const m of src.matchAll(re)) if (m[1] !== undefined) keys.add(unq(m[1])); };
  for (const f of readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts'))) {
    const src = read(`native/${f}`);
    add(new RegExp(String.raw`\b[TN]\(` + DQ, 'g'), src);
  }
  const loc = read('app/loc.js');
  add(new RegExp(String.raw`\bT\(` + SQ, 'g'), loc);
  for (const name of ['SUIT_NAMES', 'RANK_NAMES']) {
    const m = loc.match(new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\};'));
    add(new RegExp(':\\s*' + SQ, 'g'), m[1]);
  }
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

export function usedKeys() { return new Set([...codeKeys(), ...contentKeys()]); }
