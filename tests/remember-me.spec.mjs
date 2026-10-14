import { test, expect } from '@playwright/test';

test.describe('Remember Me Login Functionality', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/?nocache=' + Date.now());
    await page.waitForLoadState('domcontentloaded');
  });

  test('1. Remember Me UI elements and accessibility', async ({ page }) => {
    // Check that checkbox exists and is properly structured
    const rememberCheckbox = page.locator('#login-remember');
    await expect(rememberCheckbox).toBeAttached();
    await expect(rememberCheckbox).toHaveAttribute('type', 'checkbox');

    // Associated label exists with "Remember me" text
    const rememberLabel = page.locator('label[for="login-remember"]');
    await expect(rememberLabel).toBeAttached();
    await expect(rememberLabel).toContainText('Remember me');

    // Email and Password inputs have matching labels
    await expect(page.locator('label[for="login-email"]')).toBeAttached();
    await expect(page.locator('label[for="login-password"]')).toBeAttached();
  });

  test('2. Unchecked by default when localStorage is empty', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('hamms_remember_me');
      localStorage.removeItem('hamms_remembered_email');
      initLoginRemember();
    });

    const isChecked = await page.evaluate(() => {
      return document.getElementById('login-remember').checked;
    });
    expect(isChecked).toBe(false);

    const emailValue = await page.evaluate(() => {
      return document.getElementById('login-email').value;
    });
    expect(emailValue).toBe('');
  });

  test('3. Pre-populates email and checks checkbox when remembered in localStorage', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('hamms_remember_me', 'true');
      localStorage.setItem('hamms_remembered_email', 'nurse.joy@dopmc.gov.ph');
      initLoginRemember();
    });

    const isChecked = await page.evaluate(() => document.getElementById('login-remember').checked);
    const emailValue = await page.evaluate(() => document.getElementById('login-email').value);

    expect(isChecked).toBe(true);
    expect(emailValue).toBe('nurse.joy@dopmc.gov.ph');
  });

  test('4. Unchecking Remember Me clears stored credentials from localStorage', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('hamms_remember_me', 'true');
      localStorage.setItem('hamms_remembered_email', 'engr.mark@dopmc.gov.ph');
      initLoginRemember();
    });

    // Verify initial stored state
    let storedEmail = await page.evaluate(() => localStorage.getItem('hamms_remembered_email'));
    expect(storedEmail).toBe('engr.mark@dopmc.gov.ph');

    // Uncheck the checkbox
    await page.evaluate(() => {
      const cb = document.getElementById('login-remember');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Verify cleared from localStorage
    storedEmail = await page.evaluate(() => localStorage.getItem('hamms_remembered_email'));
    const storedRemember = await page.evaluate(() => localStorage.getItem('hamms_remember_me'));

    expect(storedEmail).toBeNull();
    expect(storedRemember).toBeNull();
  });

  test('5. hammsLogin with Remember Me checked persists email and calls setPersistence(true)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      let persistenceArg = null;
      let signInCalledWith = null;

      // Mock _FB auth
      window._FB = {
        enabled: true,
        setPersistence: async (remember) => { persistenceArg = remember; },
        signIn: async (email, pw) => { signInCalledWith = { email, pw }; }
      };

      document.getElementById('login-email').value = 'biomed@dopmc.gov.ph';
      document.getElementById('login-password').value = 'securepass123';
      document.getElementById('login-remember').checked = true;

      await hammsLogin();

      return {
        persistenceArg,
        signInCalledWith,
        storedRemember: localStorage.getItem('hamms_remember_me'),
        storedEmail: localStorage.getItem('hamms_remembered_email')
      };
    });

    expect(result.persistenceArg).toBe(true);
    expect(result.signInCalledWith.email).toBe('biomed@dopmc.gov.ph');
    expect(result.storedRemember).toBe('true');
    expect(result.storedEmail).toBe('biomed@dopmc.gov.ph');
  });

  test('6. hammsLogin with Remember Me unchecked clears localStorage and calls setPersistence(false)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Pre-seed storage
      localStorage.setItem('hamms_remember_me', 'true');
      localStorage.setItem('hamms_remembered_email', 'old@dopmc.gov.ph');

      let persistenceArg = null;
      window._FB = {
        enabled: true,
        setPersistence: async (remember) => { persistenceArg = remember; },
        signIn: async () => {}
      };

      document.getElementById('login-email').value = 'admin@dopmc.gov.ph';
      document.getElementById('login-password').value = 'adminpass456';
      document.getElementById('login-remember').checked = false;

      await hammsLogin();

      return {
        persistenceArg,
        storedRemember: localStorage.getItem('hamms_remember_me'),
        storedEmail: localStorage.getItem('hamms_remembered_email')
      };
    });

    expect(result.persistenceArg).toBe(false);
    expect(result.storedRemember).toBeNull();
    expect(result.storedEmail).toBeNull();
  });

  test('7. hammsLogout clears password field and retains remembered email', async ({ page }) => {
    const state = await page.evaluate(async () => {
      localStorage.setItem('hamms_remember_me', 'true');
      localStorage.setItem('hamms_remembered_email', 'staff@dopmc.gov.ph');

      document.getElementById('login-password').value = 'secret';

      window._FB = {
        signOut: async () => {}
      };

      await hammsLogout();

      return {
        passValue: document.getElementById('login-password').value,
        emailValue: document.getElementById('login-email').value,
        remChecked: document.getElementById('login-remember').checked
      };
    });

    expect(state.passValue).toBe('');
    expect(state.emailValue).toBe('staff@dopmc.gov.ph');
    expect(state.remChecked).toBe(true);
  });

  test('8. Pressing Enter on Email moves focus to Password or submits if Password filled', async ({ page }) => {
    // When password is empty, enter on email focuses password
    const focusedEmpty = await page.evaluate(() => {
      const emailInput = document.getElementById('login-email');
      const passInput = document.getElementById('login-password');
      emailInput.value = 'user@dopmc.gov.ph';
      passInput.value = '';

      emailInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return document.activeElement === passInput;
    });
    expect(focusedEmpty).toBe(true);

    // When password has value, enter on email invokes login
    const loginInvoked = await page.evaluate(() => {
      let invoked = false;
      const originalLogin = window.hammsLogin;
      window.hammsLogin = () => { invoked = true; };

      const emailInput = document.getElementById('login-email');
      const passInput = document.getElementById('login-password');
      emailInput.value = 'user@dopmc.gov.ph';
      passInput.value = 'password123';

      emailInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      window.hammsLogin = originalLogin;
      return invoked;
    });
    expect(loginInvoked).toBe(true);
  });

});
