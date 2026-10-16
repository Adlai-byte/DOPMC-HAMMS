# Phase 4 — Stock and issuance integrity

Date: 16 October 2026. Branch: `codex/phase-4-stock-integrity`.

## Scope and deployment status

The isolated emulator implementation now couples inventory balance changes, work-order materials, issuance records, movement evidence, audit events and idempotent outcomes in one authoritative Firestore transaction. The local browser harness uses these commands instead of the old restore/deduct/regenerate path.

This is an emulator checkpoint, not a deployed release. Production records, default Firestore rules, `public/index.html`, service worker, Firebase billing and both hosted sites are unchanged. No cloud staging was created. Newer normalized-preview source reconciliation and a production-capable backend remain prerequisites for eventual deployment. The only authorized future hosting target remains channel `normalized`; its shared production database is not test storage.

## Confirmed return policy

The user selected: **unused materials return to stock only after staff explicitly confirm a physical return and give a reason**.

- Cancel with no return: stock remains consumed.
- Cancel with a confirmed partial return: only that quantity is credited.
- Archive/restore: visibility changes; stock is unchanged.
- Reopen: administrators only; no second deduction.
- Reduce WO materials or manual issuance: require physical-return confirmation and reason; otherwise reject.
- Manual return: preserve the issuance and its cumulative returned quantity; prevent returning more than was issued.

## Implementation

`security/stock-domain.mjs` validates command shapes and converts quantities into integer units of 0.0001. Up to 50 stable material lines and 30 distinct inventory items are supported per command. Duplicate item selections are aggregated before availability checks.

`security/stock-transaction.mjs` validates current identities, exact versions, active inventory, sufficient balance, ledger agreement and existing automatic-line consistency before any write. Transactions apply only net deltas. Unchanged materials produce no additional movement or issuance identity. Removed lines are archived, never deleted. Retired line identities cannot be reassigned or silently reused. Automatic issuance uses stable WO/item/line references; display codes are snapshots.

Manual issuance, amendment, explicit return, receipt and signed adjustment have separate commands. Existing generic commands cannot directly overwrite balances or create/edit issuance records. Inventory descriptions can still be edited without changing balance. Stock, ledger, issuance, audit or outcome write failure rolls back the entire command. Protected movements are immutable to clients, including administrator clients.

The emulator service serializes stock commands within one service instance in addition to Firestore transaction/version checks. Multi-instance contention and production capacity have not been measured; this local serialization is not a production throughput result.

The local generated browser view adds receipt/adjustment/return forms, a movement ledger, WO cancellation/archive/restore/reopen controls and manual amendments. It retains drafts through uncertain responses and reconciles the original operation instead of issuing a second receipt. Pending manual issuance drafts transition to editing the confirmed identity. Issuance rows show gross, returned and net quantities; cancelled WOs no longer meet the overdue predicate. The hosted HTML remains unchanged. Legacy CSV exports still expose their original gross issued quantity; ledger/net reporting must be reconciled before rollout.

## Existing data: evidence only

A read-only review of the private **14 October 2026 backup** classified all **110 issuance records**, covering **89 inventory items and 36 work orders**:

| Evidence | Count |
|---|---:|
| Legacy automatic WO issuance | 85 |
| Manual or unknown legacy issuance | 24 |
| Unresolved inventory reference | 1 |
| Possible duplicate/quantity mismatch groups | 8 |
| Total findings requiring review | 9 |
| Proposed writes | 0 |

Similar rows may represent legitimate separate issues. These findings do not establish that eight groups can safely be deduplicated or that the backup equals current physical stock.

Private report: `D:/Projects/DOPMC/hamms-recovery/backups/2026-10-14T15-42-41-705Z/stock-review.json`. It and the real backup remain outside Git and `public/`. The report contains original IDs, quantities and review evidence; it changes no operational record.

Nonzero legacy stock without a ledger is blocked from stock commands until a current opening-balance proposal is reviewed. The opening command requires an exact version, live record hash, unchanged quantity, user-verification flag and approval by an active administrator in a protected proposal. It preserves the quantity while establishing the ledger. Only synthetic proposal fixtures were approved/applied during testing. There is no UI or endpoint that automatically approves real corrections; a concrete current preview and the user's verification are still required. Snapshot report hashes alone are not executable approvals.

## Verification

All mutating tests use synthetic accounts and data in project `demo-hamms-security` on loopback Auth/Firestore emulators.

| Verification | Result |
|---|---|
| Recovery, schema, save-controller and stock/review units | 224 passed |
| Prior Auth/rules/backend integration | 178 passed |
| Prior confirmed-save browser/backend scenarios | 15 passed |
| Stock backend/rules scenarios | 22 passed |
| Stock Chromium scenarios | 8 passed |
| Total distinct targeted tests | **447 passed; zero failures/retries** |
| Unchanged WO edits | 20 edits; zero additional movements or issuance rows |
| Competing near-insufficient issuance | 100 pairs; one commit and one explicit stale-version rejection each; no negative balance |
| Repeated receipt operation | 100 pairs; exactly one movement/effect per operation |
| Ledger reconciliation in tested stock scenarios | Exact equality in integer units; error 0 |
| Atomic failure injection | Movement, automatic issuance and audit collisions roll back stock/WO/issuance/outcome; multi-item insufficiency also rolls back every item |
| Client movement/ledger/proposal forgery | 18 staff/admin mutation attempts rejected |
| Earlier save conflict and duplicate-operation races | 100 pairs of each passed again |
| Healthy ordinary command timing | 100 samples, zero failures; p50 84.1 ms, p95 102.1 ms, p99 104.1 ms; loopback HTTP acknowledgement only |
| Mobile stock dialog | 390×844; screenshot inspected, tested form has no horizontal page overflow |
| Dependency audit | 0 vulnerabilities |

The final stock rerun follows the complete prior-phase regression run and includes the last metadata/payload validation changes. Earlier runs exposed missing return presentation and the pending-manual-create identity transition; these were corrected before the final checks. Existing hosted browser suites were not rerun in Phase 4 because their source files remain untouched; the prior Phase 3 report records 35 supplemental CRUD/login passes. Those 35 are not included in the 447 above.

Required checks cover exact reconciliation, aggregate availability, unchanged edits, stale versions, explicit return policy, role restrictions, legacy blocking, opening-approval freshness, atomic rollback, repeated operations, competing issuance, browser acknowledgement/draft retention and mobile layout. A zero-failure sample demonstrates the tested cases, not a permanent production guarantee.

```powershell
node --test tests/phase3.client.test.mjs tests/phase2.validation.test.mjs tests/recovery-core.test.mjs tests/phase4.domain.test.mjs tests/phase4.review.test.mjs
firebase emulators:exec --project demo-hamms-security --config firebase.security.json --only 'auth,firestore' --non-interactive "node --test tests/phase2.security.test.mjs && node --test tests/phase3.integration.test.mjs && node --test tests/phase4.stock.test.mjs && node --test tests/phase4.browser.test.mjs"
npm audit --omit=optional --audit-level=low
```

## Local review and next gates

Use the fresh emulator and synthetic login instructions in [Phase 3](phase-3-confirmed-saves.md#run-locally). Start with a new zero-balance synthetic inventory item, then use Receive stock. Do not load real data into the interactive demo or remove emulator guards. On Inventory, open the movement ledger or WO lifecycle controls; on Issuance, create a manual issue and exercise a confirmed return.

Next is Phase 5: stable asset/location selection, exact history relationships and administrator review tooling for ambiguous legacy links. Before any real stock/link correction, prepare a current record-by-record preview, obtain the user's verification and administrator approval, preserve a verified backup, then reconcile exact identities and quantities. Cloud deployment, cloud recovery and billing remain pending the user's deferred infrastructure decision.
