// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics from the
// title, skips the first-run lesson, starts Practice → Ridge on a fixed deal and plays a full winning clear
// (solved once with the real rules engine, like tests/e2e.mjs) with the game's keyboard controls on the 3D
// board (→ steps the card focus through the exposed cards and the waste, Enter selects, D draws, R recycles),
// so cards lift, pairs spark and fly off, the stock draws and the campfire, embers and stars animate; a
// cleared pyramid starts the same practice deal again from the results screen (no reloads).
import { createRequire } from 'node:module';

export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const SEED = 4242, RECYCLES = 2; // "Ridge" difficulty
const R = createRequire(import.meta.url)('../rules.js');

// A winning command list for the deal (memoized DFS over the real rules engine).
function solve() {
  const memo = new Set(), plan = [];
  const keyOf = (st) => st.pyramid.join(',') + '|' + st.stock.join(',') + '|' + st.waste.join(',') + '|' + st.recyclesLeft;
  const dfs = (st) => {
    if (st.status === 'won') return true;
    if (st.status === 'lost' || memo.has(keyOf(st))) return false;
    const acts = R.legalActions(st);
    for (const a of [...acts.filter((x) => x.type === 'remove'), ...acts.filter((x) => x.type !== 'remove')]) {
      const n = R.applyCommand(st, a);
      if (n.error || n.status === 'lost') continue;
      plan.push(a);
      if (dfs(n)) return true;
      plan.pop();
    }
    memo.add(keyOf(st));
    return false;
  };
  if (!dfs(R.newGame(SEED, { recycles: RECYCLES }))) throw new Error('bench deal is not solvable');
  return plan;
}
const PLAN = solve();

export async function setPreset(page, preset) {
  await page.waitForSelector('#scr-title:not([hidden])', { timeout: 30000 });
  await page.click('#btn-title-settings');
  await page.waitForSelector('#scr-settings:not([hidden])');
  await page.selectOption('#opt-tier', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#scr-settings button[data-back="auto"]');
  await page.waitForSelector('#scr-title:not([hidden])');
}

async function practice(page, press) {
  await page.waitForSelector('#scr-modes:not([hidden])', { timeout: 10000 });
  await press('#mode-practice');
  await page.waitForSelector('#scr-practice:not([hidden])');
  await page.fill('#practice-seed', String(SEED));
  await page.locator('#diff-list button', { hasText: 'Ridge' }).click();
  await page.waitForFunction(() => !document.getElementById('topbar').hidden && Number(document.getElementById('moves').textContent || '0') === 0, null, { timeout: 12000 });
}

// The game's keyboard focus order: exposed pyramid cards, then the waste top (see navTargets in app/main.js).
const navTargets = (st) => [...R.exposedIndices(st.pyramid).map((i) => ({ zone: 'pyramid', index: i })), ...(st.waste.length ? [{ zone: 'waste' }] : [])];

async function pickCard(page, st, ref) {
  const k = navTargets(st).findIndex((t) => t.zone === ref.zone && (ref.zone === 'waste' || t.index === ref.index));
  for (let i = 0; i <= k; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
}

export async function start(page, { mobile } = {}) {
  const press = (sel) => (mobile ? page.tap(sel, { timeout: 3000 }) : page.click(sel, { timeout: 3000 }));
  await press('#btn-play');
  for (let i = 0; i < 10 && !(await page.locator('#scr-modes:not([hidden])').count()); i++) {
    if (await page.locator('#btn-tut-skip').count()) await press('#btn-tut-skip').catch(() => {});
    await page.waitForTimeout(300);
  }
  await practice(page, press);
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        await page.evaluate(() => document.activeElement?.blur()); // keys go to the board, not a menu button
        let st = R.newGame(SEED, { recycles: RECYCLES });
        for (const cmd of PLAN) {
          if (!open) return;
          if (cmd.type === 'remove') { await pickCard(page, st, cmd.cards[0]); await pickCard(page, st, cmd.cards[1]); }
          else await page.keyboard.press(cmd.type === 'draw' ? 'KeyD' : 'KeyR');
          st = R.applyCommand(st, cmd);
          await page.waitForTimeout(300);
        }
        await page.waitForSelector('#scr-results:not([hidden])', { timeout: 10000 });
        await press('#btn-results-modes');
        await practice(page, press);
      } catch (e) {
        if (!open) return;
        if (process.env.BENCH_DEBUG) console.error(e.message);
        await page.waitForTimeout(500).catch(() => {});
      }
    }
  })();
  await page.waitForTimeout(1500);
}
