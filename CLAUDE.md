# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HAMMS** (Hospital Asset Maintenance Monitoring System) — a facilities management PWA for Davao Oriental Provincial Medical Center (DOPMC), General Services Division. Tracks work orders, assets, inventory, water quality, waste management, safety incidents, and projects.

## Architecture

This is a **single-file vanilla JavaScript PWA** with no build tools, no framework, and no bundler.

### File Layout

- **`public/index.html`** (~11,000 lines) — the entire application in one file
- **`public/sw.js`** — Service Worker (offline-first caching, skips Firebase API calls)
- **`public/manifest.json`** — PWA manifest
- **`public/icon-192.png`**, **`public/icon-512.png`** — PWA icons
- **`LOCAL.json`** — demo/fallback data loaded on factory reset
- **`firebase.json`** — Firebase Hosting config (SPA rewrite) + Firestore rules pointer
- **`firestore.rules`** — Firestore security rules
- **`firestore.indexes.json`** — Firestore indexes
- **`.firebaserc`** — Firebase project alias (`demoapp-7864a`)

### index.html Internal Structure

The file is organized in this order — use line-number ranges to navigate:

| Lines | Content |
|-------|---------|
| 1–30 | `<head>`, meta tags, fonts (IBM Plex Sans/Mono), manifest link |
| 31–51 | Firebase config (`FIREBASE_CONFIG` object) — **replace with your project's credentials** |
| 55–123 | Firebase SDK initialization (Auth + Firestore, loaded via ES module CDN) |
| 124–639 | `<style>` — all CSS (variables, layout, components, responsive, print) |
| 641–782 | Login overlay HTML |
| 786–856 | Sidebar navigation HTML |
| 857–1880 | Page containers — 17 `<div class="page">` blocks (dashboard through instructions) |
| 1879–2660 | Modals HTML (work orders, assets, inventory, issuance, waste, safety, etc.) |
| 2661–7098 | **Main `<script>`** — storage engine, navigation, CRUD functions, charts, CSV/JSON import/export |
| 7100–7124 | Water tank inline `<style>` |
| 7125–8021 | Water tank & pressure monitoring script block |
| 8029–9993 | Water settings, calculations, alarms, fixture panels script block |
| 9995–10091 | Factory reset script block |
| 10092–10257 | Room view / building explorer script block |
| 10442–10966 | Water settings modal, fixture helpers script block |
| 10968–11050 | CSV template download functions (IIFE) |

### Data Layer

All data lives in an in-memory object `_memDB` with 15 collections:

```
wo, assets, inventory, issuance, waste, waterLogs, waterTank,
effluent, safety, projects, medWasteProd, wwProd, censusLog, waterSettings, energyBills
```

Access pattern:
- `DB.g(key)` — get collection array from `_memDB`
- `DB.s(key, value)` — set collection and queue sync to Firestore
- `DB.nid(key)` — generate unique numeric ID for new records

Scalar/meta state lives in `_fbMetaState` (personnel roster, inpatient count, last export date, per-store initialization flags). Synced to Firestore doc `/hammsMeta/state`.

### Firestore Document Structure

```
/hammsStores/{storeName}/records/{docId}   — per-record documents (14 store collections)
/hammsMeta/state                           — scalar metadata (personnel, inpatient, flags)
/hamms/mainData                            — legacy single-doc (read-only fallback)
```

Each record gets a `_docId` (UUID-based via `generateRecordDocId()`), a numeric `id` (timestamp-based via `generateUniqueNumericId()`), and version metadata (`_v`, `_updatedAt`, `_updatedBy`) stamped by `stampRecord()`.

### Firebase Setup

- **Project**: `demoapp-7864a`
- **Auth**: Email/password via Firebase Auth v12.10.0 (anonymous auth enabled)
- **Database**: Firestore — per-store record-level documents
- **Hosting**: SPA rewrite (all routes → `/index.html`)
- **SDKs**: ES module CDN (`https://www.gstatic.com/firebasejs/12.10.0/...`)

### Firestore Security Rules

Rules require `request.auth != null` for all operations. Store writes are restricted to the 14 known collection names. Records must have `< 100` keys, and `_v` (int) and `_updatedAt` (int) are type-checked when present. Everything else is denied by default.

### Navigation / Routing

Client-side tab navigation via `navigate(pageName)`. Each page is a `<div class="page" id="page-{name}">` toggled with `.active` class. 19 pages: `dashboard`, `workorders`, `assets`, `forecast`, `inventory`, `issuance`, `waste`, `wastefcast`, `safety`, `projects`, `water`, `watertank`, `effluent`, `medwaste`, `wwprod`, `energy`, `fuel`, `reports`, `instructions`.

### Sync Architecture

- **Firebase-only**: Firestore is the sole source of truth. JSON export/import is manual backup only.
- **Real-time listeners**: Firestore `onSnapshot` listeners update `_memDB` on remote changes.
- **Write queue**: `queueStoreSync()` diffs previous vs next arrays, commits version-checked Firestore transactions via `syncToFirebase()` (debounced at 100ms via `scheduleFlush()`).
- **Focus/visibility refresh**: `safeGetDocFresh()` re-reads from Firestore on tab focus to catch changes by other users.
- **Online saves only**: Offline attempts leave form input untouched and do not change records. Failed online writes remain in memory for explicit retry or discard; the form closes only after acknowledgement. Pending writes are not persisted across tab closure.
- **Sync status chip**: top bar shows LIVE, Unavailable, or Offline via `setStorageChip()`.

### XSS Prevention

All user-supplied strings rendered into `innerHTML` must be wrapped in `escapeHTML()`. Image URLs are sanitized by `safeSrc()` (allows only `data:image/` and `https://` schemes). This was audited and patched across 15 locations in v2.5.0.

## Development

No build step. Edit `public/index.html` directly, open in browser or use a local server to test.

### Local Development

```bash
# Option 1: Firebase emulator (requires firebase-tools)
firebase serve

# Option 2: Any static file server pointing at public/
npx serve public
```

### Deploy

```bash
firebase deploy
```

Deploys to Firebase Hosting. Requires `firebase-tools` CLI (`npm i -g firebase-tools`) and project access.

### Service Worker Cache Versioning

When deploying changes, bump the `CACHE_NAME` constant in `public/sw.js` (e.g., `hamms-v2-5-1` → `hamms-v2-5-2`) so returning users get the new version. The SW caches `index.html`, `manifest.json`, and the Google Fonts stylesheet.

## Key Patterns

- **CRUD functions** follow: `open{Entity}Modal(id?)` → `save{Entity}()` → `render{Entity}()`. Delete uses `del{Entity}(id)` with `confirmDialog()`.
- **Badge/tag helpers**: `stBadge()` (status), `condBadge()` (condition), `priSpan()` (priority), `secTag()` (section), `emblBadge()` (compliance)
- **Charts**: `drawBarLineChart()`, `drawDoubleBarChart()`, `drawTripleBarChart()` — custom canvas-based charting (no library)
- **CSV import/export**: `exportCSV(type)` for all 15 collections. Per-module importers: `importAssetCSV()`, `importInventoryCSV()`, `importWOCSV()`, etc. Templates via `download{Type}Template()`.
- **Asset codes**: auto-generated via `generateAssetCode()` using category abbreviation + building/floor/room + sequential ID
- **Energy calculations**: `computeEnergy()`, `calcAssetKwh()` estimate power consumption per asset
- **Modal system**: `openModal(id)` / `closeModal(id)` toggle `.open` class on `.modal-overlay` elements. Modal IDs are prefixed `mo-` (e.g., `mo-wo`, `mo-asset`, `mo-inv`).
- **Toast notifications**: `showToast(message, type)` for user feedback
- **Error handling**: Global `window.onerror` and `unhandledrejection` handlers prefix all errors with `HAMMS Error:` / `HAMMS Unhandled Promise:`

## Important Conventions

- All functions and HTML are in a single file — search by function name to navigate
- Records use numeric `id` fields generated by `DB.nid()` (monotonic, collision-resistant across devices)
- Each record also gets a `_docId` for Firestore document identity via `generateRecordDocId()`
- Date strings use `YYYY-MM-DD` format, normalized by `normYMD()`
- Functions marked `// PATCHED:` were modified during the per-record Firestore migration — read the comment for context before changing
- Record versioning: `stampRecord()` increments `_v`, sets `_updatedAt` (epoch ms) and `_updatedBy` (email/uid). `stampChangedRecords()` only stamps actually-changed records in a batch.
- Cloning: `cloneForFirebase()` (JSON round-trip) is used before any Firestore write to prevent mutation of live references

### Reliability and permissions (2026-10-09)

- Staff share operational record editing and deletion. Restore/reset require the Firebase Auth custom claim `admin: true`, read from the authenticated ID token. Client UI checks do not replace Firestore rules.
- Transactions compare the original server version; related work-order, stock, and issuance operations commit together. Each acknowledgement clears only its matching queue generation.
- Backup replacement validates every store before changing memory and uses one transaction, including its protected metadata marker. The conservative preflight limit is **449 combined existing and imported records**. Larger replacements require a reviewed administrator migration; the app rejects them without changing records.
- `tests/helpers/bootstrap.mjs` isolates Firebase before navigation. Run `npx playwright test` for local checks and `firebase emulators:exec --only firestore --project demo-hamms-tests "node --test tests/rules/firestore.test.mjs"` for rules checks (Java 21). Live-site tests require explicit `--config=playwright.live.config.mjs`.
- Both hosting workflows require the reusable test workflow. Main deployment publishes matching Firestore rules/indexes before hosting. Ensure the deployment service account can deploy Firestore rules. Provision administrator claims through a trusted Admin SDK environment before enabling restore/reset for those accounts; users must refresh their ID token/sign in again.
- Old open browser tabs must refresh for the stricter record metadata/version rules. The service worker cache is `hamms-v2-10-22`. Do not use an older client with the new rules.
- Existing duplicate numeric IDs are rejected for administrator repair rather than silently renumbered and breaking references. New numeric IDs include randomness; document IDs remain authoritative, with document references on newly saved material/issuance links.

- Connectivity listeners opt into includeMetadataChanges. Initial cached snapshots do not invalidate successful server-first reads; subsequent confirmed listener transitions are tracked across metadata and stores. A browser that has internet but is waiting for Firebase displays Connecting, rather than claiming the internet is offline.
