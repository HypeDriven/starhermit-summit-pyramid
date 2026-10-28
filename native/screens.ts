// The browser build's DOM shell (app/ui.js + index.html) as starhermit:ui,
// built every frame over the tableau: the top bar (objective, score with the
// breakdown button, moves against the limit, the deal seed, the mode, the
// player and cloud-sync line), the tray (Draw with the stock count, the
// waste pile, Recycle with the recycles left, Undo, Hint, Pause; mirrored
// for the left-handed tray), the lesson panel (non-modal, above the tray;
// beside the board in short landscape), the captions line, the toast, named
// targets over the cards (the canvas picking's accessible mirror: screen
// readers and play scripts find them), the 2D board (Settings › 2D board:
// one button per pyramid slot and the waste, over the tableau) and every
// screen (title, modes, journey, practice, challenge, pause, results, help,
// settings, leaderboard) as dialogs over the dimmed tableau. The old media
// queries are layouts picked by the window's logical size (≤ 720 px wide:
// compact bars; ≤ 500 px tall landscape: the lesson panel at the side). The
// scene's view rectangle goes to main.ts (view → render.ts).
import { frame, openMenu } from "starhermit:engine";
import { requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { C, Loc, R, SaveModel, type CardRef } from "./game.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { token } from "./style.ts";
import {
  app, advanceTutorial, backAuto, board, doCommand, doHint, fresh, goTitle, inRound, invite, keysFor, later, leaveRound, lessonText,
  nextAfterResults, pauseGame, play, quitToModes, restart, resultsLbLine, resumeGame, resumeLast, retry, showBreakdown, showHelp,
  showLeaderboards, showModes, showSettings, signIn, sound, startChallenge, startDaily, startJourneyStage, startLearn, startPractice,
  startScoreChase, tapTarget, view,
} from "./main.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; compact: boolean; land: boolean; ox: number; oy: number }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, compact: lw <= 720, land: lh <= 500 && lw > lh, ox: sa.left, oy: sa.top };
}
const lastSize = new Map<string, ui.Rect>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn {
  id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; sub?: string; width?: number; height?: number;
}
const subGap = 6;
function btnWidth(b: Btn): number {
  const style = b.style ?? "btn";
  return textWidth(b.text, style, "button") + (b.sub ? subGap + textWidth(b.sub, "btn-dim") : 0) + 2;
}
function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const inner = (b.width ?? btnWidth(b)) - 30;
  if (b.sub) {
    // "Learn — interactive lessons": the name, then the muted part (a wrapped paragraph when it is too wide)
    const sub = b.sub;
    const one = btnWidth(b) <= (b.width ?? 1e9);
    opts.content = () => {
      if (one) ui.row(`${b.id}-face`, () => { ui.style(style === "btn-primary" ? "wrap-ink" : "btn-label").label(b.text); ui.style("btn-dim").label(sub); }, { spacing: subGap, align: "center" });
      else ui.style("wrap").paragraph(`${b.text} ${sub}`, Math.max(20, inner));
    };
  } else if (b.width != null && btnWidth(b) > b.width) {
    opts.content = () => { ui.style(style === "btn-primary" ? "wrap-ink" : "wrap").paragraph(b.text, Math.max(20, inner)); };
  } else if (b.name && b.name !== b.text) opts.content = () => { ui.style(style === "btn-primary" ? "wrap-ink" : "btn-label").label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (b.height != null) s.height = b.height;
  if (ui.style(style, s).id(b.id).button(b.name ?? (b.sub ? `${b.text} ${b.sub}` : b.text), opts) && fresh()) later(b.act);
}
/** Buttons at their own widths in rows that wrap at `width` (flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 8, justify: "start" | "center" | "end" = "start"): number {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? btnWidth(b));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button({ ...b, width: bw(b) }); }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width });
  return rows.length;
}
function toWindow(L: Layout, x: number, y: number, w: number, h: number): ui.Rect {
  return { x: L.ox + x * L.sc, y: L.oy + y * L.sc, width: w * L.sc, height: h * L.sc };
}
/** A box over a logical rectangle drawn by a placed role-none widget. */
function paint(id: string, x: number, y: number, w: number, h: number, cls: string): void {
  if (w <= 0 || h <= 0) return;
  ui.place(id, { anchor: "top-start", x, y }, () => { ui.style(cls).widget("", { role: "none", size: { width: w, height: h } }); });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  shell(L);
  overlay(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ the shell: top bar, tray, lesson panel, board targets
function shell(L: Layout): void {
  const g = app.game;
  const playing = !!g && app.flow !== "title" && app.flow !== "modes";
  let top = 0, bottom = L.lh;
  if (playing) {
    top = topBar(L);
    bottom = L.lh - tray(L);
  }
  // the old canvas: between the bars (the whole window in menus)
  const canvas = { x: 0, y: top, w: L.lw, h: bottom - top };
  Object.assign(board, toWindow(L, canvas.x, canvas.y, canvas.w, canvas.h));
  let safe = { ...canvas };
  const lesson = playing && !app.overlay ? lessonText() : null;
  if (lesson) safe = lessonPanel(L, lesson, canvas, top, L.lh - bottom);
  Object.assign(view, toWindow(L, safe.x, safe.y, safe.w, safe.h));
  if (playing && platform.options.domBoard) domBoard(L, canvas);
  else if (playing && !app.overlay) cardTargets();
  // captions (#captions: 56 px under the main area's top) and the toast (80 px above its bottom)
  if (app.caption) {
    ui.place("captions", { anchor: "top", y: top + 56 - 46 }, () => ui.style("caption").id("caption-text").label(app.caption!.text));
  }
  if (app.toasts.length) {
    const t = app.toasts[0]!;
    const w = Math.min(L.lw - 32, 520);
    const tw = textWidth(t.text, "toast-text");
    ui.place("toast", app.overlay ? { anchor: "top", y: 8 } : { anchor: "bottom", y: L.lh - bottom + 80 - 40 }, () => {
      ui.column("toast-box", () => para(t.text, Math.min(tw + 1, w - 34), "toast-text", "toast-text"), { style: "toast" });
    });
  }
}

// header#topbar: flex-wrap, gap .4em 1em, padding .4em .8em; ≤ 720 px: .9em text and no seed
interface Item { id: string; w: number; build: () => void }
function topBar(L: Layout): number {
  const g = app.game!;
  const st = g.state;
  const score = R.scoreComponents(st);
  const gapX = 16, gapY = 6.4, padX = 12.8, padY = 6.4;
  const inner = L.lw - 2 * padX;
  const lastH = lastSize.get("topbar-in")?.height;
  const h = (lastH ? lastH / L.sc : 44) + 2 * padY;
  const objective = T("Clear the pyramid — pair exposed cards to 14.");
  const items: Item[] = [];
  const kv = (id: string, k: string, v: string, dim = false, extra?: () => void, extraW = 0): Item => ({
    id, w: textWidth(k, dim ? "hud-dim" : "hud-k") + 4 + textWidth(v, dim ? "hud-dim-v" : "hud-v") + (extra ? 6 + extraW : 0),
    build: () => ui.row(id, () => {
      ui.style(dim ? "hud-dim" : "hud-k").label(k);
      ui.style(dim ? "hud-dim-v" : "hud-v").id(`${id}-v`).label(v);
      extra?.();
    }, { spacing: 4, align: "center" }),
  });
  const infoW = 44;
  items.push(kv("score-wrap", T("Score"), String(score.total), false, () => {
    if (ui.style("btn", { width: infoW, minHeight: 36, height: 36, padding: 0 }).id("btn-breakdown").button(T("Show score breakdown"), { content: () => ui.style("btn-label").label("ⓘ") }) && fresh()) later(showBreakdown);
  }, infoW));
  items.push(kv("moves-wrap", T("Moves"), `${st.moves}${st.options.moveLimit ? ` / ${st.options.moveLimit}` : ""}`));
  if (!L.compact) items.push(kv("seed-wrap", T("seed"), String(st.seed), true));
  const mode = Loc.modeLabel(g.cfg);
  items.push({ id: "mode-label", w: textWidth(mode, "hud-dim"), build: () => { ui.style("hud-dim").id("mode-label").label(mode); } });
  if (platform.signedIn()) {
    const who = `${platform.displayName()} ${syncShort()}`.trim();
    items.push({ id: "player-wrap", w: textWidth(who, "hud-dim"), build: () => { ui.style("hud-dim").id("player-wrap").label(who); } });
  }
  // rows: the objective first (wrapping when it is wider than the bar), then the items, flex-wrapped
  const objW = Math.min(inner, textWidth(objective, "objective") + 1);
  const rows: Item[][] = [[]];
  let used = objW;
  for (const it of items) {
    const w = Math.min(inner, it.w);
    if (used + gapX + w > inner) { rows.push([]); used = 0; }
    used += (used ? gapX : 0) + w;
    rows[rows.length - 1]!.push(it);
  }
  paint("topbar-bg", 0, 0, L.lw, h, "bar");
  paint("topbar-line", 0, h - 1, L.lw, 1, "bar-line");
  ui.place("topbar", { anchor: "top-start", x: padX, y: padY }, () => {
    lastSize.set("topbar-in", ui.column("topbar-in", () => {
      rows.forEach((row, ri) => ui.row(`topbar-r${ri}`, () => {
        if (ri === 0) {
          if (textWidth(objective, "objective") <= inner) ui.style("objective").id("objective").label(objective);
          else ui.style("objective").id("objective").paragraph(objective, inner);
        }
        ui.spacer();
        for (const it of row) it.build();
      }, { width: inner, spacing: gapX, align: "center", height: ri === 0 && !row.length && objW >= inner ? undefined : 44 } as ui.Layout));
    }, { spacing: gapY, width: inner }));
  });
  return h;
}
function syncShort(): string {
  const s = platform.syncState();
  return s === "saving" || s === "connecting" ? T("saving…") : s === "error" ? T("sync error — retrying") : s === "local" ? "" : T("cloud synced");
}
export function statusLine(): string {
  if (platform.signedIn()) {
    const s = platform.syncState();
    const sync = s === "saving" || s === "connecting" ? T("saving to cloud…") : s === "error" ? T("cloud sync error — will retry") : T("cloud synced");
    return `${T("Signed in as {name}", { name: platform.displayName() || "…" })} · ${sync}`;
  }
  return T("Local play — fully offline-capable");
}

// nav#tray: Draw (stock) · Waste pile · Recycle (left) · Undo · Hint · Pause; flex-wrap, centred
function tray(L: Layout): number {
  const g = app.game!;
  const st = g.state;
  const cls = L.compact ? "btn-tray" : "btn";
  const pad = L.compact ? 5.6 : 8, gap = L.compact ? 5.6 : 8;
  const lastH = lastSize.get("tray-in")?.height;
  const h = (lastH ? lastH / L.sc : 60) + 2 * pad;
  const canRound = inRound();
  const top = st.waste.length ? st.waste[st.waste.length - 1]! : null;
  const pileK = T("Waste"), pileV = top == null ? "—" : Loc.cardShort(top), pileN = st.waste.length ? `(${st.waste.length})` : "";
  const pileW = Math.max(64, textWidth(pileK, "pile-k"), textWidth(pileV, "pile-v"), textWidth(pileN, "pile-n"));
  type Part = { w: number; build: () => void };
  const btn = (b: Btn): Part => ({ w: btnWidth({ ...b, style: cls }), build: () => button({ ...b, style: cls }) });
  const parts: Part[] = [
    btn({ id: "btn-draw", text: T("Draw"), sub: `(${st.stock.length})`, name: T("Draw"), act: () => doCommand({ type: "draw" }), disabled: !st.stock.length || !canRound }),
    {
      w: pileW, build: () => ui.column("pile", () => {
        ui.style("pile-k").label(pileK);
        ui.style("pile-v").id("waste-top").label(pileV);
        if (pileN) ui.style("pile-n").id("waste-count").label(pileN);
      }, { width: pileW, spacing: 0, align: "center" }),
    },
    btn({ id: "btn-recycle", text: T("Recycle"), sub: `(${st.recyclesLeft})`, name: T("Recycle"), act: () => doCommand({ type: "recycle" }),
      disabled: !(st.stock.length === 0 && st.waste.length && st.recyclesLeft > 0) || !canRound }),
    btn({ id: "btn-undo", text: T("Undo"), act: () => doCommand({ type: "undo" }), disabled: !st.history.length || !canRound }),
    btn({ id: "btn-hint", text: T("Hint"), act: doHint, disabled: !canRound }),
    btn({ id: "btn-pause", text: T("Pause"), act: () => pauseGame(), disabled: !canRound }),
  ];
  if (platform.options.leftHanded) parts.reverse();
  const inner = L.lw - 2 * pad;
  const rows: Part[][] = [[]];
  let used = 0;
  for (const p of parts) {
    if (rows[rows.length - 1]!.length && used + gap + p.w > inner) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + p.w;
    rows[rows.length - 1]!.push(p);
  }
  paint("tray-bg", 0, L.lh - h, L.lw, h, "bar");
  paint("tray-line", 0, L.lh - h, L.lw, 1, "bar-line");
  ui.place("tray", { anchor: "top-start", x: pad, y: L.lh - h + pad }, () => {
    lastSize.set("tray-in", ui.column("tray-in", () => {
      rows.forEach((row, ri) => ui.row(`tray-r${ri}`, () => { for (const p of row) p.build(); }, { spacing: gap, width: inner, justify: "center", align: "center" }));
    }, { spacing: gap, width: inner }));
  });
  return h;
}

// .tut-screen > .tut-panel: above the tray, centred, ≤ 560 px wide, ≤ 45 % tall; short landscape: 260 px at the right
function lessonPanel(L: Layout, l: { title: string; text: string; hint: string }, canvas: { x: number; y: number; w: number; h: number }, topH: number, trayH: number):
  { x: number; y: number; w: number; h: number } {
  const side = L.land;
  const w = side ? Math.min(260, L.lw - 12.8) : Math.min(560, L.lw - 19.2);
  const padX = 16, iw = w - 2 * padX;
  const prev = lastSize.get("tut-in");
  const natural = prev ? prev.height / L.sc + 22.4 : 160;
  const maxH = side ? L.lh - topH - trayH - 12.8 : 0.45 * L.lh;
  const h = Math.min(natural, maxH);
  const x = side ? L.lw - 6.4 - w : (L.lw - w) / 2;
  const y = side ? topH + 6.4 : L.lh - trayH - 9.6 - h;
  ui.place("tut", { anchor: "top-start", x, y }, () => {
    ui.column("tut-panel", () => {
      const body = (): void => {
        lastSize.set("tut-in", ui.column("tut-in", () => {
          para(l.title, iw, "tut-h", "tut-title");
          para(l.text, iw, "text", "tut-text");
          para(l.hint, iw, "muted", "tut-hint");
          flow("tut-row", [
            { id: "btn-tut-skip", text: T("Skip lesson"), act: () => { if (app.game && app.flow === "tutorial") advanceTutorial(); } },
            { id: "btn-tut-quit", text: T("Quit tutorial"), act: quitToModes },
          ], iw, 9.6);
        }, { spacing: 6, width: iw }));
      };
      if (natural > maxH + 1) ui.scrollArea("tut-scroll", { width: iw + 8, height: maxH - 22.4 }, body);
      else body();
    }, { style: "tut-panel", width: w, height: h, spacing: 0 });
  });
  // render3d.js _safeRect: the board framed beside or above the panel
  let { x: left, y: top, w: cw, h: ch } = canvas;
  let right = left + cw, bottom = top + ch;
  if (w < cw * 0.5 && h > ch * 0.5) { if (x + w / 2 < cw / 2) left = x + w; else right = x; }
  else if (y + h / 2 > top + ch / 2) bottom = Math.min(bottom, y); else top = Math.max(top, y + h);
  if (right - left < cw * 0.4) { left = canvas.x; right = canvas.x + cw; }
  if (bottom - top < ch * 0.4) { top = canvas.y; bottom = canvas.y + ch; }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Named targets over the exposed cards, the waste and the stock (screen readers, play scripts); the key focus ring. */
function cardTargets(): void {
  const g = app.game!;
  const st = g.state;
  const sel = (r: CardRef): string => (g.selection.some((s) => s.zone === r.zone && s.index === r.index) ? T(", selected") : "");
  for (const i of R.exposedIndices(st.pyramid)) {
    const r = render.cardRect({ zone: "pyramid", index: i });
    if (r) ui.target(Loc.cardSpoken(st.pyramid[i]!) + sel({ zone: "pyramid", index: i }), r, { role: "button" });
  }
  if (st.waste.length) {
    const r = render.cardRect({ zone: "waste" });
    if (r) ui.target(T("Waste top: {card}", { card: Loc.cardSpoken(st.waste[st.waste.length - 1]!) }) + sel({ zone: "waste" }), r, { role: "button" });
  }
  if (st.stock.length) {
    const r = render.cardRect({ zone: "stock" });
    if (r) ui.target(T("Draw stock card ({key})", { key: keysFor("draw") }), r, { role: "button" });
  }
  const f = app.kbFocus;
  if (f && app.keyNav) {
    const r = render.cardRect(f);
    if (r) {
      ui.place("kb-ring", { anchor: "top-start", x: 0, y: 0 }, () => ui.widget("", {
        role: "none", size: { width: 0, height: 0 },
        draw: () => { const s = frame().scale; draw.strokeRoundRect(r.x - 4 * s, r.y - 4 * s, r.width + 8 * s, r.height + 8 * s, 6, token("focus"), 3); },
      }));
    }
  }
}

/** #board-dom: the accessible 2D board over the tableau (rows of card buttons, then the waste). */
function domBoard(L: Layout, canvas: { x: number; y: number; w: number; h: number }): void {
  const g = app.game!;
  const st = g.state;
  const legal = R.legalActions(st);
  const cw = L.compact ? 38 : 44, ch = L.compact ? 52 : 60;
  paint("board-dom-bg", canvas.x, canvas.y, canvas.w, canvas.h, "page");
  const total = 8 * ch + 7 * 2;
  ui.place("board-dom", { anchor: "top-start", x: canvas.x, y: canvas.y + Math.max(8, (canvas.h - total) / 2) }, () => {
    ui.column("board-dom-col", () => {
      const cardBtn = (id: string, card: number | null, ref: CardRef, exposed: boolean, name: string): void => {
        const selected = g.selection.some((s) => s.zone === ref.zone && s.index === ref.index);
        const isLegal = exposed && ref.zone === "pyramid" && legal.some((a) => a.type === "remove" && a.cards!.some((c) => c.zone === "pyramid" && c.index === ref.index));
        const cls = selected ? "card-btn-sel" : isLegal ? "card-btn-legal" : "card-btn";
        const red = card != null && card >= 13 && card < 39;
        const face = Loc.cardShort(card);
        if (ui.style(cls, { width: cw, height: ch }).id(id).button(name, { disabled: !exposed, content: () => ui.style(red ? "card-red" : "card-black").label(face) }) && fresh()) {
          later(() => tapTarget(ref));
        }
      };
      for (let r = 0; r < 7; r++) {
        ui.row(`prow-${r}`, () => {
          for (let c = 0; c <= r; c++) {
            const i = (r * (r + 1)) / 2 + c;
            const card = st.pyramid[i];
            if (card == null) { ui.widget("", { role: "none", size: { width: cw, height: ch } }); continue; }
            const exposed = R.isExposed(st.pyramid, i);
            const selected = g.selection.some((s) => s.zone === "pyramid" && s.index === i);
            cardBtn(`card-${i}`, card, { zone: "pyramid", index: i }, exposed,
              Loc.cardSpoken(card) + (exposed ? T(", exposed") : T(", covered")) + (selected ? T(", selected") : ""));
          }
        }, { spacing: 3, justify: "center", width: canvas.w });
      }
      ui.row("prow-waste", () => {
        const w = st.waste.length ? st.waste[st.waste.length - 1]! : null;
        cardBtn("card-waste", w, { zone: "waste" }, w != null, T("Waste top: {card}", { card: w == null ? T("empty") : Loc.cardSpoken(w) }));
      }, { spacing: 3, justify: "center", width: canvas.w });
    }, { spacing: 2, width: canvas.w });
  });
}

// ------------------------------------------------------------------ screens (.screen > .panel)
type Overlay = NonNullable<typeof app.overlay>;
function overlay(L: Layout): void {
  const o = app.overlay;
  if (!o) return;
  const w = Math.min(o === "journey" ? 860 : 640, L.lw - 32);
  const padX = L.compact ? 12.8 : 22.4, padY = L.compact ? 12.8 : 19.2;
  const inner = w - 2 * padX;
  const maxH = 0.92 * (L.lh - 32);
  const key = `panel-${o}`;
  const prev = lastSize.get(key);
  const scroll = !!prev && prev.height / L.sc + 2 * padY > maxH;
  const opening = frame().frame - app.openedFrame <= 6;
  const isOpen = ui.style(o === "title" || o === "modes" ? "dlg-light" : "dlg").dialog(panelLabel(o), "", true, () => {
    ui.column("panel", () => {
      const iw = inner - (scroll ? 14 : 0);
      const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => buildPanel(o, iw, L), { spacing: 9.6, width: iw })); };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 6, height: maxH - 2 * padY }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else body();
    }, { style: "panel", width: w, spacing: 0, padding: { top: padY, bottom: padY, start: padX, end: padX } });
  });
  if (!isOpen && fresh()) {
    // Escape / Back: the pause screen resumes, menus go back as their Back buttons do
    if (o === "pause") later(resumeGame);
    else if (o === "modes" || o === "board") later(goTitle);
    else if (o === "journey" || o === "practice" || o === "challenge") later(showModes);
    else if (o === "help" || o === "settings") later(backAuto);
  }
}
function panelLabel(o: Overlay): string {
  switch (o) {
    case "title": return "Summit Pyramid";
    case "modes": return T("Choose a mode");
    case "journey": return T("Journey");
    case "practice": return T("Practice");
    case "challenge": return T("Challenge");
    case "pause": return T("Paused");
    case "results": return app.results?.terminal.won ? T("Pyramid cleared!") : T("Round over");
    case "help": return T("How to play");
    case "settings": return T("Settings");
    case "board": return T("Leaderboards");
    default: return "";
  }
}
function buildPanel(o: Overlay, w: number, L: Layout): void {
  switch (o) {
    case "title": titlePanel(w); break;
    case "modes": modesPanel(w); break;
    case "journey": journeyPanel(w); break;
    case "practice": practicePanel(w); break;
    case "challenge": challengePanel(w); break;
    case "pause": pausePanel(w); break;
    case "results": resultsPanel(w); break;
    case "help": helpPanel(w); break;
    case "settings": settingsPanel(w); break;
    case "board": boardPanel(w); break;
  }
  void L;
}
/** .menu: full-width buttons in a column. */
function menu(id: string, list: Btn[], w: number): void {
  ui.column(id, () => { for (const b of list) button({ ...b, width: w }); }, { spacing: 8, width: w });
}
const back = (w: number, act: () => void): void => { flow("back-row", [{ id: "btn-back", text: T("Back"), act }], w); };

function titlePanel(w: number): void {
  para("Summit Pyramid", w, "h1", "title-h");
  para(T("A desert-night card ascent. Pair exposed cards to 14 and clear the pyramid before the stock runs out."), w, "muted", "title-tag");
  para(statusLine(), w, "muted", "title-status");
  const list: Btn[] = [
    { id: "btn-play", text: T("Play"), style: "btn-primary", act: play },
    { id: "btn-title-help", text: T("How to play"), act: () => showHelp("title") },
    { id: "btn-title-settings", text: T("Settings"), act: () => showSettings("title") },
    { id: "btn-title-board", text: T("Leaderboard"), act: () => void showLeaderboards() },
  ];
  if (!platform.signedIn()) list.push({ id: "btn-signin", text: S("signIn"), act: signIn });
  if (platform.inviteLink()) list.push({ id: "btn-invite", text: S("invite"), act: invite });
  menu("title-menu", list, w);
  if (platform.progress().snapshot) flow("resume-line", [{ id: "btn-resume", text: T("Resume last game"), act: resumeLast }], w);
}
function modesPanel(w: number): void {
  para(T("Choose a mode"), w, "h2", "modes-h");
  menu("modes-menu", [
    { id: "mode-learn", text: T("Learn"), sub: T("— interactive lessons"), act: startLearn },
    { id: "mode-journey", text: T("Journey"), sub: T("— 40 stages"), act: () => { app.flow = "modes"; openPanel("journey"); } },
    { id: "mode-daily", text: T("Daily"), sub: T("— one shared seed per UTC day, ranked"), act: startDaily },
    { id: "mode-practice", text: T("Practice"), sub: T("— pick a difficulty, unranked"), act: () => openPanel("practice") },
    { id: "mode-challenge", text: T("Challenge"), sub: T("— constrained goals"), act: () => openPanel("challenge") },
    { id: "mode-score", text: T("Score chase"), sub: T("— leaderboards"), act: startScoreChase },
  ], w);
  back(w, goTitle);
}
function openPanel(o: "journey" | "practice" | "challenge"): void {
  app.overlay = o;
  app.openedFrame = frame().frame;
  app.focusNext = null;
  ui.setFocus(null);
}
function journeyPanel(w: number): void {
  const j = platform.progress().journey;
  para(T("Journey"), w, "h2", "journey-h");
  para(T("{done} / {total} stages complete", { done: Object.keys(j.completed).length, total: C.STAGE_COUNT }), w, "muted", "journey-progress");
  const gap = 6.4, min = 64;
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column("stage-grid", () => {
    for (let r = 0; r * cols < C.STAGES.length; r++) {
      ui.row(`stage-grid-r${r}`, () => {
        for (let i = r * cols; i < Math.min(C.STAGES.length, (r + 1) * cols); i++) {
          const s = C.STAGES[i]!;
          const n = s.index + 1;
          const locked = n > j.unlocked;
          const text = `${s.mastery ? "★" : ""}${n}`;
          const name = T("{name} — tier {tier}, par {par}", { name: Loc.stageName(s), tier: s.difficulty, par: s.par.score });
          button({ id: `stage-${n}`, text, name, style: j.completed[s.id] != null ? "btn-stage-done" : "btn-stage", width: cw, disabled: locked, act: () => startJourneyStage(s.id) });
        }
      }, { spacing: gap });
    }
  }, { spacing: gap, width: w });
  back(w, showModes);
}
function practicePanel(w: number): void {
  para(T("Practice"), w, "h2", "practice-h");
  menu("diff-list", C.DIFFICULTIES.map((d) => ({ id: `diff-${d.id}`, text: T(d.label), sub: `— ${T(d.description)}`, act: () => startPractice(d) })), w);
  const lw = Math.min(176, w * 0.45);
  ui.row("seed-row", () => {
    para(T("Seed (optional)"), lw, "text", "seed-label");
    app.seedText = ui.id("practice-seed").textField(T("Seed (optional)"), app.seedText, { width: w - lw - 10, maxChars: 10, placeholder: T("random") });
  }, { width: w, spacing: 10, align: "center" });
  back(w, showModes);
}
function challengePanel(w: number): void {
  para(T("Challenge"), w, "h2", "challenge-h");
  menu("challenge-list", C.CHALLENGES.map((ch) => ({ id: `ch-${ch.id}`, text: T(ch.name), sub: `— ${T(ch.description)}`, act: () => startChallenge(ch) })), w);
  back(w, showModes);
}
function pausePanel(w: number): void {
  const st = app.game!.state;
  para(T("Paused"), w, "h2", "pause-h");
  para(`${T("Seed")} ${st.seed} · ${T("Moves")} ${st.moves}`, w, "muted", "pause-line");
  menu("pause-menu", [
    { id: "btn-resume-pause", text: T("Resume"), style: "btn-primary", act: resumeGame },
    { id: "btn-pause-settings", text: T("Settings"), act: () => showSettings("pause") },
    { id: "btn-pause-help", text: T("How to play"), act: () => showHelp("pause") },
    { id: "btn-restart", text: T("Restart deal"), act: restart },
    { id: "btn-quit", text: T("Leave round"), act: leaveRound },
  ], w);
}
/** A table (td cells, the last right-aligned) with row borders; a one-cell row is a muted note. */
function table(id: string, rows: string[][], w: number): void {
  ui.column(id, () => {
    rows.forEach((r, i) => ui.row(`${id}-${i}`, () => {
      if (r.length === 1) { para(r[0]!, w - 16, "td-muted"); return; }
      for (let c = 0; c < r.length - 1; c++) {
        if (c === r.length - 2 && r.length === 2) para(r[c]!, w * 0.7, "td");
        else ui.style("td").label(r[c]!);
      }
      ui.spacer();
      ui.style("td-num").label(r[r.length - 1]!);
    }, { style: "tr", width: w, spacing: 12, align: "center" }));
  }, { spacing: 0, width: w });
}
function resultsPanel(w: number): void {
  const r = app.results!;
  const won = r.terminal.won;
  para(won ? T("Pyramid cleared!") : T("Round over"), w, won ? "h2-good" : "h2-bad", "result-headline");
  const reason = r.terminal.reason === "pyramid-cleared" ? T("Every card reached the summit.") : r.terminal.reason === "move-limit" ? T("Move limit reached.") : T("No legal moves remain.");
  para(`${reason} · ${Loc.modeLabel(r.cfg)}`, w, "muted", "result-reason");
  para(T("Score breakdown"), w, "h3", "result-h3");
  const s = r.score;
  table("result-table", [
    [T("Pairs removed (×100)"), String(s.pairs)], [T("Pyramid clear bonus"), String(s.clearBonus)], [T("Unused stock bonus"), String(s.stockBonus)],
    [T("Unused recycle bonus"), String(s.recycleBonus)], [T("Invalid-action penalty"), String(s.invalidPenalty)], [T("Total"), String(s.total)],
  ], w);
  if (r.achievements.length) para(`${T("Achievements unlocked:")} ${r.achievements.map((a) => T(a.name)).join(", ")}`, w, "good-b", "result-achievements");
  para(r.note(), w, "muted", "result-submit");
  const lb = resultsLbLine();
  if (lb) para(lb, w, "text", "result-lb");
  menu("results-menu", [
    { id: "btn-next", text: T("Next"), style: "btn-primary", act: nextAfterResults },
    { id: "btn-retry", text: T("Retry"), act: retry },
    { id: "btn-results-modes", text: T("Mode select"), act: quitToModes },
  ], w);
}
function helpPanel(w: number): void {
  para(T("How to play"), w, "h2", "help-h");
  const k = (a: string): string => keysFor(a);
  const sections: [string, string][] = [
    [T("Pair to 14"), T("Cards are worth their rank (A=1 … K=13). Select two uncovered cards totaling 14 to remove them. A card is uncovered when both cards below it are gone (the bottom row is always uncovered).")],
    [T("Stock and waste"), T("Press {key} or Draw to flip a stock card to the waste. The top waste card can pair with any uncovered pyramid card.", { key: k("draw") })],
    [T("Recycle"), T("When the stock is empty, press {key} to flip the waste back into a new stock — a limited number of times.", { key: k("recycle") })],
    [T("Keyboard"), T("{prev} {next} move between legal cards · {confirm} select · {cancel} cancel/pause · {undo} undo · {hint} hint · {draw} draw · {recycle} recycle · {camera} reset camera.", {
      prev: k("prev"), next: k("next"), confirm: k("confirm"), cancel: k("cancel"), undo: k("undo"), hint: k("hint"), draw: k("draw"), recycle: k("recycle"), camera: k("camera"),
    })],
    [T("Scoring"), T("+100 per pair · +1000 clearing the pyramid · +10 per unused stock card · +100 per unused recycle · −25 per invalid action.")],
  ];
  ui.column("help-list", () => {
    sections.forEach(([h, p], i) => ui.column(`help-${i}`, () => { para(h, w, "h3", `help-${i}-h`); para(p, w, "text", `help-${i}-p`); }, { spacing: 4, width: w }));
  }, { spacing: 8, width: w });
  flow("help-row", [
    { id: "btn-help-tutorial", text: T("Replay tutorial"), act: startLearn },
    { id: "btn-back", text: T("Back"), act: backAuto },
  ], w);
}
/** Settings: what the runtime's Options do not cover (ui.js settings) — captions, palette, left-handed tray, the 2D board. */
function settingsPanel(w: number): void {
  const o = platform.options;
  para(T("Settings"), w, "h2", "settings-h");
  para(T("Audio"), w, "h3", "set-audio-h");
  para(T("Volumes, graphics quality, language, larger text, high contrast and reduced motion are in the StarHermit Options."), w, "muted", "options-note");
  flow("set-runtime", [
    { id: "btn-options", text: T("Open Options"), act: () => openMenu() },
    { id: "btn-rebind", text: T("Key bindings"), act: () => requestRebind() },
  ], w);
  toggleRow("opt-captions", T("Audio captions"), o.captions, w, (v) => platform.setOption("captions", v));
  para(T("Accessibility"), w, "h3", "set-a11y-h");
  const names = [N("Default"), N("Deuteranopia-safe"), N("Tritanopia-safe")];
  const idx = Math.max(0, SaveModel.PALETTES.indexOf(o.cvd));
  ui.row("opt-cvd-row", () => {
    para(T("Color-vision palette"), w * 0.45, "text", "opt-cvd-label");
    ui.spacer();
    const pick = ui.id("opt-cvd").select(T("Color-vision palette"), idx, names.map((n) => T(n)), { width: Math.min(w * 0.52, 240) } as ui.WidgetOptions);
    if (pick !== idx) later(() => platform.setOption("cvd", SaveModel.PALETTES[pick]!));
  }, { width: w, align: "center", height: 48 });
  toggleRow("opt-left", T("Left-handed controls"), o.leftHanded, w, (v) => platform.setOption("leftHanded", v));
  toggleRow("opt-dom", T("2D board (screen-reader mode)"), o.domBoard, w, (v) => platform.setOption("domBoard", v));
  flow("set-row", [
    { id: "btn-settings-tutorial", text: T("Replay tutorial"), act: startLearn },
    { id: "btn-back", text: T("Back"), act: backAuto },
  ], w);
}
/** A check box row (a role "checkbox" widget: built-in check box labels don't wrap). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    para(label, w - 56, "text", `${id}-label`);
    ui.spacer();
    const res = ui.id(id).widget(label, {
      role: "checkbox", checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 20 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 4, on ? token("accent") : token("panel2"));
        draw.strokeRoundRect(bx, by, box, box, 4, token("btn-edge"), 2);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 16 * s, color: token("ink"), align: "center", weight: "bold" });
      },
    });
    if (res.activated && fresh()) later(() => { set(!on); sound("select"); });
  }, { width: w, align: "center", spacing: 8, height: 44 });
}
const BOARD_NOTES: Record<string, string> = {
  none: N("Personal bests (this game has no platform leaderboard)."),
  unavailable: N("Personal bests (platform board unavailable)."),
  local: N("Personal bests (local)."),
};
function boardPanel(w: number): void {
  para(T("Leaderboards"), w, "h2", "board-h");
  const v = app.board;
  if (!v) { para("…", w, "muted", "board-source"); back(w, goTitle); return; }
  if ("entries" in v) {
    para(T("StarHermit high-score board (ranked rounds). Personal bests are in your cloud save."), w, "muted", "board-source");
    para(T("Global"), w, "h3", "board-global-h");
    if (v.entries.length) table("board-global", v.entries.map((e, i) => [`${i + 1}`, `${e.name}${e.me ? ` ${T("(you)")}` : ""}`, String(e.score)]), w);
    else table("board-global", [[T("No entries yet.")]], w);
  } else {
    para(T(BOARD_NOTES[v.local]!), w, "muted", "board-source");
    para(T("Global"), w, "h3", "board-global-h");
    const me = platform.displayName() || T("You");
    const rows = Object.entries(platform.progress().best).sort((a, b) => b[1].score - a[1].score).slice(0, 10)
      .map(([k, b], i) => [`${i + 1}`, me, Loc.bestKeyLabel(k), String(b.score)]);
    table("board-global", rows.length ? rows : [[T("No personal bests yet.")]], w);
  }
  para(T("Daily"), w, "h3", "board-daily-h");
  table("board-daily", [["—"]], w);
  back(w, goTitle);
}
