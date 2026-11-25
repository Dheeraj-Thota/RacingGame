'use strict';
// Hyzoom server: serves the page, runs the daily ranked attempt, and re-simulates every submitted replay.
// Hardening: per-IP rate limits, live-stream caps, strict security headers and CSP, request timeouts,
// body size/type checks, same-origin checks on writes, parameterised SQL only, no stack traces to clients.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const Race = require('./physics.js'), Names = require('./names.js'), road = Race.circuit(require('./track.json'));

const SECURE = process.env.COOKIE_SECURE === '1';      // site is served over HTTPS
const TRUST_PROXY = process.env.TRUST_PROXY === '1';   // behind a local reverse proxy (Caddy) that appends X-Forwarded-For
const MAX_BODY = 512 * 1024;
// Sign-in: with GOOGLE_CLIENT_ID set, ranked attempts belong to a Google account (one per account per day).
// Without it (local development) the anonymous cookie is the identity, as before.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const AUTH = !!GOOGLE_CLIENT_ID;

// ---------- database ----------
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'redline-v6.sqlite'));
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS attempts (day TEXT NOT NULL, player TEXT NOT NULL, token TEXT UNIQUE NOT NULL, started INTEGER NOT NULL, status TEXT NOT NULL, name TEXT NOT NULL, time REAL, reason TEXT, assists TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(day,player));");
try { db.exec('ALTER TABLE attempts ADD COLUMN splits TEXT'); } catch {} // split times at each tenth of the sector, from the server's own re-simulation
try { db.exec('ALTER TABLE attempts ADD COLUMN inputs TEXT'); } catch {} // the validated replay, so others can race it as a ghost
try { db.exec('ALTER TABLE attempts ADD COLUMN share TEXT'); } catch {} // public id for share and challenge links
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS attempts_share ON attempts(share)');
db.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, sub TEXT NOT NULL, created INTEGER NOT NULL)');
// First-party product analytics: pseudonymous (hashed visitor/account IDs), no IP addresses, kept 13 months. See src/privacy.html.
db.exec('CREATE TABLE IF NOT EXISTS events (ts INTEGER NOT NULL, day TEXT NOT NULL, visitor TEXT, account TEXT, type TEXT NOT NULL, props TEXT)');
db.exec('CREATE INDEX IF NOT EXISTS events_day_type ON events(day, type)');
db.exec('CREATE INDEX IF NOT EXISTS events_visitor ON events(visitor, day)');
const purgeEvents = () => db.prepare('DELETE FROM events WHERE ts < ?').run(Date.now() - 396 * 864e5);
purgeEvents(); setInterval(purgeEvents, 864e5).unref();
db.prepare('DELETE FROM sessions WHERE created < ?').run(Date.now() - 90 * 864e5);

const token = () => crypto.randomBytes(24).toString('hex');
// The ranked config is the day's challenge (main car) with the assists the driver chose at start.
const ranked = (day, assists) => Race.withCar(Race.challenge(day), Race.MAIN_CAR, assists);
const cleanAssists = x => { const out = {}; if (x && typeof x === 'object') for (const k of Race.ASSIST_KEYS) if (typeof x[k] === 'boolean') out[k] = x[k]; return Race.assistsFor(Race.MAIN_CAR, out); };
// Names are cleaned and checked for slurs/profanity by names.js (shared with the page).

// ---------- page (held in memory, with a CSP hash for its single inline script) ----------
const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'));
const scriptHashes = [...PAGE.toString().matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const GSI = 'https://accounts.google.com/gsi/';
const CSP = ["default-src 'none'", `script-src ${scriptHashes.join(' ')}${AUTH ? ' ' + GSI + 'client' : ''}`, `style-src 'unsafe-inline'${AUTH ? ' ' + GSI + 'style' : ''}`,
  "img-src 'self' data:", `connect-src 'self'${AUTH ? ' ' + GSI : ''}`, ...(AUTH ? [`frame-src ${GSI}`] : []),
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"].join('; ');
const PRIVACY = fs.readFileSync(path.join(__dirname, 'src', 'privacy.html'));
const PRIVACY_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PAGE_ETAG = '"' + crypto.createHash('sha256').update(PAGE).digest('hex').slice(0, 32) + '"';

function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', AUTH ? 'strict-origin-when-cross-origin' : 'no-referrer'); // Google sign-in needs the origin
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', AUTH ? 'same-origin-allow-popups' : 'same-origin'); // sign-in popup
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
  auth: [10, 10 * 60e3],     // sign-in attempts
  event: [120, 60e3],        // analytics events from the page
  ghost: [30, 60e3],         // ghost downloads
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
// Signed-in player (Google account), from the session cookie.
function sessionSub(req) {
  const t = (req.headers.cookie || '').match(/(?:^|;\s*)hz_session=([a-f0-9]{48})(?:;|$)/)?.[1];
  if (!t) return null;
  const row = db.prepare('SELECT sub, created FROM sessions WHERE token=?').get(t);
  return row && Date.now() - row.created < 90 * 864e5 ? row.sub : null;
}
// The identity ranked attempts are keyed by: the Google account when sign-in is on, else the anonymous cookie.
function player(req, res) { if (!AUTH) return identity(req, res); const sub = sessionSub(req); return sub ? 'g:' + sub : null; }

// Google ID tokens are verified locally: RS256 signature against Google's published keys, issuer, audience and expiry.
let jwks = { keys: [], until: 0 };
async function googleKeys() {
  if (Date.now() < jwks.until) return jwks.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw Error('Google keys unavailable');
  const age = Number((r.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwks = { keys: (await r.json()).keys || [], until: Date.now() + Math.min(age, 86400) * 1000 };
  return jwks.keys;
}
const b64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
async function verifyGoogle(credential, keys) {
  const parts = String(credential || '').split('.');
  if (parts.length !== 3 || credential.length > 4096) throw new BadRequest('Bad sign-in token');
  let head, claims; try { head = JSON.parse(b64url(parts[0])); claims = JSON.parse(b64url(parts[1])); } catch { throw new BadRequest('Bad sign-in token'); }
  if (head.alg !== 'RS256') throw new BadRequest('Bad sign-in token');
  const jwk = (keys || await googleKeys()).find(k => k.kid === head.kid && k.kty === 'RSA');
  if (!jwk) throw new BadRequest('Bad sign-in token');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]));
  const now = Date.now() / 1000;
  if (!ok || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== GOOGLE_CLIENT_ID || !(claims.exp > now) || !(claims.iat < now + 300) || typeof claims.sub !== 'string' || !claims.sub)
    throw new BadRequest('Sign-in could not be verified');
  return claims.sub;
}

function json(res, data, status = 200, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(data)); }
const tooMany = (res, wait) => json(res, { error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': String(wait) });

class BadRequest extends Error {}

// ---------- analytics ----------
const anonHash = (kind, id) => id ? crypto.createHash('sha256').update(kind + ':' + id).digest('hex').slice(0, 20) : null;
const utcDay = () => new Date().toISOString().slice(0, 10);
const device = req => { const ua = String(req.headers['user-agent'] || ''); return /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop'; };
const optedOut = req => req.headers['sec-gpc'] === '1' || req.headers.dnt === '1';
// Only these events and fields are accepted from the page; values are short strings, numbers or booleans.
const EVENTS = {
  visit: ['ref', 'utm', 'vs', 'w', 'returning'],
  practice_start: ['car', 'mode'],
  run_end: ['mode', 'car', 'finished', 'time', 'secs'],
  results_view: ['mode'],
  share: ['mode', 'native'],
  ghost_pick: ['which'],
};
function cleanProps(type, props) {
  const out = {}; if (!props || typeof props !== 'object') return out;
  for (const k of EVENTS[type] || []) { const v = props[k]; if (typeof v === 'boolean') out[k] = v; else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000; else if (typeof v === 'string') out[k] = v.replace(/[^\w.:/@+-]/g, '').slice(0, 60); }
  return out;
}
function track(req, res, type, props = {}, who) {
  try {
    const out = optedOut(req), visitor = out ? null : anonHash('v', identity(req, res)), account = out ? null : anonHash('a', who === undefined ? (AUTH ? sessionSub(req) : null) : who);
    db.prepare('INSERT INTO events(ts,day,visitor,account,type,props) VALUES(?,?,?,?,?,?)').run(Date.now(), utcDay(), visitor, account, type, JSON.stringify({ ...props, device: device(req) }));
  } catch (e) { console.error('analytics:', e && e.message); }
}
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
function current(player, c) { return db.prepare('SELECT status,time,reason,share FROM attempts WHERE day=? AND player=?').get(c.day, player) || null; }
const SPLITS = 10;
// Times at each tenth of the sector, taken from the server's re-simulation (never from the browser).
function splitRecorder(config) { const out = []; let next = 1; return { out, tick: a => { while (next < SPLITS && a.s - config.start >= config.length * next / SPLITS) { out.push(Math.round((a.ticks / Race.HZ + a.penalty) * 1000) / 1000); next++; } } }; }
const median = xs => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const parse = s => { try { return JSON.parse(s || 'null'); } catch { return null; } };
// The day's finished runs, sorted, shared by every request for a couple of seconds (a burst of refreshes reads the DB once).
const cache = { day: null, at: 0, list: null };
function finishedList(day) {
  if (cache.day === day && Date.now() - cache.at < 2000) return cache.list;
  const list = db.prepare("SELECT name,time,player,assists,splits,share FROM attempts WHERE day=? AND status='finished' ORDER BY time,started,player").all(day);
  for (const x of list) { x.splits = parse(x.splits); x.assistText = Race.assistText(Race.assistsFor(Race.MAIN_CAR, parse(x.assists) || {})); }
  const times = list.map(x => x.time), lo = times[0], hi = times.at(-1), bins = 12, w = Math.max((hi - lo) / bins, .001), hist = Array(bins).fill(0);
  for (const t of times) hist[Math.min(bins - 1, Math.floor((t - lo) / w))]++;
  const sp = list.map(x => x.splits).filter(x => Array.isArray(x) && x.length === SPLITS - 1);
  // Up to 1,500 evenly spaced quantiles of the field's times, enough to draw its distribution curve.
  const sample = times.length <= 1500 ? times : Array.from({ length: 1500 }, (_, k) => times[Math.round(k * (times.length - 1) / 1499)]);
  list.summary = list.length ? { lo, hi, median: median(times), hist, binWidth: w, times: sample, leader: list[0].splits, medianSplits: sp.length ? Array.from({ length: SPLITS - 1 }, (_, k) => median(sp.map(x => x[k]))) : null, count: list.length } : null;
  Object.assign(cache, { day, at: Date.now(), list });
  return list;
}
function board(player, c) {
  const list = finishedList(c.day), i = list.findIndex(x => x.player === player);
  return {
    total: list.length,
    rows: list.slice(0, 10).map((x, k) => ({ rank: k + 1, name: x.name, time: x.time, assists: x.assistText, you: x.player === player })),
    near: i < 10 ? [] : list.slice(Math.max(10, i - 2), i + 3).map((x, k) => ({ rank: Math.max(10, i - 2) + k + 1, name: x.name, time: x.time, you: x.player === player })),
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
  if (p === '/privacy' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PRIVACY_CSP, 'Cache-Control': 'public, max-age=3600', 'Content-Length': PRIVACY.length });
    return res.end(req.method === 'HEAD' ? undefined : PRIVACY);
  }
  if (!p.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }

  if (p === '/api/live' && req.method === 'GET') { if ((wait = limited('live', ip))) return tooMany(res, wait); return openLive(req, res, ip); }

  const c = Race.challenge();
  if (p === '/api/daily' && req.method === 'GET') {
    if ((wait = limited('daily', ip))) return tooMany(res, wait);
    const who = player(req, res);
    return json(res, { challenge: c, attempt: who && current(who, c), leaderboard: board(who, c), auth: { required: AUTH, clientId: GOOGLE_CLIENT_ID || null, signedIn: !AUTH || !!who } });
  }
  if (p === '/api/auth/google' && req.method === 'POST') {
    if (!AUTH) return json(res, { error: 'Sign-in is not enabled' }, 404);
    if (!sameOrigin(req)) return json(res, { error: 'Forbidden' }, 403);
    if ((wait = limited('auth', ip))) return tooMany(res, wait);
    const b = await body(req), sub = await verifyGoogle(b.credential), t = token();
    db.prepare('INSERT INTO sessions(token,sub,created) VALUES(?,?,?)').run(t, sub, Date.now());
    track(req, res, 'sign_in', {}, sub);
    return json(res, { signedIn: true }, 200, { 'Set-Cookie': 'hz_session=' + t + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + 90 * 86400 + (SECURE ? '; Secure' : '') });
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, { error: 'Forbidden' }, 403);
    const t = (req.headers.cookie || '').match(/(?:^|;\s*)hz_session=([a-f0-9]{48})(?:;|$)/)?.[1];
    if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
    return json(res, { signedIn: false }, 200, { 'Set-Cookie': 'hz_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (SECURE ? '; Secure' : '') });
  }
  if (p === '/api/event' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, { error: 'Forbidden' }, 403);
    if ((wait = limited('event', ip))) return tooMany(res, wait);
    const b = await body(req), type = String(b.type || '');
    if (!EVENTS[type]) return json(res, { error: 'Unknown event' }, 400);
    track(req, res, type, cleanProps(type, b.props));
    return json(res, { ok: true });
  }
  // A shared result (challenge link): public leaderboard facts only, never the replay.
  if (p === '/api/result' && req.method === 'GET') {
    if ((wait = limited('ghost', ip))) return tooMany(res, wait);
    const id = String(url.searchParams.get('id') || '');
    if (!/^[A-Za-z0-9_-]{8}$/.test(id)) return json(res, { error: 'Unknown challenge' }, 404);
    const row = db.prepare("SELECT day,name,time,splits,player FROM attempts WHERE share=? AND status='finished'").get(id);
    if (!row) return json(res, { error: 'Unknown challenge' }, 404);
    track(req, res, 'challenge_open', { today: row.day === c.day });
    const list = finishedList(row.day), rank = list.findIndex(x => x.player === row.player) + 1, ch = Race.challenge(row.day);
    return json(res, { id, day: row.day, name: row.name, time: row.time, splits: parse(row.splits), rank, total: list.length, sector: ch.number, sectorName: ch.name, today: row.day === c.day });
  }
  // Another driver's validated replay, to race as a ghost. Only after you have used today's ranked attempt,
  // so nobody can copy the leader's line before their own ranked run.
  if (p === '/api/ghost' && req.method === 'GET') {
    if ((wait = limited('ghost', ip))) return tooMany(res, wait);
    const who = player(req, res), mine = who && current(who, c);
    if (!mine || mine.status === 'running') return json(res, { error: 'Finish your ranked run to race other ghosts.' }, 403);
    const list = finishedList(c.day), me = list.findIndex(x => x.player === who), which = url.searchParams.get('which');
    const i = which === 'leader' ? 0 : which === 'ahead' ? (me > 0 ? me - 1 : me < 0 ? list.length - 1 : -1) : -1;
    if (i < 0 || !list[i]) return json(res, { error: which === 'ahead' ? 'Nobody ahead of you. You are P1.' : 'No ghost available yet.' }, 404);
    const row = db.prepare("SELECT name,time,assists,inputs FROM attempts WHERE day=? AND player=? AND status='finished'").get(c.day, list[i].player);
    if (!row || !row.inputs) return json(res, { error: 'No ghost available yet.' }, 404);
    return json(res, { name: row.name, time: row.time, rank: i + 1, assists: parse(row.assists) || {}, inputs: parse(row.inputs) });
  }
  if (req.method === 'POST' && (p === '/api/start' || p === '/api/finish')) {
    if (!sameOrigin(req)) return json(res, { error: 'Forbidden' }, 403);
    const who = player(req, res);
    if (!who) return json(res, { error: 'Sign in to race the ranked daily.' }, 401);
    if (p === '/api/start') {
      if ((wait = limited('start', ip) || limited('startDay', ip))) return tooMany(res, wait);
      const b = await body(req);
      if (b.day !== c.day) return json(res, { error: 'Challenge has changed. Reload.' }, 409);
      const named = Names.check(b.name);
      if (!named.ok) return json(res, { error: named.error }, 400);
      const assists = cleanAssists(b.assists), t = token();
      try { db.prepare("INSERT INTO attempts(day,player,token,started,status,name,assists) VALUES(?,?,?,?,'running',?,?)").run(c.day, who, t, Date.now(), named.name, JSON.stringify(assists)); }
      catch { return json(res, { error: 'Your ranked attempt has already been used.' }, 409); }
      track(req, res, 'ranked_start', {}, who.replace(/^g:/, ''));
      return json(res, { token: t, challenge: ranked(c.day, assists) });
    }
    if ((wait = limited('finish', ip))) return tooMany(res, wait);
    const b = await body(req), a = db.prepare('SELECT * FROM attempts WHERE token=? AND player=?').get(String(b.token || '').slice(0, 64), who);
    if (!a) return json(res, { error: 'Attempt unavailable' }, 409);
    if (a.status !== 'running') { const config = Race.challenge(a.day); return json(res, { attempt: current(who, config), leaderboard: board(who, config) }); }
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
    db.prepare("UPDATE attempts SET status=?,time=?,reason=?,splits=?,inputs=?,share=? WHERE token=? AND status='running'").run(valid ? 'finished' : 'dnf', valid ? result.time : null, valid ? '' : result.reason || 'Abandoned', valid ? JSON.stringify(rec.out) : null, valid ? JSON.stringify(b.inputs) : null, valid ? crypto.randomBytes(6).toString('base64url') : null, a.token);
    if (valid) broadcast(a.day);
    { const l = finishedList(a.day), r = l.findIndex(x => x.player === who) + 1; track(req, res, valid ? 'ranked_finish' : 'ranked_dnf', valid ? { time: result.time, rank: r, field: l.length } : {}, who.replace(/^g:/, '')); }
    return json(res, { attempt: current(who, config), leaderboard: board(who, config) });
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
if (require.main !== module) module.exports = { verifyGoogle, Names };
else server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Hyzoom running on port ' + (process.env.PORT || 3000)));
