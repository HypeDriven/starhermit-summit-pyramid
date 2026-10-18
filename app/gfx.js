/* Summit Pyramid — graphics quality model: presets, per-category overrides,
 * StarHermit hardware-level detection, per-preset asset/effect budgets and a cost summary. Pure (no three.js) so the settings panel,
 * the renderer and the unit tests agree on what a setting means. */

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],          // image-based lighting on cards and props
  particles: ['off', 'low', 'high'],   // campfire embers, drifting sand, pair sparks
  background: ['static', 'animated'],  // twinkling star canopy, fire flicker
  detail: ['plain', 'detailed'],       // rounded lacquered cards, sky dome, sand texture
};

// Each preset: a row of tiers, a device-pixel-ratio cap and a render scale.
const TABLE = {
  low: { cap: 1, scale: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'off', background: 'static', detail: 'plain' },
  balanced: { cap: 1.5, scale: 1, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'low', background: 'animated', detail: 'detailed' },
  high: { cap: 2, scale: 1, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  ultra: { cap: 2, scale: 1.25, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; app/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones and tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). The pyramid, cards,
 * stock, picking and rules are identical on every preset — only visuals change.
 *   material  card, sand, dune and campfire shading: lambert (Low) / standard (Balanced) / physical
 *             clear-coated lacquered cards (High, Ultra; Detail on)
 *   card      detailed card face/back canvas width in px (height ×1.42)
 *   sand      sand ripple texture size in px (Detail on)
 *   seg       curved-mesh segment multiplier (dunes, sky dome, moon)
 *   stars     star canopy at Sky animation "animated" (static: 45 %), scaled with the level
 *   particles embers and sand motes at Particles "high" (low: 35 %), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', card: 128, sand: 128, seg: 0.6, stars: 1600, particles: 120, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', card: 256, sand: 256, seg: 0.8, stars: 2400, particles: 180, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', card: 256, sand: 256, seg: 1, stars: 3200, particles: 260, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', card: 512, sand: 512, seg: 1.5, stars: 4800, particles: 400, bloomRes: 1, aoRes: 1 },
};
export const STAR_MAX = 7200;
export const PARTICLE_MAX = 600;
const STAR_SHARE = { static: 0.45, animated: 1 };
const PARTICLE_SHARE = { off: 0, low: 0.35, high: 1 };

/** A preset's concrete budget for a hardware level (star and particle counts scale ≤ 1.5× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(1.5, G.scaleBudget(1, lv, floor)) : 1;
  b.stars = Math.min(STAR_MAX, Math.round(b.stars * k));
  b.particles = Math.min(PARTICLE_MAX, Math.round(b.particles * k));
  return b;
}

/** Stars and particles drawn for a resolved setting (its tier's share of the preset's budget). */
export function starCount(r) { return Math.round(r.budget.stars * (STAR_SHARE[r.background] ?? 1)); }
export function particleCount(r) { return Math.round(r.budget.particles * (PARTICLE_SHARE[r.particles] ?? 0)); }

/**
 * Resolve saved settings into concrete tiers.
 * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = {
    preset, auto,
    cap: row.cap,
    renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2),
  };
  out.scale = row.scale * out.renderScale;
  for (const [cat, tiers] of Object.entries(CATEGORIES)) out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' ||
    out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears every override (keeps scale / adaptive / fps). */
export function choosePreset(saved, preset) {
  const s = saved || {};
  const out = { preset: PRESETS.includes(preset) ? preset : 'auto' };
  if (s.render_scale != null) out.render_scale = s.render_scale;
  if (s.adaptive != null) out.adaptive = s.adaptive;
  if (s.show_fps != null) out.show_fps = s.show_fps;
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

/** Cost summary. `t(key, vars)` localizes the fragments (English fallback). */
export function describe(r, pixels, t) {
  const tr = t || ((k, v) => ({
    noShadows: 'no shadows', shadowsN: `${v && v.n}² shadows`, aoOn: 'ambient occlusion', aoHigh: 'full ambient occlusion',
    bloomOn: 'bloom', reflectionsOn: 'reflections', noAA: 'no anti-aliasing',
  }[k]));
  const parts = [
    r.shadows === 'off' ? tr('noShadows') : tr('shadowsN', { n: SHADOW_MAP[r.shadows] }),
    r.ao === 'off' ? null : r.ao === 'high' ? tr('aoHigh') : tr('aoOn'),
    r.bloom === 'on' ? tr('bloomOn') : null,
    r.reflections === 'on' ? tr('reflectionsOn') : null,
    r.antialias === 'off' ? tr('noAA') : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
