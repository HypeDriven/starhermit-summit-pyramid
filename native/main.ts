// Summit Pyramid on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (rules.js) and content (content.js)
// are the browser build's, unchanged; this module is what app/main.js did
// around them — the flow (title → modes / journey / practice / challenge /
// help / settings / leaderboard → a round ⇄ pause → results), starting every
// mode (Learn's five lessons, Journey, Daily, Practice, Challenge, Score
// chase), selecting cards by pointer, touch, keys and pads, draw, recycle,
// undo and the hint, the lesson panel, the results with achievements, the
// streak and stage progress, the leaderboard post of ranked rounds, "Resume
// last game", and the lifecycle (a hidden window pauses the round, as
// visibilitychange did). Screens are drawn by screens.ts (starhermit:ui),
// the tableau by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps: toasts, captions and the pad's notes
// run on a clock advanced 1/60 s per fixed step.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { bindings, onAction, onPointerButton, onTouch, primaryPointer } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { C, Loc, R, type Achievement, type CardRef, type Command, type Lesson, type RoundCfg, type Score, type State, type Terminal, type Theme } from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type Overlay = "title" | "modes" | "journey" | "practice" | "challenge" | "pause" | "results" | "help" | "settings" | "board" | null;
export interface Round {
  cfg: RoundCfg; state: State; selection: CardRef[]; commands: Command[]; used: Set<string>; tutorialStep: number | null; lesson: Lesson | null;
}
export interface Results { terminal: Terminal; score: Score; cfg: RoundCfg; achievements: Achievement[]; note: () => string; lb: platform.Posted | "posting" | null }
export type BoardView = { entries: platform.BoardRow[] } | { local: "none" | "unavailable" | "local" } | null;

export const app = {
  overlay: "title" as Overlay,
  openedFrame: 0,
  focusNext: null as string | null,
  /** boot|title|modes|tutorial|active|paused|results (main.js flow). */
  flow: "title",
  game: null as Round | null,
  kbFocus: null as CardRef | null,
  keyNav: false,
  returnTo: "title" as "title" | "pause" | "modes",
  results: null as Results | null,
  board: null as BoardView,
  seedText: "",
  toasts: [] as { text: string; until: number }[],
  caption: null as { text: string; until: number } | null,
};
let clockMs = 0;
export const now = (): number => clockMs / 1000;
export const fresh = (): boolean => frame().frame !== app.openedFrame;
let actionSeq = 0;

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
let spokenAssertive = false;
/** The live regions (#live polite, #live-err assertive): one announcement a frame, joined. */
export function announce(text: string, assertive = false): void {
  if (!text) return;
  spoken.push(text);
  spokenAssertive ||= assertive;
}
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).join(" ").slice(0, 500);
  try { ui.announce(text, { politeness: spokenAssertive ? "assertive" : "polite" }); } catch { /* busy */ }
  spokenAssertive = false;
}
/** ui.js toast (one at a time, as #toast). */
export function toast(text: string, ms = 2200): void { app.toasts = [{ text, until: now() + ms / 1000 }]; }
const CAPTIONS: Partial<Record<audio.Sfx, string>> = {
  select: N("select"), removePair: N("pair removed"), invalid: N("invalid move"), draw: N("card drawn"),
  recycle: N("waste recycled"), undo: N("undo"), win: N("pyramid cleared — you win"), lose: N("no moves left — round over"),
};
/** audio.js events with their captions (Settings › Audio captions). */
export function sound(ev: audio.Sfx): void {
  audio.play(ev);
  const c = CAPTIONS[ev];
  if (c && platform.options.captions) app.caption = { text: `♪ ${T(c)}`, until: now() + 1.6 };
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built. */
export function later(fn: () => void): void { pending.push(fn); }
export function themeFor(id: string | undefined): Theme { return C.THEMES.find((t) => t.id === id) || C.THEMES[0]!; }
export const inRound = (): boolean => app.flow === "active" || app.flow === "tutorial";

// ------------------------------------------------------------------ overlays
export function open(o: Overlay, focus: string | null = null): void {
  app.overlay = o;
  app.openedFrame = frame().frame;
  app.focusNext = focus ?? (primaryPointer() === "coarse" || frame().width / ui.preferences().scale < 600 ? null : firstFocus(o));
  ui.setFocus(null);
}
function firstFocus(o: Overlay): string | null {
  switch (o) {
    case "title": return "btn-play";
    case "modes": return "mode-learn";
    case "journey": return "stage-1";
    case "practice": return "diff-easy";
    case "challenge": return `ch-${C.CHALLENGES[0]!.id}`;
    case "pause": return "btn-resume-pause";
    case "results": return "btn-next";
    case "help": case "settings": case "board": return "btn-back";
    default: return null;
  }
}

// ------------------------------------------------------------------ round lifecycle (main.js)
export function startRound(cfg: RoundCfg): void {
  app.flow = "preparing";
  const options = { recycles: 2, moveLimit: null, ...(cfg.options || {}) };
  const game: Round = { cfg, state: R.newGame(cfg.seed, options), selection: [], commands: [], used: new Set(), tutorialStep: cfg.tutorial ? 0 : null, lesson: null };
  app.game = game;
  const theme = themeFor(cfg.themeId || C.THEMES[cfg.seed % C.THEMES.length]?.id || "dusk");
  app.kbFocus = null;
  app.results = null;
  render.setMenuMode(false);
  render.buildEnv(theme, cfg.seed);
  render.buildBoard(game.state, theme);
  if (cfg.tutorial) enterTutorialLesson();
  app.flow = cfg.tutorial ? "tutorial" : "active";
  app.overlay = null;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  syncAll();
  audio.startAmbience(now());
  announce(`${T("{mode} started.", { mode: Loc.modeLabel(cfg) })} ${T("Clear the pyramid — pair exposed cards to 14.")}`);
  persistSnapshot();
}
function enterTutorialLesson(): void {
  const g = app.game!;
  const lesson = C.TUTORIAL.lessons[g.tutorialStep!]!;
  g.lesson = lesson;
  g.state = R.newGame(lesson.seed, { recycles: lesson.recycles == null ? 2 : lesson.recycles });
  if (lesson.drawAll) while (g.state.stock.length) g.state = R.applyCommand(g.state, { type: "draw" }) as State;
  render.buildBoard(g.state, render.currentTheme() || themeFor("dusk"));
  g.selection = [];
}
/** The lesson panel's lines (main.js labelLesson). */
export function lessonText(): { title: string; text: string; hint: string } | null {
  const g = app.game;
  if (!g || !g.lesson || app.flow !== "tutorial") return null;
  const l = g.lesson;
  return {
    title: `${g.tutorialStep! + 1}/${C.TUTORIAL.lessons.length} — ${T(l.title)}`,
    text: T(l.text),
    hint: l.require.type === "remove"
      ? (l.require.waste ? T("Pair the waste top card with a pyramid card.") : T("Select two exposed cards totaling 14."))
      : l.require.type === "draw" ? T("Press Draw ({key}).", { key: keysFor("draw") }) : T("Press Recycle ({key}).", { key: keysFor("recycle") }),
  };
}

function endRound(terminal: Terminal): void {
  const g = app.game!;
  app.flow = "resolving";
  const score = R.scoreComponents(g.state);
  const won = terminal.won;
  const save = platform.progress();
  save.stats.totalPairs += g.state.removedPairs;
  const unlocked: Achievement[] = [];
  if (won) {
    save.stats.wins++; save.stats.streak++;
    grant("first-clear", unlocked);
    if (g.used.has("draw") && g.used.has("recycle") && g.used.has("undo")) grant("mechanic-master", unlocked);
    if (save.stats.streak >= 3) grant("streak-3", unlocked);
    if (g.cfg.stageId) {
      const stage = C.stageById(g.cfg.stageId)!;
      const prev = save.journey.completed[stage.id];
      if (prev == null || score.total > prev) save.journey.completed[stage.id] = score.total;
      save.journey.unlocked = Math.max(save.journey.unlocked, Math.min(C.STAGE_COUNT, stage.index + 2));
      if (stage.index >= 19) grant("stage-20", unlocked);
    }
  } else { save.stats.losses++; save.stats.streak = 0; }
  if (save.stats.totalPairs >= 500) grant("pairs-500", unlocked);
  const bestKey = `${g.cfg.mode}:${g.cfg.stageId || g.cfg.label}`;
  if (won && (!save.best[bestKey] || score.total > save.best[bestKey]!.score)) save.best[bestKey] = { score: score.total, seed: g.state.seed };
  save.snapshot = null;
  platform.persist();
  const ranked = g.cfg.ranked;
  const note = ranked && platform.signedIn() ? () => T("Ranked round recorded in your cloud save and posted to the StarHermit leaderboard.")
    : ranked ? () => T("Ranked game recorded locally (no server connection).") : () => T("Unranked local game.");
  const r: Results = { terminal, score, cfg: g.cfg, achievements: unlocked, note, lb: null };
  app.results = r;
  app.flow = "results";
  open("results");
  sound(won ? "win" : "lose");
  announce(won ? T("You win. Score {n}", { n: score.total }) : T("Round over. Score {n}", { n: score.total }));
  // signed in only: post a ranked round to the high-score board and show the rank
  if (ranked && platform.signedIn()) {
    r.lb = "posting";
    void platform.postScore(Math.max(0, score.total)).then((res) => { r.lb = res; });
  }
}
export function resultsLbLine(): string | null {
  const lb = app.results?.lb;
  if (!lb) return null;
  if (lb === "posting") return S("lbPosting");
  return !lb.posted ? S("lbNotPosted") : lb.rank ? S("lbRank", { rank: lb.rank }) : S("lbPosted");
}
function grant(id: string, unlocked: Achievement[]): void {
  const save = platform.progress();
  if (save.achievements[id]) return;
  const meta = C.ACHIEVEMENTS.find((a) => a.id === id);
  if (!meta) return;
  save.achievements[id] = Math.round(platform.nowMs());
  unlocked.push(meta);
}
function persistSnapshot(): void {
  const g = app.game;
  const save = platform.progress();
  if (!g || g.cfg.tutorial) save.snapshot = null;
  else save.snapshot = JSON.parse(JSON.stringify({ cfg: g.cfg, state: g.state, commands: g.commands, used: [...g.used] }));
  platform.persist();
}

// ------------------------------------------------------------------ commands
export function doCommand(cmd: Command): void {
  const g = app.game;
  if (!g || !inRound()) return;
  cmd = { ...cmd, id: `c${g.state.seed}-${++actionSeq}` };
  const before = g.state;
  const res = R.applyCommand(before, cmd);
  if ("error" in res) {
    g.state = res.state || before;
    sound("invalid");
    const msg = explainError(res.error);
    announce(msg, true);
    toast(msg);
    syncAll();
    return;
  }
  g.state = res;
  g.commands.push(cmd);
  g.used.add(cmd.type);
  if (cmd.type === "remove") {
    sound("removePair");
    render.animateRemoval(cmd.cards!, () => undefined);
    announce(`${T("Removed {cards}.", { cards: describeCards(before, cmd.cards!, Loc.cardSpoken) })} ${R.isTerminal(g.state).over ? "" : hintText(Loc.cardSpoken)}`);
  } else if (cmd.type === "draw") { sound("draw"); announce(T("Drew {card}.", { card: Loc.cardSpoken(g.state.waste[g.state.waste.length - 1]!) })); }
  else if (cmd.type === "recycle") { sound("recycle"); announce(T("Waste recycled. {n} left.", { n: g.state.recyclesLeft })); }
  else if (cmd.type === "undo") { sound("undo"); announce(T("Undone.")); }
  g.selection = [];
  app.kbFocus = null;
  const t = R.isTerminal(g.state);
  if (app.flow === "tutorial" && g.lesson && lessonSatisfied(cmd)) { advanceTutorial(); if (app.flow !== "tutorial") return; }
  if (t.over && app.flow !== "tutorial") { persistSnapshot(); syncAll(); endRound(t); return; }
  if (t.over && app.flow === "tutorial") g.state = R.newGame(g.lesson!.seed, { recycles: 2 }); // lessons can't be lost
  persistSnapshot();
  syncAll();
}
function lessonSatisfied(cmd: Command): boolean {
  const req = app.game!.lesson!.require;
  if (req.type !== cmd.type) return false;
  if (req.waste) return !!cmd.cards && cmd.cards.some((c) => c.zone === "waste");
  return true;
}
export function advanceTutorial(): void {
  const g = app.game!;
  g.tutorialStep = g.tutorialStep! + 1;
  sound("select");
  if (g.tutorialStep >= C.TUTORIAL.lessons.length) {
    platform.progress().settings.tutorialDone = true;
    platform.persist();
    toast(T("Lessons complete!"));
    quitToModes();
    return;
  }
  enterTutorialLesson();
  syncAll();
}
const ERRORS: Record<string, string> = {
  "not-a-pair": N("Those cards do not total 14."),
  "card-covered": N("That card is still covered by cards below it."),
  "card-absent": N("That card is already removed."),
  "stock-empty": N("The stock is empty — recycle the waste if you can."),
  "stock-not-empty": N("You can only recycle when the stock is empty."),
  "recycle-unavailable": N("No recycles left."),
  "nothing-to-undo": N("Nothing to undo."),
  "same-card": N("Pick two different cards."),
  "waste-empty": N("The waste pile is empty."),
  "game-over": N("This round is over."),
};
function explainError(err: string): string { return ERRORS[err] ? T(ERRORS[err]!) : T("That action is not legal right now ({code}).", { code: err }); }
function describeCards(state: State, refs: CardRef[], name: (c: number | null) => string = Loc.cardShort): string {
  return refs.map((r) => (r.zone === "waste" ? name(state.waste[state.waste.length - 1]!) : name(state.pyramid[r.index!]!))).join(" + ");
}
export function hintText(name: (c: number | null) => string = Loc.cardShort): string {
  const g = app.game!;
  const acts = R.legalActions(g.state);
  const rem = acts.find((a) => a.type === "remove");
  if (rem) return T("Hint: {cards} totals 14.", { cards: describeCards(g.state, rem.cards!, name) });
  if (acts.some((a) => a.type === "draw")) return T("Hint: draw from the stock.");
  if (acts.some((a) => a.type === "recycle")) return T("Hint: recycle the waste.");
  return T("No moves left.");
}
export function doHint(): void {
  const g = app.game;
  if (!g || app.flow !== "active") return;
  toast(hintText(), 3500);
  announce(hintText(Loc.cardSpoken));
  sound("select");
  const rem = R.legalActions(g.state).find((a) => a.type === "remove");
  if (rem) { g.selection = rem.cards!.slice(0, 1); syncAll(); }
}
export function showBreakdown(): void {
  const g = app.game;
  if (!g) return;
  const s = R.scoreComponents(g.state);
  toast(T("Pairs {pairs} · Clear {clear} · Stock {stock} · Recycle {recycle} · Penalty {penalty}", {
    pairs: s.pairs, clear: s.clearBonus, stock: s.stockBonus, recycle: s.recycleBonus, penalty: s.invalidPenalty,
  }), 4000);
}

/** main.js tapTarget: the stock draws; a card toggles its selection; a second card removes the pair. */
export function tapTarget(ref: CardRef): void {
  const g = app.game;
  if (!g || !inRound()) return;
  if (ref.zone === "stock") { doCommand({ type: "draw" }); return; }
  const already = g.selection.findIndex((s) => s.zone === ref.zone && s.index === ref.index);
  if (already >= 0) { g.selection.splice(already, 1); sound("deselect"); syncAll(); return; }
  g.selection.push(ref);
  sound("select");
  if (g.selection.length === 2) doCommand({ type: "remove", cards: g.selection.slice(0, 2) });
  else {
    announce(T("Selected {card}. Pick a second card totaling 14.", { card: describeRef(ref) }));
    syncAll();
  }
}
export function describeRef(ref: CardRef): string {
  const g = app.game!;
  if (ref.zone === "waste") return T("waste {card}", { card: Loc.cardSpoken(g.state.waste[g.state.waste.length - 1]!) });
  return Loc.cardSpoken(g.state.pyramid[ref.index!]!);
}
export function syncAll(): void {
  const g = app.game;
  if (!g) return;
  render.sync(g.state, g.selection);
  audio.setIntensity(g.state.pyramid.filter((c) => c != null).length < 10 ? 0.8 : 0.2);
}

// ------------------------------------------------------------------ flow
export function quitToModes(): void {
  app.game = null;
  render.setMenuMode(true);
  app.flow = "modes";
  open("modes");
  audio.stopAmbience();
}
export function goTitle(): void {
  app.game = null;
  render.setMenuMode(true);
  app.flow = "title";
  open("title");
  audio.stopAmbience();
}
export function showModes(): void { app.flow = "modes"; open("modes"); }
export function play(): void {
  if (!platform.progress().settings.tutorialDone) startLearn();
  else showModes();
}
export function startLearn(): void { startRound({ mode: "learn", label: "Learn", seed: 101, tutorial: true, themeId: "dusk", ranked: false }); }
export function startJourneyStage(id: string): void {
  const s = C.stageById(id);
  if (!s) return;
  startRound({
    mode: "journey", label: `Journey — ${s.name}`, seed: s.seed, options: s.mechanics, themeId: s.theme, stageId: s.id, ranked: false,
    tutorial: s.tutorial && !platform.progress().settings.tutorialDone,
  });
}
export function startDaily(): void {
  const d = new Date(platform.nowMs());
  const seed = C.dailySeed(d);
  startRound({ mode: "daily", label: `Daily — ${C.dailyId(d)}`, seed, options: { recycles: 2 }, themeId: C.THEMES[seed % C.THEMES.length]!.id, ranked: true });
}
const randomSeed = (): number => Math.floor(Math.random() * 0xffffffff) >>> 0;
export function startScoreChase(): void { startRound({ mode: "score", label: "Score chase", seed: randomSeed(), options: { recycles: 2 }, ranked: true }); }
export function startPractice(d: (typeof C.DIFFICULTIES)[number]): void {
  const raw = app.seedText.trim();
  let seed = randomSeed();
  if (raw) {
    if (!/^\d{1,10}$/.test(raw)) toast(T("Seeds are numbers only — using a random deal."));
    else seed = parseInt(raw, 10) >>> 0;
  }
  startRound({ mode: "practice", label: `Practice — ${d.label}`, seed, options: { recycles: d.recycles }, ranked: false });
}
export function startChallenge(ch: (typeof C.CHALLENGES)[number]): void {
  startRound({ mode: "challenge", label: `Challenge — ${ch.name}`, seed: ch.seed, options: ch.mechanics, ranked: false });
}
export function resumeLast(): void {
  const snap = platform.progress().snapshot;
  if (!snap) return;
  startRound(snap.cfg);
  const g = app.game!;
  g.state = snap.state;
  g.commands = snap.commands || [];
  g.used = new Set(snap.used || []);
  render.buildBoard(g.state, render.currentTheme()!);
  persistSnapshot(); // keep the resumable snapshot at the restored position
  syncAll();
}
export function pauseGame(silent = false): void {
  if (!app.game || app.flow !== "active") return;
  app.flow = "paused";
  open("pause");
  if (!silent) sound("select");
}
export function resumeGame(): void {
  if (!app.game) return;
  app.flow = "active";
  app.overlay = null;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
}
export function restart(): void { startRound(app.game!.cfg); }
export function leaveRound(): void { platform.progress().snapshot = null; platform.persist(); quitToModes(); }
export function retry(): void { startRound(app.game!.cfg); }
export function nextAfterResults(): void {
  const g = app.game!;
  if (g.cfg.stageId) {
    const s = C.stageById(g.cfg.stageId)!;
    const nx = C.STAGES[s.index + 1];
    if (nx && nx.index + 1 <= platform.progress().journey.unlocked) { startJourneyStage(nx.id); return; }
  }
  quitToModes();
}
export function showHelp(from: "title" | "pause"): void { app.returnTo = from; open("help"); }
export function showSettings(from: "title" | "pause"): void { app.returnTo = from; open("settings"); }
/** The `back` buttons with data-back="auto". */
export function backAuto(): void {
  if (app.returnTo === "pause" && app.game) open("pause");
  else if (app.returnTo === "modes") showModes();
  else goTitle();
}
export async function showLeaderboards(): Promise<void> {
  open("board");
  app.board = null;
  if (platform.signedIn()) {
    try {
      const entries = await platform.topEntries(20);
      app.board = entries ? { entries } : { local: "none" };
    } catch { app.board = { local: "unavailable" }; }
  } else app.board = { local: "local" };
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied")); } catch { toast(S("copyFail", { url: link }), 6000); }
}

// ------------------------------------------------------------------ keys and pads (main.js onKey)
const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
/** main.js keyLabel over the effective bindings (the runtime's rebinding). */
export function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join("/") || "—";
}
function navTargets(): CardRef[] {
  const g = app.game!;
  const out: CardRef[] = R.exposedIndices(g.state.pyramid).map((i) => ({ zone: "pyramid", index: i }));
  if (g.state.waste.length) out.push({ zone: "waste" });
  return out;
}
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  if (a === "cancel") {
    if (app.overlay === "pause" && fresh()) later(resumeGame);
    else if (!app.overlay && inRound()) {
      const g = app.game!;
      if (g.selection.length) { g.selection = []; syncAll(); sound("deselect"); }
      else later(() => pauseGame());
    }
    return;
  }
  if (app.overlay || !app.game || !inRound()) return;
  switch (a) {
    case "undo": later(() => doCommand({ type: "undo" })); return;
    case "hint": later(doHint); return;
    case "draw": later(() => doCommand({ type: "draw" })); return;
    case "recycle": later(() => doCommand({ type: "recycle" })); return;
    case "camera": render.resetCamera(); return;
  }
  if (ui.focused() !== null) {
    // Enter on a focused tray button is the button's; arrows leave the UI for the board
    if (a === "confirm") return;
    ui.setFocus(null);
  }
  if (a === "prev" || a === "next") {
    const targets = navTargets();
    if (!targets.length) return;
    const f = app.kbFocus;
    const i = targets.findIndex((t) => t.zone === f?.zone && t.index === f?.index);
    const d = a === "next" ? 1 : -1;
    app.kbFocus = targets[(i + d + targets.length) % targets.length]!;
    app.keyNav = true;
    announce(T("Focused {card}. {key} to select.", { card: describeRef(app.kbFocus), key: keysFor("confirm") }));
    sound("select");
    return;
  }
  if (a === "confirm" && app.kbFocus) { const t = app.kbFocus; app.kbFocus = null; later(() => tapTarget(t)); }
});

// ------------------------------------------------------------------ pointer and touch on the tableau (canvas pointerdown)
const presses: { x: number; y: number }[] = [];
let lastTouch = -1e9;
onTouch((e) => {
  lastTouch = now();
  if (e.control || !e.primary || e.phase !== "start" || ui.pointerCaptured()) return;
  presses.push({ x: e.x, y: e.y });
});
onPointerButton((e) => {
  if (e.button !== 0 || !e.pressed || now() - lastTouch < 0.6 || ui.pointerCaptured()) return;
  presses.push({ x: e.x, y: e.y });
});
/** The scene's view (the old canvas less the lesson panel), window px, set by screens.ts. */
export const view = { x: 0, y: 0, width: 0, height: 0 };
export const board = { x: 0, y: 0, width: 0, height: 0 };
function pointerInput(wasRound: boolean): void {
  const list = presses.splice(0);
  if (!wasRound || !inRound() || app.overlay || platform.options.domBoard) return;
  for (const p of list) {
    if (p.x < board.x || p.y < board.y || p.x > board.x + board.width || p.y > board.y + board.height) continue;
    const hit = render.pick(p.x, p.y);
    if (hit) { app.keyNav = false; tapTarget(hit); }
  }
}

// ------------------------------------------------------------------ the clock
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / 60;
  audio.tick(now());
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  render.setPalette(platform.options.cvd);
  applyLook();
  render.setMenuMode(true);
  render.buildEnv(themeFor("dusk"), 1);
  render.setActive(true);
  goTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => render.setPalette(platform.options.cvd));
onSessionEnded(() => toast(S("signedOut"), 4000));
onSuspend(() => {
  hidden = true;
  if (app.flow === "active" && !app.overlay) pauseGame(true);
  platform.flush();
});
onResume(() => { hidden = false; });

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  const t = now();
  app.toasts = app.toasts.filter((x) => x.until >= t);
  if (app.caption && app.caption.until < t) app.caption = null;
});
onRender(() => {
  const wasRound = inRound() && !app.overlay;
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasRound);
  const f = frame();
  render.update(frameDt, f.width, f.height, view, 6 * f.scale, f.scale);
  flushAnnouncements();
});
