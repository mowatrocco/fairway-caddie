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
| `src/lib/caddie`, `analytics` | Empty for now; filled in Stages 4 and 6 |
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

## Rules the code follows

- All distances are stored in metres. Yards are only for display.
- Carry and total are separate fields and are never swapped. A distance whose type isn't confirmed is kept as "rough" and marked ≈.
- The caddie never shows advice it can't back with real data.
- Everything stays on the phone. The only things fetched are LINZ map photos.
- The LINZ map key is stored on the phone only, never in the code or in backups.
- Every course feature carries a trust label: Official, Verified on course, Traced from imagery or Estimated. Moving a verified point by hand drops it to Traced.

## Stage log

- **Stage 1 (Nov 2026):** app shell, four tabs, editable bag with gap ladder, settings, auto-save, JSON backup/restore, PWA install and offline support.
- **Stage 2 (Nov 2026):** South Head scorecards (Blue, White, Yellow); course-mapping screen on LINZ aerial photos with crosshair tracing, hole checklist against the card, GPS point capture, undo, GeoJSON export/import; saved data version 2.
