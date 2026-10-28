// The look per graphics level: the browser build's four presets and budgets
// (app/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the stars and particles scaled within the tier by the level
// (frame().levelIndex, at most 1.5×), as the browser build scaled them by
// its hardware level. The runtime owns the rest of what the old Graphics
// panel did: Auto and the level choice, render scale and the pixel-ratio
// cap, adaptive resolution, the frame-rate limit and readout. The old
// panel's per-effect overrides are not offered (Options choose a level).
import type { QualityTier } from "starhermit:engine";
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
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
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

/** gfx.js TABLE. */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "off", animated: false, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "low", animated: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", animated: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", animated: true, detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", card: 128, sand: 128, seg: 0.6, stars: 1600, particles: 120, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", card: 256, sand: 256, seg: 0.8, stars: 2400, particles: 180, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", card: 256, sand: 256, seg: 1, stars: 3200, particles: 260, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", card: 512, sand: 512, seg: 1.5, stars: 4800, particles: 400, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const STAR_MAX = 7200;
export const PARTICLE_MAX = 600;

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  const k = Math.min(1.5, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.stars = Math.min(STAR_MAX, Math.round(b.stars * k));
  b.particles = Math.min(PARTICLE_MAX, Math.round(b.particles * k));
  return { preset, ...TABLE[preset], budget: b };
}
/** gfx.js starCount / particleCount. */
export function starCount(l: Look): number { return Math.round(l.budget.stars * (l.animated ? 1 : 0.45)); }
export function particleCount(l: Look): number { return Math.round(l.budget.particles * ({ off: 0, low: 0.35, high: 1 })[l.particles]); }
