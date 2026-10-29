# Summit Pyramid — specification

A single-player pyramid solitaire on a desert night: remove pairs of uncovered
cards that total 14 and clear the 28-card pyramid before the stock runs out.
It is a StarHermit engine script game (TypeScript on the host API), pinned to
engine **1.23.0** with `engine.minor=23`, played natively by the StarHermit
client and in browsers by the engine's web runtime from one package.

## Rules (rules.js, unchanged)

- 7 rows / 28 cards face up, 24 in the stock. A=1 … K=13; two exposed cards
  totalling 14 are removed (A+K, 2+Q, 3+J, 4+10, 5+9, 6+8, 7+7). A card is
  exposed when both cards below it are gone; the bottom row always is.
- Draw flips the stock's top card onto the waste; the waste top pairs with any
  exposed pyramid card. With the stock empty the waste may be recycled a
  limited number of times (2 by default).
- The round is won when the pyramid is empty, lost when a move limit is hit or
  no stock, no recycle and no pair remain. Undo steps back one command.
- Score: +100 a pair, +1000 for the clear, +10 an unused stock card, +100 an
  unused recycle, −25 an invalid action.

## Modes (content.js, unchanged)

- **Learn**: five lessons (pair, uncover, draw, waste pair, recycle), each on
  a fixed deal; a lesson can't be lost (a stuck lesson re-deals). Play starts
  Learn until it has been finished once.
- **Journey**: 40 stages (tiers 1–5, recycles 3/2/1, a mastery stage every
  tenth), unlocked in order; stage 1 replays the first lesson for newcomers.
- **Daily**: one seed per UTC day from the platform clock (`serverNow()`;
  the device clock offline), ranked.
- **Practice**: Foothill / Ridge / Summit (3/2/1 recycles), an optional
  numeric seed, unranked.
- **Challenge**: Forty Moves, One Pass, Speed Ascent, Thin Air.
- **Score chase**: a random deal, ranked.

Ranked rounds (Daily, Score chase) post their total to the `high-score`
board when signed in. Achievements: First Light, Seasoned Climber, Three
Sunrises, Half the Sky, Long Trail.

## Screens and layout

- **Title** over the dune hero view (camera toward the moon): Play, How to
  play, Settings, Leaderboard, Sign in with StarHermit (guests), Invite a
  friend (signed in), Resume last game (when a round was left unfinished).
- **Modes, Journey (stage grid), Practice (difficulties + seed field),
  Challenge, Pause, Results (score breakdown, achievements, the ranked note
  and leaderboard rank), How to play, Settings, Leaderboards** are dialogs
  over the dimmed tableau. Escape or Back on a menu goes back; on Pause it
  resumes.
- **In a round**: the top bar (objective, score with the ⓘ breakdown, moves
  and limit, the seed, the mode, the player and sync line; it wraps into rows
  when narrow) and the tray (Draw with the stock count, the waste pile,
  Recycle with the recycles left, Undo, Hint, Pause; mirrored for the
  left-handed option; wraps on phones). Between them the 3D tableau, framed
  in that rectangle with a view offset. The lesson panel sits above the tray
  (beside the board in short landscape, ≤ 500 px tall); the board is framed
  clear of it. Toasts sit 80 px above the tray, captions under the top bar.
- Compact bars at ≤ 720 logical px wide (no seed, smaller tray buttons).

## Controls

| Action | Keys | Gamepad |
| --- | --- | --- |
| Previous / next card | ← ↑ / → ↓ | D-pad, left stick |
| Select | Enter | South |
| Cancel / pause | Escape | East, Start |
| Draw | D | North |
| Recycle | R | Right shoulder |
| Undo | U | West |
| Hint | H | Left shoulder |
| Reset camera | C | Right stick press |

Players rebind them in the runtime's Options (Settings › Key bindings). The
arrows step through the exposed cards and the waste top (a ring marks the
focused card after key input); Enter selects it. Pointer and touch: a press
on an exposed card or the waste selects it (a second card totalling 14
removes the pair, the same card again deselects), a press on the stock
draws; presses the UI takes (`ui.pointerCaptured()`) never reach the board.
The selected card lifts with a pulsing ring under it; a removed pair bursts
into sparks and flies up.

## Settings

The runtime's Options own volumes and mute, graphics level, language, larger
text, high contrast and reduced motion. The game's Settings keep: Audio
captions, Color-vision palette (default, deuteranopia-safe, tritanopia-safe
card reds), Left-handed controls (reversed tray) and 2D board
(screen-reader mode: one button per pyramid slot and the waste over an
opaque page, the legal cards outlined). These four are engine `settings`,
synced with the account.

## Graphics

Per the runtime's quality tier (native/quality.ts, the browser build's
presets and budgets): Low — Lambert, plain box cards with 128-px faces, no
shadows or effects, MSAA, static stars; Balanced — Standard materials,
rounded cards with 256-px faces, sand texture and bump, sky dome, flames,
1024 shadows, bloom, grade, FXAA, reflections, twinkling stars, 35 %
particles; High — clear-coated Physical cards, 2048 shadows, GTAO, SMAA,
full particles; Ultra — 512-px faces, 4096 shadows, full-resolution GTAO
and bloom, MSAA. Stars and particles scale within a tier by the level
(≤ 1.5×). Lights, shadows (the key light's shadow box ±6.2, near 2, far 32,
bias −0.0006, normal bias 0.02, radius 3) and the environment
(`RoomEnvironment(renderer)`, sigma 0.04, `scene.environment` at intensity
0.24) are the three.js r169 page's own values (minor 23 is r185 parity).
ACES at exposure 1.4; the grade is the old display-space S-curve, tint and
vignette. Reduced motion stops the twinkle, flicker, particles and tweens.

## Sound

The authored one-shots in `sfx/` per event (select, deselect, pair, invalid,
draw, recycle, undo, win, lose). During a round the ambience (low-passed
noise and a 55 Hz hum) and the adaptive pad (pentatonic notes every 0.9 s,
an octave up and denser below ten cards) play on the music bus, rendered once
into clips. Captions (when on) name each sound.

## Saves and platform

- The engine save (schema 1) is the browser build's save document
  (app/save.js): journey unlocks and stage bests, personal bests,
  achievements, stats and streak, the resumable last round and tutorialDone.
  Two devices' saves merge (larger counters, earliest achievements, this
  device's resumable round first).
- Migration: the browser build's cloud slot (game:summit-pyramid, plain JSON)
  arrives as a foreign save and is merged in once; its settings KV gives
  captions, palette, left-handed, 2D board and tutorialDone, then its keys
  are removed. Guests' old browser localStorage progress does not migrate.
- Ranked totals post through `score-script.js` (a practice session whose
  socket carries `{ type: 'result', scores }`; the script range-checks
  0–100000). The Leaderboards screen shows the `high-score` board when
  signed in, personal bests otherwise; the Daily table is empty as before.
- There is no multiplayer. `server.js` is the old dev server and replay
  validator (node tests only; not shipped).

## Files

- `rules.js`, `content.js` — rules and content (UMD; also used by `server.js`,
  `game.js`, `test.js`).
- `app/` — pure modules shared with node tests: `lang.js` (T, locales),
  `strings.js` (tables), `loc.js` (card and mode names), `sh-i18n.js`
  (account strings), `save.js` (save model).
- `native/` — the engine client: `main.ts` (flow, input, commands),
  `screens.ts` (UI), `render.ts` (scene), `audio.ts`, `platform.ts`,
  `quality.ts`, `style.ts`, `i18n.ts`, `game.ts` (typed facades).
- `assets/` — `ui-style.json` (from `tools/ui-style.css`, `npm run css`),
  `sand-{128,256,512}.png` (`npm run sand`).
- `index.html`, `starhermit-files.json` — the web loader and file index
  (`npm run package` after every change).

## Checks

- `npm run test:unit`: rules, content, server and replay validation
  (`test.js`), the save model, localization in all nine locales, the
  generated scripts against the rules.
- `npm run test:native`: web index up to date, `tsc`, `starhermit check` with
  no warnings, and the play scripts (`npm run plays` regenerates three):
  Practice 4242 won by mouse, the five lessons by finger on a DPR-3 phone,
  Practice Foothill won by keys in short landscape, the menus.
- `npm run test:browser`: the packaged game in GPU Chrome at desktop, phone
  and landscape (lessons, a full Practice win, pause, finger play).

## Known limitations

- Guests' browser-build localStorage saves don't carry over (cloud saves do).
- Exhaustive search finds no full clear for the Forty Moves, One Pass and
  Speed Ascent deals (content kept as the browser build had it).
- The card corner indices and suit glyphs use the engine's serif and
  sans-serif faces, not Georgia / system-ui.
