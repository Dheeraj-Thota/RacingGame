# Development roadmap

## P0 — Driving and visual quality

- [ ] Replace placeholder vehicle mesh with a commercially licensed, dimensionally accurate car asset; separate wheel, steering, suspension and aero animations.
- [x] GPS-derived centreline with real elevation and named corners (v5).
- [ ] Replace with properly licensed, surveyed centreline, elevation, banking (Karussell) and width data.
- [x] Four-wheel tyre model calibrated to published acceleration, top speed and braking (v5).
- [ ] Gather human playtest feedback on keyboard and gamepad handling; tune assists.
- [ ] Measure frame pacing and target 60 FPS across representative desktop and mobile hardware; retain clear ASCII glyphs at every quality setting.
- [ ] Simplify and validate the complete home → attempt → result flow, including interruption and recovery.

## Next — Garage and tracks (requested)

- [x] Garage with two cars (Formula '86 main, Kestrel RS practice); car is part of each challenge and replay (v6).
- [ ] More cars; per-car daily leaderboards if ranked runs ever allow a choice.
- [ ] Additional tracks: generalise `tools/build-track.js` and sector definitions per circuit; keep licensing notes per track.

## P1 — Daily competition

- [ ] Version daily challenge configurations, physics and replay formats.
- [ ] Implement persistent accounts, abuse protection, rate limits and bot detection.
- [ ] Separate practice attempts and ranked attempts in the data model; enforce entitlement and same-day practice rules server-side.
- [ ] Add shareable results, personal history and friend comparisons without fake scores.
- [ ] Test daily reset, interrupted runs, concurrent submissions and persistence.

## P2 — Monetization

**Free:** one ranked daily attempt, global standings and results.

**Practice subscription:** $9.99/month, unlimited practice and historical challenges. The daily ranked attempt remains identical for subscribers and free users. Today's sector is unlocked for practice only after the ranked attempt is used.

- [ ] Implement checkout, verified payment webhooks, subscription lifecycle and server-side entitlement checks.
- [ ] Add billing portal, cancellation and clear pricing disclosures.
- [ ] Measure daily retention and practice demand before paid launch.
- [ ] Confirm commercial licensing of car, circuit, branding and all assets.

## Release gates

No public paid launch until core driving is reliable, leaderboard integrity is tested, commercial rights are cleared, payment lifecycle is verified and the service has production security and observability.
