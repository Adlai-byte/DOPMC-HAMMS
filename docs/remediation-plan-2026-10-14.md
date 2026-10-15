# HAMMS remediation plan and verification scorecard

Prepared: 14 October 2026, Asia/Singapore. Target: `demoapp-7864a`.

This is an implementation plan, not a claim that any fix or migration has already happened. Findings come from [the live deployment analysis](live-deployment-analysis-2026-10-14.md). Performance, recovery and reliability numbers below are proposed acceptance targets; they have not yet been measured or achieved.

Implementation checkpoints: [Phase 1 local recovery](phase-1-recovery-foundation.md) is verified within the user-accepted emulator scope. [Phase 2 access and validation](phase-2-access-validation.md) has a tested emulator-only rules/service foundation (319 targeted tests passed, 15 October 2026). Neither checkpoint means security changes were deployed; staff provisioning, compatibility review, Phase 3 browser integration and later phase gates remain prerequisites for rollout.

[Phase 3 confirmed saves](phase-3-confirmed-saves.md) adds a local generated browser view and emulator command integration (16 October 2026): 376 distinct targeted tests plus 35 existing CRUD/login regression tests passed, including 100 paired conflict races and 100 duplicate-operation races. This does not modify the preview or main application; newer preview source reconciliation, stock commands and production-capable backend integration remain rollout gates.

## 1. Decisions and baseline

### Confirmed decisions

1. Recover the earlier fixes and merge them into the current release, preserving newer legitimate changes such as remember-me authentication.
2. Staff may create, edit and delete shared operational records. Implement deletion as archival so records remain recoverable indefinitely until an administrator explicitly approves permanent removal.
3. Full backup replacement and factory reset are administrator-only operations.
4. Saving requires an online Firebase connection. Preserve unsaved form input on failure; reconnection alone must not replay a failed offline save.
5. Trusted Firebase backend functions may be added for privileged operations, audit events and migrations. Include infrastructure and operating costs.
6. Keep facility-wide energy bills aggregated by month. Administrators control carbon factors and baseline settings.
7. Safety Resolved/Verified/Closed states are inactive. Project progress is budget-weighted where eligible budgets exist; disclose exclusions. Budget at risk means the budget of delayed or overdue unfinished projects.
8. June 2026 energy consumption stays unchanged pending original bill/meter-multiplier verification. The previously confirmed `ELEC-HI-0011` asset selection is `OT-ELEC-RAMP-01`; verify that identification remains unique before applying a migration.
9. Prioritize permissions, confirmed saves, stock accuracy and correct asset history before performance improvements.
10. Record each inventory receipt and adjustment as a stock movement with a reason. Quantity on hand is a derived/maintained balance, not a field staff may directly overwrite. Establish reviewed opening balances for legacy stock.
11. Administrators review and approve proposed corrections to ambiguous legacy asset links, duplicate issuances and questionable dates or bill values. Staff may flag issues and supply evidence; correction execution must validate the approval and the current record version server-side.
12. Retain all existing operational data. Present a concrete preview and ask the user to verify before applying any existing-record tag/classification/link corrections, deduplication, deletion or replacement. Administrator review does not replace this explicit user requirement.
13. Use the `normalized` preview channel at `https://demoapp-7864a--normalized-jagl9vut.web.app/`; do not deploy to the main site or push to `main`. This preview currently shares the production database, so perform write/recovery tests only in isolated storage.
14. The user accepted emulator-only isolation for the current Phase 1 work. Cloud staging, billing setup and scheduled cloud recovery are explicitly deferred. This does not establish production disaster-recovery coverage or authorize enabling paid services.

### First implementation scope

Complete source reconciliation and recovery controls, then implement access enforcement, acknowledged saves, transactional inventory movements and stable asset history. Improve calculations and reporting next; defer performance refactoring until integrity gates pass. Audit, archive and reconciliation capabilities may initially be integrated into existing screens rather than implemented as seven separate modules.

### Measured baseline

| Measure | Last verified result |
|---|---|
| Hosting release | Cache `hamms-v2-10-24`; HTML equals current checkout at `3e5944c` |
| HTML response size | 927,832 bytes before any claimed transfer compression |
| Security rules | Deployed source matches current local rules; equal record versions accepted |
| Operational records | 960 across 15 stores in the audit snapshot |
| Assets / work orders / inventory / issuances | 472 / 36 / 89 / 110 |
| Work-order states | 33 Closed, 2 Open, 1 In Progress |
| Work orders carrying `assetDocId` | 0 of 36; room work does not necessarily need an asset link |
| Waste logs | 0; three medical-waste processing records are a different dataset |
| Energy bills | 6; no duplicate periods found in this snapshot |
| Existing regression suite | 448 passed, 1 flaky pass on retry, 0 final failures; 449 tests total |
| Operational page rendering | 16 of 16 checked pages rendered without synchronous exceptions using a read-only production snapshot |
| Qualitative assessment | 5/10 for production reliability and data integrity |

The baseline can change. Capture a new paginated snapshot immediately before any migration; do not use these counts as a permanent expected production total. The earlier v2.11.2 deployment report is not sufficient evidence that recoverable source exists or that its fixes are still correct.

## 2. Target architecture and rollout principles

Keep Firebase Auth, Firestore and the existing PWA. Preserve existing record document IDs and approved business workflows. Introduce clearer service boundaries incrementally rather than rewriting the application while fixing integrity defects.

Recommended operational path:

`form draft → validated command with operation ID and expected versions → trusted mutation service → atomic operational writes + audit event + command outcome → acknowledged UI update`

Use Firebase backend commands for work-order/material operations and mutations requiring a guaranteed audit event. Server SDKs bypass Firestore Security Rules, so each backend command must independently enforce authentication, active membership, role, schema, facility scope and maintenance locks. Configure least-privilege service access. See [Firebase rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).

Do not allow a second direct-write path that bypasses those checks. If a module temporarily retains browser transactions, document that boundary and its audit guarantees; migrate it before claiming every operation has an atomic protected audit event. Unrelated read-only analytics may stay in the client.

Add explicitly allowed collections such as `staff`, `locations`, `operationResults`, `auditEvents`, `migrationJobs`, `inventoryMovements`, `energyFactors` and attachment metadata as required. Treat names as proposed schema, not a deployed contract. Update the current 15-store rules allowlist deliberately rather than assuming new collections already work.

Protect old cached clients through rules/backend policy. A service-worker version bump helps distribute UI changes but cannot itself enforce new authorization or data invariants.

## 3. Phases, implementation steps and acceptance gates

### Phase 0 — Recover the intended source and establish rollback evidence

**Purpose:** Resolve the release discrepancy before combining fixes with an uncertain base.

**Work:**

1. Inventory current branch, Git refs/reflogs, managed worktrees, release tags, deployment history and available local snapshots. Inspect candidate versions read-only first.
2. Record the current live hosting hashes, deployed rules source, index configuration, Firebase configuration and current operational data snapshot. Keep real backup data outside `public/`, out of Git and out of `LOCAL.json`.
3. Build a recovery matrix: earlier fix, recovered source/test, current equivalent, conflict, final intended behaviour. Include authentication persistence, sync, history, safety, projects and energy settings.
4. Recover individual changes into a `codex/` branch and resolve overlapping code based on intended behaviour. Avoid replacing the whole HTML with an older copy.
5. If some earlier source cannot be recovered, mark those fixes for reimplementation with new tests; never silently mark them recovered.
6. Add a release manifest containing release ID, commit, schema/rules compatibility version and service-worker cache. Show an accessible version indicator in the UI.
7. Fix the flaky Enter-key login test by checking the intended focus/submission behaviour with explicit waits. Preserve email-only localStorage remembering; do not introduce password caching.

**Gate:** Every audit finding is mapped to recovered, reimplemented or deferred work with a reason. The candidate manifest and hosted files must agree in staging. Demonstrate rollback in staging with a compatible frontend/rules pair; do not roll back data invariants merely to restore old UI behaviour.

**Metrics:** 100% finding traceability; zero unexplained source conflicts; 449 existing tests accounted for; zero failures in the candidate suite; the former flaky scenario passes 20 consecutive attempts without retries. Record source hashes and evidence paths.

### Phase 1 — Establish recovery and deployment controls

**Purpose:** Ensure subsequent changes can be stopped and recovered.

**Work:**

1. Inventory actual billing plan, database region, backup/PITR configuration, existing admin accounts and CI/deployment access. Do not assume backups are enabled or disabled.
2. Create a staging Firebase project with equivalent Auth, rules, indexes and backend configuration. Use synthetic data; use a protected sanitized snapshot only where needed.
3. Verify a full paginated backup: include record IDs, metadata, schema version, count manifest and checksums; record attachment coverage separately.
4. Configure scheduled recovery features where available and approved. Test restoration into a separate staging database/project, not over production. Firebase documents [scheduled backups and PITR](https://firebase.google.com/docs/firestore/disaster-recovery).
5. Implement protected maintenance state. Normal write commands must reject maintenance conflicts; migrations receive scoped job authorization.
6. Define release ownership and a checklist covering tests, rules, backend, indexes, cache bump, data migration and smoke verification.

**Gate:** A backup is usable only after a restore drill verifies it. No production migration begins with an untested backup.

**Metrics:** 100% snapshot record IDs and payload checksums reconcile after restoration; zero missing stores; attachment manifest accounted for; target recovery point objective (RPO) ≤24 hours for scheduled backups, with a tighter target established if PITR is configured; target recovery time objective (RTO) ≤2 hours for a practiced recovery at present scale. Measure actual RPO/RTO and report misses rather than assuming these targets are guaranteed.

### Phase 2 — Enforce access, schemas and destructive-operation permissions

**Purpose:** Prevent unauthorized replacement/reset and malformed operations.

**Work:**

1. Define active staff membership keyed by Firebase UID, with staff/admin roles and facility scope. Establish the first administrator through a trusted administrative process. Seed authorized memberships before activating enforcement to avoid accidental lockout.
2. Require authenticated active membership for reads and operational commands; reserve role management, factor settings, restore, reset and permanent removal for administrators.
3. Keep ordinary staff deletion available as archival. Block direct physical deletes and unrestricted metadata replacements from the browser.
4. Define schemas for every store and command: required fields, enums, finite numbers, nonnegative quantities, valid dates, stable IDs, bounded text/arrays and allowed attachment references. Validate both single forms and import paths.
5. Require `_docId` to equal the document key, preserve record identity and creation metadata, require valid versions, and reject undeclared business fields where the schema requires it.
6. Use trusted server timestamps for audit/commit ordering. Retain display compatibility with legacy `_updatedAt` where necessary; do not rely on client clocks for authoritative sequence.
7. Separate editable operational metadata from administrator-controlled state. Reject forged actor identities.
8. Apply the same checks inside backend handlers because Admin SDK calls bypass rules. Exercise direct SDK/REST attempts, not only hidden UI buttons.

**Gate:** Authorized staff can still complete intended CRUD/archival. Unauthorized users and inactive staff cannot read/write operational data. Staff cannot restore/reset/purge, even through crafted requests.

**Metrics:** 100% role/action matrix cases pass; zero unauthorized successes; zero accepted malformed records across all 15 stores in a defined invalid-input fixture set; zero missing audit events for completed destructive commands. Verify immediate membership revocation with an already signed-in session. Record token/claim refresh limitations where custom claims are used.

**Compatibility:** Stage membership provisioning first, then compatible frontend/backend, then enforcement. Old clients must receive a clear update-required or denied-save state, not silently appear successful.

### Phase 3 — Make saving, concurrency and retry reliable

**Purpose:** Eliminate lost edits, false success and unintended offline replay.

**Work:**

1. Replace generic optimistic CRUD announcements with an awaited command outcome. Keep the form draft separate from acknowledged shared state.
2. Each command carries an operation ID, expected record version, validated payload and related-record preconditions. Persist the result transactionally for idempotent retries.
3. On a stale expected version, return structured conflict details. Preserve the entire form and show the latest record for review; never silently retry the same human edit against a newer version.
4. Require server-confirmed access before accepting a save. When offline before submission, reject without queueing. On reconnect, keep the draft and require the user to retry.
5. Distinguish an offline rejection from an uncertain outcome after a request was sent. If the client times out, query the same operation ID after reconnection; a timeout does not prove the server cancelled the write. Resolve it before a fresh submission.
6. Prevent overlapping flushes and double clicks. A timer may update the UI to “Checking save status,” but it must not start a second writer while the first operation is unresolved.
7. Where a temporary pending queue remains, acknowledge exact operation IDs/revisions, not entire store names. Exercise chunk-boundary failures and new edits arriving during a flush.
8. Remove the gstatic probe as evidence of Firestore connectivity. Separate Connecting, Live, Saving, Offline, Unavailable, Conflict and Outcome unknown. Include last server verification/save time and a useful error reason.
9. Reset state and private drafts appropriately on sign-out or account switch. Avoid carrying a previous user's pending operations into a new account.

**Gate:** Zero lost acknowledged writes, silent conflict overwrites or automatic replay of a rejected offline save in the test matrix. Firebase transactions support atomic operations but require careful retry handling; see [transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions).

**Metrics and scenarios:**

- 100 stale-editor races: each has exactly one accepted edit and one explicit conflict where both start from the same version; zero silent overwrites.
- 100 repeated submissions with the same operation ID: exactly one logical committed result each.
- At least 30 fault-injection cases spanning permission errors, network loss, response loss, slow commits, sign-out, and chunk boundaries: zero unacknowledged operations discarded; zero success messages without a recorded successful command outcome.
- Offline-before-submit cases: zero command submissions and zero reconnect-triggered replays; 100% of tested draft fields, material rows and attachments remain available for deliberate retry.
- Unknown-outcome cases: 100% reconcile to one committed or rejected result before resubmission.
- Connectivity transition target: visible Offline/Unavailable within 15 seconds of a detectable failure; Live only after a valid server check. Browser online state alone is insufficient.
- Proposed performance target: p95 ordinary save acknowledgement ≤3 seconds on the defined healthy test connection, with failures/unknown outcomes reported separately rather than omitted.

### Phase 4 — Correct stock and automatic issuance as one operation

**Purpose:** Prevent duplicate consumption and inventory inconsistencies.

**Work:**

1. Give each material line a stable line ID. Aggregate duplicate inventory selections before checking availability so two rows cannot independently pass against the same starting stock.
2. Use stable `woDocId`, `invDocId`, line ID and operation ID references. Keep display codes as snapshots, not relationship keys.
3. In one trusted transaction, validate expected WO/inventory state, apply net material deltas, update or supersede automatic issuance lines, append inventory movement/audit records and write the command result.
4. An unchanged-material edit produces zero net stock change and no duplicate current issuance lines. Increasing use deducts only the difference; decreasing use returns only the difference.
5. Keep manual issuance separate. Explicitly define WO cancellation, deletion and reinstatement effects using compensating movements; do not erase the stock ledger.
6. Review legacy automatic issuances using both historical numeric `WO-{id}` and human-readable codes. Produce a preview showing proven duplicates, uncertain cases and proposed effects. Repeated rows alone are not proof of duplicate consumption.
7. Establish opening balances before introducing a ledger. Historic receipts/adjustments may be incomplete, so do not infer the entire present stock from all legacy issuance rows.
8. Archive superseded issuance entries with a correction reason. Never automatically delete all similar legacy rows or adjust production stock based only on similarity.
9. Replace direct quantity edits with Receive stock and Adjust stock actions. Require a reason, signed quantity delta, actor and server timestamp; receipts should support delivery/reference details. Validate permissions and resulting stock in the authoritative command. Preserve descriptive item editing without permitting it to overwrite the balance.
10. Apply legacy corrections only from administrator-approved previews. Record the evidence, approval, expected versions and resulting compensating movements; reject stale approvals when affected records change and return the preview for review.

**Gate:** The reproduced edit-duplicates-issuance defect is fixed and accounting invariants hold under concurrent commands.

**Metrics:**

- For each item: `closing stock = opening stock + receipts + returns + adjustments − issued quantity` within 0.0001 unit where four-decimal quantities are supported.
- Current automatic issuance quantity equals the current WO material quantity by inventory ID and line identity; zero orphan current issuance references.
- Unchanged WO edit repeated 20 times: zero stock drift and unchanged current automatic issuance cardinality.
- 100 paired competing issuance tests near insufficient stock: zero negative stocks and zero over-issuance.
- Inject failure into each transaction stage: no committed partial WO/stock/issuance state.
- Every legacy issuance is classified as retained, corrected with evidence, or unresolved; unresolved is not a failure to preserve data, but must remain visible.
- 100% of receipts/adjustments carry a nonempty reason and protected movement/audit evidence. Crafted direct balance-overwrite requests are rejected; item metadata edits leave stock unchanged.
- Zero uncertain legacy corrections execute without a valid administrator approval; stale approved previews are rejected without partial changes.

### Phase 5 — Repair asset/location identity and history workflows

**Purpose:** Ensure history belongs to the correct asset and room.

**Work:**

1. Immediately prevent `DIETARY RSA` from matching unqualified Dietary or Dietary Kitchen. Preserve legitimate aliases through explicit alias maps rather than unrestricted word subsets.
2. Introduce stable location IDs with parent relationships and reviewed aliases. Store current IDs plus display snapshots where historical context must survive renaming.
3. Require explicit WO scope: equipment work requires a valid `assetDocId`; room/facility work requires `locationId` and no equipment link. Validate section/location consistency, with explicit policy for permitted cross-section work.
4. Add Create work order to asset rows and history views; preselect the exact asset ID and full code/location identity. Add No recorded repairs for valid empty histories.
5. Resolve repair history by stable ID. For legacy records, allow only reviewed unique matches; flag ambiguity and dangling links rather than guessing from similar names.
6. Classify all 36 current WOs: uniquely linked asset, explicit room work, or unresolved. Review the confirmed RAMP mapping against current records. Preserve all existing document IDs.
7. Do not invent repairs for the two RSA lighting assets. If a real repair occurred, create/link the actual documented work order with its date and evidence. General Dietary plumbing work must not become lighting history.
8. Validate imports in a preview: duplicate codes, invalid locations, ambiguous assets and missing scope. Extend rules/backend for new relationship schemas.
9. Archive assets with existing references; preserve history and require explicit policy for moving them or reassigning links.
10. Require administrator review of uncertain historical linking proposals. Store evidence and approval, and apply only if the affected WO/asset versions still match the approved preview. Deterministic schema-only migrations remain separately reviewed migration jobs.

**Gate:** No room leakage or incorrect cross-asset repair history in the fixture matrix; every new equipment WO has a stable valid relationship.

**Metrics:** 100% new equipment WOs linked; 100% room WOs explicitly scoped; zero dangling active references; zero cross-room/cross-asset matches in tests covering RSA, Kitchen, department aliases, ICU/NICU/PICU, numbered rooms and shared equipment names. The two RSA asset records remain distinct and visible. All 36 legacy WOs classified, with unresolved count shown and an owner assigned; require resolution before claiming historical link completeness. Renaming an asset must preserve 100% of its linked history.

### Phase 6 — Correct calculations, dashboards and forecast meaning

**Purpose:** Make calculations reproducible and uncertainty visible.

**Energy work:**

1. Preserve explicit zero for quantity, hours, operating days and demand factor. Defaults apply only to missing values. Reject invalid negative/nonfinite inputs.
2. Put baseline/settings in shared admin-controlled documents. Add sourced, dated, versioned factor records and immutable bill factor snapshots.
3. Backfill legacy factors only from verified sources; otherwise show factor unverified/carbon unavailable. Retain the June anomaly unchanged with a verification flag.
4. Enforce one facility bill per month using a deterministic facility-period key or transactional unique reservation; a browser duplicate check is insufficient.
5. Keep asset consumption estimates separate from billed facility totals. Missing months remain missing; never fill them with zero or compare incomplete years without coverage disclosure.

**Forecast work:**

1. Keep open/in-progress WOs as forecast rows. Label the basis: valid completion count, average duration, excluded records and date coverage.
2. Treat zero-day completion as valid. Exclude reversed/invalid dates. Show Insufficient history when a projected date cannot be calculated; still show independently known target-date overdue status.
3. Ask for bill/source verification before correcting suspicious production values. For `PLBG-HI-0001`, quarantine the duration from averages until actual start/end dates are confirmed.
4. Replace waste blank states with specific No source records / No records in analysis window / Unsupported category messages. State the analysis window and method; distinguish missing weeks from observed zero weeks.
5. Investigate recoverable waste exports/backups separately. The earlier screenshot is not adequate provenance for automatic reconstruction. Do not derive waste generation categories from treatment logs.
6. Label the present +5% waste projection as a heuristic if retained; do not describe it as a statistically validated prediction. Estimate predictive accuracy only when enough suitable observations exist.

**Safety/project work:** Reconcile recovered dashboards with the confirmed active-state, weighted-progress and budget-at-risk definitions. Use dated history for trend claims; do not fabricate historical observations from the current state.

**Gate and metrics:**

- All explicit-zero energy fixtures produce exactly 0 kWh; positive fixtures match an independent formula within rounding tolerance ≤0.01 kWh.
- Staff setting writes denied; two browser sessions see identical settings; later factor changes alter zero saved historical bill snapshots.
- 100 concurrent same-period bill creation races create exactly one bill/reservation each; duplicate attempts receive a clear result.
- Snapshot counts and totals reconcile exactly before/after migration except separately approved corrections.
- All invalid/reversed WO durations excluded; zero-day fixtures project the start date correctly; no-history fixtures never show an evidence-free On Track forecast.
- Current snapshot yields exactly three active WO forecast rows. This is a dated fixture expectation, not an invariant for future production activity.
- Empty waste source produces an explicit explanation and no invented volume; missing weeks are never silently treated as observations.
- Safety active counts and project weighted calculations match an independent expected-values fixture, including no-budget and mixed-budget cases.
- Numeric comparisons use defined currency/kWh rounding, not string display comparisons alone. Record inclusion counts beside totals.

### Phase 7 — Implement archive, audit and resumable restore/reset

**Purpose:** Make destructive actions reviewable, recoverable and traceable at realistic scale.

**Work:**

1. Archive with trusted actor/time/reason and preserved original payload/version. Staff can archive; authorized users retain permitted historical access. Administrators alone restore/purge, following the selected indefinite retention policy.
2. Use immutable audit events containing command ID, actor UID, action, record reference, before/after versions, trusted time, outcome and reason. Store only necessary diff/snapshot data and avoid passwords/tokens. Ordinary clients must not update/delete audit events.
3. Make audit creation part of the same authoritative mutation where completeness is required. If asynchronous triggers are used for noncritical observations, deduplicate event IDs and monitor lag; do not claim atomic audit coverage from an eventual trigger alone.
4. Define a versioned backup format with explicit stores, manifest, schema, attachments, hashes and counts. Separate partial merge from full replacement. An omitted store must not silently mean delete its contents.
5. Validate/stage input first and show a dry-run preview: additions, updates, archives/deletions, unresolved references and protected settings. Reject invalid backups before touching operational records.
6. Implement administrator restore/reset as server jobs with maintenance lock, durable checkpoints, progress, per-operation outcomes and idempotent resume. Take a verified pre-operation snapshot.
7. Large multi-batch replacement is not globally atomic. Initially keep the app in maintenance until validation and final reconciliation complete; on failure remain locked for resume/rollback. A later generation-based dataset switch can provide a cleaner cutover if justified, but requires explicit read/rules/client changes.
8. Reset should archive the current dataset or preserve a verified recoverable snapshot, never instantly destroy the only recoverable copy. Permanent removal remains a separate explicit administrator operation.
9. Match archives and inventory corrections: archiving a WO cannot bypass compensation or orphan current issuance.

**Gate and metrics:** A 5,000-record staged restore completes with 100% manifest/hash/count reconciliation; all reference constraints pass; zero ordinary writes accepted during maintenance. Faults at start, middle and finalization remain resumable with zero double application. At least three interrupted restore/resume drills and one rollback drill pass. Invalid/partial replacement backups produce zero operational changes. Every archive/restore/reset/purge command has exactly one recorded successful outcome and its audit evidence. Unauthorized audit modification and purge attempts succeed zero times. Recovery RPO/RTO targets from Phase 1 remain measured.

### Phase 8 — Improve scale, attachments and maintainability

**Purpose:** Reduce increasing read/transfer costs without destabilizing the corrected workflows.

**Work:**

1. Measure cold startup, largest pages, read counts, response bytes, memory, save latency and listener activity at current scale and at a synthetic 10× dataset.
2. Introduce scoped queries and pagination by module/date/status; ensure dashboard totals come from complete bounded queries or trustworthy summaries, not the currently loaded page.
3. Declare required composite indexes and test every query against deployed staging rules. Rules do not filter unauthorized query results.
4. Move photos/service reports to Firebase Storage with protected metadata, upload limits and orphan cleanup. Preserve export/restore attachment manifests; test failed uploads and access revocation.
5. Split data access/commands, domain validation/calculations and UI rendering into plain JS modules. Retain the no-framework/no-bundler approach unless a later decision justifies changing it.
6. Coordinate service-worker shell caching with modules and release manifests. Test installed-app upgrade and old-client rejection. Clear sensitive in-memory/derived UI state at sign-out.

**Proposed measured targets:** ≥60% reduction in initial Firestore document reads compared with the measured baseline at 10× scale; initial list page ≤100 records; p95 loaded-page filter/navigation ≤300 ms at current scale; p95 cold authenticated initial dashboard ≤5 seconds on the defined desktop test connection and ≤8 seconds on the defined throttled mobile profile. Investigate long tasks over 200 ms during ordinary navigation. No decrease in accuracy or lost historical coverage is acceptable to achieve these targets. Treat them as adjustable engineering budgets if baseline measurements demonstrate an unrealistic threshold.

### Phase 9 — Deploy, verify and monitor

**Work:**

1. Promote only a recorded candidate commit with passing gates. Install rules/indexes/backend in compatibility order, seed required memberships, and execute reviewed migrations through job IDs.
2. Bump service-worker cache on every deployment. Verify live hashes, release manifest, rules compatibility, backend version and index readiness.
3. Run read-only production smoke checks and signed-in role checks using authorized accounts. Demonstrate write/fault scenarios in staging; any production test write uses a clearly designated test record and an explicit reconciliation/cleanup path.
4. Test existing installed desktop/mobile clients, fresh clients and a stale cached client. Require an update if the old write path is blocked.
5. Observe for 24–48 hours after release. Assign an operator to review failed/unknown outcomes, migration status, access denials, duplicate records and costs. This monitoring is a proposed rollout task; no scheduled automation is created by this plan.
6. Stop rollout on silent overwrite, unexplained stock drift, unauthorized destructive success, unresolvable command outcome, count/hash mismatch or release identity mismatch. Preserve evidence and use the practiced recovery procedure.

**Gate:** Zero open P1 integrity/security defects; every migration reconciled; zero unexplained production record loss; successful role and cache-upgrade checks; named release owner signs the evidence report.

## 4. Verification scorecard and measurement definitions

| Metric | Definition / measurement | Acceptance target |
|---|---|---|
| Release consistency | Manifest/HTML/SW/rules/backend compatibility agrees with approved candidate | 100%; mismatch blocks release |
| Authorization leakage | Successful forbidden actions / tested forbidden actions | 0% |
| Stale overwrite rate | Silently committed stale edits / staged stale-edit races | 0 of 100 |
| Duplicate command effects | Extra logical writes for a repeated operation ID | 0 in 100 retry tests |
| False save success | Success shown without successful command outcome | 0 in fault matrix |
| Rejected offline replay | Commands initiated automatically after reconnect from offline-rejected draft | 0 |
| Draft retention | Required field values preserved / submitted values checked | 100% in failure fixtures |
| Stock reconciliation error | Absolute stored quantity minus movement-derived quantity | ≤0.0001 unit |
| Duplicate automatic issuance | Extra current line identities for one WO | 0 |
| New equipment relationship coverage | Valid asset-linked new equipment WOs / all new equipment WOs | 100% |
| Legacy classification coverage | Reviewed asset/room/unresolved classification / pre-migration WOs | 100%; unresolved visible |
| Room/history leakage | Incorrect room or equipment matches / reviewed fixtures | 0 |
| Archived recovery completeness | Correct restored IDs/payloads / archived records in drill | 100% |
| Audit coverage | Successful commands with atomic audit / commands required to be audited | 100% after mutation service migration |
| Backup reconciliation | Matching IDs/payload hashes / expected manifest records | 100% |
| Energy zero correctness | Explicit-zero fixtures yielding 0 / all explicit-zero fixtures | 100% |
| Bill uniqueness | Extra facility-period bills after races | 0 |
| Forecast honesty | No-history/invalid-date fixtures correctly labelled/excluded | 100% |
| Regression reliability | Failures/flaky cases across candidate test runs | 0 failures; critical cases pass without retry |
| Save latency | Time from valid submit to acknowledged command outcome, healthy connection | p95 ≤3 seconds proposed |
| Recovery time / data age | Drill duration / age of recovery point at incident | ≤2 hours / ≤24 hours initial targets |
| Cost | Monthly measured/projected reads, writes, compute, storage, backup, egress | Reported against an approved budget; no fabricated fixed estimate |

A 100-case test with no failures demonstrates that test run, not a permanent production probability of zero. Report sample size, environment and exclusions. For latency measurements collect at least 100 ordinary save samples per relevant profile; record p50/p95/p99 and failed/unknown outcomes separately. For cold-start/page measurements collect at least 30 runs per desktop/mobile profile, with cache state and dataset size recorded. Do not count retries as clean passes.

## 5. Test matrix and evidence to retain

- **Unit/domain tests:** independent expected calculations for zero/defaults, quantities, dates, normalized aliases, lifecycle states, progress weighting and rounding.
- **Browser tests:** form preservation, exact asset selection, history creation, accessibility, double clicks, signing out, update prompts and connection labels.
- **Rules emulator tests:** anonymous, nonmember, active staff, inactive staff and admin; malformed schemas, forged actors, stale versions, protected metadata, audit mutation and purge.
- **Backend integration tests:** same-record races, material stock races, idempotency, role/lock enforcement and audit coupling. Test the trusted code separately because rules do not secure Admin SDK operations.
- **Migration tests:** dry runs against synthetic and protected snapshot copies, empty/missing stores, duplicate IDs, ambiguous relationships, invalid JSON/schema, large datasets and interruption/resume.
- **Staging Firebase tests:** exercise real SDK/network/Auth, query indexes and server acknowledgements. A browser with `_FB.enabled=false` proves rendering/domain behaviour, not cloud save integrity.
- **Production verification:** release/rules hashes, permitted read-only snapshots, aggregates/reference audits, cache upgrade and controlled authorized smoke scenarios.

For every release retain: candidate commit, release manifest, exact commands, results and retry count; role matrix; fault/race outcomes; migration preview/job IDs and reconciliation report; backup/restore drill hashes and durations; screenshots for critical empty/error/conflict states; latency/read/cost measurements; known unresolved data and its owner. Do not include credentials or raw production backups in source control.

Suggested artifacts: `docs/releases/<release>/verification.md`, `docs/migrations/<job>/preview.md` and `docs/migrations/<job>/reconciliation.md`, with sensitive payloads in protected storage instead of Markdown.

## 6. Backend costs and operating responsibilities

Cloud Functions for Firebase requires the Blaze billing plan; confirm current billing and assess the expected workload before deployment. Function container storage can incur charges even at low invocation volume. See [Firebase Functions quotas and billing guidance](https://firebase.google.com/docs/functions/quotas).

Prepare a cost worksheet with actual deployment region and current prices:

`monthly cost = function invocation/compute + Firestore reads/writes/deletes + indexes/storage + attachment storage/operations/egress + backups/PITR + logs/container storage + staging usage`

Record expected monthly active staff, commands/day, read/write documents per command, average audit size, attachments/month and retained archived size. Because archives are retained indefinitely, forecast storage growth for 12 and 36 months. Include failed/retried commands and migration reads/writes. Use measured staging operation counts and official pricing, not an unsupported flat peso estimate. Give low/expected/high scenarios and convert currency using a dated exchange rate if pesos are required.

Configure bounded function concurrency/instances, appropriate timeouts and log retention; check startup latency before choosing permanently warm instances. Set budget notifications and available service-specific spend controls. Do not treat an alert as a guaranteed hard spending cap. [Firebase billing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) describes linking the billing account.

Operational ownership must cover staff provisioning/revocation, factor sources, backup/drill review, release approval, unresolved migration records and cloud billing. Assign named people before rollout; this plan does not invent staff identities.

## 7. Dependencies, effort and completion definition

**Main dependency chain:** Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4. Phase 5/6 require the recovered base and should adopt the Phase 2/3 contracts before production migration. Phase 7 builds on backup, access and command infrastructure. Phase 8 follows functional correctness. Phase 9 is the final production gate, with small compatibility-safe releases possible between phases.

Planning estimates for one engineer, including targeted implementation/testing but excluding waiting for operational data verification:

| Work | Estimated engineer-days |
|---|---:|
| Phase 0: recovery and merge | 1–3 |
| Phase 1: staging, backup and recovery controls | 1–3 |
| Phase 2: membership/schema/security | 2–4 |
| Phase 3: save/concurrency/connection contract | 3–5 |
| Phase 4: inventory/issuance integrity | 2–4 |
| Phase 5: asset/location links and review tooling | 2–4 |
| Phase 6: energy/dashboard/forecast correctness | 2–4 |
| Phase 7: archive/audit/large restore | 3–6 |
| Phase 8: scoped reads/attachments/modules | 3–6 |
| Phase 9: release/drills/final verification | 1–2 plus 24–48h observation |

Total planning envelope: **20–41 engineer-days**, before contingency or time waiting for missing source, account/billing setup, or original bill/repair verification. Re-estimate after Phase 0. These are effort ranges, not promised dates; some parts may already exist in recoverable source.

Completion means: every confirmed code defect is fixed and passes its gate; known production data issues are resolved from evidence or explicitly quarantined with an owner; all migrations preserve identities and reconcile; recovery is demonstrated; current live release agrees with the approved manifest; and the final report distinguishes verified outcomes from remaining operational questions. Passing the old 449-test suite alone is insufficient.
