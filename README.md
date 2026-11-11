# Fairway Caddie

A personal GPS caddie for South Head Golf Club, built as an iPhone web app (PWA).

## Where things are

| Folder | What's in it |
| --- | --- |
| `src/pages/` | The four tabs (Caddie, Round, My Bag, Stats) and Settings |
| `src/components/` | Reusable pieces: club editor, form fields, sliding panel, icons |
| `src/lib/calculations/` | Distance maths: units, carry vs total, club gaps |
| `src/lib/storage/` | On-phone saving (IndexedDB), backup and restore, data checks |
| `src/lib/gps`, `mapping`, `caddie`, `analytics` | Empty for now; filled in Stages 2 to 6 |
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
| `npm run test:e2e` | Browser test (needs Google Chrome; run `npm run build` first). |

## Rules the code follows

- All distances are stored in metres. Yards are only for display.
- Carry and total are separate fields and are never swapped. A distance whose type isn't confirmed is kept as "rough" and marked ≈.
- The caddie never shows advice it can't back with real data.
- Everything stays on the phone. Nothing is sent anywhere.

## Stage log

- **Stage 1 (Nov 2026):** app shell, four tabs, editable bag with gap ladder, settings, auto-save, JSON backup/restore, PWA install and offline support.
