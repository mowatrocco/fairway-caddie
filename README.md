# Fairway Caddie

A personal GPS caddie for South Head Golf Club, built as an iPhone web app (PWA).

## Where things are

| Folder | What's in it |
| --- | --- |
| `src/pages/` | The four tabs (Caddie, Round, My Bag, Stats) and Settings |
| `src/components/` | Reusable pieces: club editor, form fields, sliding panel, icons |
| `src/lib/calculations/` | Distance maths: units, carry vs total, club gaps |
| `src/lib/storage/` | On-phone saving (IndexedDB), backup and restore, data checks |
| `src/lib/geo/` | Distances (GeographicLib), green front/middle/back, shape maths |
| `src/lib/course/` | Course features, hole checklist, GeoJSON import/export |
| `src/lib/gps/` | GPS capture and accuracy grading |
| `src/lib/mapping/` | The map adapter (only file that knows about MapLibre) and LINZ key handling |
| `src/lib/caddie/` | The caddie engine: club model, shot simulation, scoring and the three strategies |
| `src/lib/analytics/` | Empty for now; filled in Stage 6 |
| `src/data/` | Your starting bag; course files go in `data/courses/` |
| `src/state/` | How edits flow through the app and get auto-saved |
| `src/tests/` | Unit tests |
| `tests/e2e/` | Browser test that clicks through the app at iPhone sizes |

## Commands (run in Terminal, inside this folder)

| Command | What it does |
| --- | --- |
| `npm install` | Downloads the libraries the app needs. Run once. |
| `npm run dev` | Starts the app on your Mac at the address it prints. |
| `npm test` | Runs the unit tests. |
| `npm run build` | Makes the finished app in `dist/`, ready to host. |
| `npm run test:e2e` | Browser test of the main app (needs Google Chrome; run `npm run build` first). |
| `npm run test:e2e:map` | Browser test of the course-mapping screen. |
| `npm run test:e2e:caddie` | Browser test of the Caddie screen with simulated GPS and offline photos. |

## Rules the code follows

- All distances are stored in metres. Yards are only for display.
- Carry and total are separate fields and are never swapped. A distance whose type isn't confirmed is kept as "rough" and marked ≈.
- The caddie never shows advice it can't back with real data.
- Club advice is worked out by fixed TypeScript rules, not AI: the same inputs always give the same answer. A distance not yet marked carry or total is used as carry and the advice says so. Wind and slope are not included yet.
- Everything stays on the phone. The only things fetched are LINZ map photos, which are kept on the phone (Cache Storage) so the map works with no signal.
- GPS runs only while the Caddie or course-map screen is open and the app is on screen. Distances are never shown as plain numbers when GPS is worse than ±10 m or more than 20 s old.
- The LINZ map key is stored on the phone only, never in the code or in backups.
- Every course feature carries a trust label: Official, Verified on course, Traced from imagery or Estimated. Moving a verified point by hand drops it to Traced.

## Stage log

- **Stage 1 (Nov 2026):** app shell, four tabs, editable bag with gap ladder, settings, auto-save, JSON backup/restore, PWA install and offline support.
- **Stage 2 (Nov 2026):** South Head scorecards (Blue, White, Yellow); course-mapping screen on LINZ aerial photos with crosshair tracing, hole checklist against the card, GPS point capture, undo, GeoJSON export/import; saved data version 2.
- **Stage 3 (Nov 2026):** live GPS on the Caddie screen (Quick and Map views): front/middle/back, accuracy badge, hazards with reach and carry along your line, out-of-bounds clearance, tap-to-measure, set-position-by-hand fallback, rangefinder cross-check, hole-switch suggestion, keep-screen-on, offline course photos.
- **Hazard matching (Nov 2026):** hazards and out-of-bounds lines count for every hole they sit near, worked out from where they are, so a hazard shared by two holes only needs tracing once.
- **Stage 4 (Nov 2026):** club advice on the Caddie screen. Each club in your bag is tried along a fan of aim lines with a few hundred simulated shots using your carry, spread and usual miss; outcomes are scored by strokes to finish plus extra weight for penalties. Safe (penalty chance kept at 5% or under where possible), Normal and Aggressive; the choice is remembered. Shows club, aim, carry and finish, chance of the green and of a penalty, the reasons, an alternative and a confidence level with why. The Map view draws the aim line and landing zone and compares all three strategies. Uses your rangefinder reading when typed in, says "part swing" inside your shortest club, and gives distance-only advice when there's no position.
