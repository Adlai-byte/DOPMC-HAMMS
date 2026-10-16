# Phase 8 — Bounded reads, protected images and modular shell

Date: 16 October 2026, Asia/Singapore. Branch: `codex/phase-8-scale-attachments`.

## Scope and retention

This is an isolated emulator candidate. The new records workspace is served at `/scoped/` by the local harness; existing editors and complete analytical dashboards remain available at `/`. No production records, tags, classifications, relationships or embedded images were migrated. No hosted site, production rules/indexes, billing or cloud staging was changed. The only future hosting target remains the `normalized` preview, which shares production Firestore and is not a test-write destination.

Bounded browsing is deliberately separate from synchronous legacy editors. A page of records is never written back as a complete store and never used as a complete history, stock ledger, forecast or dashboard denominator. The original workspace continues to load its complete dependencies for editing and analysis. Replacing its pages requires verified editing parity; this candidate does not silently remove those workflows.

The user explicitly selected **“Keep existing editors; add bounded browsing first”** during this phase. This report and implementation follow that decision; replacement of the existing editing pages is outside this checkpoint.

## Read architecture

`security/scoped-reads.mjs` provides active-account/membership checks, one read-only Firestore transaction per request and an allowlisted query contract:

- `dashboard` obtains complete total and archived counts for all 15 stores using 30 count aggregations at a consistent snapshot. Active equals total minus archived; records with no `_archived` flag remain active. It returns counts, not weighted progress, stock reconciliation or forecasts. The complete Phase 6 analyses remain in the full workspace.
- `list` returns at most 100 projected records and reads at most 100 record documents plus membership/policy documents. Embedded image/report data is excluded. It supports an exact registered status/result/condition, exact section, or a declared date range, with deterministic document-ID ordering and bounded signed cursors. An empty segment consisting of archives can still continue to later legacy records. No offset scan is used.
- Status fields follow each module's schema: asset condition, water test result and waste compliance are not queried through a nonexistent generic status. Unsupported filters fail explicitly. Monthly bills use month periods; tank filters include the entire final stored calendar day. Missing dates are not manufactured or backfilled.
- Cursors are signed, bound to account, store, filter, page size and archive mode, and expire after 15 minutes. A service restart invalidates its old cursor signatures; refresh restarts a query. Concurrent edits are visible on explicit refresh. Cursor pages are not a frozen export or globally immutable multi-page snapshot.
- `record` fetches a complete record by exact document ID only when details are opened. It preserves the existing ID and payload; viewing a record performs no operational mutation.
- Read requests fail during maintenance instead of displaying an intermediate recovery dataset as current. New query/image routes require protocol 8. Stale protocol calls fail with an explicit update requirement.

The browser uses a 12-page, 60-second in-memory LRU cache. Cached pages show their original confirmed time and an explicit refresh instruction. Apply/refresh always makes a new server request. Data is scoped to the signed-in session and cleared on sign-out; late results from prior accounts/views are rejected. No record cache or authentication token is written to the service worker or browser persistent storage. Page summaries never replace complete overview counts.

## Protected image storage

The optional Storage emulator runs on `127.0.0.1:9198` under the demo project, configured by `firebase.scale.json`. The original security emulator configuration still works without Storage; attachment operations then fail closed.

New images use protected `attachments` metadata and deterministic object IDs. Existing `imageData`, `photo`, `serviceReport` and `resultImage` fields remain untouched. Uploads allow PNG, JPEG and WebP signatures with matching declared MIME type, canonical base64 and a 2 MiB bound. SVG/HTML and mismatched signatures are rejected. This validates signatures/size, not a complete image decoder or malware scanner; the client displays verified bytes as image blobs, not executable document URLs.

An upload records pending metadata, writes its object, verifies the downloaded bytes, then atomically creates the attached state, immutable audit and operation outcome. Storage and Firestore are not one atomic transaction. A failed/interrupted transfer remains pending; it is not shown as attached. Finalization rechecks the original record version, archival state, membership and maintenance policy. A changed/archived record cannot gain a stale attachment.

The same operation ID/content is retryable. Changing a reused operation payload is rejected. A lost acknowledgement retains file selection and an identity-only session journal; reloading checks the original upload's status instead of automatically issuing a new upload. File bytes, filenames, reasons and tokens are excluded from that journal. Explicit validation rejection permits correction; unresolved requests require status/retry.

Binary content hashes are SHA-256 over canonical base64; typed document hashes remain SHA-256 over canonical path/field JSON. These are application integrity checks, not Cloud Storage MD5/CRC fields. Bundle validation uses the same declared v1 convention and verifies byte size as well.

Direct Storage reads/writes and metadata writes are denied even for administrators. Proxy reads recheck current membership and owner-record existence. There are no permanent public download tokens in this workflow. Access revocation therefore applies to subsequent requests; bytes a user already downloaded cannot be recalled.

Administrators can list up to 100 pending uploads for review. Marking one `retained-orphan` requires the exact proposed metadata hash, user verification reference and reason. Its metadata and binary remain indefinitely; no automatic physical cleanup or removal is enabled. Staff cannot revive a reviewed orphan by replaying its old upload. Attached record images and retained recovery evidence are never silently removed.

## Binary backup and recovery

`scripts/attachment-bundle.mjs` exports a complete typed snapshot with image binaries into a private directory outside the repository. The manifest covers exact metadata IDs, object paths, type, size and content hash. Every file is validated before the first staging write. Tampered, omitted or mismatched binaries reject staging. Existing differing objects cannot be overwritten.

Binary staging alone changes no operational record or metadata link. The administrator must still stage and verify a concrete recovery preview, approve its hash and run the Phase 7 job. Recovery checks the image bytes at staging, after locking/before record writes, and during final reconciliation. A disappearing/corrupt image prevents success and retains maintenance. Retained orphan binaries are included in administrator backups. Unreviewed pending transfers block a complete binary bundle until their state is resolved.

The generated full workspace now labels its old JSON download as an **active-record export** and embeds `_completeRecoveryBackup: false`. It does not claim that active in-memory rows cover retained archives, protected metadata or Storage binaries, and it does not advance a trusted backup timestamp. The recovery UI labels its JSON download as a complete **Firestore snapshot** and explicitly points out the separate binary bundle requirement.

The typed-v2 coverage list now explicitly includes attachment metadata. Earlier backup files are preserved but cannot be silently treated as complete newer coverage. Auth account recreation, IAM and arbitrary external HTTPS attachment downloads remain outside this local binary recovery drill. Real-data migration of embedded images would require a separate concrete preview and the user's verification; none was performed.

## PWA and module compatibility

The bounded workspace has independent HTML/CSS, page state, read cache, query authority, attachment authority and a generated shell release manifest. It uses plain ES modules and no framework, build step, bundler or additional third-party web origins. Its palette and typography follow HAMMS's hospital operations context, with a compact navy/teal navigation and readable paper-coloured tables.

The local service worker is scoped to `/scoped/`, so it cannot replace the existing application shell. Installation fetches every declared shell asset and verifies its SHA-256 hash before accepting the cache. Only those exact shell paths are cached. Auth/API, image bytes, backups, release metadata and failed responses are never cached. A mismatched/incomplete install is rejected. Cache pruning affects only this candidate's own prefix.

Updates wait for explicit activation. Activation clears the older candidate caches, clears the active session and reloads the new shell. Offline shell reload shows sign-in and does not replay mutations. This is a local upgrade drill; the production service worker and its cache version have not been changed because no deployment occurred. Production promotion still needs the required cache bump and full compatibility review.

An update is held while an image is selected or its upload has an unresolved operation journal. The user must finish/reconcile that operation before activating the waiting shell; file selection is preserved. A deliberately tampered module response was rejected during installation and left the previously verified active shell/cache intact.

## Verification and performance evidence

Tests cover complete counts versus page counts, all IDs across a 1,000-record fixture, missing archive flags, empty archived segments, tampered/account-switched cursors, exact schema filters and dates, disabled/revoked/anonymous accounts, maintenance, stale protocol rejection, binary bundle restoration, failed uploads, orphan review, immutable evidence, late responses, sign-out, mobile overflow, shell-only caching and explicit PWA upgrades.

The final checkpoint passed **629 distinct targeted cases**, without Playwright/Node retries. The broad regression/performance chain exited successfully. Additional focused runs verified the account, update/export and attachment-retention race safeguards added during review; each also exited successfully.

| Suite | Passed |
|---|---:|
| Recovery/schema/controller/domain units, including 10 Phase 8 cases | 302 |
| Phase 2 security | 178 |
| Phase 3 integration | 15 |
| Phase 4 stock / browser | 22 / 8 |
| Phase 5 relationships / browser | 18 / 9 |
| Phase 6 energy / browser | 14 / 9 |
| Phase 7 recovery / browser | 16 / 6 |
| Phase 8 scoped reads | 9 |
| Phase 8 attachments and binary recovery | 11 |
| Phase 8 browser/PWA | 11 |
| Phase 8 performance fixture | 1 |
| **Total distinct cases** | **629** |

The attachment race test proves that administrator retention cannot be undone by a previously started upload's finalization. Upload replay also returns its prior success after the owner record is later edited or archived. Read-side authentication now explicitly requires a nonempty account email; an anonymous Auth account is denied even if a mistaken protected membership row assigns it an active role.

The verification found and corrected an attachment-manifest edge case in which an audit `attachmentId` was mistaken for an external image link. Actual URI fields and protected object metadata receive binary coverage; opaque audit identities do not become fabricated download sources. CSS hidden-button and timestamp issues described in Phase 7 remain covered by regression tests. The mobile layout screenshot is retained under ignored `test-results/phase8/workspace-mobile.png` and was visually inspected.

The performance fixtures contain 960 and 9,600 synthetic operational records: 36 work orders, 472 assets, 89 inventory and 110 issuance records, plus 23 in each remaining store, scaled by 10 for the larger fixture. This matches approximate record-count scale, not the live per-store mix or live contents. Each asset has a synthetic 3,000-character embedded image field to exercise payload projection.

Measure 30 complete-load/server-overview samples at each size, 30 cold browser runs for each desktop/mobile profile and 30 loaded-page navigations per size/profile. Record p50/p95/p99, bytes, request count, JS heap and long tasks. Desktop is local loopback Chromium at 1440×1000. Mobile is Chromium at 390×844 with 150 ms latency, 1.6 Mbit/s download, 0.75 Mbit/s upload and 4× CPU slowdown. Cold runs clear the service worker/cache and include explicit sign-in. Loaded navigation reports cached pages separately from the first network list request; it does not disguise fresh-filter latency as an in-memory measurement.

The original complete load returns every record document, including embedded fields. The bounded overview returns zero operational record payloads, two authority documents and 30 complete count aggregation results. These are logical read/payload measurements, not Firebase billing counters: aggregation index-entry work and minimum-query charges must be measured in approved cloud staging. Do not convert the emulator document count into an unsupported currency or billing-reduction claim.

Initial investigation measured mobile fresh-list p95 above the proposed 300 ms loaded-navigation budget. The explicit snapshot cache addresses repeated loaded-page navigation; first fetches and new server filters retain their network cost and must be reported separately. No correctness or historical coverage is traded for the timing target.

### Measured local candidate

The updated run completed 120 cold browser samples (30 per size/profile), 120 loaded navigation samples and 60 paired server baseline/overview samples. The earlier investigation is retained separately under ignored `test-results/phase8/performance-before-cache.json`; updated evidence is `test-results/phase8/performance.json`.

| Metric | 960 records | 9,600 records |
|---|---:|---:|
| Complete-load response | 1,656,610 bytes | 16,572,181 bytes |
| Scoped overview response | 1,100 bytes | 1,130 bytes |
| Overview payload reduction | 99.934% | 99.993% |
| Complete-load operational documents returned | 960 | 9,600 |
| Scoped overview operational documents returned | 0 | 0 |
| Scoped authority documents / count queries | 2 / 30 | 2 / 30 |
| Desktop cold-start p95 | 1.106 s | 1.204 s |
| Throttled mobile cold-start p95 | 2.974 s | 3.202 s |
| Desktop loaded navigation p95 | 10.9 ms | 10.9 ms |
| Mobile loaded navigation p95 | 85.7 ms | 106.4 ms |
| First desktop list fetch, one observation | 69.5 ms | 87.7 ms |
| First mobile list fetch, one observation | 353.5 ms | 329.7 ms |
| Desktop / mobile cold JS heap p95 | 2.286 / 2.292 MB | 2.286 / 2.292 MB |
| Observed long tasks over 200 ms, desktop / mobile | 0 / 0 | 0 / 0 |

The cold-start and loaded-navigation budgets passed for this candidate and these profiles. The single first-fetch observations are not p95 estimates, and fresh mobile filters/fetches are not claimed to meet 300 ms. The initial mobile fresh-navigation investigation observed about 430 ms p95 before introducing the labelled memory cache.

The small-size server-side count aggregation p95 was **487 ms**, versus **309 ms** for the complete in-emulator load, despite the much smaller response. At 10× it was **753 ms**, versus **926 ms** for the complete load. Aggregating 30 queries has overhead; payload reduction does not prove every server request is faster or cheaper. These counts need cloud index-entry/latency/cost measurement before rollout. p50/p99, heap, request and byte samples are retained in the generated evidence.

## Run locally

Use `firebase emulators:exec --project demo-hamms-security --config firebase.scale.json --only 'auth,firestore,storage'` to run Node emulator suites. With those same emulator environment variables, run `scripts/seed-phase3-demo.mjs`, then `scripts/phase3-local-server.mjs` and open `http://127.0.0.1:3001/scoped/`. The account and dataset must be synthetic. `/` retains the full editing workspace. Port 3000 belongs to an unrelated local application and must not be stopped.

For private bundle tooling, supply a loopback command-service URL and `HAMMS_EMULATOR_ADMIN_TOKEN` in the environment; never put the token in a file or command output. Run `node scripts/attachment-bundle.mjs export|validate|stage http://127.0.0.1:PORT/ PRIVATE_DIRECTORY`. Export/stage accepts only the isolated demo format. Staging returns an instruction to obtain verification of the subsequent recovery preview, not permission to apply it.

## Remaining rollout work

The existing editor/analysis workspace still uses complete dependency loads and synchronous legacy form adapters. The bounded workspace does not replace those editors or pretend paginated data is complete. Future integration should migrate one editor/dependency query at a time and retain the confirmed-save, stock and relationship gates.

The emulator does not enforce deployed composite-index readiness as cloud Firestore does. The image listing index is declared separately; cloud index/rules/backend readiness, costs, binary retention storage, production memberships, real-data migration previews, scheduled recovery and billing remain pending. No cloud resources were enabled. Phase 9 rollout requires these explicit release gates and the user's existing preview-only/data-verification constraints.
