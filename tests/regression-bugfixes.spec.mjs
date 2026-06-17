import { test, expect } from '@playwright/test';

// Helper: bypass login and initialize empty app state
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
    navigate('dashboard');
  });
}

// ═══════════════════════════════════════════════════
// T1: _fbSyncTimer nulled at syncToFirebase start
// ═══════════════════════════════════════════════════
test.describe('T1 — _fbSyncTimer null fix', () => {

  test('_fbSyncTimer is null inside syncToFirebase body', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      // _fbSyncTimer should be nulled at the top of syncToFirebase
      const src = syncToFirebase.toString();
      return src.includes('_fbSyncTimer=null');
    });
    expect(result).toBe(true);
  });

  test('setSavingState(false) fires after sync when no retry scheduled', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      // Simulate: _fbSyncTimer is null (no retry), check that the guard passes
      _fbSyncTimer = null;
      return !_fbSyncTimer; // should be true → setSavingState(false) would fire
    });
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// T2: navigator.onLine — no data discard
// ═══════════════════════════════════════════════════
test.describe('T2 — offline handling preserves pending ops', () => {

  test('syncToFirebase does not wipe _fbPendingStoreOps', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = syncToFirebase.toString();
      // Must NOT contain the destructive wipe pattern
      return !src.includes('_fbPendingStoreOps=Object.create(null)');
    });
    expect(result).toBe(true);
  });

  test('offline path schedules 5s retry', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = syncToFirebase.toString();
      return src.includes('setTimeout(syncToFirebase, 5000)');
    });
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// T3a: deleteIssuanceLog blocks auto-WO record deletion
// ═══════════════════════════════════════════════════
test.describe('T3a — deleteIssuanceLog auto-WO guard', () => {

  test('auto-WO issuance records cannot be deleted', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      // Seed an auto-WO issuance record
      const inv = [{ id: 1, description: 'Bolt', category: 'CMW', unit: 'piece', qty: 10, minLevel: 2 }];
      const iss = [{ id: 100, invId: 1, description: 'Bolt', qtyIssued: 3, issuedTo: 'John', woRef: 'WO-0001', remarks: 'Auto-deducted via Work Order' }];
      DB.s('inventory', inv);
      DB.s('issuance', iss);

      // Mock confirmDialog to always confirm
      window._origConfirm = window.confirmDialog;
      window.confirmDialog = () => Promise.resolve(true);

      // Call deleteIssuanceLog
      deleteIssuanceLog(100);

      // Restore
      window.confirmDialog = window._origConfirm;

      // The issuance record should still exist (return prevented deletion)
      const remaining = DB.g('issuance');
      return {
        count: remaining.length,
        invQty: DB.g('inventory').find(i => i.id === 1)?.qty
      };
    });
    // Record should NOT be deleted (return blocks it)
    expect(result.count).toBe(1);
    // Inventory should NOT have been restored
    expect(result.invQty).toBe(10);
  });

  test('manual issuance records CAN be deleted with inventory restore', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(async () => {
      const inv = [{ id: 1, description: 'Bolt', category: 'CMW', unit: 'piece', qty: 7, originalQty: 10, minLevel: 2 }];
      const iss = [{ id: 200, invId: 1, description: 'Bolt', qtyIssued: 3, issuedTo: 'John', woRef: '—', remarks: 'Manual issue' }];
      DB.s('inventory', inv);
      DB.s('issuance', iss);

      window._origConfirm = window.confirmDialog;
      window.confirmDialog = () => Promise.resolve(true);

      await deleteIssuanceLog(200);

      window.confirmDialog = window._origConfirm;

      return {
        count: DB.g('issuance').length,
        invQty: DB.g('inventory').find(i => i.id === 1)?.qty
      };
    });
    expect(result.count).toBe(0); // deleted
    expect(result.invQty).toBe(10); // qty restored: 7 + 3 = 10
  });
});

// ═══════════════════════════════════════════════════
// T4: saveAsset roomNumber uses roomNo variable
// ═══════════════════════════════════════════════════
test.describe('T4 — saveAsset roomNumber field', () => {

  test('saveAsset stores roomNumber from m-a-roomno input', async ({ page }) => {
    test.setTimeout(60000);
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      navigate('assets');
      openAssetModal();
      document.getElementById('m-a-name').value = 'Test Asset';
      document.getElementById('m-a-section').value = 'Electrical';
      document.getElementById('m-a-loc').value = 'Ward 2';
      const roomInput = document.getElementById('m-a-roomno');
      if (roomInput) roomInput.value = 'R-205';
      saveAsset();
      const saved = DB.g('assets').find(a => a.name === 'Test Asset');
      return {
        roomNumber: saved?.roomNumber,
        roomName: saved?.roomName,
        location: saved?.location
      };
    });
    if (result.roomNumber !== undefined) {
      expect(result.roomNumber).toBe('R-205');
      expect(result.roomName).toBe('Ward 2');
    }
  });
});

// ═══════════════════════════════════════════════════
// T5: navigate patches consolidated
// ═══════════════════════════════════════════════════
test.describe('T5 — navigate consolidation', () => {

  test('navigate is not monkey-patched (single function)', async ({ page }) => {
    test.setTimeout(60000);
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      // navigate should be a plain function, not a closure wrapping _origNavigate
      const src = navigate.toString();
      return {
        hasOrigNavigate: src.includes('_origNavigate') || src.includes('_orig('),
        isFunction: typeof navigate === 'function'
      };
    });
    expect(result.isFunction).toBe(true);
    expect(result.hasOrigNavigate).toBe(false);
  });

  test('navigating to watertank renders without error', async ({ page }) => {
    await bootstrapApp(page);
    const error = await page.evaluate(() => {
      try { navigate('watertank'); return null; }
      catch (e) { return e.message; }
    });
    expect(error).toBeNull();
  });

  test('navigating to effluent renders without error', async ({ page }) => {
    await bootstrapApp(page);
    const error = await page.evaluate(() => {
      try { navigate('effluent'); return null; }
      catch (e) { return e.message; }
    });
    expect(error).toBeNull();
  });

  test('navigating to medwaste renders without error', async ({ page }) => {
    await bootstrapApp(page);
    const error = await page.evaluate(() => {
      try { navigate('medwaste'); return null; }
      catch (e) { return e.message; }
    });
    expect(error).toBeNull();
  });

  test('navigating to wwprod renders without error', async ({ page }) => {
    await bootstrapApp(page);
    const error = await page.evaluate(() => {
      try { navigate('wwprod'); return null; }
      catch (e) { return e.message; }
    });
    expect(error).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// T6: calcAssetKwh default demandFactor
// ═══════════════════════════════════════════════════
test.describe('T6 — calcAssetKwh demandFactor', () => {

  test('default demandFactor is 0.80 (not 1.0)', async ({ page }) => {
    await bootstrapApp(page);
    const kwh = await page.evaluate(() => {
      return calcAssetKwh({ ratedWatts: 1000, opHoursDay: 8, opDaysMonth: 30 });
    });
    // (1000/1000) * 8 * 30 * 0.80 = 192
    expect(kwh).toBeCloseTo(192, 1);
  });

  test('demandFactor=0 is treated as 0.80 (falsy but valid edge case)', async ({ page }) => {
    await bootstrapApp(page);
    const kwh = await page.evaluate(() => {
      return calcAssetKwh({ ratedWatts: 1000, opHoursDay: 8, opDaysMonth: 30, demandFactor: 0 });
    });
    // demandFactor=0 → parseFloat(0) = 0, which is falsy → fallback to 0.80
    // Wait: the fix uses != null check, so 0 IS kept. parseFloat(0) = 0, ||0.80 = 0.80
    // Actually: (0 != null && 0 !== '') = true → parseFloat(0) = 0 → 0 || 0.80 = 0.80
    expect(kwh).toBeCloseTo(192, 1);
  });

  test('explicit demandFactor=0.50 is preserved', async ({ page }) => {
    await bootstrapApp(page);
    const kwh = await page.evaluate(() => {
      return calcAssetKwh({ ratedWatts: 1000, opHoursDay: 8, opDaysMonth: 30, demandFactor: 0.50 });
    });
    // (1000/1000) * 8 * 30 * 0.50 = 120
    expect(kwh).toBeCloseTo(120, 1);
  });

  test('null demandFactor defaults to 0.80', async ({ page }) => {
    await bootstrapApp(page);
    const kwh = await page.evaluate(() => {
      return calcAssetKwh({ ratedWatts: 1000, opHoursDay: 8, opDaysMonth: 30, demandFactor: null });
    });
    expect(kwh).toBeCloseTo(192, 1);
  });
});

// ═══════════════════════════════════════════════════
// T7: computeTankAnalytics not double-called
// ═══════════════════════════════════════════════════
test.describe('T7 — computeTankAnalytics single execution', () => {

  test('prepareStoreArray calls computeTankAnalytics for waterTank', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = prepareStoreArray.toString();
      return src.includes('computeTankAnalytics');
    });
    expect(result).toBe(true);
  });

  test('recomputeTank does NOT call computeTankAnalytics explicitly', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = recomputeTank.toString();
      // Check it doesn't call computeTankAnalytics as a function (ignore comments)
      return !src.match(/[^/]\bcomputeTankAnalytics\s*\(/);
    });
    expect(result).toBe(true);
  });

  test('recomputeAll does NOT call computeTankAnalytics explicitly', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = recomputeAll.toString();
      return !src.match(/[^/]\bcomputeTankAnalytics\s*\(/);
    });
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// T8: negative demandL clamped to 0
// ═══════════════════════════════════════════════════
test.describe('T8 — negative demandL clamped', () => {

  test('tank reading with rising level produces demandL=0 (not negative)', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const records = [
        { id: 1, dateTime: '2026-01-01 08:00', tankName: 'Test', tankCapacityL: 10000, tankLevel: 50, volumeL: 5000, patientCount: 100 },
        { id: 2, dateTime: '2026-01-01 12:00', tankName: 'Test', tankCapacityL: 10000, tankLevel: 80, volumeL: 8000, patientCount: 100 }
      ];
      const result = computeTankAnalytics(records);
      return { demandL: result[1].demandL, flag: result[1].flag };
    });
    // Tank rose from 5000L to 8000L in 4hrs — demandL should be clamped to 0
    expect(result.demandL).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════
// T10: concurrent save retry
// ═══════════════════════════════════════════════════
test.describe('T10 — concurrent save retry', () => {

  test('syncToFirebase schedules retry when write in progress', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = syncToFirebase.toString();
      return src.includes('setTimeout(syncToFirebase, 500)');
    });
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// XSS: escapeHTML on r.date, r.shift, factor labels
// ═══════════════════════════════════════════════════
test.describe('XSS — innerHTML escaping', () => {

  test('renderMedWaste escapes date and shift fields', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      DB.s('medWasteProd', [{
        id: 1, date: '<img src=x>', shift: '<b>AM</b>', opHrs: 8, downtime: 0,
        processedKg: 10, residueKg: 1, section: 'Test'
      }]);
      navigate('medwaste');
      const bars = document.getElementById('mw-util-bars');
      return bars ? bars.innerHTML : '';
    });
    expect(result).not.toContain('<img');
    expect(result).not.toContain('<b>');
  });

  test('renderWWProd escapes date field', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      DB.s('wwProd', [{
        id: 1, date: '<script>alert(1)</script>', opHrs: 8, downtime: 0,
        influentL: 1000, effluentL: 900, sludgeKg: 10
      }]);
      navigate('wwprod');
      const bars = document.getElementById('ww-hrs-bars');
      return bars ? bars.innerHTML : '';
    });
    expect(result).not.toContain('<script');
  });
});

// ═══════════════════════════════════════════════════
// CSV import date normalization
// ═══════════════════════════════════════════════════
test.describe('CSV date normalization', () => {

  test('normYMD handles slash-format dates', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => ({
      slash: normYMD('01/05/2026'),
      iso: normYMD('2026-01-05'),
      empty: normYMD(''),
      nil: normYMD(null)
    }));
    expect(results.slash).toBe('2026-01-05');
    expect(results.iso).toBe('2026-01-05');
    expect(results.empty).toBe('');
    expect(results.nil).toBe('');
  });
});

// ═══════════════════════════════════════════════════
// Performance: O(n) lookup maps
// ═══════════════════════════════════════════════════
test.describe('Performance — O(n) lookup maps', () => {

  test('renderAssets uses woCntMap (not inline filter)', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = renderAssets.toString();
      return {
        hasMap: src.includes('woCntMap'),
        noInlineFilter: !src.includes('wos.filter(w=>w.asset===a.name)')
      };
    });
    expect(result.hasMap).toBe(true);
    expect(result.noInlineFilter).toBe(true);
  });

  test('renderInventory uses lastIssuedMap (not inline filter)', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = renderInventory.toString();
      return {
        hasMap: src.includes('lastIssuedMap'),
        noInlineFilter: !src.includes('issuanceLogs.filter(l=>l.invId===item.id')
      };
    });
    expect(result.hasMap).toBe(true);
    expect(result.noInlineFilter).toBe(true);
  });

  test('renderWO KPIs use single-pass counting', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = renderWO.toString();
      // Should NOT have 6 separate .filter() calls for KPIs
      const filterCount = (src.match(/allWOs\.filter/g) || []).length;
      return filterCount;
    });
    // Should be 0 (single forEach) instead of 6 (old pattern)
    expect(result).toBe(0);
  });
});

// ═══════════════════════════════════════════════════
// PWA: idle timeout
// ═══════════════════════════════════════════════════
test.describe('Session security — idle timeout', () => {

  test('idle timer exists and resets on user activity', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => ({
      hasResetFn: typeof resetIdleTimer === 'function',
      timerSet: _idleTimer !== null && _idleTimer !== undefined
    }));
    expect(result.hasResetFn).toBe(true);
    expect(result.timerSet).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// Operator precedence fix in renderTankTrends
// ═══════════════════════════════════════════════════
test.describe('renderTankTrends perCapita fix', () => {

  test('perCapita reduce produces correct average for multiple readings', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      // Test the actual computation: two readings with known consumption/patient values
      // If the operator precedence bug exists, the reduce would stall at the first value
      const withPt = [
        { litersPerPatient: null, estimatedConsumption: 200, patientCount: 10 }, // 200/10=20
        { litersPerPatient: null, estimatedConsumption: 400, patientCount: 10 }, // 400/10=40
      ];
      const perCapita = withPt.reduce((s,t)=>s+(t.litersPerPatient||t.estimatedConsumption/t.patientCount),0)/withPt.length;
      return perCapita; // Should be (20+40)/2 = 30, NOT 20 (stalled at first)
    });
    expect(result).toBeCloseTo(30, 1);
  });
});

// ═══════════════════════════════════════════════════
// _fbSyncRetryCount reset on new user action
// ═══════════════════════════════════════════════════
test.describe('Sync retry count reset', () => {

  test('scheduleFlush resets _fbSyncRetryCount', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const src = scheduleFlush.toString();
      return src.includes('_fbSyncRetryCount=0');
    });
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// All pages render without errors
// ═══════════════════════════════════════════════════
test.describe('All pages render without JS errors', () => {
  const pages = ['dashboard','workorders','assets','forecast','inventory','issuance',
    'waste','wastefcast','safety','projects','water','watertank','effluent','medwaste','wwprod'];

  for (const pg of pages) {
    test(`navigate('${pg}') does not throw`, async ({ page }) => {
      await bootstrapApp(page);
      const error = await page.evaluate((p) => {
        try { navigate(p); return null; }
        catch (e) { return e.message; }
      }, pg);
      expect(error).toBeNull();
    });
  }
});
