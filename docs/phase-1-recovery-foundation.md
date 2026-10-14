# Phase 1 — recovery foundation

Date: 14 October 2026 (Asia/Singapore).

Branch: `codex/phase-1-recovery-foundation`, created from local `main` at `137bc38`.

Status: **Local backup/emulator recovery milestone complete within the user-accepted scope.** The user selected “Keep emulator isolation for now; leave cloud setup pending.” Deferred cloud gates below remain unfulfilled; this is not full production disaster-recovery certification.

## Preservation and deployment constraints

All existing production records, IDs, tags, classifications and links remain unchanged by this work. Proposed existing-data corrections must be previewed and verified by the user before execution. This requirement is recorded in `AGENTS.md` and the remediation plan.

Only the `normalized` hosting channel is authorized for future preview deployments. Do not run `firebase deploy`, which would target live hosting/rules by default. Do not push to `main`.

The requested preview URL serves v2.13.5 and uses `getFirestore(app)` in `demoapp-7864a`, the same default database as the main site. Hosting preview is not database isolation. Current main source serves an older release; no preview overwrite was performed.

## Implemented

- Read-only production backup tool: `scripts/backup-firestore.mjs`.
- Explicit scope: all documents in 15 HAMMS operational record collections, `/hammsMeta/state`, and `/hamms/mainData` if present. This is an operational-data backup, not an export of Firebase Auth users or all possible unrelated project collections.
- All Firestore queries and metadata reads use the same recent `readTime`, producing a consistent record snapshot even if other users continue working.
- Original document paths and Firestore typed fields retained. Large integer strings, timestamps, arrays, zero values and original record metadata are not converted through application normalization/stamping.
- Per-document hashes, aggregate dataset hash, store counts, and explicit missing metadata/legacy paths.
- Current main/preview HTML, service worker, manifest and deployed rules saved with the private backup for recovery reference.
- Database, billing, PITR and scheduled-backup inventory captured read-only.
- Recovery destination constrained to a loopback emulator and `demo-hamms-recovery`; refuses nonempty target stores, cloud destinations and redirects. Production restore is not implemented.
- Alternate emulator config `firebase.recovery.json`; default deployment configuration unchanged.
- Private backup directory restricted to the current Windows account and SYSTEM, outside the repository and hosted directory.

## Verification results

| Measure | Result |
|---|---|
| Backup read time | `2026-10-14T15:39:53.383Z` / 23:39:53 Asia/Singapore |
| Operational records | 960 |
| State document | 1 |
| Legacy shared document | Absent, explicitly recorded |
| Total expected/restored documents | **961 / 961** |
| Matching typed-payload/document-path hashes | **961 / 961 — 100%** |
| Missing/mismatched documents | **0 / 0** |
| Local restore/readback duration | **2.769 seconds** initially, **2.611 seconds** after redirect hardening; excludes emulator startup and full incident response |
| Recovery safety unit tests | **8 passed, 0 failed** |
| Firebase production writes by these tools | **0**; production API use is reads and snapshot queries only |
| Hosting/rules deployment | None |

Dataset hash: `65c1aea169ceb51d95e252f45baa8683eb1c5e63efb8698e63eefd504a11d3e0`.

Private backup: `D:/Projects/DOPMC/hamms-recovery/backups/2026-10-14T15-39-57-530Z/firestore-backup.json`.

Private restore report: same directory, `restore-drill-report.json`. Raw backup contents are never committed or hosted.

A second consistent-time snapshot at `2026-10-14T15:42:37.684Z` matched the first snapshot's dataset hash exactly. Its private directory is `D:/Projects/DOPMC/hamms-recovery/backups/2026-10-14T15-42-41-705Z/`. Main and preview hosting file hashes also matched across both captures. This verifies retained document payloads and unchanged hosting during this work; it does not establish a future retention guarantee or scheduled backup service.

System-generated Firestore create/update timestamps are retained in the source backup but will differ in a restored database. Application `_updatedAt`, `_updatedBy`, `_v`, `_docId`, numeric IDs and other typed payload fields matched exactly.

## Commands

Create a new private snapshot:

```powershell
node scripts/backup-firestore.mjs
```

The tool defaults to a timestamped directory under `D:/Projects/DOPMC/hamms-recovery/backups/`. It requires the existing authorized Firebase CLI account and refuses backup output inside the repository. The containing private directory's Windows ACL must remain restricted; the tool's file mode alone is not an ACL guarantee on Windows.

Run safety checks:

```powershell
node --test tests/recovery-core.test.mjs
```

Restore and reconcile only in the local recovery emulator:

```powershell
$env:HAMMS_RECOVERY_BACKUP = 'D:/Projects/DOPMC/hamms-recovery/backups/2026-10-14T15-39-57-530Z/firestore-backup.json'
firebase emulators:exec --project demo-hamms-recovery --config firebase.recovery.json --only firestore --non-interactive "node scripts/restore-drill.mjs"
```

The emulator shuts down after the drill. A failed drill must be investigated; do not use the production default database as an alternative restore destination.

## Outstanding cloud gates

The read-only inventory found one default Firestore database in `nam5`, billing disabled, PITR disabled, and no configured scheduled backup entries. No billing plan was changed and no scheduled recovery feature was enabled.

Phase 1's local backup/restore foundation is verified and accepted as the current scope. Full cloud staging and managed disaster recovery are deferred by the user's selection. The proposed ≤24-hour recovery point objective is not achieved by manual snapshots, and the ≤2-hour production recovery target cannot be certified from an emulator restore time.

Also pending: isolated cloud Auth/Storage/backend equivalents, Storage binary backup/attachment completeness, real cloud restore drill and IAM verification, server-enforced maintenance controls, named operational/release owner and source-recovery reconciliation from Phase 0. No production maintenance lock was activated or operational metadata altered.

The backup protects inline attachment fields contained in Firestore. It does not download externally stored image/report binaries or export Firebase Auth credentials/users.

## Next steps

1. Reconcile source compatibility before preparing a preview deployment; keep the main site and existing records unchanged.
2. Implement and test protected staff permissions and maintenance/mutation infrastructure in the emulator when Phase 2 is authorized. Do not treat emulator code as deployed cloud protection.
3. Present any concrete tag/classification/link correction proposal to the user for verification before applying it.
4. Revisit deferred cloud/recovery gates only when the user elects to proceed with cloud setup. Keep their status visible in release evidence.
