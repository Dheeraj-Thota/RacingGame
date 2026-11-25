'use strict';
// Reference test driver for regression tests and calibration. It sees only the track and the car state
// and produces the same input codes a player does, so every run is replay-verifiable.
const R = require('../physics.js'), { atan } = R.math;
let K = R.spec(R.MAIN_CAR); // car the driver is set up for
const setCar = c => (K = R.spec(c && c.car || c));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ang = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

// Grip- and power-limited speed profile along the centreline (forward/backward passes).
function profile(road, c, mu = 1.22) {
  setCar(c); mu *= K.mu / 1.46; const gs = K.mu / 1.46;
  const ds = 2, n = Math.ceil(c.length / ds) + 200, v = new Float64Array(n), m = K.mass, kz = K.downforce;
  for (let i = 0; i < n; i++) {
    let k = 0; for (let j = -6; j <= 6; j++) k = Math.max(k, Math.abs(road.at(c.start + i * ds + j * 3).k));
    let kv = 0; for (let j = -6; j <= 6; j++) kv = Math.min(kv, road.at(c.start + i * ds + j * 4).kv);
    const den = k - mu * kz / m - mu * kv * 1.3; v[i] = den > 1e-5 ? Math.min(92, Math.sqrt(mu * 9.81 / den)) : 92;
  }
  for (let i = n - 2; i >= 0; i--) { const brake = 11 * gs + mu * kz * v[i + 1] * v[i + 1] / m * .8; v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * brake * ds)); }
  return s => v[clamp(Math.round((s - c.start) / ds), 0, n - 1)];
}

// Steering for a target lateral offset (metres, + = right) using pure pursuit on the track.
function steerDelta(a, road, offset = () => 0) {
  const p = road.at(a.s), u = Math.max(a.vx, 3), Ld = clamp(u * .75, 9, 70), q = road.at(a.s + Ld), dt = offset(a.s + Ld);
  const cx = p.x + p.rx * a.d, cz = p.z + p.rz * a.d, tx = q.x + q.rx * dt - cx, tz = q.z + q.rz * dt - cz, yaw = p.yaw + a.heading;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), xf = tx * sy + tz * cy, yr = tx * cy - tz * sy, alpha = Math.atan2(yr, xf);
  return Math.atan(2 * K.wheelbase * Math.sin(alpha) / Math.hypot(xf, yr)) * (1 + u * u / 2600) - .06 * (a.yawRate - u * p.k);
}
const steerLimit = (u, k) => clamp(K.wheelbase * K.mu * (9.81 + K.downforce * u * u / K.mass) * .92 / (u * u) + K.peakSlip * k, k > 1.5 ? .1 : .07, K.maxSteer);
function codeFor(a, delta, gas, brake, digital) {
  const u = Math.max(a.vx, 3);
  if (!digital) return R.encodeAnalog(clamp(delta / steerLimit(u, 1.6), -1, 1), gas, brake);
  const sDes = clamp(delta / steerLimit(u, 1.15), -1, 1), dir = sDes > a.steer + .04 ? 8 : sDes < a.steer - .04 ? 4 : 0;
  return (gas > .5 ? 1 : 0) | (brake > .3 ? 2 : 0) | dir;
}

function drive(c, road, { digital = false, mu = 1.3, line = false } = {}) {
  setCar(c); const a = R.initial(c), inputs = [], target = profile(road, c, mu);
  const lineAt = s => line ? clamp(road.at(s).k * 160, -2.8, 2.8) : 0; // optional: bias towards the apex
  let stuck = 0, backing = 0;
  while (!a.done) {
    stuck = a.v < 2 ? stuck + 1 : 0;
    if (stuck > 240 || backing) { // recover like a player: reverse away from the barrier, then go
      if (!backing) backing = 1;
      backing++;
      const code = backing < 200 ? 2 | (a.d > 0 ? 8 : 4) : 1;
      if (backing > 260) { backing = 0; stuck = 0; }
      R.step(a, code, c, road); const last = inputs.at(-1); if (last && last[0] === code) last[1]++; else inputs.push([code, 1]); continue;
    }
    const u = Math.max(a.vx, 3), want = target(a.s + u * .25), err = want - a.v;
    const rearSlip = Math.max(a.slip[2], a.slip[3]); // feather the throttle when the rear starts to step out, as a driver would
    const gas = err > 0 ? clamp(err * .6, 0, 1) * clamp(1.9 - .6 * rearSlip, 0, 1) : 0, brake = err < -1.2 ? clamp(-err * .35, 0, 1) : 0;
    const code = codeFor(a, steerDelta(a, road, lineAt), gas, brake, digital);
    R.step(a, code, c, road);
    const last = inputs.at(-1); if (last && last[0] === code) last[1]++; else inputs.push([code, 1]);
  }
  return { state: a, inputs };
}
module.exports = { drive, profile, steerDelta, codeFor, setCar };
