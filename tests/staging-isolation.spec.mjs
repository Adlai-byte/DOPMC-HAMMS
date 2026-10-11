import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Staging Sandbox Isolation (Solution A)', () => {

  test('Routes to hammsStores_staging and hammsMeta_staging in staging mode', async ({ page }) => {
    await bootstrapApp(page);

    const routingCheck = await page.evaluate(() => {
      // In default test mode (localhost without staging flag)
      window._forceStagingEnv = false;
      const prodRoot = isStagingEnvironment();
      
      // In staging mode
      window._forceStagingEnv = true;
      const stagingRoot = isStagingEnvironment();

      // Test refs with mock DB
      const mockDB = {};
      const mockCol = (db, root, store, sub) => ({ root, store, sub });
      const mockDoc = (db, root, ...rest) => ({ root, path: rest.join('/') });
      window._FB = window._FB || {};
      window._FB.db = mockDB;
      window._FB.collection = mockCol;
      window._FB.doc = mockDoc;

      const prodStoreRef = getStoreCollectionRef('assets', false);
      const stagingStoreRef = getStoreCollectionRef('assets', false);
      const forcedProdStoreRef = getStoreCollectionRef('assets', true);

      const stagingMetaRef = getMetaDocRef(false);
      const forcedProdMetaRef = getMetaDocRef(true);

      return {
        prodRoot,
        stagingRoot,
        stagingStoreRoot: stagingStoreRef.root,
        forcedProdStoreRoot: forcedProdStoreRef.root,
        stagingMetaRoot: stagingMetaRef.root,
        forcedProdMetaRoot: forcedProdMetaRef.root
      };
    });

    expect(routingCheck.prodRoot).toBe(false);
    expect(routingCheck.stagingRoot).toBe(true);
    expect(routingCheck.stagingStoreRoot).toBe('hammsStores_staging');
    expect(routingCheck.forcedProdStoreRoot).toBe('hammsStores');
    expect(routingCheck.stagingMetaRoot).toBe('hammsMeta_staging');
    expect(routingCheck.forcedProdMetaRoot).toBe('hammsMeta');
  });

  test('Displays staging sandbox badge and clone button when in staging environment', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      window._forceStagingEnv = true;
      window._FB = window._FB || {};
      window._FB.isAdmin = true;
      updateStagingUiState();
    });

    const badge = page.locator('#staging-badge');
    const cloneBtn = page.locator('#staging-clone-btn');

    await expect(badge).toBeVisible();
    await expect(badge).toContainText('STAGING SANDBOX');
    await expect(cloneBtn).toBeVisible();
    await expect(cloneBtn).toContainText('Clone Production Data');
  });

});
