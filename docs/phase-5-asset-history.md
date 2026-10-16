# Phase 5 — Asset/location identity and repair history

Date: 16 October 2026, Asia/Singapore. Branch: `codex/phase-5-asset-history`.

## Checkpoint and boundaries

This phase implements and verifies stable relationships in the isolated emulator candidate. It does not deploy them. `public/index.html`, `public/sw.js`, production rules/configuration, operational Firestore data, billing and both hosted sites remain unchanged. No real record was relinked, retagged, reclassified or removed. The private backup is read only.

Cloud staging and billing remain deferred by the user. A future release still requires reconciling the newer normalized-preview source and integrating a production-capable backend. The authorized hosting target remains channel `normalized`; its shared production database is not a write-test environment.

## Reproduced causes

The current hosted-source matcher returned `true` for both `DIETARY RSA` versus `DIETARY` and `DIETARY RSA` versus `DIETARY KITCHEN`. Its alias table collapses Kitchen to Dietary, then word-subset matching accepts the qualified RSA room. Existing history also accepts name fragments, description prefixes and missing-location fallbacks. Dropdown option values are asset names, so identical names cannot identify distinct equipment.

The local candidate replaces those decisions with:

- Exact document IDs for equipment and location relationships.
- Exact location names or explicitly verified aliases, with no automatic word-subset, abbreviation or parent-room equivalence.
- Separate equipment and room/facility work scopes. Room work never becomes lighting/equipment history merely because of a description or shared room.
- Confirmed history from explicit links only. Legacy exact matches are review candidates, not accepted repairs.

The old hosted matcher is unchanged until a future authorized release. Passing local tests does not mean either hosted site now contains the fix.

## Confirmed section policy

The user selected **matching WO and asset sections for now; administrator review for exceptions**. New equipment work requires an active asset, matching section and matching verified location. Even an approved correction cannot bypass section matching. Cross-section exceptions require a separately agreed policy change; there is no hidden override.

## Implemented workflows

### New records and history

Asset registration requires a registered stable location. Asset rows and history dialogs provide Create work order, preselecting the exact asset ID, full code, section and location. Shared names remain selectable as distinct records. Both ordinary and material-bearing WO commands enforce relationships in the backend.

Equipment history and room history are separate. Registry counts use the same stable-ID resolver as the history dialog. Empty valid histories say No recorded repairs and explain that asset registration does not create repairs. History persists after asset renaming; original WO display snapshots remain untouched. Archived assets remain discoverable through the retained-history selector, and archived repairs can be included explicitly. Archival never deletes referenced WOs; new work against archived equipment is rejected.

### Existing records and review

Existing relationship and historical-display fields are read-only in the local WO form. Ordinary commands cannot relink WOs or move/reclassify assets. New location definitions are administrator-only, with unique name/alias reservations, optional existing parents and explicit alias verification evidence. Existing location definitions cannot be overwritten through this command.

Administrator review uses three commands:

1. **Propose:** select the exact WO relationship or asset primary-location move, assign an active administrator owner, and record source evidence. The server stores the exact before/after preview and dependency hashes. This writes a proposal only.
2. **Approve:** show the exact saved preview, obtain the data owner's verification, record its evidence reference and explicitly attest verification. The service records the approving administrator. The attestation records an operator's assertion; it does not independently prove a human reviewed the evidence.
3. **Apply:** require approved status, current active owner/approver and unchanged dependency hashes. Any target, asset or location change invalidates the preview. The correction, proposal state, audit and operation outcome commit atomically and retain document IDs, numeric identities and unrelated payload fields. Repeated operation IDs do not apply twice.

Only synthetic proposals were approved/applied in tests. No real candidate was automatically proposed, approved or applied. For an actual operational correction, present the current concrete preview to the user and obtain verification before performing it.

Approved asset moves change the primary location ID and display snapshot; existing WOs retain the room where their repair was recorded. Ancillary legacy room/building/classification fields are retained, not automatically inferred or cleaned up. Broader spatial/classification cleanup needs its own explicit preview. Renaming does not rewrite historical snapshots.

Asset codes cannot collide with existing or archived asset codes or concurrent reservations. Imports have a read-only relationship/code preview: duplicated codes, missing scopes, unavailable locations and mismatched/ambiguous equipment are reported. The result explicitly says full schema, attachments and operational validation remain necessary. Bulk imports remain disabled; this is not an import execution path.

### Protection and retention

Rules deny direct client creation, changes or deletion of location definitions, relationship proposals and code reservations, including for administrators. Staff can read registered locations and authorized operational data; proposal evidence is administrator-only. Membership, maintenance and idempotency checks apply to the trusted commands. The emulator guard has not been removed.

## Existing-data review: no changes

The read-only review of the **14 October 2026 snapshot** contains all **472 assets and 36 WOs**:

| Classification | Count | Meaning |
|---|---:|---|
| Unique exact legacy asset candidate | 23 | Still requires source/user verification before linking |
| Unresolved | 13 | Missing/ambiguous exact evidence; retain for review |
| WOs classified | 36 / 36 | Every WO has a review disposition |
| Confirmed migrated relationships | 0 | No migration was executed |
| Proposed operational writes | 0 | Report is evidence only |
| DIETARY RSA assets retained separately | 2 | No repair records invented |

Private report: `D:/Projects/DOPMC/hamms-recovery/backups/2026-10-14T15-42-41-705Z/relationship-review.json`. It is outside Git and `public/` and includes the original snapshot read time/hash, exact IDs, evidence, candidate locations and RAMP comparison. Candidate location IDs exist only in the report; they are not approved catalogue entries or newly written Firestore records. No aliases were inferred.

The earlier user choice of `OT-ELEC-RAMP-01` for `ELEC-HI-0011` is recorded as prior context, not treated as permission to alter a fresh record without a current preview. The report assigns the **admin review queue**, not an invented named owner. A real active administrator UID must be assigned before creating an executable proposal. The 23 candidates and 13 unresolved records still need operational review; historical completeness is not claimed.

## Verification

All mutation checks use synthetic local Auth/Firestore accounts in `demo-hamms-security`; no production credentials or write drills are used. See the final results table below. Tests cover RSA/Kitchen/Dietary, ICU/NICU/PICU, numbered rooms and room categories, explicit aliases, shared equipment names, room-only work, renamed/archived assets, stale approvals, concurrent code creation, audit rollback, idempotent apply, retained payloads, read-only imports, hostile display strings and sign-out cleanup.

| Verification | Final result |
|---|---|
| Recovery, validation, save controller, stock and relationship domain units | 239 passed |
| Prior access/rules/backend regressions | 178 passed |
| Prior confirmed-save browser/backend regressions | 15 passed |
| Stock backend/rules regressions | 22 passed |
| Stock browser regressions | 8 passed |
| Relationship backend/rules scenarios | 18 passed |
| Relationship browser scenarios | 9 passed |
| Distinct targeted tests across the final verification matrix | **489 passed** |
| Newly managed WO relationship audit | 8 WOs: 7 equipment, 1 room; 100% explicit scope; 0 dangling references |
| RSA/general Dietary/Kitchen, ICU/NICU/PICU, room-category/number and shared-name fixtures | No cross-room or cross-asset history matches |
| Legacy review coverage | 36/36 classified; 23 candidates and 13 unresolved remain unmodified |
| Client location/proposal/code-reservation mutation attempts | 18 staff/admin write attempts rejected |
| Stale approval dependencies | Target, selected asset and selected location changes all rejected |
| Audit failure and repeated correction | No partial correction; repeated same operation changes the WO once |
| Previous race gates rerun | 100 stale-edit pairs, 100 repeated-operation pairs, 100 insufficient-stock pairs and 100 repeated-receipt pairs passed |
| Ordinary healthy command sample | 100 samples, 0 failures; p50 101.2 ms, p95 119.3 ms, p99 122.7 ms; loopback HTTP acknowledgement only |
| Mobile review | 390×844 screenshots inspected; tested history/review dialogs have no horizontal page overflow |
| Dependency audit | 0 vulnerabilities |

The complete regression run passed earlier-phase suites and caught an asset rename form mismatch. The legacy form generates room/department/classification defaults and codes while editing; the adapter now retains protected fields' exact prior presence and values instead. The final relationship backend and nine browser cases passed after that correction, with no automatic retries. An invalid synthetic null-code fixture was corrected to an empty code supported by the schema; the passing case verifies that an empty existing code is not regenerated. A Windows single-quote test-name filter matched no case and left its local harness open; that verified test process was stopped and the full browser file was run normally. Those failed/diagnostic runs are not counted as extra passing tests.

The final browser suite blocks all external HTTPS requests and exercises the real local backend/Auth emulator, rather than depending on remote font loading. Existing hosted Playwright spec files were not rerun because hosted source was unchanged; their earlier supplemental results are not included in 489. Emulator correctness and this local timing sample do not certify cloud performance, multi-instance contention or historical production completeness.

```powershell
node --test tests/recovery-core.test.mjs tests/phase2.validation.test.mjs tests/phase3.client.test.mjs tests/phase4.domain.test.mjs tests/phase4.review.test.mjs tests/phase5.domain.test.mjs
firebase emulators:exec --project demo-hamms-security --config firebase.security.json --only 'auth,firestore' --non-interactive "node --test tests/phase2.security.test.mjs && node --test tests/phase3.integration.test.mjs && node --test tests/phase4.stock.test.mjs && node --test tests/phase4.browser.test.mjs && node --test tests/phase5.relationships.test.mjs && node --test tests/phase5.browser.test.mjs"
npm audit --omit=optional --audit-level=low
```

Private snapshot review can be regenerated to a **new outside-repository output** using `node scripts/preview-relationship-review.mjs <private-backup> <new-private-report-path>`. Existing files are not overwritten. Do not commit backup/report payloads.

For an interactive synthetic review, use [the fresh emulator instructions](phase-3-confirmed-saves.md#run-locally), sign in as a demo administrator, register a new location if needed, register an asset in that location, then use Create work order. Existing real production records must not be loaded into the interactive write harness. On Asset Registry, the review panel exposes read-only reports, administrator proposal review, new location registration and relationship-only import validation.

## Remaining gates and next phase

Named owner assignment and current original-record verification remain required for all real historical corrections. Global alias/catalogue migrations, cross-section exceptions and broad legacy classification cleanup are not automatically approved by this implementation. Rules/index performance and multi-instance backend contention require future cloud staging. Backup coverage must be extended to new catalogue/proposal/code-reservation collections before any production integration; the existing production backup scope is unchanged because no such collections were deployed.

Next is Phase 6: energy zero handling, factor/baseline provenance, bill-period uniqueness and transparent WO/waste forecasts. Keep the June consumption anomaly and questionable repair dates unchanged until source verification.
