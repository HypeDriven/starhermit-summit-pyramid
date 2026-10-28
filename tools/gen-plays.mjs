// Writes the native play scripts (tests/native/*.play) from the real rules:
// a memoized depth-first solver (as the browser build's e2e computePlan:
// removes, then draw, then recycle) finds a full clear, and each command
// becomes clicks or taps on the named card targets (screens.ts cardTargets:
// a card's spoken name, "Waste top: …"), the tray's Draw / Recycle, or key
// presses (arrows step through the exposed cards and the waste in
// main.ts navTargets order, Enter selects, D draws, R recycles).
//   node tools/gen-plays.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const R = require('../rules.js');
const C = require('../content.js');
const { cardSpoken } = await import('../app/loc.js');

/** A full clear from a state (null when there is none within the budget). */
export function solve(start, budget = 500000) {
  const memo = new Set();
  const plan = [];
  let nodes = 0;
  const keyOf = (st) => `${st.pyramid.join(',')}|${st.stock.join(',')}|${st.waste.join(',')}|${st.recyclesLeft}|${st.options.moveLimit ? st.moves : ''}`;
  const dfs = (st) => {
    if (st.status === 'won') return true;
    if (st.status === 'lost') return false;
    const k = keyOf(st);
    if (memo.has(k)) return false;
    if (++nodes > budget) throw new Error('solver node budget exceeded');
    const acts = R.legalActions(st);
    for (const a of [...acts.filter((x) => x.type === 'remove'), ...acts.filter((x) => x.type === 'draw'), ...acts.filter((x) => x.type === 'recycle')]) {
      const n = R.applyCommand(st, a);
      if (n.error || n.status === 'lost') continue;
      plan.push(a);
      if (dfs(n)) return true;
      plan.pop();
    }
    memo.add(k);
    return false;
  };
  return dfs(start) ? plan : null;
}
/** The shortest command list from `start` that ends with a command meeting `ok` (lessons). */
function reach(start, ok) {
  let frontier = [{ st: start, plan: [] }];
  for (let depth = 0; depth < 30; depth++) {
    const next = [];
    for (const { st, plan } of frontier) {
      for (const a of R.legalActions(st)) {
        const n = R.applyCommand(st, a);
        if (n.error) continue;
        if (ok(a)) return [...plan, a];
        if (next.length < 5000) next.push({ st: n, plan: [...plan, a] });
      }
    }
    frontier = next;
  }
  throw new Error('lesson not reachable');
}

const name = (st, ref) => (ref.zone === 'waste' ? `Waste top: ${cardSpoken(st.waste[st.waste.length - 1])}` : cardSpoken(st.pyramid[ref.index]));
/** Pointer steps (click = mouse, touch = finger) for a plan from `st`; `untilEnd` the results text to wait for. */
export function pointerSteps(st, plan, verb = 'click') {
  const out = [];
  for (const a of plan) {
    out.push('frames 5');
    if (a.type === 'draw') out.push(`${verb} =Draw`);
    else if (a.type === 'recycle') out.push(`${verb} =Recycle`);
    else {
      out.push(`${verb} =${name(st, a.cards[0])}`);
      out.push('frames 5');
      // the first card is selected now (its target reads ", selected"); the second is another card
      out.push(`${verb} =${name(st, a.cards[1])}`);
      out.push('frames 25'); // the pair's 320 ms flight
    }
    st = R.applyCommand(st, a);
  }
  return { steps: out, state: st };
}
/** Key steps for a plan (main.ts onAction: arrows from no focus, Enter, D, R). */
export function keySteps(st, plan) {
  const out = [];
  const targets = (s) => [...R.exposedIndices(s.pyramid).map((i) => ({ zone: 'pyramid', index: i })), ...(s.waste.length ? [{ zone: 'waste' }] : [])];
  const pick = (s, ref) => {
    const t = targets(s);
    const k = t.findIndex((x) => x.zone === ref.zone && x.index === ref.index);
    if (k < 0) throw new Error('target not reachable by keys');
    // from no focus ArrowRight k + 1 times reaches k; ArrowLeft m times reaches n - 1 - m (main.js's step from index -1)
    const right = k + 1, left = t.length - 1 - k;
    const useLeft = left >= 1 && left < right;
    for (let i = 0; i < (useLeft ? left : right); i++) { out.push(`key ${useLeft ? 'ArrowLeft' : 'ArrowRight'} 1`); out.push('frames 1'); }
    out.push('key Enter 1');
    out.push('frames 3');
  };
  for (const a of plan) {
    if (a.type === 'draw') { out.push('key KeyD 1'); out.push('frames 3'); }
    else if (a.type === 'recycle') { out.push('key KeyR 1'); out.push('frames 3'); }
    else { pick(st, a.cards[0]); pick(st, a.cards[1]); out.push('frames 22'); }
    st = R.applyCommand(st, a);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(root, 'tests', 'native');
  const header = (lines) => lines.map((l) => `# ${l}`).join('\n') + '\n';

  // 1. Practice seed 4242 (Ridge) won with the mouse on the named card targets, desktop.
  {
    const st = R.newGame(4242, { recycles: 2 });
    const plan = solve(st);
    const { steps, state } = pointerSteps(st, plan, 'click');
    const total = R.scoreComponents(state).total;
    writeFileSync(join(dir, 'practice-win.play'), header([
      'Generated by tools/gen-plays.mjs: Practice (Ridge) on seed 4242 won by mouse clicks on the cards,',
      `${plan.length} commands to a full clear (score ${total}), at 1280 x 800.`,
    ]) + [
      '# viewport 1280x800@1',
      'until 600 Summit Pyramid', 'frames 30', 'click =Play',
      'until 600 Pair to 14', 'frames 10', 'click =Quit tutorial',
      'until 300 Choose a mode', 'frames 10', 'click Practice — pick a difficulty',
      'until 300 Seed (optional)', 'frames 10', 'click random', 'type 4242', 'frames 5', 'click Ridge',
      'until 300 Practice — Ridge', 'frames 60', 'save sp-practice',
      ...steps,
      'until 300 Every card reached the summit', 'frames 10', `expect ${total}`, 'expect First Light', 'save sp-practice-won',
      'frames 5', 'click =Mode select', 'until 300 Choose a mode',
    ].join('\n') + '\n');
  }

  // 2. The five lessons by finger on a phone at DPR 3.
  {
    const steps = [];
    for (const l of C.TUTORIAL.lessons) {
      let st = R.newGame(l.seed, { recycles: l.recycles == null ? 2 : l.recycles });
      if (l.drawAll) while (st.stock.length) st = R.applyCommand(st, { type: 'draw' });
      const plan = reach(st, (a) => a.type === l.require.type && (!l.require.waste || a.cards.some((c) => c.zone === 'waste')));
      steps.push(`until 300 ${l.title}`, 'frames 30');
      steps.push(...pointerSteps(st, plan, 'touch').steps);
    }
    writeFileSync(join(dir, 'learn-phone.play'), header([
      'Generated by tools/gen-plays.mjs: the five Learn lessons played by finger on a phone (390 x 844 at DPR 3):',
      'pair, uncover, draw, the waste pair and recycle; then the modes screen.',
    ]) + [
      '# viewport 390x844@3',
      'until 600 Summit Pyramid', 'frames 30', 'touch =Play',
      'until 600 1/5', 'frames 60', 'save sp-learn-phone',
      ...steps,
      'until 300 Lessons complete', 'until 300 Choose a mode', 'frames 10', 'save sp-learn-done',
    ].join('\n') + '\n');
  }

  // 3. Practice Foothill (three recycles) on seed 4242 by keys only (arrows + Enter, D, R), short landscape.
  {
    const st = R.newGame(4242, { recycles: 3 });
    const plan = solve(st);
    const end = R.applyCommands(4242, plan, { recycles: 3 }).state;
    writeFileSync(join(dir, 'practice-keys.play'), header([
      `Generated by tools/gen-plays.mjs: Practice Foothill on seed 4242 won by keys only, ${plan.length} commands`,
      `(score ${R.scoreComponents(end).total}), in a short landscape window (844 x 390).`,
    ]) + [
      '# viewport 844x390@1',
      'until 600 Summit Pyramid', 'frames 30', 'click =Play',
      'until 600 Pair to 14', 'frames 10', 'click =Quit tutorial',
      'until 300 Choose a mode', 'frames 10', 'click Practice — pick a difficulty',
      'until 300 Seed (optional)', 'frames 10', 'click random', 'type 4242', 'frames 5', 'click Foothill',
      'until 300 Practice — Foothill', 'frames 60', 'save sp-keys-land',
      ...keySteps(st, plan),
      'until 300 Every card reached the summit', 'frames 10', `expect ${R.scoreComponents(end).total}`, 'save sp-keys-won',
    ].join('\n') + '\n');
  }
  console.log('wrote tests/native/practice-win.play, learn-phone.play, practice-keys.play');
}
