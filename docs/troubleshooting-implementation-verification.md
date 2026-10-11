# Troubleshooting implementation and verification

Date: 11 October 2026. Release: 2.11.0 on `codex/reliability-fixes`.

Implemented from `Need troubleshooting.docx` and the phased assessment. On the user's subsequent deployment request, matching Firestore rules/indexes and Firebase Hosting were deployed successfully to `demoapp-7864a` on 11 October 2026. The live service-worker cache is `hamms-v2-11-0`, and the hosted page contains the stable asset-reference history and save logic. These changes have not been committed or pushed to GitHub. Production operational records have not been changed.

## Phase results

| Phase | Implemented | Verification |
|---|---|---|
| 0 — Evidence and definitions | Administrator evidence export, data-review previews, agreed safety/project/energy definitions. | Synthetic record fixtures; no production reconciliation claimed. |
| 1 — Reliability | Energy year-filter exception fixed; zero power inputs preserved; contextual conflict diagnostics; review-latest recovery; independent missing-document deletion made idempotent; protected atomic legacy migration. | Sync, conflict, migration, energy and stock-transaction regression tests. |
| 2 — Asset identity | Work-order asset document references, rename-safe history, conservative legacy matching, unique batch-aware asset codes, identity-preserving CSV updates, reviewed classification/link repairs. | Code gaps, duplicate imports, stable IDs, renamed assets and ambiguous matches tested. |
| 3 — Reporting consistency | Safety/project cards and exports share filters with tables; critical ordering fixed; zero-day forecasts supported; insufficient-history and overdue states distinguished. | Filter population and forecast edge-case tests. |
| 4 — Safety | Target/responsible/resolution/closure fields, transition history, reopening, overdue/aging/location/status metrics and historical outstanding counts. | Hand-calculated metrics, valid dates, legacy unknown dates and reopening tests. |
| 5 — Projects | Dated planned/actual progress, expenditure, baseline/progress history, weighted progress, due/overdue/risk metrics and evidence-based forecasts. | Weighted and unweighted samples, history retention and invalid-input tests. |
| 6 — Carbon | Administrator factor registry and baselines, bill factor snapshots, retirement, reviewed missing-factor assignment, comparable-month reductions and protected Firestore metadata. | Unit calculations, missing/overlapping factors, snapshot preservation, role restrictions and forged-factor rejection. |
| 7 — Energy and release preparation | Annual consumption, costs, top estimated consumers, carbon/intensity/target/reduction cards, coverage disclosures, missing-data gaps and responsive controls. | Reconciliation tests, desktop/mobile interaction checks and screenshot review. |

## Verification results

- Full local Playwright suite: **464 passed**, four workers, no retries.
- Firestore rules emulator: **7 passed** against `demo-hamms-tests`.
- After the final mobile toolbar correction: phased suite **16 passed**; repeated full suite **464 passed** (1.4 minutes, no retries).
- After the user confirmed RAMP ownership: phased suite **17 passed**, including explicit selection of asset 01 and exclusion from asset 03's history. This follow-up changed documentation and tests only; production data remains untouched.
- Desktop (1440 px) and mobile (390 px) screenshots reviewed. The mobile regression checks individual filter/action boundaries, in addition to page overflow and modal visibility.
- `git diff --check` passed. No build, lint or typecheck is configured.
- Post-deployment live Playwright suite: **6 passed**. Verified the v2.11.0 cache, deployed helper functions, asset/location behavior and stable history with two similarly named assets. These checks use isolated browser memory; they do not change operational records.

Commands:

```powershell
npx playwright test --workers=4 --retries=0 --reporter=line
firebase emulators:exec --only firestore --project demo-hamms-tests "node --test tests/rules/firestore.test.mjs"
```

Local and emulator results establish behavior with test fixtures. The subsequent live checks establish deployed code and browser behavior; authenticated production writes and correctness of source billing records remain separate checks.

## Agreed metric definitions

- Safety Open/Under Action are active; Resolved/Verified/Closed are inactive. Unknown historical transitions remain unavailable.
- Project progress is budget-weighted over positive budgets when available, with excluded unbudgeted projects disclosed; otherwise it is a simple mean. Budget at risk covers delayed or overdue unfinished projects.
- Energy remains one facility aggregate per month. Actual billed consumption and current asset estimates have separate bases; asset estimates are not added to bills.
- Carbon uses the saved verified factor in kgCO2e/kWh; tonnes divide kilograms by 1,000. Missing factors produce Unavailable. Intensity represents emission factors, rather than operational efficiency.
- Baselines compare the same recorded months. An annual manual baseline requires twelve months. Historical progress, closure dates and bill values are not reconstructed from guesses.

## Administrator rollout and data review

1. Before production repairs, take the evidence export from **Data review** in Assets or Reports and preserve the original backup.
2. Inspect the legacy migration preview. Automatic migration is restricted to an empty, uninitialized destination with 1–449 records. Existing partial migrations and larger stores require a separately reviewed migration. The legacy source is retained.
3. Review asset classifications and suggested links. Apply only reviewed unambiguous repairs. Existing document IDs remain authoritative; changed display codes retain aliases. Ambiguous work orders need individual asset selection.
4. In Energy, open **Carbon factors and baseline** as an administrator. Enter the applicable sourced grid factor, units and validity dates, then mark verified only after checking the source. No numeric official factor was selected by this implementation.
5. Review the missing-bill-factor list before assignment. Existing snapshots remain unchanged, including when a factor is retired.
6. Begin recording safety transitions and project progress observations. Historical charts require this evidence; old incomplete records can remain unavailable.
7. Publish matching Firestore rules/indexes and hosting, then verify the release/cache and authenticated staff/admin behavior on the live site. Users of an older open tab must refresh.

User clarification received on 11 October 2026: retain June 2026's 3,659.5 kWh and approximately PHP 1.44 million unchanged pending original-bill and meter-multiplier verification. The user confirmed that work order `ELEC-HI-0011` belongs to asset `OT-ELEC-RAMP-01`, rather than `OT-ELEC-RAMP-03`.

For the confirmed link, find the asset by its current code or `legacyCodes` alias, verify a unique document ID, edit `ELEC-HI-0011`, explicitly select that asset and save through the normal version-checked work-order operation. Verify the order appears in that asset's history and does not appear in `OT-ELEC-RAMP-03` history. Do not infer the same ownership for other similarly named work orders. The confirmation resolves ownership; it does not identify the production document ID or mean that a production write has occurred. Production migration and asset repair have not been run.

## Quick acceptance checks after deployment

1. Select an energy year; cards and charts should render without an exception. An asset with zero hours, quantity or load factor contributes zero estimated consumption.
2. Filter Safety/Projects to one status/date population; cards, charts, table and CSV should describe that population.
3. Save a work order with an explicitly selected asset, rename that asset, and verify its history still contains the order.
4. Attempt concurrent edits from two test sessions. The stale session should explain the conflict and offer latest-record review while retaining unsaved form fields.
5. Record a safety resolution/reopening and two project observations; inspect the resulting dates/history and forecast basis.
6. Save a bill with a verified factor, then retire that registry entry. The saved bill's carbon result should remain unchanged. Staff should be unable to change protected factor/baseline settings.
7. At phone width, verify every reporting filter and action is visible and usable. Missing months, factors or historical evidence should remain unavailable, rather than being presented as zero.

Use dedicated test records for live acceptance and remove them through normal application operations afterward.

## Subsequent asset-history release

v2.11.1 was deployed on 11 October 2026 with room asset repair status, explicit equipment/general-maintenance selection, asset-preselected work orders and historical-link review. Full suite: 471 passed; live suite: 7 passed. Current cache: `hamms-v2-11-1`. See `asset-history-workflow-verification.md`. No operational records were changed.

The final production-data check found overly broad Dietary department/subroom matching. v2.11.2 corrected that and was deployed on 11 October 2026. Final full suite: 472 passed; live suite: 7 passed; live cache: `hamms-v2-11-2`. The actual DIETARY RSA room now renders exactly two assets, each with No recorded repairs.
