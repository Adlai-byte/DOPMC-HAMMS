import { bootstrapApp } from './helpers/bootstrap.mjs';
import { test, expect } from '@playwright/test';

test.describe('Unified Location Combobox Experience (TDD)', () => {

  test('Work Order modal displays a single unified combobox, opens popup, and selects room', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        {
          _docId: 'loc_or_201',
          id: 1,
          building: 'Main Hospital Building',
          floor: '2nd Floor',
          roomName: 'Operating Room 1',
          roomNumber: 'OR-201',
          department: 'Surgery',
          status: 'Active'
        },
        {
          _docId: 'loc_er_101',
          id: 2,
          building: 'Main Hospital Building',
          floor: 'Ground Floor',
          roomName: 'Emergency Room',
          roomNumber: 'ER-101',
          department: 'Emergency Medicine',
          status: 'Active'
        }
      ]);
      openWOModal();
    });

    // 1. Verify unified combobox structure
    const cbInfo = await page.evaluate(() => {
      const wrap = document.getElementById('m-wo-loc-combobox');
      const input = document.getElementById('m-wo-loc');
      const toggle = wrap ? wrap.querySelector('.combobox-toggle-btn') : null;
      const select = document.getElementById('m-wo-loc-select');
      const popup = document.getElementById('m-wo-loc-popup');
      return {
        hasWrap: !!wrap,
        hasInput: !!input,
        hasToggle: !!toggle,
        hasPopup: !!popup,
        selectHidden: select ? (select.style.display === 'none' || window.getComputedStyle(select).display === 'none') : false
      };
    });

    expect(cbInfo.hasWrap).toBe(true);
    expect(cbInfo.hasInput).toBe(true);
    expect(cbInfo.hasToggle).toBe(true);
    expect(cbInfo.hasPopup).toBe(true);
    expect(cbInfo.selectHidden).toBe(true);

    // 2. Click toggle button to open popup
    await page.evaluate(() => {
      const toggle = document.querySelector('#m-wo-loc-combobox .combobox-toggle-btn');
      toggle.click();
    });

    const popupState = await page.evaluate(() => {
      const popup = document.getElementById('m-wo-loc-popup');
      const items = [...popup.querySelectorAll('.combobox-item')];
      return {
        visible: popup.style.display !== 'none',
        itemCount: items.length,
        itemTexts: items.map(el => el.textContent)
      };
    });

    expect(popupState.visible).toBe(true);
    expect(popupState.itemCount).toBe(2);
    expect(popupState.itemTexts.some(t => t.includes('Operating Room 1'))).toBe(true);
    expect(popupState.itemTexts.some(t => t.includes('Emergency Room'))).toBe(true);

    // 3. Click the Operating Room 1 item to select it
    await page.evaluate(() => {
      const orItem = [...document.querySelectorAll('#m-wo-loc-popup .combobox-item')].find(el => el.textContent.includes('Operating Room 1'));
      orItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    const afterSelect = await page.evaluate(() => {
      return {
        locVal: document.getElementById('m-wo-loc')?.value,
        docIdVal: document.getElementById('m-wo-loc-docid')?.value,
        selectVal: document.getElementById('m-wo-loc-select')?.value,
        badgeText: document.getElementById('m-wo-loc-badge')?.textContent,
        popupClosed: document.getElementById('m-wo-loc-popup')?.style.display === 'none'
      };
    });

    expect(afterSelect.locVal).toBe('Operating Room 1');
    expect(afterSelect.docIdVal).toBe('loc_or_201');
    expect(afterSelect.selectVal).toBe('loc_or_201');
    expect(afterSelect.badgeText).toContain('Main Hospital Building');
    expect(afterSelect.popupClosed).toBe(true);
  });

  test('Combobox filters items in real time as user types and supports keyboard selection', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        { _docId: 'loc_icu', id: 1, building: 'Main Building', floor: '2nd Floor', roomName: 'Intensive Care Unit (ICU)', roomNumber: 'ICU-204', department: 'Critical Care', status: 'Active' },
        { _docId: 'loc_dietary', id: 2, building: 'Support Building', floor: 'Ground Floor', roomName: 'Dietary Kitchen', roomNumber: 'KIT-001', department: 'Nutrition', status: 'Active' }
      ]);
      openWOModal();
    });

    // Type 'diet' into input
    await page.evaluate(() => {
      const input = document.getElementById('m-wo-loc');
      input.value = 'diet';
      if (typeof onLocationComboboxInput === 'function') {
        onLocationComboboxInput('wo', 'diet');
      }
    });

    const filteredState = await page.evaluate(() => {
      const popup = document.getElementById('m-wo-loc-popup');
      const items = [...popup.querySelectorAll('.combobox-item')];
      return {
        visible: popup.style.display !== 'none',
        count: items.length,
        text: items[0]?.textContent
      };
    });

    expect(filteredState.visible).toBe(true);
    expect(filteredState.count).toBe(1);
    expect(filteredState.text).toContain('Dietary Kitchen');

    // Press ArrowDown then Enter to select
    await page.evaluate(() => {
      const input = document.getElementById('m-wo-loc');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const selectedByKeyboard = await page.evaluate(() => {
      return {
        locVal: document.getElementById('m-wo-loc')?.value,
        docIdVal: document.getElementById('m-wo-loc-docid')?.value,
        badgeText: document.getElementById('m-wo-loc-badge')?.textContent
      };
    });

    expect(selectedByKeyboard.locVal).toBe('Dietary Kitchen');
    expect(selectedByKeyboard.docIdVal).toBe('loc_dietary');
    expect(selectedByKeyboard.badgeText).toContain('Support Building');
  });

  test('Custom room typing is preserved as custom space and clears locationDocId', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      DB.s('locations', [
        { _docId: 'loc_or', id: 1, building: 'Main Building', floor: '2nd Floor', roomName: 'OR 1', roomNumber: 'OR-1', status: 'Active' }
      ]);
      openWOModal();
      const input = document.getElementById('m-wo-loc');
      input.value = 'Temporary Triage Tent B';
      if (typeof onLocationComboboxInput === 'function') {
        onLocationComboboxInput('wo', 'Temporary Triage Tent B');
      }
    });

    const customState = await page.evaluate(() => {
      return {
        locVal: document.getElementById('m-wo-loc')?.value,
        docIdVal: document.getElementById('m-wo-loc-docid')?.value,
        badgeText: document.getElementById('m-wo-loc-badge')?.textContent
      };
    });

    expect(customState.locVal).toBe('Temporary Triage Tent B');
    expect(customState.docIdVal).toBe('');
    expect(customState.badgeText).toContain('Custom space');
  });

  test('Asset and Project modals also have unified combobox structure', async ({ page }) => {
    await bootstrapApp(page);

    await page.evaluate(() => {
      openAssetModal();
    });

    const assetCb = await page.evaluate(() => {
      const wrap = document.getElementById('m-a-loc-combobox');
      const input = document.getElementById('m-a-loc');
      const toggle = wrap ? wrap.querySelector('.combobox-toggle-btn') : null;
      const select = document.getElementById('m-a-loc-select');
      const popup = document.getElementById('m-a-loc-popup');
      return {
        hasWrap: !!wrap,
        hasInput: !!input,
        hasToggle: !!toggle,
        hasPopup: !!popup,
        selectHidden: select ? (select.style.display === 'none' || window.getComputedStyle(select).display === 'none') : false
      };
    });

    expect(assetCb.hasWrap).toBe(true);
    expect(assetCb.hasInput).toBe(true);
    expect(assetCb.hasToggle).toBe(true);
    expect(assetCb.hasPopup).toBe(true);
    expect(assetCb.selectHidden).toBe(true);

    await page.evaluate(() => {
      closeModal('mo-asset');
      openProjectModal();
    });

    const projectCb = await page.evaluate(() => {
      const wrap = document.getElementById('m-pj-loc-combobox');
      const input = document.getElementById('m-pj-loc');
      const toggle = wrap ? wrap.querySelector('.combobox-toggle-btn') : null;
      const select = document.getElementById('m-pj-loc-select');
      const popup = document.getElementById('m-pj-loc-popup');
      return {
        hasWrap: !!wrap,
        hasInput: !!input,
        hasToggle: !!toggle,
        hasPopup: !!popup,
        selectHidden: select ? (select.style.display === 'none' || window.getComputedStyle(select).display === 'none') : false
      };
    });

    expect(projectCb.hasWrap).toBe(true);
    expect(projectCb.hasInput).toBe(true);
    expect(projectCb.hasToggle).toBe(true);
    expect(projectCb.hasPopup).toBe(true);
    expect(projectCb.selectHidden).toBe(true);
  });

});
