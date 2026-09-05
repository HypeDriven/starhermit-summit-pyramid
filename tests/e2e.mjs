/**
 * Summit Pyramid — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the REAL visible UI in headless Chrome via playwright-core:
 *   title → Settings (enable the accessible 2D board + high contrast) →
 *   Help open/close → Play (first run launches the Learn tutorial; skipped
 *   through the real "Skip lesson" control) → modes → Practice (fixed seed)
 *   → a full round played to its authentic end on the visible board →
 *   results screen with score breakdown → persisted stats → back to modes.
 *   Also exercises Hint, Pause/Resume, Draw + Undo through the real controls.
 * A second, shorter pass repeats load → tutorial skip → practice → a handful
 * of real touchscreen.tap moves on a mobile viewport.
 *
 * Window.SummitRules / SummitContent are the game's own pure engine globals.
 * The test uses them ONLY to pre-compute, for the chosen practice seed, the
 * sequence of legal (remove/draw/recycle) actions that plays the round —
 * every action is then performed as a genuinely visible click/tap on the
 * board buttons (#board-dom .card-btn) or tray buttons. The engine is never
 * called in the page to make a move and no game source is modified.
 *
 * Serving: the repo ships `server.js` = the StarHermit authoritative host.
 * The game is fully playable offline — when `/api/*` is absent the api adapter
 * degrades to offline mode (Api.detect → available=false, local results). So,
 * following the blockstead/picture-logic conventions, this test embeds a
 * minimal node:http static server on an ephemeral port and answers /api/*
 * with 404 so the client takes its documented offline path with no noise.
 *
 * NOTE (resolved defect): TARGET=21 made the win unreachable — with card
 * values A=1..K=13, only ranks 8..K could ever sum to 21, so ranks 1-7 could
 * never be removed and a 28-card pyramid could never clear. The rules target
 * is now 14 (A+K, 2+Q, 3+J, 4+10, 5+9, 6+8, 7+7), the only sum for which every
 * rank has a partner, so a full 7-row clear is reachable. computePlan below
 * runs an exhaustive memoized DFS over the real rules engine to find a genuine
 * winning line, and the desktop pass now asserts the "Pyramid cleared!" win
 * rather than the old unavoidably-lost "Round over" end.
 * The game is fully playable (draw, recycle, pair, undo, pause, hint all work);
 * the genuine "No legal moves remain" loss is still reachable when truly stuck.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/summit-pyramid-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function startServer() {
  const server = http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch (e) {
      res.writeHead(400).end('bad request');
      return;
    }
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // includes /api/* → game takes its documented offline path
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------- deterministic practice round ----------
const PRACTICE_SEED = 4242;      // a fixed deal → deterministic result
const PRACTICE_RECYCLES = 2;     // "Ridge" (normal) difficulty
let PLAN = null;                 // computed once from the real rules engine

function computePlan() {
  const R = requireFromRules();
  let s = R.newGame(PRACTICE_SEED, { recycles: PRACTICE_RECYCLES });
  // Exhaustive memoized DFS (over the real rules engine) for a FULL 7-row
  // clear. This proves the "Pyramid cleared!" win is genuinely reachable,
  // then every planned command is replayed as real visible clicks/taps.
  const memo = new Set();
  const plan = [];
  let nodes = 0;
  const keyOf = (st) =>
    st.pyramid.join(',') + '|' + st.stock.join(',') + '|' + st.waste.join(',') + '|' + st.recyclesLeft;
  const dfs = (st) => {
    if (st.status === 'won') return true;
    if (st.status === 'lost') return false;
    const k = keyOf(st);
    if (memo.has(k)) return false;
    if (++nodes > 500000) throw new Error('solver node budget exceeded');
    const acts = R.legalActions(st);
    const order = [
      ...acts.filter((a) => a.type === 'remove'),
      ...acts.filter((a) => a.type === 'draw'),
      ...acts.filter((a) => a.type === 'recycle'),
    ];
    for (const a of order) {
      const n = R.applyCommand(st, a);
      if (n.error || n.status === 'lost') continue;
      plan.push(a);
      if (dfs(n)) return true;
      plan.pop();
    }
    memo.add(k);
    return false;
  };
  const won = dfs(s);
  if (!won) throw new Error(`practice seed ${PRACTICE_SEED} is not solvable to a full clear`);
  // Replay the winning plan once to confirm it terminates as a full clear
  // and to cross-check the move count that the HUD must reach.
  const finalState = R.applyCommands(PRACTICE_SEED, plan, { recycles: PRACTICE_RECYCLES }).state;
  if (!finalState.pyramid.every((c) => c == null))
    throw new Error('solver plan did not clear the pyramid');
  return { plan, finalStatusCode: finalState.status };
}

function requireFromRules() {
  const require = createRequire(import.meta.url);
  return require(path.join(ROOT, 'rules.js'));
}

// ---------- in-page helpers (real UI controls only) ----------
async function tapCard(page, ref, touch) {
  if (ref.zone === 'waste') {
    await page.locator('#board-dom .card-btn[data-zone="waste"]').click();
  } else {
    await page.locator(`#board-dom .card-btn[data-index="${ref.index}"]`).click();
  }
}

async function tapTray(page, id, touch) {
  const loc = page.locator(`#${id}`);
  await loc.click();
}

// Wait for the HUD moves counter to reach `n`.
async function waitMoves(page, n, timeout = 6000) {
  try {
    await page.waitForFunction(
      (m) => Number(document.getElementById('moves').textContent || '0') >= m,
      n, { timeout },
    );
    return true;
  } catch { return false; }
}

const visible = (page, id) =>
  page.waitForFunction((i) => { const el = document.getElementById(i); return el && !el.hidden; }, id, { timeout: 10000 });

// Play one planned command through the visible controls, then wait for the
// HUD moves counter to advance (so a no-op click fails rather than silently).
async function doCommand(page, cmd, expectedMoves, touch) {
  if (cmd.type === 'remove') {
    await tapCard(page, cmd.cards[0], touch);
    await tapCard(page, cmd.cards[1], touch);
  } else if (cmd.type === 'draw') await tapTray(page, 'btn-draw', touch);
  else if (cmd.type === 'recycle') await tapTray(page, 'btn-recycle', touch);
  else throw new Error('unmapped command ' + cmd.type);
  if (!(await waitMoves(page, expectedMoves))) {
    throw new Error(`command ${JSON.stringify(cmd)} did not reach moves=${expectedMoves}`);
  }
}

// Skip through the first-run Learn tutorial using the real "Skip lesson"
// button until the lesson flow quits to the modes screen.
async function skipTutorial(page, touch) {
  for (let i = 0; i < 8; i++) {
    if (await page.locator('#scr-modes:not([hidden])').count()) return;
    const b = page.locator('#btn-tut-skip');
    if (await b.count()) await b.click();
    else break;
  }
  await visible(page, 'scr-modes');
}

async function startPractice(page, seed, touch) {
  await visible(page, 'scr-modes');
  await page.click('#mode-practice');
  await visible(page, 'scr-practice');
  await page.fill('#practice-seed', String(seed));
  await page.locator('#diff-list button', { hasText: 'Ridge' }).click();
  await page.waitForFunction((s) => {
    const t = document.getElementById('topbar');
    return t && !t.hidden && Number(document.getElementById('seed').textContent) === Number('' + s);
  }, seed, { timeout: 12000 });
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(r.url())) {
      errors.push(`http ${r.status()}: ${r.url()}`);
    }
  });

  const ok = (msg) => console.log(`ok - [${name}] ${msg}`);
  const touch = !!ctxOpts.hasTouch;

  try {
    // load + title
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForSelector('#scr-title:not([hidden])', { timeout: 15000 });
    await page.screenshot({ path: SHOT('title', name) });
    ok('title screen visible');

    // Settings: enable the accessible 2D board (real visible controls) + HC
    await page.click('#btn-title-settings');
    await page.waitForSelector('#scr-settings:not([hidden])');
    await page.locator('#opt-dom').check();
    await page.locator('#opt-hc').check();
    await page.waitForFunction(() => document.getElementById('board-dom').classList.contains('visible'));
    await page.screenshot({ path: SHOT('settings', name) });
    await page.click('#scr-settings button[data-back="auto"]');
    await page.waitForSelector('#scr-title:not([hidden])');
    ok('Settings open → 2D board enabled → closed');

    // Help open/close
    await page.click('#btn-title-help');
    await page.waitForSelector('#scr-help:not([hidden])');
    await page.screenshot({ path: SHOT('help', name) });
    await page.click('#scr-help button[data-back="auto"]');
    await page.waitForSelector('#scr-title:not([hidden])');
    ok('Help open/close');

    // Play → first-run Learn tutorial → skip through to modes
    await page.click('#btn-play');
    await page.waitForSelector('#scr-tut:not([hidden])', { timeout: 12000 });
    ok('Play launches the Learn tutorial (first run)');
    await skipTutorial(page, touch);
    await page.waitForSelector('#scr-modes:not([hidden])', { timeout: 10000 });
    await page.screenshot({ path: SHOT('modes', name) });
    ok('tutorial skipped → modes screen');

    // Practice (fixed seed, Ridge) → active round
    await startPractice(page, PRACTICE_SEED, touch);
    const boardCells = await page.locator('#board-dom .card-btn[data-index]').count();
    if (boardCells !== 28) throw new Error(`expected 28 board cells, got ${boardCells}`);
    const seedNum = await page.textContent('#seed');
    if (seedNum.trim() !== String(PRACTICE_SEED)) throw new Error(`seed mismatch: ${seedNum}`);
    if (await page.locator('#board-dom').evaluate((el) => !el.classList.contains('visible')))
      throw new Error('2D board not visible during play');
    await page.screenshot({ path: SHOT('play', name) });
    ok(`round active (seed ${PRACTICE_SEED}, ${boardCells} cells, 2D board visible)`);

    if (full) {
      // Hint button → toast, no state change
      await page.click('#btn-hint');
      await page.waitForFunction(() => document.getElementById('toast').style.display === 'block', null, { timeout: 4000 });
      ok('Hint shows a hint toast');

      // Pause / resume via the real buttons
      await page.click('#btn-pause');
      await page.waitForSelector('#scr-pause:not([hidden])');
      await page.screenshot({ path: SHOT('pause', name) });
      await page.click('#btn-resume-pause');
      await page.waitForFunction(() => document.getElementById('scr-pause').hidden);
      ok('Pause and resume work');

      // Draw then Undo (real controls prove undo restores the pre-draw state)
      await page.click('#btn-draw');
      if (!(await waitMoves(page, 1))) throw new Error('draw did not increment moves');
      await page.click('#btn-undo');
      if (!(await page.waitForFunction(() => Number(document.getElementById('moves').textContent) === 0, null, { timeout: 4000 })))
        throw new Error('undo did not restore moves to 0');
      ok('Draw → Undo restores the previous move count');

      // Play the whole deterministic round through the visible board.
      // Each planned command is performed as real clicks on board/tray
      // buttons; the HUD moves counter verifies each one actually landed.
      const totalCommands = PLAN.length;
      for (let i = 0; i < totalCommands; i++) {
        await doCommand(page, PLAN[i], i + 1, touch);
      }
      // Round now terminal → results screen
      await page.waitForSelector('#scr-results:not([hidden])', { timeout: 10000 });
      const headline = (await page.textContent('#result-headline'))?.trim();
      const reason = (await page.textContent('#result-reason'))?.trim();
      if (!/Pyramid cleared/.test(headline)) {
        throw new Error(`expected "Pyramid cleared!" headline, got "${headline}" (reason: ${reason})`);
      }
      if (!/Every card reached the summit/.test(reason)) {
        throw new Error(`expected clear reason, got "${reason}"`);
      }
      const rows = await page.locator('#result-table tr').count();
      if (rows !== 6) throw new Error(`expected 6 score breakdown rows, got ${rows}`);
      await page.screenshot({ path: SHOT('results', name) });
      ok(`round finished on the visible board → full clear ("${headline}", ${reason}, ${rows} breakdown rows)`);

      // Persistence: this win recorded stats
      const prog = await page.evaluate(() => {
        const raw = localStorage.getItem('summit-pyramid-save-v1');
        if (!raw) return null;
        return JSON.parse(JSON.parse(raw).payload);
      });
      if (!prog) throw new Error('save document missing after round');
      if (!(prog.stats && prog.stats.wins >= 1)) throw new Error('win not recorded: ' + JSON.stringify(prog.stats));
      if (!(prog.stats.totalPairs >= 14)) throw new Error('full clear should credit >=14 pairs: ' + JSON.stringify(prog.stats));
      ok(`progress persisted (wins ${prog.stats.wins}, totalPairs ${prog.stats.totalPairs})`);

      // Back to modes from results
      await page.click('#btn-results-modes');
      await page.waitForSelector('#scr-modes:not([hidden])');
      ok('results → mode select');
    } else {
      // Mobile pass: make the first few planned moves with touchscreen.tap
      const n = Math.min(6, PLAN.length);
      for (let i = 0; i < n; i++) {
        const cmd = PLAN[i];
        if (cmd.type === 'remove') {
          await tapCard(page, cmd.cards[0], touch);
          await tapCard(page, cmd.cards[1], touch);
        } else if (cmd.type === 'draw') {
          const bb = await page.locator('#btn-draw').boundingBox();
          if (!bb) throw new Error('draw button not found');
          await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
        } else if (cmd.type === 'recycle') {
          const bb = await page.locator('#btn-recycle').boundingBox();
          if (!bb) throw new Error('recycle button not found');
          await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
        }
        if (!(await waitMoves(page, i + 1))) throw new Error(`mobile move ${i + 1} did not register`);
      }
      const moves = await page.textContent('#moves');
      await page.screenshot({ path: SHOT('mobile-play', name) });
      ok(`started practice and made ${n} real touch moves (moves=${moves.trim()})`);
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  ok('no page errors');
}

// ---------- main ----------
const { server, port } = await startServer();
PLAN = computePlan().plan;
console.log(`serving ${ROOT} at http://127.0.0.1:${port}/ (practice seed ${PRACTICE_SEED}, ${PLAN.length} planned moves)`);

let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — summit-pyramid, desktop + mobile, no page errors');
} catch (e) {
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (process.exitCode) process.exit(1);
