'use strict';
// Car calibration against published 992 GT3 RS figures, on synthetic flat roads. node tools/calibrate.js
const R = require('../physics.js'), CAR = process.argv[2] || R.MAIN_CAR, K = R.spec(CAR);
require('./driver.js').setCar(CAR);
const straight = R.circuit({ step: 6, points: Array.from({ length: 6000 }, (_, i) => [0, 0, i * 6]) });
const ring = rad => { const n = Math.round(2 * Math.PI * rad / 3); return R.circuit({ step: 2 * Math.PI * rad / n, points: Array.from({ length: n }, (_, i) => { const t = i / n * 2 * Math.PI; return [rad - rad * Math.cos(t), 0, rad * Math.sin(t)]; }) }); };
const cfg = (rolling, length = 20000) => ({ start: 600, length, rolling, maxTicks: 120 * 400, car: CAR });
function accel() {
  const c = cfg(.5), a = R.initial(c); let t100 = 0, t160 = 0, t200 = 0;
  while (!a.done && a.ticks < 120 * 60) { R.step(a, 1, c, straight); const kmh = a.vx * 3.6, t = a.ticks / 120; if (!t100 && kmh >= 100) t100 = t; if (!t160 && kmh >= 160) t160 = t; if (!t200 && kmh >= 200) { t200 = t; } }
  return { t100, t160, t200, vmax: a.maxSpeed * 3.6 };
}
function brake(from) { const c = cfg(from / 3.6), a = R.initial(c), s0 = a.s; while (a.vx > .3 && a.ticks < 120 * 20) R.step(a, 2, c, straight); return a.s - s0; }
function skidpad(rad) {
  const { steerDelta, codeFor } = require('./driver.js');
  const road = ring(rad), c = { start: 0, length: 1e9, rolling: 8, maxTicks: 1e9, car: CAR }, a = R.initial(c); let best = 0;
  for (let v = 8; v < 85; v += .2) {
    let ok = true; for (let k = 0; k < 240; k++) { R.step(a, codeFor(a, steerDelta(a, road), a.vx < v ? .5 : 0, 0, false), c, road); if (Math.abs(a.d) > 3) ok = false; }
    if (!ok) break; best = a.vx * a.vx / rad;
  }
  return best / 9.81;
}
const r = accel();
console.log(K.display);console.log(`0-100 ${r.t100.toFixed(2)} s (published 3.2) | 0-160 ${r.t160.toFixed(2)} s (6.9) | 0-200 ${r.t200.toFixed(2)} s (10.6) | vmax ${r.vmax.toFixed(0)} km/h (296)`);
console.log(`100-0 ${brake(100).toFixed(1)} m | 200-0 ${brake(200).toFixed(1)} m`);
console.log(`steady lateral: R40 ${skidpad(40).toFixed(2)} g, R120 ${skidpad(120).toFixed(2)} g, R400 ${skidpad(400).toFixed(2)} g`);
