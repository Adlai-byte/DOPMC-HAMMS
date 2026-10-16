# Phase 7 — Archive evidence and reviewed recovery jobs

Date: 16 October 2026, Asia/Singapore. Branch: `codex/phase-7-recovery-jobs`.

## Scope

The candidate implements recovery in the isolated Auth/Firestore emulators only. It cannot target `demoapp-7864a`, accept a cloud Firestore host or run outside the configured demo project. No production data, classifications, links, Firebase configuration, hosting, billing or production rules were changed. The hosted HTML and service worker remain unchanged.

Existing operational records require the user's verification of a concrete preview before changes. The new workflow records an administrator's explicit attestation and verification reference against the exact preview hash. Synthetic test attestations apply only to generated emulator records. They are not approval for any real-data operation.

## Implemented behavior

- Staff archive and administrator record restore atomically preserve the original record, including unknown legacy fields, under protected `archiveSnapshots`. Snapshot, mutation, audit and outcome share the command transaction. WO archival/restoration preserves materials and stock balances; it does not imply a physical return.
- Audit events include outcome, actor, reason, operation identity and versions. Direct client writes remain denied for administrators and staff. Recovery batches record each affected path, original/result hashes and versions with a trusted commit timestamp.
- Typed-v2 backups explicitly cover all 15 stores, locations, stock ledgers/movements, identity/code/period reservations, factor/settings records, correction/relationship proposals, membership metadata, audit/archive evidence and job/operation metadata. Each document has a hash; manifests contain per-collection counts, dataset hash and attachment field hashes. Credentials and Auth passwords/tokens are excluded.
- Document IDs and typed fields are preserved: int64 strings, explicit double zero, bytes, geographic points, document references, arrays/maps and canonical Firestore timestamps. Sub-microsecond/noncanonical timestamps are rejected before writes because Firestore truncates unsupported precision. External attachment links block recovery pending a verified binary backup workflow; embedded attachment data remains in the typed payload.
- Merge updates specified records without removing omitted records. Full-coverage replacement restores specified records and **archives** omitted operational records. It retains omitted supporting records and historical evidence. Reset archives operational records and preserves physical quantities and accounting links. This is intentionally a retention-preserving reset, not a new inventory opening balance.
- Purge is a separately staged, verified operation against explicit archived paths. Accounting records (`inventory`, `issuance`, `wo`) and records with retained references/reservations fail closed. Permanent removal has no automatic timer. A verified private pre-operation snapshot remains recoverable after an approved purge.
- Membership, locks, job metadata and previous command outcomes are covered as backup evidence but never imported into authority. Existing immutable factors, reservation identities and audit/accounting evidence cannot be overwritten by an import. Conflicts or unresolved reference checks reject staging.
- Versioned operational records and shared energy settings advance beyond both existing and imported versions. Rollback restores business fields while advancing versions again, so a draft from before recovery fails its expected-version check. Unversioned legacy data is retained as such; restoration does not implicitly migrate identities.

## Recovery protocol

1. An active named administrator exports an emulator backup or supplies a complete typed-v2 backup. The service validates scope, typed values, document hashes, manifests, attachment coverage and proposed references before operational writes.
2. `stage` records a durable job and a private payload plan outside the repository. The preview contains additions, updates, archival/purge paths, exact before/after typed fields, protected settings, evidence conflicts and unresolved references. Staging changes no operational record or maintenance state.
3. `approve` requires the preview hash, `userVerified: true`, a verification reference and an approval reason. Approval alone performs no operational change.
4. `start` atomically takes ownership of maintenance. A consistent snapshot after locking must match the reviewed baseline. A changed baseline aborts without operational changes and requires a new preview. The service writes, flushes, reads back and validates the pre-operation snapshot before any batch.
5. Explicit `step` calls perform up to 100 documents and approximately 7 MB of payload per batch. Each transaction rechecks membership, lock ownership, cursor, plan hash and original payload hashes. Record writes, checkpoint and batch audit commit together. Duplicate/lost responses are resolved by reading the durable cursor.
6. On interruption the maintenance lock remains active. A restarted service can load the same private plan and continue. Ordinary commands cannot write while the job owns maintenance; even an administrator's generic maintenance command cannot unlock it.
7. Finalization checks every written hash and reconciles the expected dataset/count before recording one successful outcome and releasing maintenance. Any mismatch retains the lock. Job/audit/operation metadata created by recovery is excluded from the operational dataset hash; imported evidence is still checked against its intended hash.
8. Before finalization, an administrator may request rollback. The service verifies the pre-operation snapshot, reverses only committed batches with durable checkpoints, preserves recovery audit events and reconciles the recovered business payloads before unlocking. Records introduced solely by the approved import may be removed by that rollback; source and original payloads remain in private plans/snapshots.

Multi-batch recovery is **not globally atomic**. Authorized reads can observe intermediate data while maintenance is active; no ordinary write is accepted. Do not present a partial dataset as a completed recovery. A future generation switch would require a separate read-path/rules design.

Recovery field metadata and archival dates are prepared at the server's preview time so the verified payload hashes remain deterministic across retries. `_recoveryPreparedAt` identifies that time; imported `_committedAt` remains historical provenance. The immutable batch audit's `committedAt` is the actual trusted recovery commit time. Do not infer recovery completion time from a restored record's historical commit field or preview timestamp.

The old `requestRestore`, `requestReset` and `requestPurge` commands remain nonexecuting compatibility requests. Submitting an old queued request cannot suddenly run a destructive operation. Only the new explicit review protocol can execute a job.

## Local operator workflow

Use the existing security emulator configuration (`demo-hamms-security`, Auth 9098, Firestore 8186), seed synthetic accounts with `scripts/seed-phase3-demo.mjs`, then run `scripts/phase3-local-server.mjs` with the exact emulator environment variables. The loopback browser harness exposes **Recovery (emulator)** to administrators.

Select merge/replacement/reset/purge, supply the backup or explicit purge paths, enter a reason and stage the preview. Expand the complete payload preview and verify it before recording the verification reference. Approve, start, then explicitly run/resume. Read job status after a lost response; no write replays automatically on reconnect or reload. A job ID is retained per account in session storage; payloads and tokens are not stored there. Sign-out clears the visible preview and file selection. Successful completion refreshes the active browser dataset from the server.

The private staging root defaults to `D:/Projects/DOPMC/hamms-recovery/emulator-jobs` when launched from this repository. It is outside Git and `public/` and has no static download route. Test snapshots use private OS temporary directories containing synthetic data only. Preserve both Firestore job metadata and its private plan/pre-operation files until the operator explicitly approves their removal.

## Verification

The final candidate passed **587 distinct targeted cases**, without test retries. The complete emulator command chain exited successfully and shut down its emulators. No production Firebase test writes were used.

| Suite | Passed |
|---|---:|
| Recovery/schema/controller/stock/relationship/calculation units, including 27 Phase 7 domain cases | 292 |
| Phase 2 security | 178 |
| Phase 3 integration | 15 |
| Phase 4 stock / browser | 22 / 8 |
| Phase 5 relationships / browser | 18 / 9 |
| Phase 6 energy / browser | 14 / 9 |
| Phase 7 recovery / browser | 16 / 6 |
| **Total** | **587** |

The final 5,000-record drill took **37.923 seconds**, including staging, verification, snapshot work, 50 committed batches, simulated interruptions, service restart and reconciliation. All 5,000 expected record payloads matched their approved target fields, including the int64 `9007199254740993`, explicit double zero and microsecond timestamp fixture. The test observed zero duplicate batch effects. Three additional independent interrupted restore/resume drills passed; the interrupted reset rollback restored original business fields and stock quantity while advancing versions. These are local measurements, not cloud guarantees.

Synthetic evidence is generated under ignored `test-results/phase7-recovery-metrics.json` and `test-results/phase7/recovery-mobile.png`. The mobile screenshot was visually inspected. The final private synthetic snapshot directory was `C:/Users/THEJORJ/AppData/Local/Temp/hamms-phase7-MpftEU`; it is outside Git and contains no production records. Earlier failed runs exposed an undefined-value serialization mismatch, unsupported sub-microsecond timestamp truncation and a CSS rule overriding a hidden button; each was corrected before the final passing run.

Automated suites cover:

- 5,000 synthetic operational records restored in 50 checkpointed batches, payload hashes/counts reconciled, large int64 and typed zero retained; interruption before the first batch, after a middle batch and before finalization, including service restart.
- Three additional independent interrupted restore/resume drills and a rollback drill; zero duplicate batch effects, active maintenance during incomplete work and preserved stock quantity.
- Invalid manifests/partial replacement, unapproved/stale previews, tampered private plans, out-of-band writes, deactivated administrators, staff access and direct protected-collection mutation.
- Original archive snapshots, one logical command audit/outcome, restore/rollback version advancement and stale-draft rejection.
- Browser role visibility, safe preview text, verification gate, maintenance/completion refresh, lost response reconciliation, reload without replay, sign-out clearing and a 390×844 mobile layout.

Run Node unit suites directly. Run emulator-backed suites under `firebase emulators:exec --project demo-hamms-security --config firebase.security.json --only 'auth,firestore'`. New suites: `tests/phase7.domain.test.mjs`, `tests/phase7.recovery.test.mjs`, `tests/phase7.browser.test.mjs`. Browser tests reuse `tests/helpers/emulator-bootstrap.mjs`.

## Remaining release gates and operating cost

This phase does not enable cloud recovery, schedules, billing or a production-capable backend. The typed-v1 production backup remains untouched and is not accepted as a complete typed-v2 replacement; a reviewed expanded backup/compatibility process is still needed. Auth account recreation, IAM, cross-project reference mapping, Storage binary recovery and recovery from loss of the private staging disk are not proven by these emulator drills. Malformed or missing private files fail closed and need operator recovery from a separate verified copy; the tests simulate process/network interruptions, not physical disk loss or power failure during file creation.

The proposed 24-hour cloud recovery-point objective is not achieved by an on-demand emulator snapshot or the earlier dated production backup. Scheduled cloud backups remain pending by the user's decision. Local drill duration measures only this fixture/environment and does not establish a cloud recovery-time guarantee.

Cloud operation would incur reads for consistent backup, staging, baseline verification, batch validation and final reconciliation; writes for changed records plus checkpoints/audits/job outcomes; storage for current data, retained archives, immutable audit events and multiple verified private snapshots; and compute/egress charges. The 5,000-record fixture needs 50 forward batch transactions, at least 5,000 operational writes and 100 checkpoint/batch-audit writes, plus control writes and repeated validation reads. Reads also include unchanged protected metadata and increase with retained history. Emulator time is not a cloud cost estimate. Obtain an approved billing/staging/storage plan and measure actual cloud usage before rollout.

Next is Phase 8: scoped reads/pagination, measured performance, protected attachment storage and module/PWA compatibility. Phase 9 remains the separate release/preview rollout gate. Neither hosted site should be described as fixed by this local checkpoint.
