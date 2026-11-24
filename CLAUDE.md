# Redline — engineering context

Read `README.md` and `docs/ROADMAP.md` first. Redline is a daily browser racing game: one timed Nordschleife sector, one official attempt per UTC day, identical conditions for every driver. The intended paid product is unlimited practice for $9.99/month, not additional ranked attempts.

## Priorities

1. Stabilize gameplay before adding features. Reproduce bugs, isolate causes, and add regression tests. High-speed steering, collision detection, camera changes and GPU fallback have been recurring problem areas.
2. Replace the placeholder car with a commercially usable, properly attributed, high-quality 992 GT3 RS mesh. Use genuine geometry, accurate proportions and independently animated wheels; do not continue adding primitives to approximate the silhouette. Keep the game independent of any unlicensed asset.
3. Improve track fidelity with appropriately licensed centerline, elevation, banking and width data. Clearly distinguish surveyed data from approximations.
4. Preserve the high-resolution, colored ASCII aesthetic throughout the game and website. Render conventional 3D geometry through real glyph masks, not a pixelation filter. Aim for smooth 60 FPS with adaptive quality. Keep the site minimal and cohesive, inspired by daily challenge games; avoid gratuitous panels, banners and filler copy.
5. Harden competitive integrity and eventually implement paid practice entitlements on the server. Practice on today's exact configuration should unlock only after the official attempt. Keep practice unlocked in local development until billing and entitlement enforcement are implemented.

## Engineering rules

- Run `npm test` before and after changes; requires Node.js >=22.13. Run `npm start` to exercise the live backend.
- `physics.js` and `track.json` have embedded copies in `index.html`. Keep them synchronized, ideally by replacing manual duplication with a reproducible build step. Server and client must replay the same fixed-step inputs deterministically.
- Add automated browser tests for complete practice and ranked flows, input focus, countdown, camera changes, collisions, reload behavior, and rendering fallback. Do not report unmeasured FPS or untested compatibility.
- Never accept browser-reported finishing times as authoritative. Re-simulate the submitted replay. Anonymous identity and replay validation alone are insufficient for production anti-cheat.
- Do not add fabricated leaderboard entries or describe placeholder geometry as accurate. No production payment processing, account entitlements, survey-accurate track or verified commercial car mesh exists yet.
- Keep credentials and local databases out of version control. Preserve third-party license notices. Do not license original project code without explicit owner approval.
- Prefer small, reviewable changes. Avoid rewriting a working system without a clear reason. Report test results, remaining defects and asset provenance accurately.
