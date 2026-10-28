// The look of the top bar, tray, lesson panel, toasts and screens: the
// browser build's index.html <style>, rewritten class-based in
// tools/ui-style.css and converted once with `starhermit css` into
// assets/ui-style.json (`npm run css`), registered at start with the theme
// the runtime's own widgets (scroll bars, focus rings, selects, text fields)
// take. The runtime's high contrast option is the old html.hc token set.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  bg: "#0b1026", panel: "#141b33", panel2: "#1b2340", text: "#e8ecf8", muted: "#9aa4c4",
  accent: "#ffb35c", good: "#6fe3a5", bad: "#ff7a7a", focus: "#7df0ff", edge: "#2a3355", "btn-edge": "#3a4568", ink: "#1a1208",
};
/** html.hc. */
const CONTRAST: Tokens = { bg: "#000000", panel: "#0a0a0a", panel2: "#111111", text: "#ffffff", muted: "#dddddd", accent: "#ffd23f", focus: "#ffffff" };

let current: Tokens = { ...BASE };
let css: ui.CssStyles | null = null;
let key = "";
export function initStyles(): void {
  css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 8, radius: 8,
    text: BASE.text!, muted: BASE.muted!, panel: BASE.panel!, control: BASE.panel2!, hovered: "#243058",
    pressed: "#2c3866", field: BASE.panel2!, accent: BASE.accent!, focus: BASE.focus!, outline: BASE["btn-edge"]!,
  });
  key = "";
  applyTokens(false);
}
/** The base or high-contrast tokens and styles (cheap when unchanged); html.hc .card-btn{border-width:3px}. */
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key || !css) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens({ ...css.tokens, ...current });
  const styles: Record<string, ui.Style> = { ...css.styles };
  if (highContrast) {
    for (const name of [".card-btn", ".card-btn-legal"]) {
      const s = styles[name] as { border?: object } | undefined;
      if (s) styles[name] = { ...s, border: { ...(s.border ?? {}), width: 3 } } as ui.Style;
    }
  }
  ui.setStyles({
    ...styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$btn-edge", radius: 4 } } },
    tooltip: { background: "$panel2", text: { color: "$text" }, radius: 6, padding: 6 },
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#050814d1" } } },
    // .screen rgba(5, 8, 20, 0.82); #scr-title, #scr-modes rgba(5, 8, 20, 0.5)
    ".dlg": { background: "#00000000", padding: 0, parts: { backdrop: { background: "#050814d1" } } },
    ".dlg-light": { background: "#00000000", padding: 0, parts: { backdrop: { background: "#05081480" } } },
  });
  ui.setTheme({
    text: current.text!, muted: current.muted!, panel: current.panel!, control: current.panel2!,
    field: current.panel2!, accent: current.accent!, focus: current.focus!, outline: current["btn-edge"]!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
