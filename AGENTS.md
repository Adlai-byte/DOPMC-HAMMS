# AGENTS.md — HAMMS (Hospital Asset Maintenance Monitoring System)

Single-file vanilla-JS PWA for Davao Oriental Provincial Medical Center. No build step, no framework, no bundler. The whole app is `public/index.html` (~11,200 lines, 11,212). See `CLAUDE.md` for the full architecture map (data layer, sync, page structure, file layout).

## Quick facts

- **App entry:** `public/index.html` (all HTML, CSS, JS in one file)
- **Service worker:** `public/sw.js` — caches app shell + dynamic GETs (skips Firebase API calls)
- **PWA manifest + icons:** `public/manifest.json`, `public/icon-192.png`, `public/icon-512.png`
- **Data:** in-memory `_memDB` (15 stores) → Firestore per-record docs under `/hammsStores/{store}/records/{docId}`. Scalar state under `/hammsMeta/state`. Access via `DB.g(key)`, `DB.s(key, val)`, `DB.nid(key)`.
- **Auth:** Firebase Auth email/password; requires non-null email per `firestore.rules`.
- **No `scripts` in `package.json`** — invoke tools via `npx`.

## Common commands

```bash
npm install                           # installs firebase, docx, @playwright/test, playwright

npx playwright test                   # run all e2e/unit specs (auto-starts `npx serve public -l 3000`)
npx playwright test tests/<file>.spec.mjs   # run one spec file
npx playwright test -g "pattern"      # run tests by name
npx playwright test --headed          # debug with a visible browser

npx serve public -l 3000              # local dev server (matches playwright.config.mjs webServer)
firebase serve                        # alternative: Firebase emulator
firebase deploy                       # deploy hosting + firestore rules + indexes
```

Playwright config: `testDir: ./tests`, `baseURL: http://localhost:3000`, `timeout: 30s`, `retries: 1`, `reuseExistingServer: true`.

## Required setup before first run

1. `npm install` (pulls Playwright + browser deps).
2. If running tests with real Firebase wired in, replace `FIREBASE_CONFIG` at `public/index.html:46-54` with project credentials, or set `FIREBASE_ENABLED = false` at `public/index.html:56` for offline-only.
3. `npx playwright install` once to fetch browsers (if not already cached).

## Repo-specific gotchas (things an agent will get wrong without this)

- **Service worker cache name must be bumped on every deploy.** Bump `CACHE_NAME` in `public/sw.js:4` (currently `hamms-v2-10-19`) so returning users pick up the new `index.html`. Old caches are auto-pruned on activate.
- **Firestore rules enforce exact store names.** Writes are rejected unless the store segment is one of the 15 names (`wo`, `assets`, `inventory`, `issuance`, `waste`, `waterLogs`, `waterTank`, `effluent`, `medWasteProd`, `wwProd`, `censusLog`, `waterSettings`, `energyBills`, `safety`, `projects`). See `firestore.rules:21-24`. `_updatedBy` on every record must equal the writer's auth email (`isWriter()`).
- **`FIREBASE_ENABLED = false` for test mode.** Tests stub `window._FB.enabled = false` to prevent actual Firestore writes. The app also runs fully offline when set at line 56.
- **Records are versioned.** Every record gets `_docId` (Firestore key), numeric `id` (collision-safe across devices), `_v` (int, monotonic), `_updatedAt` (epoch ms), `_updatedBy` (email). Use `stampRecord()` or `stampChangedRecords()` — never set these fields by hand. Helpers: `generateRecordDocId()`, `generateUniqueNumericId()` at `public/index.html:2978-2991`.
- **Layout is viewport-locked.** `body { overflow:hidden; }` prevents whole-page scrolling; `#main` and `#content` use `min-height:0` so the content area scrolls independently and the footer stays fixed at the bottom. The desktop sidebar is `position:fixed` with `#main { margin-left:var(--sb-w); }`.
- **No offline write buffering.** Writes while offline are discarded for multi-user safety. The user must reconnect and re-save. The top bar shows sync state via `setStorageChip()` (`LIVE` / `Unavailable` / `Offline`).
- **Test bootstrap pattern.** Every spec in `tests/` uses a `bootstrapApp(page)` helper (see `tests/crud-e2e.spec.mjs:4-31`): clears SW + cache, reloads with `?nocache=<ts>`, hides login overlay, seeds empty `_memDB` with 15 stores, stubs Firestore, overrides `confirmDialog`, calls `navigate('dashboard')`. Reuse this helper — do not write a new one.
- **All innerHTML must be sanitized.** Wrap user strings in `escapeHTML()`; URLs in `safeSrc()` (data:image/ + https only). This was audited and patched across 15 locations in v2.5.0; do not regress it.
- **CSP is strict.** `public/index.html` runs inline scripts/styles (`'unsafe-inline'` allowed), Firebase SDK from `https://www.gstatic.com`, Google Fonts from `https://fonts.googleapis.com` / `https://fonts.gstatic.com`. Don't add new external origins without updating `Content-Security-Policy` in `firebase.json:34`.
- **No lint/format/typecheck configured.** No ESLint, Prettier, tsc, or formatter. Tests are the only automated verification.
- **`LOCAL.json`** is the demo/fallback dataset loaded on factory reset — it is **not** a normal sample; do not commit real data into it.
- **`.gitignore`** excludes `node_modules/`, `.firebase/`, `.playwright-mcp/`, `package-lock.json`, `*.docx`. `package-lock.json` is intentionally untracked.
- **Code comments tagged `PATCHED:`** carry migration context — read them before changing the surrounding logic.

## File map (where to look)

| Concern | Location |
|---|---|
| App shell, all UI, all logic | `public/index.html` (search by function name) |
| Service worker + cache version | `public/sw.js` |
| Firebase config + enable flag | `public/index.html:46-56` |
| Firebase SDK init + auth state wiring | `public/index.html:60-134` |
| Storage engine (`_memDB`, `DB`, `queueStoreSync`, `syncToFirebase`) | `public/index.html:2887-3460` |
| Security rules (store allowlist, version monotonicity, writer identity) | `firestore.rules` |
| Hosting config (rewrites, CSP, SW headers) | `firebase.json` |
| Firestore indexes | `firestore.indexes.json` |
| Project alias | `.firebaserc` → `demoapp-7864a` |
| Playwright config | `playwright.config.mjs` |

## Detailed architecture

For data flow, sync semantics, page list, modal/CRUD patterns, and badge helpers, read `CLAUDE.md`. It is the canonical reference — this file is a delta for the things CLAUDE.md doesn't surface (test bootstrap, deploy cache bump, rule quirks, missing scripts).
