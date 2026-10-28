// Summit Pyramid — localization coverage: every English key the engine
// client (native/*.ts), the display names (app/loc.js) and the content show
// exists in all nine locales (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive translation, no table row is unused, and
// the locale follows the tag the runtime reports (app/lang.js setLang).
import test from 'node:test';
import assert from 'node:assert/strict';
import { usedKeys } from './i18n-keys.mjs';

const { TABLES, LOCALES, T, setLang, pickLocale, currentLang } = await import('../app/lang.js');
const { shText } = await import('../app/sh-i18n.js');
const PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
const has = (l, k) => { for (let x = l; x; x = PARENT[x]) if (TABLES[x] && Object.hasOwn(TABLES[x], k)) return TABLES[x][k]; return undefined; };
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every used key is translated in all nine locales with its placeholders', () => {
  const keys = usedKeys();
  assert.ok(keys.size > 150, `found ${keys.size} keys`);
  const missing = [];
  for (const k of keys) {
    for (const l of LOCALES) {
      const v = has(l, k);
      if (typeof v !== 'string' || !v) missing.push(`${l}: ${k}`);
      else if (holes(v) !== holes(k)) missing.push(`${l}: placeholders differ in "${k}" → "${v}"`);
    }
  }
  assert.deepEqual(missing, []);
});

test('tables carry no unused rows (catches typos in keys)', () => {
  const keys = usedKeys();
  assert.deepEqual(Object.keys(TABLES['en-US']).filter((k) => !keys.has(k)), []);
});

test('T fills placeholders; the locale follows the runtime tag and its fallbacks', () => {
  setLang('en-US');
  assert.equal(T('Waste recycled. {n} left.', { n: 2 }), 'Waste recycled. 2 left.');
  assert.equal(T('No such key'), 'No such key');
  assert.equal(pickLocale('de-AT'), 'de-DE');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('ja-JP'), 'en-US');
  setLang('fr-CA');
  assert.equal(currentLang(), 'fr-CA');
  assert.equal(T('You win. Score {n}', { n: 5 }), 'Gagné. Pointage 5', 'fr-CA override');
  assert.equal(T('Journey'), 'Parcours', 'fr-CA inherits fr-FR');
  assert.equal(shText('lbPosted'), 'Pointage envoyé au classement.');
  setLang('de-DE');
  assert.equal(T('Journey'), 'Reise');
  setLang('en-US');
});
