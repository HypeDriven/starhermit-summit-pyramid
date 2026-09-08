'use strict';

/*
 * Summit Pyramid — authoritative server (no dependencies).
 * Serves the static game, validates score submissions by replaying commands
 * through rules.js, keeps global + daily leaderboards and achievements in
 * JSON files under data/, rate-limits per IP, dedupes commands by id.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { R, C, validateScoreClaim } = require('./game.js');

const ROOT = __dirname;
const DATA_DIR = process.env.SUMMIT_DATA_DIR
  ? path.resolve(process.env.SUMMIT_DATA_DIR)
  : path.join(ROOT, 'data');
const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_BODY = 256 * 1024;
const MAX_BOARD = 100;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
  '.opus': 'audio/ogg'
};

/* ---- persistence ---- */

function dataFile(name) { return path.join(DATA_DIR, name); }

function loadJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); }
  catch (e) { return fallback; }
}

function saveJson(name, obj) {
  const tmp = dataFile(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, dataFile(name));
}

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return {
    board: loadJson('leaderboard.json', { global: [], daily: [], seen: [] }),
    achievements: loadJson('achievements.json', {})
  };
}

/* ---- rate limiting: per-IP token bucket ---- */

const buckets = new Map();
const RATE = { capacity: 30, refillPerSec: 0.5 };

function rateOk(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: RATE.capacity, last: now }; buckets.set(ip, b); }
  b.tokens = Math.min(RATE.capacity, b.tokens + ((now - b.last) / 1000) * RATE.refillPerSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/* ---- helpers ---- */

function send(res, code, obj, headers) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function scoreEntry(e) {
  return {
    seed: e.seed, mode: String(e.mode || 'score').slice(0, 24),
    dailyId: e.dailyId ? String(e.dailyId).slice(0, 10) : undefined,
    score: e.score, moves: e.moves, hash: e.hash,
    durationMs: Math.max(0, Math.min(86400000, e.durationMs | 0)),
    at: Date.now()
  };
}

function insertBoard(list, entry) {
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.moves - b.moves || a.at - b.at);
  return list.slice(0, MAX_BOARD);
}

/* ---- request handling ---- */

function createServer() {
  const db = ensureData();

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const ip = req.socket.remoteAddress || 'unknown';

    if (u.pathname.startsWith('/api/')) {
      if (!rateOk(ip)) return send(res, 429, { error: 'rate-limited' });
      try {
        if (req.method === 'GET' && u.pathname === '/api/v1/time')
          return send(res, 200, { now: Date.now() });

        if (req.method === 'GET' && u.pathname === '/api/v1/leaderboards')
          return send(res, 200, {
            global: db.board.global.slice(0, 20),
            daily: db.board.daily.slice(0, 20)
          });

        if (req.method === 'POST' && u.pathname === '/api/v1/score/submit') {
          let body;
          try { body = JSON.parse(await readBody(req)); }
          catch (e) { return send(res, 400, { error: 'bad-json' }); }
          const v = validateScoreClaim(body);
          if (!v.ok) return send(res, 422, { error: v.error, actual: v.actual });
          // command-id dedupe: reject replays containing already-seen ids
          const ids = (body.commands || []).map(c => c && c.id).filter(Boolean);
          const dup = ids.find(id => db.board.seen.includes(id));
          if (dup) return send(res, 200, { ok: true, deduped: true, score: v.score });
          const entry = scoreEntry(Object.assign({}, body, v));
          db.board.global = insertBoard(db.board.global, entry);
          if (body.dailyId) db.board.daily = insertBoard(db.board.daily, entry);
          db.board.seen = db.board.seen.concat(ids).slice(-5000);
          saveJson('leaderboard.json', db.board);
          const rank = db.board.global.indexOf(entry) + 1;
          return send(res, 200, { ok: true, score: v.score, rank, hash: v.hash });
        }

        if (req.method === 'POST' && u.pathname === '/api/v1/achievement') {
          let body;
          try { body = JSON.parse(await readBody(req)); }
          catch (e) { return send(res, 400, { error: 'bad-json' }); }
          const id = String(body && body.id || '');
          if (!/^[a-z0-9-]{3,40}$/.test(id)) return send(res, 400, { error: 'bad-achievement-id' });
          if (!C.ACHIEVEMENTS.some(a => a.id === id)) return send(res, 400, { error: 'unknown-achievement' });
          if (!db.achievements[id]) {           // idempotent
            db.achievements[id] = { count: 1, first: Date.now() };
          } else db.achievements[id].count++;
          saveJson('achievements.json', db.achievements);
          return send(res, 200, { ok: true, id });
        }

        return send(res, 404, { error: 'not-found' });
      } catch (e) {
        if (e.message === 'payload-too-large') return send(res, 413, { error: 'payload-too-large' });
        return send(res, 500, { error: 'internal' });
      }
    }

    // static files
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(res, 405, { error: 'method-not-allowed' });
    let p;
    try { p = decodeURIComponent(u.pathname); }
    catch (e) { return send(res, 400, { error: 'bad-request' }); }
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT + path.sep) || file.includes('\0')) return send(res, 403, { error: 'forbidden' });
    const rel = path.relative(ROOT, file).split(path.sep);
    // never serve dotfiles/VCS metadata or the mutable data/ store
    if (rel.some(seg => seg.startsWith('.')) || rel[0] === 'data')
      return send(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: 'not-found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'ETag': crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  return server;
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log('Summit Pyramid server on http://localhost:' + PORT);
  });
}

module.exports = { createServer, validateScoreClaim };
