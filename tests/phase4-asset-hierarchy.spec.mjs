import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Phase 4 — Parent-Child Asset Hierarchy (TDD)', () => {

  test('Asset modal allows selecting a Parent Equipment and saves parentAssetDocId', async ({ page }) => {
    await bootstrapApp(page);

    // Seed top-level parent asset and a child component asset
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 401, _docId: 'ast-chiller-1', assetCode: 'AC-CHL-01', name: 'Main Chiller Plant 100TR', location: 'Mechanical Room', section: 'Mechanical', condition: 'Good', qty: 1 },
        { id: 402, _docId: 'ast-pump-1', assetCode: 'PMP-CHL-01', name: 'Chilled Water Pump #1', location: 'Mechanical Room', section: 'Mechanical', condition: 'Good', qty: 1 }
      ]);
      openAssetModal(402);
    });

    // Check parent dropdown exists and has for attribute on label
    const parentSelect = page.locator('#m-a-parent');
    await expect(parentSelect).toBeVisible();

    const labelFor = await page.locator('label[for="m-a-parent"]').count();
    expect(labelFor).toBe(1);

    // Parent select should have "Main Chiller Plant" option and should NOT include itself (402)
    const options = await parentSelect.locator('option').allTextContents();
    const hasParentOption = options.some(t => t.includes('Main Chiller Plant 100TR'));
    const hasSelfOption = options.some(t => t.includes('Chilled Water Pump #1'));
    expect(hasParentOption).toBe(true);
    expect(hasSelfOption).toBe(false);

    // Select the parent asset
    await parentSelect.selectOption('ast-chiller-1');

    // Save the asset
    await page.evaluate(() => {
      saveAsset();
    });

    // Verify DB contains parentAssetDocId
    const updated = await page.evaluate(() => DB.g('assets').find(a => a.id === 402));
    expect(updated.parentAssetDocId).toBe('ast-chiller-1');

    // Verify table displays hierarchy sub-assembly indicator
    await page.evaluate(() => {
      navigate('assets');
      renderAssets();
    });

    const row = page.locator('#asset-tbody tr', { hasText: 'Chilled Water Pump #1' });
    await expect(row).toContainText('Main Chiller Plant 100TR');
  });

});
