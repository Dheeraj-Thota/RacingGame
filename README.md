# REDLINE

**One sector. One attempt. Every day.**

Redline is a browser-based, daily time-trial racing game set on a reconstruction of the Nürburgring Nordschleife. Every player receives the same car, track sector and conditions. The first ranked attempt is final; finishing times determine the daily standings.

The world is rendered in real-time 3D using colored ASCII glyphs rather than conventional textured pixels. The goal is to combine the accessibility of a daily web game with the depth and precision of competitive racing.

## Project status

**Playable prototype — not a production release.** The current build supports offline play and a locally hosted shared leaderboard. The commercial vehicle asset, surveyed circuit data, production authentication, payments and public deployment are outstanding. Vehicle handling is an assisted, route-relative keyboard model rather than a calibrated simulator.

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
| P | Pause practice |
| R | Restart practice |
| View selector | Hood, centered chase, offset chase |
| Detail selector | Manual quality or automatic scaling toward 60 FPS |

The current development build leaves practice unlocked for testing.

## Game design

- Seven rotating timed sectors along the 20.832 km Nordschleife outline; a new challenge begins at 00:00 UTC.
- One ranked attempt per day, including abandoned runs, with a rolling start and fixed conditions.
- Track-limit and barrier-contact penalties; a finished run is ranked by total elapsed time including penalties.
- Global position, percentile and time behind the leader when shared rankings are available.
- Practice and personal improvement without overwriting the official daily result.

## Architecture

| Component | Implementation |
| --- | --- |
| Client | Standalone HTML, CSS and JavaScript; embedded track and simulation data |
| Renderer | 3D triangle geometry, perspective projection, depth, colored glyph rendering; WebGL with software fallback |
| Simulation | Shared 120 Hz fixed-step vehicle model, deterministic input replay |
| Track | Distance-sampled circuit outline, with approximate elevations and banking |
| Server | Node.js HTTP, JSON endpoints, anonymous cookie identity |
| Storage | SQLite, one attempt per session identity and UTC date |
| Validation | Server-issued tokens, replay simulation, input bounds and elapsed-time checks |

### Repository layout

```text
index.html           Standalone game and rendering engine
physics.js           Shared simulation and replay validation
track.json           Sampled circuit data
server.js            HTTP API and SQLite persistence
test.js              Physics regression tests
TRACK-LICENSE.txt    Third-party circuit attribution and license
docs/                Development roadmap
.github/workflows/   Continuous integration
```

The client embeds copies of the simulation and track data. When changing either `physics.js` or `track.json`, synchronize the embedded copies in `index.html` before releasing; mismatched versions can break replay validation.

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
| `DB_PATH` | Local `redline-v4.sqlite` |
| `COOKIE_SECURE` | Unset; set to `1` behind HTTPS |

Use durable database storage and HTTPS for a hosted instance. Do not expose this development server directly to the public without adding rate limiting, monitoring and production security controls.

## Commercial model

The intended launch model is a free daily ranked attempt and a **$9.99/month unlimited practice subscription**. Paying players do not receive extra official ranked attempts. To preserve fairness, today's ranked sector should only become available for practice after the player has used their daily attempt. Historical challenges may be practiced independently.

Subscriptions, account entitlements and payment processing are not implemented in the prototype. See [the roadmap](docs/ROADMAP.md).

## Testing and performance

The regression suite checks deterministic replay across all seven sectors, invalid input rejection, speed-guided zero-collision runs, straight-sector high-speed stability and steering recentering. Automated tests do not substitute for human driving and cross-device testing.

The renderer targets 60 FPS through adaptive detail. Actual performance depends on graphics hardware, browser and selected resolution. Maximum-detail GPU performance is not verified.

## Asset fidelity and licensing

The bundled car is an original procedural placeholder inspired by the 992 GT3 RS; it is **not** an accurate Porsche asset. The client accepts a locally supplied, licensed body-only Wavefront OBJ (up to 8 MB and 18,000 triangles). Export without wheels, with X width, Y up and Z forward. The importer normalizes length and maps materials approximately from material names; it does not import external textures or MTL files. Wheels are animated separately and may need alignment.

The circuit outline is derived from [JJ Ying's Nürburgring Map](https://github.com/JJYing/Nurburgring-Map), with MIT attribution in [TRACK-LICENSE.txt](TRACK-LICENSE.txt). Elevation, width, banking and scenery are approximate, not laser-scanned. No externally downloaded Porsche mesh is bundled.

Redline is an independent prototype and is not affiliated with Porsche or the Nürburgring. Verify all relevant commercial asset, branding and track rights before public launch. No open-source license has been selected for Redline's original code; the third-party MIT notice applies to the attributed circuit source, not the entire project.
