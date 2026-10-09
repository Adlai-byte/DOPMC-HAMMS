# HAMMS code review and fix plan

Reviewed: 2026-10-09 (Asia/Singapore)  
Source: `01ebeb8ac8c819f7358073f4ff0241062cc604e1` on `main`

The main release risks are executable imported content, unstable record identities, lost queued writes, and incorrect stock accounting. Fix those before expanding functionality or reorganizing the application.

This review covers authentication, Firestore rules, record normalization, sync and listeners, CRUD and stock workflows, import/export, date calculations, water-handler overrides, PWA configuration, test setup, and deployment workflows. At the time of the initial review, application code was not modified. Browser probes used the existing CRUD test bootstrap, synthetic records, blocked external requests, and disabled Firebase writes. Rules findings are based on the repository rules; they have not been exercised against production data or a rules emulator.

**Priority:** P1 = address before the next normal production release; P2 = address in the following reliability work. Reproduced findings below include observed local outcomes. Static findings identify the code path and its consequences without claiming a production incident.

## Findings

### R1 — P1: Imported status/severity values execute as HTML

References: `public/index.html:6298`, `6299`, `6411`, `6504`, `7080`, `6764`.

`sevBadge`, `ssBadge`, `pjBadge`, `wsBadge`, and `effluentBadge` interpolate input directly into HTML. Importers accept arbitrary enum strings. Other raw interpolations, including project category at line 6477, require the same treatment.

**Reproduced:** importing a synthetic safety CSV whose Severity contained an image error handler executed a harmless JavaScript marker during rendering. The CSV entered through `importSafetyCSV`, not a direct DOM injection. The configured CSP allows inline scripts and therefore is not a substitute for escaping these values.

**Fix:** escape all displayed strings, validate enums and numeric types at import/save boundaries, and audit remaining template interpolation by context. Use DOM text APIs where practical. Test malicious CSV, JSON, and synthetic remote records across all renderers; do not limit the fix to the reproduced badge.

### R2 — P1: Editing replaces Firestore document identity

References: `public/index.html:3101`, `3244`, `3477`, `4830`, `4708`, `6000`, `7734`; `firestore.rules:42`.

Several save functions rebuild a record object without `_docId`. `ensureStoreRecordIdentity` assigns a new document ID, and `queueStoreSync` interprets this as deleting the original document and creating another. Version stamping matches numeric IDs but does not restore the document identity.

**Reproduced:** editing inventory record `original-doc` generated an `inventory_<uuid>` upsert plus a delete of `original-doc`, even though this was an ordinary quantity edit.

**Impact:** cross-user edits can fail because the original delete is restricted to its last writer. Same-user edits unnecessarily replace document keys. Competing edits can target different documents instead of updating the same record, undermining conflict detection and relationships.

**Fix:** centralize upsert construction; retain the existing `_docId` and immutable identity on every edit before diffing or stamping. Generate identities only for genuinely new records. Handle singleton `waterSettings` and date-keyed census records explicitly. Add one behavioral identity test for every editing path.

### R3 — P1: Sync acknowledgements lose operations

References: `public/index.html:3577`, `3613`, `3635`, `3662`.

Partial-batch cleanup deletes an entire store queue if any operation for that store committed. Successful cleanup also deletes the entire queue, including changes enqueued after the commit payload was captured. Metadata is cleared with the same coarse approach. The ten-second timeout releases the write lock while the original commit may still be running, allowing overlapping flushes.

**Reproduced:** a 451-record save committed 450 records, failed the final record, then retained zero pending writes. A second probe enqueued another edit during commit; it also disappeared from the queue without being committed.

**Fix:** immutable operation snapshots with operation/generation IDs; acknowledge only the exact operations committed. Preserve newer versions of the same record and metadata field. Keep one flush owner until its promise settles; a timeout should report an uncertain save state, not grant a second writer ownership. Retain actionable errors after retry exhaustion.

### R4 — P1: Conflict checks and related writes are not atomic

References: `public/index.html:3907`, `3620`, `4708`, `4859`, `9879`; `firestore.rules:26`, `39`.

Client conflict checks only compare in-memory versions. Rules permit equal versions and permit `_v` to be omitted. Two clients can read the same inventory quantity and each write an absolute replacement while recording separate issuances. Batching writes does not perform a read-version check. The final `openTankModal` override also omits `captureEditSnapshot`, leaving its later conflict check without a freshly captured base version.

**Evidence:** static tracing of read, validation, and commit paths. A real concurrent Firestore test remains required.

**Fix:** use transactions for work-order/material/issuance changes and other shared read-modify-write operations. Compare the version captured when editing with the server version; do not silently retry a stale draft over another user's changes. Enforce required versions and valid transitions in rules, including deletes and legacy migration. Keep each logical stock operation atomic rather than splitting it arbitrarily into global queue chunks.

### R5 — P1: Material validation permits invalid stock changes

References: `public/index.html:4708`, `4718`, `4727`.

Each material row is checked against the original stock independently. Quantities are not required to be positive finite values. Existing allocations are restored only after validation, so editing an existing work order can fail even when its material usage is unchanged.

**Reproduced:** two rows requesting six units each from stock of ten saved successfully and left stock at minus two. A negative quantity increased stock from ten to twelve. An unchanged work order that previously consumed the last two units could not save a remarks-only edit.

**Fix:** aggregate by inventory identity, validate finite positive quantities, and calculate the delta against the old allocation before checking availability. Apply the same invariants inside the transaction, not just in the browser form.

### R6 — P1: Work-order edits duplicate auto-issuance records

References: `public/index.html:4733`, `4745`, `4782`.

New issuance records use the work order's generated code as `woRef`, but edit cleanup only matches `WO-<numeric id>`. Delete cleanup understands both forms; edit cleanup does not.

**Reproduced:** saving a remarks-only edit increased auto-issuance records from one to two for the same code and quantity, while inventory remained at the original deducted quantity. Issuance reports therefore overstate usage.

**Fix:** link issuances to an immutable work-order document ID. During migration, recognize both legacy references. Update only actual allocation changes and make repeated saves idempotent. Generate a read-only duplicate report before proposing corrections to existing records.

### R7 — P1: Restore accepts invalid backups and reports success too early

References: `public/index.html:5402`, `5414`, `3771`; related reset path: `11513`.

`applyParsed` accepts any object and treats missing store arrays as empty. It preserves backup writer/version metadata instead of stamping changes against current records. `await flushAll()` only schedules the actual sync; it does not await persistence, yet restore announces success.

**Reproduced:** applying `{}` emptied a seeded assets store and queued its record for deletion. The earlier controlled restore probe also confirmed preservation of another user's `_updatedBy` and old `_v`.

**Impact:** unrelated or incomplete JSON can become a destructive replacement after the generic confirmation. Other-user or older backups can fail the rules. Large replacements can be partially committed. Factory reset independently chunks deletes and clears local memory before cloud completion; mixed-writer records can cause a partial reset under current rules.

**Fix:** require a recognized backup schema/version; validate all records and stores before mutation; distinguish partial merge from full replacement; preview counts of additions, updates, and deletions. Build an explicit restore operation with current identities, fresh stamps, reliable completion reporting, and resumable progress for large jobs. Restrict restore/reset to the approved administrative policy and prevent competing writes during destructive maintenance.

### R8 — P1: Calendar arithmetic shifts Philippine dates backward

References: `public/index.html:3991`, `3992`, `4010`, `5695`, `5722`; tests: `tests/unit-functions.spec.mjs:195`.

`today()` uses UTC, while `addDays` and week-start logic construct local midnight then convert it to a UTC date. This affects default dates, census, forecasts, reporting intervals, and preventive maintenance dates.

**Reproduced in Asia/Manila:** at 01:00 on October 9, `today()` returned October 8. Adding zero days to October 9 returned October 8; adding one returned October 9. The week start for Friday October 9 returned Sunday October 4 instead of Monday October 5.

**Fix:** distinguish date-only arithmetic from timestamp formatting. Use a consistent local calendar for hospital dates and local date components for display. Replace duplicate PMS calculations with the shared helper. Test midnight, month/year changes, leap days, and `addDays(date, 0) === date`. Existing tests duplicate the UTC conversion and therefore encode the defect.

### R9 — P1: Delete ownership is bypassable; administrative policy is absent

References: `firestore.rules:6`, `30`, `42`; `public/index.html:11513`.

Any named user may update a record and set `_updatedBy` to their own email. That same user then satisfies the delete rule. Consequently `_updatedBy` is not a meaningful authorization boundary. Factory reset checks the current user's password but does not check an administrator role. Store read access also has no staff-membership or role restriction beyond an email-bearing account.

**Evidence:** direct rule evaluation by inspection; no outsider account creation or destructive cloud operation was attempted. Whether project-level account provisioning limits who can obtain an account was not established by this review.

**Fix:** define approved staff and administrator permissions, enforce them in rules using trusted membership/claims, and treat `_updatedBy` as audit metadata. Define whether ordinary staff can delete shared records. Provision and verify actual administrators before activating restrictive rules. Rules-emulator tests must cover permitted editing, forbidden privilege changes, deletion, restore/reset, and unauthenticated access.

### R10 — P2: Session and snapshot handling preserve invalid state

References: `public/index.html:108`, `3386`, `3419`, `3730`.

Sign-out hides the app but leaves actor metadata, cached records, listeners, and pending work intact. A pending deletion is also reintroduced by `mergeListenerSnapshot`: its final server-record loop does not exclude pending delete IDs. Manual reload does not reject all pending-queue states before replacing memory.

**Reproduced:** after invoking the actual signed-out callback, email, UID, one record, and one pending operation remained, and the listener unsubscribe was not called. A server snapshot reintroduced a record with an outstanding local deletion.

**Fix:** scope work to an authentication-session generation, detach listeners and invalidate old callbacks on account changes, and resolve unsaved edits before clearing the session. Filter pending deletes in all merge paths. Prevent reload from overwriting uncommitted intent. Exercise logout/login, token loss, snapshots during commit, and remote deletion while a modal is open.

### R11 — P2: Connectivity UI contradicts the write behavior

References: `public/index.html:3565`, `3789`, `3799`; `firebase.json:54`.

The heartbeat fetches `www.gstatic.com`, which is missing from `connect-src`. A successful generic network probe would also not prove that Firestore writes are authorized or committed. The offline banner says changes are discarded, while code retains an in-memory retry queue. Per-store read failures can be swallowed and followed by a global Live state.

**Reproduced with the configured CSP:** the heartbeat raised a `connect-src` violation and changed Live to Offline on a locally reachable page.

**Fix:** derive save status from authenticated Firestore results and snapshot metadata, and represent pending, failed, and confirmed saves separately. Remove or replace the unrelated heartbeat. Follow the documented online-only write policy unless that product decision changes; block submission without confirmed connectivity while preserving the user's form input. Test real offline transitions and permission failures separately.

### R12 — P2: Numeric IDs and displayed codes are not globally unique

References: `public/index.html:3093`, `3113`, `5516`.

Numeric IDs are based on local time plus a local counter, so two devices can generate the same ID. Normalization silently renumbers duplicate IDs without remapping references such as `invId` or `linkedAssetId`. Displayed codes use count plus one and can duplicate after deletion or concurrent creation.

**Reproduced:** two simulated fresh devices at the same millisecond generated the same numeric ID. Existing codes `ELEC-MD-0001` and `ELEC-MD-0003` produced another `ELEC-MD-0003`.

**Fix:** use stable document IDs for relationships. Preserve legacy numeric IDs as compatibility/display fields while migrating references with an explicit mapping. Allocate readable sequences transactionally if strict sequencing is required; otherwise define a collision-resistant code format. Never silently repair referenced identifiers during reads.

### R13 — P2: Project import/export uses a different schema from the UI

References: `public/index.html:6445`, `6998`, `8259`.

The UI saves `fundingSource`, `targetDate`, `actualDate`, and `remarks`; CSV import/export uses `funding`, `targetCompletion`, `actualCompletion`, and `issues`. Imported records therefore do not fully populate the edit form, and ordinary UI records lose fields on export.

**Reproduced:** exporting a synthetic UI-format project omitted all four populated values.

**Fix:** choose canonical fields, normalize legacy aliases once, and share mappings among save, import, export, filters, and rendering. Verify a UI-save/export/import/edit round trip. Extend round-trip checks to the remaining modules and quoted multiline CSV fields.

### R14 — P2: Tests and deployment do not reliably guard these behaviors

References: `tests/crud-e2e.spec.mjs:4`, `tests/regression-bugfixes.spec.mjs:4`, `tests/unit-functions.spec.mjs:195`, `.github/workflows/firebase-hosting-merge.yml:12`, `.github/workflows/firebase-hosting-pull-request.yml:14`.

Bootstrap hides login after navigation but does not consistently isolate the asynchronous Firebase module/auth callback; some specs omit the Firebase stub entirely. Several sync tests assert source-code substrings rather than commit outcomes. Date tests reproduce the same flawed conversion as the implementation. Hosting workflows run no tests and contain no explicit rules-deployment step.

**Reproduced:** the previously failing safety filter returned the correct single row when external Firebase initialization was isolated using the existing bootstrap. This supports an auth/bootstrap race for that failure rather than a confirmed filter defect.

**Fix:** extract and strengthen the existing bootstrap, isolate Firebase before application startup, await cache/service-worker cleanup, and use explicit timezone fixtures. Add deterministic sync tests and rules-emulator tests. Make CI test before hosting deployment, separate live-site smoke tests from local tests, and coordinate rules releases with compatible clients.

## Implementation plan

| Phase | Deliverables | Completion criteria |
|---|---|---|
| 1. Establish reliable tests and close HTML injection | Reuse the existing bootstrap in a shared helper; deterministic Firebase isolation; malicious-input regressions; escape/validate all untrusted render values. | Safety filter passes repeatedly without retry; injected CSV/JSON/remote strings render as text; ordinary labels and statuses remain correct. |
| 2. Stabilize record identity and sync | Preserve `_docId`; versioned operation acknowledgements; one flush owner; delete-aware merges; explicit commit-result promises; guarded refresh and session lifecycle. | Every edit retains its document key; 451+ operations survive a middle-batch failure; new edits survive an in-flight commit; deletes do not reappear; account changes cannot reuse old queued work. |
| 3. Make stock workflows atomic | Transactional work-order/inventory/issuance commands; aggregate and validate quantities; compute edit deltas; immutable work-order links; idempotent issuance updates; server-enforced version checks. | Two competing issuances cannot overspend stock; remarks-only edits change neither stock nor issuance totals; zero-stock edits with unchanged materials succeed; stale drafts receive a conflict response. |
| 4. Correct dates, references, and module schemas | Local calendar helpers; PMS consolidation; durable relationship keys; code allocation; canonical project fields and CSV mappings. | Philippine midnight and calendar-boundary tests pass; zero-day addition is an identity; codes remain unique; project round trips preserve all fields; migrated references resolve. |
| 5. Secure and rebuild maintenance operations | Agreed staff/admin rules; approved administrator provisioning; validated backup format; restore preview; version-aware restoration; protected, resumable large restore/reset operations. | Rules-emulator role matrix passes; invalid/incomplete JSON is rejected before mutation; different-writer backups restore under the approved policy; success appears only after acknowledgement; partial failures are visible and recoverable. |
| 6. Release and maintain | Full local suite; emulator suite; CSP and PWA update checks; CI test gate; coordinated application/rules release; service-worker cache bump; updated architecture and offline documentation. | All deterministic tests pass without retries; new and returning-browser smoke tests pass; release artifacts identify compatible client/rules versions and a verified rollback path. |

**Dependencies:** identity and queue work precede stock transactions and backup restoration. Role requirements can be designed alongside earlier phases, but restrictive rules must wait until approved administrator accounts are provisioned and clients are compatible. New store names, if introduced for sequences or migration control, require explicit rules and architecture updates.

**Product assumptions:** use the repository's documented online-only save policy; permit routine collaboration among approved staff; reserve full replacement restore and factory reset for approved administrators. Exact staff delete permissions and administrator identities must be established before the access-control rollout. No framework migration is needed to deliver these fixes.

## Existing-data checks before migration

Run read-only reports against an authorized backup or staging copy for duplicate numeric IDs/document identities, duplicate readable codes, duplicate auto-issuances, stock/issuance discrepancies, missing writer/version metadata, and mixed project-field aliases. Preserve a mapping and audit record for each proposed repair. Do not infer actual stock usage solely by summing potentially duplicated issuance records. Review the proposed data corrections before applying them.

## Release approach

Implement focused changes on a branch; note that pushing `main` currently triggers live hosting deployment. Test with synthetic data and a staging/emulator environment, then inspect the existing-data report. Coordinate application and rule compatibility, including already-open tabs, rather than deploying stricter rules independently of the fixed client. Bump `public/sw.js` from `hamms-v2-10-20` for the release and verify that a returning browser obtains the new shell. Verify backup recovery and rollback before any migration.

## Verification record

Seventeen controlled local probes were run: record identity, duplicate material rows, negative quantities, duplicate issuance on edit, unchanged allocation at zero stock, pending-delete merge, CSV-triggered script execution, isolated safety filtering, malformed backup replacement, partial commit failure, edits during commit, cross-device numeric-ID collision, code generation after deletion, Philippine calendar behavior, sign-out cleanup, CSP heartbeat behavior, and project CSV export.

The safety-filter isolation probe passed; the other probes demonstrated the behaviors recorded above. Mocked commit tests establish queue behavior, not Firestore server authorization. Production records were not read or modified for this review. No performance benchmark or clinical/regulatory validation of operational formulas was performed.

Full local suite result: **420 tests; 414 passed on the first attempt, 6 passed on retry, 0 persistent failures, 0 skipped**. Runtime was approximately 8 minutes 51 seconds using six workers. The six initial failures were 30-second timeouts in duplicate-DOM-ID, low-stock-chip, energy-baseline, energy-KPI, ICU-location, and medwaste-navigation checks; they are not established application defects from this run. Live-deployed tests were excluded using `--grep-invert "Live Check"`.

The prior safety-filter failure did not recur in this full run and passed in the Firebase-isolated probe. The passing suite does not invalidate the independently reproduced defects: the current tests do not exercise those specific persistence/security/calendar/round-trip behaviors. The full JSON report is stored locally at `C:/Users/THEJORJ/AppData/Local/Temp/hamms-full-review-tests.json`.

## Supporting design references

- Firebase [transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions): transactions handle read-dependent writes; callbacks may rerun, so user-visible effects and mutable UI state must remain outside them. Rules can validate related writes with `getAfter()`.
- Firebase [custom claims and security rules](https://firebase.google.com/docs/auth/admin/custom-claims): trusted claims can implement role-based authorization; they must be provisioned from a privileged environment rather than client-editable fields.

## Follow-up maintenance

After the correctness work, consolidate layered water-function overrides, centralize record schemas and CSV mappings, reduce broad rerendering, and measure startup/read costs with representative data. Preserve the current vanilla-JavaScript/no-build deployment unless a separate architectural change is requested. Refresh `CLAUDE.md` and `AGENTS.md` where their store counts, line maps, SDK version, and offline behavior no longer match the implementation.

## Implementation follow-up — 2026-10-09

Changes are on `codex/reliability-fixes`, not deployed. The user selected shared staff editing/deletion, administrator-only restore/reset, and online saves that preserve unsaved form input.

Implemented stable document identity, per-operation queue acknowledgement, version-checked transactions, atomic stock operations, aggregated material validation, work-order issuance cleanup, badge escaping and numeric boundary validation, local calendar dates, canonical project CSV fields, session fencing, actionable retry/discard, and isolated test setup. Rules require exact version increments and writer identity, allow shared staff deletion, and restrict reset/restore metadata to administrator claims. CI now gates hosting on browser and emulator tests and deploys matching rules/indexes.

Operational limits: replacement/reset uses a single transaction and rejects more than 449 combined existing/imported records before mutation. Large migrations require a separate reviewed administrator procedure. Existing ambiguous numeric IDs are rejected for repair rather than silently rewritten. Administrators must have the custom claim `admin: true`; no production claims or records were changed. Because staff can legitimately edit/delete individual shared records, the rules cannot infer and prohibit an equivalent series of staff actions; the administrator restriction applies to the explicit restore/reset workflow and its protected markers.

Validation completed locally:

- Full Playwright suite: **440 passed**, zero failures, skips, or retries (132.1 seconds; two workers).
- Final targeted sync/session suite, including the added late legacy-read regression: **12 passed** (16.0 seconds). Eleven overlap the full run; one was added afterward.
- Firestore emulator: **5 passed**, covering shared deletion, identity/version rules, legacy version migration, and administrator-only metadata.
- npm audit: **0 vulnerabilities**. The Node Firebase dependency uses a gRPC 1.14.6 override; emulator tests passed with it installed.
- Inline JavaScript syntax and git diff --check passed.

The earlier four-worker run had one room-view timeout; that test passed alone, and the final two-worker full run was clean. Browser sync failure tests use a deterministic Firebase mock; rules tests use the local emulator. No production writes, deployment, GitHub push, or administrator provisioning were performed. GitHub Actions configuration is prepared but has not run remotely.

## Production release — 2026-10-09

At the user's request, application commit 4b5437357ee7baca52b9f72b44819cb657107907 was pushed to origin/codex/reliability-fixes and deployed to Firebase project demoapp-7864a (hosting, Firestore rules, and indexes). Live URL: https://demoapp-7864a.web.app. The main branch was not merged.

Deployment completed successfully. The live index.html and sw.js both returned HTTP 200 and matched the committed files by SHA-256. All five live browser smoke tests passed (37.3 seconds). Live verification blocks service-worker registration to avoid test cleanup races, and fetches the deployed service-worker file directly to verify cache version hamms-v2-10-21. Synthetic UI test records stayed in browser memory with Firebase writes disabled. Administrator claims were not provisioned.
