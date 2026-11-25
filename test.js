'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const R = require('./physics.js'), track = require('./track.json'), road = R.circuit(track), { drive } = require('./tools/driver.js');
const ok = m => console.log('ok  ' + m), lap = t => Math.floor(t / 60) + ':' + (t % 60).toFixed(3).padStart(6, '0');

// Track data
assert.equal(R.L, track.length, 'physics L must equal track.json length');
assert(Math.abs(road.length - track.length) < 1e-6);
assert(Math.abs(track.length - 20832) < 40, 'Nordschleife length ~20.832 km');
let turning = 0; for (const p of road.points) turning += p.k * road.step;
assert(Math.abs(turning - 2 * Math.PI) < .05, 'closed clockwise loop');
const hs = road.points.map(p => p.y); assert(Math.max(...hs) - Math.min(...hs) > 250, 'real elevation range');
assert(road.points.every((p, i, a) => Math.abs(a[(i + 1) % a.length].y - p.y) / road.step <= .19), 'grades within 19%');
assert.equal(road.corner(12000), 'Caracciola-Karussell');
ok(`track ${track.length} m, ${road.points.length} points, ${track.corners.length} named corners, ${(Math.max(...hs) - Math.min(...hs)).toFixed(0)} m elevation range`);

// Embedded client copies must be current
const html = fs.readFileSync('./index.html', 'utf8'), physics = fs.readFileSync('./physics.js', 'utf8');
assert(html.includes(physics.trim()), 'index.html physics copy is stale: run node tools/build.js');
assert(html.includes('const TRACK=' + JSON.stringify(track) + ';'), 'index.html track copy is stale: run node tools/build.js');
ok('index.html embeds current physics.js and track.json');

// Deterministic trigonometry
let err = 0; for (let x = -40; x < 40; x += .0173) err = Math.max(err, Math.abs(R.math.sin(x) - Math.sin(x)), Math.abs(R.math.cos(x) - Math.cos(x)), Math.abs(R.math.atan(x) - Math.atan(x)), Math.abs(R.math.atan2(x, 1 - x * .3) - Math.atan2(x, 1 - x * .3)));
assert(err < 1e-9); ok('polynomial trig within ' + err.toExponential(1));

// Car calibration against published figures (synthetic flat roads)
const straight = R.circuit({ step: 6, points: Array.from({ length: 6000 }, (_, i) => [0, 0, i * 6]) }), flat = (r, car = 'kestrel') => ({ start: 600, length: 30000, rolling: r, maxTicks: 1e7, car });
{ const c = flat(.5), a = R.initial(c); let t100 = 0; while (a.ticks < 120 * 70) { R.step(a, 1, c, straight); if (!t100 && a.vx >= 100 / 3.6) t100 = a.ticks / 120; }
  assert(t100 > 3 && t100 < 4.2, '0-100 ' + t100); assert(a.maxSpeed * 3.6 > 285 && a.maxSpeed * 3.6 < 305, 'vmax ' + a.maxSpeed * 3.6);
  ok(`Kestrel RS 0-100 km/h ${t100.toFixed(2)} s (published GT3 RS 3.2), top speed ${(a.maxSpeed * 3.6).toFixed(0)} km/h (296)`); }
{ const c = flat(.5, 'f1'), a = R.initial(c); let t100 = 0, t200 = 0; while (a.ticks < 120 * 60) { R.step(a, 1, c, straight); if (!t100 && a.vx >= 100 / 3.6) t100 = a.ticks / 120; if (!t200 && a.vx >= 200 / 3.6) t200 = a.ticks / 120; }
  assert(t100 > 2.2 && t100 < 3.4, 'F1 0-100 ' + t100); assert(t200 > 4 && t200 < 6.5, 'F1 0-200 ' + t200); assert(a.maxSpeed * 3.6 > 310 && a.maxSpeed * 3.6 < 350, 'F1 vmax ' + a.maxSpeed * 3.6);
  const b = R.initial(flat(200 / 3.6, 'f1')), s0 = b.s; while (b.vx > .2) R.step(b, 2, flat(200 / 3.6, 'f1'), straight); assert(b.s - s0 > 45 && b.s - s0 < 85, 'F1 200-0 ' + (b.s - s0));
  ok(`Formula '86 0-100 ${t100.toFixed(2)} s, 0-200 ${t200.toFixed(2)} s, top speed ${(a.maxSpeed * 3.6).toFixed(0)} km/h, 200-0 in ${(b.s - s0).toFixed(0)} m (estimated period figures)`); }
{ const c = flat(100 / 3.6), a = R.initial(c), s0 = a.s; while (a.vx > .2) R.step(a, 2, c, straight); const dist = a.s - s0;
  assert(dist > 24 && dist < 36, '100-0 ' + dist); ok(`Kestrel RS 100-0 km/h in ${dist.toFixed(1)} m with ABS`); }

// Brakes: ABS keeps every wheel turning, straight-line stop stays straight, repeated stops heat the discs
{ const c = flat(250 / 3.6), a = R.initial(c); let locked = false;
  while (a.vx > .3) { R.step(a, 2, c, straight); if (a.vx > 8 && a.w.some((w, i) => w * (i < 2 ? R.spec('kestrel').tyreF.radius : R.spec('kestrel').tyreR.radius) < a.vx * .6)) locked = true; }
  assert(!locked, 'ABS let a wheel lock'); assert(Math.abs(a.heading) < 1e-3 && Math.abs(a.d) < .05, 'straight-line stop drifted');
  const b = R.initial(c), dists = [];
  for (let n = 0; n < 6; n++) { while (b.vx < 250 / 3.6) R.step(b, 1, c, straight); const s0 = b.s; while (b.vx > 80 / 3.6) R.step(b, 2, c, straight); dists.push(b.s - s0); }
  assert(b.bt[0] > R.spec('kestrel').brakeTemp0 + 100, 'discs heat up'); assert(Math.max(...dists) - Math.min(...dists) < 6, 'consistent stops without fade at road-car temps');
  ok(`ABS no lock-up, straight stop; 6 x 250-80 km/h stops ${dists.map(d => d.toFixed(0)).join('/')} m, front disc ${b.bt[0].toFixed(0)} C`); }

// Every daily sector: reference driver finishes cleanly; the server replay reproduces the exact time
for (let i = 0; i < R.sectors.length; i++) {
  const c = [...Array(7)].map((_, k) => R.challenge('2026-12-0' + (k + 1))).find(x => x.number === i + 1);
  const { state, inputs } = drive(c, road);
  assert(state.done && !state.invalid, c.name + ': ' + state.reason);
  assert.equal(state.collisions, 0, c.name + ' barrier contacts');
  assert.equal(R.replay(c, road, inputs).time, state.time);
  assert.equal(c.car, R.MAIN_CAR);
  ok(`sector ${c.number} ${c.name} (${c.carName}): ${state.time.toFixed(3)} s, clean, peak ${(state.maxSpeed * 3.6).toFixed(0)} km/h, replay identical`);
}
// The secondary car in practice: different id, clean run, its own physics in the replay
{ const c = R.withCar(R.challenge('2026-11-26'), 'kestrel'), { state, inputs } = drive(c, road);
  assert(c.id.endsWith('~kestrel') && state.done && !state.invalid && state.collisions === 0); assert.equal(R.replay(c, road, inputs).time, state.time);
  assert.notEqual(R.replay(R.challenge('2026-11-26'), road, inputs.slice(0, 50)).ticks, undefined);
  assert.throws(() => R.replay({ ...c, car: 'nope' }, road, inputs));
  ok(`Kestrel RS practice run ${state.time.toFixed(3)} s, replay identical; unknown car rejected`); }

// Keyboard (digital) inputs replay identically too
{ const c = R.challenge('2026-11-26'), { state, inputs } = drive(c, road, { digital: true });
  assert(state.done && !state.invalid); assert.equal(R.replay(c, road, inputs).time, state.time); assert(inputs.every(x => x[0] < 16));
  ok(`keyboard-input run ${state.time.toFixed(3)} s, replay identical`); }

// Full lap (practice mode)
{ const c = R.fullLap(), { state } = drive(c, road); assert(state.done && !state.invalid, 'lap ' + state.reason);
  ok(`full lap, Formula '86, cautious reference driver: ${lap(state.time)}`); }
{ const c = R.fullLap('kestrel'), { state } = drive(c, road); assert(state.done && !state.invalid);
  ok(`full lap, Kestrel RS, cautious reference driver: ${lap(state.time)} (real 992 GT3 RS 6:49.328)`); }

// Assists off, manual gearbox: deterministic, shifts only on request, server-style config round trip
{ const base = R.challenge('2026-11-26'), c = R.withCar(base, 'f1', { abs: false, tc: false, stab: false, counter: false, steer: true, auto: false });
  assert.equal(c.assistText, 'STEER'); const a = R.initial(c), inputs = []; let shifts = 0;
  for (let i = 0; i < 120 * 6 && !a.done; i++) { const want = a.rpm > 11500 ? 1 : 0, code = R.withShift(1, want); if (want) shifts++; const g0 = a.gear; R.step(a, code, c, road); inputs.push([code, 1]); }
  assert(a.gear > 2, 'manual upshifts happened ' + a.gear);
  const b = R.replay(c, road, inputs); assert.equal(b.s, a.s); assert.equal(b.gear, a.gear);
  const auto = R.initial(R.withCar(base, 'f1')); for (let i = 0; i < 120; i++) R.step(auto, R.withShift(1, -1), R.withCar(base, 'f1'), road); assert(auto.gear >= 2, 'auto gearbox ignores manual requests');
  assert.throws(() => R.replay({ ...c, assists: { ...c.assists, turbo: true } }, road, []));
  const off = R.withCar(base, 'f1', { abs: false, tc: false }), on = R.withCar(base, 'f1');
  const x = R.initial(off), y = R.initial(on); let px = 0, py = 0; for (let i = 0; i < 240; i++) { R.step(x, 1, off, road); R.step(y, 1, on, road); px = Math.max(px, x.slip[2], x.slip[3]); py = Math.max(py, y.slip[2], y.slip[3]); }
  assert(px >= py - 1e-9, 'TC off allows at least as much peak rear slip');
  ok(`assists off + manual gearbox: replay identical (gear ${a.gear}), auto ignores shift requests, bad assists rejected`); }

// Burnout holds the car while the rears spin; handbrake is part of the replay
{ const c = R.withCar({ ...flat(0, 'f1'), id: 't' }, 'f1'), a = R.initial(c), s0 = a.s; for (let i = 0; i < 120 * 3; i++) R.step(a, 3, c, straight);
  assert(a.s - s0 < 1.5, 'burnout creeps ' + (a.s - s0)); const ins = []; const b = R.initial(c); for (let i = 0; i < 300; i++) { const code = i % 50 < 10 ? R.withHandbrake(1) : 1; R.step(b, code, c, straight); ins.push([code, 1]); }
  assert.equal(R.replay(c, straight, ins).s, b.s); ok(`burnout holds the car (${(a.s - s0).toFixed(2)} m in 3 s); handbrake replays identically`); }

// Input validation
assert.throws(() => R.replay(R.challenge(), road, [[-1, 1]])); assert.throws(() => R.replay(R.challenge(), road, [[4 * 65536, 1]]));
assert.throws(() => R.replay(R.challenge(), road, [[1, 0]])); assert.throws(() => R.replay(R.challenge(), road, [[1.5, 3]]));
assert.throws(() => R.replay(R.challenge(), road, [[1, R.challenge().maxTicks + 1]]));
ok('invalid replays rejected');
{ const d = R.decode(R.encodeAnalog(-.5, 1, .2)); assert(Math.abs(d.steer + .5) < .01 && d.gas === 1 && Math.abs(d.brake - .2) < .04); ok('analogue input encoding round-trips'); }

// Steering filter: right, left, return to centre
{ const c = R.challenge('2026-11-24'), a = R.initial(c);
  for (let i = 0; i < 110; i++) R.step(a, 8, c, road); assert(a.steer > .8, 'right ' + a.steer);
  for (let i = 0; i < 200; i++) R.step(a, 4, c, road); assert(a.steer < -.8, 'left ' + a.steer);
  for (let i = 0; i < 120; i++) R.step(a, 0, c, road); assert(Math.abs(a.steer) < .01);
  ok('steering left / right / return to centre'); }

// Barrier: drive into the guardrail; contact is counted, penalised and the car stays on the circuit side
{ const c = R.challenge('2026-11-24'), a = R.initial(c); let minD = 0;
  for (let i = 0; i < 120 * 6 && !a.done; i++) { R.step(a, a.ticks < 90 ? 1 | 4 : 1, c, road); minD = Math.min(minD, a.d); }
  assert(a.collisions >= 1 && a.penalty >= 1.5, 'contact ' + a.collisions); assert(minD > -R.WALL - .1, 'no tunnelling ' + minD);
  ok(`barrier contact detected (${a.collisions}), +${a.penalty.toFixed(1)} s, no tunnelling`); }

// Reverse: stop, hold brake, the car backs up; throttle at standstill returns to forward drive
{ const c = R.challenge('2026-11-24'), a = R.initial(c);
  for (let i = 0; i < 120 * 4; i++) R.step(a, 2, c, road); assert(a.reverse && a.vx < -.3, 'reverse ' + a.vx);
  for (let i = 0; i < 240 && !a.done; i++) R.step(a, 1, c, road); assert(!a.reverse && a.vx > 1);
  ok('reverse gear engages from standstill and releases'); }
console.log('All tests passed');
