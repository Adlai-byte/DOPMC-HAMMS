import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Automated Production Startup Migration (TDD)', () => {

  test('Runs one-time auto-seeding of locations, exact-match backfill, and displays summary modal for Admin', async ({ page }) => {
    await bootstrapApp(page);

    // Seed mock database:
    // 0 locations, but assets and work orders with standard hospital names (Operating Room 1, ICU, etc.)
    await page.evaluate(() => {
      window._FB.isAdmin = true;
      delete _fbMetaState.locationAutoMigratedAt;
      DB.s('locations', []);
      DB.s('assets', [
        { id: 101, _docId: 'ast-101', name: 'Anesthesia Machine', location: 'Operating Room 1', locationDocId: null, condition: 'Good', qty: 1 },
        { id: 102, _docId: 'ast-102', name: 'Patient Monitor', location: 'Intensive Care Unit (ICU)', locationDocId: null, condition: 'Good', qty: 1 },
        { id: 103, _docId: 'ast-103', name: 'Unknown Device', location: 'Nonexistent Mystery Annex', locationDocId: null, condition: 'Good', qty: 1 }
      ]);
      DB.s('wo', [
        { id: 201, _docId: 'wo-201', code: 'WO-001', location: 'Operating Room 1', locationDocId: null, status: 'Open' }
      ]);
      DB.s('projects', [
        { id: 301, _docId: 'prj-301', code: 'PRJ-001', title: 'OR Light Upgrade', location: 'Operating Room 1', locationDocId: null }
      ]);
    });

    // Trigger startup check
    await page.evaluate(async () => {
      await checkAndRunStartupLocationMigration();
    });

    // 1. Locations should now be auto-seeded with standard DOPMC hospital locations
    const locCount = await page.evaluate(() => DB.g('locations').length);
    expect(locCount).toBeGreaterThanOrEqual(20);

    // 2. Exact matching records should have locationDocId backfilled
    const asset101 = await page.evaluate(() => DB.g('assets').find(a => a.id === 101));
    const asset102 = await page.evaluate(() => DB.g('assets').find(a => a.id === 102));
    const asset103 = await page.evaluate(() => DB.g('assets').find(a => a.id === 103));
    const wo201 = await page.evaluate(() => DB.g('wo').find(w => w.id === 201));
    const prj301 = await page.evaluate(() => DB.g('projects').find(p => p.id === 301));

    expect(asset101.locationDocId).toBeTruthy();
    expect(asset102.locationDocId).toBeTruthy();
    expect(asset103.locationDocId).toBeNull(); // Nonexistent room is NOT guessed
    expect(wo201.locationDocId).toBe(asset101.locationDocId);
    expect(prj301.locationDocId).toBe(asset101.locationDocId);

    // 3. Metadata flag should be set
    const metaFlag = await page.evaluate(() => _fbMetaState.locationAutoMigratedAt);
    expect(metaFlag).toBeTruthy();

    // 4. Modal summary should be visible with breakdown and dual action buttons
    const summaryModal = page.locator('#mo-loc-auto-summary');
    await expect(summaryModal).toBeVisible();

    const reviewBtn = page.locator('#loc-auto-sum-review');
    const dismissBtn = page.locator('#loc-auto-sum-dismiss');
    await expect(reviewBtn).toBeVisible();
    await expect(dismissBtn).toBeVisible();
  });

  test('Does not re-run or show modal if locationAutoMigratedAt is already recorded', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      window._FB.isAdmin = true;
      _fbMetaState.locationAutoMigratedAt = new Date().toISOString();
      DB.s('locations', [{ id: 1, _docId: 'loc-1', roomName: 'Test Room' }]);
      DB.s('assets', [{ id: 55, name: 'Lamp', location: 'Test Room', locationDocId: null }]);
    });

    await page.evaluate(async () => {
      await checkAndRunStartupLocationMigration();
    });

    // Asset should NOT have been touched
    const asset = await page.evaluate(() => DB.g('assets').find(a => a.id === 55));
    expect(asset.locationDocId).toBeNull();

    // Modal must NOT be visible
    const isVisible = await page.locator('#mo-loc-auto-summary').isVisible();
    expect(isVisible).toBe(false);
  });

  test('Does not run for non-admin users', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      window._FB.isAdmin = false;
      delete _fbMetaState.locationAutoMigratedAt;
      DB.s('locations', []);
      DB.s('assets', [{ id: 88, name: 'Bed', location: 'Operating Room 1', locationDocId: null }]);
    });

    await page.evaluate(async () => {
      await checkAndRunStartupLocationMigration();
    });

    const locCount = await page.evaluate(() => DB.g('locations').length);
    expect(locCount).toBe(0);

    const isVisible = await page.locator('#mo-loc-auto-summary').isVisible();
    expect(isVisible).toBe(false);
  });

});
