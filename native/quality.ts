// The look per graphics level. Engine-owned effects (shadows and their map
// size, ambient occlusion, bloom, the grade, anti-aliasing) come from the level
// (levelSettings()); the browser build's art columns (app/gfx.js TABLE /
// BUDGETS: shading, card and sand textures, segments, stars, particles) stay
// keyed by the runtime's quality tier (frame().quality), with the stars and
// particles scaled within the tier by the level's particle budget (at most
// 1.5×). The runtime owns the rest of what the old Graphics panel did: Auto and
// the level choice, render scale and the pixel-ratio cap, adaptive resolution,
// the frame-rate limit and readout. The old panel's per-effect overrides are
// not offered (Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Card, sand, dune and campfire shading: Lambert (Low), Standard (Balanced), Physical lacquered cards (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Detailed card face/back canvas width (height × 1.42). */
  card: number;
  /** Sand ripple texture size (Detail on). */
  sand: number;
  /** Curved-mesh segment multiplier. */
  seg: number;
  /** Stars at Sky animation "animated" (static: 45 %). */
  stars: number;
  /** Embers and sand motes at Particles "high" (low: 35 %). */
  particles: number;
}
export interface Look {
  preset: QualityTier;
  /** The level's shadow map size, 0 = off. */
  shadows: number;
  /** The level's ambient occlusion, null = off. */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution, null = off. */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "off" | "low" | "high";
  /** Twinkling star canopy, fire flicker. */
  animated: boolean;
  /** Rounded lacquered cards, sky dome, sand texture, campfire stones and flames. */
  detailed: boolean;
  budget: Budget;
}

/** gfx.js TABLE's art columns. */
const ART: Record<QualityTier, Omit<Look, "preset" | "budget" | "shadows" | "ao" | "bloom" | "grade" | "antialias">> = {
  low: { reflections: false, particles: "off", animated: false, detailed: false },
  balanced: { reflections: true, particles: "low", animated: true, detailed: true },
  high: { reflections: true, particles: "high", animated: true, detailed: true },
  ultra: { reflections: true, particles: "high", animated: true, detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", card: 128, sand: 128, seg: 0.6, stars: 1600, particles: 120 },
  balanced: { material: "standard", card: 256, sand: 256, seg: 0.8, stars: 2400, particles: 180 },
  high: { material: "physical", card: 256, sand: 256, seg: 1, stars: 3200, particles: 260 },
  ultra: { material: "physical", card: 512, sand: 512, seg: 1.5, stars: 4800, particles: 400 },
};
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const STAR_MAX = 7200;
export const PARTICLE_MAX = 600;

/** The look for a level's settings. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  const k = Math.min(1.5, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.stars = Math.min(STAR_MAX, Math.round(b.stars * k));
  b.particles = Math.min(PARTICLE_MAX, Math.round(b.particles * k));
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: b,
  };
}
/** gfx.js starCount / particleCount. */
export function starCount(l: Look): number { return Math.round(l.budget.stars * (l.animated ? 1 : 0.45)); }
export function particleCount(l: Look): number { return Math.round(l.budget.particles * ({ off: 0, low: 0.35, high: 1 })[l.particles]); }
