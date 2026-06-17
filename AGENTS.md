# AGENTS.md — HAMMS (Hospital Asset Maintenance Monitoring System)

Single-file vanilla-JS PWA for Davao Oriental Provincial Medical Center. No build step, no framework, no bundler. The whole app is `public/index.html` (~11,900 lines, 11,893). See `CLAUDE.md` for the full architecture map (data layer, sync, page structure, file layout).

## Quick facts

- **App entry:** `public/index.html` (all HTML, CSS, JS in one file)
- **Service worker:** `public/sw.js` — caches app shell + dynamic GETs (skips `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `firebaseinstallations.googleapis.com`, `firebasejs`)
- **PWA manifest + icons:** `public/manifest.json`, `public/icon-192.png`, `public/icon-512.png`
- **Data:** in-memory `_memDB` (15 stores) → Firestore per-record docs under `/hammsStores/{store}/records/{docId}`. Scalar state under `/hammsMeta/state`. See `CLAUDE.md` "Data Layer" for the accessor pattern (`DB.g`, `DB.s`, `DB.nid`).
- **Auth:** Firebase Auth email/password; anonymous auth enabled in `firestore.rules` via `isNamedUser()` (non-null email).
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

- **Service worker cache name must be bumped on every deploy.** Bump `CACHE_NAME` in `public/sw.js:4` (currently `hamms-v2-10-1`) so returning users pick up the new `index.html`. Old caches are auto-pruned on activate.
- **Firestore rules enforce exact store names.** Writes are rejected unless the store segment is one of the 15 names (`wo`, `assets`, `inventory`, `issuance`, `waste`, `waterLogs`, `waterTank`, `effluent`, `medWasteProd`, `wwProd`, `censusLog`, `waterSettings`, `energyBills`, `safety`, `projects`). See `firestore.rules:21-24`. `_updatedBy` on every record must equal the writer's auth email (`isWriter()`).
- **Records are versioned.** Every record gets `_docId` (Firestore key), numeric `id` (collision-safe across devices), `_v` (int, monotonic), `_updatedAt` (epoch ms), `_updatedBy` (email). Use `stampRecord()` or `stampChangedRecords()` — never set these fields by hand. Helpers: `generateRecordDocId()`, `generateUniqueNumericId()` at `public/index.html:2782-2900`.
- **No offline write buffering.** Writes while offline are discarded for multi-user safety. The user must reconnect and re-save. The top bar shows sync state via `setStorageChip()` (`LIVE` / `Unavailable` / `Offline`).
- **Test bootstrap pattern.** Every spec in `tests/` uses a `bootstrapApp(page)` helper that: clears the SW + cache, reloads with `?nocache=<ts>`, hides `#hamms-login-overlay`, makes `#app` visible, seeds empty `_memDB` with the 15 stores, and calls `navigate('dashboard')`. CRUD specs also stub `window._FB.enabled = false` and override `confirmDialog` to auto-confirm. Reuse this helper — do not write a new one. See `tests/crud-e2e.spec.mjs:4-31`.
- **All innerHTML must be sanitized.** Wrap user strings in `escapeHTML()`; URLs in `safeSrc()` (data:image/ + https only). This was audited and patched across 15 locations in v2.5.0; do not regress it.
- **CSP is strict.** `public/index.html` runs inline scripts/styles (`'unsafe-inline'` allowed), Firebase SDK is loaded from `https://www.gstatic.com`, Google Fonts from `https://fonts.googleapis.com` / `https://fonts.gstatic.com`. Don't add new external origins without updating the `Content-Security-Policy` header in `firebase.json:34`.
- **No lint/format/typecheck configured.** There is no ESLint, Prettier, tsc, or formatter in this repo. Tests are the only automated verification. CI (if added) would need to install its own tooling.
- **`LOCAL.json`** is the demo/fallback dataset loaded on factory reset — it is **not** a normal sample; do not commit real data into it.
- **`.gitignore`** covers `node_modules/`, `.firebase/`, `.playwright-mcp/`, `package-lock.json`, `*.docx`. `package-lock.json` is intentionally not tracked.

## File map (where to look)

| Concern | Location |
|---|---|
| App shell, all UI, all logic | `public/index.html` (search by function name) |
| Service worker + cache version | `public/sw.js` |
| Firebase config + enable flag | `public/index.html:46-57` |
| Firebase SDK init + auth state wiring | `public/index.html:60-130` |
| Storage engine (`_memDB`, `DB`, `queueStoreSync`, `syncToFirebase`) | `public/index.html:2820-3460` |
| Security rules (store allowlist, version monotonicity, writer identity) | `firestore.rules` |
| Hosting config (rewrites, CSP, SW headers) | `firebase.json` |
| Firestore indexes | `firestore.indexes.json` |
| Project alias | `.firebaserc` → `demoapp-7864a` |
| Playwright config | `playwright.config.mjs` |

## Detailed architecture

For data flow, sync semantics, page list, modal/CRUD patterns, and badge helpers, read `CLAUDE.md`. It is the canonical reference — this file is a delta for the things CLAUDE.md doesn't surface (test bootstrap, deploy cache bump, rule quirks, missing scripts).
