// The generated play scripts match the rules (tools/gen-plays.mjs: rerun
// `npm run plays` after a rules or content change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { solve } from '../tools/gen-plays.mjs';

const R = createRequire(import.meta.url)('../rules.js');
test('practice-win.play clears seed 4242 with the solver\'s line', () => {
  const plan = solve(R.newGame(4242, { recycles: 2 }));
  const end = R.applyCommands(4242, plan, { recycles: 2 }).state;
  assert.equal(end.status, 'won');
  const play = readFileSync(new URL('./native/practice-win.play', import.meta.url), 'utf8');
  assert.match(play, new RegExp(`${plan.length} commands to a full clear \\(score ${R.scoreComponents(end).total}\\)`));
});
