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

test.describe('Audit Bug Fixes', () => {

  test('Fix 1: normYMD handles both DD/MM/YYYY and MM/DD/YYYY correctly', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      return {
        iso: normYMD('2026-03-25'),
        phDayFirst: normYMD('25/03/2026'),  // Day 25 > 12 -> 2026-03-25
        usMonthFirst: normYMD('03/25/2026'),// Month 3, Day 25 -> 2026-03-25
        standardSlash: normYMD('5/10/2026') // Month 5, Day 10 -> 2026-05-10
      };
    });
    expect(result.iso).toBe('2026-03-25');
    expect(result.phDayFirst).toBe('2026-03-25');
    expect(result.usMonthFirst).toBe('2026-03-25');
    expect(result.standardSlash).toBe('2026-05-10');
  });

  test('Fix 2: No duplicate DOM IDs in the document (m-a-loc fixed)', async ({ page }) => {
    await bootstrapApp(page);
    const duplicates = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('[id]'));
      const counts = {};
      allElements.forEach(el => {
        counts[el.id] = (counts[el.id] || 0) + 1;
      });
      return Object.entries(counts).filter(([id, count]) => count > 1);
    });
    expect(duplicates).toEqual([]);
  });

  test('Fix 3: Energy empty state row colspan matches table headers (9 columns)', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('energyBills', []);
      navigate('energy');
    });
    const { thCount, emptyColspan } = await page.evaluate(() => {
      const table = document.querySelector('#energy-tbody').closest('table');
      const ths = table.querySelectorAll('thead th');
      const emptyTd = document.querySelector('#energy-tbody td.empty');
      return {
        thCount: ths.length,
        emptyColspan: emptyTd ? parseInt(emptyTd.getAttribute('colspan'), 10) : null
      };
    });
    expect(thCount).toBe(9);
    expect(emptyColspan).toBe(9);
  });

  test('Fix 4: compressImageFile helper is defined and operational', async ({ page }) => {
    await bootstrapApp(page);
    const isDefined = await page.evaluate(() => {
      return typeof window.compressImageFile === 'function' || typeof compressImageFile === 'function';
    });
    expect(isDefined).toBe(true);
  });

  test('Fix 5: isSameLocation correctly identifies matching rooms and rejects cross-room numbers', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      return {
        matchSameRoom: isSameLocation('RM 316', 'Room 316'),
        matchBareNumber: isSameLocation('RM 316', '316'),
        matchCompound: isSameLocation('RM 316 - Male Ward', 'RM 316'),
        rejectCrossRoom317: isSameLocation('RM 316', 'RM 317'),
        rejectCrossRoom306: isSameLocation('RM 316', 'RM 306'),
        rejectCrossRoom317To306: isSameLocation('Room 317', 'RM 306'),
        matchNonNumbered: isSameLocation('OPD Clinic', 'OPD'),
        rejectNonNumberedMismatch: isSameLocation('ICU', 'OPD')
      };
    });
    expect(results.matchSameRoom).toBe(true);
    expect(results.matchBareNumber).toBe(true);
    expect(results.matchCompound).toBe(true);
    expect(results.rejectCrossRoom317).toBe(false);
    expect(results.rejectCrossRoom306).toBe(false);
    expect(results.rejectCrossRoom317To306).toBe(false);
    expect(results.matchNonNumbered).toBe(true);
    expect(results.rejectNonNumberedMismatch).toBe(false);
  });

  test('Fix 6: Cross-room Work Order leak is prevented in Room View (RM 317 WO does not appear in RM 316 or RM 306)', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 101, name: 'Split Type Aircon', location: 'RM 316', roomNumber: 'RM 316', qty: 1, condition: 'Good' },
        { id: 102, name: 'Split Type Aircon', location: 'RM 317', roomNumber: 'RM 317', qty: 1, condition: 'Fair' },
        { id: 103, name: 'Split Type Aircon', location: 'RM 306', roomNumber: 'RM 306', qty: 1, condition: 'Good' }
      ]);
      DB.s('wo', [
        { id: 201, code: 'WO-0201', asset: 'Split Type Aircon', location: 'RM 317', status: 'Open', description: 'AC Compressor failure', priority: 'High' }
      ]);
    });

    // 1. Open Room View for RM 316
    const rm316View = await page.evaluate(() => {
      openRoomView('RM 316');
      return {
        summary: document.getElementById('room-view-summary').innerText,
        wosHtml: document.getElementById('room-view-wos').innerHTML
      };
    });
    expect(rm316View.summary).toContain('0\nOpen Repairs');
    expect(rm316View.summary).toContain('0\nTotal Repairs');
    expect(rm316View.wosHtml).toContain('No work orders for this room');
    expect(rm316View.wosHtml).not.toContain('WO-0201');
    expect(rm316View.wosHtml).not.toContain('AC Compressor failure');

    // 2. Open Room View for RM 306
    const rm306View = await page.evaluate(() => {
      openRoomView('RM 306');
      return {
        summary: document.getElementById('room-view-summary').innerText,
        wosHtml: document.getElementById('room-view-wos').innerHTML
      };
    });
    expect(rm306View.summary).toContain('0\nOpen Repairs');
    expect(rm306View.summary).toContain('0\nTotal Repairs');
    expect(rm306View.wosHtml).toContain('No work orders for this room');
    expect(rm306View.wosHtml).not.toContain('WO-0201');

    // 3. Open Room View for RM 317 (where the WO actually belongs)
    const rm317View = await page.evaluate(() => {
      openRoomView('RM 317');
      return {
        summary: document.getElementById('room-view-summary').innerText,
        wosHtml: document.getElementById('room-view-wos').innerHTML
      };
    });
    expect(rm317View.summary).toContain('1\nOpen Repairs');
    expect(rm317View.summary).toContain('1\nTotal Repairs');
    expect(rm317View.wosHtml).toContain('WO-0201');
    expect(rm317View.wosHtml).toContain('AC Compressor failure');
  });

  test('Fix 7: Asset table repair count and viewHistory only count/show repairs for that asset location', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 101, name: 'Split Type Aircon', location: 'RM 316', roomNumber: 'RM 316', qty: 1, condition: 'Good' },
        { id: 102, name: 'Split Type Aircon', location: 'RM 317', roomNumber: 'RM 317', qty: 1, condition: 'Fair' }
      ]);
      DB.s('wo', [
        { id: 201, code: 'WO-0201', asset: 'Split Type Aircon', location: 'RM 317', status: 'Open', description: 'Leaking water' }
      ]);
      navigate('assets');
    });

    const counts = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => {
        const name = r.children[1]?.textContent.trim();
        const loc = r.children[3]?.textContent.trim();
        const repCount = r.children[10]?.textContent.trim(); // repair count column (index 10)
        return { name, loc, repCount };
      });
    });

    const rm316Row = counts.find(c => c.loc && c.loc.includes('RM 316'));
    const rm317Row = counts.find(c => c.loc && c.loc.includes('RM 317'));
    expect(rm316Row.repCount).toBe('0');
    expect(rm317Row.repCount).toBe('1');

    // Test viewHistory on RM 316 asset
    const history316 = await page.evaluate(() => {
      viewHistory(101);
      return document.getElementById('history-tbody').innerHTML;
    });
    expect(history316).toContain('No work orders for this asset');
    expect(history316).not.toContain('WO-0201');

    // Test viewHistory on RM 317 asset
    const history317 = await page.evaluate(() => {
      viewHistory(102);
      return document.getElementById('history-tbody').innerHTML;
    });
    expect(history317).toContain('WO-0201');
    expect(history317).toContain('Leaking water');
  });

  test('Fix 8: Stock Level formula calculates Qty On Hand / Min. Level * 100% correctly', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('inventory', [
        { id: 1, code: 'INV-001', description: 'Angle Valve 1/2"', category: 'Plumbing', unit: 'piece', qty: 5, minLevel: 10 },
        { id: 2, code: 'INV-002', description: 'Ball Valve 1/2"', category: 'Plumbing', unit: 'piece', qty: 12, minLevel: 10 },
        { id: 3, code: 'INV-003', description: 'Teflon Tape', category: 'Plumbing', unit: 'roll', qty: 20, minLevel: 10 },
        { id: 4, code: 'INV-004', description: 'Faucet Washer', category: 'Plumbing', unit: 'pack', qty: 0, minLevel: 5 }
      ]);
      navigate('inventory');
    });

    // 1. Verify status calculations
    const statuses = await page.evaluate(() => {
      const inv = DB.g('inventory');
      const map = {};
      inv.forEach(i => { map[i.description] = invStockStatus(i); });
      return map;
    });
    expect(statuses['Angle Valve 1/2"']).toBe('Critical'); // 5 <= 10 (50%)
    expect(statuses['Ball Valve 1/2"']).toBe('Warning');   // 12 <= 15 (120%)
    expect(statuses['Teflon Tape']).toBe('OK');            // 20 > 15 (200%)
    expect(statuses['Faucet Washer']).toBe('Critical');    // 0 <= 5 (0%)

    // 2. Verify rendered percentages and bar styles in the inventory table
    const tableData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#inv-tbody tr'));
      return rows.map(r => {
        const desc = r.children[1]?.textContent.trim();
        const stockCol = r.children[4]?.textContent.trim();
        const bar = r.children[4]?.querySelector('.stock-bar');
        const barWidth = bar ? bar.style.width : '';
        const barClass = bar ? bar.className : '';
        const qty = r.children[5]?.textContent.trim();
        const min = r.children[6]?.textContent.trim();
        const alert = r.children[7]?.textContent.trim();
        return { desc, stockCol, barWidth, barClass, qty, min, alert };
      });
    });

    const angleValve = tableData.find(d => d.desc.includes('Angle Valve'));
    expect(angleValve.stockCol).toBe('50%');
    expect(angleValve.barWidth).toBe('50%');
    expect(angleValve.barClass).toContain('sb-crit');
    expect(angleValve.qty).toBe('5');
    expect(angleValve.min).toBe('10');
    expect(angleValve.alert).toBe('Critical');

    const ballValve = tableData.find(d => d.desc.includes('Ball Valve'));
    expect(ballValve.stockCol).toBe('120%');
    expect(ballValve.barWidth).toBe('100%'); // clamped to max 100% width
    expect(ballValve.barClass).toContain('sb-warn');
    expect(ballValve.qty).toBe('12');
    expect(ballValve.min).toBe('10');
    expect(ballValve.alert).toBe('Warning');

    const teflonTape = tableData.find(d => d.desc.includes('Teflon Tape'));
    expect(teflonTape.stockCol).toBe('200%');
    expect(teflonTape.barWidth).toBe('100%');
    expect(teflonTape.barClass).toContain('sb-ok');
    expect(teflonTape.qty).toBe('20');
    expect(teflonTape.min).toBe('10');
    expect(teflonTape.alert).toBe('OK');
  });

  test('Fix 9: Fuel Management System navigation exists in sidebar and has correct accessibility attributes', async ({ page }) => {
    await bootstrapApp(page);
    const fuelNavItem = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#sidebar .nav-item'));
      const fuelItem = items.find(el => el.textContent.includes('Fuel Management System'));
      if (!fuelItem) return null;
      return {
        text: fuelItem.textContent.trim(),
        role: fuelItem.getAttribute('role'),
        tabindex: fuelItem.getAttribute('tabindex'),
        hasKeydown: !!fuelItem.getAttribute('onkeydown'),
        onclick: fuelItem.getAttribute('onclick')
      };
    });
    expect(fuelNavItem).not.toBeNull();
    expect(fuelNavItem.role).toBe('button');
    expect(fuelNavItem.tabindex).toBe('0');
    expect(fuelNavItem.hasKeydown).toBe(true);
    expect(fuelNavItem.onclick).toContain("openFuelSystem()");
  });

  test('Fix 10: navigate(\'fuel\') activates page-fuel and displays live portal link', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('fuel'));
    const fuelPageInfo = await page.evaluate(() => {
      const pageEl = document.getElementById('page-fuel');
      const isActive = pageEl ? pageEl.classList.contains('active') : false;
      const pageTitle = document.getElementById('page-title')?.textContent;
      const titleInPageTitles = PAGE_TITLES['fuel'];
      const links = pageEl ? Array.from(pageEl.querySelectorAll('a[href]')).map(a => ({
        href: a.getAttribute('href'),
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel')
      })) : [];
      return { isActive, pageTitle, titleInPageTitles, links };
    });
    expect(fuelPageInfo.isActive).toBe(true);
    expect(fuelPageInfo.pageTitle).toBe('Fuel Management System');
    expect(fuelPageInfo.titleInPageTitles).toBe('Fuel Management System');
    const targetLink = fuelPageInfo.links.find(l => l.href === 'https://fuel-monitoring-system-24eea.web.app/');
    expect(targetLink).toBeDefined();
    expect(targetLink.target).toBe('_blank');
    expect(targetLink.rel).toContain('noopener');
  });

  test('Fix 11: isSameLocation prevents OR and Medical Records cross-contamination while preserving valid aliases', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      return {
        rejectOrMedRec: isSameLocation('OR', 'Medical Records'),
        rejectMedRecOr: isSameLocation('Medical Records', 'OR'),
        rejectErMedRec: isSameLocation('ER', 'Medical Records'),
        rejectLaborRoomOr: isSameLocation('Labor Room', 'OR'),
        rejectCorridorOr: isSameLocation('Corridor', 'OR'),
        rejectServerRoomEr: isSameLocation('Server Room', 'ER'),
        matchOrOperatingRoom: isSameLocation('OR', 'Operating Room'),
        matchOperatingRoomOr: isSameLocation('Operating Room', 'OR'),
        matchOperatingTheatreOr: isSameLocation('Operating Theatre', 'OR'),
        matchErEmergencyRoom: isSameLocation('ER', 'Emergency Room'),
        matchMedRecHealthRec: isSameLocation('Medical Records', 'Health Records'),
        matchMedRecDept: isSameLocation('Medical Records', 'Medical Records Dept'),
        matchNumberedOr: isSameLocation('OR 1', 'Operating Room 1'),
        rejectNumberedDiffOr: isSameLocation('OR 1', 'OR 2')
      };
    });
    expect(results.rejectOrMedRec).toBe(false);
    expect(results.rejectMedRecOr).toBe(false);
    expect(results.rejectErMedRec).toBe(false);
    expect(results.rejectLaborRoomOr).toBe(false);
    expect(results.rejectCorridorOr).toBe(false);
    expect(results.rejectServerRoomEr).toBe(false);
    expect(results.matchOrOperatingRoom).toBe(true);
    expect(results.matchOperatingRoomOr).toBe(true);
    expect(results.matchOperatingTheatreOr).toBe(true);
    expect(results.matchErEmergencyRoom).toBe(true);
    expect(results.matchMedRecHealthRec).toBe(true);
    expect(results.matchMedRecDept).toBe(true);
    expect(results.matchNumberedOr).toBe(true);
    expect(results.rejectNumberedDiffOr).toBe(false);
  });

  test('Fix 12: buildLocAbv produces correct abbreviations for Medical Records and Operating Room', async ({ page }) => {
    await bootstrapApp(page);
    const abvs = await page.evaluate(() => {
      return {
        medRec: buildLocAbv('Medical Records'),
        medRecDept: buildLocAbv('Medical Records Department'),
        or: buildLocAbv('OR'),
        opRoom: buildLocAbv('Operating Room'),
        er: buildLocAbv('ER'),
        emergRoom: buildLocAbv('Emergency Room'),
        dr: buildLocAbv('Delivery Room')
      };
    });
    expect(abvs.medRec).toBe('MEDREC');
    expect(abvs.medRecDept).toBe('MEDREC');
    expect(abvs.or).toBe('OR');
    expect(abvs.opRoom).toBe('OR');
    expect(abvs.er).toBe('ER');
    expect(abvs.emergRoom).toBe('ER');
    expect(abvs.dr).toBe('DR');
  });

  test('Fix 13: Room View for Medical Records captures exactly its 3 Mechanical assets and excludes OR assets', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 301, name: 'Split Type AC 2HP', section: 'Mechanical', mainCategory: 'HVAC / Refrigeration', location: 'Medical Records', roomNumber: '', roomName: 'Medical Records', qty: 1, condition: 'Good' },
        { id: 302, name: 'Exhaust Fan 12in', section: 'Mechanical', mainCategory: 'Mechanical', location: 'Medical Records', roomNumber: '', roomName: 'Medical Records', qty: 1, condition: 'Good' },
        { id: 303, name: 'Air Handling Unit Filter', section: 'Mechanical', mainCategory: 'Mechanical', location: 'Medical Records', roomNumber: '', roomName: 'Medical Records', qty: 1, condition: 'Fair' },
        { id: 401, name: 'OR Major Surgical Light', section: 'Mechanical', mainCategory: 'Mechanical', location: 'OR', roomNumber: '', roomName: 'OR', qty: 2, condition: 'Good' },
        { id: 402, name: 'Anesthesia Machine', section: 'Mechanical', mainCategory: 'Mechanical', location: 'Operating Room', roomNumber: '', roomName: 'Operating Room', qty: 1, condition: 'Good' }
      ]);
      DB.s('wo', [
        { id: 501, code: 'WO-0501', asset: 'Split Type AC 2HP', location: 'Medical Records', status: 'Open', description: 'AC filter cleaning' },
        { id: 502, code: 'WO-0502', asset: 'OR Major Surgical Light', location: 'OR', status: 'Open', description: 'Bulb replacement' }
      ]);
    });

    // 1. Open Room View for Medical Records
    const medRecView = await page.evaluate(() => {
      openRoomView('Medical Records');
      const rows = Array.from(document.querySelectorAll('#room-view-assets tr')).map(r => r.innerText);
      const woRows = Array.from(document.querySelectorAll('#room-view-wos tr')).map(r => r.innerText);
      return {
        title: document.getElementById('room-view-title').textContent,
        subtitle: document.getElementById('room-view-subtitle').textContent,
        rows,
        woRows
      };
    });

    expect(medRecView.title).toContain('Medical Records');
    expect(medRecView.subtitle).toContain('3 asset type(s)');
    expect(medRecView.rows.length).toBe(3);
    expect(medRecView.rows.some(r => r.includes('Split Type AC 2HP'))).toBe(true);
    expect(medRecView.rows.some(r => r.includes('Exhaust Fan 12in'))).toBe(true);
    expect(medRecView.rows.some(r => r.includes('Air Handling Unit Filter'))).toBe(true);
    // OR assets MUST NOT be captured
    expect(medRecView.rows.some(r => r.includes('OR Major Surgical Light'))).toBe(false);
    expect(medRecView.rows.some(r => r.includes('Anesthesia Machine'))).toBe(false);
    // WOs must be isolated
    expect(medRecView.woRows.some(r => r.includes('WO-0501'))).toBe(true);
    expect(medRecView.woRows.some(r => r.includes('WO-0502'))).toBe(false);

    // 2. Open Room View for OR
    const orView = await page.evaluate(() => {
      openRoomView('OR');
      const rows = Array.from(document.querySelectorAll('#room-view-assets tr')).map(r => r.innerText);
      const woRows = Array.from(document.querySelectorAll('#room-view-wos tr')).map(r => r.innerText);
      return {
        title: document.getElementById('room-view-title').textContent,
        subtitle: document.getElementById('room-view-subtitle').textContent,
        rows,
        woRows
      };
    });

    expect(orView.title).toContain('OR');
    expect(orView.subtitle).toContain('2 asset type(s)');
    expect(orView.rows.length).toBe(2);
    expect(orView.rows.some(r => r.includes('OR Major Surgical Light'))).toBe(true);
    expect(orView.rows.some(r => r.includes('Anesthesia Machine'))).toBe(true);
    // Medical Records assets MUST NOT be captured
    expect(orView.rows.some(r => r.includes('Split Type AC 2HP'))).toBe(false);
    expect(orView.woRows.some(r => r.includes('WO-0502'))).toBe(true);
    expect(orView.woRows.some(r => r.includes('WO-0501'))).toBe(false);
  });

  test('Fix 14: Asset Registry search for "OR" does not match "Medical Records"', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 601, name: 'Desk Fan', section: 'Mechanical', location: 'Medical Records', roomNumber: '', roomName: 'Medical Records', qty: 1, condition: 'Good' },
        { id: 602, name: 'Suction Machine', section: 'Mechanical', location: 'OR', roomNumber: '', roomName: 'OR', qty: 1, condition: 'Good' }
      ]);
      navigate('assets');
      document.getElementById('af-search').value = 'OR';
      renderAssets();
    });

    const renderedNames = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#asset-tbody tr')).map(r => r.children[1]?.textContent.trim());
    });

    expect(renderedNames).toContain('Suction Machine');
    expect(renderedNames).not.toContain('Desk Fan');
  });

  test('Fix 15: Dashboard does not display the ⏰ PMS overdue · upcoming alarm summary line', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 701, name: 'Aircon 1', maintFrequency: 30, lastMaintDate: '2020-01-01', nextMaintDate: '2020-02-01' },
        { id: 702, name: 'Aircon 2', maintFrequency: 30, lastMaintDate: '2020-01-01', nextMaintDate: '2026-10-05' }
      ]);
      navigate('dashboard');
    });

    const summaryInfo = await page.evaluate(() => {
      const el = document.getElementById('dash-pm-alarm-summary');
      const pageText = document.getElementById('page-dashboard')?.innerText || '';
      return {
        elExists: !!el,
        hasAlarmClockSummary: pageText.includes('PMS overdue') && pageText.includes('⏰')
      };
    });

    expect(summaryInfo.elExists).toBe(false);
    expect(summaryInfo.hasAlarmClockSummary).toBe(false);
  });

  test('Fix 16: Topbar does not display the ⚠ Low Stock chip even when low stock items exist', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      // Seed inventory with low and critical stock items
      DB.s('inventory', [
        { id: 801, code: 'INV-801', description: 'Ball Valve 1/2"', category: 'Plumbing', unit: 'piece', qty: 2, minLevel: 10 },
        { id: 802, code: 'INV-802', description: 'Angle Valve 1/2"', category: 'Plumbing', unit: 'piece', qty: 0, minLevel: 5 }
      ]);
      navigate('dashboard');
      updateInvAlerts();
    });

    const chipInfo = await page.evaluate(() => {
      const chip = document.getElementById('top-inv-alert');
      const topbarText = document.getElementById('topbar')?.innerText || '';
      return {
        chipExists: !!chip,
        hasLowStockInTopbar: topbarText.includes('Low Stock')
      };
    });

    expect(chipInfo.chipExists).toBe(false);
    expect(chipInfo.hasLowStockInTopbar).toBe(false);
  });

  test('Fix 17: buildLocAbv parses room numbers, ward numbers, and location tokens correctly without collision or truncation', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      return {
        rm101: buildLocAbv('Room 101'),
        rm102: buildLocAbv('Room 102'),
        rm316: buildLocAbv('RM 316'),
        rm317: buildLocAbv('Room 317'),
        wrd1: buildLocAbv('Ward 1'),
        wrd2: buildLocAbv('Ward 2'),
        wrd3: buildLocAbv('Ward 3'),
        medrec: buildLocAbv('Medical Records'),
        or: buildLocAbv('Operating Room'),
        er: buildLocAbv('Emergency Room'),
        icu: buildLocAbv('ICU'),
        diet: buildLocAbv('Dietary'),
        ktchn: buildLocAbv('Kitchen'),
        mrg: buildLocAbv('Morgue'),
        lab: buildLocAbv('Laboratory'),
        safetyCallSingleArg: buildLocAbv('Medical Records'),
        safetyCallLegacyRoomArg: buildLocAbv(null, null, 'Medical Records'),
        roomNumberDirect: buildLocAbv(null, null, '101')
      };
    });

    expect(results.rm101).toBe('RM101');
    expect(results.rm102).toBe('RM102');
    expect(results.rm101).not.toBe(results.rm102);

    expect(results.rm316).toBe('RM316');
    expect(results.rm317).toBe('RM317');
    expect(results.rm316).not.toBe(results.rm317);

    expect(results.wrd1).toBe('WRD1');
    expect(results.wrd2).toBe('WRD2');
    expect(results.wrd3).toBe('WRD3');
    expect(results.wrd1).not.toBe(results.wrd2);

    expect(results.medrec).toBe('MEDREC');
    expect(results.or).toBe('OR');
    expect(results.er).toBe('ER');
    expect(results.icu).toBe('ICU');
    expect(results.diet).toBe('DIET');
    expect(results.ktchn).toBe('KTCHN');
    expect(results.mrg).toBe('MRG');
    expect(results.lab).toBe('LAB');
    expect(results.safetyCallSingleArg).toBe('MEDREC');
    expect(results.safetyCallLegacyRoomArg).toBe('MEDREC');
    expect(results.roomNumberDirect).toBe('RM101');
  });

  test('Fix 18: Registering assets in different rooms/wards generates distinct asset codes and preserves roomNumber', async ({ page }) => {
    await bootstrapApp(page);
    const codes = await page.evaluate(() => {
      // 1. Open modal and save asset in Room 101
      openAssetModal();
      document.getElementById('m-a-section').value = 'Mechanical';
      document.getElementById('m-a-name').value = 'Split Type Aircon';
      document.getElementById('m-a-loc').value = 'Room 101';
      saveAsset();

      // 2. Open modal and save asset in Room 102
      openAssetModal();
      document.getElementById('m-a-section').value = 'Mechanical';
      document.getElementById('m-a-name').value = 'Split Type Aircon';
      document.getElementById('m-a-loc').value = 'Room 102';
      saveAsset();

      // 3. Open modal and save asset in Ward 1
      openAssetModal();
      document.getElementById('m-a-section').value = 'Plumbing';
      document.getElementById('m-a-name').value = 'Water Valve';
      document.getElementById('m-a-loc').value = 'Ward 1';
      saveAsset();

      // 4. Open modal and save asset in Ward 2
      openAssetModal();
      document.getElementById('m-a-section').value = 'Plumbing';
      document.getElementById('m-a-name').value = 'Water Valve';
      document.getElementById('m-a-loc').value = 'Ward 2';
      saveAsset();

      const assets = DB.g('assets');
      return {
        assets: assets.map(a => ({
          name: a.name,
          loc: a.location,
          roomNo: a.roomNumber,
          code: a.assetCode
        }))
      };
    });

    const a101 = codes.assets.find(a => a.loc === 'Room 101');
    const a102 = codes.assets.find(a => a.loc === 'Room 102');
    const w1 = codes.assets.find(a => a.loc === 'Ward 1');
    const w2 = codes.assets.find(a => a.loc === 'Ward 2');

    expect(a101).toBeDefined();
    expect(a102).toBeDefined();
    expect(a101.roomNo).toBe('101');
    expect(a102.roomNo).toBe('102');
    expect(a101.code).toContain('RM101');
    expect(a102.code).toContain('RM102');
    expect(a101.code).not.toBe(a102.code);

    expect(w1).toBeDefined();
    expect(w2).toBeDefined();
    expect(w1.code).toContain('WRD1');
    expect(w2.code).toContain('WRD2');
    expect(w1.code).not.toBe(w2.code);
  });

  test('Fix 19: Work order asset dropdown fillAssetDrop isolates assets by location and does not leak cross-location assets', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 901, assetCode: 'AC-MECH-MEDREC-01', name: 'Split Type Aircon - MedRec', section: 'Mechanical', location: 'Medical Records', roomName: 'Medical Records' },
        { id: 902, assetCode: 'AC-MECH-OR-01', name: 'Split Type Aircon - OR', section: 'Mechanical', location: 'Operating Room', roomName: 'Operating Room' },
        { id: 903, assetCode: 'EX-MECH-RM101-01', name: 'Exhaust Fan - RM 101', section: 'Mechanical', location: 'Room 101', roomNumber: '101' },
        { id: 904, assetCode: 'EX-MECH-RM102-01', name: 'Exhaust Fan - RM 102', section: 'Mechanical', location: 'Room 102', roomNumber: '102' },
        { id: 905, assetCode: 'BO-MECH-BLRM-01', name: 'Boiler Pump', section: 'Mechanical', location: 'Boiler Room', roomName: 'Boiler Room' }
      ]);
    });

    // 1. Filter by location "OR" -> Should only match OR, NOT Medical Records (despite "records" containing "or")
    const orOptions = await page.evaluate(() => {
      openWOModal();
      document.getElementById('m-wo-section').value = 'Mechanical';
      document.getElementById('m-wo-loc').value = 'OR';
      fillAssetDrop();
      const select = document.getElementById('m-wo-asset');
      return Array.from(select.options).map(o => o.text);
    });
    expect(orOptions.some(t => t.includes('Split Type Aircon - OR'))).toBe(true);
    expect(orOptions.some(t => t.includes('Medical Records') || t.includes('MedRec'))).toBe(false);

    // 2. Filter by location "ER" -> Should NOT match "Boiler Room" (despite "boiler" containing "er")
    const erOptions = await page.evaluate(() => {
      document.getElementById('m-wo-loc').value = 'ER';
      fillAssetDrop();
      const select = document.getElementById('m-wo-asset');
      return Array.from(select.options).map(o => o.text);
    });
    expect(erOptions.some(t => t.includes('Boiler Pump'))).toBe(false);

    // 3. Filter by location "Room 101" -> Should only show RM 101, NOT RM 102
    const rm101Options = await page.evaluate(() => {
      document.getElementById('m-wo-loc').value = 'Room 101';
      fillAssetDrop();
      const select = document.getElementById('m-wo-asset');
      return Array.from(select.options).map(o => o.text);
    });
    expect(rm101Options.some(t => t.includes('RM 101'))).toBe(true);
    expect(rm101Options.some(t => t.includes('RM 102'))).toBe(false);

    // 4. Selecting asset auto-fills location if empty
    const autoFillResult = await page.evaluate(() => {
      document.getElementById('m-wo-loc').value = '';
      fillAssetDrop();
      const select = document.getElementById('m-wo-asset');
      // Find option for RM 101
      const opt = Array.from(select.options).find(o => o.value === 'Exhaust Fan - RM 101');
      if (opt) {
        select.value = opt.value;
        onWOAssetChange();
      }
      return document.getElementById('m-wo-loc').value;
    });
    expect(autoFillResult).toBe('Room 101');
  });

  test('Fix 20: Assets with identical specification/name across different locations remain strictly segregated in Room View and Work Orders', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 911, assetCode: 'AC-MECH-RM101-01', name: 'Split-Type Aircon 2HP', section: 'Mechanical', location: 'Room 101', roomNumber: '101', brand: 'Carrier', qty: 1, condition: 'Good' },
        { id: 912, assetCode: 'AC-MECH-RM102-01', name: 'Split-Type Aircon 2HP', section: 'Mechanical', location: 'Room 102', roomNumber: '102', brand: 'Carrier', qty: 1, condition: 'Fair' }
      ]);
      DB.s('wo', [
        { id: 921, code: 'WO-0921', asset: 'Split-Type Aircon 2HP', location: 'Room 101', status: 'Open', description: 'Filter cleaning needed', priority: 'Low' }
      ]);
    });

    // 1. Room View for Room 101: 1 asset, 1 repair
    const rm101View = await page.evaluate(() => {
      openRoomView('Room 101');
      return {
        assetsHtml: document.getElementById('room-view-assets').innerHTML,
        wosHtml: document.getElementById('room-view-wos').innerHTML,
        summary: document.getElementById('room-view-summary').innerText
      };
    });
    expect(rm101View.assetsHtml).toContain('AC-MECH-RM101-01');
    expect(rm101View.assetsHtml).not.toContain('AC-MECH-RM102-01');
    expect(rm101View.wosHtml).toContain('WO-0921');
    expect(rm101View.summary).toContain('1\nOpen Repairs');

    // 2. Room View for Room 102: 1 asset, 0 repairs (WO from Room 101 does NOT leak into Room 102)
    const rm102View = await page.evaluate(() => {
      openRoomView('Room 102');
      return {
        assetsHtml: document.getElementById('room-view-assets').innerHTML,
        wosHtml: document.getElementById('room-view-wos').innerHTML,
        summary: document.getElementById('room-view-summary').innerText
      };
    });
    expect(rm102View.assetsHtml).toContain('AC-MECH-RM102-01');
    expect(rm102View.assetsHtml).not.toContain('AC-MECH-RM101-01');
    expect(rm102View.wosHtml).toContain('No work orders for this room');
    expect(rm102View.wosHtml).not.toContain('WO-0921');
    expect(rm102View.summary).toContain('0\nOpen Repairs');
  });

  test('Fix 21: Location category discriminator prevents cross-category number collisions (Room 1 vs Ward 1 vs OR 1)', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      return {
        roomVsWard: isSameLocation('Room 1', 'Ward 1'),
        roomVsOR: isSameLocation('Room 1', 'OR 1'),
        roomVsICU: isSameLocation('Room 1', 'ICU 1'),
        wardVsOR: isSameLocation('Ward 1', 'OR 1'),
        roomVsRoom: isSameLocation('Room 1', 'RM 1'),
        wardVsWard: isSameLocation('Ward 1', 'WRD 1')
      };
    });
    expect(results.roomVsWard).toBe(false);
    expect(results.roomVsOR).toBe(false);
    expect(results.roomVsICU).toBe(false);
    expect(results.wardVsOR).toBe(false);
    expect(results.roomVsRoom).toBe(true);
    expect(results.wardVsWard).toBe(true);
  });

  test('Fix 22: saveTankReading accepts 0 inpatient count without rejection and records 0', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      DB.s('assets', [{ id: 501, name: 'Main Water Tank', tankCapacityLiters: 10000, minLevelAlertPct: 20 }]);
      DB.s('waterTank', []);
      openTankModal();
      window._tkLinkedAssetId = 501;
      document.getElementById('m-tk-name').value = 'Main Water Tank';
      document.getElementById('m-tk-cap').value = '10000';
      document.getElementById('m-tk-dt').value = '2026-03-25T08:00';
      document.getElementById('m-tk-level').value = '75';
      document.getElementById('m-tk-patients').value = '0';
      saveTankReading();
      const records = DB.g('waterTank');
      return {
        count: records.length,
        reading: records[0] ? {
          tankName: records[0].tankName,
          patientCount: records[0].patientCount,
          tankLevel: records[0].tankLevel
        } : null
      };
    });
    expect(result.count).toBe(1);
    expect(result.reading.tankName).toBe('Main Water Tank');
    expect(result.reading.patientCount).toBe(0);
    expect(result.reading.tankLevel).toBe(75);
  });

  test('Fix 23: renderSafety wires up #sf-loc-filter and word boundaries prevent OR from matching Medical Records', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('safety', [
        { id: 601, description: 'Slippery floor near OR sink', location: 'OR', severity: 'High', status: 'Open', date: '2026-03-01' },
        { id: 602, description: 'Cabinet door loose', location: 'Medical Records', severity: 'Low', status: 'Open', date: '2026-03-01' },
        { id: 603, description: 'Exposed wire', location: 'Boiler Room', severity: 'Critical', status: 'Open', date: '2026-03-01' }
      ]);
      navigate('safety');
    });

    // Test location filter input
    const locFilterResult = await page.evaluate(() => {
      const locInput = document.getElementById('sf-loc-filter');
      locInput.value = 'OR';
      renderSafety();
      const rows = Array.from(document.querySelectorAll('#safety-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(locFilterResult.length).toBe(1);
    expect(locFilterResult[0]).toContain('Slippery floor near OR sink');
    expect(locFilterResult[0]).not.toContain('Medical Records');
    expect(locFilterResult[0]).not.toContain('Boiler Room');

    // Test search input with "OR"
    const searchResult = await page.evaluate(() => {
      document.getElementById('sf-loc-filter').value = '';
      const searchInput = document.getElementById('sf-search');
      searchInput.value = 'OR';
      renderSafety();
      const rows = Array.from(document.querySelectorAll('#safety-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(searchResult.some(t => t.includes('Medical Records'))).toBe(false);
    expect(searchResult.some(t => t.includes('Boiler Room'))).toBe(false);
    expect(searchResult.some(t => t.includes('Slippery floor near OR sink'))).toBe(true);
  });

  test('Fix 24: importWaterLogCSV sets chlorine and residualChlorine and generates WL code', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      DB.s('waterLogs', []);
      const csvData = 'Date,Ward_Location,Test_Type,Result,Bacteria_Count_CFU,Residual_Chlorine_mgL,Mitigation_Action,Remarks\n2026-03-20,ICU,Residual Chlorine,Safe,<1,0.45,None,Monthly check';
      const file = new File([csvData], 'waterlog.csv', { type: 'text/csv' });
      const event = { target: { files: [file], value: '' } };
      importWaterLogCSV(event);
      return new Promise(resolve => {
        setTimeout(() => {
          const list = DB.g('waterLogs');
          resolve(list[0] || null);
        }, 100);
      });
    });
    expect(result).not.toBeNull();
    expect(result.chlorine).toBe('0.45');
    expect(result.residualChlorine).toBe('0.45');
    expect(result.code).toBe('ICU-RES-001');
  });

  test('Fix 25: getCensusForDate safely handles entries with null or missing dates', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      DB.s('censusLog', [
        { date: null, count: 120 },
        { date: '2026-03-01', count: 150 },
        { date: '2026-03-10', count: 180 }
      ]);
      return {
        forMarch5: getCensusForDate('2026-03-05'),
        forMarch15: getCensusForDate('2026-03-15')
      };
    });
    expect(result.forMarch5).toBe(150);
    expect(result.forMarch15).toBe(180);
  });

  test('Fix 26: importWOCSV generates module code and auto-fills location from asset registry', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      DB.s('assets', [
        { id: 701, name: 'Centrifuge Model X', assetCode: 'LAB-MED-RM105-01', location: 'Laboratory Room 105', section: 'Mechanical' }
      ]);
      DB.s('wo', []);
      const csvData = 'Section,Asset,Location,Description,Priority,Status\nMechanical,Centrifuge Model X,,Motor making high-pitched noise,High,Open';
      const file = new File([csvData], 'wo.csv', { type: 'text/csv' });
      const event = { target: { files: [file], value: '' } };
      importWOCSV(event);
      return new Promise(resolve => {
        setTimeout(() => {
          const list = DB.g('wo');
          resolve(list[0] || null);
        }, 100);
      });
    });
    expect(result).not.toBeNull();
    expect(result.location).toBe('Laboratory Room 105');
    expect(result.code).toBe('MECH-HI-0001');
  });

  test('Fix 27: Effluent, MedWaste, and WWProd imports generate valid module codes', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(async () => {
      DB.s('effluent', []);
      DB.s('medWasteProd', []);
      DB.s('wwProd', []);

      // 1. Effluent
      const effCSV = 'Sampling_Point,Date,Status,pH,BOD\nSTP Effluent,2026-03-25,Compliant,7.2,28.5';
      const effFile = new File([effCSV], 'eff.csv', { type: 'text/csv' });
      importEffluentCSV({ target: { files: [effFile], value: '' } });

      // 2. MedWaste
      const mwCSV = 'Date,Shift,Status,Input,Treated\n2026-03-25,AM Shift,Normal,120,118';
      const mwFile = new File([mwCSV], 'mw.csv', { type: 'text/csv' });
      importMedWasteCSV({ target: { files: [mwFile], value: '' } });

      // 3. WWProd
      const wwCSV = 'Date,Shift,Status,Inflow,Treated\n2026-03-25,PM Shift,Normal,250,248';
      const wwFile = new File([wwCSV], 'ww.csv', { type: 'text/csv' });
      importWWProdCSV({ target: { files: [wwFile], value: '' } });

      await new Promise(r => setTimeout(r, 150));
      return {
        effCode: DB.g('effluent')[0]?.code,
        mwCode: DB.g('medWasteProd')[0]?.code,
        wwCode: DB.g('wwProd')[0]?.code
      };
    });
    expect(results.effCode).toBe('STPEFF-0001');
    expect(results.mwCode).toBe('AM-0001');
    expect(results.wwCode).toBe('PM-0001');
  });

  test('Fix 28: Room View modal escapes assetCode and w.code against XSS', async ({ page }) => {
    await bootstrapApp(page);
    const htmlContent = await page.evaluate(() => {
      DB.s('assets', [{
        id: 991,
        assetCode: '<img src=x onerror=alert(1)>',
        name: 'Test XSS Asset',
        location: 'ICU',
        qty: 1,
        condition: 'Good'
      }]);
      DB.s('wo', [{
        id: 992,
        code: '<b id="wo-xss-injection">WO-INJ</b>',
        asset: 'Test XSS Asset',
        location: 'ICU',
        status: 'Open',
        priority: 'Medium'
      }]);
      openRoomView('ICU');
      return {
        assetsHtml: document.getElementById('room-view-assets').innerHTML,
        wosHtml: document.getElementById('room-view-wos').innerHTML,
        hasRawAssetCodeTag: !!document.querySelector('#room-view-assets img[onerror]'),
        hasRawWoCodeTag: !!document.getElementById('wo-xss-injection')
      };
    });
    expect(htmlContent.hasRawAssetCodeTag).toBe(false);
    expect(htmlContent.hasRawWoCodeTag).toBe(false);
    expect(htmlContent.assetsHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(htmlContent.wosHtml).toContain('&lt;b id="wo-xss-injection"&gt;');
  });

  test('Fix 29: safeSrc escapes double quotes and HTML special characters', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      return {
        quoteBreakout: safeSrc('https://example.com/test.jpg" onerror="alert(1)'),
        dataImage: safeSrc('data:image/png;base64,abc123" onload="alert(2)'),
        cleanHttps: safeSrc('https://example.com/clean.jpg')
      };
    });
    expect(results.quoteBreakout).toBe('https://example.com/test.jpg&quot; onerror=&quot;alert(1)');
    expect(results.dataImage).toBe('data:image/png;base64,abc123&quot; onload=&quot;alert(2)');
    expect(results.cleanHttps).toBe('https://example.com/clean.jpg');
  });

  test('Fix 30: censusLog ensures deterministic docId keyed by date', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      const records = [
        { date: '2026-10-08', count: 185 },
        { date: '2026-10-09', count: 190 }
      ];
      const identified = ensureStoreRecordIdentity('censusLog', records);
      const key0 = getStoreRecordKey('censusLog', identified[0]);
      return {
        docId0: identified[0]._docId,
        docId1: identified[1]._docId,
        key0
      };
    });
    expect(results.docId0).toBe('2026-10-08');
    expect(results.docId1).toBe('2026-10-09');
    expect(results.key0).toBe('2026-10-08');
  });
});



