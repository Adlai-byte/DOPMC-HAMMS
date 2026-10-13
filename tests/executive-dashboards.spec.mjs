import { test, expect } from '@playwright/test';

// Bootstrap helper matching the project convention
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
    if (typeof _fbPendingStoreOps !== 'undefined') {
      Object.keys(_fbPendingStoreOps).forEach(k => delete _fbPendingStoreOps[k]);
    }
    if (!window._FB) window._FB = { enabled: false, db: null };
    else { window._FB.enabled = false; window._FB.db = null; }
    window.confirmDialog = async () => true;
    navigate('dashboard');
  });
}

// ═══════════════════════════════════════════════════
// Phase 1: Asset History Matching & Clean WO Codes
// ═══════════════════════════════════════════════════
test.describe('Phase 1: Asset History & WO Code Formats', () => {

  test('cleanModuleCode strips random hex suffixes like -XXXXXXXX', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => ({
      woHex: cleanModuleCode('WO-2026-0001-A1B2C3D4'),
      elecHex: cleanModuleCode('ELEC-HI-0011-F9E8D7C6'),
      cleanStandard: cleanModuleCode('SF-2026-0005'),
      empty: cleanModuleCode('')
    }));
    expect(results.woHex).toBe('WO-2026-0001');
    expect(results.elecHex).toBe('ELEC-HI-0011');
    expect(results.cleanStandard).toBe('SF-2026-0005');
    expect(results.empty).toBe('');
  });

  test('viewHistory resolves WO logged with slight naming differences (Flourescent Tube 18 Watts vs FLOURESCENT TUBE 18W)', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      // Seed Asset
      _memDB.assets = [{
        id: 501,
        code: 'AST-ELEC-501',
        name: 'FLOURESCENT TUBE 18W',
        location: 'RAMP',
        section: 'Electrical'
      }];
      // Seed Work Order with variant spelling and random hex code
      _memDB.wo = [{
        id: 701,
        code: 'ELEC-HI-0011-3A2B1C4D',
        asset: 'Flourescent Tube 18 Watts',
        assetId: 501,
        location: 'RAMP',
        section: 'Electrical',
        description: 'Replaced electronic ballast and starter',
        priority: 'Normal',
        status: 'Completed',
        dateStart: '2026-03-01',
        targetCompletionDate: '2026-03-02',
        dateEnd: '2026-03-02',
        assigned: 'Rey'
      }];
      navigate('assets');
    });

    // Call viewHistory with the asset's name
    await page.evaluate(() => viewHistory('FLOURESCENT TUBE 18W'));

    // Check modal opened and work order row rendered with clean code
    const result = await page.evaluate(() => {
      const modal = document.getElementById('mo-history');
      const title = document.getElementById('mo-history-title')?.textContent || '';
      const tbody = document.getElementById('history-tbody')?.innerHTML || '';
      return {
        isOpen: modal?.classList.contains('open'),
        title,
        tbody
      };
    });

    expect(result.isOpen).toBe(true);
    expect(result.title).toContain('FLOURESCENT TUBE 18W');
    expect(result.tbody).toContain('ELEC-HI-0011');
    expect(result.tbody).not.toContain('3A2B1C4D'); // random hex stripped
    expect(result.tbody).toContain('Replaced electronic ballast and starter');
  });
});

// ═══════════════════════════════════════════════════
// Phase 2: Safety Management Executive Dashboard
// ═══════════════════════════════════════════════════
test.describe('Phase 2: Safety Management Executive Dashboard', () => {

  test('Safety Dashboard renders 6 KPI header cards with MoM trends & resolution metrics', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      const now = new Date();
      const thisMonth = now.toISOString().slice(0, 7);
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonth = prevDate.toISOString().slice(0, 7);

      _memDB.safety = [
        { id: 1, code: 'SF-001', date: thisMonth + '-05', severity: 'High', status: 'Closed', location: 'Emergency Room', targetDate: thisMonth + '-10', dateClosed: thisMonth + '-08', incidentType: 'Spill' },
        { id: 2, code: 'SF-002', date: thisMonth + '-12', severity: 'Critical', status: 'In Progress', location: 'Operating Room', targetDate: thisMonth + '-20', incidentType: 'Needlestick' },
        { id: 3, code: 'SF-003', date: thisMonth + '-15', severity: 'Low', status: 'Closed', location: 'Ward 1', targetDate: thisMonth + '-18', dateClosed: thisMonth + '-16', incidentType: 'Fall' },
        { id: 4, code: 'SF-004', date: prevMonth + '-10', severity: 'Medium', status: 'Closed', location: 'Laboratory', targetDate: prevMonth + '-15', dateClosed: prevMonth + '-14', incidentType: 'Electrical' }
      ];
      navigate('safety');
    });

    await page.waitForFunction(() => document.getElementById('page-safety')?.classList.contains('active'), { timeout: 5000 });

    const kpis = await page.evaluate(() => {
      const row = document.getElementById('safety-stat-row');
      if (!row) return { present: false };
      const text = row.textContent || '';
      const cards = row.querySelectorAll('.stat-card');
      return {
        present: true,
        cardCount: cards.length,
        hasTotal: text.includes('Total Issues Logged'),
        hasActiveCritHigh: text.includes('Active Critical / High'),
        hasOverdue: text.includes('Overdue Actions'),
        hasClosureRate: text.includes('Issue Closure Rate'),
        hasAvgRes: text.includes('Avg. Resolution Time'),
        hasRiskArea: text.includes('Highest-Risk Area')
      };
    });

    expect(kpis.present).toBe(true);
    expect(kpis.cardCount).toBe(6);
    expect(kpis.hasTotal).toBe(true);
    expect(kpis.hasActiveCritHigh).toBe(true);
    expect(kpis.hasOverdue).toBe(true);
    expect(kpis.hasClosureRate).toBe(true);
    expect(kpis.hasAvgRes).toBe(true);
    expect(kpis.hasRiskArea).toBe(true);
  });

  test('Safety Dashboard renders 5 SVG analytics charts and location/asset toggle', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      const now = new Date();
      const thisMonth = now.toISOString().slice(0, 7);
      _memDB.safety = [
        { id: 1, code: 'SF-001', date: thisMonth + '-05', severity: 'Critical', status: 'Open', location: 'Emergency Room', asset: 'Suction Machine', incidentType: 'Equipment Malfunction' },
        { id: 2, code: 'SF-002', date: thisMonth + '-08', severity: 'High', status: 'Closed', location: 'Emergency Room', asset: 'Defibrillator', incidentType: 'Biohazard' },
        { id: 3, code: 'SF-003', date: thisMonth + '-10', severity: 'Medium', status: 'In Progress', location: 'Ward 2', asset: 'Patient Bed', incidentType: 'Fall' }
      ];
      navigate('safety');
    });

    await page.waitForFunction(() => document.getElementById('page-safety')?.classList.contains('active'), { timeout: 5000 });

    const charts = await page.evaluate(() => {
      const donut = document.querySelector('#safety-status-donut svg');
      const sevBars = document.getElementById('safety-summary-bars');
      const trend = document.querySelector('#safety-chart svg');
      const topLocAsset = document.getElementById('safety-group-bars');
      const aging = document.getElementById('safety-aging-bars');
      return {
        hasDonut: donut !== null,
        hasSev: (sevBars?.children?.length || 0) > 0,
        hasTrend: trend !== null,
        hasTop: (topLocAsset?.children?.length || 0) > 0,
        hasAging: (aging?.children?.length || 0) > 0
      };
    });

    expect(charts.hasDonut).toBe(true);
    expect(charts.hasSev).toBe(true);
    expect(charts.hasTrend).toBe(true);
    expect(charts.hasTop).toBe(true);
    expect(charts.hasAging).toBe(true);

    // Test Top Location vs Asset toggle
    await page.evaluate(() => toggleSafetyGroup('asset'));
    const assetTitle = await page.evaluate(() => document.getElementById('sf-group-title')?.textContent);
    expect(assetTitle).toContain('Asset');

    await page.evaluate(() => toggleSafetyGroup('loc'));
    const locTitle = await page.evaluate(() => document.getElementById('sf-group-title')?.textContent);
    expect(locTitle).toContain('Location');
  });
});

// ═══════════════════════════════════════════════════
// Phase 3: Project Monitoring 2-Tier Dashboard
// ═══════════════════════════════════════════════════
test.describe('Phase 3: Project Monitoring 2-Tier Dashboard', () => {

  test('Project Monitoring renders Tier 1 Status and Tier 2 Execution Performance KPIs', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      const now = new Date();
      const in10Days = new Date(now.getTime() + 10 * 86400000).toISOString().slice(0, 10);
      const pastDate = new Date(now.getTime() - 20 * 86400000).toISOString().slice(0, 10);

      _memDB.projects = [
        { id: 1, code: 'PRJ-001', title: 'OR Expansion', status: 'Completed', budget: 1500000, physicalPct: 100, financialPct: 95, targetDate: pastDate, actualDate: pastDate, category: 'Infrastructure' },
        { id: 2, code: 'PRJ-002', title: 'Solar PV Phase 1', status: 'Ongoing', budget: 2000000, physicalPct: 75, financialPct: 60, targetDate: in10Days, category: 'Energy' },
        { id: 3, code: 'PRJ-003', title: 'CT Scan Suite', status: 'Delayed', budget: 800000, physicalPct: 30, financialPct: 40, targetDate: pastDate, category: 'Biomedical' },
        { id: 4, code: 'PRJ-004', title: 'Dietary Renovation', status: 'Proposed', budget: 500000, physicalPct: 0, financialPct: 0, category: 'Infrastructure' }
      ];
      navigate('projects');
    });

    await page.waitForFunction(() => document.getElementById('page-projects')?.classList.contains('active'), { timeout: 5000 });

    const stats = await page.evaluate(() => {
      const t1 = document.getElementById('proj-stat-tier1');
      const t2 = document.getElementById('proj-stat-tier2');
      const t1Cards = t1?.querySelectorAll('.stat-card') || [];
      const t2Cards = t2?.querySelectorAll('.stat-card') || [];
      const t2Text = t2?.textContent || '';
      return {
        t1Count: t1Cards.length,
        t2Count: t2Cards.length,
        hasPhysical: t2Text.includes('Physical Progress'),
        hasFinancial: t2Text.includes('Financial Utilization'),
        hasOnTime: t2Text.includes('On-Time Completion'),
        hasBudgetRisk: t2Text.includes('Budget at Risk'),
        hasOverdue: t2Text.includes('Overdue Projects'),
        hasDue30: t2Text.includes('Due in Next 30 Days'),
        containsRiskAmount: t2Text.includes('800,000') // 800k budget at risk for Delayed project
      };
    });

    expect(stats.t1Count).toBe(5);
    expect(stats.t2Count).toBe(6);
    expect(stats.hasPhysical).toBe(true);
    expect(stats.hasFinancial).toBe(true);
    expect(stats.hasOnTime).toBe(true);
    expect(stats.hasBudgetRisk).toBe(true);
    expect(stats.hasOverdue).toBe(true);
    expect(stats.hasDue30).toBe(true);
    expect(stats.containsRiskAmount).toBe(true);
  });

  test('Project Monitoring renders 4 visual analytics charts', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      _memDB.projects = [
        { id: 1, code: 'PRJ-001', title: 'Project 1', status: 'Ongoing', budget: 500000, physicalPct: 50, financialPct: 50, category: 'Infrastructure' },
        { id: 2, code: 'PRJ-002', title: 'Project 2', status: 'Completed', budget: 300000, physicalPct: 100, financialPct: 100, category: 'Biomedical' }
      ];
      navigate('projects');
    });

    await page.waitForFunction(() => document.getElementById('page-projects')?.classList.contains('active'), { timeout: 5000 });

    const charts = await page.evaluate(() => ({
      hasDonut: document.querySelector('#proj-status-donut svg') !== null,
      hasSCurve: document.querySelector('#proj-scurve-chart svg') !== null,
      hasBudgetCat: (document.getElementById('proj-budget-cat-chart')?.children?.length || 0) > 0,
      hasForecast: document.querySelector('#proj-forecast-chart svg') !== null
    }));

    expect(charts.hasDonut).toBe(true);
    expect(charts.hasSCurve).toBe(true);
    expect(charts.hasBudgetCat).toBe(true);
    expect(charts.hasForecast).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// Phase 4: Energy Conservation & DOE Carbon Footprint
// ═══════════════════════════════════════════════════
test.describe('Phase 4: Energy Conservation & DOE Carbon Footprint', () => {

  test('Calculates Carbon Footprint, Intensity, and Avoided CO2e matching DOE Standards', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      // 1 powered asset: 2000W × 8h × 30d × 0.8 df = 384 kWh
      _memDB.assets = [
        { id: 1, name: 'Main Autoclave', section: 'CSSD', mainCategory: 'Biomedical', ratedWatts: 2000, opHoursDay: 8, opDaysMonth: 30, demandFactor: 0.8, qty: 1 }
      ];
      // 1 bill: Theoretical 10,000 kWh, Actual 8,000 kWh (avoided 2,000 kWh, reduction 20%)
      _memDB.energyBills = [{
        id: 1,
        period: '2026-05',
        periodLabel: 'May 2026',
        theoreticalKwh: 10000,
        actualKwh: 8000,
        billAmount: 64000,
        demandKw: 55.4,
        accountNo: '01-150-0004075',
        meterNo: '09955797'
      }];
      // Set National default emission factor (0.850 kg CO2e/kWh)
      saveEnergySettings({
        gridRegion: 'National',
        emissionFactor: 0.850,
        targetReductionPct: 10.0,
        baselineYear: 2022
      });
      navigate('energy');
    });

    await page.waitForFunction(() => document.getElementById('page-energy')?.classList.contains('active'), { timeout: 5000 });

    const kpis = await page.evaluate(() => {
      const row = document.getElementById('en-stat-row');
      const text = row ? row.textContent : '';
      return {
        text,
        // 8000 kWh * 0.850 / 1000 = 6.8 tCO2e
        hasCarbonFootprint: text.includes('6.8') && text.includes('Carbon Footprint'),
        // Intensity = 0.850 kg CO2e/kWh
        hasIntensity: text.includes('0.850') && text.includes('Carbon Intensity'),
        // Avoided = (10000 - 8000) * 0.850 / 1000 = 1.7 tCO2e
        hasAvoided: text.includes('1.7') && text.includes('Estimated CO₂e Avoided'),
        // Reduction 20% >= 10% target => YES
        hasTargetMet: text.includes('YES')
      };
    });

    expect(kpis.hasCarbonFootprint).toBe(true);
    expect(kpis.hasIntensity).toBe(true);
    expect(kpis.hasAvoided).toBe(true);
    expect(kpis.hasTargetMet).toBe(true);
  });

  test('DOE Carbon Settings modal updates emission factor to Mindanao Grid (0.880 kg CO2e/kWh)', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('energy'));

    // Open settings drawer
    await page.evaluate(() => openEnergySettingsModal());
    const isOpen = await page.evaluate(() => document.getElementById('mo-energy-settings')?.classList.contains('open'));
    expect(isOpen).toBe(true);

    // Switch region to Mindanao and apply
    await page.evaluate(() => {
      const reg = document.getElementById('enset-grid-region');
      if (reg) {
        reg.value = 'Mindanao';
        onGridRegionChange('Mindanao');
      }
      applyEnergySettings();
    });

    const factorApplied = await page.evaluate(() => {
      const s = getEnergySettings();
      return {
        factor: s.emissionFactor,
        region: s.gridRegion
      };
    });

    expect(factorApplied.factor).toBe(0.880);
    expect(factorApplied.region).toBe('Mindanao');
  });

  test('Renders YoY Multi-Year Energy & Carbon charts and Top 5 Assets', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      _memDB.assets = [
        { id: 1, name: 'Chiller 1', section: 'HVAC', mainCategory: 'Aircon/Refrigeration', ratedWatts: 15000, opHoursDay: 24, opDaysMonth: 30, demandFactor: 0.85, qty: 1 },
        { id: 2, name: 'CT Scanner', section: 'Radiology', mainCategory: 'Biomedical', ratedWatts: 8000, opHoursDay: 12, opDaysMonth: 30, demandFactor: 0.7, qty: 1 }
      ];
      _memDB.energyBills = [
        { id: 1, period: '2025-06', theoreticalKwh: 5000, actualKwh: 4800, billAmount: 38000 },
        { id: 2, period: '2026-06', theoreticalKwh: 5000, actualKwh: 4500, billAmount: 36000 }
      ];
      navigate('energy');
    });

    await page.waitForFunction(() => document.getElementById('page-energy')?.classList.contains('active'), { timeout: 5000 });

    const visualElements = await page.evaluate(() => ({
      yoyEnergySvg: document.querySelector('#en-yoy-energy-chart svg') !== null,
      yoyCarbonSvg: document.querySelector('#en-yoy-carbon-chart svg') !== null,
      top5Children: (document.getElementById('en-top5-assets')?.children?.length || 0) > 0,
      catDonutSvg: document.querySelector('#en-cat-donut svg') !== null
    }));

    expect(visualElements.yoyEnergySvg).toBe(true);
    expect(visualElements.yoyCarbonSvg).toBe(true);
    expect(visualElements.top5Children).toBe(true);
    expect(visualElements.catDonutSvg).toBe(true);
  });
});
