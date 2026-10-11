import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Phase 5 — Location Normalization Migration Assistant (TDD)', () => {

  test('Data Review modal previews confidence-tiered location matches and executes backfill', async ({ page }) => {
    await bootstrapApp(page);

    // Seed test locations and historical records
    await page.evaluate(() => {
      window._FB = window._FB || {};
      window._FB.isAdmin = true; // Admin role for Data Review

      DB.s('locations', [
        { id: 1, _docId: 'loc-or-1', roomName: 'Operating Room 1', roomNumber: 'OR-1', building: 'Main Tower', status: 'Active' },
        { id: 2, _docId: 'loc-icu-101', roomName: 'ICU Ward Room 101', roomNumber: 'ICU-101', building: 'Main Tower', status: 'Active' }
      ]);

      DB.s('wo', [
        // 501: Exact text match -> High confidence
        { id: 501, _docId: 'wo-501', location: 'Operating Room 1', description: 'Light repair', status: 'Closed' },
        // 502: Partial/Ambiguous text -> Ambiguous review
        { id: 502, _docId: 'wo-502', location: 'ICU Ward', description: 'Monitor check', status: 'Open' }
      ]);

      openDataReview();
    });

    // Check Data Review modal is open and has Location Normalization section
    const locSection = page.locator('#loc-migration-section');
    await expect(locSection).toBeVisible();

    // Verify high-confidence preview lists WO 501 mapped to Operating Room 1
    const highConfTable = page.locator('#loc-mig-high-conf');
    await expect(highConfTable).toContainText('Operating Room 1');
    await expect(highConfTable).toContainText('WO #501');

    // Verify ambiguous preview lists WO 502 with an override dropdown
    const ambiguousTable = page.locator('#loc-mig-ambiguous');
    await expect(ambiguousTable).toContainText('WO #502');
    const overrideSelect = page.locator('.loc-mig-override[data-store="wo"][data-id="502"]');
    await expect(overrideSelect).toBeVisible();

    // Select 'loc-icu-101' for the ambiguous record
    await overrideSelect.selectOption('loc-icu-101');

    // Click Apply Location Backfill
    await page.locator('#loc-mig-apply-btn').click();

    // Verify records in DB have locationDocId backfilled without changing original location text
    const updatedWOs = await page.evaluate(() => DB.g('wo'));
    const w501 = updatedWOs.find(w => w.id === 501);
    const w502 = updatedWOs.find(w => w.id === 502);

    expect(w501.locationDocId).toBe('loc-or-1');
    expect(w501.location).toBe('Operating Room 1'); // original text preserved

    expect(w502.locationDocId).toBe('loc-icu-101');
    expect(w502.location).toBe('ICU Ward'); // original text preserved

    // Verify Undo Rollback button is now visible
    const undoBtn = page.locator('#loc-mig-undo-btn');
    await expect(undoBtn).toBeVisible();

    // Click Undo Migration (Rollback)
    await undoBtn.click();

    // Verify DB records have locationDocId removed/reverted
    const rolledBackWOs = await page.evaluate(() => DB.g('wo'));
    const rb501 = rolledBackWOs.find(w => w.id === 501);
    const rb502 = rolledBackWOs.find(w => w.id === 502);

    expect(rb501.locationDocId).toBeFalsy();
    expect(rb502.locationDocId).toBeFalsy();
  });

  test('Room View queries records prioritizing canonical locationDocId with seamless fallback', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        { id: 1, _docId: 'loc-or-1', roomName: 'Operating Room 1', roomNumber: 'OR-1', building: 'Main Tower', status: 'Active' }
      ]);

      DB.s('wo', [
        // Linked by canonical locationDocId
        { id: 601, _docId: 'wo-601', locationDocId: 'loc-or-1', location: 'OR 1 Surgical', description: 'Table hydraulic leak', status: 'In Progress' },
        // Unmigrated legacy record matched by fuzzy text fallback
        { id: 602, _docId: 'wo-602', location: 'Operating Room 1', description: 'Overhead light dimmer', status: 'Open' },
        // Unrelated room
        { id: 603, _docId: 'wo-603', location: 'Storage Room', description: 'Door handle fixed', status: 'Closed' }
      ]);

      openRoomView('Operating Room 1');
    });

    const roomWOTable = page.locator('#room-view-wos');

    // Both canonical ID match and fuzzy text fallback should appear in Room View
    await expect(roomWOTable).toContainText('Table hydraulic leak');
    await expect(roomWOTable).toContainText('Overhead light dimmer');
    await expect(roomWOTable).not.toContainText('Door handle fixed');
  });

});
