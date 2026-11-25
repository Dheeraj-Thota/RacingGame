'use strict';
// Hyzoom usage report from the server's own database (first-party analytics + ranked results).
// On the server:   sudo -u hyzoom node /opt/hyzoom/tools/stats.js            (report)
//                  sudo -u hyzoom node /opt/hyzoom/tools/stats.js --csv      (daily numbers for a spreadsheet)
//                  sudo -u hyzoom node /opt/hyzoom/tools/stats.js --days 30  (longer daily table)
// Reads DB_PATH, or /var/lib/hyzoom/hyzoom.sqlite (where the deploy script keeps it).
process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');
const path = process.env.DB_PATH || '/var/lib/hyzoom/hyzoom.sqlite';
const args = process.argv.slice(2), CSV = args.includes('--csv'), DAYS = Number(args[args.indexOf('--days') + 1]) || 14;
const db = new DatabaseSync(path, { readOnly: true });

const dayOf = offset => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const today = dayOf(0), since = n => dayOf(n - 1);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const hasEvents = !!one("SELECT name FROM sqlite_master WHERE type='table' AND name='events'");
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const pad = (s, n) => String(s).padStart(n), padE = (s, n) => String(s).padEnd(n);

// First day each visitor was seen (for new vs returning and retention).
const firstSeen = hasEvents ? new Map(all('SELECT visitor, MIN(day) d FROM events WHERE visitor IS NOT NULL GROUP BY visitor').map(r => [r.visitor, r.d])) : new Map();

function dayRow(d) {
  const ev = type => hasEvents ? one('SELECT COUNT(*) n FROM events WHERE day=? AND type=?', d, type).n : 0;
  const visitors = hasEvents ? one('SELECT COUNT(DISTINCT visitor) n FROM events WHERE day=? AND visitor IS NOT NULL', d).n : 0;
  const anonVisits = hasEvents ? one("SELECT COUNT(*) n FROM events WHERE day=? AND type='visit' AND visitor IS NULL", d).n : 0;
  let fresh = 0; for (const [, first] of firstSeen) if (first === d) fresh++;
  const playSecs = hasEvents ? all("SELECT props FROM events WHERE day=? AND type='run_end'", d).reduce((s, r) => s + (JSON.parse(r.props || '{}').secs || 0), 0) : 0;
  return {
    day: d, visitors, newVisitors: fresh, anonVisits,
    practiceRuns: ev('practice_start'),
    rankedStarts: one('SELECT COUNT(*) n FROM attempts WHERE day=?', d).n,
    rankedFinishes: one("SELECT COUNT(*) n FROM attempts WHERE day=? AND status='finished'", d).n,
    signIns: ev('sign_in'), shares: ev('share'), challengeOpens: ev('challenge_open'),
    playMinutes: Math.round(playSecs / 60),
  };
}

const rows = []; for (let i = DAYS - 1; i >= 0; i--) rows.push(dayRow(dayOf(i)));
if (CSV) {
  const keys = Object.keys(rows[0]);
  console.log(keys.join(','));
  for (const r of rows) console.log(keys.map(k => r[k]).join(','));
  process.exit(0);
}

const uniq = (from, to = today) => hasEvents ? one('SELECT COUNT(DISTINCT visitor) n FROM events WHERE day BETWEEN ? AND ? AND visitor IS NOT NULL', from, to).n : 0;
const accounts = (from, to = today) => one("SELECT COUNT(DISTINCT player) n FROM attempts WHERE day BETWEEN ? AND ?", from, to).n;
const evCount = (type, from) => hasEvents ? one('SELECT COUNT(*) n FROM events WHERE type=? AND day >= ?', type, from).n : 0;
const line = '-'.repeat(78);

console.log(`HYZOOM STATS · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${path}`);
if (!hasEvents) console.log('(no analytics table yet: only ranked results are available until the updated server has run)');
console.log(line);
console.log(padE('', 26) + pad('TODAY', 10) + pad('7 DAYS', 10) + pad('30 DAYS', 10) + pad('ALL TIME', 11));
const block = (label, f) => console.log(padE(label, 26) + pad(f(today), 10) + pad(f(since(7)), 10) + pad(f(since(30)), 10) + pad(f('0000-00-00'), 11));
block('unique visitors', d => uniq(d));
block('ranked players', d => accounts(d));
block('practice runs started', d => evCount('practice_start', d));
block('ranked runs finished', d => one("SELECT COUNT(*) n FROM attempts WHERE status='finished' AND day >= ?", d).n);
block('Google sign-ins', d => evCount('sign_in', d));
block('results shared', d => evCount('share', d));
block('challenge links opened', d => evCount('challenge_open', d));
const dau = rows.slice(-7).reduce((s, r) => s + r.visitors, 0) / 7, mau = uniq(since(30));
console.log(`\nAverage daily visitors (7 days): ${dau.toFixed(1)} · weekly visitors: ${uniq(since(7))} · monthly visitors: ${mau} · daily/monthly: ${pct(dau, mau)}`);

console.log('\n' + line + '\nDAILY');
console.log(['DAY       ', ' VISITORS', '   NEW', ' PRACTICE', ' RANKED', ' SIGN-INS', ' SHARES', ' CHALL.OPEN', ' PLAY MIN'].join(''));
for (const r of rows) console.log([padE(r.day, 10), pad(r.visitors + (r.anonVisits ? '+' + r.anonVisits : ''), 9), pad(r.newVisitors, 6), pad(r.practiceRuns, 9), pad(r.rankedFinishes, 7), pad(r.signIns, 9), pad(r.shares, 7), pad(r.challengeOpens, 11), pad(r.playMinutes, 9)].join(''));
console.log('(+N = visits from browsers with Do Not Track / Global Privacy Control, counted without an ID)');

if (hasEvents) {
  // Funnel: of the people who visited in the last 7 days, how many went on to each step.
  const from = since(7), visitors = new Set(all("SELECT DISTINCT visitor v FROM events WHERE day >= ? AND type='visit' AND visitor IS NOT NULL", from).map(r => r.v));
  const did = type => new Set(all('SELECT DISTINCT visitor v FROM events WHERE day >= ? AND type=? AND visitor IS NOT NULL', from, type).map(r => r.v));
  const finishedRun = new Set(all("SELECT DISTINCT visitor v, props FROM events WHERE day >= ? AND type='run_end' AND visitor IS NOT NULL", from).filter(r => JSON.parse(r.props || '{}').finished).map(r => r.v));
  const steps = [['visited', visitors], ['started a practice run', did('practice_start')], ['finished a run', finishedRun], ['signed in', did('sign_in')], ['finished a ranked run', did('ranked_finish')], ['shared a result', did('share')]];
  console.log('\n' + line + '\nFUNNEL (visitors in the last 7 days)');
  for (const [label, set] of steps) { const n = [...set].filter(v => visitors.has(v)).length; console.log(padE('  ' + label, 30) + pad(n, 7) + pad(pct(n, visitors.size), 9)); }

  // Retention: visitors grouped by their first day; did they come back the next day, or within a week?
  console.log('\n' + line + '\nRETENTION (by first visit, last 30 days)');
  const activeDays = new Map(); for (const r of all('SELECT DISTINCT visitor v, day d FROM events WHERE visitor IS NOT NULL')) { if (!activeDays.has(r.v)) activeDays.set(r.v, new Set()); activeDays.get(r.v).add(r.d); }
  let c = 0, d1 = 0, d7 = 0, c7 = 0;
  for (const [v, first] of firstSeen) {
    if (first < since(30) || first >= today) continue; c++; const days = activeDays.get(v) || new Set();
    if (days.has(addDays(first, 1))) d1++;
    if (first <= dayOf(7)) { c7++; for (let k = 1; k <= 7; k++) if (days.has(addDays(first, k))) { d7++; break; } }
  }
  console.log(`  came back the next day: ${pct(d1, c)} of ${c} · came back within 7 days: ${pct(d7, c7)} of ${c7}`);

  const props = (type, from) => all('SELECT props FROM events WHERE type=? AND day >= ?', type, from).map(r => JSON.parse(r.props || '{}'));
  const tally = (list, key) => { const m = new Map(); for (const p of list) { const k = p[key] === undefined || p[key] === '' ? '(none)' : String(p[key]); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
  const show = (title, entries, total) => { console.log('\n' + line + '\n' + title); for (const [k, n] of entries.slice(0, 10)) console.log('  ' + padE(k, 30) + pad(n, 7) + pad(pct(n, total), 9)); };
  const visits = props('visit', since(30));
  show('WHERE VISITS CAME FROM (30 days; "(none)" = typed in or bookmarked)', tally(visits.map(p => ({ src: p.vs ? 'challenge link' : p.utm || p.ref || '(none)' })), 'src'), visits.length);
  show('DEVICES (30 days)', tally(visits, 'device'), visits.length);
  const starts = props('practice_start', since(30));
  show('PRACTICE RUNS BY CAR (30 days)', tally(starts, 'car'), starts.length);
  const shares = props('share', since(30));
  show('SHARES (30 days)', tally(shares, 'mode'), shares.length);
}
