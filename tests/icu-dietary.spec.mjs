import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';


test.describe('ICU and DIETARY Audit', () => {

  test('Check 1: buildLocAbv handles ICU and DIETARY correctly without truncation or RM prepending', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      return {
        icuSimple: buildLocAbv('ICU'),
        icuWithUnderscore: buildLocAbv('ICU_'),
        icuRoomNo: buildLocAbv('Main Building', '1st Floor', 'ICU'),
        dietarySimple: buildLocAbv('DIETARY'),
        dietaryWithUnderscore: buildLocAbv('DIETARY_'),
        dietaryDept: buildLocAbv('DIETARY DEPT'),
        dietaryDepartment: buildLocAbv('DIETARY DEPARTMENT'),
        dietaryKitchen: buildLocAbv('Dietary Kitchen'),
        dietaryRoomNo: buildLocAbv('Main Building', '1st Floor', 'DIETARY'),
        dietaryDiet: buildLocAbv('Diet')
      };
    });
    
    expect(results.icuSimple).toBe('ICU');
    expect(results.icuWithUnderscore).toBe('ICU');
    expect(results.icuRoomNo).toBe('ICU');
    expect(results.dietarySimple).toBe('DIET');
    expect(results.dietaryWithUnderscore).toBe('DIET');
    expect(results.dietaryDept).toBe('DIET');
    expect(results.dietaryDepartment).toBe('DIET');
    expect(results.dietaryKitchen).toBe('DIET');
    expect(results.dietaryRoomNo).toBe('DIET');
    expect(results.dietaryDiet).toBe('DIET');
  });

  test('Check 2: isSameLocation behavior for ICU vs NICU vs PICU vs ICU Corridor and DIETARY aliases', async ({ page }) => {
    await bootstrapApp(page);
    const results = await page.evaluate(() => {
      return {
        icuVsNicu: isSameLocation('ICU', 'NICU'),
        icuVsPicu: isSameLocation('ICU', 'PICU'),
        icuVsIcuCr: isSameLocation('ICU', 'ICU CR'),
        icuVsIcuCorridor: isSameLocation('ICU', 'ICU Corridor'),
        icuVsIcuLobby: isSameLocation('ICU', 'ICU Lobby'),
        icuVsIcuUnderscore: isSameLocation('ICU', 'ICU_'),
        dietaryVsDiet: isSameLocation('DIETARY', 'DIET'),
        dietaryVsDietaryDept: isSameLocation('DIETARY', 'DIETARY DEPT'),
        dietaryVsKitchen: isSameLocation('DIETARY', 'KITCHEN'),
        dietaryVsDietaryKitchen: isSameLocation('DIETARY', 'DIETARY KITCHEN'),
        dietaryVsDietaryUnderscore: isSameLocation('DIETARY', 'DIETARY_'),
        dietVsDietaryUnderscore: isSameLocation('DIET', 'DIETARY_'),
        dietaryVsDietaryCorridor: isSameLocation('DIETARY', 'Dietary Corridor')
      };
    });

    expect(results.icuVsNicu).toBe(false);
    expect(results.icuVsPicu).toBe(false);
    expect(results.icuVsIcuCr).toBe(true);
    expect(results.icuVsIcuCorridor).toBe(false);
    expect(results.icuVsIcuLobby).toBe(false);
    expect(results.icuVsIcuUnderscore).toBe(true);
    expect(results.dietaryVsDiet).toBe(true);
    expect(results.dietaryVsDietaryDept).toBe(true);
    expect(results.dietaryVsKitchen).toBe(true);
    expect(results.dietaryVsDietaryKitchen).toBe(true);
    expect(results.dietaryVsDietaryUnderscore).toBe(true);
    expect(results.dietVsDietaryUnderscore).toBe(true);
    expect(results.dietaryVsDietaryCorridor).toBe(false);
  });

  test('Check 3: Asset Registry search for "ICU" and "ICU_" does not leak into NICU or PICU', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 1, name: 'Patient Monitor', location: 'ICU', section: 'Biomedical', assetCode: 'PM-BIOMED-ICU-01' },
        { id: 2, name: 'Neonatal Incubator', location: 'NICU', section: 'Biomedical', assetCode: 'INC-BIOMED-NICU-01' },
        { id: 3, name: 'Pediatric Ventilator', location: 'PICU', section: 'Biomedical', assetCode: 'VENT-BIOMED-PICU-01' },
        { id: 4, name: 'Commercial Blender', location: 'Dietary', section: 'Mechanical', assetCode: 'BL-MECH-DIET-01' },
        { id: 5, name: 'Food Warmer', location: 'Diet', section: 'Mechanical', assetCode: 'FW-MECH-DIET-02' }
      ]);
      navigate('assets');
    });

    // 1. Search 'ICU'
    const icuResults = await page.evaluate(() => {
      document.getElementById('af-search').value = 'ICU';
      renderAssets();
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(icuResults.length).toBe(1);
    expect(icuResults[0]).toContain('PM-BIOMED-ICU-01');
    expect(icuResults[0]).toContain('Patient Monitor');

    // 2. Search 'ICU_'
    const icuUnderResults = await page.evaluate(() => {
      document.getElementById('af-search').value = 'ICU_';
      renderAssets();
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(icuUnderResults.length).toBe(1);
    expect(icuUnderResults[0]).toContain('PM-BIOMED-ICU-01');

    // 3. Search 'DIETARY'
    const dietaryResults = await page.evaluate(() => {
      document.getElementById('af-search').value = 'DIETARY';
      renderAssets();
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(dietaryResults.length).toBe(2);
    expect(dietaryResults.some(r => r.includes('Commercial Blender'))).toBe(true);
    expect(dietaryResults.some(r => r.includes('Food Warmer'))).toBe(true);

    // 4. Search 'DIETARY_'
    const dietaryUnderResults = await page.evaluate(() => {
      document.getElementById('af-search').value = 'DIETARY_';
      renderAssets();
      const rows = Array.from(document.querySelectorAll('#asset-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(dietaryUnderResults.length).toBe(2);
    expect(dietaryUnderResults.some(r => r.includes('Commercial Blender'))).toBe(true);
    expect(dietaryUnderResults.some(r => r.includes('Food Warmer'))).toBe(true);
  });

  test('Check 4: Room View for ICU and DIETARY captures all variants and excludes outside/leakage', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 10, name: 'Defibrillator', location: 'ICU', section: 'Biomedical', assetCode: 'DEF-BIOMED-ICU-01' },
        { id: 11, name: 'Phototherapy Lamp', location: 'NICU', section: 'Biomedical', assetCode: 'PL-BIOMED-NICU-01' },
        { id: 12, name: 'Hallway Extinguisher', location: 'ICU Corridor', section: 'CMW', assetCode: 'EXT-CMW-HALL-01' },
        { id: 20, name: 'Commercial Blender', location: 'Dietary', section: 'Mechanical', assetCode: 'BL-MECH-DIET-01' },
        { id: 21, name: 'Heavy Duty Range', location: 'Dietary Dept', section: 'Mechanical', assetCode: 'RG-MECH-DIET-02' },
        { id: 22, name: 'Food Warmer', location: 'Diet', section: 'Mechanical', assetCode: 'FW-MECH-DIET-03' }
      ]);
      DB.s('wo', [
        { id: 101, asset: 'Defibrillator', location: 'ICU', description: 'Battery inspection', status: 'Open' },
        { id: 102, asset: 'Phototherapy Lamp', location: 'NICU', description: 'Bulb replacement', status: 'Open' },
        { id: 103, asset: 'Hallway Extinguisher', location: 'ICU Corridor', description: 'Pressure gauge check', status: 'Open' },
        { id: 201, asset: 'Commercial Blender', location: 'Dietary', description: 'Blade sharpening', status: 'Open' },
        { id: 202, asset: 'Food Warmer', location: 'Diet', description: 'Thermostat replacement', status: 'Open' }
      ]);
    });

    // 1. Open Room View for ICU
    const icuRoomView = await page.evaluate(() => {
      openRoomView('ICU');
      return {
        assets: document.getElementById('room-view-assets').innerText,
        wos: document.getElementById('room-view-wos').innerText
      };
    });
    expect(icuRoomView.assets).toContain('Defibrillator');
    expect(icuRoomView.assets).not.toContain('Phototherapy Lamp');
    expect(icuRoomView.assets).not.toContain('Hallway Extinguisher');
    expect(icuRoomView.wos).toContain('Battery inspection');
    expect(icuRoomView.wos).not.toContain('Bulb replacement');
    expect(icuRoomView.wos).not.toContain('Pressure gauge check');

    // 2. Open Room View for ICU_ (with trailing underscore)
    const icuUnderRoomView = await page.evaluate(() => {
      openRoomView('ICU_');
      return {
        assets: document.getElementById('room-view-assets').innerText,
        wos: document.getElementById('room-view-wos').innerText
      };
    });
    expect(icuUnderRoomView.assets).toContain('Defibrillator');
    expect(icuUnderRoomView.assets).not.toContain('Phototherapy Lamp');
    expect(icuUnderRoomView.assets).not.toContain('Hallway Extinguisher');

    // 3. Open Room View for Dietary
    const dietaryRoomView = await page.evaluate(() => {
      openRoomView('Dietary');
      return {
        assets: document.getElementById('room-view-assets').innerText,
        wos: document.getElementById('room-view-wos').innerText
      };
    });
    expect(dietaryRoomView.assets).toContain('Commercial Blender');
    expect(dietaryRoomView.assets).toContain('Heavy Duty Range');
    expect(dietaryRoomView.assets).toContain('Food Warmer');
    expect(dietaryRoomView.wos).toContain('Blade sharpening');
    expect(dietaryRoomView.wos).toContain('Thermostat replacement');

    // 4. Open Room View for DIETARY_ (with trailing underscore)
    const dietaryUnderRoomView = await page.evaluate(() => {
      openRoomView('DIETARY_');
      return {
        assets: document.getElementById('room-view-assets').innerText,
        wos: document.getElementById('room-view-wos').innerText
      };
    });
    expect(dietaryUnderRoomView.assets).toContain('Commercial Blender');
    expect(dietaryUnderRoomView.assets).toContain('Heavy Duty Range');
    expect(dietaryUnderRoomView.assets).toContain('Food Warmer');
  });

  test('Check 5: Work Order fillAssetDrop and search isolate ICU and DIETARY', async ({ page }) => {
    await bootstrapApp(page);
    await page.evaluate(() => {
      DB.s('assets', [
        { id: 1, name: 'ICU Patient Monitor', location: 'ICU', section: 'Biomedical', assetCode: 'PM-BIOMED-ICU-01' },
        { id: 2, name: 'NICU Incubator', location: 'NICU', section: 'Biomedical', assetCode: 'INC-BIOMED-NICU-01' },
        { id: 3, name: 'PICU Ventilator', location: 'PICU', section: 'Biomedical', assetCode: 'VENT-BIOMED-PICU-01' },
        { id: 4, name: 'Dietary Blender', location: 'Diet', section: 'Mechanical', assetCode: 'BL-MECH-DIET-01' }
      ]);
      DB.s('wo', [
        { id: 101, code: 'WO-0101', asset: 'ICU Patient Monitor', location: 'ICU', description: 'Monitor calibration', status: 'Open', section: 'Biomedical', priority: 'Medium' },
        { id: 102, code: 'WO-0102', asset: 'NICU Incubator', location: 'NICU', description: 'Temp sensor test', status: 'Open', section: 'Biomedical', priority: 'High' },
        { id: 103, code: 'WO-0103', asset: 'Dietary Blender', location: 'Diet', description: 'Motor check', status: 'Open', section: 'Mechanical', priority: 'Low' }
      ]);
      navigate('wo');
    });

    // 1. Work order search for 'ICU'
    const woSearchResults = await page.evaluate(() => {
      document.getElementById('wof-search').value = 'ICU';
      renderWO();
      const rows = Array.from(document.querySelectorAll('#wo-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(woSearchResults.length).toBe(1);
    expect(woSearchResults[0]).toContain('ICU Patient Monitor');
    expect(woSearchResults[0]).not.toContain('NICU Incubator');

    // 2. Work order location filter for 'ICU'
    const woLocResults = await page.evaluate(() => {
      document.getElementById('wof-search').value = '';
      document.getElementById('wof-loc').value = 'ICU';
      renderWO();
      const rows = Array.from(document.querySelectorAll('#wo-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(woLocResults.length).toBe(1);
    expect(woLocResults[0]).toContain('ICU Patient Monitor');

    // 3. Work order location filter for 'DIETARY' matches 'Diet'
    const woDietResults = await page.evaluate(() => {
      document.getElementById('wof-loc').value = 'DIETARY';
      renderWO();
      const rows = Array.from(document.querySelectorAll('#wo-tbody tr'));
      return rows.map(r => r.innerText);
    });
    expect(woDietResults.length).toBe(1);
    expect(woDietResults[0]).toContain('Dietary Blender');

    // 4. fillAssetDrop with section Biomedical and location 'ICU' isolates ICU Patient Monitor
    const dropOptions = await page.evaluate(() => {
      document.getElementById('m-wo-section').value = 'Biomedical';
      document.getElementById('m-wo-loc').value = 'ICU';
      fillAssetDrop();
      const sel = document.getElementById('m-wo-asset');
      return Array.from(sel.options).map(o => o.text);
    });
    expect(dropOptions.some(o => o.includes('ICU Patient Monitor'))).toBe(true);
    expect(dropOptions.some(o => o.includes('NICU Incubator'))).toBe(false);
    expect(dropOptions.some(o => o.includes('PICU Ventilator'))).toBe(false);
  });

});
