# Troubleshooting assessment and phased implementation plan

Reviewed 11 October 2026 against local commit `538b89f` on `codex/reliability-fixes`. Source: `D:/Projects/DOPMC/Need troubleshooting.docx`, including its screenshots and carbon-accounting requirements. This is an assessment, not an implementation or deployment. Screenshot figures are not independently verified production data. Proposed dashboard screenshots are design references, not acceptance-test datasets.

## 1. What already exists, and what remains wrong

| Area | Finding | Evidence / status |
|---|---|---|
| Asset repair history | Existing defect: individual history requires an exact asset-name match; room history has broader location matching. | Reproduced with `FLOURESCENT TUBE 18W` versus `Flourescent Tube 18 Watts`: individual history empty, room history includes repair. `public/index.html:4850`, `:11735`. The screenshot also contains potentially distinct asset batches; it does not prove every room repair belongs to every similar asset. |
| Deletion | Shared staff deletion is already permitted. The screenshot instead shows an application version conflict. | `firestore.rules:29`; transaction checks around `public/index.html:3687`. The affected production document/version still needs examination. Actual concurrent edits, stale state, or legacy records absent from per-record storage are candidates, not established causes. |
| Lighting classification | New code generation already recognizes compact bulbs and both fluorescent spellings. Existing OT codes have not thereby been corrected. | Local generation returns `LB-ELEC-DIET-01` and `FL-ELEC-RAMP-01`. Inspect stored classification before migration; changing a label alone does not repair asset relationships. |
| Asset code uniqueness | Existing defect: counting matching records plus one can reuse a code after deletion. CSV import also needs batch-aware allocation. | Reproduced existing suffixes 01 and 03 generating 03. `public/index.html:5652`; inspect import path around `:5104`. Display codes must remain separate from immutable record identity. |
| Safety KPI consistency | Existing defect: filtered table and summary count different populations; definitions of active/open vary across dashboard functions. | Reproduced one Low-severity table row while summary still counts both Critical and Low. `public/index.html:6437`, `:6480`, `:8325`; dashboard logic around `:6332`. Critical-first sorting also uses a falsy zero fallback and needs correction. |
| Enhanced safety dashboard | New feature, not merely a broken existing chart. | Due date, responsible person, closure/resolution timestamps and status history are missing from saved safety data around `public/index.html:6415`. Overdue and historical resolution metrics need those fields. |
| Work-order forecast | Existing forecast deliberately includes Open/In Progress only. Some edge cases are defective; screenshot-specific missing entries are unconfirmed. | `public/index.html:5281`: zero-day averages produce no projection, unknown sections can show `undefined days`, missing history can still show On Track. Current overdue helper requires a target date, so the screenshot's No date/Overdue combination needs record/version reproduction. |
| Work-order numbers | Mixed old/new formats already exist by design. | `public/index.html:5603` adds a random suffix for collision resistance. The suffix is not evidence of corrupted data. Preserve existing references until a numbering policy is agreed. |
| Project KPIs | Existing defect: date/status filtering affects the table but not the status cards. | Reproduced one 2026 table row with two total projects on cards. `public/index.html:6557`, `:6581`. |
| Enhanced project dashboard | New feature. Current records support some summary metrics but not historical curves. | Five status cards already exist. Monthly planned/actual progress and expenditure require snapshots or dated ledger entries. Current percentages cannot reconstruct past months. |
| Energy year filtering | Existing runtime defect. | Reproduced `Assignment to constant variable.` when selecting a year. `public/index.html:7947` reassigns a const. This interrupts later rendering. |
| Energy calculation | Existing defect: explicit zero values can become nonzero defaults. | `public/index.html:5937`. A 100 W asset, 10 h/day, 30 days and load factor 0 produced 30 kWh instead of zero. Quantity and operating-hour zero handling also require coverage. |
| Energy reconciliation | Existing scope mismatch and unverified source-data anomaly. | Cards/table, charts and annual summaries do not consistently use the same filters/period. Current asset estimates differ in basis from historical bill snapshots. June's small kWh alongside a large bill needs original-bill review; do not invent a corrected value. |
| Carbon settings | Configurable, auditable factor management is missing. | Code/help hard-code 0.491 kg/kWh and make inconsistent grid descriptions. The mockup's 0.85 is not verified either. Use an applicable, sourced factor rather than choosing a screenshot value. |

Other reliability mechanisms already present include versioned per-record writes, online-only saving, retained unsaved form input, and administrator restrictions for restore/reset. Preserve these safeguards. This assessment did not repeat all previous deployment or production-auth checks.

## 2. Phase 0 — Establish evidence and metric definitions

**Priority:** first; prerequisite for data corrections.

- Take an administrator export and preserve record IDs, versions and relationships. Record deployed version, service-worker version and source commit.
- Build a discrepancy register from the document: affected record ID, page, filters, expected result, observed result and reproduction steps.
- Inspect the specific deletion failure: local base version, server version, document existence, authentication and legacy source. Distinguish permission denial, connection failure and conflict in diagnostics.
- Reconcile the apparent missing work orders against status/date filters and non-asset work. Inspect the No date/Overdue row using its actual values.
- Check original energy bills, units, multiplier, billing period and meter scope, especially June. Current UI enforces one bill per month; decide whether this represents a facility aggregate or whether multiple meters must be supported.
- Define terminal safety statuses, closure versus resolution, reporting-date basis, project progress weighting, due-date rules and what budget at risk means.

**Exit criteria:** reproducible defect list, preserved backup, agreed metric dictionary and explicit unresolved data questions. No speculative edits to production records.

## 3. Phase 1 — Repair save/delete recovery and rendering failures

**Priority:** highest functional reliability.

- Correct the energy year-filter exception and test selected-year, all-years and empty datasets.
- Correct valid-zero energy inputs while distinguishing zero, missing, invalid and default values. Display assumptions where estimates use defaults.
- Classify transaction conflicts accurately. Offer reload/review/reapply where appropriate while preserving unsaved input. Retrying a stale base must not silently overwrite another user's update.
- If legacy-only records cause conflicts, prepare an administrator-run, idempotent migration into per-record documents. Use a dry run, consistent identity mapping and checkpoint/reporting. Do not bypass version checks or loosen rules to make deletion succeed.
- Treat an already-absent record as an explicit reconciliation case; ensure stale snapshots cannot resurrect it. Confirm staff edit/delete and administrator-only restore/reset still behave as agreed.

**Exit criteria:** emulator tests cover staff deletion, concurrent edit/delete, missing remote document, retry, reconnect and legacy migration. A successful save/delete survives a fresh session; failed actions retain recoverable input and truthful status.

## 4. Phase 2 — Repair asset identity, classification and historical links

**Dependency:** reliable persistence and migration controls from Phase 1.

- Add a stable asset document reference to asset-related work orders; keep a display-name snapshot for historical readability. Permit explicit non-asset/location work.
- Match history primarily by stable reference. Use spelling/case/unit normalization only to propose legacy matches; require review for ambiguous batches or duplicates.
- Preview lighting classification corrections and old-to-new display codes. Preserve old codes as aliases and retain immutable IDs. Do not automatically merge the RAMP records solely because the names and location resemble one another.
- Replace count-based numbering with collision-safe allocation covering deletions, edits, imports and simultaneous users. Allocate against both persisted and staged import records.
- Update import/export and edit flows to preserve identity, classification and relationships.

**Exit criteria:** renaming an asset does not lose history; same-name assets in different rooms/batches stay distinct; codes remain unique after deletion/import/concurrent creation; dry-run and repeated migration produce no extra records or lost links.

## 5. Phase 3 — Unify filtering and repair work-order forecasting

- Create shared selectors and calculation functions so cards, charts, tables and exports use the same declared reporting scope. Clearly label any intentionally all-time metric.
- Apply the same safety status semantics everywhere and fix Critical-first ordering. Apply project filters to project status cards.
- Include useful work-order description/location context when an asset is absent. Explain which statuses are included in the forecast.
- Compute duration averages from valid completed records only; handle zero-day jobs, unknown sections, invalid/negative durations and insufficient samples.
- Separate deadline status from statistical forecast confidence. No history means insufficient data, not an unsupported On Track claim. Show sample size and calculation basis.
- Preserve existing WO references; improve display/search without unrequested global renumbering.

**Exit criteria:** fixture totals reconcile across every filter combination; forecast tests cover no target, overdue target, zero-day duration, no history, invalid dates and unknown sections. Missing rows are explained by scope or traced to a specific defect.

## 6. Phase 4 — Add the safety dashboard

- Add target date, responsible person, resolved/closed timestamps and versioned status transitions, with validation.
- Implement the requested total, active high/critical, overdue, closure-rate, resolution-time and highest-risk-location metrics using the agreed definitions.
- Add severity, opened/closed trend, location/asset, aging and status views; remove the duplicated monthly chart.
- Link charts/cards to their underlying filtered records and show denominators, period and missing-data counts.
- Record unknown legacy dates honestly. Do not substitute record update times for resolution dates or fabricate historical outstanding counts.

**Exit criteria:** hand-calculated fixtures match all cards/charts; reopened/resolved/verified cases have explicit behavior; unknown historical dates are excluded or marked rather than guessed.

## 7. Phase 5 — Add project performance reporting

- Retain the existing status summary and add documented physical/financial progress, on-time completion, due-soon/overdue and budget-at-risk measures.
- Decide whether progress is simple or budget-weighted and whether financial progress means expenditure or another explicitly defined measure.
- Introduce dated progress observations, plan baselines and expenditure records where required. Preserve baseline revisions and avoid overwriting prior observations.
- Build status distribution, planned-versus-actual progress, budget-versus-expenditure and completion forecast views. Identify projections as estimates with a basis and confidence limitation.
- Define due-soon as a precise window, e.g. the next 30 calendar days excluding completed projects, subject to Phase 0 agreement.

**Exit criteria:** fixtures verify weighting, zero budgets, missing dates, late completions and filtered populations. Historical charts show only supported observations; current percentages are not backfilled as invented monthly history.

## 8. Phase 6 — Establish energy and carbon accounting

- Reconcile bill data first. Use explicit full-year/YTD coverage and compare equivalent periods. Display missing months rather than silently treating them as observed zero usage.
- Distinguish billed facility consumption from asset-level estimates. Never add them together; category/top-asset charts are estimates unless measured attribution exists.
- Preserve the estimation basis and factor snapshot used for each reporting period; changing today's assets/settings must not silently rewrite historical reports.
- Add a factor registry with value, unit, grid, source URL/document, applicable period, effective date and status. Confirm the appropriate method and reporting factor from the [DOE National Grid Emission Factor source](https://doe.gov.ph/national-grid-emission-factor). Neither the existing 0.491 nor mockup 0.85 is accepted as official merely because it appears in the app/document.
- Implement billed kg CO2e = actual kWh × factor; tonnes = kg / 1,000. Estimated asset kWh = rated W / 1,000 × operating hours × days × load factor × quantity.
- Implement baseline reduction with equivalent coverage and a positive baseline. For avoided emissions, use a common factor to isolate consumption changes or separately disclose the factor effect. Allow negative savings where consumption increased.
- Explain that kg CO2e/kWh equals the selected factor when it is constant; this is not an independent efficiency score.
- Configure baseline year/method and target with an audit trail. Choose storage and permissions deliberately: the present 15-store allowlist requires explicit rules/migration work if new stores are introduced. Define who may edit reporting factors/settings.

**Exit criteria:** formula tests cover units, zero/missing baseline, zero load, partial years, factor changes, missing months and negative savings. No double counting, unsupported factor attribution or silent historical recalculation.

## 9. Phase 7 — Build the energy dashboard and release in stages

- Build requested consumption, cost, target, emissions and reduction cards; annual/monthly comparisons; estimated category and top-asset charts; factor and baseline settings.
- Ensure every number exposes its period and whether it is billed, estimated or incomplete. Use real reconciled data rather than mockup totals.
- Run the complete Playwright suite and Firestore-rule emulator tests, including new regression cases. Perform two-user concurrency, import/export, role, mobile-layout and service-worker refresh checks.
- Pilot on a Firebase preview/test environment with synthetic/anonymized fixtures, followed by staff acceptance using reconciled sample records. Preserve a pre-migration backup and documented rollback procedure; code rollback alone cannot reverse a data migration.
- Release in independently reviewable increments: reliability first, identity/data repair second, each dashboard after its data model and definitions pass acceptance. Bump `CACHE_NAME` for every production deploy and verify returning clients receive the new release.

**Exit criteria:** reproducible acceptance results, approved data reconciliation, passing regression/rule checks, verified deployed version and usable rollback artifacts.

## 10. Corrections to the mockup's arithmetic and interpretation

- A baseline of 1,076,885 kWh and current 584,254 kWh implies approximately **45.75% reduction**, not 48.1%. The latter is approximately the variance from theoretical 1,125,578 kWh. These are different comparisons and need different labels.
- A 10% target from 1,076,885 is 969,196.5 kWh. Target achievement must use the chosen baseline and equivalent reporting coverage.
- Current screenshots show January–June records; do not label them a complete annual result or compare directly to an unadjusted full year.
- Category estimates must not be presented as a measured breakdown of facility billed consumption without allocation evidence.

## Verification performed for this assessment

A temporary Playwright diagnostic used the existing shared bootstrap and synthetic local records, with Firebase writes disabled. It reproduced the history mismatch, safety/project filter discrepancies, asset-code reuse, energy-year exception and zero-load-factor error, and confirmed new lighting code recognition. The diagnostic completed successfully after correcting its own table-selector typo. No production data was changed and no application fix was deployed by this assessment. Runtime reproduction validates the code paths, not the identity or accuracy of the screenshot's production records.
