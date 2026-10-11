import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Asset Modal Location / Room Connected Combo Box (TDD)', () => {

  test('Add Asset modal has connected room selector, auto-fills building/floor, and links locationDocId', async ({ page }) => {
    await bootstrapApp(page);

    // 1. Seed locations in DB
    await page.evaluate(() => {
      DB.s('locations', [
        {
          _docId: 'loc_main_or1',
          id: 1,
          building: 'Main Hospital Building',
          floor: '2nd Floor',
          roomName: 'Operating Room 1',
          roomNumber: 'OR-1',
          department: 'Surgical Services',
          status: 'Active'
        },
        {
          _docId: 'loc_admin_101',
          id: 2,
          building: 'Administrative Pavilion',
          floor: 'Ground Floor',
          roomName: 'HR Office',
          roomNumber: '101',
          department: 'Human Resources',
          status: 'Active'
        }
      ]);
      openAssetModal();
    });

    // 2. Verify controls exist in modal
    const controls = await page.evaluate(() => {
      const select = document.getElementById('m-a-loc-select');
      const input = document.getElementById('m-a-loc');
      const docIdInput = document.getElementById('m-a-loc-docid');
      const badge = document.getElementById('m-a-loc-badge');
      const options = select ? [...select.querySelectorAll('option')].map(o => ({ val: o.value, text: o.textContent })) : [];
      return {
        hasSelect: !!select,
        hasInput: !!input,
        hasDocIdInput: !!docIdInput,
        hasBadge: !!badge,
        optionsCount: options.length,
        options
      };
    });

    expect(controls.hasSelect).toBe(true);
    expect(controls.hasInput).toBe(true);
    expect(controls.hasDocIdInput).toBe(true);
    expect(controls.hasBadge).toBe(true);
    expect(controls.options.some(o => o.val === 'loc_main_or1')).toBe(true);

    // 3. Select a room from the dropdown
    await page.evaluate(() => {
      const select = document.getElementById('m-a-loc-select');
      select.value = 'loc_main_or1';
      select.dispatchEvent(new Event('change'));
    });

    // 4. Verify auto-fill of input, building, floor, roomno, and badge
    const afterSelect = await page.evaluate(() => {
      return {
        locVal: document.getElementById('m-a-loc')?.value,
        docIdVal: document.getElementById('m-a-loc-docid')?.value,
        bldVal: document.getElementById('m-a-building')?.value,
        flrVal: document.getElementById('m-a-floor')?.value,
        rmVal: document.getElementById('m-a-roomno')?.value,
        badgeText: document.getElementById('m-a-loc-badge')?.textContent
      };
    });

    expect(afterSelect.locVal).toBe('Operating Room 1');
    expect(afterSelect.docIdVal).toBe('loc_main_or1');
    expect(afterSelect.bldVal).toBe('Main Hospital Building');
    expect(afterSelect.flrVal).toBe('2nd Floor');
    expect(afterSelect.rmVal).toBe('OR-1');
    expect(afterSelect.badgeText).toContain('Main Hospital Building');

    // 5. Fill required asset fields and save
    await page.evaluate(() => {
      document.getElementById('m-a-name').value = 'Anesthesia Machine 1';
      document.getElementById('m-a-section').value = 'Biomedical';
      saveAsset();
    });

    // 6. Verify saved asset has locationDocId, building, floor, roomNumber
    const savedAsset = await page.evaluate(() => {
      const assets = DB.g('assets');
      return assets.find(a => a.name === 'Anesthesia Machine 1');
    });

    expect(savedAsset).toBeTruthy();
    expect(savedAsset.locationDocId).toBe('loc_main_or1');
    expect(savedAsset.building).toBe('Main Hospital Building');
    expect(savedAsset.floor).toBe('2nd Floor');
    expect(savedAsset.roomNumber).toBe('OR-1');
    expect(savedAsset.location).toBe('Operating Room 1');
  });

  test('Typing matching room name into text input auto-links to Buildings & Rooms', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        {
          _docId: 'loc_icu_bed2',
          id: 10,
          building: 'Critical Care Wing',
          floor: '3rd Floor',
          roomName: 'ICU Bed 2',
          roomNumber: 'ICU-02',
          status: 'Active'
        }
      ]);
      openAssetModal();
    });

    // Simulate typing 'ICU Bed 2' into m-a-loc
    await page.evaluate(() => {
      const locInput = document.getElementById('m-a-loc');
      locInput.value = 'ICU Bed 2';
      locInput.dispatchEvent(new Event('input'));
    });

    const typedResult = await page.evaluate(() => {
      return {
        selectVal: document.getElementById('m-a-loc-select')?.value,
        docIdVal: document.getElementById('m-a-loc-docid')?.value,
        bldVal: document.getElementById('m-a-building')?.value,
        flrVal: document.getElementById('m-a-floor')?.value,
        badgeText: document.getElementById('m-a-loc-badge')?.textContent
      };
    });

    expect(typedResult.selectVal).toBe('loc_icu_bed2');
    expect(typedResult.docIdVal).toBe('loc_icu_bed2');
    expect(typedResult.bldVal).toBe('Critical Care Wing');
    expect(typedResult.flrVal).toBe('3rd Floor');
    expect(typedResult.badgeText).toContain('Critical Care Wing');
  });

});
