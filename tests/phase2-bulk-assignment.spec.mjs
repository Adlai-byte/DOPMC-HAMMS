import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Phase 2 — Bulk Asset Reassignment Tools (TDD)', () => {

  test('Asset Registry table supports multi-select checkboxes and bulk reassignment to room', async ({ page }) => {
    await bootstrapApp(page);

    // Seed test locations and assets
    await page.evaluate(() => {
      DB.s('locations', [
        { id: 1, building: 'Main Tower', floor: '3rd Floor', roomName: 'Operating Room 1', roomNumber: 'OR-1', type: 'Operating Suite', status: 'Active' },
        { id: 2, building: 'Main Tower', floor: '2nd Floor', roomName: 'ICU Ward A', roomNumber: 'ICU-A', type: 'Intensive Care Unit (ICU)', status: 'Active' }
      ]);
      DB.s('assets', [
        { id: 101, _docId: 'ast-101', assetCode: 'AST-001', name: 'Defibrillator X1', location: 'Storage Room', building: 'Old Wing', floor: '1st Floor', condition: 'Good', qty: 1 },
        { id: 102, _docId: 'ast-102', assetCode: 'AST-002', name: 'Patient Monitor A', location: 'Storage Room', building: 'Old Wing', floor: '1st Floor', condition: 'Good', qty: 2 },
        { id: 103, _docId: 'ast-103', assetCode: 'AST-003', name: 'Surgical Light LED', location: 'Operating Room 1', building: 'Main Tower', floor: '3rd Floor', condition: 'Good', qty: 1 }
      ]);
      navigate('assets');
      renderAssets();
    });

    // Verify select all checkbox and row checkboxes exist
    const hasSelectAll = await page.locator('#asset-select-all').isVisible();
    expect(hasSelectAll).toBe(true);

    const rowCheckboxes = page.locator('.asset-cb');
    await expect(rowCheckboxes).toHaveCount(3);

    // Bulk bar should initially be hidden
    const bulkBar = page.locator('#asset-bulk-bar');
    await expect(bulkBar).toBeHidden();

    // Check two assets (101 and 102)
    await page.locator('.asset-cb[value="101"]').check();
    await page.locator('.asset-cb[value="102"]').check();

    // Bulk bar should now be visible with count
    await expect(bulkBar).toBeVisible();
    await expect(page.locator('#asset-bulk-count')).toContainText('2');

    // Select target room: "Operating Room 1"
    const bulkRoomInput = page.locator('#asset-bulk-room');
    await bulkRoomInput.fill('Operating Room 1');

    // Click Move to Room
    await page.locator('#asset-bulk-move-btn').click();

    // Verify DB updated
    const updatedAssets = await page.evaluate(() => DB.g('assets'));
    const ast1 = updatedAssets.find(a => a.id === 101);
    const ast2 = updatedAssets.find(a => a.id === 102);
    const ast3 = updatedAssets.find(a => a.id === 103);

    expect(ast1.location).toBe('Operating Room 1');
    expect(ast1.building).toBe('Main Tower');
    expect(ast1.floor).toBe('3rd Floor');
    expect(ast1.roomNumber).toBe('OR-1');

    expect(ast2.location).toBe('Operating Room 1');
    expect(ast2.building).toBe('Main Tower');
    expect(ast2.floor).toBe('3rd Floor');
    expect(ast2.roomNumber).toBe('OR-1');

    // ast3 was already in OR-1
    expect(ast3.location).toBe('Operating Room 1');

    // Selection should be cleared and bulk bar hidden
    await expect(bulkBar).toBeHidden();
  });

  test('Room View modal allows quick assignment of assets from other rooms or unassigned', async ({ page }) => {
    await bootstrapApp(page);

    // Seed test locations and assets
    await page.evaluate(() => {
      DB.s('locations', [
        { id: 1, building: 'Main Tower', floor: '3rd Floor', roomName: 'Operating Room 1', roomNumber: 'OR-1', type: 'Operating Suite', status: 'Active' },
        { id: 2, building: 'Main Tower', floor: '2nd Floor', roomName: 'ICU Ward A', roomNumber: 'ICU-A', type: 'Intensive Care Unit (ICU)', status: 'Active' }
      ]);
      DB.s('assets', [
        { id: 101, _docId: 'ast-101', assetCode: 'AST-001', name: 'Suction Machine Pro', location: 'Storage Room', building: 'Old Wing', condition: 'Good', qty: 1 },
        { id: 102, _docId: 'ast-102', assetCode: 'AST-002', name: 'Anesthesia Cart', location: 'Operating Room 1', building: 'Main Tower', floor: '3rd Floor', condition: 'Good', qty: 1 }
      ]);
      openRoomView('Operating Room 1');
    });

    // Check that assign button is visible in Room View
    const assignBtn = page.locator('#btn-room-assign-assets');
    await expect(assignBtn).toBeVisible();

    // Click assign button to open drawer/panel
    await assignBtn.click();
    const pickerPanel = page.locator('#room-asset-picker-panel');
    await expect(pickerPanel).toBeVisible();

    // Check AST-001 is listed as an assignable candidate
    const candidateRow = page.locator('#room-asset-picker-list tr', { hasText: 'Suction Machine Pro' });
    await expect(candidateRow).toBeVisible();

    // Check candidate checkbox and click confirm
    await candidateRow.locator('input[type="checkbox"]').check();
    await page.locator('#btn-room-picker-confirm').click();

    // Verify DB updated
    const updatedAssets = await page.evaluate(() => DB.g('assets'));
    const ast1 = updatedAssets.find(a => a.id === 101);
    expect(ast1.location).toBe('Operating Room 1');
    expect(ast1.building).toBe('Main Tower');
    expect(ast1.floor).toBe('3rd Floor');

    // Verify that the assets table in Room View now lists Suction Machine Pro
    const roomAssetsTable = page.locator('#room-view-assets');
    await expect(roomAssetsTable).toContainText('Suction Machine Pro');
    await expect(roomAssetsTable).toContainText('Anesthesia Cart');
  });

});
