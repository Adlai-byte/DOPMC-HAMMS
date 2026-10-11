import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Work Orders & Projects Location Normalization (TDD)', () => {

  test('Work Order modal has connected location combo box and saves locationDocId', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        {
          _docId: 'loc_icu_101',
          id: 1,
          building: 'Main Hospital Building',
          floor: '1st Floor',
          roomName: 'ICU Ward 1',
          roomNumber: 'ICU-101',
          status: 'Active'
        }
      ]);
      DB.s('assets', [
        {
          _docId: 'asset_monitor_1',
          id: 1,
          name: 'Patient Monitor 1',
          section: 'Biomedical',
          location: 'ICU Ward 1',
          locationDocId: 'loc_icu_101',
          building: 'Main Hospital Building'
        }
      ]);
      openWOModal();
    });

    // 1. Verify combo box controls exist in Work Order modal
    const controls = await page.evaluate(() => {
      const select = document.getElementById('m-wo-loc-select');
      const input = document.getElementById('m-wo-loc');
      const docIdInput = document.getElementById('m-wo-loc-docid');
      const badge = document.getElementById('m-wo-loc-badge');
      return {
        hasSelect: !!select,
        hasInput: !!input,
        hasDocIdInput: !!docIdInput,
        hasBadge: !!badge
      };
    });

    expect(controls.hasSelect).toBe(true);
    expect(controls.hasInput).toBe(true);
    expect(controls.hasDocIdInput).toBe(true);
    expect(controls.hasBadge).toBe(true);

    // 2. Select section and choose asset -> verify auto-fill
    await page.evaluate(() => {
      document.getElementById('m-wo-section').value = 'Biomedical';
      fillAssetDrop();
      const assetDrop = document.getElementById('m-wo-asset');
      // find option with asset_monitor_1
      const opt = [...assetDrop.options].find(o => o.dataset.docId === 'asset_monitor_1');
      if (opt) {
        assetDrop.value = opt.value;
        onWOAssetChange();
      }
    });

    const afterAssetSelect = await page.evaluate(() => {
      return {
        locVal: document.getElementById('m-wo-loc')?.value,
        docIdVal: document.getElementById('m-wo-loc-docid')?.value,
        badgeText: document.getElementById('m-wo-loc-badge')?.textContent
      };
    });

    expect(afterAssetSelect.locVal).toBe('ICU Ward 1');
    expect(afterAssetSelect.docIdVal).toBe('loc_icu_101');
    expect(afterAssetSelect.badgeText).toContain('Main Hospital Building');

    // 3. Save work order and verify locationDocId saved
    await page.evaluate(() => {
      document.getElementById('m-wo-desc').value = 'Check calibration on monitor 1';
      saveWO();
    });

    const savedWO = await page.evaluate(() => {
      const wos = DB.g('wo');
      return wos.find(w => w.description === 'Check calibration on monitor 1');
    });

    expect(savedWO).toBeTruthy();
    expect(savedWO.locationDocId).toBe('loc_icu_101');
    expect(savedWO.location).toBe('ICU Ward 1');
  });

  test('Projects modal has connected location combo box and saves locationDocId', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        {
          _docId: 'loc_dialysis_bld',
          id: 5,
          building: 'Dialysis Center',
          floor: 'Ground Floor',
          roomName: 'Hemodialysis Treatment Room',
          roomNumber: 'Hemo-1',
          status: 'Active'
        }
      ]);
      openProjectModal();
    });

    const controls = await page.evaluate(() => {
      const select = document.getElementById('m-pj-loc-select');
      const input = document.getElementById('m-pj-loc');
      const docIdInput = document.getElementById('m-pj-loc-docid');
      const badge = document.getElementById('m-pj-loc-badge');
      return {
        hasSelect: !!select,
        hasInput: !!input,
        hasDocIdInput: !!docIdInput,
        hasBadge: !!badge
      };
    });

    expect(controls.hasSelect).toBe(true);
    expect(controls.hasInput).toBe(true);
    expect(controls.hasDocIdInput).toBe(true);
    expect(controls.hasBadge).toBe(true);

    // Select room from dropdown
    await page.evaluate(() => {
      const select = document.getElementById('m-pj-loc-select');
      select.value = 'loc_dialysis_bld';
      select.dispatchEvent(new Event('change'));
    });

    const afterSelect = await page.evaluate(() => {
      return {
        locVal: document.getElementById('m-pj-loc')?.value,
        docIdVal: document.getElementById('m-pj-loc-docid')?.value,
        badgeText: document.getElementById('m-pj-loc-badge')?.textContent
      };
    });

    expect(afterSelect.locVal).toBe('Hemodialysis Treatment Room');
    expect(afterSelect.docIdVal).toBe('loc_dialysis_bld');
    expect(afterSelect.badgeText).toContain('Dialysis Center');

    // Fill project fields and save
    await page.evaluate(() => {
      document.getElementById('m-pj-code').value = 'PRJ-2026-001';
      document.getElementById('m-pj-title').value = 'Dialysis RO Water System Upgrade';
      saveProject();
    });

    const savedProject = await page.evaluate(() => {
      const projects = DB.g('projects');
      return projects.find(p => p.code === 'PRJ-2026-001');
    });

    expect(savedProject).toBeTruthy();
    expect(savedProject.locationDocId).toBe('loc_dialysis_bld');
    expect(savedProject.location).toBe('Hemodialysis Treatment Room');
  });

  test('Work Orders list page includes Building and Room filter dropdowns', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      navigate('wo');
    });

    const filters = await page.evaluate(() => {
      const bldFilter = document.getElementById('wo-filter-bld');
      const roomFilter = document.getElementById('wo-filter-room');
      return {
        hasBldFilter: !!bldFilter,
        hasRoomFilter: !!roomFilter
      };
    });

    expect(filters.hasBldFilter).toBe(true);
    expect(filters.hasRoomFilter).toBe(true);
  });

});
