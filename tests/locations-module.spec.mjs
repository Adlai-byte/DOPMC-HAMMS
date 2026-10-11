import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Buildings & Rooms (Locations) Module', () => {

  test('STORES includes locations and navigation switches to page-locations', async ({ page }) => {
    await bootstrapApp(page);

    const check = await page.evaluate(() => {
      const hasStore = STORES.includes('locations');
      const hasMemDB = Array.isArray(_memDB.locations);
      const pageTitle = PAGE_TITLES.locations;
      navigate('locations');
      const activePage = document.getElementById('page-locations')?.classList.contains('active');
      return { hasStore, hasMemDB, pageTitle, activePage };
    });

    expect(check.hasStore).toBe(true);
    expect(check.hasMemDB).toBe(true);
    expect(check.pageTitle).toBe('Buildings & Rooms');
    expect(check.activePage).toBe(true);
  });

  test('Validates required fields when saving a room/space', async ({ page }) => {
    await bootstrapApp(page);

    const validationCheck = await page.evaluate(() => {
      openLocationModal();
      document.getElementById('m-loc-bld').value = '';
      document.getElementById('m-loc-name').value = '';
      saveLocation();
      const count = DB.g('locations').length;
      const bldErr = document.querySelector('#mo-loc #m-loc-bld')?.getAttribute('aria-invalid') === 'true';
      const nameErr = document.querySelector('#mo-loc #m-loc-name')?.getAttribute('aria-invalid') === 'true';
      return { count, bldErr, nameErr };
    });

    expect(validationCheck.count).toBe(0);
    expect(validationCheck.bldErr).toBe(true);
    expect(validationCheck.nameErr).toBe(true);
  });

  test('Creates, displays, edits, and deletes a room/space', async ({ page }) => {
    await bootstrapApp(page);

    // Create Room
    await page.evaluate(() => {
      navigate('locations');
      openLocationModal();
      document.getElementById('m-loc-bld').value = 'Main Hospital Building';
      document.getElementById('m-loc-floor').value = '2nd Floor';
      document.getElementById('m-loc-roomno').value = 'OR-1';
      document.getElementById('m-loc-name').value = 'Operating Room 1 - Major';
      document.getElementById('m-loc-dept').value = 'Surgical Services';
      document.getElementById('m-loc-type').value = 'Operating Suite';
      document.getElementById('m-loc-status').value = 'Active';
      document.getElementById('m-loc-beds').value = '2';
      document.getElementById('m-loc-remarks').value = 'Primary laparoscopy suite';
      saveLocation();
    });

    const createCheck = await page.evaluate(() => {
      const locs = DB.g('locations');
      const rowText = document.getElementById('loc-tbody')?.innerText || '';
      const statTotal = document.getElementById('loc-stat-total')?.textContent;
      const statBld = document.getElementById('loc-stat-bld')?.textContent;
      return { locs, rowText, statTotal, statBld };
    });

    expect(createCheck.locs.length).toBe(1);
    expect(createCheck.locs[0].roomName).toBe('Operating Room 1 - Major');
    expect(createCheck.locs[0].roomNumber).toBe('OR-1');
    expect(createCheck.locs[0].capacityBeds).toBe(2);
    expect(createCheck.locs[0].code).toMatch(/^LOC-MAIHOS-OR1-\d+$/);
    expect(createCheck.rowText).toContain('Operating Room 1 - Major');
    expect(createCheck.statTotal).toBe('1');
    expect(createCheck.statBld).toBe('1');

    // Edit Room
    await page.evaluate(() => {
      const loc = DB.g('locations')[0];
      openLocationModal(loc.id);
      document.getElementById('m-loc-name').value = 'Operating Room 1 - Renovated';
      document.getElementById('m-loc-status').value = 'Under Renovation';
      saveLocation();
    });

    const editCheck = await page.evaluate(() => {
      const loc = DB.g('locations')[0];
      const statRenov = document.getElementById('loc-stat-renov')?.textContent;
      const rowText = document.getElementById('loc-tbody')?.innerText || '';
      return { loc, statRenov, rowText };
    });

    expect(editCheck.loc.roomName).toBe('Operating Room 1 - Renovated');
    expect(editCheck.loc.status).toBe('Under Renovation');
    expect(editCheck.statRenov).toBe('1');
    expect(editCheck.rowText).toContain('Operating Room 1 - Renovated');

    // Delete Room
    await page.evaluate(async () => {
      window.confirmDialog = async () => true;
      const loc = DB.g('locations')[0];
      await delLocation(loc.id);
    });

    const delCheck = await page.evaluate(() => {
      const locs = DB.g('locations');
      const rowText = document.getElementById('loc-tbody')?.innerText || '';
      const statTotal = document.getElementById('loc-stat-total')?.textContent;
      return { count: locs.length, rowText, statTotal };
    });

    expect(delCheck.count).toBe(0);
    expect(delCheck.statTotal).toBe('0');
    expect(delCheck.rowText).toContain('No rooms or spaces found');
  });

  test('Quick-add callback populates location input on creation', async ({ page }) => {
    await bootstrapApp(page);

    const callbackResult = await page.evaluate(() => {
      let returnedLoc = null;
      openLocationModal(null, (newLoc) => {
        returnedLoc = newLoc;
      });
      document.getElementById('m-loc-bld').value = 'Annex Wing';
      document.getElementById('m-loc-name').value = 'Hemodialysis Unit';
      saveLocation();
      return returnedLoc;
    });

    expect(callbackResult).not.toBeNull();
    expect(callbackResult.roomName).toBe('Hemodialysis Unit');
    expect(callbackResult.building).toBe('Annex Wing');
  });

  test('seedLocationsFromAssets extracts rooms from assets without duplicating', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      // Seed assets with distinct rooms
      DB.s('assets', [
        { id: 101, name: 'Infusion Pump A', location: 'ICU Bed 1', building: 'Main Hospital Building', floor: '2nd Floor', qty: 1, section: 'Biomedical' },
        { id: 102, name: 'Infusion Pump B', location: 'ICU Bed 2', building: 'Main Hospital Building', floor: '2nd Floor', qty: 1, section: 'Biomedical' },
        { id: 103, name: 'Autoclave Sterilizer', location: 'Central Sterilization', building: 'Service Building', floor: 'Ground Floor', qty: 1, section: 'Mechanical' },
        { id: 104, name: 'Defibrillator', location: 'Emergency Room', building: 'Main Hospital Building', floor: 'Ground Floor', qty: 1, section: 'Biomedical' }
      ]);
      seedLocationsFromAssets();
    });

    const seedCheck = await page.evaluate(() => {
      const locs = DB.g('locations');
      const names = locs.map(l => l.roomName);
      return { count: locs.length, names };
    });

    expect(seedCheck.count).toBe(4);
    expect(seedCheck.names).toContain('ICU Bed 1');
    expect(seedCheck.names).toContain('ICU Bed 2');
    expect(seedCheck.names).toContain('Central Sterilization');
    expect(seedCheck.names).toContain('Emergency Room');

    // Run seed again: verify no duplicates added
    await page.evaluate(() => {
      seedLocationsFromAssets();
    });

    const countAfterReSeed = await page.evaluate(() => DB.g('locations').length);
    expect(countAfterReSeed).toBe(4);
  });

  test('exportCSV and downloadLocationTemplate run without errors', async ({ page }) => {
    await bootstrapApp(page);

    const testExecution = await page.evaluate(() => {
      let downloaded = [];
      const origDl = window.dl;
      window.dl = (blob, filename) => {
        downloaded.push(filename);
      };

      DB.s('locations', [
        { id: 1, code: 'LOC-MAIN-OR1-001', building: 'Main', floor: '2F', roomNumber: 'OR-1', roomName: 'Operating Room 1', department: 'Surgery', type: 'Operating Suite', status: 'Active', capacityBeds: null, remarks: '' }
      ]);

      exportCSV('locations');
      downloadLocationTemplate();

      window.dl = origDl;
      return downloaded;
    });

    expect(testExecution.some(name => name.startsWith('HAMMS_Locations_'))).toBe(true);
    expect(testExecution).toContain('HAMMS_Buildings_Rooms_Template.csv');
  });

  test('validateBackup handles backups without locations property cleanly', async ({ page }) => {
    await bootstrapApp(page);

    const backupResult = await page.evaluate(() => {
      const legacyBackup = {
        system: 'HAMMS v2.10',
        exportedAt: '2026-01-01T00:00:00.000Z',
        wo: [],
        assets: [{ id: 1, name: 'Lamp', location: 'Hallway', section: 'Electrical' }],
        inventory: [],
        issuance: [],
        waste: [],
        waterLogs: [],
        waterTank: [],
        effluent: [],
        medWasteProd: [],
        wwProd: [],
        censusLog: [],
        waterSettings: [],
        energyBills: [],
        safety: [],
        projects: []
        // Note: 'locations' is intentionally omitted to simulate older client backup
      };

      try {
        const validated = validateBackup(legacyBackup);
        return { success: true, hasLocations: Array.isArray(validated.locations) };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    expect(backupResult.success).toBe(true);
    expect(backupResult.hasLocations).toBe(true);
  });

});
