// Existing Phase 3 / CRUD bootstrap sequence, shared by emulator-backed browser suites.
export async function bootstrapApp(page,base,email='staff@example.test',options={}){
  const route=options.scoped?'/scoped/':'/';
  await page.goto(base+route+'?nocache='+Date.now());
  await page.evaluate(async()=>{if(navigator.serviceWorker)for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);});
  await page.goto(base+route+'?nocache='+Date.now());await page.waitForLoadState('networkidle');
  if(options.scoped){await page.waitForFunction(()=>window.HAMMS_PHASE8?.ready);await page.evaluate(email=>HAMMS_PHASE8.signIn(email,'Synthetic-Only-123!'),email);return;}
  await page.waitForFunction(()=>window.HAMMS_PHASE3?.ready);
  await page.evaluate(()=>{
    document.getElementById('hamms-login-overlay').style.cssText='display:none!important';document.getElementById('app').style.visibility='visible';
    const stores=['wo','assets','inventory','issuance','waste','waterLogs','waterTank','effluent','safety','projects','medWasteProd','wwProd','censusLog','waterSettings','energyBills'];
    stores.forEach(s=>{if(!_memDB[s])_memDB[s]=[];});
    Object.keys(_fbPendingStoreOps).forEach(k=>delete _fbPendingStoreOps[k]);window._FB={enabled:false};window.confirmDialog=async()=>true;
  });
  await page.evaluate(email=>HAMMS_PHASE3.signIn(email,'Synthetic-Only-123!'),email);
}
