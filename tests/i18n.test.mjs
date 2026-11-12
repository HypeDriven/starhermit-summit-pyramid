// Summit Pyramid — localization coverage: every English key the engine
// client (native/*.ts), the display names (app/loc.js) and the content show
// exists in all nine locales (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive translation, no table row is unused, and
// the tables are the engine's strings (assets/strings.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usedKeys } from './i18n-keys.mjs';

const TABLES = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const LOCALES = ['en-US', 'es-419', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT', 'en-GB', 'es-ES', 'fr-CA', 'fr-BE', 'de-BE', 'en-SG', 'en-HK', 'en-BQ', 'es-CO', 'de-IT', 'fr-IT', 'es-CL', 'es-AR', 'es-EC', 'ja-JP', 'zh-SG', 'ms-SG', 'sv-FI', 'id-ID', 'vi-VN', 'de-BR', 'ta-SG', 'zh-HK', 'yue-HK', 'fi-FI', 'et-EE', 'da-DE', 'nl-BE', 'lb-BE', 'co-FR', 'eu-FR', 'ca-FR', 'nl-NL', 'sl-IT', 'ca-IT', 'ca-ES', 'eu-ES', 'gl-ES', 'su-ID', 'km-VN', 'ru-FI', 'ru-EE', 'oc-FR', 'fur-IT', 'oc-IT', 'bew-ID'];
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

test('the regional tables inherit', () => {
  for (const l of LOCALES) assert.ok(TABLES[l], l);
  assert.equal(has('fr-CA', 'You win. Score {n}'), 'Gagné. Pointage {n}', 'fr-CA override');
  assert.equal(has('fr-CA', 'Journey'), 'Parcours', 'fr-CA inherits fr-FR');
  assert.equal(has('de-DE', 'Journey'), 'Reise');
});
