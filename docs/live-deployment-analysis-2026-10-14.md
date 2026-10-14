# Live deployment analysis — 14 October 2026

Target: https://demoapp-7864a.web.app

## Verified release

- Live `index.html`, `sw.js`, and `manifest.json` exactly match the current checkout.
- Service-worker cache: `hamms-v2-10-24`.
- Checkout commit: `3e5944c` (remember-me authentication change).
- Live HTML SHA-256: `535f2ffc18f48deee58e13f2c29d41974718222a25897c03569a77e1203f20c8`.
- Deployed Firestore rules were read using the Firebase Rules API and match `firestore.rules`. Ruleset creation: `2026-10-13T08:06:00.010607Z`.
- The earlier conversation reported v2.11.2. That version is not currently served. This establishes a release discrepancy; it does not establish who replaced it or why.
- Live `createAssetWorkOrder` and `workOrderLinkIssues` are undefined. The current source has no `assetDocId` relationship implementation.

## Production data snapshot

Read-only authenticated, paginated Firestore REST reads:

| Store | Records |
|---|---:|
| assets | 472 |
| wo | 36 |
| inventory | 89 |
| issuance | 110 |
| waste | 0 |
| safety | 6 |
| projects | 30 |
| waterLogs | 16 |
| waterTank | 65 |
| effluent | 1 |
| medWasteProd | 3 |
| wwProd | 1 |
| censusLog | 124 |
| waterSettings | 1 |
| energyBills | 6 |

Work orders: 33 Closed, 2 Open, 1 In Progress. All 36 lack `assetDocId`; absence alone does not mean every work order needs an asset because facility/room work is valid. No duplicate energy billing periods were found in this snapshot.

## Findings and impact

| Priority | Finding | Evidence and impact | Recommended correction |
|---|---|---|---|
| P1 | Previously reported safeguards are absent from the current release | Current hosting files and rules match v2.10.24, with later asset workflow helpers absent. Prior verification cannot certify this release. | Recover and compare the intended release, preserve current authentication work, and validate the combined result before deploying. |
| P1 | Administrator-only destructive operations are not enforced | Rules permit any Firebase-authenticated user with an email to delete records, delete legacy data, and write metadata. Reset checks the signed-in user's password but checks no admin role. Ordinary collaborative deletion is intended; full replacement/reset needs stronger authorization. | Enforce active staff membership, admin-only restore/reset privileges and controlled destructive workflows server-side. |
| P1 | Version checks do not prevent competing edits reliably | Rules accept equal versions (`incoming._v >= existing._v`) and allow missing versions. Sync uses write batches rather than transactions with remote version comparisons. Two stale clients can both submit the same next version. | Require version metadata and exact increments, plus transaction comparisons against the version actually read by the editor. |
| P1 | Sync retry can drop operations after a partial chunk failure | `syncToFirebase` collects committed store names, then deletes all pending operations for those stores after a later batch fails. A store spanning multiple chunks can have failed operations cleared as well. The 10-second lock timer can release while the original commit remains outstanding. | Track acknowledgements by operation identity, retain every unacknowledged operation, and prevent overlapping flushes. |
| P1 | Saves do not follow the agreed online-only policy | `DB.s` changes memory and queues writes without an online guard. `saveWO` closes the form and announces saved before cloud acknowledgement; `syncToFirebase` retains pending operations and retries when offline. This differs from the user's requirement to reject offline saves and preserve the unsaved form for deliberate retry. | Require verified Firestore availability and acknowledgement before announcing success; retain the form on failure and avoid implicit offline replay. |
| P1 | Work-order/stock changes can be partially applied | Related work-order, inventory and issuance writes share a generic chunked queue; there is no guaranteed logical transaction boundary across chunks or concurrent clients. | Commit a validated operation atomically, with stock/version preconditions. |
| P1 | Editing a work order duplicates its automatic issuance | `saveWO` removes old issuances by numeric `WO-{id}` but creates them using the work-order code. An isolated live-code probe editing `AUDIT-WO` with unchanged materials produced two automatic issuance rows with the same reference while stock remained 8. Consumption reports therefore overcount even when current stock is unchanged. | Use stable `woDocId` links and reconcile legacy code/numeric references when replacing automatic issuances, within the same stock transaction. |
| P2 | Room matching is too broad | Live `isSameLocation('DIETARY RSA','DIETARY')` and the same comparison against `DIETARY KITCHEN` both return true. | Introduce stable location identities; immediately restrict qualified-room comparisons and add regression cases. |
| P2 | Repair history relies on names and fuzzy locations | `saveWO` stores an asset name, not `assetDocId`; `viewHistory` uses names, aliases, optional numeric IDs and fuzzy location matching. Similar equipment can inherit or lose history. | Persist a stable asset document reference for equipment work, distinguish room work explicitly, and review ambiguous legacy links. |
| P2 | Energy zero values are replaced by defaults | Live probes with a 100 W LED asset produced 24 kWh/month for quantity 0, approximately 36 kWh for hours 0, and 24 kWh for demand factor 0. | Distinguish missing values from explicit zero in calculation, editing and imports. |
| P2 | Carbon/baseline settings are browser-specific | `getEnergySettings` / `saveEnergySettings` use localStorage. Reporting uses the current factor, without a protected per-bill factor snapshot in this release. | Use shared admin-controlled settings and versioned, effective-date factors captured on each bill. |
| P2 | Connection labels are misleading | `firebase-unavailable` maps to “Offline.” A gstatic HEAD probe can set the chip to Live without establishing Firestore access; prior successful snapshots can also keep Live displayed. | Separate internet availability, authentication, Firestore access and acknowledged save state. |
| P2 | Completion forecasts can overstate confidence | No-history work-order probe displays “No data” and “On Track.” A zero-day average is treated as falsy when computing projected completion. | Display insufficient history explicitly and accept zero-day averages as valid. |
| P2 | Invalid dates enter completion averages | `PLBG-HI-0001` has completion before start. Current forecast filters require dates but do not exclude reversed dates. | Validate new entries and exclude invalid legacy durations pending review. |
| P2 | Replacement backup import lacks staging/atomic recovery | `applyParsed` treats omitted stores as empty, mutates memory, and queues replacement writes before cloud completion. Large replacements are chunked and can partially complete. | Validate/stage a complete backup, take a recoverable snapshot, and use a resumable admin migration with progress and reconciliation. |
| P2 | Hard deletion has no protected application audit/recovery trail | Client deletion removes records, with no immutable audit event or archive workflow in the inspected design. Managed cloud backups were not inspected. | Add audited archival and a tested recovery process. |
| P3 | Startup and reporting load full collections | The browser maintains all operational collections and real-time listeners; the HTML response is 927,832 bytes. Growth increases transfer, reads and browser work. | Introduce date/scoped queries, pagination, incremental summaries and modular code. |

### Existing behaviour explained

- Three work-order forecast rows are correct: only three records are Open/In Progress; all three were rendered and are overdue. Closed records contribute to averages rather than forecast rows.
- Waste forecast has no source entries because `waste` contains zero records. The three medical-waste processing records are a separate store and cannot safely be counted as category-level waste generation. The origin/disappearance of the earlier screenshot entries remains unverified.
- DIETARY RSA has two registered lighting assets. Registration by itself does not create a repair work order or historical repair entry. The release also lacks the later create-work-order/history workflow safeguards.

## Verification and limits

- Public live login rendered with no browser page errors.
- Security/cache headers were inspected: HTML and service worker use `no-cache`; HTML has CSP, and responses include HSTS and `nosniff`.
- All 16 operational pages rendered without synchronous exceptions using actual read-only data copied into an isolated browser session with Firebase API requests blocked and writes disabled. This verifies rendering, not authenticated end-to-end cloud saves.
- Dedicated live probes reproduced location matching, zero-value calculations, misleading unavailable status, and no-history forecast confidence.
- A synthetic work-order edit, with Firebase writes disabled, reproduced duplicate automatic issuances; production issuance records were not changed.
- Regression suite: `npx playwright test --reporter=line` completed in 11.1 minutes; **448 passed, 1 flaky (passed on retry), 0 final failures**, covering 449 tests. The flaky test concerns Enter-key focus/submission in the remember-me login flow (`tests/remember-me.spec.mjs:172`). These tests exercise the matching local release and include the existing live-deployment spec; they do not validate production writes or cover every finding above.
- No production operational records were edited, deleted or created. No deployment was performed.
- Account provisioning, Cloud backup/PITR configuration, real user authentication and production write acknowledgements were not validated.

## Fix sequence

1. Reconcile the release discrepancy and recover the intended source before adding more changes.
2. Enforce destructive-operation roles and reliable version/stock transactions; repair pending-operation acknowledgement and retry semantics.
3. Repair stable asset/location links, preserve explicit room work, and review ambiguous existing records without inventing history.
4. Correct energy zero handling, shared factor snapshots, forecast confidence/date validation and sync labels.
5. Add staged recovery, audit/archive support and backup reconciliation; then improve query scope, pagination and attachments.

Assessment: **5/10 for production reliability and data integrity**. The broad operational interface works, but current authorization, concurrency, recovery and identity weaknesses materially limit confidence in multi-user use. This is a qualitative engineering assessment, not a certification.
