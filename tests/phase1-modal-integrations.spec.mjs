import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Phase 1 — Safety & Water Log Location Integrations (TDD)', () => {

  test('Safety modal has + New Room button, datalist link, and auto-populates location', async ({ page }) => {
    await bootstrapApp(page);

    // Seed test locations
    await page.evaluate(() => {
      DB.s('locations', [
        { id: 1, building: 'Main Hospital Building', roomName: 'Operating Room 1', roomNumber: 'OR-1', type: 'Operating Suite', status: 'Active' },
        { id: 2, building: 'Main Hospital Building', roomName: 'ICU Ward A', roomNumber: 'ICU-A', type: 'Intensive Care Unit (ICU)', status: 'Active' }
      ]);
      openSafetyModal();
    });

    const checkSafety = await page.evaluate(() => {
      const modal = document.getElementById('mo-safety');
      const locInput = modal.querySelector('#m-sf-loc');
      const label = modal.querySelector('label[for="m-sf-loc"]');
      const datalistAttr = locInput?.getAttribute('list');
      const newRoomBtn = modal.querySelector('button[onclick*="openLocationModal"]');
      return {
        hasInput: !!locInput,
        hasLabelWithFor: !!label,
        datalistAttr,
        hasNewRoomBtn: !!newRoomBtn
      };
    });

    expect(checkSafety.hasInput).toBe(true);
    expect(checkSafety.hasLabelWithFor).toBe(true);
    expect(checkSafety.datalistAttr).toBeTruthy();
    expect(checkSafety.hasNewRoomBtn).toBe(true);

    // Test quick-add callback in Safety modal
    await page.evaluate(() => {
      // Simulate quick-add click
      openLocationModal(null, (newLoc) => {
        document.getElementById('m-sf-loc').value = newLoc.roomName || newLoc.roomNumber || '';
      });
      document.getElementById('m-loc-bld').value = 'Emergency Building';
      document.getElementById('m-loc-name').value = 'ER Trauma Bay 1';
      saveLocation();
    });

    const val = await page.evaluate(() => document.getElementById('m-sf-loc')?.value);
    expect(val).toBe('ER Trauma Bay 1');
  });

  test('Water Log modal has + New Room button, prioritized ward datalist, and auto-populates', async ({ page }) => {
    await bootstrapApp(page);

    // Seed test locations with different space types
    await page.evaluate(() => {
      DB.s('locations', [
        { id: 1, building: 'Main Building', roomName: 'Dietary Main Kitchen', type: 'Dietary / Kitchen', status: 'Active' },
        { id: 2, building: 'Main Building', roomName: 'Pediatric Inpatient Ward', type: 'Patient Ward', status: 'Active' },
        { id: 3, building: 'Main Building', roomName: 'Admin Accounting Office', type: 'Office / Administrative', status: 'Active' }
      ]);
      openWaterLogModal();
    });

    const checkWater = await page.evaluate(() => {
      const modal = document.getElementById('mo-waterlog');
      const wardInput = modal.querySelector('#m-wl-ward');
      const label = modal.querySelector('label[for="m-wl-ward"]');
      const datalistAttr = wardInput?.getAttribute('list');
      const newRoomBtn = modal.querySelector('button[onclick*="openLocationModal"]');
      const dl = document.getElementById(datalistAttr);
      const options = dl ? [...dl.querySelectorAll('option')].map(o => o.value) : [];

      return {
        hasInput: !!wardInput,
        hasLabelWithFor: !!label,
        datalistAttr,
        hasNewRoomBtn: !!newRoomBtn,
        options
      };
    });

    expect(checkWater.hasInput).toBe(true);
    expect(checkWater.hasLabelWithFor).toBe(true);
    expect(checkWater.datalistAttr).toBe('wl-ward-list');
    expect(checkWater.hasNewRoomBtn).toBe(true);
    expect(checkWater.options).toContain('Pediatric Inpatient Ward');
    expect(checkWater.options).toContain('Dietary Main Kitchen');

    // Test quick-add callback in Water modal
    await page.evaluate(() => {
      openLocationModal(null, (newLoc) => {
        document.getElementById('m-wl-ward').value = newLoc.roomName || newLoc.roomNumber || '';
      });
      document.getElementById('m-loc-bld').value = 'Maternity Wing';
      document.getElementById('m-loc-name').value = 'Neonatal Ward Station';
      saveLocation();
    });

    const val = await page.evaluate(() => document.getElementById('m-wl-ward')?.value);
    expect(val).toBe('Neonatal Ward Station');
  });

});
