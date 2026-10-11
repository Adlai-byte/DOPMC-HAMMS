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

  test('Live Check 1: Deployed site loads with correct Service Worker v2.13.5 and zero console errors', async ({ page }) => {
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
    expect(swVersion).toBe('hamms-v2-13-5');
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
      const stores = ['wo','assets','inventory','issuance','waste','waterLogs','waterTank','effluent','safety','projects','medWasteProd','wwProd','censusLog','waterSettings','energyBills','locations'];
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

  test('Live Check 4: Live Fluorescent & Bulb auto-detection, code generation, and search normalization', async ({ page }) => {
    await bootstrapLiveApp(page);

    // 1. Live detectAssetType
    const detected = await page.evaluate(() => {
      return {
        flLamp: detectAssetType('Fluorescent Lamp 36W'),
        flTube: detectAssetType('Flourescent Tube'),
        flStarter: detectAssetType('Flourescent Starter'),
        bulb: detectAssetType('Bulb'),
        ledBulb: detectAssetType('LED Bulb 9W')
      };
    });

    expect(detected.flLamp.type).toBe('Lighting');
    expect(detected.flLamp.hrs).toBe(12);
    expect(detected.flLamp.df).toBe(1.0);

    expect(detected.flTube.type).toBe('Lighting');
    expect(detected.flStarter.type).toBe('Lighting');
    expect(detected.bulb.type).toBe('Lighting');
    expect(detected.ledBulb.type).toBe('Lighting');

    // 2. Live asset auto-code generation
    const codes = await page.evaluate(() => {
      return {
        flCode: generateAssetCodeFull({ name: 'Fluorescent Lamp 36W', section: 'Electrical', location: 'Room 101' }),
        flouroCode: generateAssetCodeFull({ name: 'Flourescent Tube', section: 'Electrical', location: 'Room 102' }),
        bulbCode: generateAssetCodeFull({ name: 'LED Bulb 9W', section: 'Electrical', location: 'Room 103' })
      };
    });

    expect(codes.flCode).toMatch(/^FL-ELEC-RM101-\d{2}-[A-F0-9]{8}$/);
    expect(codes.flouroCode).toMatch(/^FL-ELEC-RM102-\d{2}-[A-F0-9]{8}$/);
    expect(codes.bulbCode).toMatch(/^LB-ELEC-RM103-\d{2}-[A-F0-9]{8}$/);

    // 3. Live search normalization
    const normResults = await page.evaluate(() => {
      return {
        flourescentNorm: normSearchTerm('flourescent lamp'),
        fluorescentNorm: normSearchTerm('fluorescent lamp')
      };
    });

    expect(normResults.flourescentNorm).toBe('fluorescent lamp');
    expect(normResults.fluorescentNorm).toBe('fluorescent lamp');
  });

  test('Live Check 6: Stable asset history survives different names and isolates similar assets', async ({ page }) => {
    await bootstrapLiveApp(page);
    const result = await page.evaluate(() => {
      window._FB.enabled = false;
      _memDB.assets = [
        {id:1,_docId:'synthetic-ramp-01',name:'FLOURESCENT TUBE 18W',section:'Electrical',location:'RAMP'},
        {id:3,_docId:'synthetic-ramp-03',name:'FLOURESCENT TUBE 18W',section:'Electrical',location:'RAMP'}
      ];
      _memDB.wo = [{id:11,_docId:'synthetic-wo-11',code:'ELEC-HI-0011',asset:'Flourescent Tube 18 Watts',assetDocId:'synthetic-ramp-01',section:'Electrical',location:'RAMP',description:'Synthetic linked repair',status:'Closed'}];
      viewHistory(1);const owner=document.getElementById('history-tbody').textContent;
      viewHistory(3);const other=document.getElementById('history-tbody').textContent;
      return {owner,other};
    });
    expect(result.owner).toContain('ELEC-HI-0011');
    expect(result.other).not.toContain('ELEC-HI-0011');
  });
  test('Live Check 7: RSA assets show empty repair status and new work orders retain ownership', async ({ page }) => {
    await bootstrapLiveApp(page);
    const result=await page.evaluate(()=>{
      window._FB.enabled=false;
      STORES.forEach(store=>applyStoreData(store,[]));
      applyStoreData('assets',[{id:1,_docId:'synthetic-rsa-tube',assetCode:'OT-ELEC-DIETAR-09',name:'FLOURESCENT TUBE 18W',section:'Electrical',location:'DIETARY RSA'},{id:2,_docId:'synthetic-rsa-bulb',assetCode:'OT-ELEC-DIETAR-10',name:'COMPACT BULB 15W',section:'Electrical',location:'DIETARY RSA'},{id:3,_docId:'synthetic-department',assetCode:'GENERAL-01',name:'Department fixture',section:'Plumbing',location:'Dietary'}]);
      openRoomView('DIETARY RSA');const before=document.getElementById('room-view-assets').textContent;
      createAssetWorkOrder(2);const selected=document.getElementById('m-wo-asset').selectedOptions[0].dataset.docId;
      document.getElementById('m-wo-desc').value='Synthetic RSA verification';saveWO();
      return {before,selected,saved:DB.g('wo')[0]?.assetDocId,tubeStatus:assetRepairStatus(DB.g('assets')[0]),bulbStatus:assetRepairStatus(DB.g('assets')[1])};
    });
    expect(result.before).toContain('OT-ELEC-DIETAR-09');expect(result.before).toContain('OT-ELEC-DIETAR-10');expect(result.before).toContain('No recorded repairs');expect(result.before).not.toContain('GENERAL-01');expect(result.selected).toBe('synthetic-rsa-bulb');expect(result.saved).toBe('synthetic-rsa-bulb');expect(result.tubeStatus).toBe('No recorded repairs');expect(result.bulbStatus).toBe('1 linked work order');
  });

  test('Live Check 8: Live deployment contains locations store, 28 DOPMC rooms, cycle detection, and startup migration', async ({ page }) => {
    await bootstrapLiveApp(page);

    const checks = await page.evaluate(() => {
      return {
        hasLocationsStore: typeof STORES !== 'undefined' && STORES.includes('locations'),
        standardRoomCount: typeof DOPMC_STANDARD_LOCATIONS !== 'undefined' ? DOPMC_STANDARD_LOCATIONS.length : 0,
        hasAutoMigration: typeof checkAndRunStartupLocationMigration === 'function',
        hasDescendantHelper: typeof getDescendantAssetDocIds === 'function',
        hasAutoSummaryModal: !!document.getElementById('mo-loc-auto-summary'),
        hasLocationModal: !!document.getElementById('mo-loc')
      };
    });

    console.log('Live Check 8 Results:', checks);
    expect(checks.hasLocationsStore).toBe(true);
    expect(checks.standardRoomCount).toBe(28);
    expect(checks.hasAutoMigration).toBe(true);
    expect(checks.hasDescendantHelper).toBe(true);
    expect(checks.hasAutoSummaryModal).toBe(true);
    expect(checks.hasLocationModal).toBe(true);
  });
});
