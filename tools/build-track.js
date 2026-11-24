'use strict';
// Builds track.json from tools/source/*.json (JJ Ying, MIT; route originally from VeloViewer segment 5539685).
// Usage: node tools/build-track.js
const fs = require('node:fs'), path = require('node:path');
const src = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'source', f), 'utf8'));
const route = src('route.json'), corners = src('corners.json'), curbs = src('curbs.json');

// Source points are [east, elevation, south, distance]. Use x = east, z = north so that the
// renderer's right-hand vector (cos yaw, -sin yaw) is the driver's real right (no mirroring).
let raw = route.points.map(([e, h, s]) => ({ x: e, y: h, z: -s }));

// Close the 184 m seam between the source endpoint and the start with a cubic Hermite bridge.
const a = raw.at(-1), b = raw[0], pa = raw.at(-6), pb = raw[5];
const gap = Math.hypot(b.x - a.x, b.z - a.z);
const ta = norm({ x: a.x - pa.x, y: 0, z: a.z - pa.z }), tb = norm({ x: pb.x - b.x, y: 0, z: pb.z - b.z });
for (let i = 1, n = Math.ceil(gap / 6); i < n; i++) {
  const t = i / n, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
  raw.push({ x: h00 * a.x + h10 * gap * ta.x + h01 * b.x + h11 * gap * tb.x, y: a.y + (b.y - a.y) * t, z: h00 * a.z + h10 * gap * ta.z + h01 * b.z + h11 * gap * tb.z });
}
function norm(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }

function resample(points, spacing) {
  const n = points.length, cum = [0];
  for (let i = 1; i <= n; i++) { const p = points[i - 1], q = points[i % n]; cum.push(cum[i - 1] + Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)); }
  const total = cum[n], count = Math.round(total / spacing), step = total / count, out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = k * step; while (cum[j + 1] < s) j++;
    const p = points[j], q = points[(j + 1) % n], f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f });
  }
  return { points: out, total, step };
}
function smooth(points, key, sigma) {
  const n = points.length, r = Math.ceil(sigma * 3), w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-k * k / (2 * sigma * sigma)));
  const sum = w.reduce((s, x) => s + x, 0), vals = points.map(p => p[key]);
  points.forEach((p, i) => { let v = 0; for (let k = -r; k <= r; k++) v += vals[(i + k + n) % n] * w[k + r]; p[key] = v / sum; });
}

// 1 m knots; horizontal Gaussian sigma 9 m (GPS noise), vertical sigma 22 m (elevation noise).
const fine = resample(raw, 1).points;
smooth(fine, 'x', 9); smooth(fine, 'z', 9); smooth(fine, 'y', 22);
const out = resample(fine, 6);

// The source climbs ~30% for ~100 m just after Breidscheid, beyond the circuit's commonly published
// ~17% maximum, most likely a source elevation artifact. Spread any grade above MAX_GRADE into the
// neighbouring segments. This preserves each local elevation change and every point's net height.
const MAX_GRADE = .18, rise = out.points.map((p, i, all) => all[(i + 1) % all.length].y - p.y), cap = MAX_GRADE * out.step;
let clamped = 0;
for (let pass = 0; pass < 5000; pass++) {
  let moved = false;
  for (let i = 0; i < rise.length; i++) {
    const excess = Math.abs(rise[i]) - cap; if (excess <= 1e-6) continue;
    const sign = Math.sign(rise[i]), n = rise.length; rise[i] -= sign * excess;
    rise[(i + n - 1) % n] += sign * excess / 2; rise[(i + 1) % n] += sign * excess / 2; moved = true; clamped++;
  }
  if (!moved) break;
}
for (let i = 1; i < out.points.length; i++) out.points[i].y = out.points[i - 1].y + rise[i - 1];
smooth(out.points, 'y', 2); // soften the grade kinks left by redistribution (sigma 2 samples = 12 m)

// Map source-distance corner ranges (same anchors JJ Ying's demo uses) onto the new arc length.
const srcTotal = route.distanceM + gap, scale = out.total / srcTotal;
const anchors = [[0, 0], [.003, 0], [.353, 7350], [.3775, 8008.4], [.5785, 12000], [.997, route.distanceM], [1, srcTotal]];
const distanceAt = f => { const i = anchors.findIndex(x => x[0] >= f); if (i <= 0) return 0; const [p, q] = [anchors[i - 1], anchors[i]]; return p[1] + (q[1] - p[1]) * (f - p[0]) / (q[0] - p[0]); };
const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;

const track = {
  version: 5,
  source: 'JJ Ying, Nurburgring-Map (MIT): demo/route.json, corners.json, curbs.json. Route from VeloViewer segment 5539685 (GPS-derived).',
  notes: 'Centreline is GPS-derived and smoothed (horizontal sigma 9 m, vertical sigma 22 m); 184 m start seam is interpolated. Elevation follows the source, except grades above 18% (a source spike after Breidscheid) are redistributed to adjacent segments. Width, banking, kerbs and corner ranges are approximate, not surveyed.',
  length: r3(out.total),
  step: out.step,
  points: out.points.map(p => [r3(p.x), r3(p.y), r3(p.z)]),
  corners: corners.map(c => ({ name: c.name, start: r1(distanceAt(c.start) * scale), end: r1(distanceAt(c.end) * scale) })).sort((p, q) => p.start - q.start),
  curbs: curbs.segments.map(c => ({ side: c.side === 'right' ? 1 : -1, start: r1(c.start * scale), end: r1(c.end * scale) }))
};
fs.writeFileSync(path.join(__dirname, '..', 'track.json'), JSON.stringify(track));
console.log(`track.json: ${track.points.length} points, ${track.length} m, step ${track.step.toFixed(4)} m, ${track.corners.length} corners, ${track.curbs.length} curbs`);
