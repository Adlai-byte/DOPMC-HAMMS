import { test, expect } from '@playwright/test';

async function bootstrapApp(page) {
  await page.goto('/?nocache=' + Date.now());
  await page.evaluate(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(r => r.forEach(w => w.unregister()));
    caches.keys().then(k => k.forEach(n => caches.delete(n)));
  });
  await page.goto('/?nocache=' + Date.now());
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    document.getElementById('hamms-login-overlay').style.cssText = 'display:none !important';
    document.getElementById('app').style.visibility = 'visible';
    if (typeof _memDB === 'undefined') window._memDB = {};
    const stores = ['wo','assets','inventory','issuance','waste','waterLogs','waterTank','effluent','safety','projects','medWasteProd','wwProd','censusLog','waterSettings','energyBills'];
    stores.forEach(s => { if (!_memDB[s]) _memDB[s] = []; });
    if (!_memDB.personnel) _memDB.personnel = {};
    if (!window._FB) window._FB = { enabled: false, db: null };
    else { window._FB.enabled = false; window._FB.db = null; }
    window.confirmDialog = async () => true;
    navigate('dashboard');
  });
}

test.describe('Fluorescent and Bulb Verification Suite', () => {

  test('Check 1: detectAssetType accurately classifies Fluorescent (all spellings) and Bulb with 12 hrs/day and 1.0 demand factor', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      const cases = [
        'Fluorescent Lamp',
        'Fluorescent Lamp 36W',
        'Fluorescent Tube',
        'Fluorescent Starter',
        'Flourescent Lamp',
        'Flourescent Tube 36W',
        'Flourescent Starter',
        'Bulb',
        'LED Bulb',
        'LED Bulb 9W',
        'Light Bulb',
        'Emergency Light',
        'LED Panel Light 40W',
        'Downlight 12W'
      ];
      return cases.map(name => ({
        name,
        res: detectAssetType(name)
      }));
    });

    results.forEach(({ name, res }) => {
      expect(res.type, `detectAssetType for "${name}" should be Lighting`).toBe('Lighting');
      expect(res.hrs, `detectAssetType for "${name}" should default to 12 hours`).toBe(12);
      expect(res.df, `detectAssetType for "${name}" should have demand factor 1.0`).toBe(1.0);
    });

    // Also verify non-lighting equipment is still detected accurately
    const nonLighting = await page.evaluate(() => {
      return {
        ac: detectAssetType('Split Type Aircon - Room 101'),
        fan: detectAssetType('Exhaust Fan 50W'),
        pump: detectAssetType('Centrifugal Water Pump'),
        fridge: detectAssetType('Medicine Refrigerator')
      };
    });

    expect(nonLighting.ac.type).toBe('Air Conditioning');
    expect(nonLighting.fan.type).toBe('Fan / Ventilation');
    expect(nonLighting.pump.type).toBe('Motor / Pump');
    expect(nonLighting.fridge.type).toBe('Refrigeration');
  });

  test('Check 2: Asset Code generation produces FL for Fluorescent/Flourescent and LB for Bulbs', async ({ page }) => {
    await bootstrapApp(page);
    const codes = await page.evaluate(() => {
      return {
        fluoroLamp: generateAssetCodeFull({ name: 'Fluorescent Lamp 36W', section: 'Electrical', location: 'Room 101' }),
        flouroTube: generateAssetCodeFull({ name: 'Flourescent Tube 36W', section: 'Electrical', location: 'Room 102' }),
        flouroStarter: generateAssetCodeFull({ name: 'Flourescent Starter', section: 'Electrical', location: 'Corridor B' }),
        ledBulb: generateAssetCodeFull({ name: 'LED Bulb 9W', section: 'Electrical', location: 'Room 201' }),
        bulbPlain: generateAssetCodeFull({ name: 'Bulb', section: 'Electrical', location: 'Room 202' }),
        templateFluoro: generateAssetCodeFull({
          name: 'Fluorescent Fixture',
          assetClass: 'Lighting',
          assetType: 'Fluorescent Lamp',
          section: 'Electrical',
          location: 'Corridor A'
        }),
        templateBulb: generateAssetCodeFull({
          name: 'Ceiling Bulb',
          assetClass: 'Lighting',
          assetType: 'LED Bulb',
          section: 'Electrical',
          location: 'Ward 1'
        })
      };
    });

    expect(codes.fluoroLamp).toMatch(/^FL-ELEC-RM101-\d{2}$/);
    expect(codes.flouroTube).toMatch(/^FL-ELEC-RM102-\d{2}$/);
    expect(codes.flouroStarter).toMatch(/^FL-ELEC-(?:CORRIDOR|CORRB)-\d{2}$/);
    expect(codes.ledBulb).toMatch(/^LB-ELEC-RM201-\d{2}$/);
    expect(codes.bulbPlain).toMatch(/^LB-ELEC-RM202-\d{2}$/);
    expect(codes.templateFluoro).toMatch(/^FL-ELEC-(?:CORRIDOR|CORRA)-\d{2}$/);
    expect(codes.templateBulb).toMatch(/^LB-ELEC-WRD1-\d{2}$/);
  });

  test('Check 3: Energy computation in Asset Modal auto-detects hours and demand factor from asset name', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openAssetModal();
      document.getElementById('m-a-name').value = 'Fluorescent Lamp 36W';
      document.getElementById('m-a-watts').value = '36';
      document.getElementById('m-a-opdays').value = '30';
      computeEnergy();
    });

    const energyState = await page.evaluate(() => {
      return {
        kwh: document.getElementById('energy-kwh').textContent,
        typeDetected: document.getElementById('energy-type-detected').textContent,
        hrsAuto: document.getElementById('energy-hrs-auto').textContent,
        dfAuto: document.getElementById('energy-df-auto').textContent,
        placeholder: document.getElementById('m-a-ophrs').placeholder
      };
    });

    // 36W = 0.036 kW * 12 hrs/day * 30 days * 1.0 df = 12.96 kWh -> 13.0 kWh
    expect(energyState.kwh).toBe('13.0');
    expect(energyState.typeDetected).toBe('Lighting');
    expect(energyState.hrsAuto).toBe('12 hrs/day');
    expect(energyState.dfAuto).toBe('1.00');
    expect(energyState.placeholder).toBe('12');

    // Test with LED Bulb 9W
    await page.evaluate(() => {
      document.getElementById('m-a-name').value = 'LED Bulb 9W';
      document.getElementById('m-a-watts').value = '9';
      document.getElementById('m-a-opdays').value = '30';
      computeEnergy();
    });

    const bulbEnergyState = await page.evaluate(() => {
      return {
        kwh: document.getElementById('energy-kwh').textContent,
        typeDetected: document.getElementById('energy-type-detected').textContent
      };
    });

    // 9W = 0.009 kW * 12 hrs/day * 30 days * 1.0 df = 3.24 kWh -> 3.2 kWh
    expect(bulbEnergyState.kwh).toBe('3.2');
    expect(bulbEnergyState.typeDetected).toBe('Lighting');
  });

  test('Check 4: saveAsset calculates and saves theoretical kWh and auto-assigns FL/LB code when hrs are omitted', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openAssetModal();
      document.getElementById('m-a-name').value = 'Fluorescent Lamp 36W';
      document.getElementById('m-a-section').value = 'Electrical';
      document.getElementById('m-a-loc').value = 'Room 101';
      document.getElementById('m-a-watts').value = '36';
      document.getElementById('m-a-opdays').value = '30';
      saveAsset();
    });

    const savedAsset = await page.evaluate(() => {
      return _memDB.assets.find(a => a.name === 'Fluorescent Lamp 36W');
    });

    expect(savedAsset).toBeDefined();
    expect(savedAsset.assetCode).toMatch(/^FL-ELEC-RM101-\d{2}$/);
    expect(savedAsset.opHoursDay).toBe(12);
    expect(savedAsset.demandFactor).toBe(1.0);
    expect(savedAsset.estimatedKwhMonth).toBe(12.96);
  });

  test('Check 5: Search normalization matches "flourescent" search query against "fluorescent" records across modules', async ({ page }) => {
    await bootstrapApp(page);

    // Seed test records with standard "Fluorescent" spelling
    await page.evaluate(() => {
      _memDB.assets = [
        { id: 101, name: 'Fluorescent Lamp 36W', section: 'Electrical', location: 'Room 101', assetCode: 'FL-ELEC-RM101-01' },
        { id: 102, name: 'LED Bulb 9W', section: 'Electrical', location: 'Room 102', assetCode: 'LB-ELEC-RM102-01' }
      ];
      _memDB.inventory = [
        { id: 201, description: 'Fluorescent Starter', category: 'Electrical', qty: 50, minLevel: 10, unit: 'piece' },
        { id: 202, description: 'LED Bulb 9W E27', category: 'Electrical', qty: 40, minLevel: 10, unit: 'piece' }
      ];
      _memDB.issuance = [
        { id: 301, description: 'Fluorescent Starter', issuedTo: 'Reyes, A.', qtyIssued: 5, date: '2026-02-01', category: 'Electrical' },
        { id: 302, description: 'LED Bulb 9W E27', issuedTo: 'Santos, M.', qtyIssued: 2, date: '2026-02-01', category: 'Electrical' }
      ];
      _memDB.wo = [
        { id: 401, code: 'WO-2026-0001', asset: 'Fluorescent Lamp - Corridor B', description: 'Replace flickering fluorescent tubes', section: 'Electrical', location: 'Corridor B', status: 'Open', priority: 'Medium', dateStart: '2026-02-01' },
        { id: 402, code: 'WO-2026-0002', asset: 'LED Bulb - Room 102', description: 'Replace burnt out bulb', section: 'Electrical', location: 'Room 102', status: 'Open', priority: 'Low', dateStart: '2026-02-01' }
      ];
      _memDB.safety = [
        { id: 501, description: 'Fluorescent fixture loose in corridor', asset: 'Fluorescent Lamp', location: 'Corridor B', severity: 'High', status: 'Open', date: '2026-02-01' },
        { id: 502, description: 'Exposed wire near switch', asset: 'Toggle Switch', location: 'Room 105', severity: 'Medium', status: 'Open', date: '2026-02-01' }
      ];
    });

    // 1. Asset Registry search for "flourescent"
    const assetSearch = await page.evaluate(() => {
      document.getElementById('af-search').value = 'flourescent';
      renderAssets();
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => r.textContent);
    });
    expect(assetSearch.length).toBe(1);
    expect(assetSearch[0]).toContain('Fluorescent Lamp 36W');

    // 2. Inventory search for "flourescent"
    const invSearch = await page.evaluate(() => {
      document.getElementById('invf-search').value = 'flourescent';
      renderInventory();
      const rows = Array.from(document.querySelectorAll('#inv-tbody tr'));
      return rows.map(r => r.textContent);
    });
    expect(invSearch.length).toBe(1);
    expect(invSearch[0]).toContain('Fluorescent Starter');

    // 3. Issuance search for "flourescent"
    const issSearch = await page.evaluate(() => {
      document.getElementById('isf-search').value = 'flourescent';
      renderIssuance();
      const rows = Array.from(document.querySelectorAll('#issue-tbody tr'));
      return rows.map(r => r.textContent);
    });
    expect(issSearch.length).toBe(1);
    expect(issSearch[0]).toContain('Fluorescent Starter');

    // 4. Work Order search for "flourescent"
    const woSearch = await page.evaluate(() => {
      document.getElementById('wof-search').value = 'flourescent';
      renderWO();
      const rows = Array.from(document.querySelectorAll('#wo-tbody tr'));
      return rows.map(r => r.textContent);
    });
    expect(woSearch.length).toBe(1);
    expect(woSearch[0]).toContain('Fluorescent Lamp - Corridor B');

    // 5. Safety search for "flourescent"
    const safetySearch = await page.evaluate(() => {
      if (document.getElementById('sf-month')) document.getElementById('sf-month').value = '';
      if (document.getElementById('sf-year')) document.getElementById('sf-year').value = '';
      document.getElementById('sf-search').value = 'flourescent';
      renderSafety();
      const rows = Array.from(document.querySelectorAll('#safety-tbody tr'));
      return rows.map(r => r.textContent);
    });
    expect(safetySearch.length).toBe(1);
    expect(safetySearch[0]).toContain('Fluorescent fixture loose');

    // 6. Search for "bulb" finds bulbs and NOT fluorescent
    const bulbInvSearch = await page.evaluate(() => {
      document.getElementById('invf-search').value = 'bulb';
      renderInventory();
      const rows = Array.from(document.querySelectorAll('#inv-tbody tr'));
      return rows.map(r => r.textContent);
    });
    expect(bulbInvSearch.length).toBe(1);
    expect(bulbInvSearch[0]).toContain('LED Bulb 9W E27');
    expect(bulbInvSearch[0]).not.toContain('Fluorescent');
  });

});
