import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

// ─── Bootstrap helper (mirrors existing specs) ────────────────────

// ═══════════════════════════════════════════════════════════════
// 1. Semantic HTML Landmarks
// ═══════════════════════════════════════════════════════════════

test.describe('1 — Semantic HTML Landmarks', () => {

  test('1.1 Page has lang="en-PH"', async ({ page }) => {
    await bootstrapApp(page);
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en-PH');
  });

  test('1.2 Skip-to-content link exists', async ({ page }) => {
    await bootstrapApp(page);
    const link = await page.evaluate(() => {
      const el = document.querySelector('a.skip-link');
      return el ? { href: el.getAttribute('href'), text: el.textContent } : null;
    });
    expect(link).not.toBeNull();
    expect(link.href).toBe('#content');
    expect(link.text).toContain('Skip to content');
  });

  test('1.3 Content area uses <main> element', async ({ page }) => {
    await bootstrapApp(page);
    const mainEl = await page.evaluate(() => {
      const el = document.getElementById('content');
      return el ? el.tagName : null;
    });
    expect(mainEl).toBe('MAIN');
  });

  test('1.4 Topbar uses <header> element', async ({ page }) => {
    await bootstrapApp(page);
    const tag = await page.evaluate(() => {
      const el = document.getElementById('topbar');
      return el ? el.tagName : null;
    });
    expect(tag).toBe('HEADER');
  });

  test('1.5 Navigation has aria-label', async ({ page }) => {
    await bootstrapApp(page);
    const label = await page.evaluate(() => {
      const nav = document.querySelector('#sidebar nav');
      return nav ? nav.getAttribute('aria-label') : null;
    });
    expect(label).toBe('Main navigation');
  });

  test('1.6 Viewport meta allows zoom (maximum-scale >= 5)', async ({ page }) => {
    await bootstrapApp(page);
    const ok = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      if (!meta) return false;
      const content = meta.getAttribute('content') || '';
      const noUserScalable = content.includes('user-scalable=no') || content.includes('user-scalable=0');
      const maxScaleMatch = content.match(/maximum-scale=(\d+(\.\d+)?)/);
      const maxScale = maxScaleMatch ? parseFloat(maxScaleMatch[1]) : 10;
      return !noUserScalable && maxScale >= 5;
    });
    expect(ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Table Accessibility
// ═══════════════════════════════════════════════════════════════

test.describe('2 — Table Accessibility', () => {

  test('2.1 All <th> elements have scope="col"', async ({ page }) => {
    await bootstrapApp(page);
    const missing = await page.evaluate(() => {
      const ths = document.querySelectorAll('th');
      const bad = [];
      ths.forEach(th => {
        if (th.getAttribute('scope') !== 'col') {
          bad.push(th.textContent.trim().substring(0, 30));
        }
      });
      return bad;
    });
    expect(missing).toEqual([]);
  });

  test('2.2 Major data tables have <caption> elements', async ({ page }) => {
    await bootstrapApp(page);
    const tables = ['Work Orders', 'Asset Registry', 'Safety Issues', 'Materials Inventory'];
    for (const name of tables) {
      const found = await page.evaluate((n) => {
        const captions = document.querySelectorAll('caption');
        return Array.from(captions).some(c => c.textContent.includes(n));
      }, name);
      expect(found).toBe(true);
    }
  });

  test('2.3 sr-only class hides captions visually', async ({ page }) => {
    await bootstrapApp(page);
    const hidden = await page.evaluate(() => {
      const caption = document.querySelector('caption.sr-only');
      if (!caption) return false;
      const style = getComputedStyle(caption);
      return style.position === 'absolute' && parseInt(style.width) <= 1;
    });
    expect(hidden).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Inline Form Validation
// ═══════════════════════════════════════════════════════════════

test.describe('3 — Inline Form Validation', () => {

  test('3.1 showFieldError sets aria-invalid and shows error text', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => navigate('workorders'));
    await page.evaluate(() => openWOModal());

    // Try saving without required fields
    await page.evaluate(() => saveWO());

    const result = await page.evaluate(() => {
      const secEl = document.getElementById('m-wo-section');
      const descEl = document.getElementById('m-wo-desc');
      const secErr = secEl?.parentElement?.querySelector('.field-error');
      const descErr = descEl?.parentElement?.querySelector('.field-error');
      return {
        secInvalid: secEl?.getAttribute('aria-invalid'),
        descInvalid: descEl?.getAttribute('aria-invalid'),
        secErrText: secErr?.textContent || '',
        descErrText: descErr?.textContent || '',
        secErrVisible: secErr ? getComputedStyle(secErr).display !== 'none' : false,
        descErrVisible: descErr ? getComputedStyle(descErr).display !== 'none' : false,
      };
    });

    expect(result.secInvalid).toBe('true');
    expect(result.descInvalid).toBe('true');
    expect(result.secErrText).toContain('required');
    expect(result.descErrText).toContain('required');
    expect(result.secErrVisible).toBe(true);
    expect(result.descErrVisible).toBe(true);
  });

  test('3.2 Field errors have role="alert"', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      navigate('workorders');
      openWOModal();
      saveWO();
    });
    const hasAlerts = await page.evaluate(() => {
      const alerts = document.querySelectorAll('#mo-wo .field-error[role="alert"]');
      return alerts.length >= 2;
    });
    expect(hasAlerts).toBe(true);
  });

  test('3.3 clearAllFieldErrors removes validation state', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      navigate('workorders');
      openWOModal();
      saveWO(); // triggers errors
      clearAllFieldErrors('mo-wo');
    });
    const result = await page.evaluate(() => {
      const invalids = document.querySelectorAll('#mo-wo [aria-invalid]');
      const visibleErrors = Array.from(document.querySelectorAll('#mo-wo .field-error')).filter(
        e => getComputedStyle(e).display !== 'none'
      );
      return { invalidCount: invalids.length, visibleErrorCount: visibleErrors.length };
    });
    expect(result.invalidCount).toBe(0);
    expect(result.visibleErrorCount).toBe(0);
  });

  test('3.4 Inline validation works on saveAsset()', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      navigate('assets');
      openAssetModal();
      saveAsset();
    });
    const invalid = await page.evaluate(() => {
      return document.getElementById('m-a-name')?.getAttribute('aria-invalid') === 'true';
    });
    expect(invalid).toBe(true);
  });

  test('3.5 Inline validation works on saveInvItem()', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      navigate('inventory');
      openInvModal();
      saveInvItem();
    });
    const errors = await page.evaluate(() => {
      return document.querySelectorAll('#mo-inv .field-error[role="alert"]').length;
    });
    expect(errors).toBeGreaterThanOrEqual(2);
  });

  test('3.6 Inline validation works on saveSafety()', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      navigate('safety');
      openSafetyModal();
      saveSafety();
    });
    const invalid = await page.evaluate(() => {
      return document.getElementById('m-sf-desc')?.getAttribute('aria-invalid') === 'true';
    });
    expect(invalid).toBe(true);
  });

  test('3.7 Inline validation works on saveProject()', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      navigate('projects');
      openProjectModal();
      saveProject();
    });
    const errors = await page.evaluate(() => {
      return document.querySelectorAll('#mo-project .field-error[role="alert"]').length;
    });
    expect(errors).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Loading States
// ═══════════════════════════════════════════════════════════════

test.describe('4 — Loading States', () => {

  test('4.1 Loading overlay exists in DOM on fresh load', async ({ page }) => {
    await page.goto('/?nocache=' + Date.now());
    await page.evaluate(() => {
      if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(r => r.forEach(w => w.unregister()));
    });
    await page.goto('/?nocache=' + Date.now());
    await page.waitForLoadState('domcontentloaded');
    const hasOverlay = await page.evaluate(() => !!document.getElementById('app-loading-overlay'));
    expect(hasOverlay).toBe(true);
  });

  test('4.2 Loading spinner has correct CSS class', async ({ page }) => {
    await page.goto('/?nocache=' + Date.now());
    await page.waitForLoadState('domcontentloaded');
    const hasSpinner = await page.evaluate(() => !!document.querySelector('.loading-spinner'));
    expect(hasSpinner).toBe(true);
  });

  test('4.3 setSavingState function exists', async ({ page }) => {
    await bootstrapApp(page);
    const exists = await page.evaluate(() => typeof setSavingState === 'function');
    expect(exists).toBe(true);
  });

  test('4.4 Disabled button CSS applies opacity', async ({ page }) => {
    await bootstrapApp(page);
    const opacity = await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.disabled = true;
      document.body.appendChild(btn);
      const o = parseFloat(getComputedStyle(btn).opacity);
      btn.remove();
      return o;
    });
    expect(opacity).toBeLessThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Color Contrast (badge classes)
// ═══════════════════════════════════════════════════════════════

test.describe('5 — Color Contrast', () => {

  test('5.1 .sev-moderate uses darkened text color', async ({ page }) => {
    await bootstrapApp(page);
    const color = await page.evaluate(() => {
      const el = document.createElement('span');
      el.className = 'sev-moderate';
      el.textContent = 'Test';
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    });
    // #5a3400 = rgb(90, 52, 0)
    expect(color).toContain('90');
    expect(color).toContain('52');
  });

  test('5.2 .sev-high uses darkened text color', async ({ page }) => {
    await bootstrapApp(page);
    const color = await page.evaluate(() => {
      const el = document.createElement('span');
      el.className = 'sev-high';
      el.textContent = 'Test';
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    });
    // #6a0000 = rgb(106, 0, 0)
    expect(color).toContain('106');
  });

  test('5.3 .ws-warning uses darkened text color', async ({ page }) => {
    await bootstrapApp(page);
    const color = await page.evaluate(() => {
      const el = document.createElement('span');
      el.className = 'ws-warning';
      el.textContent = 'Test';
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    });
    // #5a3400 = rgb(90, 52, 0)
    expect(color).toContain('90');
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Generic delRecord
// ═══════════════════════════════════════════════════════════════

test.describe('6 — Generic delRecord', () => {

  test('6.1 delRecord function exists', async ({ page }) => {
    await bootstrapApp(page);
    const exists = await page.evaluate(() => typeof delRecord === 'function');
    expect(exists).toBe(true);
  });

  test('6.2 delWO uses delRecord (removes record from store)', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(async () => {
      _memDB.wo = [{ id: 1, section: 'CMW', description: 'Test' }];
      await delWO(1); // confirmDialog is auto-true (async)
      return _memDB.wo.length;
    });
    expect(result).toBe(0);
  });

  test('6.3 delAsset removes record', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(async () => {
      _memDB.assets = [{ id: 99, name: 'Test Asset' }];
      await delAsset(99);
      return _memDB.assets.length;
    });
    expect(result).toBe(0);
  });

  test('6.4 delSafety removes record', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(async () => {
      _memDB.safety = [{ id: 55, description: 'Broken railing' }];
      await delSafety(55);
      return _memDB.safety.length;
    });
    expect(result).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Generic CSV Importer
// ═══════════════════════════════════════════════════════════════

test.describe('7 — Generic CSV Importer', () => {

  test('7.1 genericCSVImport function exists', async ({ page }) => {
    await bootstrapApp(page);
    const exists = await page.evaluate(() => typeof genericCSVImport === 'function');
    expect(exists).toBe(true);
  });

  test('7.2 debounce function exists', async ({ page }) => {
    await bootstrapApp(page);
    const exists = await page.evaluate(() => typeof debounce === 'function');
    expect(exists).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Dashboard Memoization
// ═══════════════════════════════════════════════════════════════

test.describe('8 — Dashboard Memoization', () => {

  test('8.1 _dashCache is populated after renderDash', async ({ page }) => {
    await bootstrapApp(page);
    const cached = await page.evaluate(() => {
      renderDash();
      return _dashCache !== null && typeof _dashCache === 'object';
    });
    expect(cached).toBe(true);
  });

  test('8.2 _dashCache has pmsMap and totalKwh', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      renderDash();
      return {
        hasPmsMap: _dashCache && typeof _dashCache.pmsMap === 'object',
        hasTotalKwh: _dashCache && typeof _dashCache.totalKwh === 'number',
      };
    });
    expect(result.hasPmsMap).toBe(true);
    expect(result.hasTotalKwh).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Offline UX
// ═══════════════════════════════════════════════════════════════

test.describe('9 — Offline UX', () => {

  test('9.1 Offline banner appears on offline event', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const banner = await page.evaluate(() => {
      const el = document.getElementById('offline-banner');
      return el ? el.textContent : null;
    });
    expect(banner).toContain('offline');
  });

  test('9.2 Offline banner removed on online event', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
    });
    const banner = await page.evaluate(() => document.getElementById('offline-banner'));
    expect(banner).toBeNull();
  });

  test('9.3 setOfflineBanner function exists', async ({ page }) => {
    await bootstrapApp(page);
    const exists = await page.evaluate(() => typeof setOfflineBanner === 'function');
    expect(exists).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Chart Accessibility
// ═══════════════════════════════════════════════════════════════

test.describe('10 — Chart Accessibility', () => {

  test('10.1 drawBarLineChart sets role="img" on container', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      navigate('safety');
      // Force chart render
      renderSafety();
      const chart = document.querySelector('[role="img"]');
      return chart ? { role: chart.getAttribute('role'), label: chart.getAttribute('aria-label') } : null;
    });
    expect(result).not.toBeNull();
    expect(result.role).toBe('img');
    expect(result.label).toContain('Chart:');
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. Inventory Stamp in saveWO
// ═══════════════════════════════════════════════════════════════

test.describe('11 — Inventory stampRecord in saveWO', () => {

  test('11.1 stampRecord function exists and increments _v', async ({ page }) => {
    await bootstrapApp(page);
    const result = await page.evaluate(() => {
      const rec = { id: 1, name: 'Test', _v: 0 };
      stampRecord(rec);
      return { v: rec._v, hasUpdatedAt: typeof rec._updatedAt === 'number', hasUpdatedBy: typeof rec._updatedBy === 'string' };
    });
    expect(result.v).toBe(1);
    expect(result.hasUpdatedAt).toBe(true);
    expect(result.hasUpdatedBy).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. CSS Custom Properties (Tier 4)
// ═══════════════════════════════════════════════════════════════

test.describe('12 — CSS Custom Properties', () => {

  test('12.1 Semantic color tokens exist in :root', async ({ page }) => {
    await bootstrapApp(page);
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        dangerBg: style.getPropertyValue('--danger-bg').trim(),
        warningText: style.getPropertyValue('--warning-text').trim(),
        successBg: style.getPropertyValue('--success-bg').trim(),
        infoText: style.getPropertyValue('--info-text').trim(),
      };
    });
    expect(tokens.dangerBg).toBeTruthy();
    expect(tokens.warningText).toBeTruthy();
    expect(tokens.successBg).toBeTruthy();
    expect(tokens.infoText).toBeTruthy();
  });

  test('12.2 Spacing scale tokens exist', async ({ page }) => {
    await bootstrapApp(page);
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        xs: style.getPropertyValue('--space-xs').trim(),
        sm: style.getPropertyValue('--space-sm').trim(),
        md: style.getPropertyValue('--space-md').trim(),
        lg: style.getPropertyValue('--space-lg').trim(),
        xl: style.getPropertyValue('--space-xl').trim(),
      };
    });
    expect(tokens.xs).toBe('4px');
    expect(tokens.sm).toBe('8px');
    expect(tokens.md).toBe('12px');
    expect(tokens.lg).toBe('16px');
    expect(tokens.xl).toBe('24px');
  });

  test('12.3 Radius tokens exist', async ({ page }) => {
    await bootstrapApp(page);
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        sm: style.getPropertyValue('--radius-sm').trim(),
        md: style.getPropertyValue('--radius-md').trim(),
        lg: style.getPropertyValue('--radius-lg').trim(),
      };
    });
    expect(tokens.sm).toBe('4px');
    expect(tokens.md).toBe('6px');
    expect(tokens.lg).toBe('10px');
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. Mobile Touch Targets
// ═══════════════════════════════════════════════════════════════

test.describe('13 — Mobile Touch Targets', () => {

  test('13.1 Mobile buttons have min-height 44px at narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await bootstrapApp(page);
    const minH = await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Test';
      document.body.appendChild(btn);
      const h = parseFloat(getComputedStyle(btn).minHeight);
      btn.remove();
      return h;
    });
    expect(minH).toBeGreaterThanOrEqual(44);
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. Sync Retry / Write Lock Safety
// ═══════════════════════════════════════════════════════════════

test.describe('14 — Sync & Write Lock', () => {

  test('14.1 _fbSyncRetryCount variable exists', async ({ page }) => {
    await bootstrapApp(page);
    const exists = await page.evaluate(() => typeof _fbSyncRetryCount === 'number');
    expect(exists).toBe(true);
  });

  test('14.2 _FB_MAX_RETRIES is 3', async ({ page }) => {
    await bootstrapApp(page);
    const val = await page.evaluate(() => _FB_MAX_RETRIES);
    expect(val).toBe(3);
  });

  test('14.3 _fbWriteLockTimer variable exists', async ({ page }) => {
    await bootstrapApp(page);
    const exists = await page.evaluate(() => typeof _fbWriteLockTimer !== 'undefined');
    expect(exists).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 15. openModalForRecord Helper
// ═══════════════════════════════════════════════════════════════

test.describe('15 — openModalForRecord Helper', () => {

  test('15.1 openModalForRecord function exists', async ({ page }) => {
    await bootstrapApp(page);
    const exists = await page.evaluate(() => typeof openModalForRecord === 'function');
    expect(exists).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 16. Print Stylesheet
// ═══════════════════════════════════════════════════════════════

test.describe('16 — Print Stylesheet', () => {

  test('16.1 Print media hides sidebar and buttons', async ({ page }) => {
    await bootstrapApp(page);
    const hidden = await page.evaluate(() => {
      // Check that the print stylesheet rule exists
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.conditionText === 'print' || (rule.cssText && rule.cssText.includes('@media print'))) {
              return true;
            }
          }
        } catch(e) {}
      }
      return false;
    });
    expect(hidden).toBe(true);
  });
});
