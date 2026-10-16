# Phase 6 — Energy, forecasts and dashboard calculations

Date: 16 October 2026, Asia/Singapore. Branch: `codex/phase-6-calculations-forecasts`.

## Scope and status

This is an isolated emulator implementation and verification checkpoint. Production operational data, hosted HTML/service worker, production rules/configuration, both hosted sites, Firebase billing and cloud staging are unchanged. No existing bill, date, tag, classification or relationship was corrected. A private backup was read for analysis only; its data hash remained unchanged.

Future hosting remains limited to the `normalized` preview channel. That preview shares production Firestore, so it is not write-test storage. Cloud setup remains pending the user's earlier emulator-only decision. Reconcile the newer preview source and production backend compatibility before any deployment; this report does not claim the hosted defects have been fixed.

## User-confirmed calculation rules

- Waste: last **12 completed Monday–Sunday weeks**, average only weeks with recorded observations, preserve observed zeroes, leave missing weeks blank and label next-week +5% as a **heuristic**.
- Projects: use positive-budget projects for weighted progress when any positive budgets exist; disclose excluded projects and valid-percentage coverage. If none has a positive budget, use the mean of recorded valid percentages.
- Previously confirmed rules remain: Resolved/Verified/Closed safety issues are inactive; risk budget concerns delayed or target-overdue unfinished projects; monthly energy bills are facility aggregates; only administrators manage shared energy settings and emission factors.

## Reproduced defects and fixes

### Energy inputs and estimates

The original calculator returned **24 kWh** for each of three synthetic cases whose quantity, hours or demand factor was explicitly zero. Truthy fallbacks replaced the zero values. The original save/reopen path also defaulted zero quantity/hours and hid zero factor values.

The shared pure calculator now distinguishes absent inputs from zero. It computes:

`kWh = watts / 1000 × quantity × hours per day × days per month × demand factor`

Zero watts is not replaced by HP. HP conversion applies only when watts is missing. Defaults apply only to missing quantity/factor or explicitly described type-based estimates; missing necessary inputs remain unavailable, and negative/nonfinite/out-of-range inputs are rejected/excluded. Existing stored inputs are not backfilled in bulk.

The local asset form exposes demand factor, preserves zeroes through acknowledged save/reopen, and records the calculated estimate. Current asset estimates, saved bill estimate snapshots and actual billed facility consumption are labelled separately. Charts keep absent months null; a missing month is not a zero observation. Asset and energy CSV exports preserve zeroes and leave unknown values blank, with saved-factor provenance in bill exports.

### Shared settings and historical factors

Browser-local energy settings and undocumented default emissions are no longer the candidate's source of truth. The emulator exposes protected shared settings and immutable factor records:

- `publishEnergyFactor`: administrator-attested source citation, publication date, applicability dates, grid region, explicit `kgCO2e/kWh` unit and unique positive region/version. Publishing does not change settings or old bills.
- `configureEnergy`: administrator-only expected-version update of baseline year, reduction target and selected factor. Zero targets/factors are valid. The selected factor must belong to the configured region.
- The old settings command can initialize an unverified configuration only when no shared document exists; it cannot overwrite existing versioned settings.
- New bills receive a protected factor/settings snapshot only when the selected verified factor covers the **entire bill month**. Otherwise carbon is unavailable. Factor source verification is an administrator's recorded attestation, not an automated proof that a citation is authoritative.
- Later factor/settings changes update **zero historical bill snapshots**. Existing unverified bills remain unverified after ordinary edits; no historical factor is guessed or backfilled.

Bill, snapshot, period reservation, audit and command outcome are committed together. `/energyBillPeriods/dopmc_YYYY-MM` enforces one facility bill per month. Existing or archived legacy bills also block a new duplicate even before reservations exist. Archival retains the reservation; restore/edit the same bill instead of creating a replacement. Existing period changes require a separately reviewed correction. Client writes to factor, version, settings and reservation documents are denied, including administrator clients.

The view discloses month/bill counts, invalid records, duplicate-period quarantine and saved-factor coverage. Carbon totals remain unavailable when any included bill lacks a verified saved factor. Baseline comparisons use common observed months only and disclose unmatched current months; an asset estimate is not treated as a measured historical baseline. The June anomaly is flagged for original bill/meter verification without modifying its source values.

### Work-order forecasts

Only Open/In Progress WOs are forecast rows. Completed/Closed records supply section-specific elapsed-calendar-day averages. Invalid/missing/reversed/future completion dates are excluded, and `PLBG-HI-0001` remains excluded pending source-date verification. This is a read-time exclusion, not a stored reclassification.

Zero-day observations are valid and can project the start date. Each row shows valid/excluded counts and date coverage. Missing history produces **Insufficient history**, never an evidence-free On Track result. Valid target-date overdue status is shown independently of whether a completion estimate exists. Section means are described as estimates, not guaranteed deadlines or statistically validated predictions.

### Waste forecasts

The candidate distinguishes No source records, No records in analysis window and Unsupported category. It states window boundaries, method, observation coverage and exclusions. Recorded zero weeks count in the mean; absent weeks remain missing in the table and are not filled with zero. The +5% value is explicitly a heuristic. Unsupported classifications remain visible in the source table and are not mapped or retagged. Treatment logs and the earlier screenshot are not reconstructed as waste-generation observations.

### Safety and projects

Active safety counts consistently exclude Resolved, Verified and Closed, including dashboard badges. Resolution duration uses valid actual logging/resolution pairs only; last update/today is not invented as a resolution date.

Project progress follows the confirmed positive-budget weighting and reports observation coverage. On-time completion uses only actual/target date pairs. Risk budget is unavailable if some at-risk projects lack valid budgets; a known subtotal and coverage are shown separately. The synthetic S-curve and inferred expenditure/history displays are replaced with explicit missing-evidence explanations. Current status/progress snapshots are not historical observations.

## Read-only snapshot verification

Private evidence: `D:/Projects/DOPMC/hamms-recovery/backups/2026-10-14T15-42-41-705Z/analysis-review-final.json`.

| 14 October snapshot analyzed as of 16 October | Result |
|---|---:|
| Active WO forecast rows | 3 |
| Completed records excluded pending source-date verification | 1 |
| Waste forecast source | No source records |
| Valid unique 2026 energy bills | 6 |
| Bills without saved verified factors | 6 |
| Assets reviewed | 472 |
| Estimates calculable from stored inputs/default rules | 470 |
| Missing/invalid asset estimates | 2 |
| Input data hash changed / proposed writes | No / 0 |

Three forecast rows are correct for that dated snapshot: closed WOs supply history rather than active forecast rows. The report's 2022 baseline is a labelled scenario from the legacy default, not an approved new shared baseline. All existing records and the June consumption/bill anomaly are retained. The report and backup remain outside Git and `public/`; the earlier preliminary report is retained separately and not overwritten.

Regenerate only to a new private output:

```powershell
node scripts/preview-analysis-review.mjs <private-typed-backup> <new-private-report-path>
```

## Verification

Mutating tests use synthetic accounts/data in loopback Auth/Firestore project `demo-hamms-security`. The final results table below records distinct cases; race-loop iterations are not counted as additional unit tests. Passing emulator samples do not certify production latency, concurrent backend instances or prediction accuracy.

| Verification | Final result |
|---|---|
| Recovery, schema, controller, stock, relationships and calculation domain tests | 265 passed |
| Access/rules/backend regression | 178 passed |
| Confirmed-save browser/backend regression | 15 passed |
| Stock backend/rules regression | 22 passed |
| Stock browser regression | 8 passed |
| Relationship backend/rules regression | 18 passed |
| Relationship browser regression | 9 passed |
| Energy authority/rules scenarios | 14 passed |
| Calculation/settings/forecast browser scenarios | 9 passed |
| Total distinct targeted cases | **538 passed** |
| Explicit-zero energy matrix | 5 fields each yield exactly 0 kWh; each survives browser save/reopen |
| Positive energy formula | Independent expected fixture agrees exactly within 0.01 kWh |
| Same-period bill creation | 100 concurrent pairs: exactly 1 bill and 1 reservation per period; 100 duplicate attempts explicitly rejected |
| Historical factor changes | Saved bill payload/snapshot unchanged after factor version change |
| Shared settings | Staff writes denied; two browser sessions read identical shared state; stale settings update rejected |
| Protected factor/settings/period mutation attempts | 18 direct staff/admin writes rejected |
| Failure/retry checks | Audit collision leaves no bill/reservation/outcome; repeated bill operation has one effect; lost factor response reconciles with one publication |
| WO/waste correctness | Zero-day estimate preserved; invalid/questioned durations excluded; missing/unsupported/empty states and observed waste zeroes verified |
| Project/safety correctness | Independent expected weighted progress 65%, financial utilization 40%, known risk budget 400; inactive safety states and missing-date coverage verified |
| Earlier concurrency gates rerun | 100 stale-edit pairs, 100 repeated-operation pairs, 100 insufficient-stock pairs, 100 repeated-receipt pairs passed |
| Earlier ordinary command timing | 100 healthy samples; p50 107.3 ms, p95 111.3 ms, p99 119.7 ms; loopback HTTP acknowledgement only |
| Mobile review | 390×844 settings/forecast screenshots generated; settings screenshot inspected; no tested horizontal page overflow |
| Dependency audit | 0 vulnerabilities |

The first broad run caught an older test fixture trying to create an October bill when October was already seeded. The new duplicate rejection was correct; the valid-create fixture now uses an unused November period. This fixture change does not loosen the duplicate rule. The subsequent complete application test chain exited 0, with every suite passing, but Firebase CLI later returned a nonzero code because of a timeout during shutdown after the emulators stopped. Listener cleanup was checked and a fresh 14-backend/9-browser rerun completed with exit 0 and normal shutdown. This CLI issue is distinct from application test failures. No automatic retries or loop iterations are counted as extra passing cases.

The existing hosted Playwright specification suite was not rerun because hosted source was untouched; earlier supplemental counts are not included in 538. Prediction accuracy was not measured: real waste history is absent and the +5% model is explicitly heuristic.

```powershell
node --test tests/recovery-core.test.mjs tests/phase2.validation.test.mjs tests/phase3.client.test.mjs tests/phase4.domain.test.mjs tests/phase4.review.test.mjs tests/phase5.domain.test.mjs tests/phase6.domain.test.mjs
firebase emulators:exec --project demo-hamms-security --config firebase.security.json --only 'auth,firestore' --non-interactive "node --test tests/phase2.security.test.mjs && node --test tests/phase3.integration.test.mjs && node --test tests/phase4.stock.test.mjs && node --test tests/phase4.browser.test.mjs && node --test tests/phase5.relationships.test.mjs && node --test tests/phase5.browser.test.mjs && node --test tests/phase6.energy.test.mjs && node --test tests/phase6.browser.test.mjs"
npm audit --omit=optional --audit-level=low
```

Interactive review uses [the existing fresh emulator instructions](phase-3-confirmed-saves.md#run-locally). Sign in with synthetic accounts, use the asset energy tab, view WO/Waste Forecast, and open Energy settings as the demo administrator. Supply only clearly synthetic factor sources/values for drills. No default factor is presented as an official recommendation.

## Remaining gates

No real factor/baseline selection or source correction is approved by this implementation. Verify original evidence and present concrete before/after previews to the user before changing real bills, dates, classifications or links. Historical migration remains pending. Extend protected backups/recovery to the new factor/version/period collections and all earlier-phase protected metadata before production integration. Cloud billing/staging, multi-instance testing, newer-preview reconciliation and deployment remain pending.

Next is Phase 7: archive/audit consistency and resumable, reviewable restore/reset, including expanded backup coverage. Keep recovery/write drills isolated and retain operational archives indefinitely until an administrator approves permanent removal.
