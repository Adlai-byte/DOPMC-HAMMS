import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Phase 3 — PMS Location & Building/Floor Filter Integration (TDD)', () => {

  test('Asset Registry page filters by Building and Floor dropdowns', async ({ page }) => {
    await bootstrapApp(page);

    // Seed test locations and assets
    await page.evaluate(() => {
      DB.s('locations', [
        { id: 1, building: 'Main Tower', floor: '3rd Floor', roomName: 'Operating Room 1', roomNumber: 'OR-1', type: 'Operating Suite', status: 'Active' },
        { id: 2, building: 'Emergency Wing', floor: '1st Floor', roomName: 'Trauma Bay 1', roomNumber: 'TB-1', type: 'Emergency Room', status: 'Active' }
      ]);
      DB.s('assets', [
        { id: 201, _docId: 'ast-201', assetCode: 'AST-201', name: 'Tower Surgical Light', building: 'Main Tower', floor: '3rd Floor', location: 'Operating Room 1', condition: 'Good', qty: 1 },
        { id: 202, _docId: 'ast-202', assetCode: 'AST-202', name: 'Emergency Defibrillator', building: 'Emergency Wing', floor: '1st Floor', location: 'Trauma Bay 1', condition: 'Good', qty: 1 }
      ]);
      navigate('assets');
      renderAssets();
    });

    // Check that #af-bld and #af-floor exist
    const bldFilter = page.locator('#af-bld');
    const floorFilter = page.locator('#af-floor');
    await expect(bldFilter).toBeVisible();
    await expect(floorFilter).toBeVisible();

    // Check that options include Main Tower and Emergency Wing
    await expect(bldFilter.locator('option', { hasText: 'Main Tower' })).toHaveCount(1);
    await expect(bldFilter.locator('option', { hasText: 'Emergency Wing' })).toHaveCount(1);

    // Select Main Tower
    await bldFilter.selectOption('Main Tower');
    await page.evaluate(() => renderAssets());

    // Only AST-201 should be displayed in the table
    const tableRows = page.locator('#asset-tbody tr');
    await expect(tableRows).toHaveCount(1);
    await expect(tableRows).toContainText('Tower Surgical Light');
    await expect(tableRows).not.toContainText('Emergency Defibrillator');

    // Reset building, filter by 1st Floor
    await bldFilter.selectOption('');
    await floorFilter.selectOption('1st Floor');
    await page.evaluate(() => renderAssets());

    await expect(tableRows).toHaveCount(1);
    await expect(tableRows).toContainText('Emergency Defibrillator');
  });

  test('Buildings & Rooms page displays real-time PMS Overdue count per room', async ({ page }) => {
    await bootstrapApp(page);

    // Today is seeded in past or asset has overdue nextMaintDate
    const pastDate = '2020-01-01'; // definitively overdue

    await page.evaluate((overdueDt) => {
      DB.s('locations', [
        { id: 1, code: 'LOC-BLD-OR1', building: 'Main Tower', floor: '3rd Floor', roomName: 'Operating Room 1', roomNumber: 'OR-1', type: 'Operating Suite', status: 'Active' },
        { id: 2, code: 'LOC-BLD-ICU', building: 'Main Tower', floor: '2nd Floor', roomName: 'ICU Room 101', roomNumber: 'ICU-101', type: 'Intensive Care Unit (ICU)', status: 'Active' }
      ]);
      DB.s('assets', [
        // OR 1 has an overdue asset
        { id: 301, _docId: 'ast-301', assetCode: 'AST-301', name: 'Anesthesia Machine', location: 'Operating Room 1', nextMaintDate: overdueDt, pmsInterval: 'Quarterly', condition: 'Good' },
        // ICU has an asset that is NOT overdue (future date)
        { id: 302, _docId: 'ast-302', assetCode: 'AST-302', name: 'Ventilator Pro', location: 'ICU Room 101', nextMaintDate: '2099-12-31', pmsInterval: 'Monthly', condition: 'Good' }
      ]);
      navigate('locations');
      renderLocations();
    }, pastDate);

    const orRow = page.locator('#loc-tbody tr', { hasText: 'Operating Room 1' });
    const icuRow = page.locator('#loc-tbody tr', { hasText: 'ICU Room 101' });

    // OR 1 should show Overdue badge
    await expect(orRow).toContainText('Overdue');

    // ICU row should show OK or no overdue badge
    await expect(icuRow).toContainText('PMS OK');
  });

});
