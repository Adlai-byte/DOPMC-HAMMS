import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Code Review & Reliability Fixes (TDD)', () => {

  test('DEF-03: Asset Parent Equipment dropdown excludes all direct and indirect descendants to prevent circular cycles', async ({ page }) => {
    await bootstrapApp(page);

    // Seed equipment hierarchy: A (Chiller) -> B (Compressor) -> C (Valve)
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 101, _docId: 'ast-a', assetCode: 'CHL-01', name: 'Chiller Plant A', parentAssetDocId: null, condition: 'Good', qty: 1 },
        { id: 102, _docId: 'ast-b', assetCode: 'CMP-01', name: 'Compressor B', parentAssetDocId: 'ast-a', condition: 'Good', qty: 1 },
        { id: 103, _docId: 'ast-c', assetCode: 'VLV-01', name: 'Expansion Valve C', parentAssetDocId: 'ast-b', condition: 'Good', qty: 1 },
        { id: 104, _docId: 'ast-d', assetCode: 'GEN-01', name: 'Generator D', parentAssetDocId: null, condition: 'Good', qty: 1 }
      ]);
    });

    // When editing Chiller Plant A (id 101):
    // It should NOT include itself (101), Compressor B (102, direct child), or Expansion Valve C (103, indirect grandchild).
    // It SHOULD include Generator D (104).
    await page.evaluate(() => {
      openAssetModal(101);
    });

    const parentSelect = page.locator('#m-a-parent');
    await expect(parentSelect).toBeVisible();

    const optionTexts = await parentSelect.locator('option').allTextContents();
    
    // Check exclusions
    expect(optionTexts.some(t => t.includes('Chiller Plant A'))).toBe(false); // itself
    expect(optionTexts.some(t => t.includes('Compressor B'))).toBe(false);    // direct child
    expect(optionTexts.some(t => t.includes('Expansion Valve C'))).toBe(false); // grandchild

    // Check valid candidate
    expect(optionTexts.some(t => t.includes('Generator D'))).toBe(true);
  });

  test('DEF-01: Room Deletion strictly blocks if active work orders exist, cascades detachment when permitted', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        { id: 201, _docId: 'loc-icu-1', roomName: 'ICU Room 1', building: 'Main Building', floor: '2nd Floor' },
        { id: 202, _docId: 'loc-empty', roomName: 'Empty Storage', building: 'Support Building', floor: '1st Floor' }
      ]);
      DB.s('assets', [
        { id: 301, _docId: 'ast-monitor-1', name: 'Patient Monitor', location: 'ICU Room 1', locationDocId: 'loc-icu-1', condition: 'Good', qty: 1 }
      ]);
      DB.s('wo', [
        { id: 401, _docId: 'wo-open-1', code: 'WO-2026-001', location: 'ICU Room 1', locationDocId: 'loc-icu-1', status: 'In Progress', asset: 'Patient Monitor' }
      ]);
    });

    // Attempting to delete loc-icu-1 (id 201) which has an active work order must be blocked
    const blockToast = await page.evaluate(async () => {
      let alertMsg = '';
      window.alert = (msg) => { alertMsg = msg; };
      await delLocation(201);
      return alertMsg;
    });

    // Verify room was NOT deleted
    const locStillExists = await page.evaluate(() => DB.g('locations').some(l => l.id === 201));
    expect(locStillExists).toBe(true);

    // Now resolve/close the work order
    await page.evaluate(() => {
      const wos = DB.g('wo').map(w => w.id === 401 ? { ...w, status: 'Closed' } : w);
      DB.s('wo', wos);
    });

    // Now delete room 201 with confirmed cascade detachment
    await page.evaluate(async () => {
      window.confirmDialog = async () => true;
      await delLocation(201);
    });

    // Room should now be deleted
    const locDeleted = await page.evaluate(() => DB.g('locations').some(l => l.id === 201));
    expect(locDeleted).toBe(false);

    // The assigned asset should have its locationDocId detached to null
    const asset = await page.evaluate(() => DB.g('assets').find(a => a.id === 301));
    expect(asset.locationDocId).toBeNull();
  });

  test('DEF-02: Asset Deletion strictly blocks if active work orders or child components exist', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('assets', [
        { id: 501, _docId: 'ast-pump-parent', name: 'Main Water Pump', condition: 'Good', qty: 1 },
        { id: 502, _docId: 'ast-pump-motor', name: 'Pump Motor Unit', parentAssetDocId: 'ast-pump-parent', condition: 'Good', qty: 1 }
      ]);
      DB.s('wo', [
        { id: 601, _docId: 'wo-pump-open', status: 'Open', assetDocId: 'ast-pump-parent', asset: 'Main Water Pump' }
      ]);
    });

    // Attempting to delete asset 501 (which has an open WO and child component) must be blocked
    await page.evaluate(async () => {
      window.alert = () => {};
      await delAsset(501);
    });

    // Verify asset still exists
    let assetExists = await page.evaluate(() => DB.g('assets').some(a => a.id === 501));
    expect(assetExists).toBe(true);

    // Close the work order
    await page.evaluate(() => {
      DB.s('wo', DB.g('wo').map(w => ({ ...w, status: 'Closed' })));
    });

    // Attempt delete again (child component still linked)
    await page.evaluate(async () => {
      await delAsset(501);
    });
    assetExists = await page.evaluate(() => DB.g('assets').some(a => a.id === 501));
    expect(assetExists).toBe(true);

    // Reassign or remove child component
    await page.evaluate(() => {
      DB.s('assets', DB.g('assets').map(a => a.id === 502 ? { ...a, parentAssetDocId: null } : a));
    });

    // Now delete asset with confirmDialog = true
    await page.evaluate(async () => {
      window.confirmDialog = async () => true;
      await delAsset(501);
    });

    // Asset should now be deleted
    assetExists = await page.evaluate(() => DB.g('assets').some(a => a.id === 501));
    expect(assetExists).toBe(false);
  });

  test('DEF-04: renderLocations indexes and counts assets via locationDocId in O(1)', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        { id: 701, _docId: 'loc-dialysis', roomName: 'Dialysis Center', roomNumber: 'DC-01', building: 'East Wing', floor: '1st Floor' }
      ]);
      // Asset has locationDocId pointing to loc-dialysis, but text is customized / slightly different
      DB.s('assets', [
        { id: 801, _docId: 'ast-hemo-1', name: 'Hemodialysis Machine', location: 'Custom Dialysis Station 1', locationDocId: 'loc-dialysis', qty: 2 }
      ]);
      DB.s('wo', [
        { id: 901, _docId: 'wo-hemo-1', location: 'Special Station', locationDocId: 'loc-dialysis', status: 'Open' }
      ]);
      navigate('locations');
      renderLocations();
    });

    // In the locations table, the row for Dialysis Center should show Asset count of 2 and WO count of 1
    const row = page.locator('#loc-tbody tr', { hasText: 'Dialysis Center' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('2'); // Asset count (qty 2)
    await expect(row).toContainText('1'); // WO count
  });

  test('DEF-06: openRoomView supports direct resolution by locationDocId', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        { id: 950, _docId: 'loc-radiology-xray', roomName: 'X-Ray Examination Room 1', building: 'Annex', floor: 'Basement' }
      ]);
      DB.s('assets', [
        { id: 951, _docId: 'ast-xray-tube', name: 'Digital X-Ray System', locationDocId: 'loc-radiology-xray', location: 'X-Ray Room', qty: 1 }
      ]);
      openRoomView('loc-radiology-xray');
    });

    const title = page.locator('#room-view-title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('X-Ray Examination Room 1');
  });

  test('DEF-07: Inventory item deletion blocks if allocated in active work orders and warns on positive stock', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('inventory', [
        { id: 88, _docId: 'inv-filter-oil', description: 'Hydraulic Oil ISO 68', qty: 25, unit: 'Liters' }
      ]);
      DB.s('wo', [
        { id: 77, _docId: 'wo-elevator', status: 'In Progress', materials: [{ invId: 88, qty: 5 }] }
      ]);
    });

    // Deletion blocked due to active work order allocation
    await page.evaluate(async () => {
      window.alert = () => {};
      await delInvItem(88);
    });

    let invExists = await page.evaluate(() => DB.g('inventory').some(i => i.id === 88));
    expect(invExists).toBe(true);

    // Close the work order
    await page.evaluate(() => {
      DB.s('wo', DB.g('wo').map(w => ({ ...w, status: 'Closed' })));
    });

    // Now delete with confirmation
    await page.evaluate(async () => {
      window.confirmDialog = async () => true;
      await delInvItem(88);
    });

    invExists = await page.evaluate(() => DB.g('inventory').some(i => i.id === 88));
    expect(invExists).toBe(false);
  });

});

