import { test, expect } from '@playwright/test';

const LIVE_URL = 'https://demoapp-7864a.web.app';

async function bootstrapLiveApp(page) {
  await page.goto(LIVE_URL + '/?nocache=' + Date.now());
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  });
  await page.goto(LIVE_URL + '/?nocache=' + Date.now());
  await page.waitForLoadState('domcontentloaded');
}

test.describe('Live Deployed Site Verification', () => {

  test('Live Check 1: Deployed site loads with correct Service Worker v2.10.18 and zero console errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await bootstrapLiveApp(page);

    // Verify app container exists
    const appEl = await page.locator('#app');
    expect(await appEl.count()).toBe(1);

    // Verify service worker registration or CACHE_NAME
    const swVersion = await page.evaluate(async () => {
      const resp = await fetch('/sw.js?nocache=' + Date.now());
      const txt = await resp.text();
      const m = txt.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
      return m ? m[1] : null;
    });
    expect(swVersion).toBe('hamms-v2-10-18');
    console.log('Live Verified SW Version:', swVersion);

    // Check for critical console errors (ignore benign network aborts if any)
    const severeErrors = consoleErrors.filter(e => !e.includes('net::ERR_ABORTED') && !e.includes('favicon'));
    expect(severeErrors.length).toBe(0);
  });

  test('Live Check 2: Live buildLocAbv handles ICU and DIETARY without RM prepending or truncation', async ({ page }) => {
    await bootstrapLiveApp(page);

    const results = await page.evaluate(() => {
      return {
        icuSimple: buildLocAbv('ICU'),
        icuWithUnderscore: buildLocAbv('ICU_'),
        icuRoomNo: buildLocAbv('Main Building', '1st Floor', 'ICU'),
        dietarySimple: buildLocAbv('DIETARY'),
        dietaryWithUnderscore: buildLocAbv('DIETARY_'),
        dietaryDept: buildLocAbv('DIETARY DEPT'),
        dietaryDepartment: buildLocAbv('DIETARY DEPARTMENT'),
        dietaryKitchen: buildLocAbv('Dietary Kitchen'),
        dietaryRoomNo: buildLocAbv('Main Building', '1st Floor', 'DIETARY'),
        dietaryDiet: buildLocAbv('Diet')
      };
    });

    console.log('Live buildLocAbv Results:', results);
    expect(results.icuSimple).toBe('ICU');
    expect(results.icuWithUnderscore).toBe('ICU');
    expect(results.icuRoomNo).toBe('ICU');
    expect(results.dietarySimple).toBe('DIET');
    expect(results.dietaryWithUnderscore).toBe('DIET');
    expect(results.dietaryDept).toBe('DIET');
    expect(results.dietaryDepartment).toBe('DIET');
    expect(results.dietaryKitchen).toBe('DIET');
    expect(results.dietaryRoomNo).toBe('DIET');
    expect(results.dietaryDiet).toBe('DIET');
  });

  test('Live Check 3: Live isSameLocation correctly isolates ICU from NICU, PICU, and ICU Corridor, and equates DIETARY variants', async ({ page }) => {
    await bootstrapLiveApp(page);

    const results = await page.evaluate(() => {
      return {
        icuVsNicu: isSameLocation('ICU', 'NICU'),
        icuVsPicu: isSameLocation('ICU', 'PICU'),
        icuVsIcuCr: isSameLocation('ICU', 'ICU CR'),
        icuVsIcuCorridor: isSameLocation('ICU', 'ICU Corridor'),
        icuVsIcuLobby: isSameLocation('ICU', 'ICU Lobby'),
        icuVsIcuUnderscore: isSameLocation('ICU', 'ICU_'),
        dietaryVsDiet: isSameLocation('DIETARY', 'DIET'),
        dietaryVsDietaryDept: isSameLocation('DIETARY', 'DIETARY DEPT'),
        dietaryVsKitchen: isSameLocation('DIETARY', 'KITCHEN'),
        dietaryVsDietaryKitchen: isSameLocation('DIETARY', 'DIETARY KITCHEN'),
        dietaryVsDietaryUnderscore: isSameLocation('DIETARY', 'DIETARY_'),
        dietVsDietaryUnderscore: isSameLocation('DIET', 'DIETARY_'),
        dietaryVsDietaryCorridor: isSameLocation('DIETARY', 'Dietary Corridor')
      };
    });

    console.log('Live isSameLocation Results:', results);
    expect(results.icuVsNicu).toBe(false);
    expect(results.icuVsPicu).toBe(false);
    expect(results.icuVsIcuCr).toBe(true);
    expect(results.icuVsIcuCorridor).toBe(false);
    expect(results.icuVsIcuLobby).toBe(false);
    expect(results.icuVsIcuUnderscore).toBe(true);
    expect(results.dietaryVsDiet).toBe(true);
    expect(results.dietaryVsDietaryDept).toBe(true);
    expect(results.dietaryVsKitchen).toBe(true);
    expect(results.dietaryVsDietaryKitchen).toBe(true);
    expect(results.dietaryVsDietaryUnderscore).toBe(true);
    expect(results.dietVsDietaryUnderscore).toBe(true);
    expect(results.dietaryVsDietaryCorridor).toBe(false);
  });

  test('Live Check 4: Live Asset Search and Room View correctly isolates ICU and DIETARY', async ({ page }) => {
    await bootstrapLiveApp(page);

    // Seed test records in memory on the live page
    await page.evaluate(() => {
      document.getElementById('hamms-login-overlay').style.cssText = 'display:none !important';
      document.getElementById('app').style.visibility = 'visible';
      if (typeof _memDB === 'undefined') window._memDB = {};
      const stores = ['wo','assets','inventory','issuance','waste','waterLogs','waterTank','effluent','safety','projects','medWasteProd','wwProd','censusLog','waterSettings','energyBills'];
      stores.forEach(s => { if (!_memDB[s]) _memDB[s] = []; });
      if (!window._FB) window._FB = { enabled: false, db: null };
      else { window._FB.enabled = false; }

      DB.s('assets', [
        { id: 1, name: 'ICU Patient Monitor', location: 'ICU', section: 'Biomedical', assetCode: 'PM-BIOMED-ICU-01' },
        { id: 2, name: 'NICU Incubator', location: 'NICU', section: 'Biomedical', assetCode: 'INC-BIOMED-NICU-01' },
        { id: 3, name: 'PICU Ventilator', location: 'PICU', section: 'Biomedical', assetCode: 'VENT-BIOMED-PICU-01' },
        { id: 4, name: 'Dietary Blender', location: 'Dietary', section: 'Mechanical', assetCode: 'BL-MECH-DIET-01' },
        { id: 5, name: 'Food Warmer', location: 'Diet', section: 'Mechanical', assetCode: 'FW-MECH-DIET-02' }
      ]);
      DB.s('wo', [
        { id: 101, code: 'WO-0101', asset: 'ICU Patient Monitor', location: 'ICU', description: 'Monitor calibration', status: 'Open', section: 'Biomedical', priority: 'Medium' },
        { id: 102, code: 'WO-0102', asset: 'NICU Incubator', location: 'NICU', description: 'Temp sensor test', status: 'Open', section: 'Biomedical', priority: 'High' },
        { id: 103, code: 'WO-0103', asset: 'Dietary Blender', location: 'Dietary', description: 'Motor inspection', status: 'Open', section: 'Mechanical', priority: 'Low' }
      ]);
      navigate('assets');
    });

    // 1. Search 'ICU' on live asset registry
    const icuSearchResults = await page.evaluate(() => {
      document.getElementById('af-search').value = 'ICU';
      renderAssets();
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => r.innerText);
    });
    console.log('Live Asset search for ICU:', icuSearchResults);
    expect(icuSearchResults.length).toBe(1);
    expect(icuSearchResults[0]).toContain('PM-BIOMED-ICU-01');
    expect(icuSearchResults[0]).toContain('ICU Patient Monitor');

    // 2. Search 'ICU_' on live asset registry
    const icuUnderSearchResults = await page.evaluate(() => {
      document.getElementById('af-search').value = 'ICU_';
      renderAssets();
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(icuUnderSearchResults.length).toBe(1);
    expect(icuUnderSearchResults[0]).toContain('PM-BIOMED-ICU-01');

    // 3. Search 'DIETARY' on live asset registry
    const dietarySearchResults = await page.evaluate(() => {
      document.getElementById('af-search').value = 'DIETARY';
      renderAssets();
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => r.innerText);
    });
    console.log('Live Asset search for DIETARY:', dietarySearchResults);
    expect(dietarySearchResults.length).toBe(2);
    expect(dietarySearchResults.some(r => r.includes('Dietary Blender'))).toBe(true);
    expect(dietarySearchResults.some(r => r.includes('Food Warmer'))).toBe(true);

    // 4. Open Room View for Dietary on live site
    const dietaryRoomView = await page.evaluate(() => {
      openRoomView('Dietary');
      return {
        assets: document.getElementById('room-view-assets').innerText,
        wos: document.getElementById('room-view-wos').innerText
      };
    });
    console.log('Live Dietary Room View:', dietaryRoomView);
    expect(dietaryRoomView.assets).toContain('Dietary Blender');
    expect(dietaryRoomView.assets).toContain('Food Warmer');
    expect(dietaryRoomView.wos).toContain('Motor inspection');
  });

});
