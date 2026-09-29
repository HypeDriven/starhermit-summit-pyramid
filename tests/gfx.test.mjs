// Unit tests for the pure graphics quality model (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPreset, resolve, presetTier, choosePreset, describe, CATEGORIES, PRESETS } from '../app/gfx.js';
import { gfxStrings, pickLocale, GFX_LOCALES } from '../app/gfx-i18n.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Mali-G78'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  // mobile caps Auto at balanced
  assert.equal(detectPreset('Apple M2', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
});

test('resolve: auto follows detection, explicit preset wins', () => {
  const a = resolve({ preset: 'auto' }, 'low');
  assert.equal(a.preset, 'low'); assert.equal(a.auto, true);
  assert.equal(a.post, false, 'Low renders without post-processing');
  assert.equal(a.shadows, 'off');
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high'); assert.equal(h.auto, false);
  assert.equal(h.shadows, presetTier('high', 'shadows'));
  assert.equal(h.post, true);
  assert.equal(resolve(undefined, undefined).preset, 'balanced');
});

test('resolve: overrides apply, invalid values fall back to the preset', () => {
  const r = resolve({ preset: 'high', bloom: 'off', particles: 'bogus' }, 'low');
  assert.equal(r.bloom, 'off');
  assert.equal(r.particles, presetTier('high', 'particles'));
  for (const cat of Object.keys(CATEGORIES)) assert.ok(CATEGORIES[cat].includes(r[cat]), cat);
});

test('resolve: render scale is clamped to 50–200%', () => {
  assert.equal(resolve({ preset: 'low', render_scale: 5 }).renderScale, 2);
  assert.equal(resolve({ preset: 'low', render_scale: 0.1 }).renderScale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  assert.equal(resolve({ preset: 'low' }).adaptive, true);
  assert.equal(resolve({ preset: 'low' }).showFps, false);
});

test('choosing a preset clears overrides but keeps scale / adaptive / fps', () => {
  const s = choosePreset({ preset: 'high', bloom: 'off', shadows: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'low');
  assert.deepEqual(s, { preset: 'low', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.equal(choosePreset({}, 'nonsense').preset, 'auto');
});

test('describe summarizes cost', () => {
  const d = describe(resolve({ preset: 'high' }), [1280, 720]);
  assert.match(d, /2048² shadows/); assert.match(d, /bloom/); assert.match(d, /SMAA/); assert.match(d, /1280×720 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('every required locale has every graphics string', () => {
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) assert.ok(GFX_LOCALES.includes(loc), loc);
  const en = gfxStrings('en-GB');
  for (const loc of GFX_LOCALES) {
    const t = gfxStrings(loc);
    for (const k of ['graphics', 'quality', 'auto', 'renderScale', 'adaptive', 'showFps', 'fromPreset', 'postFailed', ...PRESETS,
      ...Object.keys(CATEGORIES), ...new Set(Object.values(CATEGORIES).flat())]) {
      assert.ok(t(k) && t(k) !== k, `${loc}: ${k}`);
    }
  }
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(gfxStrings('de-DE')('fromPreset', { tier: 'Hoch' }), 'Aus Voreinstellung (Hoch)');
  assert.notEqual(en('graphics'), '');
});
