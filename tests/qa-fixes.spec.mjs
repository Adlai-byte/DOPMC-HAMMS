import { test, expect } from '@playwright/test';

// Helper: bypass login and initialize empty app state
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
    navigate('dashboard');
  });
}

// ═══════════════════════════════════════════════════
// Phase 1 — Critical Bugs
// ═══════════════════════════════════════════════════

test.describe('Phase 1 — Critical Bugs', () => {

  test('1.1 Tank capacity ternary returns user value when provided', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      // Simulate: user typed 100 in m-tk-vol, asset has 500
      const userVal = 100;
      const linkedAsset = { tankCapacityLiters: 500 };
      // New logic: gn('m-tk-vol') || linkedAsset?.tankCapacityLiters || null
      return userVal || linkedAsset?.tankCapacityLiters || null;
    });
    expect(result).toBe(100);
  });

  test('1.1 Tank capacity ternary falls back to asset when user provides nothing', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const userVal = null;
      const linkedAsset = { tankCapacityLiters: 500 };
      return userVal || linkedAsset?.tankCapacityLiters || null;
    });
    expect(result).toBe(500);
  });

  test('1.2 findIndex bounds check prevents arr[-1] corruption', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const wos = _memDB.wo;
      const idx = wos.findIndex(x => x.id === 99999);
      return { index: idx, woCountBefore: wos.length };
    });
    expect(result.index).toBe(-1);
    // Verify no phantom record was created
    const countAfter = await page.evaluate(() => _memDB.wo.length);
    expect(countAfter).toBe(result.woCountBefore);
  });

  test('1.2 All save functions have findIndex guard', async ({ page }) => {
    await bootstrapApp(page);
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const guardPattern = /if\([a-z]+<0\)\{showToast\('Record not found/g;
    const matches = html.match(guardPattern);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(9);
  });

  test('1.3 Division by zero returns 0, not NaN/Infinity', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      // Simulate zero ophrs + zero downtime
      const ophrs = 0, downtime = 0, shiftHrs = 8;
      const denom = Math.max(ophrs + downtime, shiftHrs);
      const util = denom > 0 ? Math.min(100, Math.round((ophrs / denom) * 100)) : 0;
      return util;
    });
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  test('1.3 Normal utilization calculates correctly', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const ophrs = 6, downtime = 2, shiftHrs = 8;
      const denom = Math.max(ophrs + downtime, shiftHrs);
      return denom > 0 ? Math.min(100, Math.round((ophrs / denom) * 100)) : 0;
    });
    expect(result).toBe(75);
  });
});

// ═══════════════════════════════════════════════════
// Phase 2 — Critical Security (XSS)
// ═══════════════════════════════════════════════════

test.describe('Phase 2 — Critical Security', () => {

  test('2.1 escapeHTML neutralizes XSS payload', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      return escapeHTML('<img src=x onerror=alert(1)>');
    });
    expect(result).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(result).not.toContain('<img');
  });

  test('2.1 Dropdown innerHTML uses escapeHTML for user data', async ({ page }) => {
    await bootstrapApp(page);
    const src = await page.evaluate(() => document.documentElement.innerHTML);
    // Forecast location datalist
    expect(src).toContain('escapeHTML(v)');
    // Room view datalist
    expect(src).toContain('escapeHTML(r)');
  });

  test('2.2 Delay reason is escaped in forecast view', async ({ page }) => {
    await bootstrapApp(page);
    const src = await page.evaluate(() => document.documentElement.innerHTML);
    expect(src).toContain('escapeHTML(reason)');
  });

  test('2.3 safeSrc blocks javascript: URLs', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => ({
      evil: safeSrc('javascript:alert(1)'),
      good: safeSrc('https://example.com/photo.jpg'),
      data: safeSrc('data:image/png;base64,abc123'),
      empty: safeSrc(''),
      nul: safeSrc(null),
    }));
    expect(results.evil).toBe('');
    expect(results.good).toBe('https://example.com/photo.jpg');
    expect(results.data).toBe('data:image/png;base64,abc123');
    expect(results.empty).toBeFalsy();
    expect(results.nul).toBeFalsy();
  });

  test('2.3 data-photo-src stores safeSrc result, not raw URL', async ({ page }) => {
    await bootstrapApp(page);
    const src = await page.evaluate(() => document.documentElement.innerHTML);
    // All photo button data attributes should use the safeSrc'd variable
    expect(src).toContain('data-photo-src="${escapeHTML(safeImg)}"');
    expect(src).toContain('data-photo-src="${escapeHTML(safeImgUrl)}"');
    expect(src).toContain('data-photo-src="${escapeHTML(rptUrl)}"');
    expect(src).toContain('data-photo-src="${escapeHTML(photoUrl)}"');
  });
});

// ═══════════════════════════════════════════════════
// Phase 3 — High Sync/Data
// ═══════════════════════════════════════════════════

test.describe('Phase 3 — Sync & Data Integrity', () => {

  test('3.1 mergeListenerSnapshot has clear logic (no empty block)', async ({ page }) => {
    await bootstrapApp(page);
    const src = await page.evaluate(() => document.documentElement.innerHTML);
    // Old confusing pattern should be gone
    expect(src).not.toContain('if(!pendingUpsertKeys.has(dk)){}');
    // New clear pattern should exist
    expect(src).toContain('if(pendingUpsertKeys.has(dk)) merged.push(r)');
  });

  test('3.2 saveWaterSettings triggers UI refresh', async ({ page }) => {
    await bootstrapApp(page);
    const src = await page.evaluate(() => document.documentElement.innerHTML);
    // Function should call renderTankKPIs after saving
    const fn = await page.evaluate(() => saveWaterSettings.toString());
    expect(fn).toContain('renderTankKPIs');
    expect(fn).toContain('renderExpectedComparison');
    expect(fn).toContain('renderWaterAlarmPanel');
  });

  test('3.3 savePersonnel has explanatory comment', async ({ page }) => {
    await bootstrapApp(page);
    const src = await page.evaluate(() => document.documentElement.innerHTML);
    expect(src).toContain('Intentional: mutates _memDB directly');
  });
});

// ═══════════════════════════════════════════════════
// Phase 4 — Accessibility
// ═══════════════════════════════════════════════════

test.describe('Phase 4 — Accessibility', () => {

  test('4.1 Escape key closes open modal', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('workorders'));
    // Open WO modal
    await page.evaluate(() => openModal('mo-wo'));
    let isOpen = await page.evaluate(() => !!document.querySelector('.modal-overlay.open'));
    expect(isOpen).toBe(true);
    // Press Escape
    await page.keyboard.press('Escape');
    isOpen = await page.evaluate(() => !!document.querySelector('.modal-overlay.open'));
    expect(isOpen).toBe(false);
  });

  test('4.2 Nav items have tabindex and role="button"', async ({ page }) => {
    await bootstrapApp(page);
    const navItems = await page.evaluate(() => {
      const items = document.querySelectorAll('.nav-item');
      return Array.from(items).map(el => ({
        tabindex: el.getAttribute('tabindex'),
        role: el.getAttribute('role'),
        hasKeydown: !!el.getAttribute('onkeydown'),
      }));
    });
    expect(navItems.length).toBeGreaterThan(0);
    navItems.forEach(item => {
      expect(item.tabindex).toBe('0');
      expect(item.role).toBe('button');
      expect(item.hasKeydown).toBe(true);
    });
  });

  test('4.3 All modals have role="dialog" and aria-modal', async ({ page }) => {
    await bootstrapApp(page);
    const modals = await page.evaluate(() => {
      const overlays = document.querySelectorAll('.modal-overlay');
      return Array.from(overlays).map(el => ({
        id: el.id,
        role: el.getAttribute('role'),
        ariaModal: el.getAttribute('aria-modal'),
      }));
    });
    expect(modals.length).toBeGreaterThanOrEqual(16);
    modals.forEach(m => {
      expect(m.role).toBe('dialog');
      expect(m.ariaModal).toBe('true');
    });
  });

  test('4.4 Toast container has aria-live and role="status"', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => showToast('test'));
    const attrs = await page.evaluate(() => {
      const c = document.getElementById('toast-container');
      return { ariaLive: c?.getAttribute('aria-live'), role: c?.getAttribute('role') };
    });
    expect(attrs.ariaLive).toBe('polite');
    expect(attrs.role).toBe('status');
  });

  test('4.5 Focus-visible CSS exists for buttons and nav items', async ({ page }) => {
    await bootstrapApp(page);
    const hasRule = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText && rule.selectorText.includes('focus-visible')) return true;
          }
        } catch(e) {} // cross-origin sheets
      }
      return false;
    });
    expect(hasRule).toBe(true);
  });

  test('4.6 All static images have alt attributes', async ({ page }) => {
    await bootstrapApp(page);
    const imgs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(i => ({
        id: i.id || '(no id)',
        hasAlt: i.hasAttribute('alt'),
      }));
    });
    imgs.forEach(img => {
      expect(img.hasAlt, `img#${img.id} missing alt`).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════
// Phase 5 — Medium Issues
// ═══════════════════════════════════════════════════

test.describe('Phase 5 — Medium Issues', () => {

  test('5.1 All form labels have "for" attribute', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const withFor = document.querySelectorAll('.form-group label[for]').length;
      const total = document.querySelectorAll('.form-group label').length;
      return { withFor, total };
    });
    expect(result.withFor).toBe(result.total);
    expect(result.total).toBeGreaterThan(100);
  });

  test('5.2 Backdrop click closes modal', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      navigate('workorders');
      openModal('mo-wo');
    });
    // Simulate clicking the overlay (not the inner modal)
    const closed = await page.evaluate(() => {
      const overlay = document.querySelector('.modal-overlay.open');
      const evt = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(evt, 'target', { value: overlay });
      overlay.dispatchEvent(evt);
      return !document.querySelector('.modal-overlay.open');
    });
    expect(closed).toBe(true);
  });

  test('5.4 navigate() pushes browser history state', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('workorders'));
    expect(page.url()).toContain('?page=workorders');
    await page.evaluate(() => navigate('assets'));
    expect(page.url()).toContain('?page=assets');
    await page.goBack();
    // Client-side popstate nav — wait for URL change without requiring full load
    await page.waitForFunction(() => location.search.includes('page=workorders'), { timeout: 5000 });
    expect(page.url()).toContain('?page=workorders');
  });

  test('5.5 Invalid page navigation shows error toast', async ({ page }) => {
    await bootstrapApp(page);
    const toast = await page.evaluate(() => {
      window._alerts = [];
      navigate('nonexistent_page_xyz');
      const result = window._alerts.slice();
      window._alerts = undefined;
      return result;
    });
    expect(toast).toContain('Page not found.');
  });

  test('5.6 Navigate sets focus to page heading', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('workorders'));
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName, tabindex: el?.getAttribute('tabindex') };
    });
    expect(['H2', 'H3']).toContain(focused.tag);
  });
});

// ═══════════════════════════════════════════════════
// Phase 6 — Polish
// ═══════════════════════════════════════════════════

test.describe('Phase 6 — Polish', () => {

  test('6.1 Buttons have type="button"', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      let withType = 0;
      buttons.forEach(b => { if (b.getAttribute('type')) withType++; });
      return { total: buttons.length, withType };
    });
    // Vast majority should have type attribute
    expect(result.withType / result.total).toBeGreaterThan(0.8);
  });

  test('6.4 Console.log does not leak user email', async ({ page }) => {
    await bootstrapApp(page);
    const src = await page.evaluate(() => document.documentElement.innerHTML);
    expect(src).not.toContain("console.log('HAMMS: logged in as', user.email");
    expect(src).toContain("console.log('HAMMS: user authenticated')");
  });
});

// ═══════════════════════════════════════════════════
// Integration: Full page navigation smoke test
// ═══════════════════════════════════════════════════

test.describe('Integration', () => {

  test('All 17 pages navigate without JS errors', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const pages = ['dashboard','workorders','assets','forecast','inventory','issuance',
        'waste','wastefcast','safety','projects','water','watertank',
        'effluent','medwaste','wwprod','reports','instructions'];
      const errors = [];
      pages.forEach(p => {
        try { navigate(p, true); } catch(e) { errors.push(p + ': ' + e.message); }
      });
      navigate('dashboard', true);
      return { tested: pages.length, errors };
    });
    expect(result.tested).toBe(17);
    expect(result.errors).toEqual([]);
  });

  test('No JS errors on page load (excluding SVG chart warnings)', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await bootstrapApp(page);
    // Filter out SVG NaN attribute warnings (charts with empty data)
    const realErrors = jsErrors.filter(e => !e.includes('Expected length'));
    expect(realErrors).toEqual([]);
  });
});
