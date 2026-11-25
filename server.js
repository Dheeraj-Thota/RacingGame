'use strict';
// Hyzoom server: serves the page, runs the daily ranked attempt, and re-simulates every submitted replay.
// Hardening: per-IP rate limits, live-stream caps, strict security headers and CSP, request timeouts,
// body size/type checks, same-origin checks on writes, parameterised SQL only, no stack traces to clients.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const Race = require('./physics.js'), road = Race.circuit(require('./track.json'));

const SECURE = process.env.COOKIE_SECURE === '1';      // site is served over HTTPS
const TRUST_PROXY = process.env.TRUST_PROXY === '1';   // behind a local reverse proxy (Caddy) that appends X-Forwarded-For
const MAX_BODY = 512 * 1024;

// ---------- database ----------
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'redline-v6.sqlite'));
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS attempts (day TEXT NOT NULL, player TEXT NOT NULL, token TEXT UNIQUE NOT NULL, started INTEGER NOT NULL, status TEXT NOT NULL, name TEXT NOT NULL, time REAL, reason TEXT, assists TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(day,player));");
try { db.exec('ALTER TABLE attempts ADD COLUMN splits TEXT'); } catch {} // split times at each tenth of the sector, from the server's own re-simulation

const token = () => crypto.randomBytes(24).toString('hex');
// The ranked config is the day's challenge (main car) with the assists the driver chose at start.
const ranked = (day, assists) => Race.withCar(Race.challenge(day), Race.MAIN_CAR, assists);
const cleanAssists = x => { const out = {}; if (x && typeof x === 'object') for (const k of Race.ASSIST_KEYS) if (typeof x[k] === 'boolean') out[k] = x[k]; return Race.assistsFor(Race.MAIN_CAR, out); };
// Names: no control, zero-width or text-direction characters; collapsed spaces; 24 characters max.
const cleanName = x => String(x || '').replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Driver';

// ---------- page (held in memory, with a CSP hash for its single inline script) ----------
const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'));
const scriptHashes = [...PAGE.toString().matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const CSP = ["default-src 'none'", `script-src ${scriptHashes.join(' ')}`, "style-src 'unsafe-inline'", "img-src 'self' data:", "connect-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"].join('; ');
const PAGE_ETAG = '"' + crypto.createHash('sha256').update(PAGE).digest('hex').slice(0, 32) + '"';

function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()');
  if (SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

// ---------- client identity and rate limits ----------
function clientIp(req) {
  if (TRUST_PROXY) { const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.socket.remoteAddress || 'unknown';
}
// Fixed-window counters per (rule, IP). Limits are generous for real players and stop scripted floods.
const RULES = {
  any: [300, 60e3],          // every request
  daily: [60, 60e3],         // leaderboard refreshes
  start: [6, 10 * 60e3],     // ranked starts (each needs a fresh cookie to succeed)
  startDay: [30, 24 * 3600e3],
  finish: [12, 10 * 60e3],   // replay submissions (each one is re-simulated)
  live: [20, 60e3],          // live-stream connects
};
const hits = new Map();
function limited(rule, ip) {
  const [max, win] = RULES[rule], key = rule + '|' + ip, now = Date.now();
  let h = hits.get(key);
  if (!h || now >= h.reset) { h = { n: 0, reset: now + win }; hits.set(key, h); }
  h.n++;
  return h.n > max ? Math.ceil((h.reset - now) / 1000) : 0;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now >= h.reset) hits.delete(k); }, 60e3).unref();

function identity(req, res) {
  let id = (req.headers.cookie || '').match(/(?:^|;\s*)redline=([a-f0-9]{48})(?:;|$)/)?.[1];
  if (!id) { id = token(); res.setHeader('Set-Cookie', 'redline=' + id + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000' + (SECURE ? '; Secure' : '')); }
  return id;
}
function json(res, data, status = 200, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(data)); }
const tooMany = (res, wait) => json(res, { error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': String(wait) });

class BadRequest extends Error {}
async function body(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new BadRequest('Expected JSON');
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) throw new BadRequest('Request too large');
  const chunks = []; let n = 0;
  for await (const x of req) { n += x.length; if (n > MAX_BODY) throw new BadRequest('Request too large'); chunks.push(x); }
  try { const v = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch { throw new BadRequest('Invalid JSON'); }
}
// Writes must come from this site's own page (blocks cross-site form/fetch tricks; SameSite cookies do the rest).
function sameOrigin(req) {
  const origin = req.headers.origin; if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// ---------- leaderboard ----------
function current(player, c) { return db.prepare('SELECT status,time,reason FROM attempts WHERE day=? AND player=?').get(c.day, player) || null; }
const SPLITS = 10;
// Times at each tenth of the sector, taken from the server's re-simulation (never from the browser).
function splitRecorder(config) { const out = []; let next = 1; return { out, tick: a => { while (next < SPLITS && a.s - config.start >= config.length * next / SPLITS) { out.push(Math.round((a.ticks / Race.HZ + a.penalty) * 1000) / 1000); next++; } } }; }
const median = xs => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const parse = s => { try { return JSON.parse(s || 'null'); } catch { return null; } };
// The day's finished runs, sorted, shared by every request for a couple of seconds (a burst of refreshes reads the DB once).
const cache = { day: null, at: 0, list: null };
function finishedList(day) {
  if (cache.day === day && Date.now() - cache.at < 2000) return cache.list;
  const list = db.prepare("SELECT name,time,player,assists,splits FROM attempts WHERE day=? AND status='finished' ORDER BY time,started,player").all(day);
  for (const x of list) { x.splits = parse(x.splits); x.assistText = Race.assistText(Race.assistsFor(Race.MAIN_CAR, parse(x.assists) || {})); }
  const times = list.map(x => x.time), lo = times[0], hi = times.at(-1), bins = 12, w = Math.max((hi - lo) / bins, .001), hist = Array(bins).fill(0);
  for (const t of times) hist[Math.min(bins - 1, Math.floor((t - lo) / w))]++;
  const sp = list.map(x => x.splits).filter(x => Array.isArray(x) && x.length === SPLITS - 1);
  list.summary = list.length ? { lo, hi, median: median(times), hist, binWidth: w, leader: list[0].splits, medianSplits: sp.length ? Array.from({ length: SPLITS - 1 }, (_, k) => median(sp.map(x => x[k]))) : null, count: list.length } : null;
  Object.assign(cache, { day, at: Date.now(), list });
  return list;
}
function board(player, c) {
  const list = finishedList(c.day), i = list.findIndex(x => x.player === player);
  return {
    total: list.length,
    rows: list.slice(0, 10).map((x, k) => ({ rank: k + 1, name: x.name, time: x.time, assists: x.assistText, you: x.player === player })),
    you: i < 0 ? null : { rank: i + 1, time: list[i].time, percentile: list.length === 1 ? null : 100 * list.filter(x => x.time > list[i].time).length / (list.length - 1), delta: list[i].time - list[0].time },
    field: list.summary && { ...list.summary, you: i < 0 ? null : list[i].splits },
  };
}

// ---------- live leaderboard stream ----------
const MAX_LIVE = 2000, MAX_LIVE_PER_IP = 4, live = new Set(), liveByIp = new Map();
function broadcast(day) {
  cache.day = null;
  const n = db.prepare("SELECT COUNT(*) n FROM attempts WHERE day=? AND status='finished'").get(day).n, msg = `data: ${JSON.stringify({ day, total: n })}\n\n`;
  for (const r of live) r.write(msg);
}
setInterval(() => { for (const r of live) r.write(': ping\n\n'); }, 25000).unref();
function openLive(req, res, ip) {
  const mine = liveByIp.get(ip) || 0;
  if (live.size >= MAX_LIVE || mine >= MAX_LIVE_PER_IP) return json(res, { error: 'Too many live connections' }, 429, { 'Retry-After': '60' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 10000\n\n');
  live.add(res); liveByIp.set(ip, mine + 1);
  let closed = false;
  const done = () => { if (closed) return; closed = true; live.delete(res); const n = (liveByIp.get(ip) || 1) - 1; if (n > 0) liveByIp.set(ip, n); else liveByIp.delete(ip); };
  req.on('close', done); res.on('error', done);
}

// ---------- routes ----------
async function handle(req, res) {
  baseHeaders(res);
  const url = new URL(req.url, 'http://localhost'), ip = clientIp(req), p = url.pathname;
  let wait = limited('any', ip); if (wait) return tooMany(res, wait);

  if (p === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
    db.prepare('SELECT 1').get();
    return json(res, { ok: true });
  }
  if (p === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache', 'ETag': PAGE_ETAG };
    if (req.headers['if-none-match'] === PAGE_ETAG) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, { ...headers, 'Content-Length': PAGE.length });
    return res.end(req.method === 'HEAD' ? undefined : PAGE);
  }
  if (!p.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }

  if (p === '/api/live' && req.method === 'GET') { if ((wait = limited('live', ip))) return tooMany(res, wait); return openLive(req, res, ip); }

  const c = Race.challenge();
  if (p === '/api/daily' && req.method === 'GET') {
    if ((wait = limited('daily', ip))) return tooMany(res, wait);
    const player = identity(req, res);
    return json(res, { challenge: c, attempt: current(player, c), leaderboard: board(player, c) });
  }
  if (req.method === 'POST' && (p === '/api/start' || p === '/api/finish')) {
    if (!sameOrigin(req)) return json(res, { error: 'Forbidden' }, 403);
    const player = identity(req, res);
    if (p === '/api/start') {
      if ((wait = limited('start', ip) || limited('startDay', ip))) return tooMany(res, wait);
      const b = await body(req);
      if (b.day !== c.day) return json(res, { error: 'Challenge has changed. Reload.' }, 409);
      const assists = cleanAssists(b.assists), t = token();
      try { db.prepare("INSERT INTO attempts(day,player,token,started,status,name,assists) VALUES(?,?,?,?,'running',?,?)").run(c.day, player, t, Date.now(), cleanName(b.name), JSON.stringify(assists)); }
      catch { return json(res, { error: 'Your ranked attempt has already been used.' }, 409); }
      return json(res, { token: t, challenge: ranked(c.day, assists) });
    }
    if ((wait = limited('finish', ip))) return tooMany(res, wait);
    const b = await body(req), a = db.prepare('SELECT * FROM attempts WHERE token=? AND player=?').get(String(b.token || '').slice(0, 64), player);
    if (!a) return json(res, { error: 'Attempt unavailable' }, 409);
    if (a.status !== 'running') { const config = Race.challenge(a.day); return json(res, { attempt: current(player, config), leaderboard: board(player, config) }); }
    const config = ranked(a.day, parse(a.assists) || {}), rec = splitRecorder(config);
    let result;
    try {
      result = Race.replay(config, road, b.inputs, rec.tick);
      if (!result.done && !result.invalid && !b.abandon) throw Error('Incomplete run');
      if (result.ticks / Race.HZ > (Date.now() - a.started) / 1000 + 1) throw Error('Run submitted too early');
    } catch {
      db.prepare("UPDATE attempts SET status='dnf',reason=? WHERE token=? AND status='running'").run('Replay rejected', a.token);
      return json(res, { error: 'Replay rejected' }, 400);
    }
    const valid = result.done && !result.invalid && !b.abandon && result.time !== null;
    db.prepare("UPDATE attempts SET status=?,time=?,reason=?,splits=? WHERE token=? AND status='running'").run(valid ? 'finished' : 'dnf', valid ? result.time : null, valid ? '' : result.reason || 'Abandoned', valid ? JSON.stringify(rec.out) : null, a.token);
    if (valid) broadcast(a.day);
    return json(res, { attempt: current(player, config), leaderboard: board(player, config) });
  }
  return json(res, { error: 'Not found' }, 404);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (res.headersSent) return res.destroy();
    if (e instanceof BadRequest) return json(res, { error: e.message }, 400);
    console.error(new Date().toISOString(), 'request failed:', e && e.message); // details stay in the server log
    json(res, { error: 'Request failed' }, 500);
  });
});
// Slow or oversized requests are dropped (long-lived live streams are unaffected once open).
server.headersTimeout = 10000;
server.requestTimeout = 15000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 60;
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Hyzoom running on port ' + (process.env.PORT || 3000)));
