import { test, expect } from '@playwright/test';
import { bootstrapApp } from './helpers/bootstrap.mjs';

test.beforeEach(async ({ page }) => bootstrapApp(page));

test('inventory edit retains its document identity and queues no delete', async ({ page }) => {
  const result = await page.evaluate(() => {
    applyStoreData('inventory', [{id:1,_docId:'original',_v:4,description:'Lamp',category:'Electrical',qty:10,minLevel:1,unit:'piece'}]);
    openInvModal(1); document.getElementById('m-i-qty').value='11'; saveInvItem();
    return {key:DB.g('inventory')[0]._docId,deletes:[..._fbPendingStoreOps.inventory.deletes]};
  });
  expect(result).toEqual({key:'original',deletes:[]});
});

test('material rows cannot collectively overdraw stock or use negative quantities', async ({ page }) => {
  const result = await page.evaluate(() => {
    applyStoreData('inventory',[{id:1,_docId:'inv1',description:'Lamp',category:'Electrical',qty:10,unit:'piece'}]);
    openWOModal(); document.getElementById('m-wo-section').value='Electrical'; document.getElementById('m-wo-desc').value='Stock test';
    _woMaterials=[{invId:1,qty:6},{invId:1,qty:6}]; saveWO();
    const first=DB.g('inventory')[0].qty;
    _woMaterials=[{invId:1,qty:-2}]; saveWO();
    return {first,second:DB.g('inventory')[0].qty,orders:DB.g('wo').length};
  });
  expect(result).toEqual({first:10,second:10,orders:0});
});

test('remarks-only work-order edit preserves stock and its single issuance at zero stock', async ({ page }) => {
  const result = await page.evaluate(() => {
    applyStoreData('inventory',[{id:1,_docId:'inv1',description:'Lamp',category:'Electrical',qty:2,unit:'piece'}]);
    openWOModal(); document.getElementById('m-wo-section').value='Electrical'; document.getElementById('m-wo-desc').value='Stock test';
    _woMaterials=[{invId:1,qty:2,issuedTo:'Staff'}]; saveWO();
    const id=DB.g('wo')[0].id; openWOModal(id); document.getElementById('m-wo-remarks').value='Updated'; saveWO();
    return {qty:DB.g('inventory')[0].qty,issuances:DB.g('issuance').length,remarks:DB.g('wo')[0].remarks};
  });
  expect(result).toEqual({qty:0,issuances:1,remarks:'Updated'});
});

test('pending deletion cannot reappear from a server snapshot', async ({ page }) => {
  expect(await page.evaluate(() => {
    applyStoreData('inventory',[]);
    _fbPendingStoreOps.inventory={upserts:{},deletes:new Set(['deleted'])};
    mergeListenerSnapshot('inventory',{docs:[{id:'deleted',data:()=>({id:1,description:'Lamp',qty:2})}]});
    return DB.g('inventory').length;
  })).toBe(0);
});

test('untrusted badge values render as text and never create elements', async ({ page }) => {
  const result = await page.evaluate(() => {
    const value='<img src=x onerror="window.__injected=true">';
    const box=document.createElement('div');
    box.innerHTML=[sevBadge,ssBadge,pjBadge,wsBadge,tkBadge,effluentBadge].map(fn=>fn(value)).join('');
    document.body.appendChild(box);
    return {images:box.querySelectorAll('img').length,text:box.textContent};
  });
  expect(result.images).toBe(0);
  expect(result.text).toContain('<img');
});

test('invalid JSON backup does not mutate any store', async ({ page }) => {
  const result = await page.evaluate(() => {
    applyStoreData('assets',[{id:1,_docId:'asset1',name:'Lamp'}]);
    let rejected=false; try{applyParsed({});}catch{rejected=true;}
    return {rejected,count:DB.g('assets').length};
  });
  expect(result).toEqual({rejected:true,count:1});
});

test('Philippine dates use the local calendar including zero-day arithmetic', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-09T01:00:00+08:00'));
  expect(await page.evaluate(() => ({today:today(),zero:addDays('2026-10-09',0),next:addDays('2026-10-09',1),week:getWeekStart('2026-10-09')})))
    .toEqual({today:'2026-10-09',zero:'2026-10-09',next:'2026-10-10',week:'2026-10-05'});
});

test('module codes do not reuse an existing suffix after a deletion', async ({ page }) => {
  const code=await page.evaluate(() => {
    applyStoreData('wo',[{id:1,code:'ELEC-MD-0001'},{id:3,code:'ELEC-MD-0003'}]);
    return generateModuleCode('wo',['ELEC','MD']);
  });
  expect(code).not.toBe('ELEC-MD-0003');
});

test('project CSV export preserves canonical UI fields', async ({ page }) => {
  const csv=await page.evaluate(async () => {
    applyStoreData('projects',[{id:1,code:'P1',title:'Project',fundingSource:'Fund',targetDate:'2026-12-01',actualDate:'2026-12-02',remarks:'Details'}]);
    let blob; window.dl=b=>{blob=b;}; exportCSV('projects'); return blob.text();
  });
  for(const value of ['Fund','2026-12-01','2026-12-02','Details'])expect(csv).toContain(value);
});
