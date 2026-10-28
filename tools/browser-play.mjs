// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3): on the desktop the first two
// lessons by mouse clicks on the cards, then Practice on seed 4242 won to a
// full clear by clicks (with a pause by Escape); on the phone the five
// lessons by finger; sideways Practice Foothill on seed 4242 started and its
// first ten commands played by finger on the cards and the tray. Widgets
// and the cards' named targets are found through the page's accessibility
// mirror of the engine's UI. Screenshots of each step go to --shots. Fails
// on console errors or warnings, the runtime's error screen, or a view that
// does not finish.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { solve } from './gen-plays.mjs';
import { cardSpoken } from '../app/loc.js';
const R = createRequire(import.meta.url)('../rules.js');
const C = createRequire(import.meta.url)('../content.js');

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const views = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(4000);
  const shot = async (name) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${name}.png`) }); } };
  const find = (name) => page.getByRole('button', { name, exact: true }).or(page.getByRole('checkbox', { name, exact: true })).or(page.getByText(name, { exact: true })).first();
  /** A tap / click at window coordinates (CSS px). */
  const tapAt = async (x, y) => {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  /** A press on a widget (or a table target): the mouse on the desktop, a finger on the phones. */
  const press = async (name) => {
    const el = find(name);
    await el.waitFor({ timeout: 15000 });
    const b = await el.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await page.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  };
  let reached = false;
  const name = (st, ref) => (ref.zone === 'waste' ? `Waste top: ${cardSpoken(st.waste[st.waste.length - 1])}` : cardSpoken(st.pyramid[ref.index]));
  /** Commands as presses on the cards' targets and the tray (main.ts tapTarget). */
  const playPlan = async (st, plan) => {
    for (const a of plan) {
      if (a.type === 'draw') await press('Draw');
      else if (a.type === 'recycle') await press('Recycle');
      else {
        for (const ref of a.cards) {
          const target = page.getByRole('button', { name: new RegExp(`^${name(st, ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`) }).first();
          await target.waitFor({ timeout: 15000 });
          const bb = await target.boundingBox();
          await tapAt(bb.x + bb.width / 2, bb.y + bb.height / 2);
        }
        await page.waitForTimeout(450); // the pair's flight
      }
      st = R.applyCommand(st, a);
    }
  };
  const lesson = (l) => {
    let st = R.newGame(l.seed, { recycles: l.recycles == null ? 2 : l.recycles });
    if (l.drawAll) while (st.stock.length) st = R.applyCommand(st, { type: 'draw' });
    // the first legal command meeting the lesson (a draw first for the waste pair)
    const ok = (a) => a.type === l.require.type && (!l.require.waste || a.cards.some((c) => c.zone === 'waste'));
    const plan = [];
    let s2 = st;
    for (let i = 0; i < 30; i++) {
      const acts = R.legalActions(s2);
      const hit = acts.find(ok);
      if (hit) { plan.push(hit); break; }
      const d = acts.find((x) => x.type === 'draw') || acts[0];
      plan.push(d); s2 = R.applyCommand(s2, d);
    }
    return { st, plan };
  };
  const practice = async (difficulty) => {
    await press('Practice — pick a difficulty, unranked');
    const box = page.getByRole('textbox').first();
    await box.waitFor({ timeout: 15000 });
    const bb = await box.boundingBox();
    await tapAt(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.keyboard.type('4242');
    await page.waitForTimeout(300);
    await press(difficulty);
    await page.getByText(new RegExp(`Practice — `)).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
  };
  try {
    await shot('title');
    await press('Play');
    const L = C.TUTORIAL.lessons;
    const count = v.name === 'phone' ? L.length : v.name === 'desktop' ? 2 : 0;
    for (let i = 0; i < count; i++) {
      await page.getByText(`${i + 1}/5`, { exact: false }).first().waitFor({ timeout: 60000 });
      await page.waitForTimeout(1500);
      await shot(`lesson-${i + 1}`);
      const { st, plan } = lesson(L[i]);
      await playPlan(st, plan);
    }
    if (count < L.length) await press('Quit tutorial');
    await page.getByText('Choose a mode').first().waitFor({ timeout: 30000 });
    await shot('modes');
    if (v.name === 'desktop') {
      await practice('Ridge — The standard ascent.');
      await shot('practice');
      await page.keyboard.press('Escape');
      await find('Resume').waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      await shot('pause');
      await press('Resume');
      await page.waitForTimeout(500);
      const st = R.newGame(4242, { recycles: 2 });
      await playPlan(st, solve(st));
      await page.getByText('Pyramid cleared!').first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(800);
      await shot('practice-won');
    } else if (v.name === 'landscape') {
      await practice('Foothill — Three recycles. Learn the ropes.');
      await shot('practice');
      const st = R.newGame(4242, { recycles: 3 });
      await playPlan(st, solve(st).slice(0, 10));
      await page.waitForTimeout(500);
      await shot('practice-10');
    }
    reached = true;
  } catch (e) { problems.push(`play: ${String(e.message || e).split('\n')[0]}`); await shot('failed'); }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0 && reached;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'} played=${reached}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
