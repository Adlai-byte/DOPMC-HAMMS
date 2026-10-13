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
    if (typeof _fbPendingStoreOps !== 'undefined') {
      Object.keys(_fbPendingStoreOps).forEach(k => delete _fbPendingStoreOps[k]);
    }
    if (!window._FB) window._FB = { enabled: false, db: null };
    else { window._FB.enabled = false; window._FB.db = null; }
    window.confirmDialog = async () => true;
    navigate('dashboard');
  });
}

test.describe('Main Project Priority Bug Fixes', () => {

  test('Priority 1.1: New WO modal immediately populates location datalist', async ({ page }) => {
    await bootstrapApp(page);

    // Seed assets with distinct locations
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 1, name: 'Air Handler 1', section: 'Mechanical', mainCategory: 'HVAC / Refrigeration', location: 'OR Suite 1', roomNumber: 'OR-1' },
        { id: 2, name: 'Defibrillator A', section: 'Biomedical', mainCategory: 'Biomedical', location: 'Emergency Room', roomNumber: 'ER-Main' },
        { id: 3, name: 'Distribution Panel 1', section: 'Electrical', mainCategory: 'Electrical', location: 'Electrical Room 2nd Fl', roomNumber: 'ER-201' }
      ]);
      openWOModal();
    });

    const dlOptions = await page.evaluate(() => {
      const dl = document.getElementById('wo-loc-list');
      return Array.from(dl.options).map(o => o.value);
    });

    expect(dlOptions).toContain('OR Suite 1');
    expect(dlOptions).toContain('Emergency Room');
    expect(dlOptions).toContain('Electrical Room 2nd Fl');
  });

  test('Priority 1.2: Typing room first filters assets across sections and auto-fills section on select', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('assets', [
        { id: 1, name: 'OR Aircon', section: 'Mechanical', mainCategory: 'HVAC / Refrigeration', location: 'OR Suite 1', roomNumber: 'OR-1' },
        { id: 2, name: 'OR Surgical Light', section: 'Electrical', mainCategory: 'Electrical', location: 'OR Suite 1', roomNumber: 'OR-1' },
        { id: 3, name: 'Ward Ceiling Fan', section: 'Electrical', mainCategory: 'Electrical', location: 'Ward 3', roomNumber: 'W-3' }
      ]);
      openWOModal();
      document.getElementById('m-wo-section').value = '';
      document.getElementById('m-wo-loc').value = 'OR Suite 1';
      fillAssetDrop();
    });

    const options = await page.evaluate(() => {
      const sel = document.getElementById('m-wo-asset');
      return Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
    });

    expect(options.some(o => o.value === 'OR Aircon')).toBe(true);
    expect(options.some(o => o.value === 'OR Surgical Light')).toBe(true);
    expect(options.some(o => o.value === 'Ward Ceiling Fan')).toBe(false);

    // Now select OR Surgical Light and verify section auto-populates to Electrical and location updates
    const stateAfterSelect = await page.evaluate(() => {
      const sel = document.getElementById('m-wo-asset');
      sel.value = 'OR Surgical Light';
      onWOAssetChange();
      return {
        section: document.getElementById('m-wo-section').value,
        location: document.getElementById('m-wo-loc').value
      };
    });

    expect(stateAfterSelect.section).toBe('Electrical');
    expect(stateAfterSelect.location).toBe('OR Suite 1');
  });

  test('Priority 1.3: General Room / Facility maintenance work order can be created and saved', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      openWOModal();
      document.getElementById('m-wo-section').value = 'CMW';
      document.getElementById('m-wo-loc').value = 'Hallway 2nd Floor';
      fillAssetDrop();
      const sel = document.getElementById('m-wo-asset');
      sel.value = '__room_general__';
      onWOAssetChange();
      document.getElementById('m-wo-desc').value = 'Repaint water damage patch on wall';
      saveWO();
    });

    const savedWOs = await page.evaluate(() => DB.g('wo'));
    expect(savedWOs.length).toBe(1);
    expect(savedWOs[0].asset).toBe('__room_general__');
    expect(savedWOs[0].location).toBe('Hallway 2nd Floor');
    expect(savedWOs[0].description).toBe('Repaint water damage patch on wall');

    // Check display in renderWO
    await page.evaluate(() => renderWO());
    const tableHtml = await page.evaluate(() => document.getElementById('wo-tbody')?.innerHTML || '');
    expect(tableHtml).toContain('Hallway 2nd Floor');
    expect(tableHtml).toContain('Facility / Room');
  });

  test('Priority 2.1: Editing existing WO with materials does NOT fail with Insufficient Stock when shelf stock is low', async ({ page }) => {
    await bootstrapApp(page);

    // Set initial inventory: 10 items
    await page.evaluate(() => {
      DB.s('inventory', [
        { id: 101, description: '20A Circuit Breaker', category: 'Electrical', unit: 'piece', qty: 10, minLevel: 2 }
      ]);
      DB.s('wo', []);
    });

    // Create WO using 8 circuit breakers -> shelf stock becomes 2
    await page.evaluate(() => {
      openWOModal();
      document.getElementById('m-wo-section').value = 'Electrical';
      document.getElementById('m-wo-desc').value = 'Replace subpanel breakers';
      _woMaterials = [{ invId: 101, qty: 8, issuedTo: 'Engr. Dan' }];
      saveWO();
    });

    const stockAfterCreate = await page.evaluate(() => DB.g('inventory').find(i => i.id === 101).qty);
    expect(stockAfterCreate).toBe(2);

    const woId = await page.evaluate(() => DB.g('wo')[0].id);

    // Now edit the WO: shelf stock is currently 2, but the WO already has 8 allocated.
    // Saving the WO without changing materials (or changing to 9, where 8 + 2 available = 10 max) should succeed!
    const editResult = await page.evaluate((id) => {
      openWOModal(id);
      // Change remarks only
      document.getElementById('m-wo-remarks').value = 'Verified and inspected';
      saveWO();
      return {
        woRemarks: DB.g('wo').find(w => w.id === id)?.remarks,
        invQty: DB.g('inventory').find(i => i.id === 101)?.qty,
        modalStillOpen: !!document.querySelector('#mo-wo.open')
      };
    }, woId);

    expect(editResult.modalStillOpen).toBe(false);
    expect(editResult.woRemarks).toBe('Verified and inspected');
    expect(editResult.invQty).toBe(2); // still 2 because 8 remained allocated
  });

  test('Priority 2.2: Cannot delete inventory item referenced by active Work Order', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('inventory', [
        { id: 201, description: 'PVC Pipe 2-inch', category: 'Plumbing', unit: 'length', qty: 5, minLevel: 1 }
      ]);
      DB.s('wo', [
        { id: 1, section: 'Plumbing', status: 'Open', description: 'Fix sink drainage', materials: [{ invId: 201, qty: 2 }] }
      ]);
    });

    // Attempt to delete inventory item 201
    await page.evaluate(async () => {
      await delInvItem(201);
    });

    // Inventory item must NOT have been deleted
    const invExists = await page.evaluate(() => DB.g('inventory').some(i => i.id === 201));
    expect(invExists).toBe(true);
  });

  test('Priority 3.1: Editing asset in-place immediately invalidates _dashCache and updates KPI totals', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('assets', [
        { id: 1, name: 'Chiller 1', section: 'Mechanical', ratedWatts: 10000, opHoursDay: 10, opDaysMonth: 30, demandFactor: 1.0, pmsIntervalMonths: 6, lastPmsDate: today() },
        { id: 2, name: 'Exhaust Fan', section: 'Mechanical', ratedWatts: 500, opHoursDay: 24, opDaysMonth: 30, demandFactor: 1.0, pmsIntervalMonths: 12, lastPmsDate: today() }
      ]);
      renderDash();
    });

    const initialKwh = await page.evaluate(() => _dashCache?.totalKwh);
    expect(initialKwh).toBeGreaterThan(0);

    // Modify asset 1 in place: change ratedWatts to 50000 (total kWh should increase significantly)
    await page.evaluate(() => {
      const assets = DB.g('assets').map(a => a.id === 1 ? { ...a, ratedWatts: 50000 } : a);
      DB.s('assets', assets);
      renderDash();
    });

    const updatedKwh = await page.evaluate(() => _dashCache?.totalKwh);
    expect(updatedKwh).toBeGreaterThan(initialKwh);
  });

  test('Priority 3.2: Space key on nav item triggers navigation reliably', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      const items = document.querySelectorAll('.nav-item');
      items[2].focus(); // Asset Registry
    });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('.page.active')?.id === 'page-assets', { timeout: 3000 }).catch(() => {});
    const activePage = await page.evaluate(() => document.querySelector('.page.active')?.id);
    expect(activePage).toBe('page-assets');
  });

});
