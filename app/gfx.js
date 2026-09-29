/* Summit Pyramid — graphics quality model: presets, per-category overrides,
 * GPU detection and a cost summary. Pure (no three.js) so the settings panel,
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
export const PARTICLE_COUNT = { off: 0, low: 90, high: 260 };
export const STAR_COUNT = { static: 1400, animated: 3200 };

/** Best preset for this GPU (unmasked renderer string when the browser exposes it). */
export function detectPreset(gpu, mobile) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
  // phones and tablets never auto-select above Balanced
  if (mobile && (p === 'high' || p === 'ultra')) p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }
 */
export function resolve(saved, detected) {
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
