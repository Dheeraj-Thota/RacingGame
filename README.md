# REDLINE

**One sector. One attempt. Every day.**

Redline is a browser-based, daily time-trial racing game set on a reconstruction of the Nürburgring Nordschleife. Every player receives the same car, track sector and conditions. The first ranked attempt is final; finishing times determine the daily standings.

The world is rendered in real-time 3D using colored ASCII glyphs rather than conventional textured pixels. The goal is to combine the accessibility of a daily web game with the depth and precision of competitive racing.

## Project status

**Playable prototype — not a production release.** The current build supports offline play and a locally hosted shared leaderboard. Vehicle handling is a calibrated four-wheel tyre model (see *Vehicle simulation*). The commercial vehicle mesh, surveyed (laser-scanned) circuit data, production authentication, payments and public deployment are outstanding.

## Quick start

Requires Node.js **22.13 or newer** (the server uses the built-in `node:sqlite` module). No external npm packages are required.

```bash
npm start
```

Visit [http://localhost:3000](http://localhost:3000). The server creates a local SQLite database automatically. To play without a backend, open `index.html` in a browser; the offline build stores attempts locally and cannot submit shared rankings.

Run the physics regression suite:

```bash
npm test
```

### Controls

| Input | Action |
| --- | --- |
| W / Up | Accelerate |
| S / Down | Brake |
| A / D or Left / Right | Steer |
| S held at a standstill | Reverse; throttle at a standstill returns to drive |
| Gamepad | Left stick steers, triggers are analogue throttle and brake |
| P | Pause practice |
| R | Restart practice |
| C / VIEW | Chase far, chase near, bumper, hood |
| L / LINE | Driving line on/off |
| G / GHOST | Ghost of your best run on/off |
| DETAIL | Manual quality or automatic scaling toward 60 FPS |

The current development build leaves practice unlocked for testing.

## Game design

- Seven rotating timed sectors between named corners of the Nordschleife (Hatzenbach – Flugplatz, …, Bellof-S – Döttinger Höhe); a new challenge begins at 00:00 UTC.
- Full 20.8 km lap available in practice (real 992 GT3 RS reference: 6:49.328).
- One ranked attempt per day, including abandoned runs, with a rolling start and fixed conditions.
- Track-limit and barrier-contact penalties; a finished run is ranked by total elapsed time including penalties.
- Global position, percentile and time behind the leader when shared rankings are available.
- Practice and personal improvement without overwriting the official daily result.
- Gran Turismo-style aids: a driving line coloured for throttle, lift and braking zones; a ghost of your best run (stored as inputs and re-simulated); a live delta to that best; and an ASCII speed trace against it after each run. These are visual only and identical for every driver.

## Architecture

| Component | Implementation |
| --- | --- |
| Client | Standalone HTML, CSS and JavaScript; embedded track and simulation data |
| Renderer | 3D triangle geometry, perspective projection, depth, colored glyph rendering; WebGL with software fallback |
| Simulation | Shared 120 Hz fixed-step (4 substeps) four-wheel vehicle model, deterministic input replay |
| Track | GPS-derived centreline with real elevation, 44 named corner ranges, approximate kerbs |
| Server | Node.js HTTP, JSON endpoints, anonymous cookie identity |
| Storage | SQLite, one attempt per session identity and UTC date |
| Validation | Server-issued tokens, replay simulation, input bounds and elapsed-time checks |

### Repository layout

```text
index.html           Built standalone game (generated, do not edit)
src/page.html        Page markup and CSS (ASCII interface)
src/client.js        Renderer, HUD, game flow, input
physics.js           Shared simulation and replay validation
track.json           Generated circuit data
server.js            HTTP API and SQLite persistence
test.js              Track, calibration, replay and behaviour tests
tools/build.js       Builds index.html from src/, physics.js and track.json
tools/build-track.js Builds track.json from tools/source/
tools/driver.js      Reference test driver (produces replayable inputs)
tools/calibrate.js   Car figures vs published data
TRACK-LICENSE.txt    Third-party circuit attribution and license
docs/                Development roadmap
.github/workflows/   Continuous integration
```

`index.html` embeds `physics.js` and `track.json`. After changing either, or anything in `src/`, run `node tools/build.js`; `npm test` fails if the embedded copies are stale.

### HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/daily` | Current challenge, player's attempt and standings |
| POST | `/api/start` | Reserve the daily attempt and issue a token |
| POST | `/api/finish` | Validate input replay and record the result |

The current server is designed for local development. A submitted replay is re-simulated rather than trusting client-reported lap times. This does **not** prevent bots, optimized offline inputs, cookie resets or multiple accounts. Production ranked competition needs stronger identity, abuse controls and versioned challenge configurations.

### Configuration

| Environment variable | Default |
| --- | --- |
| `HOST` | `127.0.0.1` |
| `PORT` | `3000` |
| `DB_PATH` | Local `redline-v5.sqlite` |
| `COOKIE_SECURE` | Unset; set to `1` behind HTTPS |

Use durable database storage and HTTPS for a hosted instance. Do not expose this development server directly to the public without adding rate limiting, monitoring and production security controls.

## Vehicle simulation

`physics.js` (version 5) models the car as a planar rigid body with four tyres, in track-relative coordinates:

- Combined-slip tyre forces (Magic Formula shape on normalised slip), load-sensitive grip, kerb/verge/grass surfaces per wheel.
- Longitudinal and lateral load transfer with damper lag; crests and compressions change tyre load using the track's real elevation profile.
- Wheel spin per wheel, reflected engine inertia, limited-slip rear differential, rev limiter, engine braking, automatic PDK shifting, reverse.
- Brakes: hydraulic pressure lag, ~65% front brake force, slip-target ABS per wheel with a lower rear target (EBD) for stability, and disc temperature (heat in from brake power, speed-dependent cooling) driving pad friction: cold bite below ~120 °C, fade above ~720 °C.
- ABS, traction control, PSM-style stability control, rear-axle steering, a keyboard steering limiter and a countersteer aid when the rear steps out. These are identical for all drivers.
- Handling balance aims for the approachable, progressive feel of arcade-sim racers such as Forza Horizon: a gentle tyre breakaway past the peak and forgiving barrier contact. At the grip limit, peak sideslip under full power is about 10–11° (21° in the previous tuning) and under trail-braking about 3° (6°).
- Barriers use rigid-body impulses at the car's corners.

Published 992 GT3 RS figures used: 1450 kg DIN (+75 kg driver), 2457 mm wheelbase, 1630/1582 mm tracks, 275/35 R20 and 335/30 R21 tyres, 386 kW at 8500 rpm, 465 Nm at 6300 rpm, 9000 rpm, PDK ratios 3.75/2.38/1.72/1.34/1.11/0.96/0.84 with 4.27 final drive, 409 kg downforce at 200 km/h and 860 kg at 285 km/h. Weight distribution, CG height, inertias, roll stiffness split, intermediate torque-curve points, brake torque and tyre coefficients are estimates and are marked as such in the code.

Calibration (`node tools/calibrate.js`): 0–100 km/h 3.7 s (published 3.2), 0–200 km/h 11.1 s (10.6), top speed 293 km/h (296), 100–0 km/h 28 m, 250–0 km/h 142 m, about 1.45 g steady-state lateral grip. A quasi-steady lap estimate for this model is about 7:08 on the centreline and 6:47 on a basic racing line, against the real car's 6:49.3. These are model checks, not validation against telemetry, and no human playtesting has been done on this version.

Only exactly-rounded arithmetic is used in the simulation (its own polynomial sin/cos/atan replace `Math` trig, whose results can differ between JavaScript engines), so browser and server replays match bit for bit.

## Commercial model

The intended launch model is a free daily ranked attempt and a **$9.99/month unlimited practice subscription**. Paying players do not receive extra official ranked attempts. To preserve fairness, today's ranked sector should only become available for practice after the player has used their daily attempt. Historical challenges may be practiced independently.

Subscriptions, account entitlements and payment processing are not implemented in the prototype. See [the roadmap](docs/ROADMAP.md).

## Testing and performance

`npm test` checks track length, direction, elevation and grades; that `index.html` is current; trig accuracy; acceleration, top speed and braking against published figures; a clean reference-driver run with bit-identical replay on every sector (analogue and keyboard input); a full lap; input validation; steering return-to-centre; barrier contact without tunnelling; and reverse. Automated tests do not substitute for human driving and cross-device testing.

The renderer draws a detailed scene for roughly the next 650 m and a low-detail road, verge and treeline for the whole lap beyond it, so long sightlines reach the horizon. The renderer targets 60 FPS through adaptive detail. Actual performance depends on graphics hardware, browser and selected resolution. Maximum-detail GPU performance is not verified.

## Asset fidelity and licensing

The bundled car is an original procedural placeholder inspired by the 992 GT3 RS; it is **not** an accurate Porsche asset. Its wheelbase, tracks and tyre sizes now match published figures and its wheels spin, steer and pitch/roll from the simulation, but the body shape is approximate. The client accepts a locally supplied, licensed body-only Wavefront OBJ (up to 8 MB and 18,000 triangles). Export without wheels, with X width, Y up and Z forward. The importer normalizes length and maps materials approximately from material names; it does not import external textures or MTL files. Wheels are animated separately and may need alignment.

The circuit is built by `tools/build-track.js` from the route, corner and kerb files in [JJ Ying's Nürburgring Map](https://github.com/JJYing/Nurburgring-Map) (MIT, see [TRACK-LICENSE.txt](TRACK-LICENSE.txt)). The route is GPS-derived (VeloViewer segment 5539685): the generated lap is 20,822.6 m (official 20,832 m), runs clockwise and spans 334–623 m elevation. It is smoothed, its 184 m start seam is interpolated, and a source spike of ~30% grade after Breidscheid is redistributed to an 18% maximum. Width, banking (including the Karussell), kerbs, corner ranges and scenery are approximate, not laser-scanned. Rights to the underlying route data should be confirmed before commercial use. No externally downloaded Porsche mesh is bundled.

Redline is an independent prototype and is not affiliated with Porsche or the Nürburgring. Verify all relevant commercial asset, branding and track rights before public launch. No open-source license has been selected for Redline's original code; the third-party MIT notice applies to the attributed circuit source, not the entire project.
