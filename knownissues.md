# Known Issues — Summit Pyramid

QA pass. Review combines static analysis of the pure rules engine
(`rules.js`) with the game's own unit suite (`test.js`), the headless-Chrome
end-to-end playthrough (`tests/e2e.mjs`), and an exhaustive memoized search of
the legal-action state space for representative deals.

## Test results

| Check | Result |
| --- | --- |
| `npm test` (`test.js`, unit suite incl. server round-trip) | All tests passed (1056 assertions), exit 0 |
| `npm run test:e2e` (`tests/e2e.mjs`, headless Chrome) | PASS — desktop + mobile, no page errors |
| Full-clear solver (`computePlan`, real rules engine) | Practice seed `4242` solved to a genuine 7-row "Pyramid cleared!" in 63 moves (63 memoized DFS nodes) |

## Confirmed defects

### 1. The full "Pyramid cleared!" win is unreachable — pair target makes low ranks unremovable

- **File:** `rules.js:23` (`const TARGET = 21;`) — the pair-sum constant used by every
  legality check (`hasRemove`, `legalActions`, `applyCommand`).
- **Trigger:** Any deal. Exhaustive memoized DFS over the whole legal-action state space
  found **no** full-clear across Journey stages, challenge seeds, tutorial lesson seeds and
  2000+ random practice seeds; every round ended at "Round over / No legal moves remain".
- **Root cause:** Card values are `A=1 … K=13`. With `TARGET=21` the only removable pairs are
  `(8,K)=(8+13)`, `(9,Q)=(9+12)`, `(10,J)=(10+11)`. Ranks `1–7` (28 cards in the deck) can
  never sum to 21 with any other card (max `7+13=20<21`), so they are unsalvageable. Since the
  28-card pyramid always contains low ranks, the pyramid can never be fully cleared — the
  maximum removable set is the 24 cards ranked 8–K, which is fewer than 28. Neither does
  `TARGET=13` work: complement `13-1=12`, …, `13-6=7`, but rank 13 (K) needs a `0`, leaving
  Kings unremovable.
- **Expected:** A legal "best" playthrough can clear the full 7-row pyramid, while the genuine
  "no legal moves" state remains reachable when truly stuck.
- **Fix (RESOLVED):** The only pair sum for which **every** rank `1..13` has a partner is
  `TARGET=14` — complements `A+K (1+13)`, `2+Q`, `3+J`, `4+10`, `5+9`, `6+8`, `7+7`. Changed
  `TARGET` from 21 to 14 (see file:line change list below) and updated all user-facing rules
  copy to read "14". Verified `TARGET=14` makes the practice seed `4242` solvable to a full
  clear (63 moves via the real engine, `status === 'won'`); the e2e now plays that winning line
  through the visible board and asserts "Pyramid cleared!". The `no-moves` loss test still
  passes, so the genuine stuck loss is preserved.
- **Evidence (before fix):** `node tests/e2e.mjs` reported the desktop round terminating as
  "Round over / No legal moves remain" for every deal; the authored NOTE in the e2e described
  an exhaustive search finding no full clear.

## Checked, no defect found

- Draw / recycle / undo / pause / hint / selection and scoring all behave per `spec.md`; the
  only content-level defect was the unreachable win above.
- Move-limit and recycle-limited challenges (`content.js` `CHALLENGES`) use limits well above
  the minimum 14 removes required to clear 28 cards.

## Not tested

- Hosted (StarHermit `/api`) session flow and server persistence beyond what `test.js`'s
  server round-trip and the offline e2e path exercise.

---

# Review pass 2 (2026-09-08)

Second review of the same surface plus the Three.js render layer, server static
file handling, and mobile layout. All findings below are FIXED and verified.

## Test results (this pass)

| Check | Result |
| --- | --- |
| `npm test` (`test.js`) | All tests passed (1061 assertions), exit 0 |
| `npm run test:e2e` (`tests/e2e.mjs`, headless Chrome) | PASS — desktop + mobile, no page errors |
| Targeted 3D browser smoke (headless Chrome, real keyboard + canvas clicks) | PASS — removal flight animation visible, undo restores card visibility in 3D, raycast picking removes a real pair, pause/resume OK, no page errors |
| Portrait viewport (390×844) screenshot check | Pyramid fully in frame; tray fully visible |

## Defects found and fixed

1. **3D card faces never visible (critical).** `makeCardMesh` mapped the card
   face texture onto the `+z` material slot of `BoxGeometry(w, 0.03, h)` — a
   0.03-unit-thick edge — and rotated cards `-π/2+0.42`, so players only ever
   saw the plain edge-colored big faces. No rank/suit was ever readable in 3D;
   the game was unplayable without the 2D fallback. Face art is now on `+y`
   (back motif on `-y`), pyramid cards lean face-up toward the camera, the
   stock shows its back, the waste shows its face, and the camera home was
   re-framed for the now-visible layout. Verified with real canvas clicks
   removing an actual pair (8♦+6♥).
2. **Undo left restored cards invisible in 3D.** `syncState` only ever set
   `mesh.visible = false` for removed cards, never `true` for present ones, so
   an undone removal stayed hidden. Fixed; also fixes the race where undo
   during the removal flight was clobbered by the animation's end frame.
3. **Removal flight animation never rendered.** `doCommand` calls `syncAll()`
   synchronously right after starting `animateRemoval`, which hid the pyramid
   meshes and detached the waste mesh before the first animation frame. Meshes
   now carry a `removing` flag that `syncState` respects until the flight ends.
   Verified visible mid-flight in a headless-Chrome screenshot.
4. **Portrait/mobile camera clipped the pyramid.** Fixed home framing assumed a
   wide viewport; at 390×844 the bottom row was cut off horizontally and the
   tray's second row overflowed the viewport. The camera now pulls back
   (`camScale = max(1, 0.92/aspect)`) on narrow aspects, and small-screen CSS
   (tray button sizing, hide seed chip) keeps all controls inside 100vh.
5. **Mesh/material leaks.** `buildEnv`/`buildBoard` disposed geometries but not
   materials; the waste mesh (three materials) was rebuilt on *every* sync; a
   new selection marker ring was added to the scene every round without
   removing the old one. All now disposed/reused; the waste mesh rebuilds only
   when the top card actually changes.
6. **`#live-err` assertive live region was visible page text.** Only `#live`
   had the visually-hidden CSS; error announcements appeared as stray permanent
   text at the top of the page. Both regions now share the rule.
7. **Server static handler served `data/` and dotfiles, and crashed on bad
   encodings.** `/data/leaderboard.json` and `/.gitignore` were served with
   200; `decodeURIComponent` on malformed input threw outside any handler.
   Now: `data/` and dot-segments → 403, malformed percent-encoding → 400,
   prefix check uses `ROOT + path.sep`. Regression assertions added to
   `test.js`.
8. **`test.js` mutated the shipped `data/` store.** The live-server HTTP tests
   wrote the seed-777 test entry, 72 `seen` command ids, and achievement
   counters into `data/leaderboard.json`/`data/achievements.json` on every run.
   `server.js` now honors `SUMMIT_DATA_DIR`; the test points it at a fresh
   temp dir. The polluted data files were reset to empty defaults.
9. **Achievement endpoint accepted arbitrary ids.** Any regex-valid string was
   recorded. Now validated against the declared `content.js` ACHIEVEMENTS set
   (unknown → 400; covered by a new test assertion).
10. **Small client fixes.** `kbFocus` is reset on round start; resuming a saved
    game re-persists the restored snapshot (previously a reload before the next
    move resumed from scratch); the practice seed field rejects non-numeric
    input with a toast instead of silently playing seed 0.

## Root instruction compliance

- Added `LICENSE.md` (PolyForm Noncommercial 1.0.0), required by the repo-root
  instructions; it was missing.

## Known gaps (not addressed this pass)

- No text localization (`agents/localization.md` lists 9 locales); the UI is
  English-only. This is a feature-sized change, not a bug fix.
- Rate-limit token buckets in `server.js` grow unboundedly with distinct IPs
  (in-memory only; resets on restart).
