# Phase 3 — confirmed saves and preserved drafts

Date: 16 October 2026 (Asia/Singapore).

Branch: `codex/phase-3-confirmed-saves`, based on the Phase 2 feature branch.

## Delivery boundary

Implemented a **local emulator browser integration** around the existing HAMMS forms, a reusable save controller, and authenticated server status/read endpoints. Production and preview hosting, deployed rules, existing operational data, tags, classifications, links and memberships remain unchanged. No billing or cloud resources were enabled.

This is the Phase 3 emulator milestone, not a deployment or a claim that the live application's legacy queue is repaired. `public/index.html`, `public/sw.js`, `firebase.json` and `firestore.rules` remain unchanged. The newer normalized preview must still be reconciled before integrating these changes into its application source. Do not deploy the older branch HTML over the preview.

## Behaviour implemented

1. The local harness serves the existing HTML with production Firebase initialization removed. It injects the local bridge at runtime; the source HTML is not rewritten on disk. It never serves a service worker or an operational backup.
2. The user signs in to the Auth emulator. Credentials and token remain separate from real Firebase; the emulator service startup guard and loopback-only listeners prevent a cloud destination.
3. Each save validates current authenticated membership, maintenance state and server availability before submission.
4. Capture the original form save into temporary memory while suppressing its legacy close/success/render calls. Restore acknowledged memory immediately after capture. Route one validated record mutation to the trusted command service; do not enqueue Firestore client writes.
5. Keep the form and attachments until a confirmed command outcome and server record readback. Double clicks do not submit an overlapping operation.
6. Include the expected version captured for the edit. A stale save becomes Conflict; Review latest record shows server values without replacing draft fields. Use reviewed version for retry explicitly confirms the version transition, then Save submits the retained draft as a new reviewed operation.
7. A rejected offline submission sends no command. Reconnection performs a status check only and cannot replay the draft.
8. Network loss, server timeout or unreadable response after dispatch means Checking save status. Preserve the original operation ID and immutable submitted payload in memory. Check status reconciles a committed result without another mutation; Retry same operation explicitly resubmits the identical operation only while its original payload remains available.
9. Missing outcome is not proof of rejection. New mutation submission remains blocked while the original result is uncertain.
10. Save only operation ID, store and command name to per-user sessionStorage before dispatch. Never persist draft fields, passwords or tokens. A reload/sign-out can recover the uncertain operation identity and check its outcome; if the original payload is gone, replay is blocked. If no result is ever confirmed, administrator investigation is required rather than inventing a failed outcome.
11. If the user types while a create is pending, preserve those edits. Once the submitted snapshot is acknowledged, retain the open form as an edit of that record, avoiding a second accidental create.
12. Sign-out clears current draft fields, attachments, material rows, edit snapshots, cached records and controller identity. An in-flight old-account response cannot update the new account session. Non-payload uncertain operation identity remains scoped to its original user for reconciliation.

Connection labels are server-based: Connecting, Live, Saving, Offline, Unavailable, Conflict, Checking save status and Sign in to emulator. The bar includes last confirmed save time. Neither a generic internet response nor `navigator.onLine` alone establishes Live. Status/action controls move inside the active modal so they remain usable while a failed draft is open.

## Commands deliberately unavailable

- Stock changes, issuance edits and WOs with material accounting require Phase 4's atomic ledger command and fail closed here.
- Imports, replacement, direct deletion, factory reset and unadapted settings/personnel mutations cannot fall back to legacy writes. They show an explanation and leave data unchanged.
- A new room WO needs a reviewed exact location; a new equipment WO needs a unique selected registered asset. Full stable-ID selection/history migration belongs to Phase 5. No existing records are automatically retagged/reclassified/relinked.
- Generic record schemas still require a compatibility review before importing existing datasets. Unsupported legacy metadata/version records remain blocked for reviewed migration, not silently repaired.
- Browser archival controls and large restore/reset execution remain future work; existing Phase 2 command boundaries are preserved.

## Files

| File | Responsibility |
|---|---|
| `security/client/confirmed-saves.mjs` | Save state, preflight, operation identity, timeout, unknown-result recovery and account isolation |
| `security/client/app-bridge.mjs` | Existing form adapters and local status/conflict controls; suppresses legacy queue paths |
| `scripts/phase3-local-server.mjs` | Local generated app view and same-origin proxy to the emulator-bound service |
| `scripts/seed-phase3-demo.mjs` | Synthetic local memberships/accounts and policy; refuses populated emulator |
| `security/service.mjs` | Authenticated inspect/load/status readback and per-resource single-instance contention queue |
| `tests/phase3.client.test.mjs` | State-machine and 30-case stage/error fault matrix |
| `tests/phase3.integration.test.mjs` | Actual Chromium forms, Auth/Firestore, races and acknowledgement timing |

Inspect reads use read-only transactions. Mutation commands remain version-checked atomic Firestore transactions. The local service serializes commands to the same record/operation within its instance to bound emulator contention; this does not replace transactions or prove cross-instance behaviour. Load returns all local records for this test harness; pagination remains Phase 8.

## Verification

Test suites exercise only synthetic fixtures, never private production backups.

| Verification | Result |
|---|---|
| Save controller and 30-case fault matrix | **42 passed** |
| Phase 2 schema/destination and prior recovery unit tests | **141 passed** |
| Phase 2 Auth/rules/backend integration rerun | **178 passed** |
| Phase 3 Chromium/backend scenarios | **15 passed**, zero failures/retries |
| Total distinct targeted tests | **376 passed** |
| Existing CRUD/login regression on isolated port 3017 | **35 passed in 2.0 minutes**, zero failures/retries |
| Total distinct targeted + supplemental regression tests | **411 passed** |
| Stale-edit paired requests | **100 pairs: one accepted update and one explicit conflict per pair** |
| Duplicate operation paired requests | **100 pairs: one identity/result per operation** |
| Healthy command timing sample | **100 saves, zero failures; p50 90.9 ms, p95 104.8 ms, p99 108.5 ms** |
| Additional current form-adapter check | **Passed**, including room WO and tank observations |
| Mobile/desktop visual review | Generated at 390×844 and 1440×1000; mobile screenshot inspected; no horizontal overflow in the tested dialog |
| Existing browser test discovery | **449 tests in 14 spec files**; Node emulator tests excluded from Playwright discovery |
| Synthetic demo-account setup | Passed in a fresh emulator; no production accounts provisioned |
| Dependency audit | **0 vulnerabilities** |

The 15 integration scenarios include actual emulator login, delayed-save/double-click behaviour, offline retention/reconnect, denied save with preserved attachment state, committed/lost response, conflict review and explicitly reviewed retry, typing during pending create, reload reconciliation, blocked legacy stock/import paths, sign-out, existing form adapters, mobile fit, both race loops and timing measurement. The focused form rerun repeats one of those scenarios; it is not counted as another distinct test.

Initial browser runs found an obsolete loading overlay and status controls behind the modal; both were corrected and the final run passed. Initial race checks exposed emulator transaction lock timeouts; the final run uses read-only inspection and same-resource service serialization. These are local results; multi-instance server contention, browser/WAN p95 and production outage behaviour remain unverified.

Required checks:

- Unit tests for delayed acknowledgement, no offline replay, duplicate clicks, conflict, lost/late responses, unknown-result reconciliation, identity-only reload journal and account switching.
- Thirty distinct stage/error combinations across preflight, submission and reconciliation; failed drafts remain unmodified and have no false success timestamp.
- Real Chromium save/retention checks, exact server readback, conflict review, attachment preservation, mobile fit and sign-out cleanup.
- Paired same-version requests across 100 records: exactly one update and one explicit conflict per pair.
- Repeated operation submissions across 100 operations: exactly one logical identity/outcome per operation.
- 100 healthy local command acknowledgement timings, including failure count; report p50/p95/p99. These exclude real WAN latency and browser preflight/rendering and cannot certify the production p95 target.
- Re-run Phase 2 Auth/rules tests and prior validation/recovery safety suites after service changes.

The original full browser suite is not a substitute for these emulator-backed tests. Production UI files were unchanged; those existing tests must be repeated against the reconciled source before a future deployment.

Playwright now explicitly discovers `*.spec.mjs`, leaving `*.test.mjs` to Node. An optional `HAMMS_TEST_PORT` selects an isolated local server and disables reuse. The initial supplemental CRUD/login run accidentally reused an unrelated app on port 3000; those results were discarded. That server was left untouched, and the HAMMS rerun uses port 3017.

## Run locally

Automated verification:

```powershell
node --test tests/phase3.client.test.mjs tests/phase2.validation.test.mjs tests/recovery-core.test.mjs
firebase emulators:exec --project demo-hamms-security --config firebase.security.json --only 'auth,firestore' --non-interactive "node --test tests/phase2.security.test.mjs && node --test tests/phase3.integration.test.mjs"
$env:HAMMS_TEST_PORT = '3017'
npx playwright test tests/crud-e2e.spec.mjs tests/remember-me.spec.mjs --reporter=line
```

Interactive synthetic review, with a fresh emulator in the first terminal:

```powershell
firebase emulators:start --project demo-hamms-security --config firebase.security.json --only 'auth,firestore'
```

In another PowerShell terminal in this repository:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8186'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9098'
node scripts/seed-phase3-demo.mjs
node scripts/phase3-local-server.mjs
```

Open `http://127.0.0.1:3001`. Synthetic accounts: `demo-staff@example.test` / `demo-admin@example.test`; password `Synthetic-Only-123!`. This is deliberately fake test-account information, not hospital credentials. Use `Demo room` for room-work testing. Do not use real records or credentials in this harness. If the emulator already contains collections, demo seeding refuses to replace them; restart a fresh emulator instead.

The harness is not exposed as a hosted preview and creates no paid infrastructure. Do not remove its emulator guard, deploy it, or treat its synthetic memberships as the production roster.

## Remaining rollout gates

Reconcile the newer preview source, review real user memberships and record/schema compatibility, implement Phase 4 stock commands, complete stable asset/location workflows and reviewed migrations, then integrate a production-capable backend only after the deferred cloud choice is revisited. All proposed changes to existing operational classifications, tags, links or records require the user's concrete-preview approval before execution.
