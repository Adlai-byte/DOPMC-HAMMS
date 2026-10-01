import { test, expect } from '@playwright/test';

// Bootstrap helper — mirrors the existing 6 specs but adds 2 seeded assets
// so calcAssetKwh() returns a non-zero theoretical baseline.
async function bootstrapApp(page) {
  await page.goto('/?nocache=' + Date.now());
  await page.evaluate(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(r => r.forEach(w => w.unregister()));
    caches.keys().then(k => k.forEach(n => caches.delete(n)));
  });
  await page.goto('/?nocache=' + Date.now());
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    const loginOverlay = document.getElementById('hamms-login-overlay');
    if (loginOverlay) loginOverlay.style.cssText = 'display:none !important';
    const app = document.getElementById('app');
    if (app) app.style.visibility = 'visible';
    if (typeof _memDB === 'undefined') window._memDB = {};
    const stores = ['wo','assets','inventory','issuance','waste','waterLogs','waterTank','effluent','safety','projects','medWasteProd','wwProd','censusLog','waterSettings','energyBills'];
    stores.forEach(s => { if (!_memDB[s]) _memDB[s] = []; });
    if (!_memDB.personnel) _memDB.personnel = {};
    if (!window._FB) window._FB = { enabled: false, db: null };
    else { window._FB.enabled = false; window._FB.db = null; }
    window.confirmDialog = async () => true;
    // Seed three assets so the theoretical baseline is non-zero and deterministic.
    // 1000W × 8h × 30d × 0.8 df = 192 kWh each; 2000W × 8h × 30d × 0.8 df = 384 kWh.
    _memDB.assets = [
      { id: 9001, name: 'Test AC 1', section: 'HVAC', mainCategory: 'Aircon/Refrigeration', ratedWatts: 1000, opHoursDay: 8, opDaysMonth: 30, demandFactor: 0.8, qty: 1, condition: 'Good' },
      { id: 9002, name: 'Test AC 2', section: 'HVAC', mainCategory: 'Aircon/Refrigeration', ratedWatts: 1000, opHoursDay: 8, opDaysMonth: 30, demandFactor: 0.8, qty: 1, condition: 'Good' },
      { id: 9003, name: 'Test X-ray', section: 'Radiology', mainCategory: 'Biomedical', ratedWatts: 2000, opHoursDay: 8, opDaysMonth: 30, demandFactor: 0.8, qty: 1, condition: 'Good' }
    ];
    // Note: navigate('dashboard') removed - tests navigate themselves
  });
}

async function gotoEnergy(page) {
  await page.evaluate(() => navigate('energy'));
  // Verify the page became active (don't rely on visibility — the page's parent
  // is sometimes marked display:none while we wait).
  await page.waitForFunction(() => document.getElementById('page-energy')?.classList.contains('active'), { timeout: 5000 });
}

// ═══════════════════════════════════════
// Module 1 — Theoretical baseline
// ═══════════════════════════════════════
test.describe('Energy — Theoretical baseline', () => {

  test('calcCurrentTheoreticalKwh sums calcAssetKwh across the asset registry', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => ({
      total: (typeof calcCurrentTheoreticalKwh === 'function') ? calcCurrentTheoreticalKwh() : null,
      perAsset: (typeof calcAssetKwh === 'function') ? calcAssetKwh(_memDB.assets[0]) : null
    }));
    expect(result.perAsset).toBeCloseTo(192, 1);
    expect(result.total).toBeCloseTo(768, 1);
  });

  test('theoretical snapshot is captured at save time and does not change when assets are added later', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '500';
      document.getElementById('m-en-amount').value = '3000';
      saveEnergy();
    });
    const before = await page.evaluate(() => _memDB.energyBills[0].theoreticalKwh);
    expect(before).toBeCloseTo(768, 1);
    // Add a fourth asset and verify the existing bill's snapshot is unchanged.
    await page.evaluate(() => {
      _memDB.assets.push({ id: 9004, name: 'Late Asset', section: 'HVAC', mainCategory: 'Aircon/Refrigeration', ratedWatts: 5000, opHoursDay: 12, opDaysMonth: 30, demandFactor: 0.8, qty: 1, condition: 'Good' });
    });
    const after = await page.evaluate(() => _memDB.energyBills[0].theoreticalKwh);
    expect(after).toBeCloseTo(768, 1);
  });
});

// ═══════════════════════════════════════
// Module 2 — CRUD
// ═══════════════════════════════════════
test.describe('Energy — CRUD', () => {

  test('Add a bill', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '42500';
      document.getElementById('m-en-amount').value = '285000';
      document.getElementById('m-en-demand').value = '292.10';
      document.getElementById('m-en-account').value = '01-150-0004075';
      document.getElementById('m-en-meter').value = '09955797';
      document.getElementById('m-en-remarks').value = 'May 2026 DORECO';
      saveEnergy();
    });
    const bill = await page.evaluate(() => _memDB.energyBills[0]);
    expect(bill).toBeTruthy();
    expect(bill.period).toBe('2026-05');
    expect(bill.periodLabel).toBe('May 2026');
    expect(bill.actualKwh).toBe(42500);
    expect(bill.billAmount).toBe(285000);
    expect(bill.demandKw).toBeCloseTo(292.10, 2);
    expect(bill.accountNo).toBe('01-150-0004075');
    expect(bill.meterNo).toBe('09955797');
    expect(bill.theoreticalKwh).toBeCloseTo(768, 1);
  });

  test('Duplicate period is rejected', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '42500';
      document.getElementById('m-en-amount').value = '285000';
      saveEnergy();
      // Try to save another bill for the same period
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '43000';
      document.getElementById('m-en-amount').value = '290000';
      saveEnergy();
    });
    const count = await page.evaluate(() => _memDB.energyBills.length);
    expect(count).toBe(1);
  });

  test('Edit a bill', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '42500';
      document.getElementById('m-en-amount').value = '285000';
      saveEnergy();
      const id = _memDB.energyBills[0].id;
      openEnergyModal(id);
      document.getElementById('m-en-actual').value = '99999';
      saveEnergy();
    });
    const bill = await page.evaluate(() => _memDB.energyBills[0]);
    expect(bill.actualKwh).toBe(99999);
  });

  test('Delete a bill', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '42500';
      document.getElementById('m-en-amount').value = '285000';
      saveEnergy();
      const id = _memDB.energyBills[0].id;
      delEnergyBill(id);
    });
    const count = await page.evaluate(() => _memDB.energyBills.length);
    expect(count).toBe(0);
  });

  test('Validation rejects blank actual/amount', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '';
      document.getElementById('m-en-amount').value = '';
      saveEnergy();
      return {
        count: _memDB.energyBills.length,
        hasFieldError: !!document.querySelector('#m-en-actual[aria-invalid="true"]')
      };
    });
    expect(result.count).toBe(0);
    expect(result.hasFieldError).toBe(true);
  });
});

// ═══════════════════════════════════════
// Module 3 — Variance computation
// ═══════════════════════════════════════
test.describe('Energy — Variance math', () => {

  test('Over-consumption renders with .var-over class', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '100000';
      document.getElementById('m-en-amount').value = '700000';
      saveEnergy();
    });
    await gotoEnergy(page);
    const html = await page.evaluate(() => document.getElementById('energy-tbody').innerHTML);
    expect(html).toContain('var-over');
    expect(html).toContain('+99');
  });

  test('Under-consumption renders with .var-under class', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '100';
      document.getElementById('m-en-amount').value = '800';
      saveEnergy();
    });
    await gotoEnergy(page);
    const html = await page.evaluate(() => document.getElementById('energy-tbody').innerHTML);
    expect(html).toContain('var-under');
  });


});

// ═══════════════════════════════════════
// Module 4 — Reports
// ═══════════════════════════════════════
test.describe('Energy — Reports & Charts', () => {

  test('Trend chart renders on the page', async ({ page }) => {
    await bootstrapApp(page);
    await gotoEnergy(page);
    const hasCanvas = await page.evaluate(() => {
      const el = document.getElementById('en-trend-chart');
      if (!el) return false;
      // drawBarLineChart produces an <svg> child
      return el.querySelector('svg') !== null || el.children.length > 0;
    });
    expect(hasCanvas).toBe(true);
  });

  test('Actual consumption chart renders on the page', async ({ page }) => {
    await bootstrapApp(page);
    await gotoEnergy(page);
    const hasCanvas = await page.evaluate(() => {
      const el = document.getElementById('en-actual-chart');
      if (!el) return false;
      // drawBarLineChart produces an <svg> child
      return el.querySelector('svg') !== null || el.children.length > 0;
    });
    expect(hasCanvas).toBe(true);
  });

  test('Theoretical load by category chart renders on the page', async ({ page }) => {
    await bootstrapApp(page);
    await gotoEnergy(page);
    const hasCanvas = await page.evaluate(() => {
      const el = document.getElementById('en-category-chart');
      if (!el) return false;
      // drawEnergyCategoryBarChart produces an <svg> child
      return el.querySelector('svg') !== null || el.children.length > 0;
    });
    expect(hasCanvas).toBe(true);
  });

  test('Biomedical assets appear as a category in the load chart', async ({ page }) => {
    await bootstrapApp(page);
    await gotoEnergy(page);
    const hasBiomedical = await page.evaluate(() => {
      const svg = document.querySelector('#en-category-chart svg');
      if (!svg) return false;
      const labels = Array.from(svg.querySelectorAll('text')).map(t => t.textContent.trim());
      return labels.includes('Biomedical');
    });
    expect(hasBiomedical).toBe(true);
  });

  test('0 kWh categories are listed below the load chart', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      _memDB.assets = [
        { id: 9004, name: 'Zero-load Biomed', section: 'Biomedical', mainCategory: 'Biomedical', ratedWatts: 0, opHoursDay: 0, opDaysMonth: 0, demandFactor: 0.8, qty: 1, condition: 'Good' }
      ];
    });
    await gotoEnergy(page);
    const showsNote = await page.evaluate(() => {
      const container = document.getElementById('en-category-chart');
      if (!container) return false;
      return container.innerHTML.includes('0 kWh categories') && container.innerHTML.includes('Biomedical');
    });
    expect(showsNote).toBe(true);
  });

  test('Monthly DORECO bill chart renders with month labels', async ({ page }) => {
    await bootstrapApp(page);
    await gotoEnergy(page);
    await page.evaluate(() => {
      const list = DB.g('energyBills');
      const base = Math.round(calcCurrentTheoreticalKwh() * 100) / 100;
      const bills = [
        { id: DB.nid('energyBills'), period: '2026-01', theoreticalKwh: base, actualKwh: 42500, billAmount: 285000, demandKw: 292.10 },
        { id: DB.nid('energyBills'), period: '2026-02', theoreticalKwh: base, actualKwh: 39800, billAmount: 265500, demandKw: 285.75 },
        { id: DB.nid('energyBills'), period: '2026-03', theoreticalKwh: base, actualKwh: 45200, billAmount: 298000, demandKw: 279.40 }
      ];
      bills.forEach(b => list.push(b));
    });
    await page.evaluate(() => renderEnergy());
    const result = await page.evaluate(() => {
      const el = document.getElementById('en-bill-chart');
      if (!el) return { present: false };
      const svg = el.querySelector('svg');
      const textElements = Array.from(svg?.querySelectorAll('text') || []);
      const hasJan = textElements.some(t => t.textContent.includes('Jan'));
      const hasFeb = textElements.some(t => t.textContent.includes('Feb'));
      const hasMar = textElements.some(t => t.textContent.includes('Mar'));
      return { present: true, hasSvg: svg !== null, hasJan, hasFeb, hasMar };
    });
    expect(result.present).toBe(true);
    expect(result.hasSvg).toBe(true);
    expect(result.hasJan).toBe(true);
    expect(result.hasFeb).toBe(true);
    expect(result.hasMar).toBe(true);
  });

  test('Annual summary aggregates per year', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      ['2026-01','2026-02','2025-12'].forEach((p,i) => {
        openEnergyModal();
        document.getElementById('m-en-month').value = p.substring(5,7);
        document.getElementById('m-en-year').value = p.substring(0,4);
        document.getElementById('m-en-actual').value = String(1000 * (i+1));
        document.getElementById('m-en-amount').value = String(5000 * (i+1));
        saveEnergy();
      });
    });
    await gotoEnergy(page);
    const html = await page.evaluate(() => document.getElementById('energy-annual-tbody').innerHTML);
    // Two years aggregated: 2026 has 2 bills, 2025 has 1
    expect(html).toContain('2026');
    expect(html).toContain('2025');
  });

  test('KPI cards display aggregate values', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      openEnergyModal();
      document.getElementById('m-en-month').value = '05';
      document.getElementById('m-en-year').value = '2026';
      document.getElementById('m-en-actual').value = '500';
      document.getElementById('m-en-amount').value = '3000';
      saveEnergy();
    });
    await gotoEnergy(page);
    const html = await page.evaluate(() => document.getElementById('en-stat-row').innerHTML);
    expect(html).toContain('Σ Theoretical');
    expect(html).toContain('Σ Actual');
    expect(html).toContain('Σ Variance');
    expect(html).toContain('Σ Bill Amount');
    expect(html).toContain('500');
    expect(html).toContain('3,000');
  });

  test('Empty state shows helpful message', async ({ page }) => {
    await bootstrapApp(page);
    await gotoEnergy(page);
    const html = await page.evaluate(() => document.getElementById('energy-tbody').innerHTML);
    expect(html).toContain('No bills found');
    expect(html).toContain('+ Add Bill');
  });
});

// ═══════════════════════════════════════
// Module 5 — CSV export / import
// ═══════════════════════════════════════
test.describe('Energy — CSV', () => {

  test('downloadEnergyTemplate returns a CSV with the required header', async ({ page }) => {
    await bootstrapApp(page);
    const text = await page.evaluate(async () => {
      // Intercept the download by:
      //  1) preventing anchor.click() (so no actual download)
      //  2) killing the 100ms setTimeout that revokes the blob URL
      //  3) capturing the blob URL
      //  4) reading the blob text via fetch before the test ends
      const origClick = HTMLAnchorElement.prototype.click;
      const origSetTimeout = window.setTimeout;
      let captured = '';
      HTMLAnchorElement.prototype.click = function () { captured = this.href || ''; };
      window.setTimeout = function (fn, ms) {
        // Skip the URL.revokeObjectURL call; allow other timers to run
        if (typeof fn === 'function' && ms === 100) return 0;
        return origSetTimeout(fn, ms);
      };
      try {
        downloadEnergyTemplate();
      } finally {
        HTMLAnchorElement.prototype.click = origClick;
        window.setTimeout = origSetTimeout;
      }
      if (captured.startsWith('blob:')) {
        const resp = await fetch(captured);
        return await resp.text();
      }
      return captured;
    });
    expect(text).toContain('Period_YYYY-MM');
    expect(text).toContain('Actual_kWh');
    expect(text).toContain('Bill_PHP');
    expect(text).toContain('Demand_kW');
    expect(text).toContain('Account_No');
    expect(text).toContain('Meter_No');
    expect(text).toContain('2026-01');
  });

  test('importEnergyCSV adds a bill from a CSV row with all fields', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      const csv = [
        'Period_YYYY-MM,Actual_kWh,Bill_PHP,Theoretical_kWh,Demand_kW,Account_No,Meter_No,Remarks',
        '2026-07,1500,9000,400,285.50,01-150-0004075,09955797,July test'
      ].join('\n');
      const f = new File([csv], 'energy.csv', { type: 'text/csv' });
      const ev = { target: { files: [f], value: '' } };
      importEnergyCSV(ev);
    });
    // FileReader is async — wait for the onload handler to fire
    await page.waitForTimeout(200);
    const bill = await page.evaluate(() => _memDB.energyBills[0]);
    expect(bill).toBeTruthy();
    expect(bill.period).toBe('2026-07');
    expect(bill.actualKwh).toBe(1500);
    expect(bill.billAmount).toBe(9000);
    expect(bill.theoreticalKwh).toBe(400);
    expect(bill.demandKw).toBeCloseTo(285.50, 2);
    expect(bill.accountNo).toBe('01-150-0004075');
    expect(bill.meterNo).toBe('09955797');
    expect(bill.remarks).toBe('July test');
  });

  test('importEnergyCSV preserves optional fields when columns are absent', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      // Seed an existing bill with optional fields populated.
      _memDB.energyBills = [{
        id: 1,
        period: '2026-07',
        periodLabel: 'July 2026',
        actualKwh: 1500,
        billAmount: 9000,
        demandKw: 285.50,
        accountNo: '01-150-0004075',
        meterNo: '09955797',
        theoreticalKwh: 400,
        remarks: 'Keep me'
      }];
      // Import a minimal CSV for the same period without optional columns.
      const csv = 'Period_YYYY-MM,Actual_kWh,Bill_PHP\n2026-07,1600,9500';
      const f = new File([csv], 'energy.csv', { type: 'text/csv' });
      const ev = { target: { files: [f], value: '' } };
      importEnergyCSV(ev);
    });
    await page.waitForTimeout(200);
    const bill = await page.evaluate(() => _memDB.energyBills[0]);
    expect(bill.actualKwh).toBe(1600);
    expect(bill.billAmount).toBe(9500);
    expect(bill.demandKw).toBeCloseTo(285.50, 2);
    expect(bill.accountNo).toBe('01-150-0004075');
    expect(bill.meterNo).toBe('09955797');
    expect(bill.remarks).toBe('Keep me');
  });
});

// ═══════════════════════════════════════
// Module 6 — Navigation wiring
// ═══════════════════════════════════════
test.describe('Energy — Navigation', () => {

  test('Sidebar has an Energy Conservation item that navigates correctly', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('energy'));
    const active = await page.evaluate(() => ({
      page: !!document.querySelector('#page-energy.active'),
      title: document.getElementById('page-title').textContent
    }));
    expect(active.page).toBe(true);
    expect(active.title).toBe('Energy Conservation');
  });

  test('Dispatch entry exists in navigate()', async ({ page }) => {
    await bootstrapApp(page);
    const hasDispatch = await page.evaluate(() => {
      const src = navigate.toString();
      return src.includes("energy:") && src.includes("renderEnergy");
    });
    expect(hasDispatch).toBe(true);
  });

  test('PAGE_TITLES includes energy', async ({ page }) => {
    await bootstrapApp(page);
    const title = await page.evaluate(() => PAGE_TITLES.energy);
    expect(title).toBe('Energy Conservation');
  });

  test('STORES includes energyBills', async ({ page }) => {
    await bootstrapApp(page);
    const has = await page.evaluate(() => STORES.includes('energyBills'));
    expect(has).toBe(true);
  });
});

// ═══════════════════════════════════════
// Module 6 — Layout / scrolling regression
// ═══════════════════════════════════════
test.describe('Energy — Layout', () => {

  test('Footer stays fixed when Energy page content is scrolled to bottom', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await bootstrapApp(page);

    // Seed enough bills to make the Energy page taller than the viewport.
    await page.evaluate(() => {
      for (let i = 0; i < 36; i++) {
        const m = String((i % 12) + 1).padStart(2, '0');
        const y = 2024 + Math.floor(i / 12);
        _memDB.energyBills.push({
          id: 1000 + i, _docId: 'eb' + i, period: `${y}-${m}`,
          periodLabel: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i % 12]} ${y}`,
          actualKwh: 40000 + i * 1000, theoreticalKwh: 768, billAmount: 250000 + i * 5000,
          demandKw: 250 + i * 5, remarks: 'Test', accountNo: '01', meterNo: '02'
        });
      }
      navigate('energy');
    });
    await page.waitForFunction(() => document.getElementById('page-energy')?.classList.contains('active'), { timeout: 5000 });
    await page.waitForTimeout(300);

    const content = page.locator('#content');
    await content.evaluate(el => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(300);

    const metrics = await page.evaluate(() => ({
      windowScrollY: window.scrollY,
      contentScrollTop: document.getElementById('content').scrollTop,
      contentClientHeight: document.getElementById('content').clientHeight,
      footerBottom: document.getElementById('app-footer').getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight
    }));

    expect(metrics.windowScrollY).toBe(0);
    expect(metrics.contentScrollTop).toBeGreaterThan(0);
    expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.footerBottom).toBeGreaterThanOrEqual(metrics.viewportHeight - 1);
    expect(metrics.contentClientHeight).toBeGreaterThan(300);
  });
});
