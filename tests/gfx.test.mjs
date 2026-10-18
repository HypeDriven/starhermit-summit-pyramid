// Unit tests for the pure graphics quality model (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectPreset, resolve, presetTier, choosePreset, describe, CATEGORIES, PRESETS,
  detectLevel, presetForLevel, budgetFor, starCount, particleCount, LEVELS, BUDGETS, STAR_MAX, PARTICLE_MAX,
} from '../app/gfx.js';
import { gfxStrings, pickLocale, GFX_LOCALES } from '../app/gfx-i18n.js';
// app/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../app/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M2', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'card', 'sand', 'seg', 'stars', 'particles', 'bloomRes', 'aoRes'];
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).stars > budgetFor('balanced', 4).stars, 'counts scale up within the preset');
  assert.ok(budgetFor('ultra', 20).stars <= STAR_MAX && budgetFor('ultra', 20).particles <= PARTICLE_MAX);
  assert.equal(starCount(resolve({ preset: 'high' }, 'low', 10)), BUDGETS.high.stars, 'High: animated sky, full star budget');
  assert.equal(particleCount(resolve({ preset: 'low' }, 'low', 0)), 0, 'Low: no particles');
  assert.equal(particleCount(resolve({ preset: 'high' }, 'low', 10)), BUDGETS.high.particles);
  assert.equal(resolve({}, 'low', 0).budget.material, 'lambert', 'headless SwiftShader: Low, Lambert');
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
