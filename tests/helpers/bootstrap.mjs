// Shared version of the original crud-e2e bootstrap. Isolate Firebase BEFORE
// navigation so a late auth callback cannot hide the app or replace the stub.
export async function bootstrapApp(page) {
  await page.route('https://**/*', route => route.abort());
  await page.addInitScript(() => { window._FB = { enabled: false, db: null, email: 'test@example.com' }; });
  await page.goto('/?nocache=' + Date.now());
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(worker => worker.unregister()));
    }
    await Promise.all((await caches.keys()).map(name => caches.delete(name)));
  });
  await page.goto('/?nocache=' + Date.now());
  await page.waitForFunction(() => typeof navigate === 'function');
  await page.evaluate(() => {
    document.getElementById('hamms-login-overlay').style.cssText = 'display:none !important';
    document.getElementById('app').style.visibility = 'visible';
    document.getElementById('app-loading-overlay')?.remove();
    STORES.forEach(store => applyStoreData(store, []));
    _memDB.personnel = {};
    _fbPendingStoreOps = Object.create(null);
    _fbPendingMetaMerge = {};
    window._FB = { enabled: false, db: null, email: 'test@example.com' };
    window.confirmDialog = async () => true;
    navigate('dashboard');
  });
}
