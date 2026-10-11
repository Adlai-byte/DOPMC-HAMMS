# Asset history workflow — v2.11.2

Implemented on 11 October 2026 after checking the current production DIETARY RSA records. The fluorescent tube (`OT-ELEC-DIETAR-09`) and compact bulb (`OT-ELEC-DIETAR-10`) exist as registered assets, with no matching or directly linked work orders in the 36 current work-order records. No historical repair entries were invented or operational records changed.

## Changes

- Both assets remain visible in the room asset list. Each row shows `No recorded repairs` or its linked-work-order count, with History and Create work order actions.
- Create work order preselects the asset document ID, section and location. The selected code, name and room are visible even on mobile.
- Saving requires a registered asset or an explicit Room/general maintenance choice. General work requires a room and belongs to room history; it does not become a repair of every asset in that room.
- Missing/deleted asset references cannot be saved as equipment repairs. Review asset links in Work Orders lists older missing, ambiguous, unlinked and dangling references for individual repair.
- Room history no longer borrows no-location work orders based solely on a shared asset name.
- Qualified Dietary rooms are distinct from department-level aliases. The final production-data check exposed overly broad subset matching that included general Dietary assets in RSA; v2.11.2 corrects it without changing department synonyms.
- CSV preserves explicit Work Scope. Ambiguous older imports remain available for review; the importer does not infer a room from the first of several same-name assets.
- Desktop room modal and mobile work-order form accommodate the added information. Service-worker cache: `hamms-v2-11-2`.

## Verification

Full local Playwright suite: **472 passed**, four workers, no retries. Post-deployment live suite: **7 passed**. Firebase Hosting deployed successfully to `demoapp-7864a` on 11 October 2026; the live cache is `hamms-v2-11-2`. No Firestore rule changes were needed for this follow-up. `git diff --check` passed.

`tests/asset-history-workflow.spec.mjs` covers both RSA assets before any repair, correct preselection/save/history ownership, required selection before inventory mutation, general-maintenance location validation, unresolved-link review, cross-room isolation, CSV scope and mobile usability. Existing CRUD fixtures now explicitly choose general maintenance and a room where no equipment asset is registered.

Desktop and mobile screenshots were reviewed with synthetic records representing the two RSA assets. Production reads were read-only. Live tests use isolated browser memory with Firebase writing disabled.

## User acceptance

Refresh the app, open Asset Registry, then DIETARY RSA. Both assets should be listed with `No recorded repairs`. Select Create work order on the asset that actually needs maintenance; its correct code and room should be preselected. Enter the real details and save while online. The resulting entry should appear in that asset's history and the room history, while the other asset remains unchanged. Use Review asset links for older repairs whose ownership is known; do not assign repairs from a room name alone.

Final read-only check against all current production assets/work orders and the deployed client: DIETARY RSA renders exactly **2 asset rows**, both with `No recorded repairs`, and **4 actions** (History/Create work order per asset). Verified live cache `hamms-v2-11-2`. No operational writes were performed.
