// The browser build's pure game modules (shared with the node tests and the
// dev server), typed for this client: the rules (rules.js: the deal, legal
// actions, commands with undo, scoring), the content (content.js: themes,
// the 40 Journey stages, the five lessons, the Daily seed, challenges,
// difficulties, achievements), the display names (app/loc.js) and the save
// model (app/save.js). rules.js and content.js are classic UMD scripts: they
// set globalThis.SummitRules / SummitContent when imported here.
import "../rules.js";
import "../content.js";
import * as loc from "../app/loc.js";
import * as save from "../app/save.js";

export type Zone = "pyramid" | "waste" | "stock";
export interface CardRef { zone: Zone; index?: number }
export interface Options { recycles: number; moveLimit: number | null }
export interface State {
  v: number; seed: number; options: Options; pyramid: (number | null)[]; stock: number[]; waste: number[];
  recyclesLeft: number; removedPairs: number; moves: number; invalid: number; tick: number;
  status: "active" | "won" | "lost"; history: State[];
}
export interface Command { type: "remove" | "draw" | "recycle" | "undo"; cards?: CardRef[]; id?: string }
export interface Action { type: "remove" | "draw" | "recycle"; cards?: CardRef[] }
export interface Terminal { over: boolean; won: boolean; reason: "pyramid-cleared" | "move-limit" | "no-moves" | "in-progress" }
export interface Score { pairs: number; clearBonus: number; stockBonus: number; recycleBonus: number; invalidPenalty: number; total: number }
export interface Theme { id: string; name: string; sky: number; horizon: number; sand: number; accent: number; cardBack: number; marker: number }
export interface Stage {
  id: string; index: number; seed: number; name: string; par: { score: number; moves: number }; mechanics: Options;
  tutorial: boolean; mastery: boolean; theme: string; difficulty: number;
}
export interface Lesson { id: string; title: string; text: string; require: { type: string; waste?: boolean }; seed: number; recycles?: number; drawAll?: boolean }
export interface Challenge { id: string; name: string; description: string; mechanics: Options; seed: number; difficulty: number }
export interface Difficulty { id: string; label: string; recycles: number; description: string }
export interface Achievement { id: string; name: string; description: string }

interface RulesApi {
  TARGET: number; RANKS: string[]; SUITS: string[]; PYRAMID_SIZE: number;
  newGame(seed: number, options?: Partial<Options>): State;
  legalActions(s: State): Action[];
  applyCommand(s: State, c: Command): State | { error: string; state?: State };
  isTerminal(s: State): Terminal;
  scoreComponents(s: State): Score;
  isExposed(pyr: (number | null)[], i: number): boolean;
  exposedIndices(pyr: (number | null)[]): number[];
  cardValue(c: number): number;
}
interface ContentApi {
  THEMES: Theme[]; STAGES: Stage[]; STAGE_COUNT: number; stageById(id: string): Stage | null;
  TUTORIAL: { lessons: Lesson[] }; dailySeed(d: Date | number): number; dailyId(d: Date | number): string;
  CHALLENGES: Challenge[]; DIFFICULTIES: Difficulty[]; ACHIEVEMENTS: Achievement[];
}
export const R = (globalThis as unknown as { SummitRules: RulesApi }).SummitRules;
export const C = (globalThis as unknown as { SummitContent: ContentApi }).SummitContent;

export interface RoundCfg {
  mode: string; label: string; seed: number; options?: Partial<Options>; themeId?: string; stageId?: string; ranked: boolean; tutorial?: boolean;
}
export interface Snapshot { cfg: RoundCfg; state: State; commands: Command[]; used: string[] }
export interface SaveDoc {
  version: number; settings: { tutorialDone: boolean }; journey: { unlocked: number; completed: Record<string, number> };
  achievements: Record<string, number>; best: Record<string, { score: number; seed: number }>;
  stats: { wins: number; losses: number; streak: number; totalPairs: number }; snapshot: Snapshot | null;
}
export interface GameOptions { captions: boolean; cvd: "default" | "deuter" | "tritan"; leftHanded: boolean; domBoard: boolean }
interface SaveApi {
  defaultSave(): SaveDoc; normalize(raw: unknown): SaveDoc; mergeSaves(a: unknown, b: unknown): SaveDoc; sameSave(a: unknown, b: unknown): boolean;
  readForeign(text: string): SaveDoc | null;
  DEFAULT_OPTIONS: GameOptions; OPTION_KEYS: (keyof GameOptions)[]; PALETTES: GameOptions["cvd"][]; BROWSER_KEYS: string[];
  pickOptions(raw: unknown): Partial<GameOptions>; readLegacySettings(kv: Record<string, unknown>): { options: Partial<GameOptions>; tutorialDone: boolean };
}
export const SaveModel = save as unknown as SaveApi;
interface LocApi {
  cardShort(c: number | null): string; cardSpoken(c: number | null): string; stageName(s: Stage): string;
  modeLabel(cfg: RoundCfg | null): string; bestKeyLabel(k: string): string;
}
export const Loc = loc as unknown as LocApi;
