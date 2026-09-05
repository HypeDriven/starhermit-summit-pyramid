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
