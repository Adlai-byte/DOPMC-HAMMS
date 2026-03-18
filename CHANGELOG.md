# HAMMS Changelog

## v2.5.0 — 2026-03-18

### Summary
Post-implementation security audit, comprehensive Playwright testing (73 tests), XSS hardening
(15 patches), bug fixes, offline sync removal for multi-user safety, and Firebase project migration.

---

### Security — XSS Fixes (15 patches)

All `innerHTML` injection points now wrap user-supplied strings in `escapeHTML()`.

| # | Location | Function | Fields Fixed |
|---|----------|----------|--------------|
| 1 | ~line 7115 | `populateTkAssetDropdown()` | `a.name`, `a.building`, `a.floor`, `a.location` in `<option>` text |
| 2 | ~line 7137 | `tkAssetSelected()` info strip | `a.assetCode`, `a.name`, `a.building`, `a.floor`, `a.location`, `a.linkedPump` |
| 3 | ~line 7828 | `populateTankAssetDropdown()` | `a.assetCode`, `a.name` in `<option>` text |
| 4 | ~line 7834 | `populateLinkedPumpDropdown()` | `p.assetCode`, `p.name` in `<option>` text |
| 5 | ~line 5193 | `renderWaterLogs()` ward filter | Ward name `w` in `<option value>` and text |
| 6 | ~line 5298 | `renderWaterTank()` table body | `t.tankName` in `<td>` |
| 7 | ~line 5305 | `renderWaterTank()` table body | `t.remarks` in `<td>` |
| 8 | ~line 5926 | `renderEffluent()` point filter | Sampling point `p` in `<option value>` and text |
| 9 | ~line 5944 | Effluent custom params display | `p.name` in rendered param list |
| 10 | ~line 8366 | Patched `renderWaterTank()` filter | Tank names `t` in `<option value>` and text |
| 11 | ~line 4256 | `renderWasteFcast()` forecast table | `w.contractor`, `w.remarks` in `<td>` |
| 12 | ~line 5231 | `renderWardStatus()` ward cards | Ward name `w` in card innerHTML |
| 13 | ~line 9432 | `renderWaterFixturePanel()` | Fixture name `r.name` in fixture card |
| 14 | (bonus) | `populateTankAssetDropdown()` secondary | `a.assetCode`, `a.name` |
| 15 | (bonus) | `tkAssetSelected()` secondary override | `a.name`, `a.assetCode` in info strip |

**Detection method:** Playwright MCP agents injected `<img src=x onerror=alert(1)>` and
`<script>alert(1)</script>` payloads into every user-controlled field, then verified all rendered
HTML contained `&lt;img` / `&lt;script` (escaped) and not the raw tag.

---

### Bug Fix — ID Generation

**Problem:** `DB.nid(key)` called in rapid succession (same millisecond) returned duplicate IDs.
`generateUniqueNumericId()` used `Date.now()` as the base and only incremented if the candidate
collided with *already-stored* records. Rapid calls with unsaved IDs never triggered the collision
guard, so all calls in the same millisecond returned the same value.

**Fix:** Added a module-level monotonic counter `_lastGeneratedId`. Each call is guaranteed to
produce a value strictly greater than the previous one, even within the same millisecond.

```javascript
let _lastGeneratedId = 0;
function generateUniqueNumericId(usedIds) {
  let candidate = Math.max(Date.now(), _lastGeneratedId + 1);
  while (usedIds.has(String(candidate))) candidate++;
  _lastGeneratedId = candidate;
  usedIds.add(String(candidate));
  return candidate;
}
```

---

### Architecture — Offline Sync Removed (Multi-User Collision Prevention)

**Problem:** The previous offline-first architecture queued write operations in `_fbPendingStoreOps`
while the user was offline. When connectivity was restored, the `online` event handler flushed these
stale queued writes to Firestore. In a multi-user environment, this caused **last-write-wins
collisions**: a user who went offline and came back online would silently overwrite changes made by
other online users in the interim.

**Changes made:**

1. **`syncToFirebase()`** — When `!navigator.onLine`, pending ops are now **discarded** instead of
   queued. A console warning is emitted instructing the user to reconnect and re-save.

   ```javascript
   // Before:
   if (!navigator.onLine) {
     setStorageChip('firebase-offline');
     return; // ops queued silently
   }

   // After:
   if (!navigator.onLine) {
     _fbPendingStoreOps = Object.create(null);
     _fbPendingMetaMerge = {};
     setStorageChip('firebase-offline');
     console.warn('HAMMS: Offline — unsaved changes were discarded...');
     return;
   }
   ```

2. **`online` reconnect handler** — Always performs a fresh Firestore read on reconnect instead of
   flushing the (now-empty) pending ops queue.

   ```javascript
   // Before: if(pending ops) scheduleFBSync(); else refreshFromFirebaseSilently('online');
   // After:  refreshFromFirebaseSilently('online');  // always fresh load
   ```

3. **`scheduleFlush()` debounce** — Reduced from 500 ms to 100 ms. Writes reach Firestore faster,
   narrowing the window in which two online users could both read stale state before a save.

**Trade-off:** Offline users who lose connectivity mid-edit will lose unsaved changes. For a
multi-user hospital asset management system, data integrity across users takes priority over
offline write buffering.

---

### Firebase Project Migration

| Field | Old value | New value |
|-------|-----------|-----------|
| Project ID | `dompc-cmms-74ae4` | `demoapp-7864a` |
| Auth domain | `dopmc-cmms-74ae4.firebaseapp.com` | `demoapp-7864a.firebaseapp.com` |
| Hosting URL | `dopmc-hamms.web.app` | `demoapp-7864a.web.app` |

Updated files: `public/index.html` (FIREBASE_CONFIG), `.firebaserc`.

---

### Testing — Playwright MCP (73 tests, all pass)

Three sequential test agents executed against the live local server:

| Agent | Scope | Tests | Result |
|-------|-------|-------|--------|
| Agent 1 | Navigation (17 pages), Work Orders, Assets, Inventory, Issuance — CRUD + XSS | 20 | 20/20 PASS |
| Agent 2 | Waste, Safety, Projects, Water Logs, Water Tank, Effluent, Med Waste, WW Prod — CRUD + XSS | 37 | 34/37 → 37/37 after fixes |
| Agent 3 | ID integrity, filters, pagination, dashboard stats, exports, error handler | 16 | 15/16 → 16/16 after fix |

**Verification criteria confirmed:**
- All 17 pages navigate without JS errors
- All 12 module CRUDs (Create / Read / Edit / Delete) succeed
- XSS payloads appear as `&lt;img` / `&lt;script` in all rendered surfaces — zero unescaped HTML
- IDs are timestamp-based (> 1,700,000,000,000), collision-free across 20 rapid calls
- Pagination limits to 50 rows; Show All expands to full set; filter change resets to 50
- Dashboard stat cards match actual `DB.g()` counts
- Backup export reminder shows/hides based on `_fbMetaState.lastExportDate`
- `exportCSV()` runs without errors for all 14 collection types
- Global error handler prefixes all errors with `HAMMS Error:` / `HAMMS Unhandled Promise:`

---

### Dependencies

- `firebase-tools` installed globally via npm for CLI deployment (`firebase deploy`)
