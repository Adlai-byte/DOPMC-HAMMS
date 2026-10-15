# Phase 2 — emulator access enforcement and validation

Date: 15 October 2026 (Asia/Singapore).

Branch: `codex/phase-2-access-validation`, based on the verified Phase 1 feature branch. No production data, tags, classifications, links, memberships, billing, hosting or deployed rules were changed. All mutations in this phase used synthetic fixtures in the isolated local emulators.

## Scope and status

The emulator security foundation implements membership-based access and a trusted mutation boundary. **It is not deployed protection for the existing preview or main site.** Their current write paths and rules are unchanged. The old browser cannot simply be paired with the candidate rules because direct client writes are intentionally denied; integrate acknowledged commands in Phase 3 before considering deployment.

Source reconciliation with the newer preview remains required before future UI integration; no older application files were copied over that preview.

## Files

| File | Purpose |
|---|---|
| `security/firestore.phase2.rules` | Candidate rules for emulator testing; separate from existing deployed rules |
| `security/validation.mjs` | Explicit allowlisted schemas for all 15 stores; membership/settings validators |
| `security/service.mjs` | Trusted local mutation service using Admin SDK transactions and verified emulator Auth tokens |
| `firebase.security.json` | Local Auth on 9098 and Firestore on 8186; demo project only |
| `tests/phase2.validation.test.mjs` | Payload, compatibility and destination safety checks |
| `tests/phase2.security.test.mjs` | Actual rules/Auth/backend integration and atomicity checks |
| `tests/phase2-fixtures.mjs` | Synthetic data only; no production backup input |

The default `firebase.json`, `firestore.rules`, `public/index.html` and `public/sw.js` were not changed. No cache bump or hosting deployment was needed.

## Access policy implemented

- Operational reads require a named Firebase identity and a protected `staff/{uid}` membership with `active: true`, a `staff`/`admin` role and `facilityId: dopmc`.
- Custom `admin` token claims do not substitute for this protected membership.
- Staff can read their own membership status even when inactive, allowing a future UI to explain disabled access. They cannot list the staff directory or read other staff memberships.
- Administrators may list memberships. Neither staff nor administrators may modify them directly through Firestore clients.
- All client operational creates/updates/physical deletes are denied, including administrator requests. Mutations must use the authoritative command path.
- Ordinary members cannot directly replace metadata, remove the legacy document, change protected energy settings, disable maintenance or forge operation results.
- Audit reads are administrator-only; command outcome reads are limited to their active owner. All client audit writes/deletes are denied.
- Unknown collections/store names are denied by default.

## Trusted service implemented

The service refuses startup unless project `demo-hamms-security`, Firestore `127.0.0.1:8186` and Auth `127.0.0.1:9098` are all configured. Its optional HTTP listener binds to loopback only. It cannot be used as a cloud service without a deliberate future implementation change.

1. Verify the Firebase Auth emulator ID token; check that the underlying account still exists, is enabled and has the same email.
2. Reject unknown envelope fields, forged actor data and malformed operation IDs.
3. In a Firestore transaction, read current protected membership and write policy. A missing write policy fails closed.
4. Apply administrator checks inside the trusted service, since Admin SDK writes bypass rules.
5. Reconcile repeated operation IDs; reject changed requests reusing the same ID.
6. Validate business fields before writing. Generate new identity metadata on the server; require expected version checks for updates.
7. Preserve existing unknown fields and creation identity on an update. Legacy records lacking valid identity/version metadata are rejected for reviewed migration rather than silently rewritten.
8. Commit the operational mutation, audit event and outcome together. Failure to create the audit event rolls back the mutation and outcome.

Current commands:

| Command | Allowed actor | Behaviour |
|---|---|---|
| `createRecord`, `updateRecord` | Active staff/admin | Validated non-stock mutations with version/identity checks |
| `archiveRecord` | Active staff/admin | Preserves payload and ID; stamps archive reason/actor/time |
| `restoreRecord` | Active admin | Restores eligible archived records with expected version |
| `setMembership` | Active admin | Validates role/facility and real emulator Auth account; self-demotion/deactivation denied |
| `setMaintenance` | Active admin | Locks writes or unlocks service; even admins cannot bypass an active lock for ordinary mutations |
| `setEnergySettings` | Active admin | Requires bounded factor/baseline settings and factor provenance |
| `requestRestore`, `requestReset`, `requestPurge` | Active admin | Queues `awaiting-implementation-and-review` jobs only; performs no data replacement/deletion |

Every command requires a reason. Membership and maintenance are checked before returning an existing successful outcome, so a revoked user cannot use idempotent retry to regain access.

## Guardrails for subsequent phases

- Generic issuance writes are blocked until the Phase 4 ledger/transaction command exists.
- Inventory may be created with a zero opening balance and have descriptive metadata edited. Direct balance changes and inventory archive/restore are blocked until movement accounting exists.
- Work orders involving materials cannot use generic record/lifecycle commands. They require the Phase 4 stock transaction.
- New equipment WOs require a valid active asset reference. New room WOs require explicit room scope/location, and supplied location references must exist. Full location migration/history workflows remain Phase 5.
- Full restore/reset/purge is not implemented; submitting a privileged request is not approval or execution.
- Archive jobs do not physically delete original records. Complete archive search, bulk recovery and inventory compensation remain later work.
- Protected factor settings are not yet connected to bill snapshots or monthly uniqueness; those remain Phase 6.
- Any production correction of existing tags/classifications/links/dates/duplicates still requires a concrete preview and the user's verification, in addition to administrator review. No production membership seeding or existing-record mutation is authorized by these emulator tests.

## Validation coverage

Schemas bound string lengths, payload size, arrays, nested material/custom-parameter objects, numeric finiteness, nonnegative quantities, integer counts, percentages, enums, dates and date ordering. Protected record metadata and undeclared fields are rejected from business payloads. Explicit zero values and existing supported classification labels are preserved, not normalized.

Tests cover all 15 stores. Candidate schemas accept existing `For Replacement`, `Warning`/`Critical`, `Outdoor Watering`, nullable optional tank observations, and bounded effluent custom parameters. This does not certify all legacy/import variants; UI/import mapping and a read-only compatibility review are required before rollout. Invalid legacy values must remain unchanged and flagged for review rather than automatically corrected.

## Verification evidence

| Check | Result |
|---|---|
| Validation and safety unit tests | **133 passed, 0 failed** |
| Auth/Firestore rules and backend integration | **178 passed, 0 failed**, no retries |
| Existing recovery safety tests | **8 passed, 0 failed** |
| Total targeted tests | **319 passed** |
| Role/store read matrix | 6 actor states × 15 stores; active staff/admin allowed, all other operational reads denied |
| Direct mutation bypass tests | 2 active roles × 15 stores × create/update/delete: **90 rejected attempts** |
| Metadata/role/audit bypass checks | Staff and admin client attempts rejected |
| Membership revocation | Existing session loses operational reads and command access |
| Disabled Auth account | Existing token rejected by backend |
| Idempotency | Repeated identical command has one outcome; changed request with same ID rejected |
| Conflict | Stale expected version rejected; untouched legacy field retained |
| Audit coupling | Forced audit-create failure leaves no operational record or successful outcome |
| Archival | Original payload/ID preserved; staff restore denied; admin restore succeeds |
| Maintenance | Ordinary staff/admin writes blocked until admin unlocks |
| Dependency audit | **0 vulnerabilities** after gRPC resolution update |
| Production writes and deployments | **0** |

These are targeted emulator results, not a production concurrency/load certification. The 100-race/fault-injection gates in the plan belong to Phase 3/4. The original 449 browser tests were not rerun because this phase did not modify application UI code; browser command integration will require those tests and additional save/conflict coverage.

## Reproduce

Install dependencies with `npm install`. `package-lock.json` remains intentionally untracked per repository policy. Added dev dependencies: Firebase Admin SDK and Firebase rules-unit-testing. A compatible `@grpc/grpc-js` override resolves the vulnerable transitive version used by the existing Node Firebase SDK; the hosted CDN SDK was not changed.

```powershell
node --test tests/phase2.validation.test.mjs
node --test tests/recovery-core.test.mjs
firebase emulators:exec --project demo-hamms-security --config firebase.security.json --only 'auth,firestore' --non-interactive "node --test tests/phase2.security.test.mjs"
npm audit
```

Quote `'auth,firestore'` in PowerShell so both emulator names reach the CLI as one comma-separated argument. Do not run a deployment command with this config. Tests bootstrap only synthetic `.test` accounts, synthetic memberships and an emulator write policy; those are not production provisioning instructions.

## Deferred and deployment prerequisites

- No real staff membership registry or first administrator has been provisioned; that requires a reviewed operational roster before enforcement.
- No public endpoint, Cloud Function or browser integration was deployed. Emulator unsigned tokens are accepted only by the emulator-bound service; production must use verified production tokens and appropriate IAM.
- Membership deactivation is the immediate access control. Disabling Auth alone does not instantly invalidate already downloaded client data; coordinate membership revocation and future UI session cleanup.
- A production-safe server deployment adapter, read-only source/schema compatibility review, legacy version migration approval, staff bootstrap, preview update-required handling and Phase 3 acknowledged saves are prerequisites to rollout.
- Cloud staging/billing remains deferred by the user's instruction. Current preview still shares production Firestore and is not a write-test environment.
- The complete phase plan remains in `docs/remediation-plan-2026-10-14.md`.
