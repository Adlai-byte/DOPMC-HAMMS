import { test, expect } from '@playwright/test';

// Helper: bypass login and initialize empty app state (matches qa-fixes.spec.mjs pattern)
async function bootstrapApp(page) {
  await page.goto('/?nocache=' + Date.now());
  // Clear SW cache
  await page.evaluate(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(r => r.forEach(w => w.unregister()));
    caches.keys().then(k => k.forEach(n => caches.delete(n)));
  });
  await page.goto('/?nocache=' + Date.now());
  await page.waitForLoadState('domcontentloaded');
  // Bypass login, init empty DB, show app
  await page.evaluate(() => {
    document.getElementById('hamms-login-overlay').style.cssText = 'display:none !important';
    document.getElementById('app').style.visibility = 'visible';
    if (typeof _memDB === 'undefined') window._memDB = {};
    const stores = ['wo','assets','inventory','issuance','waste','waterLogs','waterTank','effluent','safety','projects','medWasteProd','wwProd','censusLog','waterSettings','energyBills'];
    stores.forEach(s => { if (!_memDB[s]) _memDB[s] = []; });
    if (!_memDB.personnel) _memDB.personnel = {};
    // Stub Firebase sync so DB.s() does not attempt Firestore writes
    if (typeof _fbPendingStoreOps !== 'undefined') {
      Object.keys(_fbPendingStoreOps).forEach(k => delete _fbPendingStoreOps[k]);
    }
    if (!window._FB) window._FB = { enabled: false, db: null };
    else { window._FB.enabled = false; window._FB.db = null; }
    // Override confirmDialog for delete tests — auto-confirm
    window.confirmDialog = async () => true;
    navigate('dashboard');
  });
}

// ═══════════════════════════════════════════════════
// Module 1 — Work Orders CRUD
// ═══════════════════════════════════════════════════

test.describe('Work Orders CRUD', () => {

  test('Create a new Work Order', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('workorders'));

    // Open new WO modal
    await page.evaluate(() => openWOModal());
    const modalOpen = await page.evaluate(() => !!document.querySelector('#mo-wo.open'));
    expect(modalOpen).toBe(true);

    // Fill required fields
    await page.evaluate(() => {
      document.getElementById('m-wo-section').value = 'Electrical';
      document.getElementById('m-wo-desc').value = 'Replace faulty circuit breaker in Ward 3';
      document.getElementById('m-wo-priority').value = 'High';
      document.getElementById('m-wo-status').value = 'Open';
      document.getElementById('m-wo-dstart').value = '2026-03-19';
    });

    // Click save
    await page.evaluate(() => saveWO());

    // Verify record exists in _memDB
    const result = await page.evaluate(() => {
      const wos = _memDB.wo;
      return {
        count: wos.length,
        last: wos[wos.length - 1],
      };
    });
    expect(result.count).toBe(1);
    expect(result.last.section).toBe('Electrical');
    expect(result.last.description).toBe('Replace faulty circuit breaker in Ward 3');
    expect(result.last.priority).toBe('High');
    expect(result.last.status).toBe('Open');

    // Modal should be closed
    const modalClosed = await page.evaluate(() => !document.querySelector('#mo-wo.open'));
    expect(modalClosed).toBe(true);
  });

  test('Edit an existing Work Order', async ({ page }) => {
    await bootstrapApp(page);

    // Seed a WO record
    const woId = await page.evaluate(() => {
      const id = DB.nid('wo');
      const wos = DB.g('wo');
      wos.push({ id, section: 'Plumbing', description: 'Fix leaking pipe', priority: 'Medium', status: 'Open', dateStart: '2026-03-10', dateEnd: '', assigned: '', remarks: '', materials: [], createdAt: '2026-03-10' });
      _memDB.wo = wos;
      return id;
    });

    await page.evaluate(() => navigate('workorders'));

    // Open edit modal
    await page.evaluate((id) => openWOModal(id), woId);

    // Change status to Closed
    await page.evaluate(() => {
      document.getElementById('m-wo-status').value = 'Closed';
      document.getElementById('m-wo-dend').value = '2026-03-19';
    });

    await page.evaluate(() => saveWO());

    // Verify update
    const updated = await page.evaluate((id) => {
      return _memDB.wo.find(w => w.id === id);
    }, woId);
    expect(updated.status).toBe('Closed');
    expect(updated.dateEnd).toBe('2026-03-19');
    expect(updated.section).toBe('Plumbing');
  });

  test('Delete a Work Order', async ({ page }) => {
    await bootstrapApp(page);

    // Seed a WO
    const woId = await page.evaluate(() => {
      const id = DB.nid('wo');
      const wos = DB.g('wo');
      wos.push({ id, section: 'CMW', description: 'Patch wall crack', priority: 'Low', status: 'Open', dateStart: '2026-03-15', materials: [], createdAt: '2026-03-15' });
      _memDB.wo = wos;
      return id;
    });

    await page.evaluate(() => navigate('workorders'));
    const countBefore = await page.evaluate(() => _memDB.wo.length);
    expect(countBefore).toBe(1);

    // Delete — confirmDialog is auto-confirmed by bootstrap
    await page.evaluate((id) => delWO(id), woId);

    const countAfter = await page.evaluate(() => _memDB.wo.length);
    expect(countAfter).toBe(0);
  });
});

// ═══════════════════════════════════════════════════
// Module 2 — Assets CRUD
// ═══════════════════════════════════════════════════

test.describe('Assets CRUD', () => {

  test('Create a new Asset', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('assets'));

    // Open new asset modal
    await page.evaluate(() => openAssetModal());
    const modalOpen = await page.evaluate(() => !!document.querySelector('#mo-asset.open'));
    expect(modalOpen).toBe(true);

    // Fill required fields
    await page.evaluate(() => {
      document.getElementById('m-a-name').value = 'Split Type Aircon Unit 1';
      document.getElementById('m-a-section').value = 'Mechanical';
      document.getElementById('m-a-condition').value = 'Good';
      document.getElementById('m-a-loc').value = 'Room 201';
    });

    await page.evaluate(() => saveAsset());

    // Verify record
    const result = await page.evaluate(() => {
      const assets = _memDB.assets;
      return {
        count: assets.length,
        last: assets[assets.length - 1],
      };
    });
    expect(result.count).toBe(1);
    expect(result.last.name).toBe('Split Type Aircon Unit 1');
    expect(result.last.section).toBe('Mechanical');
    expect(result.last.condition).toBe('Good');
  });

  test('Edit an existing Asset (change condition)', async ({ page }) => {
    await bootstrapApp(page);

    // Seed an asset
    const assetId = await page.evaluate(() => {
      const id = DB.nid('assets');
      const assets = DB.g('assets');
      assets.push({ id, name: 'Water Pump A', section: 'Plumbing', condition: 'Good', location: 'Pump Room', mainCategory: '', assetClass: '', assetType: '', building: '', floor: '', roomNumber: '', qty: 1 });
      _memDB.assets = assets;
      return id;
    });

    await page.evaluate(() => navigate('assets'));
    await page.evaluate((id) => openAssetModal(id), assetId);

    // Change condition to Poor
    await page.evaluate(() => {
      document.getElementById('m-a-condition').value = 'Poor';
    });

    await page.evaluate(() => saveAsset());

    const updated = await page.evaluate((id) => {
      return _memDB.assets.find(a => a.id === id);
    }, assetId);
    expect(updated.condition).toBe('Poor');
    expect(updated.name).toBe('Water Pump A');
  });

  test('Delete an Asset', async ({ page }) => {
    await bootstrapApp(page);

    // Seed an asset
    const assetId = await page.evaluate(() => {
      const id = DB.nid('assets');
      const assets = DB.g('assets');
      assets.push({ id, name: 'Old Generator', section: 'Electrical', condition: 'For Replacement', location: 'Gen Room' });
      _memDB.assets = assets;
      return id;
    });

    await page.evaluate(() => navigate('assets'));
    const countBefore = await page.evaluate(() => _memDB.assets.length);
    expect(countBefore).toBe(1);

    await page.evaluate((id) => delAsset(id), assetId);

    const countAfter = await page.evaluate(() => _memDB.assets.length);
    expect(countAfter).toBe(0);
  });
});

// ═══════════════════════════════════════════════════
// Module 3 — Inventory CRUD
// ═══════════════════════════════════════════════════

test.describe('Inventory CRUD', () => {

  test('Create a new Inventory item', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('inventory'));

    await page.evaluate(() => openInvModal());
    const modalOpen = await page.evaluate(() => !!document.querySelector('#mo-inv.open'));
    expect(modalOpen).toBe(true);

    // Fill fields
    await page.evaluate(() => {
      document.getElementById('m-i-desc').value = '20A Circuit Breaker';
      document.getElementById('m-i-cat').value = 'Electrical';
      document.getElementById('m-i-qty').value = '50';
      document.getElementById('m-i-unit').value = 'piece';
      document.getElementById('m-i-min').value = '10';
    });

    await page.evaluate(() => saveInvItem());

    const result = await page.evaluate(() => {
      const inv = _memDB.inventory;
      return {
        count: inv.length,
        last: inv[inv.length - 1],
      };
    });
    expect(result.count).toBe(1);
    expect(result.last.description).toBe('20A Circuit Breaker');
    expect(result.last.category).toBe('Electrical');
    expect(result.last.qty).toBe(50);
    expect(result.last.unit).toBe('piece');
  });

  test('Edit an Inventory item (change qty)', async ({ page }) => {
    await bootstrapApp(page);

    // Seed an inventory item
    const invId = await page.evaluate(() => {
      const id = DB.nid('inventory');
      const inv = DB.g('inventory');
      inv.push({ id, description: 'PVC Pipe 1/2"', category: 'Plumbing', qty: 30, unit: 'meter', minLevel: 5, originalQty: 30 });
      _memDB.inventory = inv;
      return id;
    });

    await page.evaluate(() => navigate('inventory'));
    await page.evaluate((id) => openInvModal(id), invId);

    // Change qty
    await page.evaluate(() => {
      document.getElementById('m-i-qty').value = '15';
    });

    await page.evaluate(() => saveInvItem());

    const updated = await page.evaluate((id) => {
      return _memDB.inventory.find(i => i.id === id);
    }, invId);
    expect(updated.qty).toBe(15);
    expect(updated.description).toBe('PVC Pipe 1/2"');
  });

  test('Delete an Inventory item', async ({ page }) => {
    await bootstrapApp(page);

    const invId = await page.evaluate(() => {
      const id = DB.nid('inventory');
      const inv = DB.g('inventory');
      inv.push({ id, description: 'Teflon Tape', category: 'Plumbing', qty: 100, unit: 'roll', minLevel: 10, originalQty: 100 });
      _memDB.inventory = inv;
      return id;
    });

    await page.evaluate(() => navigate('inventory'));
    const countBefore = await page.evaluate(() => _memDB.inventory.length);
    expect(countBefore).toBe(1);

    await page.evaluate((id) => delInvItem(id), invId);

    const countAfter = await page.evaluate(() => _memDB.inventory.length);
    expect(countAfter).toBe(0);
  });
});

// ═══════════════════════════════════════════════════
// Module 4 — Safety CRUD
// ═══════════════════════════════════════════════════

test.describe('Safety CRUD', () => {

  test('Create a new Safety issue', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('safety'));

    await page.evaluate(() => openSafetyModal());
    const modalOpen = await page.evaluate(() => !!document.querySelector('#mo-safety.open'));
    expect(modalOpen).toBe(true);

    // Fill fields — safety has: description*, severity*, status, location, asset, date, loggedBy, remarks
    await page.evaluate(() => {
      document.getElementById('m-sf-desc').value = 'Exposed electrical wiring in corridor B';
      document.getElementById('m-sf-sev').value = 'High';
      document.getElementById('m-sf-status').value = 'Open';
      document.getElementById('m-sf-loc').value = 'Corridor B, 2nd Floor';
      document.getElementById('m-sf-date').value = '2026-03-19';
      document.getElementById('m-sf-by').value = 'Juan Dela Cruz';
    });

    await page.evaluate(() => saveSafety());

    const result = await page.evaluate(() => {
      const list = _memDB.safety;
      return {
        count: list.length,
        last: list[list.length - 1],
      };
    });
    expect(result.count).toBe(1);
    expect(result.last.description).toBe('Exposed electrical wiring in corridor B');
    expect(result.last.severity).toBe('High');
    expect(result.last.status).toBe('Open');
    expect(result.last.date).toBe('2026-03-19');
  });

  test('Edit a Safety issue (change severity and status)', async ({ page }) => {
    await bootstrapApp(page);

    // Seed a safety record
    const sfId = await page.evaluate(() => {
      const id = DB.nid('safety');
      const list = DB.g('safety');
      list.push({ id, description: 'Slippery floor near ER', severity: 'Moderate', status: 'Open', location: 'ER Lobby', date: '2026-03-15', loggedBy: 'Maria Santos', remarks: '' });
      _memDB.safety = list;
      return id;
    });

    await page.evaluate(() => navigate('safety'));
    await page.evaluate((id) => openSafetyModal(id), sfId);

    // Change severity and status
    await page.evaluate(() => {
      document.getElementById('m-sf-sev').value = 'Critical';
      document.getElementById('m-sf-status').value = 'Under Action';
    });

    await page.evaluate(() => saveSafety());

    const updated = await page.evaluate((id) => {
      return _memDB.safety.find(s => s.id === id);
    }, sfId);
    expect(updated.severity).toBe('Critical');
    expect(updated.status).toBe('Under Action');
    expect(updated.description).toBe('Slippery floor near ER');
  });

  test('Delete a Safety issue', async ({ page }) => {
    await bootstrapApp(page);

    const sfId = await page.evaluate(() => {
      const id = DB.nid('safety');
      const list = DB.g('safety');
      list.push({ id, description: 'Broken fire extinguisher', severity: 'High', status: 'Open', location: 'Ward 1', date: '2026-03-10' });
      _memDB.safety = list;
      return id;
    });

    await page.evaluate(() => navigate('safety'));
    const countBefore = await page.evaluate(() => _memDB.safety.length);
    expect(countBefore).toBe(1);

    await page.evaluate((id) => delSafety(id), sfId);

    const countAfter = await page.evaluate(() => _memDB.safety.length);
    expect(countAfter).toBe(0);
  });
});

// ═══════════════════════════════════════════════════
// Module 5 — Waste CRUD
// ═══════════════════════════════════════════════════

test.describe('Waste CRUD', () => {

  test('Create a new Waste entry', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('waste'));

    await page.evaluate(() => openWasteModal());
    const modalOpen = await page.evaluate(() => !!document.querySelector('#mo-waste.open'));
    expect(modalOpen).toBe(true);

    // Fill fields — waste has: date*, type*, volume*, contractor, emb, remarks
    await page.evaluate(() => {
      document.getElementById('m-w-date').value = '2026-03-19';
      document.getElementById('m-w-type').value = 'Infectious';
      document.getElementById('m-w-vol').value = '25.5';
      document.getElementById('m-w-contractor').value = 'Green Waste Corp';
      document.getElementById('m-w-emb').value = 'OK';
    });

    await page.evaluate(() => saveWaste());

    const result = await page.evaluate(() => {
      const w = _memDB.waste;
      return {
        count: w.length,
        last: w[w.length - 1],
      };
    });
    expect(result.count).toBe(1);
    expect(result.last.date).toBe('2026-03-19');
    expect(result.last.type).toBe('Infectious');
    expect(result.last.volume).toBe(25.5);
    expect(result.last.contractor).toBe('Green Waste Corp');
  });

  test('Delete a Waste entry', async ({ page }) => {
    await bootstrapApp(page);

    const wasteId = await page.evaluate(() => {
      const id = DB.nid('waste');
      const w = DB.g('waste');
      w.push({ id, date: '2026-03-18', type: 'Sharps', volume: 3.2, contractor: 'MedDispose Inc', emb: 'OK', remarks: '', createdAt: '2026-03-18' });
      _memDB.waste = w;
      return id;
    });

    await page.evaluate(() => navigate('waste'));
    const countBefore = await page.evaluate(() => _memDB.waste.length);
    expect(countBefore).toBe(1);

    await page.evaluate((id) => delWaste(id), wasteId);

    const countAfter = await page.evaluate(() => _memDB.waste.length);
    expect(countAfter).toBe(0);
  });
});

// ═══════════════════════════════════════════════════
// Module 6 — Projects CRUD
// ═══════════════════════════════════════════════════

test.describe('Projects CRUD', () => {

  test('Create a new Project', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('projects'));

    await page.evaluate(() => openProjectModal());
    const modalOpen = await page.evaluate(() => !!document.querySelector('#mo-project.open'));
    expect(modalOpen).toBe(true);

    // Fill fields — project requires: code*, title*, plus optional status, dates, etc.
    await page.evaluate(() => {
      document.getElementById('m-pj-code').value = 'GSD-2026-001';
      document.getElementById('m-pj-title').value = 'Renovation of OPD Waiting Area';
      document.getElementById('m-pj-cat').value = 'Infrastructure';
      document.getElementById('m-pj-status').value = 'Proposed';
      document.getElementById('m-pj-loc').value = 'OPD Building';
      document.getElementById('m-pj-start').value = '2026-04-01';
      document.getElementById('m-pj-target').value = '2026-09-30';
      document.getElementById('m-pj-budget').value = '500000';
      document.getElementById('m-pj-resp').value = 'Engr. Reyes';
    });

    await page.evaluate(() => saveProject());

    const result = await page.evaluate(() => {
      const list = _memDB.projects;
      return {
        count: list.length,
        last: list[list.length - 1],
      };
    });
    expect(result.count).toBe(1);
    expect(result.last.code).toBe('GSD-2026-001');
    expect(result.last.title).toBe('Renovation of OPD Waiting Area');
    expect(result.last.status).toBe('Proposed');
    expect(result.last.budget).toBe(500000);
    expect(result.last.startDate).toBe('2026-04-01');
    expect(result.last.targetDate).toBe('2026-09-30');
  });

  test('Edit a Project (change status to Ongoing)', async ({ page }) => {
    await bootstrapApp(page);

    // Seed a project
    const pjId = await page.evaluate(() => {
      const id = DB.nid('projects');
      const list = DB.g('projects');
      list.push({ id, code: 'GSD-2026-002', title: 'Elevator Modernization', category: 'Equipment', status: 'For Approval', location: 'Main Building', budget: 2000000, startDate: '2026-05-01', targetDate: '2026-12-31', physicalPct: 0, financialPct: 0, remarks: '' });
      _memDB.projects = list;
      return id;
    });

    await page.evaluate(() => navigate('projects'));
    await page.evaluate((id) => openProjectModal(id), pjId);

    // Change status and physical %
    await page.evaluate(() => {
      document.getElementById('m-pj-status').value = 'Ongoing';
      document.getElementById('m-pj-physical').value = '25';
    });

    await page.evaluate(() => saveProject());

    const updated = await page.evaluate((id) => {
      return _memDB.projects.find(p => p.id === id);
    }, pjId);
    expect(updated.status).toBe('Ongoing');
    expect(updated.physicalPct).toBe(25);
    expect(updated.title).toBe('Elevator Modernization');
  });

  test('Delete a Project', async ({ page }) => {
    await bootstrapApp(page);

    const pjId = await page.evaluate(() => {
      const id = DB.nid('projects');
      const list = DB.g('projects');
      list.push({ id, code: 'GSD-2026-003', title: 'Roof Repair Phase 2', category: 'Civil Works', status: 'Proposed', budget: 300000, startDate: '', targetDate: '' });
      _memDB.projects = list;
      return id;
    });

    await page.evaluate(() => navigate('projects'));
    const countBefore = await page.evaluate(() => _memDB.projects.length);
    expect(countBefore).toBe(1);

    await page.evaluate((id) => delProject(id), pjId);

    const countAfter = await page.evaluate(() => _memDB.projects.length);
    expect(countAfter).toBe(0);
  });
});

// ═══════════════════════════════════════════════════
// Cross-module: Validation guards
// ═══════════════════════════════════════════════════

test.describe('Validation guards', () => {

  test('WO save rejects empty section/description', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('workorders'));
    await page.evaluate(() => openWOModal());

    // Try to save with empty required fields
    const countBefore = await page.evaluate(() => _memDB.wo.length);
    await page.evaluate(() => {
      window._alerts = [];
      saveWO();
    });
    const countAfter = await page.evaluate(() => _memDB.wo.length);
    expect(countAfter).toBe(countBefore);

    // Modal should still be open (save was rejected)
    const stillOpen = await page.evaluate(() => !!document.querySelector('#mo-wo.open'));
    expect(stillOpen).toBe(true);
  });

  test('Inventory save rejects empty description/category/qty', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('inventory'));
    await page.evaluate(() => openInvModal());

    const countBefore = await page.evaluate(() => _memDB.inventory.length);
    await page.evaluate(() => saveInvItem());
    const countAfter = await page.evaluate(() => _memDB.inventory.length);
    expect(countAfter).toBe(countBefore);
  });

  test('Safety save rejects empty description/severity', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('safety'));
    await page.evaluate(() => openSafetyModal());

    const countBefore = await page.evaluate(() => _memDB.safety.length);
    await page.evaluate(() => saveSafety());
    const countAfter = await page.evaluate(() => _memDB.safety.length);
    expect(countAfter).toBe(countBefore);
  });

  test('Waste save rejects empty date/type/volume', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('waste'));
    await page.evaluate(() => openWasteModal());

    // Clear the auto-set date so validation fails
    await page.evaluate(() => {
      document.getElementById('m-w-date').value = '';
      document.getElementById('m-w-type').value = '';
      document.getElementById('m-w-vol').value = '';
    });

    const countBefore = await page.evaluate(() => _memDB.waste.length);
    await page.evaluate(() => saveWaste());
    const countAfter = await page.evaluate(() => _memDB.waste.length);
    expect(countAfter).toBe(countBefore);
  });

  test('Project save rejects empty code/title', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('projects'));
    await page.evaluate(() => openProjectModal());

    const countBefore = await page.evaluate(() => _memDB.projects.length);
    await page.evaluate(() => saveProject());
    const countAfter = await page.evaluate(() => _memDB.projects.length);
    expect(countAfter).toBe(countBefore);
  });

  test('Asset save rejects empty name/section', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('assets'));
    await page.evaluate(() => openAssetModal());

    const countBefore = await page.evaluate(() => _memDB.assets.length);
    await page.evaluate(() => saveAsset());
    const countAfter = await page.evaluate(() => _memDB.assets.length);
    expect(countAfter).toBe(countBefore);
  });
});

// ═══════════════════════════════════════════════════
// Cross-module: ID uniqueness and record integrity
// ═══════════════════════════════════════════════════

test.describe('Record integrity', () => {

  test('Created records have unique numeric IDs', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('workorders'));

    // Create two WOs
    await page.evaluate(() => {
      openWOModal();
      document.getElementById('m-wo-section').value = 'Electrical';
      document.getElementById('m-wo-desc').value = 'WO number one';
      document.getElementById('m-wo-priority').value = 'High';
      saveWO();
    });
    await page.evaluate(() => {
      openWOModal();
      document.getElementById('m-wo-section').value = 'Plumbing';
      document.getElementById('m-wo-desc').value = 'WO number two';
      document.getElementById('m-wo-priority').value = 'Low';
      saveWO();
    });

    const result = await page.evaluate(() => {
      const wos = _memDB.wo;
      return { count: wos.length, id0: wos[0].id, id1: wos[1].id };
    });
    expect(result.count).toBe(2);
    expect(result.id0).not.toBe(result.id1);
    expect(typeof result.id0).toBe('number');
    expect(typeof result.id1).toBe('number');
  });

  test('Edit does not duplicate records', async ({ page }) => {
    await bootstrapApp(page);

    // Seed one asset
    const assetId = await page.evaluate(() => {
      const id = DB.nid('assets');
      const assets = DB.g('assets');
      assets.push({ id, name: 'Test Pump', section: 'Plumbing', condition: 'Good', location: 'Room 100' });
      _memDB.assets = assets;
      return id;
    });

    await page.evaluate(() => navigate('assets'));
    await page.evaluate((id) => openAssetModal(id), assetId);
    await page.evaluate(() => {
      document.getElementById('m-a-condition').value = 'Fair';
      saveAsset();
    });

    const count = await page.evaluate(() => _memDB.assets.length);
    expect(count).toBe(1);
  });

  test('Delete of nonexistent record is safe (no crash)', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('workorders'));

    // Attempt delete with an ID that does not exist
    const result = await page.evaluate(async () => {
      try {
        await delWO(99999999);
        return { ok: true, count: _memDB.wo.length };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
  });
});
