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
assert.equal(road.corner(R.sectors[4].start + 1600), 'Caracciola-Karussell');
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
const straight = R.circuit({ step: 6, points: Array.from({ length: 6000 }, (_, i) => [0, 0, i * 6]) }), flat = r => ({ start: 600, length: 30000, rolling: r, maxTicks: 1e7 });
{ const c = flat(.5), a = R.initial(c); let t100 = 0; while (a.ticks < 120 * 70) { R.step(a, 1, c, straight); if (!t100 && a.vx >= 100 / 3.6) t100 = a.ticks / 120; }
  assert(t100 > 3 && t100 < 4.2, '0-100 ' + t100); assert(a.maxSpeed * 3.6 > 285 && a.maxSpeed * 3.6 < 305, 'vmax ' + a.maxSpeed * 3.6);
  ok(`0-100 km/h ${t100.toFixed(2)} s (published 3.2), top speed ${(a.maxSpeed * 3.6).toFixed(0)} km/h (published 296)`); }
{ const c = flat(100 / 3.6), a = R.initial(c), s0 = a.s; while (a.vx > .2) R.step(a, 2, c, straight); const dist = a.s - s0;
  assert(dist > 24 && dist < 36, '100-0 ' + dist); ok(`100-0 km/h in ${dist.toFixed(1)} m with ABS`); }

// Every daily sector: reference driver finishes cleanly; the server replay reproduces the exact time
for (let i = 0; i < R.sectors.length; i++) {
  const c = [...Array(7)].map((_, k) => R.challenge('2026-12-0' + (k + 1))).find(x => x.number === i + 1);
  const { state, inputs } = drive(c, road);
  assert(state.done && !state.invalid, c.name + ': ' + state.reason);
  assert.equal(state.collisions, 0, c.name + ' barrier contacts');
  assert.equal(R.replay(c, road, inputs).time, state.time);
  ok(`sector ${c.number} ${c.name}: ${state.time.toFixed(3)} s, clean, peak ${(state.maxSpeed * 3.6).toFixed(0)} km/h, replay identical`);
}

// Keyboard (digital) inputs replay identically too
{ const c = R.challenge('2026-11-26'), { state, inputs } = drive(c, road, { digital: true });
  assert(state.done && !state.invalid); assert.equal(R.replay(c, road, inputs).time, state.time); assert(inputs.every(x => x[0] < 16));
  ok(`keyboard-input run ${state.time.toFixed(3)} s, replay identical`); }

// Full lap (practice mode)
{ const c = R.fullLap(), { state } = drive(c, road); assert(state.done && !state.invalid, 'lap ' + state.reason);
  ok(`full lap by cautious reference driver ${lap(state.time)} (real car 6:49.328; theoretical for this model ~6:47 on a basic racing line)`); }

// Input validation
assert.throws(() => R.replay(R.challenge(), road, [[-1, 1]])); assert.throws(() => R.replay(R.challenge(), road, [[16 + 255 * 256, 1]]));
assert.throws(() => R.replay(R.challenge(), road, [[1, 0]])); assert.throws(() => R.replay(R.challenge(), road, [[1.5, 3]]));
assert.throws(() => R.replay(R.challenge(), road, [[1, R.challenge().maxTicks + 1]]));
ok('invalid replays rejected');
{ const d = R.decode(R.encodeAnalog(-.5, 1, .2)); assert(Math.abs(d.steer + .5) < .01 && d.gas === 1 && Math.abs(d.brake - .2) < .04); ok('analogue input encoding round-trips'); }

// Steering filter: right, left, return to centre
{ const c = R.challenge('2026-11-24'), a = R.initial(c);
  for (let i = 0; i < 70; i++) R.step(a, 8, c, road); assert(a.steer > .8, 'right ' + a.steer);
  for (let i = 0; i < 140; i++) R.step(a, 4, c, road); assert(a.steer < -.8, 'left ' + a.steer);
  for (let i = 0; i < 120; i++) R.step(a, 0, c, road); assert(Math.abs(a.steer) < .01);
  ok('steering left / right / return to centre'); }

// Barrier: drive into the guardrail; contact is counted, penalised and the car stays on the circuit side
{ const c = R.challenge('2026-11-24'), a = R.initial(c); let minD = 0;
  for (let i = 0; i < 120 * 6 && !a.done; i++) { R.step(a, a.ticks < 90 ? 1 | 4 : 1, c, road); minD = Math.min(minD, a.d); }
  assert(a.collisions >= 1 && a.penalty >= 1.5, 'contact ' + a.collisions); assert(minD > -R.WALL - .1, 'no tunnelling ' + minD);
  ok(`barrier contact detected (${a.collisions}), +${a.penalty.toFixed(1)} s, no tunnelling`); }

// Reverse: stop, hold brake, the car backs up; throttle at standstill returns to forward drive
{ const c = R.challenge('2026-11-24'), a = R.initial(c);
  for (let i = 0; i < 120 * 3; i++) R.step(a, 2, c, road); assert(a.reverse && a.vx < -.3, 'reverse ' + a.vx);
  for (let i = 0; i < 240 && !a.done; i++) R.step(a, 1, c, road); assert(!a.reverse && a.vx > 1);
  ok('reverse gear engages from standstill and releases'); }
console.log('All tests passed');
